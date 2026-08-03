use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

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

/// Loose mirror of `@datamobile/protocol`'s `Envelope<T>`. `payload` is kept
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
}

#[derive(Clone)]
pub struct Registry(Arc<Mutex<RegistryInner>>);

impl Registry {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(RegistryInner {
            apps: HashMap::new(),
            cache: HashMap::new(),
        })))
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
            inner.apps.insert(envelope.app_id.clone(), info.clone());
            Some(info)
        } else {
            if let Some(app) = inner.apps.get_mut(&envelope.app_id) {
                app.last_seen = now;
                app.connected = true;
            }
            None
        };

        inner
            .cache
            .insert((envelope.app_id.clone(), envelope.kind.clone()), envelope.clone());

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
