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
