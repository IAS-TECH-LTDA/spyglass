use std::env;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use tokio::time::timeout;

use crate::ws_server;

const REVERSE_PORT: u16 = ws_server::PORT;
/// How often the watcher re-checks and re-applies `adb reverse` once adb has
/// been found at least once.
const POLL_INTERVAL_FOUND: Duration = Duration::from_secs(10);
/// Slower backoff while adb hasn't been located yet, or was explicitly
/// disabled — no point re-stat-ing the filesystem every 10s for something
/// that isn't going to change on its own.
const POLL_INTERVAL_MISSING: Duration = Duration::from_secs(60);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AdbDevice {
    pub serial: String,
    /// Raw state as reported by `adb devices` — `"device"`, `"offline"`,
    /// `"unauthorized"`, `"no permissions"`, etc.
    pub state: String,
    pub reversed: bool,
    pub error: Option<String>,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AdbStatus {
    /// `"searching" | "unavailable" | "no-devices" | "ok" | "partial" | "error"`
    pub state: String,
    pub adb_path: Option<String>,
    pub devices: Vec<AdbDevice>,
    pub port: u16,
    pub message: Option<String>,
    pub checked_at: u64,
}

impl Default for AdbStatus {
    fn default() -> Self {
        AdbStatus {
            state: "searching".to_string(),
            adb_path: None,
            devices: Vec::new(),
            port: REVERSE_PORT,
            message: None,
            checked_at: now_ms(),
        }
    }
}

/// Shared with the rest of the app via `.manage()`, same pattern as
/// `Registry`. Plain `Arc<Mutex<_>>` rather than a `Registry`-style newtype
/// since this has no methods of its own beyond read/replace.
pub type AdbStatusHandle = Arc<Mutex<AdbStatus>>;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Serials come from adb's own stdout, and every command here is argv-only
/// (never a shell), so this is defense in depth rather than the only thing
/// standing between adb's output and a spawned process.
fn is_valid_serial(serial: &str) -> bool {
    !serial.is_empty() && serial.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
}

#[cfg(windows)]
fn adb_binary_name() -> &'static str {
    "adb.exe"
}

#[cfg(not(windows))]
fn adb_binary_name() -> &'static str {
    "adb"
}

fn is_executable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).map(|m| m.permissions().mode() & 0o111 != 0).unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn well_known_sdk_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(home) = env::var_os("HOME") {
        let home = PathBuf::from(home);
        paths.push(home.join("Library/Android/sdk/platform-tools").join(adb_binary_name())); // macOS
        paths.push(home.join("Android/Sdk/platform-tools").join(adb_binary_name())); // Linux
    }
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        paths.push(PathBuf::from(local_app_data).join("Android/Sdk/platform-tools").join(adb_binary_name()));
        // Windows
    }
    paths
}

