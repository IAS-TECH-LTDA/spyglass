// Prevents an extra console window from popping up on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod adb;
mod netinfo;
mod registry;
mod ws_server;

use adb::{get_adb_status, retry_adb_reverse, AdbStatus, AdbStatusHandle};
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

fn main() {
    let registry = Registry::new();
    let adb_status: AdbStatusHandle = std::sync::Arc::new(std::sync::Mutex::new(AdbStatus::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(registry.clone())
        .manage(adb_status.clone())
        .invoke_handler(tauri::generate_handler![
            list_apps,
            get_cached_messages,
            forget_app,
            get_connection_info,
            get_adb_status,
            retry_adb_reverse
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
