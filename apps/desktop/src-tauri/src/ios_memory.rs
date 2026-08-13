//! iOS Simulator memory (spec 0008) — macOS-only, on-demand. A Simulator
//! "app" is literally a regular macOS process, so this reads it the same
//! way any macOS process-inspection tool would: `xcrun simctl` to find the
//! booted Simulator, `pgrep` to find the process, `/usr/bin/footprint` (a
//! binary shipped with macOS itself, not bundled inside Xcode.app — no
//! sudo needed) to read its `phys_footprint`. No connection to physical
//! iOS devices — see spec 0008's "Fora de escopo" for why that's a dead
//! end for a lightweight polling architecture like this one.
//!
//! Same argv-only, never-a-shell, hard-timeout shape as `adb.rs`'s
//! `run_adb`, deliberately not shared code with it — the two have
//! different exit-code semantics (`pgrep` exits 1 on "no match", which is
//! a normal `Ok(None)` here, not an error) that would make a single
//! generic runner more confusing than two small ones.

#![cfg(target_os = "macos")]

use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::process::Command;
use tokio::time::timeout;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(10);

fn is_valid_udid(udid: &str) -> bool {
    !udid.is_empty() && udid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Loose on purpose — an app's display name can contain spaces, and a
/// bundle id is dot-separated — but still rejects anything that could be
/// read as a shell metacharacter or a `pgrep` flag, same defense-in-depth
/// reasoning as `adb.rs`'s `is_valid_serial`/`is_valid_package` (every call
/// here is argv-only, never a shell, so this isn't the only thing standing
/// between user input and the spawned process).
fn is_valid_identifier(s: &str) -> bool {
    !s.is_empty() && !s.starts_with('-') && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ' '))
}

async fn run(program: &str, args: &[&str]) -> Result<std::process::Output, String> {
    let mut cmd = Command::new(program);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    timeout(COMMAND_TIMEOUT, cmd.output())
        .await
        .map_err(|_| format!("{program} {} timed out after {}s", args.join(" "), COMMAND_TIMEOUT.as_secs()))?
        .map_err(|err| format!("failed to run {program}: {err}"))
}

/// Runs a command expecting a normal 0 exit — anything else is an error.
async fn run_ok(program: &str, args: &[&str]) -> Result<String, String> {
    let output = run(program, args).await?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimulatorInfo {
    pub udid: String,
    pub name: String,
}

/// Parses `xcrun simctl list devices booted -j`'s JSON — structured output,
/// unlike `adb`'s text formats, so no version-drift parsing concerns here.
/// Re-checks `state == "Booted"` even though the `booted` filter already
/// asked for that — defense in depth, cheap, and covers a hypothetical
/// future `simctl` flag behavior change.
fn parse_booted_simulators(json: &str) -> Vec<SimulatorInfo> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else { return Vec::new() };
    let Some(devices) = value.get("devices").and_then(|d| d.as_object()) else { return Vec::new() };

    let mut result = Vec::new();
    for list in devices.values() {
        let Some(arr) = list.as_array() else { continue };
        for entry in arr {
            if entry.get("state").and_then(|s| s.as_str()) != Some("Booted") {
                continue;
            }
            let udid = entry.get("udid").and_then(|s| s.as_str()).unwrap_or("").to_string();
            if udid.is_empty() {
                continue;
            }
            let name = entry.get("name").and_then(|s| s.as_str()).unwrap_or("").to_string();
            result.push(SimulatorInfo { udid, name });
        }
    }
    result
}

#[tauri::command]
pub async fn list_booted_simulators() -> Result<Vec<SimulatorInfo>, String> {
    let output = run_ok("xcrun", &["simctl", "list", "devices", "booted", "-j"]).await?;
    Ok(parse_booted_simulators(&output))
}

fn parse_first_pid(output: &str) -> Option<u32> {
    output.lines().next()?.trim().parse().ok()
}

