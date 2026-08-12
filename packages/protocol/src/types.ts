/**
 * Shared wire types for the Spyglass SDK <-> Desktop WebSocket protocol.
 *
 * Every message on the wire is an `Envelope<T>`. `T` is one of the payload
 * interfaces below, keyed by `Envelope.type`. Keep this file dependency-free
 * (no RN, no Tauri, no Node) so it can be imported from the SDK (RN runtime),
 * the desktop UI (browser/webview) and the Rust side is generated/mirrored
 * by hand from this source of truth.
 */

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export type MessageType =
  | "hello"
  | "hello/ack"
  | "ping"
  | "pong"
  | "nav/state"
  | "nav/transition"
  | "screen/methods"
  | "state/init"
  | "state/action"
  | "storage/snapshot"
  | "storage/change"
  | "log/entry"
  | "network/request"
  | "network/response"
  | "query/snapshot"
  | "query/change"
  | "perf/sample"
  | "perf/stall";

export interface Envelope<T = unknown> {
  /** Protocol version, bumped on breaking wire changes. */
  v: 1;
  type: MessageType;
  /** Stable id for the connected app instance (assigned by the SDK at init). */
  appId: string;
  /** Unix epoch millis, set by the sender. */
  ts: number;
  payload: T;
}

// ---------------------------------------------------------------------------
// Handshake / liveness
// ---------------------------------------------------------------------------

export type Platform = "ios" | "android" | "web";

/**
 * Which JS framework/runtime the SDK is embedded in, distinct from OS-level
 * `Platform`. Optional and additive to the wire protocol — older SDKs that
 * don't send it are unaffected (see `HelloPayload.framework`).
 */
export type Framework = "expo" | "bare-rn" | "web" | "unknown";

export type Capability =
  | "navigation"
  | "state:redux"
  | "state:zustand"
  | "state:jotai"
  | "state:recoil"
  | "state:mobx"
  | "storage:asyncStorage"
  | "storage:mmkv"
  | "storage:sqlite"
  | "storage:watermelondb"
  | "storage:realm"
  | "storage:localStorage"
  | "storage:sessionStorage"
  | "console"
  | "network"
  | "query:react-query"
  | "performance";

export interface HelloPayload {
  appName: string;
  platform: Platform;
  /** Expo vs bare React Native vs web, when the SDK could determine it. */
  framework?: Framework;
  rnVersion?: string;
  sdkVersion: string;
  /** Adapters this SDK instance has registered and will emit events for. */
  capabilities: Capability[];
}

export interface HelloAckPayload {
  /** Desktop-assigned or confirmed display name collision handling, etc. */
  acceptedAppId: string;
}

export interface PingPayload {
  seq: number;
}