/// Locates `adb`, preferring explicit configuration and well-known Android
/// SDK locations over a bare `PATH` scan. This order is deliberate: a macOS
/// app launched from Finder/`open` does **not** inherit the user's shell
/// `PATH` or a shell-exported `ANDROID_HOME` — searching `PATH` first would
/// work perfectly under `pnpm dev:desktop` (launched from a terminal) and
/// silently fail for most people running the bundled app, which is the
/// worst possible failure mode for a feature meant to "just work".
fn find_adb() -> Option<PathBuf> {
    if let Ok(path) = env::var("DATAMOBILE_ADB_PATH") {
        let path = PathBuf::from(path);
        if is_executable_file(&path) {
            return Some(path);
        }
    }

    for var in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Ok(sdk) = env::var(var) {
            let candidate = PathBuf::from(sdk).join("platform-tools").join(adb_binary_name());
            if is_executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }

    if let Ok(path_var) = env::var("PATH") {
        for dir in env::split_paths(&path_var) {
            let candidate = dir.join(adb_binary_name());
            if is_executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }

    well_known_sdk_paths().into_iter().find(|candidate| is_executable_file(candidate))
}

fn build_command(adb_path: &Path) -> Command {
    let mut cmd = Command::new(adb_path);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd
}

/// Runs `adb` with argv-only arguments (never a shell) under a hard timeout
/// with a kill on expiry — adb's very first invocation implicitly forks its
/// background daemon and can take a few seconds, and a hung `adb` process
/// must never wedge the watcher loop.
async fn run_adb(adb_path: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = build_command(adb_path);
    cmd.args(args);
    let child = cmd.output();
    let output = timeout(COMMAND_TIMEOUT, child)
        .await
        .map_err(|_| format!("adb {} timed out after {}s", args.join(" "), COMMAND_TIMEOUT.as_secs()))?
        .map_err(|err| format!("failed to run adb: {err}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Parses `adb devices` output into `(serial, state)` pairs, skipping the
/// `List of devices attached` header and any daemon-startup noise (e.g.
/// `* daemon started successfully *`) adb prints to stdout on a cold start.
fn parse_devices_output(output: &str) -> Vec<(String, String)> {
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('*') || line.starts_with("List of devices") {
                return None;
            }
            let mut parts = line.split_whitespace();
            let serial = parts.next()?;
            let state = parts.next()?;
            Some((serial.to_string(), state.to_string()))
        })
        .collect()
}

/// Always scoped with `-s <serial>`, which dissolves the "multiple devices
/// attached" problem entirely — every online device gets the reverse
/// applied individually, with no `error: more than one device` branch to
/// handle.
async fn apply_reverse(adb_path: &Path, serial: &str) -> Result<(), String> {
    if !is_valid_serial(serial) {
        return Err("invalid device serial".to_string());
    }
    let port_arg = format!("tcp:{REVERSE_PORT}");
    run_adb(adb_path, &["-s", serial, "reverse", &port_arg, &port_arg]).await.map(|_| ())
}

/// All fields except `checked_at` — a fresh timestamp every tick would
/// otherwise make every tick "different", defeating the point of only
/// emitting `adb-status` when something a human cares about actually
/// changed.
fn meaningfully_changed(previous: &AdbStatus, next: &AdbStatus) -> bool {
    previous.state != next.state
        || previous.adb_path != next.adb_path
        || previous.devices != next.devices
        || previous.port != next.port
        || previous.message != next.message
}

fn set_status(status: &AdbStatusHandle, app_handle: &AppHandle, next: AdbStatus) -> bool {
    let found = next.adb_path.is_some();
    let snapshot = {
        let mut guard = status.lock().expect("adb status mutex poisoned");
        let changed = meaningfully_changed(&guard, &next);
        *guard = next;
        if changed { Some(guard.clone()) } else { None }
    };
    if let Some(snapshot) = snapshot {
        let _ = app_handle.emit("adb-status", &snapshot);
    }
    found
}

/// One discovery + list + reverse-apply cycle. Returns whether adb was
/// found, so the caller can decide how long to wait before the next tick.
async fn tick(status: &AdbStatusHandle, app_handle: &AppHandle) -> bool {
    if env::var("DATAMOBILE_DISABLE_ADB").is_ok() {
        return set_status(
            status,
            app_handle,
            AdbStatus {
                state: "unavailable".to_string(),
                message: Some("Auto `adb reverse` disabled via DATAMOBILE_DISABLE_ADB.".to_string()),
                ..AdbStatus::default()
            },
        );
    }

    let Some(adb_path) = find_adb() else {
        return set_status(
            status,
            app_handle,
            AdbStatus {
                state: "unavailable".to_string(),
                message: Some(
                    "adb not found — looked in $DATAMOBILE_ADB_PATH, $ANDROID_HOME, $ANDROID_SDK_ROOT, PATH, \
                     and the default SDK install location. Set $DATAMOBILE_ADB_PATH or run \
                     `adb reverse tcp:8098 tcp:8098` yourself."
                        .to_string(),
                ),
                ..AdbStatus::default()
            },
        );
    };
    let adb_path_str = adb_path.display().to_string();

    let raw_devices = match run_adb(&adb_path, &["devices"]).await {
        Ok(output) => parse_devices_output(&output),
        Err(err) => {
            return set_status(
                status,
                app_handle,
                AdbStatus {
                    state: "error".to_string(),
                    adb_path: Some(adb_path_str),
                    message: Some(err),
                    ..AdbStatus::default()
                },
            );
        }
    };

    if raw_devices.is_empty() {
        return set_status(
            status,
            app_handle,
            AdbStatus { state: "no-devices".to_string(), adb_path: Some(adb_path_str), ..AdbStatus::default() },
        );
    }

    let mut devices = Vec::with_capacity(raw_devices.len());
    for (serial, state) in raw_devices {
        if state != "device" {
            devices.push(AdbDevice {
                serial,
                state,
                reversed: false,
                error: Some("device not ready — check for an unlocked screen or a USB-debugging prompt".to_string()),
            });
            continue;
        }
        match apply_reverse(&adb_path, &serial).await {
            Ok(()) => devices.push(AdbDevice { serial, state, reversed: true, error: None }),
            Err(err) => devices.push(AdbDevice { serial, state, reversed: false, error: Some(err) }),
        }
    }

    let all_ok = devices.iter().all(|d| d.reversed);
    let any_ok = devices.iter().any(|d| d.reversed);
    let overall_state = if all_ok { "ok" } else if any_ok { "partial" } else { "error" };

    set_status(
        status,
        app_handle,
        AdbStatus { state: overall_state.to_string(), adb_path: Some(adb_path_str), devices, ..AdbStatus::default() },
    )
}

/// Runs forever, re-applying `adb reverse` to every online device on each
/// tick — unconditionally, not just when the device set changes. The
/// reverse silently drops on device reboot, cable re-plug, `adb
/// kill-server`, or an adb daemon version bump, all cases where the
/// *device set* looks unchanged to us; re-applying is idempotent and costs
/// a local socket round-trip, so there's no reason not to just always do it.
/// Spawned once from `main.rs`'s `setup`, alongside `ws_server::run`.
pub async fn run(app_handle: AppHandle, status: AdbStatusHandle) {
    loop {
        let found = tick(&status, &app_handle).await;
        let interval = if found { POLL_INTERVAL_FOUND } else { POLL_INTERVAL_MISSING };
        tokio::time::sleep(interval).await;
    }
}

#[tauri::command]
pub fn get_adb_status(status: tauri::State<AdbStatusHandle>) -> AdbStatus {
    status.lock().expect("adb status mutex poisoned").clone()
}

/// Forces an immediate tick — covers both "the previous attempt failed" and
/// "I just plugged in a device and don't want to wait for the next poll".
#[tauri::command]
pub async fn retry_adb_reverse(app_handle: AppHandle, status: tauri::State<'_, AdbStatusHandle>) -> Result<AdbStatus, ()> {
    let status = status.inner().clone();
    tick(&status, &app_handle).await;
    let snapshot = status.lock().expect("adb status mutex poisoned").clone();
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_single_ready_device() {
        let output = "List of devices attached\nemulator-5554\tdevice\n";
        assert_eq!(parse_devices_output(output), vec![("emulator-5554".to_string(), "device".to_string())]);
    }

    #[test]
    fn parses_empty_output() {
        assert_eq!(parse_devices_output("List of devices attached\n\n"), Vec::<(String, String)>::new());
        assert_eq!(parse_devices_output(""), Vec::<(String, String)>::new());
    }

    #[test]
    fn parses_mixed_offline_and_unauthorized_devices() {
        let output = "List of devices attached\nemulator-5554\tdevice\nRF8N1234\tunauthorized\n0123456789ABCDEF\toffline\n";
        assert_eq!(
            parse_devices_output(output),
            vec![
                ("emulator-5554".to_string(), "device".to_string()),
                ("RF8N1234".to_string(), "unauthorized".to_string()),
                ("0123456789ABCDEF".to_string(), "offline".to_string()),
            ]
        );
    }

    #[test]
    fn skips_daemon_startup_noise() {
        let output = "* daemon not running; starting now at tcp:5037\n* daemon started successfully *\nList of devices attached\nemulator-5554\tdevice\n";
        assert_eq!(parse_devices_output(output), vec![("emulator-5554".to_string(), "device".to_string())]);
    }

    #[test]
    fn rejects_malicious_or_malformed_serials() {
        assert!(!is_valid_serial("; rm -rf /"));
        assert!(!is_valid_serial(""));
        assert!(!is_valid_serial("serial with spaces"));
        assert!(!is_valid_serial("$(whoami)"));
    }

    #[test]
    fn accepts_realistic_serials() {
        assert!(is_valid_serial("emulator-5554"));
        assert!(is_valid_serial("RF8N1234ABC"));
        assert!(is_valid_serial("0123456789ABCDEF"));
        assert!(is_valid_serial("192.168.1.5:5555")); // adb-over-wifi serial
    }

    #[test]
    fn meaningfully_changed_ignores_the_timestamp() {
        let a = AdbStatus { checked_at: 1, ..AdbStatus::default() };
        let b = AdbStatus { checked_at: 2, ..AdbStatus::default() };
        assert!(!meaningfully_changed(&a, &b));

        let c = AdbStatus { checked_at: 2, state: "ok".to_string(), ..AdbStatus::default() };
        assert!(meaningfully_changed(&a, &c));
    }
}
