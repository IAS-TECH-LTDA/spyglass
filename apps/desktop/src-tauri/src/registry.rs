use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::UnboundedSender;

/// A frame queued for `ws_server.rs`'s per-connection writer task. Kept as a
/// tiny local enum (not `tokio_tungstenite::tungstenite::Message` directly)
/// so this module doesn't need to depend on the WS crate's types just to
/// hold a sender — `ws_server.rs` is the only place that translates this
/// into a real WebSocket frame.
#[derive(Debug)]
pub enum Outgoing {
    Text(String),
    Pong(Vec<u8>),
}

/// Both `apps` and `cache` are keyed (in part or fully) by attacker-supplied
/// strings from an unauthenticated LAN socket (`appId`, and for `cache` also
/// the message `type`) — without a cap, a peer that keeps sending distinct
/// `appId`s or distinct message types grows the process's memory forever.
/// Neither map needs a real LRU: this is a plain "stop growing, evict the
/// oldest insertion" cap, generous enough that it never bites a legitimate
/// debugging session (a handful of instrumented apps).
const MAX_APPS: usize = 64;
const MAX_CACHE_ENTRIES: usize = 2_000;

/// Mirrors `apps/desktop/src/ipc.ts`'s `AppInfo` interface (camelCase on the wire).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub app_id: String,
    pub app_name: String,
    pub platform: String,
    pub framework: Option<String>,
    pub sdk_version: String,
    pub rn_version: Option<String>,
    pub capabilities: Vec<String>,
    pub connected_at: u64,
    pub last_seen: u64,
    pub connected: bool,
}

/// Loose mirror of `spyglass-protocol`'s `Envelope<T>`. `payload` is kept
/// as an untyped `serde_json::Value` on purpose: the desktop server never
/// needs to know the shape of every payload variant (only `hello` is
/// inspected), it just timestamps, caches and forwards the rest to the
/// frontend, which has the full TypeScript types.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Envelope {
    pub v: u8,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(rename = "appId")]
    pub app_id: String,
    pub ts: i64,
    pub payload: serde_json::Value,
}

/// The subset of `HelloPayload` the registry needs to read.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct HelloPayload {
    app_name: String,
    platform: String,
    #[serde(default)]
    framework: Option<String>,
    sdk_version: String,
    rn_version: Option<String>,
    #[serde(default)]
    capabilities: Vec<String>,
}

pub struct RegistryInner {
    apps: HashMap<String, AppInfo>,
    /// Latest envelope seen per (appId, message type) — replayed to the UI
    /// on reconnect/reload so it doesn't start blank.
    cache: HashMap<(String, String), Envelope>,
    /// Insertion order for `apps`/`cache`, used only to find "the oldest
    /// entry" when evicting. Not kept perfectly in sync with removals from
    /// `forget()` (a stale id here is simply a no-op when popped) — that's
    /// fine, this is a cap, not a real LRU.
    app_order: VecDeque<String>,
    cache_order: VecDeque<(String, String)>,
    /// The write half of each currently-connected app's socket, addressable
    /// by `appId` — lets a Tauri command (`send_to_app`) reach a specific
    /// connected app. Registered when a connection's `appId` becomes known,
    /// removed when that connection ends (see `ws_server.rs`).
    senders: HashMap<String, UnboundedSender<Outgoing>>,
}

impl RegistryInner {
    fn evict_oldest_app_if_needed(&mut self) {
        while self.apps.len() > MAX_APPS {
            match self.app_order.pop_front() {
                Some(id) => {
                    self.apps.remove(&id);
                    self.cache.retain(|(cache_app_id, _), _| cache_app_id != &id);
                }
                None => break, // deque exhausted but still over cap — shouldn't happen, avoid spinning
            }
        }
    }

    fn evict_oldest_cache_entry_if_needed(&mut self) {
        while self.cache.len() > MAX_CACHE_ENTRIES {
            match self.cache_order.pop_front() {
                Some(key) => {
                    self.cache.remove(&key);
                }
                None => break,
            }
        }
    }
}

#[derive(Clone)]
pub struct Registry(Arc<Mutex<RegistryInner>>);

