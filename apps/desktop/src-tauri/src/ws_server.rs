use futures_util::{SinkExt, StreamExt};
use tauri::{AppHandle, Emitter};
use tokio::net::{TcpListener, TcpStream};

use crate::registry::{Envelope, Registry};

/// Mirrors `spyglass-protocol`'s `DEFAULT_PORT` — see that constant's
/// comment for why it's not 8097 (React DevTools' own default).
pub const PORT: u16 = 8098;
/// 3x the SDK's `HEARTBEAT_INTERVAL_MS` (see `spyglass-protocol/constants`).
const HEARTBEAT_TIMEOUT_MS: u64 = 15_000;

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

    loop {
        let (stream, _) = match listener.accept().await {
            Ok(conn) => conn,
            Err(err) => {
                eprintln!("[Spyglass] accept error: {err}");
                continue;
            }
        };
        tauri::async_runtime::spawn(handle_connection(stream, app_handle.clone(), registry.clone()));
    }
}

async fn handle_connection(stream: TcpStream, app_handle: AppHandle, registry: Registry) {
    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(_) => return, // not a valid WS handshake — silently drop
    };

    let (mut write, mut read) = ws_stream.split();
    let mut current_app_id: Option<String> = None;

    while let Some(message) = read.next().await {
        let message = match message {
            Ok(m) => m,
            Err(_) => break,
        };

        if message.is_ping() {
            let _ = write.send(tokio_tungstenite::tungstenite::Message::Pong(vec![].into())).await;
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

        current_app_id = Some(envelope.app_id.clone());

        if let Some(new_app) = registry.record(&envelope) {
            let _ = app_handle.emit("app-connected", &new_app);
        }
        let _ = app_handle.emit("dm-message", &envelope);
    }

    if let Some(app_id) = current_app_id {
        if registry.mark_disconnected(&app_id) {
            let _ = app_handle.emit("app-disconnected", &app_id);
        }
    }
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
