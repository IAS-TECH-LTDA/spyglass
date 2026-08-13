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
  // Desktop -> SDK. Every other message type flows SDK -> Desktop only
  // ("hello/ack" is declared but never implemented on either end) — this
  // pair is the one deliberate exception, see StorageWritePayload's doc
  // comment. Dev-only: the SDK doesn't even register a handler for
  // "storage/write" outside a dev-style environment (see
  // InitOptions.allowRemoteWrites).
  | "storage/write"
  | "storage/write-result"
  // Same direction/gating as storage/write, for state managers — see
  // StateWritePayload's doc comment. Zustand-only for now.
  | "state/write"
  | "state/write-result"
  // Same direction/gating as storage/write and state/write, but not a
  // per-resource write — see MemoryClearCachePayload's doc comment
  // (spec 0008). No `key`/`storeId`, since "clear this app's own caches"
  // has no target to address.
  | "memory/clear-cache"
  | "memory/clear-cache-result"
  // Same direction/gating as storage/write, state/write and
  // memory/clear-cache, for a React Query cache — see QueryWritePayload's
  // and QueryCommandPayload's doc comments.
  | "query/write"
  | "query/write-result"
  | "query/command"
  | "query/command-result"
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
  /** Only advertised when the SDK has the inbound `storage/write` channel enabled (dev-only by default) — lets the desktop show read-only instead of waiting out a timeout against a build that will never ack. */
  | "storage:write"
  /** Same as `storage:write`, for `state/write` — advertised whenever the shared inbound-commands channel is on, independent of whether any store actually has a handler registered (an unregistered storeId just gets `errorCode: "no-store"`). */
  | "state:write"
  /** Same as `storage:write`/`state:write`, for `memory/clear-cache` (spec 0008) — advertised whenever the shared inbound-commands channel is on. Unlike the other two, there's no per-resource registration to fail against: the handler is either present (`allowRemoteWrites` on) or the whole channel isn't wired up at all. */
  | "memory:clear-cache"
  /** Same as `storage:write`/`state:write`, for `query/write` and `query/command` (spec 0010) — covers both under one capability, same risk category as `state:write` covering a store's whole state object. Advertised whenever the shared inbound-commands channel is on and `attachReactQuery` has registered its handlers. */
  | "query:write"
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

/**
 * Desktop -> SDK: apply an edited leaf back onto a store's state from the
 * desktop's `JsonGraph` editor, live (spec 0007-state). Unlike
 * `StorageWritePayload`, this always carries the whole reconstructed state
 * rather than a single key — the desktop applies the edited leaf locally
 * (via `applyPatch`) and sends the result, so the SDK side never needs a
 * patch-application step of its own. It's still a *shallow merge* on the
 * SDK side, not a full replace: the desktop only ever sees the serialized
 * (data) half of the store, never its action functions, so a full replace
 * would wipe every `increment`/`reset`/etc. off the store. See
 * `state/zustand.ts`'s write handler for where that merge happens.
 *
 * Zustand-only for now — it's the one state manager with a single `set()`
 * every store already routes through (see `state/autoAttachZustand.ts` and
 * the SDK README's "Why not every adapter?"); Redux/Jotai/Recoil/MobX have
 * no equivalent, so `state/write` for a `storeId` backed by one of those
 * simply gets `errorCode: "no-store"` back — no handler was ever registered
 * for it, same as `storage/write` against an engine with no attached
 * adapter. No per-field reconciliation against organic `state/action`s
 * either (unlike storage's `storage/change` correlation) — `state/action`
 * carries no `requestId` to correlate against, so a write here only
 * resolves via its own explicit `state/write-result` ack or the shared
 * `STORAGE_WRITE_TIMEOUT_MS` timeout/disconnect, never a "superseded" state.
 */
export interface StateWritePayload {
  requestId: string;
  storeId: string;
  state: unknown;
}

export type StateWriteErrorCode = "no-store" | "engine-error";

export interface StateWriteResultPayload {
  requestId: string;
  ok: boolean;
  errorCode?: StateWriteErrorCode;
  error?: string;
}

/**
 * Desktop -> SDK: "clear this app's own caches" (spec 0008). No target
 * field (no `key`/`storeId`/`engine`) — unlike `storage/write`/`state/write`,
 * this isn't a per-resource write, it's a single global action the SDK
 * either can or can't perform. The SDK tries `global.gc()` (Hermes, present
 * in production builds) and, if `expo-image` is installed,
 * `Image.clearMemoryCache()`/`clearDiskCache()` — see
 * `packages/sdk/src/memoryClear.ts`. Deliberately named "clear caches", not
 * "free memory": no third-party app can ask the OS to release memory back
 * to it, on iOS or Android — only its own caches.
 */
export interface MemoryClearCachePayload {
  requestId: string;
}

export type MemoryClearCacheErrorCode = "engine-error";