export interface PongPayload {
  seq: number;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export interface SpyglassRoute {
  key: string;
  name: string;
  params?: Record<string, unknown>;
  /** Present when this route owns a nested navigator (stack/tab/drawer). */
  state?: SpyglassNavState;
}

export interface SpyglassNavState {
  /** Index of the active route within `routes`. */
  index: number;
  routeNames?: string[];
  routes: SpyglassRoute[];
}

export interface NavStatePayload {
  state: SpyglassNavState;
  /** Convenience: key of the deepest currently-focused route. */
  activeRouteKey: string;
}

export interface NavTransitionPayload {
  from?: { key: string; name: string };
  to: { key: string; name: string; params?: Record<string, unknown> };
  /** e.g. "NAVIGATE", "GO_BACK", "REPLACE" when known. */
  action?: string;
}

export interface ScreenMethodsPayload {
  routeKey: string;
  screenName: string;
  /** Best-effort names of handlers/options detected at runtime. */
  methods: string[];
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

export type StoreType = "redux" | "zustand" | "jotai" | "recoil" | "mobx";

export type JsonPatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "replace"; path: string; value: unknown }
  | { op: "remove"; path: string };

export interface StateInitPayload {
  storeId: string;
  storeType: StoreType;
  label?: string;
  state: unknown;
}

export interface StateActionPayload {
  storeId: string;
  storeType: StoreType;
  /** Redux action, Zustand setter name, Jotai atom label, etc. */
  action?: { type: string; payload?: unknown };
  diff: JsonPatchOp[];
  nextStateHash: string;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export type StorageEngine =
  | "asyncStorage"
  | "mmkv"
  | "sqlite"
  | "watermelondb"
  | "realm"
  | "localStorage"
  | "sessionStorage";

export interface KVEntry {
  key: string;
  value: unknown;
}

export interface ColumnSchema {
  name: string;
  /**
   * Free-form, per-engine type label — e.g. "INTEGER"/"TEXT" from SQLite's
   * `PRAGMA table_info`, "string"/"number"/"boolean" from WatermelonDB's
   * column schema, "int"/"objectId"/"list" from Realm's property schema.
   * Deliberately not normalized across engines: each adapter reports
   * whatever its own database calls it, and the desktop just displays it.
   */
  type?: string;
  isPrimaryKey?: boolean;
}

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
}

export interface StorageSnapshotPayload {
  engine: StorageEngine;
  dbName?: string;
  /** For relational/collection engines. */
  schema?: TableSchema[];
  /** For key/value engines (AsyncStorage, MMKV). */
  entries?: KVEntry[];
  /** For relational/collection engines: table/collection name -> rows. */
  rows?: Record<string, unknown[]>;
}

export type StorageChangeKind =
  | "set"
  | "remove"
  | "insert"
  | "update"
  | "delete";

export interface StorageChangePayload {
  engine: StorageEngine;
  dbName?: string;
  changeType: StorageChangeKind;
  /** KV engines. */
  key?: string;
  value?: unknown;
  /** Relational/collection engines. */
  table?: string;
  row?: unknown;
  rowId?: string;
}

// ---------------------------------------------------------------------------
// Query caches (React Query, ...)
// ---------------------------------------------------------------------------

export type QueryResultStatus = "pending" | "success" | "error";
export type QueryFetchStatus = "fetching" | "paused" | "idle";

export interface QueryInfo {
  queryHash: string;
  /** The library's structural key, e.g. `["todos", { page: 2 }]`. */
  queryKey: unknown[];
  status: QueryResultStatus;
  fetchStatus: QueryFetchStatus;
  data?: unknown;
  error?: unknown;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
  isInvalidated: boolean;
  /** Number of components currently subscribed via e.g. `useQuery`. */
  observersCount: number;
}

export interface QuerySnapshotPayload {
  queries: QueryInfo[];
}

export type QueryChangeKind = "added" | "updated" | "removed";

export interface QueryChangePayload {
  changeType: QueryChangeKind;
  queryHash: string;
  /** Present for "added"/"updated"; absent for "removed". */
  query?: QueryInfo;
}

// ---------------------------------------------------------------------------
// Performance (JS-thread frame timing)
// ---------------------------------------------------------------------------

export interface PerfSamplePayload {
  /** Average frames-per-second over this sampling window. */
  fps: number;
  /** Longest single frame duration in the window, ms — the worst jank in this window. */
  maxFrameMs: number;
  /** Frames in this window slower than the adapter's drop threshold. */
  droppedFrames: number;
  /** Window length, ms. */
  windowMs: number;
}

export interface PerfStallPayload {
  /** How long the JS thread was blocked for, ms. Reported immediately, not batched. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Console logs
// ---------------------------------------------------------------------------

export type LogLevel = "log" | "info" | "warn" | "error" | "debug";

export interface LogEntryPayload {
  level: LogLevel;
  /** Args joined/stringified for a one-line preview (what a console usually shows). */
  message: string;
  /** Original arguments, safe-serialized — kept separate so the UI can render objects nicely. */
  args: unknown[];
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

export interface NetworkRequestPayload {
  requestId: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface NetworkResponsePayload {
  requestId: string;
  /** Absent when the request failed before a response was received (network error, timeout). */
  status?: number;
  statusText?: string;
  ok?: boolean;
  headers?: Record<string, string>;
  body?: unknown;
  durationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Truncation marker (used inside any payload for oversized/circular values)
// ---------------------------------------------------------------------------

export interface TruncatedValue {
  __spyglass_truncated: true;
  preview: string;
  originalType: string;
  originalSize?: number;
}

export function isTruncatedValue(v: unknown): v is TruncatedValue {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<string, unknown>).__spyglass_truncated === true
  );
}

// ---------------------------------------------------------------------------
// Discriminated envelope map (handy for exhaustive switches on `type`)
// ---------------------------------------------------------------------------

export interface PayloadByType {
  hello: HelloPayload;
  "hello/ack": HelloAckPayload;
  ping: PingPayload;
  pong: PongPayload;
  "nav/state": NavStatePayload;
  "nav/transition": NavTransitionPayload;
  "screen/methods": ScreenMethodsPayload;
  "state/init": StateInitPayload;
  "state/action": StateActionPayload;
  "storage/snapshot": StorageSnapshotPayload;
  "storage/change": StorageChangePayload;
  "log/entry": LogEntryPayload;
  "network/request": NetworkRequestPayload;
  "network/response": NetworkResponsePayload;
  "query/snapshot": QuerySnapshotPayload;
  "query/change": QueryChangePayload;
  "perf/sample": PerfSamplePayload;
  "perf/stall": PerfStallPayload;
}

export type AnyEnvelope = {
  [K in MessageType]: Envelope<PayloadByType[K]> & { type: K };
}[MessageType];
