use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use tauri::{AppHandle, Emitter};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;

use crate::registry::{Envelope, Outgoing, Registry};

/// Mirrors `spyglass-protocol`'s `DEFAULT_PORT` — see that constant's
/// comment for why it's not 8097 (React DevTools' own default).
pub const PORT: u16 = 8098;
/// 3x the SDK's `HEARTBEAT_INTERVAL_MS` (see `spyglass-protocol/constants`).
const HEARTBEAT_TIMEOUT_MS: u64 = 15_000;

/// tungstenite's own default is 64 MiB/16 MiB (message/frame) — reasonable
/// for a general-purpose library, but this socket is unauthenticated and
/// bound to `0.0.0.0`, so anyone on the LAN can open a connection. The
/// largest legitimate payload today is a `storage/snapshot`; 4 MiB is
/// generous headroom above that while keeping a single malicious frame from
/// forcing a multi-megabyte allocation off a few bytes of header.
const MAX_MESSAGE_SIZE: usize = 4 * 1024 * 1024;
const MAX_FRAME_SIZE: usize = 4 * 1024 * 1024;

/// Caps concurrent sockets so an unauthenticated LAN peer can't exhaust the
/// developer's machine by opening connections in a loop. Comfortably above
/// any real number of simultaneously-instrumented apps.
const MAX_CONCURRENT_CONNECTIONS: usize = 64;

fn ws_config() -> WebSocketConfig {
    WebSocketConfig {
        max_message_size: Some(MAX_MESSAGE_SIZE),
        max_frame_size: Some(MAX_FRAME_SIZE),
        ..Default::default()
    }
}

/// Binds the WebSocket server and accepts connections until the process
/// exits. Spawned once from `main.rs`'s `setup` hook via
/// `tauri::async_runtime::spawn`.
pub async fn run(app_handle: AppHandle, registry: Registry) {
    let addr = format!("0.0.0.0:{PORT}");
    let listener = match TcpListener::bind(&addr).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("[Spyglass] failed to bind {addr}: {err}");
            return;
        }
    };
    println!("[Spyglass] WebSocket server listening on ws://{addr}");

    tauri::async_runtime::spawn(heartbeat_sweeper(app_handle.clone(), registry.clone()));

    let active_connections = Arc::new(AtomicUsize::new(0));

    loop {
        let (stream, _) = match listener.accept().await {
            Ok(conn) => conn,
            Err(err) => {
                eprintln!("[Spyglass] accept error: {err}");
                continue;
            }
        };

        if active_connections.load(Ordering::Relaxed) >= MAX_CONCURRENT_CONNECTIONS {
            // Drop without completing the WS handshake — cheapest possible
            // rejection, no allocation beyond the already-accepted TCP conn.
            continue;
        }

        active_connections.fetch_add(1, Ordering::Relaxed);
        let counter = active_connections.clone();
        let app_handle = app_handle.clone();
        let registry = registry.clone();
        tauri::async_runtime::spawn(async move {
            handle_connection(stream, app_handle, registry).await;
            counter.fetch_sub(1, Ordering::Relaxed);
        });
    }
}

async fn handle_connection(stream: TcpStream, app_handle: AppHandle, registry: Registry) {
    let ws_stream = match tokio_tungstenite::accept_async_with_config(stream, Some(ws_config())).await {
        Ok(ws) => ws,
        Err(_) => return, // not a valid WS handshake — silently drop
    };

    let (mut write, mut read) = ws_stream.split();

    // A dedicated task owns `write` and is the only thing that ever calls
    // `.send()` on it — holding a `Mutex` across an `.await` on a socket
    // send is the classic deadlock-under-backpressure shape, so instead the
    // rest of this connection (and, via `registry`, a Tauri command from the
    // frontend) just pushes onto this channel. Dropping `tx` — this
    // function's local one, both below and the registry's copy once
    // unregistered — is what ends the writer task once the connection closes.
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Outgoing>();
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(frame) = rx.recv().await {
            let msg = match frame {
                Outgoing::Text(s) => tokio_tungstenite::tungstenite::Message::Text(s.into()),
                Outgoing::Pong(p) => tokio_tungstenite::tungstenite::Message::Pong(p.into()),
            };
            if write.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Bound to whichever `appId` this connection first announces (usually
    // via `hello`). A later frame on the *same* connection claiming a
    // different `appId` is a spoofing attempt — one physical connection is
    // always exactly one app instance — and gets dropped rather than
    // accepted under someone else's identity.
    let mut current_app_id: Option<String> = None;

    while let Some(message) = read.next().await {
        let message = match message {
            Ok(m) => m,
            Err(_) => break,
        };

        if message.is_ping() {
            let _ = tx.send(Outgoing::Pong(vec![]));
            continue;
        }
        // iOS's WebSocket client (URLSessionWebSocketTask, used by RN's iOS
        // WebSocket implementation) sends string payloads as binary frames,
        // not text frames — `into_text()` UTF-8-decodes either, but only if
        // we let binary through here too, or every message from an iOS app
        // gets silently dropped despite the connection staying open.
        if !message.is_text() && !message.is_binary() {
            continue;
        }

        let text = message.into_text().unwrap_or_default();
        let envelope: Envelope = match serde_json::from_str(&text) {
            Ok(e) => e,
            Err(_) => continue, // malformed frame (e.g. React DevTools' own protocol on the same port) — drop, don't kill the connection
        };

        match &current_app_id {
            None => {
                current_app_id = Some(envelope.app_id.clone());
                registry.register_sender(&envelope.app_id, tx.clone());
            }
            Some(bound_id) if bound_id != &envelope.app_id => continue, // spoofing attempt — drop the frame, keep the connection alive
            Some(_) => {}
        }

        if let Some(new_app) = registry.record(&envelope) {
            let _ = app_handle.emit("app-connected", &new_app);
        }
        let _ = app_handle.emit("dm-message", &envelope);
    }

    if let Some(app_id) = current_app_id {
        registry.unregister_sender(&app_id, &tx);
        if registry.mark_disconnected(&app_id) {
            let _ = app_handle.emit("app-disconnected", &app_id);
        }
    }

    // Dropping this function's sender (the registry's own clone was already
    // removed above) makes `rx.recv()` return `None`, which ends the writer
    // task on its own — no need to block connection cleanup on it.
    drop(tx);
    let _ = writer; // keep the JoinHandle alive long enough to silence an unused-var lint; the task ends itself
}

/// Catches apps whose socket died without a clean close (killed simulator,
/// device sleep) by watching for stale `last_seen` timestamps.
async fn heartbeat_sweeper(app_handle: AppHandle, registry: Registry) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
    loop {
        interval.tick().await;
        for app_id in registry.sweep_stale(HEARTBEAT_TIMEOUT_MS) {
            let _ = app_handle.emit("app-disconnected", &app_id);
        }
    }
}
