import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { AnyEnvelope } from "spyglass-protocol";

/** Mirrors the Rust `AppInfo` struct (src-tauri/src/registry.rs), serde(rename_all = "camelCase"). */
export interface AppInfo {
  appId: string;
  appName: string;
  platform: string;
  framework?: string;
  sdkVersion: string;
  rnVersion?: string;
  capabilities: string[];
  connectedAt: number;
  lastSeen: number;
  connected: boolean;
}

export function onAppConnected(handler: (app: AppInfo) => void): Promise<UnlistenFn> {
  return listen<AppInfo>("app-connected", (event) => handler(event.payload));
}

export function onAppDisconnected(handler: (appId: string) => void): Promise<UnlistenFn> {
  return listen<string>("app-disconnected", (event) => handler(event.payload));
}

/** Every envelope the WS server receives, forwarded as-is for the store to route by `type`. */
export function onMessage(handler: (envelope: AnyEnvelope) => void): Promise<UnlistenFn> {
  return listen<AnyEnvelope>("dm-message", (event) => handler(event.payload));
}

export function listApps(): Promise<AppInfo[]> {
  return invoke<AppInfo[]>("list_apps");
}

/**
 * Latest cached envelope per message type for one app (hello, nav/state,
 * every state/init, every storage/snapshot...). Used to hydrate the UI
 * after a reload/reconnect without waiting for the app to change again.
 */
export function getCachedMessages(appId: string): Promise<AnyEnvelope[]> {
  return invoke<AnyEnvelope[]>("get_cached_messages", { appId });
}

/** Removes an app from the apps bar. A still-connected app reappears on its next message. */
export function forgetApp(appId: string): Promise<void> {
  return invoke<void>("forget_app", { appId });
}

/**
 * Sends one envelope down to `envelope.appId`'s live socket (spec 0007) —
 * the one Desktop -> SDK direction, used today only for `storage/write`.
 * Rejects if that app has no live connection (never connected, or
 * disconnected) — the caller should treat that the same as any other
 * "failed to apply" outcome, not retry silently.
 */
export function sendToApp(envelope: AnyEnvelope): Promise<void> {
  return invoke<void>("send_to_app", { envelope });
}

/** Mirrors the Rust `LanAddress` struct (src-tauri/src/netinfo.rs). */
export interface LanAddress {
  ip: string;
  interfaceName: string;
  isPrimary: boolean;
}

/** Mirrors the Rust `ConnectionInfo` struct (src-tauri/src/netinfo.rs). */
export interface ConnectionInfo {
  port: number;
  addresses: LanAddress[];
}

/** This machine's LAN-reachable IPv4 addresses and the port the WS server listens on. Fetch-once; call again after a network change (e.g. a manual "Refresh"). */
export function getConnectionInfo(): Promise<ConnectionInfo> {
  return invoke<ConnectionInfo>("get_connection_info");
}

/** Mirrors the Rust `AdbDevice` struct (src-tauri/src/adb.rs). */
export interface AdbDevice {
  serial: string;
  state: string;
  reversed: boolean;
  error?: string;
}

/** Mirrors the Rust `AdbStatus` struct (src-tauri/src/adb.rs). */
export interface AdbStatus {
  state: "searching" | "unavailable" | "no-devices" | "ok" | "partial" | "error";
  adbPath?: string;
  devices: AdbDevice[];
  port: number;
  message?: string;
  checkedAt: number;
}

/** Current `adb reverse` status, as last computed by the desktop's background watcher. */
export function getAdbStatus(): Promise<AdbStatus> {
  return invoke<AdbStatus>("get_adb_status");
}

/** Forces an immediate re-check + re-apply of `adb reverse`, returning the resulting status. */
export function retryAdbReverse(): Promise<AdbStatus> {
  return invoke<AdbStatus>("retry_adb_reverse");
}

/** Pushed by the desktop's background watcher whenever the adb status meaningfully changes (not on every poll tick). */
export function onAdbStatus(handler: (status: AdbStatus) => void): Promise<UnlistenFn> {
  return listen<AdbStatus>("adb-status", (event) => handler(event.payload));
}

// ---------------------------------------------------------------------------
// Memory (spec 0008) — on-demand, called only while the Memory panel is
// mounted (never a background watcher like adb reverse above). Every call
// re-locates adb/footprint on the Rust side, so these are safe to call
// occasionally rather than needing to be pooled/cached here.
// ---------------------------------------------------------------------------

/** Third-party (non-system) packages installed on an Android device — for the Memory panel's package picker. */
export function listThirdPartyPackages(serial: string): Promise<string[]> {
  return invoke<string[]>("list_third_party_packages", { serial });
}

/** Mirrors the Rust `ForegroundSuggestion` struct (src-tauri/src/adb.rs). */
export interface ForegroundSuggestion {
  pid: number;
  package: string;
}

/** Best-effort suggested default for the package picker — not authoritative, see `ForegroundSuggestion`'s Rust-side doc comment for why (Expo Go, split-screen). */
export function suggestForegroundPackage(serial: string): Promise<ForegroundSuggestion | null> {
  return invoke<ForegroundSuggestion | null>("suggest_foreground_package", { serial });
}

/** Mirrors the Rust `SystemMemoryInfo` struct (src-tauri/src/adb.rs). */
export interface SystemMemoryInfo {
  totalKb: number;
  availableKb: number;
}

export function readSystemMemory(serial: string): Promise<SystemMemoryInfo> {
  return invoke<SystemMemoryInfo>("read_system_memory", { serial });
}

/** Mirrors the Rust `AppMemoryInfo` struct (src-tauri/src/adb.rs). */
export interface AppMemoryInfo {
  totalPssKb?: number;
  totalRssKb?: number;
  totalSwapPssKb?: number;
}

export function readAppMemory(serial: string, packageName: string): Promise<AppMemoryInfo> {
  return invoke<AppMemoryInfo>("read_app_memory", { serial, package: packageName });
}

/** Mirrors the Rust `SimulatorInfo` struct (src-tauri/src/ios_memory.rs, macOS-only — resolves to an empty list on other hosts since the underlying Tauri command doesn't exist there). */
export interface SimulatorInfo {
  udid: string;
  name: string;
}

export function listBootedSimulators(): Promise<SimulatorInfo[]> {
  return invoke<SimulatorInfo[]>("list_booted_simulators");
}

/** `bundleOrName` is the app's `.app` bundle folder name, e.g. "MyApp" for `MyApp.app` — see the Rust-side doc comment on `find_simulator_pid` for why this isn't auto-resolved from a bundle id. */
export function findSimulatorPid(udid: string, bundleOrName: string): Promise<number | null> {
  return invoke<number | null>("find_simulator_pid", { udid, bundleOrName });
}

/** Mirrors the Rust `SimulatorMemoryInfo` struct (src-tauri/src/ios_memory.rs). */
export interface SimulatorMemoryInfo {
  physFootprintBytes?: number;
  physFootprintPeakBytes?: number;
}

export function readSimulatorMemory(pid: number): Promise<SimulatorMemoryInfo> {
  return invoke<SimulatorMemoryInfo>("read_simulator_memory", { pid });
}
