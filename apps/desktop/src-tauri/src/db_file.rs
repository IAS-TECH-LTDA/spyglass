//! Export/import of a storage engine's backing database file (spec 0015) —
//! the desktop-side half of Storage's "Export .db"/"Import .db" actions.
//! The file dialog itself (picking where to save / which file to open) is a
//! frontend-only concern via `@tauri-apps/plugin-dialog`'s JS API; this
//! module only ever moves bytes once a path has already been chosen.
//!
//! Two backends, matching what `StorageLocation.path` (spec 0013) can
//! actually point at:
//! - Android: the path is inside the app's private data directory on the
//!   device, reachable only via `adb`'s `run-as` (a shell-only escalation —
//!   `adb push`/`pull` themselves can't write/read there directly).
//! - iOS Simulator: the SDK-reported path is already a real path on this
//!   Mac's filesystem, so it's a plain file copy.
//! iOS physical devices aren't supported (no equivalent of `run-as`/a
//! writable-from-outside container) — the frontend simply doesn't offer the
//! action there.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::time::timeout;

use crate::adb::{adb_path_or_err, build_command, is_valid_package, is_valid_serial, run_adb};

/// Longer than `adb.rs`'s own `COMMAND_TIMEOUT` (10s) — a database file can
/// be tens of MB, and `adb push`/`exec-out cat` of that much data over USB
/// can legitimately take longer than a `dumpsys` call.
const FILE_TRANSFER_TIMEOUT: Duration = Duration::from_secs(60);

/// The sibling files that make up a SQLite database's actual on-disk state
/// beyond the main file — in WAL mode, the most recent writes can live only
/// in `-wal` until the next checkpoint, so copying just the main file can
/// silently export a stale snapshot. Realm has no equivalent (its
/// `.lock`/`.management/` are recreated on open, not part of the durable
/// state) — callers for Realm just never find these and that's fine.
const SQLITE_SIBLING_SUFFIXES: [&str; 2] = ["-wal", "-shm"];

fn file_name_of(path: &str) -> Result<String, String> {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| format!("{path} has no file name"))
}