export interface MemoryClearCacheResultPayload {
  requestId: string;
  ok: boolean;
  errorCode?: MemoryClearCacheErrorCode;
  error?: string;
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

/**
 * Desktop -> SDK: write a KV storage value from the desktop's `JsonGraph`
 * editor into the real, connected app (spec 0007). MVP scope is
 * intentionally narrow: key/value engines only (`asyncStorage`, `mmkv`,
 * `localStorage`, `sessionStorage`) — not the relational/collection engines
 * (`sqlite`, `watermelondb`, `realm`). State managers have their own,
 * separate write channel (`StateWritePayload`, Zustand-only) rather than
 * being folded in here — a store isn't a KV engine, so `key`/`op` don't
 * apply to it.
 *
 * There's no delivery guarantee in this direction (the app may have
 * disconnected, or — in production — never even registered a handler), so
 * every write carries a desktop-minted `requestId` that `StorageWriteResultPayload`
 * echoes back. The desktop uses it to (a) tell its own write echoing back as
 * a `storage/change` apart from an unrelated app-originated change, and (b)
 * time out (see `STORAGE_WRITE_TIMEOUT_MS`) instead of waiting forever.
 */
export type StorageWriteOp = "set" | "remove";

export interface StorageWritePayload {
  requestId: string;
  engine: StorageEngine;
  dbName?: string;
  key: string;
  op: StorageWriteOp;
  /** Present for `op: "set"`; absent for `op: "remove"`. */
  value?: unknown;
}

export type StorageWriteErrorCode =
  /** No attached adapter for this engine/dbName — most commonly a stale UI after the app detached that adapter. */
  | "no-adapter"
  | "unsupported-op"
  /** The underlying engine call itself threw (e.g. AsyncStorage.setItem rejected). */
  | "engine-error";

export interface StorageWriteResultPayload {
  requestId: string;
  ok: boolean;
  errorCode?: StorageWriteErrorCode;
  /** Human-readable, shown verbatim in the desktop's failure state. */
  error?: string;
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

/**
 * Desktop -> SDK: write a query's cached data from the desktop's `JsonGraph`
 * editor into the real, connected app's React Query cache (spec 0010).
 * Addressed by `queryHash`, deliberately never `queryKey` — `QueryInfo.queryKey`
 * on the wire already passed through `safeSerialize` (see `toQueryInfo` in
 * `spyglass-react/query/react-query`), which can normalize/truncate values
 * (e.g. a `Date` becomes an ISO string, an over-deep object becomes a
 * `TruncatedValue`). Reconstructing a `queryKey` from that and sending it
 * back would risk hashing to a *different* query than the one the user
 * actually edited. `queryHash` is a plain, short string that never goes
 * through that lossy path, so the SDK side resolves the real, live
 * `queryKey` by looking the query up in its own cache by hash, then uses
 * that reference — never anything reconstructed from this payload.
 */
export interface QueryWritePayload {
  requestId: string;
  queryHash: string;
  data: unknown;
}

export type QueryWriteErrorCode =
  /** No `attachReactQuery` has registered a handler at all. */
  | "no-adapter"
  /** A handler is registered, but no query with this hash exists in its cache right now. */
  | "no-query"
  /** `setQueryData` itself threw. */
  | "engine-error";

export interface QueryWriteResultPayload {
  requestId: string;
  ok: boolean;
  errorCode?: QueryWriteErrorCode;
  error?: string;
}

/**
 * Desktop -> SDK: trigger one of React Query's own cache lifecycle actions
 * for a single query, from the desktop's Queries tab (spec 0010) — the
 * "control the tool's own primitives, not just what the app's code
 * happens to call" request. Same `queryHash`-addressing rationale as
 * `QueryWritePayload`. `"remove"` in particular can appear to do nothing if
 * the query still has active observers (`QueryInfo.observersCount > 0`):
 * React Query's own subscribed components immediately trigger a refetch
 * that repopulates the cache — that's expected React Query behavior, not a
 * bug in this channel.
 */
export type QueryCommandKind = "refetch" | "invalidate" | "reset" | "remove";

export interface QueryCommandPayload {
  requestId: string;
  queryHash: string;
  command: QueryCommandKind;
}

export type QueryCommandErrorCode = "no-adapter" | "no-query" | "engine-error";

export interface QueryCommandResultPayload {
  requestId: string;
  ok: boolean;
  errorCode?: QueryCommandErrorCode;
  error?: string;
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
  "storage/write": StorageWritePayload;
  "storage/write-result": StorageWriteResultPayload;
  "state/write": StateWritePayload;
  "state/write-result": StateWriteResultPayload;
  "memory/clear-cache": MemoryClearCachePayload;
  "memory/clear-cache-result": MemoryClearCacheResultPayload;
  "query/write": QueryWritePayload;
  "query/write-result": QueryWriteResultPayload;
  "query/command": QueryCommandPayload;
  "query/command-result": QueryCommandResultPayload;
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
