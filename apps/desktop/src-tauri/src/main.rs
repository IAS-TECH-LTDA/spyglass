// Prevents an extra console window from popping up on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod adb;
#[cfg(target_os = "macos")]
mod ios_memory;
mod netinfo;
mod registry;
mod ws_server;

use adb::{
    get_adb_status, list_third_party_packages, read_app_memory, read_system_memory, retry_adb_reverse,
    suggest_foreground_package, AdbStatus, AdbStatusHandle,
};
#[cfg(target_os = "macos")]
use ios_memory::{find_simulator_pid, list_booted_simulators, read_simulator_memory};
use netinfo::get_connection_info;
use registry::{AppInfo, Envelope, Registry};
use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

#[tauri::command]
fn list_apps(registry: tauri::State<Registry>) -> Vec<AppInfo> {
    registry.list_apps()
}

#[tauri::command]
fn get_cached_messages(registry: tauri::State<Registry>, app_id: String) -> Vec<Envelope> {
    registry.cached_messages(&app_id)
}

#[tauri::command]
fn forget_app(registry: tauri::State<Registry>, app_id: String) {
    registry.forget(&app_id);
}

/// Sends one envelope down to a connected app's live socket (spec 0007).
/// Generic rather than e.g. `send_storage_write(app_id, engine, key, value)`
/// on purpose — the registry/this command layer deliberately never learns
/// the shape of any payload (see `Envelope`'s own doc comment); a
/// storage-specific command would be the first place Rust hand-mirrors a
/// payload shape for no benefit. Tauri commands are only reachable from this
/// app's own webview, not the LAN, so genericity here doesn't widen any
/// network-facing surface — the real gate is the SDK's dev-only check on
/// the receiving end.
#[tauri::command]
fn send_to_app(registry: tauri::State<Registry>, envelope: Envelope) -> Result<(), String> {
    let text = serde_json::to_string(&envelope).map_err(|e| e.to_string())?;
    registry.send_to(&envelope.app_id, text)
}

fn main() {
    let registry = Registry::new();
    let adb_status: AdbStatusHandle = std::sync::Arc::new(std::sync::Mutex::new(AdbStatus::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(registry.clone())
        .manage(adb_status.clone())
        .invoke_handler(tauri::generate_handler![
            list_apps,
            get_cached_messages,
            forget_app,
            send_to_app,
            get_connection_info,
            get_adb_status,
            retry_adb_reverse,
            // spec 0008 — Android memory, on-demand (see adb.rs's "Android
            // memory" section doc comment for why these don't share the
            // always-on `adb reverse` watcher above).
            list_third_party_packages,
            suggest_foreground_package,
            read_system_memory,
            read_app_memory,
            // spec 0008 — iOS Simulator memory. macOS-only: `footprint`/
            // `pgrep`/`xcrun simctl` are macOS binaries, so these commands
            // (and the whole ios_memory module) don't exist on other hosts.
            #[cfg(target_os = "macos")]
            list_booted_simulators,
            #[cfg(target_os = "macos")]
            find_simulator_pid,
            #[cfg(target_os = "macos")]
            read_simulator_memory
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(ws_server::run(app_handle.clone(), registry.clone()));
            tauri::async_runtime::spawn(adb::run(app_handle, adb_status.clone()));

            // Menu bar icon, present for the app's whole lifetime once it's
            // opened — a monochrome "template" image (brand/logo-mark-mono.svg,
            // rasterized) so macOS tints it correctly for light/dark menu bars.
            // Left-click brings the main window to front; there's no menu here
            // since nothing beyond that was asked for.
            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
            let tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .icon_as_template(true)
                .tooltip("Spyglass")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            // Must stay alive for the app's lifetime — .build() returns an
            // owned handle, and dropping it at the end of this closure would
            // tear the tray icon back down the instant setup() returns.
            app.manage(tray);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Spyglass desktop app");
}