/// Runs `adb` and returns raw stdout bytes — deliberately not `adb.rs`'s own
/// `run_adb`, which lossily converts stdout to UTF-8 (fine for `dumpsys`
/// text, but would corrupt a binary SQLite file).
async fn run_adb_raw(adb_path: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut cmd = build_command(adb_path);
    cmd.args(args);
    let output = timeout(FILE_TRANSFER_TIMEOUT, cmd.output())
        .await
        .map_err(|_| format!("adb {} timed out after {}s", args.join(" "), FILE_TRANSFER_TIMEOUT.as_secs()))?
        .map_err(|err| format!("failed to run adb: {err}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(output.stdout)
}

// ---------------------------------------------------------------------------
// Android
// ---------------------------------------------------------------------------

/// Exports `device_path` (plus any `-wal`/`-shm` siblings that exist) from
/// an Android app's private storage to `dest_dir` on this machine, via `adb
/// exec-out run-as <package> cat <path>`. Returns the file names actually
/// written. A missing sibling is skipped, not an error — most databases
/// aren't mid-transaction when you go to export them.
#[tauri::command]
pub async fn export_db_file_android(serial: String, package: String, device_path: String, dest_dir: String) -> Result<Vec<String>, String> {
    if !is_valid_serial(&serial) {
        return Err("invalid device serial".to_string());
    }
    if !is_valid_package(&package) {
        return Err("invalid package name".to_string());
    }
    let adb_path = adb_path_or_err()?;
    let dest = PathBuf::from(&dest_dir);
    let base_name = file_name_of(&device_path)?;

    let mut exported = Vec::new();
    for suffix in std::iter::once("").chain(SQLITE_SIBLING_SUFFIXES.iter().copied()) {
        let remote_path = format!("{device_path}{suffix}");
        let bytes = match run_adb_raw(&adb_path, &["-s", &serial, "exec-out", "run-as", &package, "cat", &remote_path]).await {
            Ok(b) if !b.is_empty() => b,
            Ok(_) | Err(_) if !suffix.is_empty() => continue, // sibling doesn't exist — fine
            Ok(_) => return Err(format!("{remote_path} is empty or doesn't exist on the device")),
            Err(err) => return Err(err),
        };
        let file_name = format!("{base_name}{suffix}");
        std::fs::write(dest.join(&file_name), &bytes).map_err(|e| format!("failed to write {file_name}: {e}"))?;
        exported.push(file_name);
    }
    Ok(exported)
}

/// Imports `local_path` (plus any `-wal`/`-shm` siblings sitting next to it
/// on disk) onto an Android device at `device_path`, via `adb push` to a
/// world-readable tmp location followed by `run-as cp` into the app's
/// private storage — `adb push` alone can't write there directly, the same
/// reason export needs `run-as cat` rather than `adb pull`. Removes a
/// device-side `-wal`/`-shm` that has no matching local sibling, so a stale
/// WAL can't silently override the just-imported main file the next time
/// the app opens the database.
#[tauri::command]
pub async fn import_db_file_android(serial: String, package: String, local_path: String, device_path: String) -> Result<(), String> {
    if !is_valid_serial(&serial) {
        return Err("invalid device serial".to_string());
    }
    if !is_valid_package(&package) {
        return Err("invalid package name".to_string());
    }
    let adb_path = adb_path_or_err()?;
    let local = PathBuf::from(&local_path);
    let base_name = file_name_of(&local_path)?;
    let dir = local.parent().ok_or_else(|| format!("{local_path} has no parent directory"))?;

    for suffix in std::iter::once("").chain(SQLITE_SIBLING_SUFFIXES.iter().copied()) {
        let sibling_local = dir.join(format!("{base_name}{suffix}"));
        let remote_path = format!("{device_path}{suffix}");
        if sibling_local.exists() {
            push_and_place_android(&adb_path, &serial, &package, &sibling_local, &remote_path).await?;
        } else if !suffix.is_empty() {
            // Best-effort cleanup — a device that never had this sibling
            // just no-ops here, which is why the result isn't checked.
            let _ = run_adb(&adb_path, &["-s", &serial, "shell", "run-as", &package, "rm", "-f", &remote_path]).await;
        }
    }
    Ok(())
}

async fn push_and_place_android(adb_path: &Path, serial: &str, package: &str, local: &Path, remote_path: &str) -> Result<(), String> {
    let local_str = local.to_string_lossy().to_string();
    let tmp_name = local.file_name().ok_or_else(|| "local path has no file name".to_string())?.to_string_lossy().to_string();
    let tmp_remote = format!("/data/local/tmp/spyglass-import-{tmp_name}");

    let mut push_cmd = build_command(adb_path);
    push_cmd.args(["-s", serial, "push", &local_str, &tmp_remote]);
    let push_output = timeout(FILE_TRANSFER_TIMEOUT, push_cmd.output())
        .await
        .map_err(|_| "adb push timed out".to_string())?
        .map_err(|e| format!("failed to run adb push: {e}"))?;
    if !push_output.status.success() {
        return Err(format!("adb push failed: {}", String::from_utf8_lossy(&push_output.stderr).trim()));
    }

    let cp_result = run_adb(adb_path, &["-s", serial, "shell", "run-as", package, "cp", &tmp_remote, remote_path]).await;
    // Clean up the world-readable tmp copy regardless of whether the cp
    // into the app's private storage succeeded — it must never linger.
    let _ = run_adb(adb_path, &["-s", serial, "shell", "rm", "-f", &tmp_remote]).await;
    cp_result.map(|_| ())
}

// ---------------------------------------------------------------------------
// iOS Simulator
// ---------------------------------------------------------------------------

/// `StorageLocation.path` for an app running in the iOS Simulator is
/// already a real path on this Mac (the Simulator's container lives on the
/// host filesystem) — no device boundary to cross, so this is a plain file
/// copy. Same sibling handling as the Android path.
#[tauri::command]
pub async fn export_db_file_ios_simulator(device_path: String, dest_dir: String) -> Result<Vec<String>, String> {
    let dest = PathBuf::from(&dest_dir);
    let src = PathBuf::from(&device_path);
    let base_name = file_name_of(&device_path)?;

    let mut exported = Vec::new();
    for suffix in std::iter::once("").chain(SQLITE_SIBLING_SUFFIXES.iter().copied()) {
        let sibling_src = src.with_file_name(format!("{base_name}{suffix}"));
        match std::fs::copy(&sibling_src, dest.join(format!("{base_name}{suffix}"))) {
            Ok(_) => exported.push(format!("{base_name}{suffix}")),
            Err(e) if e.kind() == ErrorKind::NotFound && !suffix.is_empty() => continue, // sibling doesn't exist — fine
            Err(e) => return Err(format!("failed to copy {}: {e}", sibling_src.display())),
        }
    }
    Ok(exported)
}

#[tauri::command]
pub async fn import_db_file_ios_simulator(local_path: String, device_path: String) -> Result<(), String> {
    let local = PathBuf::from(&local_path);
    let base_name = file_name_of(&local_path)?;
    let dir = local.parent().ok_or_else(|| format!("{local_path} has no parent directory"))?;
    let dest = PathBuf::from(&device_path);

    for suffix in std::iter::once("").chain(SQLITE_SIBLING_SUFFIXES.iter().copied()) {
        let sibling_local = dir.join(format!("{base_name}{suffix}"));
        let sibling_dest = dest.with_file_name(format!("{base_name}{suffix}"));
        if sibling_local.exists() {
            std::fs::copy(&sibling_local, &sibling_dest).map_err(|e| format!("failed to copy {}: {e}", sibling_local.display()))?;
        } else if !suffix.is_empty() && sibling_dest.exists() {
            // No local -wal/-shm to import — remove the device-side one so
            // it can't shadow the freshly imported main file.
            std::fs::remove_file(&sibling_dest).map_err(|e| format!("failed to remove stale {}: {e}", sibling_dest.display()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_name_of_extracts_the_basename() {
        assert_eq!(file_name_of("/data/data/com.my.app/databases/app.db").unwrap(), "app.db");
    }

    #[test]
    fn file_name_of_rejects_a_path_with_no_file_name() {
        assert!(file_name_of("/").is_err());
    }

    #[test]
    fn sibling_suffixes_append_directly_after_the_full_file_name() {
        // SQLite's own convention: "app.db" -> "app.db-wal"/"app.db-shm",
        // not "app-wal.db" — guards against ever "fixing" this into
        // splitting the extension first.
        let device_path = "/data/data/com.my.app/databases/app.db";
        let with_suffix = format!("{device_path}{}", SQLITE_SIBLING_SUFFIXES[0]);
        assert_eq!(with_suffix, "/data/data/com.my.app/databases/app.db-wal");
    }

    #[tokio::test]
    async fn export_db_file_android_rejects_an_invalid_serial_before_touching_adb() {
        let result = export_db_file_android("-x".to_string(), "com.my.app".to_string(), "/x".to_string(), "/tmp".to_string()).await;
        assert_eq!(result, Err("invalid device serial".to_string()));
    }

    #[tokio::test]
    async fn export_db_file_android_rejects_an_invalid_package_before_touching_adb() {
        let result = export_db_file_android("emulator-5554".to_string(), "-x".to_string(), "/x".to_string(), "/tmp".to_string()).await;
        assert_eq!(result, Err("invalid package name".to_string()));
    }

    #[tokio::test]
    async fn import_db_file_android_rejects_an_invalid_serial_before_touching_adb() {
        let result = import_db_file_android("-x".to_string(), "com.my.app".to_string(), "/tmp/app.db".to_string(), "/x".to_string()).await;
        assert_eq!(result, Err("invalid device serial".to_string()));
    }

    #[tokio::test]
    async fn export_db_file_ios_simulator_exports_the_main_file_and_a_present_sibling_but_skips_a_missing_one() {
        let src_dir = std::env::temp_dir().join(format!("spyglass-test-src-{}", std::process::id()));
        let dest_dir = std::env::temp_dir().join(format!("spyglass-test-dest-{}", std::process::id()));
        std::fs::create_dir_all(&src_dir).unwrap();
        std::fs::create_dir_all(&dest_dir).unwrap();
        let db_path = src_dir.join("app.db");
        std::fs::write(&db_path, b"main-db-bytes").unwrap();
        std::fs::write(src_dir.join("app.db-wal"), b"wal-bytes").unwrap();
        // Deliberately no "app.db-shm" — proves the missing sibling is skipped, not an error.

        let exported = export_db_file_ios_simulator(db_path.to_string_lossy().to_string(), dest_dir.to_string_lossy().to_string())
            .await
            .unwrap();

        assert_eq!(exported, vec!["app.db".to_string(), "app.db-wal".to_string()]);
        assert_eq!(std::fs::read(dest_dir.join("app.db")).unwrap(), b"main-db-bytes");
        assert_eq!(std::fs::read(dest_dir.join("app.db-wal")).unwrap(), b"wal-bytes");
        assert!(!dest_dir.join("app.db-shm").exists());

        std::fs::remove_dir_all(&src_dir).ok();
        std::fs::remove_dir_all(&dest_dir).ok();
    }

    #[tokio::test]
    async fn import_db_file_ios_simulator_removes_a_stale_device_side_wal_with_no_local_counterpart() {
        let local_dir = std::env::temp_dir().join(format!("spyglass-test-local-{}", std::process::id()));
        let device_dir = std::env::temp_dir().join(format!("spyglass-test-device-{}", std::process::id()));
        std::fs::create_dir_all(&local_dir).unwrap();
        std::fs::create_dir_all(&device_dir).unwrap();
        std::fs::write(local_dir.join("app.db"), b"new-main-bytes").unwrap();
        // No local "app.db-wal" — a stale one already on the "device" must be removed.
        std::fs::write(device_dir.join("app.db-wal"), b"stale-wal-bytes").unwrap();

        import_db_file_ios_simulator(
            local_dir.join("app.db").to_string_lossy().to_string(),
            device_dir.join("app.db").to_string_lossy().to_string(),
        )
        .await
        .unwrap();

        assert_eq!(std::fs::read(device_dir.join("app.db")).unwrap(), b"new-main-bytes");
        assert!(!device_dir.join("app.db-wal").exists(), "stale WAL must be removed, or it would shadow the freshly imported main file");

        std::fs::remove_dir_all(&local_dir).ok();
        std::fs::remove_dir_all(&device_dir).ok();
    }
}