/// `bundle_or_name` should be the app's `.app` bundle folder name (e.g. an
/// app named "MyApp" ships as `MyApp.app`) — matching Android's "user
/// supplies/confirms the identifier" approach (spec 0008) rather than
/// trying to resolve a bundle id to a folder name automatically, which
/// would need parsing `simctl listapps`'s old-style plist text output for
/// a benefit this v1 doesn't need.
#[tauri::command]
pub async fn find_simulator_pid(udid: String, bundle_or_name: String) -> Result<Option<u32>, String> {
    if !is_valid_udid(&udid) {
        return Err("invalid simulator udid".to_string());
    }
    if !is_valid_identifier(&bundle_or_name) {
        return Err("invalid app identifier".to_string());
    }
    // pgrep -f matches the full command line; the Simulator's bundle path
    // always nests the UDID before the app name, so requiring both in that
    // order is precise enough without needing a stricter regex anchor.
    let pattern = format!("CoreSimulator/Devices/{udid}/data/Containers/Bundle/Application/.*/{bundle_or_name}.app/{bundle_or_name}");
    let output = run("pgrep", &["-f", &pattern]).await?;
    // pgrep exits 1 (not an error condition) when nothing matches — unlike
    // adb/footprint below, that's an expected "not running right now" case,
    // not a failure to surface to the user.
    if !output.status.success() && !output.stdout.is_empty() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(parse_first_pid(&String::from_utf8_lossy(&output.stdout)))
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimulatorMemoryInfo {
    pub phys_footprint_bytes: Option<u64>,
    pub phys_footprint_peak_bytes: Option<u64>,
}

/// `footprint`'s human-readable output looks like:
/// ```text
/// Auxiliary data:
///     phys_footprint: 260 MB
///     phys_footprint_peak: 451 MB
/// ```
/// Requesting `-f bytes` should give bare integers instead of "260 MB", but
/// this parses both shapes defensively (unit suffix optional, 1024-based if
/// present) since the exact behavior of `-f bytes` combined with
/// `--noCategories` wasn't independently re-verified beyond the default
/// human-formatted capture in spec 0008's research.
fn parse_footprint_output(output: &str) -> SimulatorMemoryInfo {
    SimulatorMemoryInfo {
        phys_footprint_bytes: extract_footprint_field(output, "phys_footprint:"),
        phys_footprint_peak_bytes: extract_footprint_field(output, "phys_footprint_peak:"),
    }
}

fn extract_footprint_field(text: &str, label: &str) -> Option<u64> {
    let idx = text.find(label)?;
    let rest = text[idx + label.len()..].trim_start();
    let mut tokens = rest.split_whitespace();
    let number: f64 = tokens.next()?.parse().ok()?;
    let multiplier = match tokens.next() {
        Some("KB") => 1024.0,
        Some("MB") => 1024.0 * 1024.0,
        Some("GB") => 1024.0 * 1024.0 * 1024.0,
        _ => 1.0, // "bytes", or no unit at all (the `-f bytes` case)
    };
    Some((number * multiplier) as u64)
}

#[tauri::command]
pub async fn read_simulator_memory(pid: u32) -> Result<SimulatorMemoryInfo, String> {
    let pid_str = pid.to_string();
    let output = run_ok("/usr/bin/footprint", &["--noCategories", "-f", "bytes", "-p", &pid_str]).await?;
    Ok(parse_footprint_output(&output))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_malicious_or_malformed_udids() {
        assert!(!is_valid_udid(""));
        assert!(!is_valid_udid("; rm -rf /"));
        assert!(!is_valid_udid("$(whoami)"));
    }

    #[test]
    fn accepts_realistic_udids() {
        assert!(is_valid_udid("A1B2C3D4-1234-5678-9ABC-DEF012345678"));
    }

    #[test]
    fn rejects_malicious_identifiers() {
        assert!(!is_valid_identifier(""));
        assert!(!is_valid_identifier("-rf"));
        assert!(!is_valid_identifier("MyApp; rm -rf /"));
    }

    #[test]
    fn accepts_realistic_identifiers() {
        assert!(is_valid_identifier("MyApp"));
        assert!(is_valid_identifier("com.example.myapp"));
        assert!(is_valid_identifier("My Cool App"));
    }

    #[test]
    fn parses_a_single_booted_simulator() {
        let json = r#"{
            "devices": {
                "com.apple.CoreSimulator.SimRuntime.iOS-17-4": [
                    {
                        "udid": "A1B2C3D4-1234-5678-9ABC-DEF012345678",
                        "name": "iPhone 15",
                        "state": "Booted"
                    },
                    {
                        "udid": "00000000-0000-0000-0000-000000000000",
                        "name": "iPhone 14",
                        "state": "Shutdown"
                    }
                ]
            }
        }"#;
        assert_eq!(
            parse_booted_simulators(json),
            vec![SimulatorInfo { udid: "A1B2C3D4-1234-5678-9ABC-DEF012345678".to_string(), name: "iPhone 15".to_string() }]
        );
    }

    #[test]
    fn parses_no_booted_simulators() {
        let json = r#"{"devices": {}}"#;
        assert_eq!(parse_booted_simulators(json), Vec::<SimulatorInfo>::new());
    }

    #[test]
    fn returns_empty_on_malformed_json() {
        assert_eq!(parse_booted_simulators("not json at all"), Vec::<SimulatorInfo>::new());
    }

    #[test]
    fn parses_first_pid_from_pgrep_output() {
        assert_eq!(parse_first_pid("5796\n"), Some(5796));
        assert_eq!(parse_first_pid("5796\n7200\n"), Some(5796)); // multiple matches — first wins, documented limitation
        assert_eq!(parse_first_pid(""), None);
        assert_eq!(parse_first_pid("not a pid"), None);
    }

    // Captured live from `/usr/bin/footprint` in spec 0008's research
    // (default human-formatted output, no --noCategories/-f bytes).
    #[test]
    fn parses_human_formatted_footprint_output() {
        let output = "Auxiliary data:\n    phys_footprint: 260 MB\n    phys_footprint_peak: 451 MB\n";
        let info = parse_footprint_output(output);
        assert_eq!(info.phys_footprint_bytes, Some(260 * 1024 * 1024));
        assert_eq!(info.phys_footprint_peak_bytes, Some(451 * 1024 * 1024));
    }

    #[test]
    fn parses_bare_byte_footprint_output() {
        let output = "Auxiliary data:\n    phys_footprint: 272629760\n    phys_footprint_peak: 472842240\n";
        let info = parse_footprint_output(output);
        assert_eq!(info.phys_footprint_bytes, Some(272629760));
        assert_eq!(info.phys_footprint_peak_bytes, Some(472842240));
    }

    #[test]
    fn footprint_fields_are_none_on_malformed_input() {
        let info = parse_footprint_output("garbage, not footprint output at all");
        assert_eq!(info.phys_footprint_bytes, None);
        assert_eq!(info.phys_footprint_peak_bytes, None);
    }
}