impl Registry {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(RegistryInner {
            apps: HashMap::new(),
            cache: HashMap::new(),
            app_order: VecDeque::new(),
            cache_order: VecDeque::new(),
            senders: HashMap::new(),
        })))
    }

    /// Registers (or replaces) the sender for a connected app. `ws_server.rs`
    /// calls this once it learns the connection's `appId`.
    pub fn register_sender(&self, app_id: &str, tx: UnboundedSender<Outgoing>) {
        let mut inner = self.0.lock().expect("registry mutex poisoned");
        inner.senders.insert(app_id.to_string(), tx);
    }

    /// Removes a sender when its connection ends. Only removes if it's still
    /// the *same* sender — a fresh reconnect under the same `appId` may have
    /// already registered a new one by the time the old connection's cleanup
    /// runs, and unregistering that one instead would strand the new socket.
    pub fn unregister_sender(&self, app_id: &str, tx: &UnboundedSender<Outgoing>) {
        let mut inner = self.0.lock().expect("registry mutex poisoned");
        if let Some(current) = inner.senders.get(app_id) {
            if current.same_channel(tx) {
                inner.senders.remove(app_id);
            }
        }
    }

    /// Queues `text` to be sent down to `app_id`'s live socket. Errs if the
    /// app has no live connection (never connected, disconnected, or the
    /// writer task already exited) — the caller (a Tauri command) surfaces
    /// that as an immediate failure rather than a silent drop.
    pub fn send_to(&self, app_id: &str, text: String) -> Result<(), String> {
        let inner = self.0.lock().expect("registry mutex poisoned");
        match inner.senders.get(app_id) {
            Some(tx) => tx.send(Outgoing::Text(text)).map_err(|_| "app disconnected".to_string()),
            None => Err("app not connected".to_string()),
        }
    }

    pub fn list_apps(&self) -> Vec<AppInfo> {
        let inner = self.0.lock().expect("registry mutex poisoned");
        inner.apps.values().cloned().collect()
    }

    pub fn cached_messages(&self, app_id: &str) -> Vec<Envelope> {
        let inner = self.0.lock().expect("registry mutex poisoned");
        inner
            .cache
            .iter()
            .filter(|((id, _), _)| id == app_id)
            .map(|(_, envelope)| envelope.clone())
            .collect()
    }

    /// Records an incoming envelope. Returns `Some(AppInfo)` when this
    /// message caused a new app to register (i.e. it was a `hello`), so the
    /// caller can emit an `app-connected` event.
    pub fn record(&self, envelope: &Envelope) -> Option<AppInfo> {
        let now = now_ms();
        let mut inner = self.0.lock().expect("registry mutex poisoned");

        let newly_connected = if envelope.kind == "hello" {
            let hello: HelloPayload = serde_json::from_value(envelope.payload.clone()).unwrap_or_default();
            let info = AppInfo {
                app_id: envelope.app_id.clone(),
                app_name: hello.app_name,
                platform: hello.platform,
                framework: hello.framework,
                sdk_version: hello.sdk_version,
                rn_version: hello.rn_version,
                capabilities: hello.capabilities,
                connected_at: now,
                last_seen: now,
                connected: true,
            };
            let is_new = !inner.apps.contains_key(&envelope.app_id);
            inner.apps.insert(envelope.app_id.clone(), info.clone());
            if is_new {
                inner.app_order.push_back(envelope.app_id.clone());
                inner.evict_oldest_app_if_needed();
            }
            Some(info)
        } else {
            if let Some(app) = inner.apps.get_mut(&envelope.app_id) {
                app.last_seen = now;
                app.connected = true;
            }
            None
        };

        let cache_key = (envelope.app_id.clone(), envelope.kind.clone());
        let is_new_cache_key = !inner.cache.contains_key(&cache_key);
        inner.cache.insert(cache_key.clone(), envelope.clone());
        if is_new_cache_key {
            inner.cache_order.push_back(cache_key);
            inner.evict_oldest_cache_entry_if_needed();
        }

        newly_connected
    }

    /// Removes an app and its cached messages entirely, e.g. when the user
    /// dismisses a stale (usually disconnected) entry from the apps bar.
    /// A still-connected app that gets forgotten will simply reappear on its
    /// next message (its next `hello`/heartbeat re-registers it).
    pub fn forget(&self, app_id: &str) {
        let mut inner = self.0.lock().expect("registry mutex poisoned");
        inner.apps.remove(app_id);
        inner.cache.retain(|(id, _), _| id != app_id);
    }

    pub fn mark_disconnected(&self, app_id: &str) -> bool {
        let mut inner = self.0.lock().expect("registry mutex poisoned");
        match inner.apps.get_mut(app_id) {
            Some(app) if app.connected => {
                app.connected = false;
                true
            }
            _ => false,
        }
    }

    /// Sweeps apps whose last heartbeat is older than `timeout_ms` and marks
    /// them disconnected (for sockets that vanish without a clean close —
    /// simulator kill, device sleep, etc). Returns the ids that changed.
    pub fn sweep_stale(&self, timeout_ms: u64) -> Vec<String> {
        let now = now_ms();
        let mut inner = self.0.lock().expect("registry mutex poisoned");
        let mut changed = Vec::new();
        for (id, app) in inner.apps.iter_mut() {
            if app.connected && now.saturating_sub(app.last_seen) > timeout_ms {
                app.connected = false;
                changed.push(id.clone());
            }
        }
        changed
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn send_to_delivers_to_the_registered_sender() {
        let registry = Registry::new();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        registry.register_sender("app-1", tx);

        registry.send_to("app-1", "hello".to_string()).unwrap();

        match rx.recv().await {
            Some(Outgoing::Text(s)) => assert_eq!(s, "hello"),
            other => panic!("expected a Text frame, got {other:?}"),
        }
    }

    #[test]
    fn send_to_an_app_with_no_live_connection_errs() {
        let registry = Registry::new();
        assert!(registry.send_to("ghost", "x".to_string()).is_err());
    }

    #[test]
    fn send_to_after_unregister_errs() {
        let registry = Registry::new();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        registry.register_sender("app-1", tx.clone());
        registry.unregister_sender("app-1", &tx);
        assert!(registry.send_to("app-1", "x".to_string()).is_err());
    }

    /// Guards the exact race `unregister_sender`'s `same_channel` check
    /// exists for: a reconnect registers a fresh sender under the same
    /// `appId` before the old connection's cleanup gets around to
    /// unregistering — that cleanup must not tear down the new connection.
    #[test]
    fn unregister_ignores_a_stale_sender_from_a_since_replaced_connection() {
        let registry = Registry::new();
        let (tx1, _rx1) = tokio::sync::mpsc::unbounded_channel();
        let (tx2, mut rx2) = tokio::sync::mpsc::unbounded_channel();
        registry.register_sender("app-1", tx1.clone());
        registry.register_sender("app-1", tx2); // reconnect replaces it
        registry.unregister_sender("app-1", &tx1); // old connection's cleanup, running late

        registry.send_to("app-1", "still alive".to_string()).unwrap();
        match rx2.try_recv() {
            Ok(Outgoing::Text(s)) => assert_eq!(s, "still alive"),
            other => panic!("expected the new sender to still be registered, got {other:?}"),
        }
    }
}
