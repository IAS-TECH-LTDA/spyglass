// Prevents an extra console window from popping up on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod adb;
mod netinfo;
mod registry;
mod ws_server;

use adb::{get_adb_status, retry_adb_reverse, AdbStatus, AdbStatusHandle};
use netinfo::get_connection_info;
use registry::{AppInfo, Envelope, Registry};

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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the DataMobile desktop app");
}
