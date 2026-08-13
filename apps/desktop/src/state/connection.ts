import { create } from "zustand";
import { applyPatch, createEnvelope, isTruncatedValue, MAX_SERIALIZE_DEPTH, STORAGE_WRITE_TIMEOUT_MS } from "spyglass-protocol";
import type {
  AnyEnvelope,
  SpyglassNavState,
  LogLevel,
  NavStatePayload,
  NavTransitionPayload,
  QueryCommandKind,
  QueryInfo,
  StateActionPayload,
  StorageEngine,
  StorageSnapshotPayload,
  StorageWriteOp,
  StoreType,
} from "spyglass-protocol";
import type { AppInfo } from "../ipc";
import { sendToApp } from "../ipc";

export type Tab = "graph" | "stores" | "storage" | "queries" | "logs" | "network" | "performance";

/** @see ConnectionState.pendingHighlight */
export interface PendingHighlight {
  tab: Tab;
  queryHash?: string;
  storageKey?: { engine: StorageEngine; key: string };
}

/** Which tab shows alert-worthy events of each kind — used to decide when a new one counts as "unseen". */
const TAB_FOR_ALERT_KIND: Record<"log" | "network", Tab> = { log: "logs", network: "network" };

/** Inverse of `TAB_FOR_ALERT_KIND` — `null` for tabs with no alert kind of their own (Navigation, State, ...). */
function kindForTab(tab: Tab): "log" | "network" | null {
  if (tab === "logs") return "log";
  if (tab === "network") return "network";
  return null;
}

export interface StoreEntry {
  storeId: string;
  storeType: StoreType;
  label?: string;
  state: unknown;
  /** Most recent first, capped — see `applyEnvelopeToAppData`. */
  log: StateActionPayload[];
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  args: unknown[];
  ts: number;
}

export interface NetworkEntry {
  requestId: string;
  method: string;
  url: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  startedAt: number;
  /** Undefined while the request is still in flight. */
  status?: number;
  statusText?: string;
  ok?: boolean;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  durationMs?: number;
  error?: string;
}

/**
 * A screen, keyed by **name** rather than React Navigation's per-push `key`
 * — so "Home" is one persistent node across the whole session instead of a
 * new one every time it's pushed back onto the stack.
 */
export interface NavNode {
  name: string;
  /** Params from the most recent time this screen was seen. */
  params?: Record<string, unknown>;
  /** How many transitions have landed on this screen. */
  visits: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

/** A link between two screen names, accumulated across the whole session. */
export interface NavEdge {
  from: string;
  to: string;
  /** How many times this exact link was traversed (transitions only — see `applyNavStateToGraph`). */
  count: number;
  lastAt: number;
  action?: string;
}

/**
 * A single traversal event — unlike `NavEdge`, which only keeps the most
 * recent timestamp per `from->to` pair, this is never overwritten, so a
 * screen's full connection history stays available (see `GraphView`'s
 * per-node history panel).
 */
export interface NavTransitionEvent {
  /** Absent for the initial screen (no prior route to come from). */
  from?: string;
  to: string;
  action?: string;
  ts: number;
}

export interface NavGraph {
  nodes: Record<string, NavNode>;
  /** Keyed by `${from}->${to}`. */
  edges: Record<string, NavEdge>;
  /** Most recent first, capped — every transition, not just the latest per edge. */
  transitions: NavTransitionEvent[];
  activeName?: string;
  /** Edge id of the most recent transition — drives the highlight animation. */
  lastEdgeId?: string;
  lastTransitionAt?: number;
  /**
   * `to.key` of the last `nav/transition` actually applied. The desktop only
   * caches the *latest* envelope per type (see `ipc.ts#getCachedMessages`)
   * and replays it on every reconnect (e.g. dev server hot-reload) — without
   * this guard, that replay would double-count the same transition's edge
   * and visit each time. React Navigation mints a fresh `key` per pushed
   * route instance, so a genuine repeat visit to the same screen always
   * carries a new key and isn't affected.
   */
  lastAppliedRouteKey?: string;
}

function emptyNavGraph(): NavGraph {
  return { nodes: {}, edges: {}, transitions: [] };
}

/** A `perf/sample` envelope plus its receive time — see `PerformanceView`. */
export interface PerfSample {
  fps: number;
  maxFrameMs: number;
  droppedFrames: number;
  windowMs: number;
  ts: number;
}

/** A `perf/stall` envelope plus its receive time. */
export interface PerfStall {
  durationMs: number;
  ts: number;
}

/** Alert-worthy events that arrived while the user wasn't looking at the matching tab — see `recordAlert`/`clearAlerts`. */
export interface AlertCounts {
  log: number;
  network: number;
}

/**
 * One in-flight (or just-resolved) `storage/write` sent from the desktop's
 * `JsonGraph` editor to the connected app (spec 0007), keyed by `requestId`
 * in `AppData.pendingWrites`. There's no delivery guarantee on that
 * direction, so every write goes through this instead of being applied
 * optimistically:
 *  - "pending" — sent, waiting on either a `storage/write-result` ack or the
 *    app's own `storage/change` reporting the same value.
 *  - "applied" — confirmed (ack `ok:true`, or a matching `storage/change`).
 *    Cleared automatically ~1.2s later (see `scheduleClearApplied`), a
 *    short visual confirmation window, not a stored state.
 *  - "failed" — ack `ok:false`, `sendToApp` rejected (no live connection),
 *    or the 3s timeout with no response at all.
 *  - "superseded" — a `storage/change` for the same key arrived with a
 *    different value before this write resolved — something else (the app
 *    itself, or a race with another edit) changed it first.
 */
export interface PendingWrite {
  requestId: string;
  engine: StorageEngine;
  dbName?: string;
  key: string;
  op: StorageWriteOp;
  /** Present for `op: "set"`. */
  value?: unknown;
  sentAt: number;
  status: "pending" | "applied" | "failed" | "superseded";
  error?: string;
}

/**
 * One in-flight (or just-resolved) `state/write` sent from the desktop's
 * `JsonGraph` editor to a connected app's Zustand store (spec 0007-state),
 * keyed by `requestId` in `AppData.pendingStateWrites`. Same shape/lifecycle
 * as `PendingWrite`, with one deliberate difference: no `"superseded"`
 * status. Storage can reconcile a pending write against the app's own
 * `storage/change` (which always names the key that changed); `state/action`
 * carries no `requestId` and only a diff, not a full before/after value, so
 * there's nothing to correlate against — a state write only ever resolves
 * via its own `state/write-result` ack, the shared timeout, or disconnect.
 */
export interface PendingStateWrite {
  requestId: string;
  storeId: string;
  state: unknown;
  sentAt: number;
  status: "pending" | "applied" | "failed";
  error?: string;
}

/**
 * One in-flight (or just-resolved) `memory/clear-cache` sent from the
 * Memory panel's "Clear caches" button (spec 0008), keyed by `requestId` in
 * `AppData.pendingCacheClears`. No `"superseded"` status here either (same
 * reasoning as `PendingStateWrite`) — there's no organic event to
 * reconcile against, this only ever resolves via its own
 * `memory/clear-cache-result` ack, the shared timeout, or disconnect.
 */
export interface PendingCacheClear {
  requestId: string;
  sentAt: number;
  status: "pending" | "applied" | "failed";
  error?: string;
}

/**
 * One in-flight (or just-resolved) `query/write` sent from the desktop's
 * `JsonGraph` editor to a connected app's React Query cache (spec 0010),
 * keyed by `requestId` in `AppData.pendingQueryWrites`. Same shape/lifecycle
 * as `PendingStateWrite`, same reason for no `"superseded"` status: `query/
 * change` carries no `requestId` to correlate against, so this only ever
 * resolves via its own `query/write-result` ack, the shared timeout, or
 * disconnect.
 */
export interface PendingQueryWrite {
  requestId: string;
  queryHash: string;
  data: unknown;
  sentAt: number;
  status: "pending" | "applied" | "failed";
  error?: string;
}

/**
 * One in-flight (or just-resolved) `query/command` (refetch/invalidate/
 * reset/remove) sent from the Queries tab's action toolbar (spec 0010),
 * keyed by `requestId` in `AppData.pendingQueryCommands`. Same
 * shape/lifecycle/reasoning as `PendingQueryWrite`.
 */
export interface PendingQueryCommand {
  requestId: string;
  queryHash: string;
  command: QueryCommandKind;
  sentAt: number;
  status: "pending" | "applied" | "failed";
  error?: string;
}

/** @see AppData.queriesMeta */
export interface QueryMeta {
  lastChangedAt: number;
}

/** Structural base shared by `PendingWrite`/`PendingStateWrite`/`PendingCacheClear` — enough for the generic helpers below (`failAllPending`, the applied-clear sweep) to operate on any of the three maps without knowing their full shape. */
interface PendingBase {
  status: string;
  error?: string;
}

export interface AppData {
  nav?: { state: SpyglassNavState; activeRouteKey: string };
  lastTransitionAt?: number;
  lastTransitionEdge?: { fromKey?: string; toKey: string };
  /** Persistent flow map — never pruned on `nav/state`, only grown. See `applyNavStateToGraph`/`applyNavTransitionToGraph`. */
  navGraph: NavGraph;
  stores: Record<string, StoreEntry>;
  storage: Partial<Record<StorageEngine, StorageSnapshotPayload>>;
  /** Keyed by `queryHash`. */
  queries: Record<string, QueryInfo>;
  /** Most recent first, capped. */
  logs: LogEntry[];
  /** Most recent first, capped. */
  network: NetworkEntry[];
  /** Most recent first, capped. */
  perfSamples: PerfSample[];
  /** Most recent first, capped. */
  perfStalls: PerfStall[];
  alerts: AlertCounts;
  /** In-flight/just-resolved `storage/write`s, keyed by `requestId` — see `PendingWrite`. */
  pendingWrites: Record<string, PendingWrite>;
  /** In-flight/just-resolved `state/write`s, keyed by `requestId` — see `PendingStateWrite`. */
  pendingStateWrites: Record<string, PendingStateWrite>;
  /** In-flight/just-resolved `memory/clear-cache`s, keyed by `requestId` — see `PendingCacheClear`. */
  pendingCacheClears: Record<string, PendingCacheClear>;
  /** In-flight/just-resolved `query/write`s, keyed by `requestId` — see `PendingQueryWrite`. */
  pendingQueryWrites: Record<string, PendingQueryWrite>;
  /** In-flight/just-resolved `query/command`s, keyed by `requestId` — see `PendingQueryCommand`. */
  pendingQueryCommands: Record<string, PendingQueryCommand>;
  /**
   * Desktop-only bookkeeping (spec 0011) — `query/change`'s `envelope.ts`
   * (device clock), kept alongside `queries` rather than added to `QueryInfo`
   * itself, since the latter is a wire type mirrored 1:1 from the SDK.
   * Feeds `correlateNetworkEntry`'s timing signal; not persisted across
   * reconnects (nothing here survives a desktop reload any more than the
   * rest of the session's live state does).
   */
  queriesMeta: Record<string /* queryHash */, QueryMeta>;
  /** Same idea as `queriesMeta`, for `storage/change`, keyed by engine then KV key. */
  storageMeta: Partial<Record<StorageEngine, Record<string, number>>>;
}

interface ConnectionState {
  apps: Record<string, AppInfo>;
  selectedAppId: string | null;
  data: Record<string, AppData>;
  /**
   * Lifted out of `App.tsx` (was a local `useState`) so "unseen" can mean
   * something: `recordAlert` needs to know which tab is actually on screen
   * for the selected app, not just which app is selected.
   */
  activeTab: Tab;
  /**
   * Set by `NetworkView`'s "Related" chips (spec 0011, `correlateNetworkEntry`)
   * when the user jumps from a network request to the query/storage key
   * that heuristically produced it — `QueriesView`/`StorageView` consume
   * this once (select + pulse-highlight the target) and clear it via
   * `clearPendingHighlight`, so it never survives to a later, unrelated
   * visit to that tab.
   */
  pendingHighlight: PendingHighlight | null;

  upsertApp(app: AppInfo): void;
  markDisconnected(appId: string): void;
  removeApp(appId: string): void;
  selectApp(appId: string | null): void;
  setActiveTab(tab: Tab): void;
  /** Switches to `target.tab` and records what to select/highlight there once — see `pendingHighlight`'s doc comment. */
  highlightAndNavigate(target: PendingHighlight): void;
  clearPendingHighlight(): void;
  handleEnvelope(envelope: AnyEnvelope): void;
  hydrateFromCache(appId: string, envelopes: AnyEnvelope[]): void;
  /**
   * Bumps the unseen counter for `kind`, unless the user is already looking
   * right at the matching tab for this app — in which case it's a no-op
   * (nothing to mark "unseen"). Deliberately does **not** gate whether a
   * sound/notification fires — see `lib/alertRunner.ts`, which calls this
   * unconditionally alongside its own, separate settings check. A dev with
   * Spyglass on a second monitor still wants the audible cue even while
   * sitting on the matching tab.
   */
  recordAlert(appId: string, kind: "log" | "network"): void;
  clearAlerts(appId: string, kind: "log" | "network"): void;
  clearLogs(appId: string): void;
  clearNetwork(appId: string): void;
  clearNavGraph(appId: string): void;
  clearPerf(appId: string): void;
  /**
   * Sends a Storage KV write down to `appId`'s connected app (spec 0007) and
   * tracks it in `AppData.pendingWrites` through to resolution — never
   * applies the value locally/optimistically, see `PendingWrite`'s doc
   * comment. Safe to call repeatedly for the same key; each call gets its
   * own `requestId` and resolves independently.
   */
  sendStorageWrite(
    appId: string,
    engine: StorageEngine,
    dbName: string | undefined,
    key: string,
    op: StorageWriteOp,
    value?: unknown,
  ): void;
  /**
   * Sends a whole-state write down to `appId`'s connected app for one
   * Zustand store (spec 0007-state) and tracks it in
   * `AppData.pendingStateWrites` through to resolution — same
   * never-optimistic contract as `sendStorageWrite`. `state` should already
   * be the fully reconstructed store state (i.e. the caller has run
   * `applyPatch` for the edited leaf) — this only sends it, it doesn't
   * merge anything itself.
   */
  sendStateWrite(appId: string, storeId: string, state: unknown): void;
  /**
   * Sends a "clear this app's own caches" command down to `appId`'s
   * connected app (spec 0008) and tracks it in `AppData.pendingCacheClears`
   * through to resolution — same never-optimistic contract as
   * `sendStorageWrite`/`sendStateWrite`. No target/value: see
   * `MemoryClearCachePayload`'s doc comment in `spyglass-protocol`.
   */
  sendClearCache(appId: string): void;
  /**
   * Sends a whole-data write down to `appId`'s connected app for one React
   * Query cache entry (spec 0010) and tracks it in
   * `AppData.pendingQueryWrites` through to resolution — same
   * never-optimistic contract as `sendStorageWrite`/`sendStateWrite`.
   * Addressed by `queryHash`, never `queryKey` — see `QueryWritePayload`'s
   * doc comment in `spyglass-protocol` for why.
   */
  sendQueryWrite(appId: string, queryHash: string, data: unknown): void;
  /**
   * Sends a React Query lifecycle command (refetch/invalidate/reset/remove)
   * down to `appId`'s connected app for one query (spec 0010) and tracks it
   * in `AppData.pendingQueryCommands` through to resolution. No value to
   * guard against truncation — this carries no data, only a target and a
   * verb.
   */
  sendQueryCommand(appId: string, queryHash: string, command: QueryCommandKind): void;
}

const MAX_ACTION_LOG = 200;
const MAX_LOG_ENTRIES = 500;
const MAX_NETWORK_ENTRIES = 300;
const MAX_NAV_TRANSITIONS = 300;
const MAX_PERF_SAMPLES = 300;
const MAX_PERF_STALLS = 200;

function emptyAppData(): AppData {
  return {
    navGraph: emptyNavGraph(),
    stores: {},
    storage: {},
    queries: {},
    logs: [],
    network: [],
    perfSamples: [],
    perfStalls: [],
    alerts: { log: 0, network: 0 },
    pendingWrites: {},
    pendingStateWrites: {},
    pendingCacheClears: {},
    pendingQueryWrites: {},
    pendingQueryCommands: {},
    queriesMeta: {},
    storageMeta: {},
  };
}

/** Marks every still-"pending" entry "failed" with `error` — used when an app disconnects out from under any writes in flight. Returns the same reference if there's nothing to change. Generic over `PendingBase` so it serves both `pendingWrites` and `pendingStateWrites` without duplicating this logic per map. */
function failAllPending<T extends PendingBase>(pending: Record<string, T>, error: string): Record<string, T> {
  const pendingIds = Object.keys(pending).filter((id) => pending[id].status === "pending");
  if (pendingIds.length === 0) return pending;
  const next = { ...pending };
  for (const id of pendingIds) next[id] = { ...next[id], status: "failed", error };
  return next;
}

/**
 * True if `value` contains a `TruncatedValue` marker anywhere inside it
 * (top-level or nested) — the desktop's own copy of storage/state values
 * already passed through the SDK's `safeSerialize`, which substitutes one of
 * these for anything too large/deep/circular to serialize faithfully.
 * Writing a value containing one back to the app would silently corrupt real
 * app data with a `"[Truncated]"`-style placeholder, so every write must be
 * checked before it's ever sent. Depth-capped at `MAX_SERIALIZE_DEPTH`: a
 * value reconstructed by `applyPatch` on top of already-serialized data can
 * never be deeper than what `safeSerialize` itself allowed through.
 */
function containsTruncatedValue(value: unknown, depth = 0): boolean {
  if (depth > MAX_SERIALIZE_DEPTH) return false;
  if (isTruncatedValue(value)) return true;
  if (Array.isArray(value)) return value.some((v) => containsTruncatedValue(v, depth + 1));
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((v) => containsTruncatedValue(v, depth + 1));
  }
  return false;
}

/** Structural equality for reconciling a pending write's sent value against what the app reports back — good enough for JSON-safe values, no need for anything fancier here. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

/** IDs whose pending entry just transitioned into "applied" between `prev` and `next` — drives the ~1.2s auto-clear sweep in `handleEnvelope`, shared between `pendingWrites` and `pendingStateWrites` instead of duplicating the diff per map. */
function newlyApplied<T extends PendingBase>(prev: Record<string, T>, next: Record<string, T>): string[] {
  return Object.keys(next).filter((id) => next[id].status === "applied" && prev[id]?.status !== "applied");
}

/** Returns `data` unchanged (same reference) if there's nothing to clear, so callers can skip a re-render. */
function clearAlertCount(
  data: Record<string, AppData>,
  appId: string,
  kind: "log" | "network",
): Record<string, AppData> {
  const appData = data[appId];
  if (!appData || appData.alerts[kind] === 0) return data;
  return { ...data, [appId]: { ...appData, alerts: { ...appData.alerts, [kind]: 0 } } };
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  apps: {},
  selectedAppId: null,
  data: {},
  activeTab: "graph",
  pendingHighlight: null,

  upsertApp(app) {
    set((s) => {
      // The SDK generates a fresh random appId every time init() runs, so a
      // full process restart (not just a WebSocket blip) reconnects under a
      // brand new id — without this, that shows up as a second, permanently
      // disconnected pill instead of the existing one coming back to life.
      // Treat same (appName, platform) as "the same logical app reconnecting"
      // and drop the stale entry rather than accumulating duplicates.
      const staleId = Object.keys(s.apps).find(
        (id) => id !== app.appId && s.apps[id].appName === app.appName && s.apps[id].platform === app.platform,
      );

      let apps = s.apps;
      let data = s.data;
      let selectedAppId = s.selectedAppId;

      if (staleId) {
        const { [staleId]: _removedApp, ...restApps } = apps;
        const { [staleId]: _removedData, ...restData } = data;
        apps = restApps;
        data = restData;
        if (selectedAppId === staleId) selectedAppId = app.appId;
      }

      return {
        apps: { ...apps, [app.appId]: app },
        data: data[app.appId] ? data : { ...data, [app.appId]: emptyAppData() },
        selectedAppId: selectedAppId ?? app.appId,
      };
    });
  },

  markDisconnected(appId) {
    set((s) => {
      const existing = s.apps[appId];
      if (!existing) return s;
      // Fail any writes still waiting on a response immediately, rather than
      // making the UI sit on "pending" until the 3s timeout catches up —
      // the disconnect event is a more precise, more immediate signal.
      const appData = s.data[appId];
      const data = appData
        ? {
            ...s.data,
            [appId]: {
              ...appData,
              pendingWrites: failAllPending(appData.pendingWrites, "App disconnected"),
              pendingStateWrites: failAllPending(appData.pendingStateWrites, "App disconnected"),
              pendingCacheClears: failAllPending(appData.pendingCacheClears, "App disconnected"),
              pendingQueryWrites: failAllPending(appData.pendingQueryWrites, "App disconnected"),
              pendingQueryCommands: failAllPending(appData.pendingQueryCommands, "App disconnected"),
            },
          }
        : s.data;
      return { apps: { ...s.apps, [appId]: { ...existing, connected: false } }, data };
    });
  },

  removeApp(appId) {
    set((s) => {
      const { [appId]: _removedApp, ...apps } = s.apps;
      const { [appId]: _removedData, ...data } = s.data;
      const selectedAppId = s.selectedAppId === appId ? (Object.keys(apps)[0] ?? null) : s.selectedAppId;
      return { apps, data, selectedAppId };
    });
  },

  selectApp(appId) {
    set((s) => {
      if (appId === null) return { selectedAppId: null };
      // Selecting an app while already sitting on its Logs/Network tab
      // (e.g. re-selecting the same app, or switching from another app with
      // the same tab open) counts as "seen" immediately, same as
      // `setActiveTab` below.
      const kind = kindForTab(s.activeTab);
      const data = kind ? clearAlertCount(s.data, appId, kind) : s.data;
      return { selectedAppId: appId, data };
    });
  },

  setActiveTab(tab) {
    set((s) => {
      if (!s.selectedAppId) return { activeTab: tab };
      const kind = kindForTab(tab);
      const data = kind ? clearAlertCount(s.data, s.selectedAppId, kind) : s.data;
      return { activeTab: tab, data };
    });
  },

  highlightAndNavigate(target) {
    set({ pendingHighlight: target });
    get().setActiveTab(target.tab);
  },

  clearPendingHighlight() {
    set({ pendingHighlight: null });
  },

  recordAlert(appId, kind) {
    set((s) => {
      const alreadyVisible = s.selectedAppId === appId && s.activeTab === TAB_FOR_ALERT_KIND[kind];
      if (alreadyVisible) return s;
      const appData = s.data[appId];
      if (!appData) return s; // envelope for an app not yet in the store — shouldn't happen, but don't crash over a badge count
      return {
        data: { ...s.data, [appId]: { ...appData, alerts: { ...appData.alerts, [kind]: appData.alerts[kind] + 1 } } },
      };
    });
  },

  clearAlerts(appId, kind) {
    set((s) => ({ data: clearAlertCount(s.data, appId, kind) }));
  },

  handleEnvelope(envelope) {
    const appId = envelope.appId;
    const prevData = get().data[appId];
    const prevPendingWrites = prevData?.pendingWrites ?? {};
    const prevPendingStateWrites = prevData?.pendingStateWrites ?? {};
    const prevPendingCacheClears = prevData?.pendingCacheClears ?? {};
    const prevPendingQueryWrites = prevData?.pendingQueryWrites ?? {};
    const prevPendingQueryCommands = prevData?.pendingQueryCommands ?? {};

    set((s) => {
      const appData = s.data[appId] ?? emptyAppData();
      const next = applyEnvelopeToAppData(appData, envelope);
      if (next === appData) return s;
      return { data: { ...s.data, [appId]: next } };
    });

    // A write just resolved to "applied" (via `storage/write-result`,
    // `state/write-result`, or a matching `storage/change`, all handled
    // inside applyEnvelopeToAppData) — schedule its brief on-screen
    // confirmation to clear. Diffing against the pre-update snapshot means
    // this only fires once, right when the transition actually happens, not
    // on every unrelated envelope.
    const nextData = get().data[appId];
    if (!nextData) return;

    for (const requestId of newlyApplied(prevPendingWrites, nextData.pendingWrites)) {
      const timer = setTimeout(() => {
        set((s) => {
          const appData = s.data[appId];
          const current = appData?.pendingWrites[requestId];
          if (!appData || !current || current.status !== "applied") return s;
          const { [requestId]: _cleared, ...rest } = appData.pendingWrites;
          return { data: { ...s.data, [appId]: { ...appData, pendingWrites: rest } } };
        });
      }, 1200);
      (timer as unknown as { unref?: () => void }).unref?.();
    }

    for (const requestId of newlyApplied(prevPendingStateWrites, nextData.pendingStateWrites)) {
      const timer = setTimeout(() => {
        set((s) => {
          const appData = s.data[appId];
          const current = appData?.pendingStateWrites[requestId];
          if (!appData || !current || current.status !== "applied") return s;
          const { [requestId]: _cleared, ...rest } = appData.pendingStateWrites;
          return { data: { ...s.data, [appId]: { ...appData, pendingStateWrites: rest } } };
        });
      }, 1200);
      (timer as unknown as { unref?: () => void }).unref?.();
    }

    for (const requestId of newlyApplied(prevPendingCacheClears, nextData.pendingCacheClears)) {
      const timer = setTimeout(() => {
        set((s) => {
          const appData = s.data[appId];
          const current = appData?.pendingCacheClears[requestId];
          if (!appData || !current || current.status !== "applied") return s;
          const { [requestId]: _cleared, ...rest } = appData.pendingCacheClears;
          return { data: { ...s.data, [appId]: { ...appData, pendingCacheClears: rest } } };
        });
      }, 1200);
      (timer as unknown as { unref?: () => void }).unref?.();
    }

    for (const requestId of newlyApplied(prevPendingQueryWrites, nextData.pendingQueryWrites)) {
      const timer = setTimeout(() => {
        set((s) => {
          const appData = s.data[appId];
          const current = appData?.pendingQueryWrites[requestId];
          if (!appData || !current || current.status !== "applied") return s;
          const { [requestId]: _cleared, ...rest } = appData.pendingQueryWrites;
          return { data: { ...s.data, [appId]: { ...appData, pendingQueryWrites: rest } } };
        });
      }, 1200);
      (timer as unknown as { unref?: () => void }).unref?.();
    }

    for (const requestId of newlyApplied(prevPendingQueryCommands, nextData.pendingQueryCommands)) {
      const timer = setTimeout(() => {
        set((s) => {
          const appData = s.data[appId];
          const current = appData?.pendingQueryCommands[requestId];
          if (!appData || !current || current.status !== "applied") return s;
          const { [requestId]: _cleared, ...rest } = appData.pendingQueryCommands;
          return { data: { ...s.data, [appId]: { ...appData, pendingQueryCommands: rest } } };
        });
      }, 1200);
      (timer as unknown as { unref?: () => void }).unref?.();
    }
  },

  sendStorageWrite(appId, engine, dbName, key, op, value) {
    const requestId = `w_${Math.random().toString(36).slice(2, 10)}`;
    const pending: PendingWrite = { requestId, engine, dbName, key, op, value, sentAt: Date.now(), status: "pending" };

    set((s) => {
      const appData = s.data[appId] ?? emptyAppData();
      return { data: { ...s.data, [appId]: { ...appData, pendingWrites: { ...appData.pendingWrites, [requestId]: pending } } } };
    });

    const fail = (error: string) => {
      set((s) => {
        const appData = s.data[appId];
        const current = appData?.pendingWrites[requestId];
        // Already resolved by an ack or a matching storage/change — the 3s
        // timeout firing after that must not clobber a real result.
        if (!appData || !current || current.status !== "pending") return s;
        return {
          data: {
            ...s.data,
            [appId]: { ...appData, pendingWrites: { ...appData.pendingWrites, [requestId]: { ...current, status: "failed", error } } },
          },
        };
      });
    };

    // The value the desktop holds already went through the SDK's
    // safeSerialize — writing a truncated marker back would corrupt real
    // app data. Caught here (post-optimistic-pending-entry, pre-send) so the
    // UI still shows a "failed" row instead of silently doing nothing.
    if (op === "set" && containsTruncatedValue(value)) {
      fail("This value contains data that was truncated for display (too large/deep/circular) — editing it back into the app isn't safe.");
      return;
    }

    const envelope = createEnvelope("storage/write", appId, { requestId, engine, dbName, key, op, value });
    sendToApp(envelope)
      .then(() => {
        const timer = setTimeout(
          () => fail("No response from the app (3s). It may have disconnected, or writes are disabled in this build (production)."),
          STORAGE_WRITE_TIMEOUT_MS,
        );
        (timer as unknown as { unref?: () => void }).unref?.();
      })
      .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
  },

  sendStateWrite(appId, storeId, state) {
    const requestId = `sw_${Math.random().toString(36).slice(2, 10)}`;
    const pending: PendingStateWrite = { requestId, storeId, state, sentAt: Date.now(), status: "pending" };

    set((s) => {
      const appData = s.data[appId] ?? emptyAppData();
      return {
        data: { ...s.data, [appId]: { ...appData, pendingStateWrites: { ...appData.pendingStateWrites, [requestId]: pending } } },
      };
    });

    const fail = (error: string) => {
      set((s) => {
        const appData = s.data[appId];
        const current = appData?.pendingStateWrites[requestId];
        if (!appData || !current || current.status !== "pending") return s;
        return {
          data: {
            ...s.data,
            [appId]: {
              ...appData,
              pendingStateWrites: { ...appData.pendingStateWrites, [requestId]: { ...current, status: "failed", error } },
            },
          },
        };
      });
    };

    // See the matching guard in sendStorageWrite above — same reasoning.
    if (containsTruncatedValue(state)) {
      fail("This value contains data that was truncated for display (too large/deep/circular) — editing it back into the app isn't safe.");
      return;
    }

    const envelope = createEnvelope("state/write", appId, { requestId, storeId, state });
    sendToApp(envelope)
      .then(() => {
        const timer = setTimeout(
          () => fail("No response from the app (3s). It may have disconnected, or writes are disabled in this build (production)."),
          STORAGE_WRITE_TIMEOUT_MS,
        );
        (timer as unknown as { unref?: () => void }).unref?.();
      })
      .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
  },

  sendClearCache(appId) {
    const requestId = `cc_${Math.random().toString(36).slice(2, 10)}`;
    const pending: PendingCacheClear = { requestId, sentAt: Date.now(), status: "pending" };

    set((s) => {
      const appData = s.data[appId] ?? emptyAppData();
      return {
        data: { ...s.data, [appId]: { ...appData, pendingCacheClears: { ...appData.pendingCacheClears, [requestId]: pending } } },
      };
    });

    const fail = (error: string) => {
      set((s) => {
        const appData = s.data[appId];
        const current = appData?.pendingCacheClears[requestId];
        if (!appData || !current || current.status !== "pending") return s;
        return {
          data: {
            ...s.data,
            [appId]: {
              ...appData,
              pendingCacheClears: { ...appData.pendingCacheClears, [requestId]: { ...current, status: "failed", error } },
            },
          },
        };
      });
    };

    // No value to reconstruct/guard here (unlike sendStorageWrite/
    // sendStateWrite) — memory/clear-cache carries only a requestId.
    const envelope = createEnvelope("memory/clear-cache", appId, { requestId });
    sendToApp(envelope)
      .then(() => {
        const timer = setTimeout(
          () => fail("No response from the app (3s). It may have disconnected, or writes are disabled in this build (production)."),
          STORAGE_WRITE_TIMEOUT_MS,
        );
        (timer as unknown as { unref?: () => void }).unref?.();
      })
      .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
  },

  sendQueryWrite(appId, queryHash, data) {
    const requestId = `qw_${Math.random().toString(36).slice(2, 10)}`;
    const pending: PendingQueryWrite = { requestId, queryHash, data, sentAt: Date.now(), status: "pending" };

    set((s) => {
      const appData = s.data[appId] ?? emptyAppData();
      return {
        data: { ...s.data, [appId]: { ...appData, pendingQueryWrites: { ...appData.pendingQueryWrites, [requestId]: pending } } },
      };
    });

    const fail = (error: string) => {
      set((s) => {
        const appData = s.data[appId];
        const current = appData?.pendingQueryWrites[requestId];
        if (!appData || !current || current.status !== "pending") return s;
        return {
          data: {
            ...s.data,
            [appId]: {
              ...appData,
              pendingQueryWrites: { ...appData.pendingQueryWrites, [requestId]: { ...current, status: "failed", error } },
            },
          },
        };
      });
    };

    // See the matching guard in sendStorageWrite/sendStateWrite — same reasoning.
    if (containsTruncatedValue(data)) {
      fail("This value contains data that was truncated for display (too large/deep/circular) — editing it back into the app isn't safe.");
      return;
    }

    const envelope = createEnvelope("query/write", appId, { requestId, queryHash, data });
    sendToApp(envelope)
      .then(() => {
        const timer = setTimeout(
          () => fail("No response from the app (3s). It may have disconnected, or writes are disabled in this build (production)."),
          STORAGE_WRITE_TIMEOUT_MS,
        );
        (timer as unknown as { unref?: () => void }).unref?.();
      })
      .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
  },

  sendQueryCommand(appId, queryHash, command) {
    const requestId = `qc_${Math.random().toString(36).slice(2, 10)}`;
    const pending: PendingQueryCommand = { requestId, queryHash, command, sentAt: Date.now(), status: "pending" };

    set((s) => {
      const appData = s.data[appId] ?? emptyAppData();
      return {
        data: {
          ...s.data,
          [appId]: { ...appData, pendingQueryCommands: { ...appData.pendingQueryCommands, [requestId]: pending } },
        },
      };
    });

    const fail = (error: string) => {
      set((s) => {
        const appData = s.data[appId];
        const current = appData?.pendingQueryCommands[requestId];
        if (!appData || !current || current.status !== "pending") return s;
        return {
          data: {
            ...s.data,
            [appId]: {
              ...appData,
              pendingQueryCommands: { ...appData.pendingQueryCommands, [requestId]: { ...current, status: "failed", error } },
            },
          },
        };
      });
    };

    // No value to guard here (unlike sendQueryWrite) — query/command carries only a target and a verb.
    const envelope = createEnvelope("query/command", appId, { requestId, queryHash, command });
    sendToApp(envelope)
      .then(() => {
        const timer = setTimeout(
          () => fail("No response from the app (3s). It may have disconnected, or writes are disabled in this build (production)."),
          STORAGE_WRITE_TIMEOUT_MS,
        );
        (timer as unknown as { unref?: () => void }).unref?.();
      })
      .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
  },

  hydrateFromCache(_appId, envelopes) {
    // Cached envelopes may arrive out of order relative to `type`; apply
    // full-snapshot types first so a later single-entry diff/change for the
    // same domain (state/action, query/change) lands on top of it rather
    // than being clobbered by it.
    const rank = (type: AnyEnvelope["type"]): number =>
      type === "state/init" || type === "query/snapshot" ? -1 : 0;
    const ordered = [...envelopes].sort((a, b) => rank(a.type) - rank(b.type));
    for (const envelope of ordered) get().handleEnvelope(envelope);
  },

  clearLogs(appId) {
    set((s) => {
      if (!s.data[appId]) return s;
      return { data: { ...s.data, [appId]: { ...s.data[appId], logs: [] } } };
    });
  },

  clearNetwork(appId) {
    set((s) => {
      if (!s.data[appId]) return s;
      return { data: { ...s.data, [appId]: { ...s.data[appId], network: [] } } };
    });
  },

  clearNavGraph(appId) {
    set((s) => {
      if (!s.data[appId]) return s;
      return { data: { ...s.data, [appId]: { ...s.data[appId], navGraph: emptyNavGraph() } } };
    });
  },

  clearPerf(appId) {
    set((s) => {
      if (!s.data[appId]) return s;
      return { data: { ...s.data, [appId]: { ...s.data[appId], perfSamples: [], perfStalls: [] } } };
    });
  },
}));

function applyEnvelopeToAppData(appData: AppData, envelope: AnyEnvelope): AppData {
  switch (envelope.type) {
    case "nav/state": {
      return {
        ...appData,
        nav: envelope.payload,
        navGraph: applyNavStateToGraph(appData.navGraph, envelope.payload, Date.now()),
      };
    }

    case "nav/transition": {
      const { from, to } = envelope.payload;
      return {
        ...appData,
        lastTransitionAt: Date.now(),
        lastTransitionEdge: { fromKey: from?.key, toKey: to.key },
        navGraph: applyNavTransitionToGraph(appData.navGraph, envelope.payload, Date.now()),
      };
    }

    case "state/init": {
      const p = envelope.payload;
      const entry: StoreEntry = { storeId: p.storeId, storeType: p.storeType, label: p.label, state: p.state, log: [] };
      return { ...appData, stores: { ...appData.stores, [p.storeId]: entry } };
    }

    case "state/action": {
      const p = envelope.payload;
      const existing = appData.stores[p.storeId];
      if (!existing) return appData; // action for a store we haven't seen `state/init` for yet
      // Defense in depth: `p.diff` comes straight off an unauthenticated LAN
      // WebSocket. `applyPatch` itself fails safe on malformed input, but a
      // single unexpected exception here must not take down the whole
      // reducer (and with it every other app's data) alongside it.
      let nextState = existing.state;
      try {
        nextState = applyPatch(existing.state, p.diff);
      } catch (err) {
        console.warn(`[Spyglass] failed to apply state/action diff for store "${p.storeId}":`, err);
      }
      const log = [p, ...existing.log].slice(0, MAX_ACTION_LOG);
      return { ...appData, stores: { ...appData.stores, [p.storeId]: { ...existing, state: nextState, log } } };
    }

    case "storage/snapshot": {
      const p = envelope.payload;
      return { ...appData, storage: { ...appData.storage, [p.engine]: p } };
    }

    case "storage/change": {
      // Best-effort in-place patch for KV engines (AsyncStorage/MMKV) so a
      // single key edit doesn't wait for a full re-snapshot. Relational and
      // collection engines (SQLite/Realm) always follow up with a fresh
      // `storage/snapshot`, so there's nothing to patch here.
      const p = envelope.payload;
      const existing = appData.storage[p.engine];

      // Reconcile any pending desktop-initiated write to this exact key
      // (spec 0007) — the app's own report of its storage is authoritative:
      // if it matches what was sent, the write applied; if it doesn't,
      // something else (the app itself, or a race with another edit)
      // changed the key first. This runs whether or not a
      // `storage/write-result` ack has arrived yet — either can resolve it.
      let pendingWrites = appData.pendingWrites;
      if (p.key !== undefined) {
        const incomingValue = p.changeType === "remove" ? undefined : p.value;
        for (const [requestId, write] of Object.entries(pendingWrites)) {
          if (write.status !== "pending" || write.engine !== p.engine || write.dbName !== p.dbName || write.key !== p.key) continue;
          const matches = write.op === "remove" ? p.changeType === "remove" : deepEqual(write.value, incomingValue);
          if (pendingWrites === appData.pendingWrites) pendingWrites = { ...appData.pendingWrites };
          pendingWrites[requestId] = { ...write, status: matches ? "applied" : "superseded" };
        }
      }

      // Bookkeeping for the Network↔Storage correlation heuristic (spec
      // 0011, correlateNetworkEntry.ts) — `envelope.ts` (device clock) is
      // already available here, just never persisted before now.
      const storageMeta =
        p.key !== undefined
          ? {
              ...appData.storageMeta,
              [p.engine]: { ...appData.storageMeta[p.engine], [p.key]: envelope.ts },
            }
          : appData.storageMeta;

      if (!existing?.entries || p.key === undefined) {
        return pendingWrites === appData.pendingWrites && storageMeta === appData.storageMeta
          ? appData
          : { ...appData, pendingWrites, storageMeta };
      }

      const entries = existing.entries.filter((e) => e.key !== p.key);
      if (p.changeType !== "remove") entries.push({ key: p.key, value: p.value });

      return { ...appData, storage: { ...appData.storage, [p.engine]: { ...existing, entries } }, pendingWrites, storageMeta };
    }

    case "storage/write-result": {
      const p = envelope.payload;
      const current = appData.pendingWrites[p.requestId];
      if (!current) return appData; // unknown/stale requestId (e.g. a reload after the request already resolved) — ignore, not an error
      return {
        ...appData,
        pendingWrites: {
          ...appData.pendingWrites,
          [p.requestId]: { ...current, status: p.ok ? "applied" : "failed", error: p.error },
        },
      };
    }

    case "state/write-result": {
      const p = envelope.payload;
      const current = appData.pendingStateWrites[p.requestId];
      if (!current) return appData; // unknown/stale requestId — ignore, not an error
      return {
        ...appData,
        pendingStateWrites: {
          ...appData.pendingStateWrites,
          [p.requestId]: { ...current, status: p.ok ? "applied" : "failed", error: p.error },
        },
      };
    }

    case "memory/clear-cache-result": {
      const p = envelope.payload;
      const current = appData.pendingCacheClears[p.requestId];
      if (!current) return appData; // unknown/stale requestId — ignore, not an error
      return {
        ...appData,
        pendingCacheClears: {
          ...appData.pendingCacheClears,
          [p.requestId]: { ...current, status: p.ok ? "applied" : "failed", error: p.error },
        },
      };
    }

    case "query/write-result": {
      const p = envelope.payload;
      const current = appData.pendingQueryWrites[p.requestId];
      if (!current) return appData; // unknown/stale requestId — ignore, not an error
      return {
        ...appData,
        pendingQueryWrites: {
          ...appData.pendingQueryWrites,
          [p.requestId]: { ...current, status: p.ok ? "applied" : "failed", error: p.error },
        },
      };
    }

    case "query/command-result": {
      const p = envelope.payload;
      const current = appData.pendingQueryCommands[p.requestId];
      if (!current) return appData; // unknown/stale requestId — ignore, not an error
      return {
        ...appData,
        pendingQueryCommands: {
          ...appData.pendingQueryCommands,
          [p.requestId]: { ...current, status: p.ok ? "applied" : "failed", error: p.error },
        },
      };
    }

    case "query/snapshot": {
      const p = envelope.payload;
      if (!Array.isArray(p.queries)) return appData; // malformed payload — keep whatever queries we already have
      const queries: Record<string, QueryInfo> = {};
      for (const q of p.queries) queries[q.queryHash] = q;
      return { ...appData, queries };
    }

    case "query/change": {
      const p = envelope.payload;
      // Bookkeeping for the Network↔Queries correlation heuristic (spec
      // 0011, correlateNetworkEntry.ts) — kept even on "removed" (it's a
      // "when did this last change" history, not "does it exist now").
      const queriesMeta = { ...appData.queriesMeta, [p.queryHash]: { lastChangedAt: envelope.ts } };
      if (p.changeType === "removed") {
        const { [p.queryHash]: _removed, ...queries } = appData.queries;
        return { ...appData, queries, queriesMeta };
      }
      if (!p.query) return appData;
      return { ...appData, queries: { ...appData.queries, [p.queryHash]: p.query }, queriesMeta };
    }

    case "log/entry": {
      const p = envelope.payload;
      // `p.args`/`p.message` are typed as `unknown[]`/`string` by the
      // protocol, but that's compile-time only — the frame itself comes off
      // an unauthenticated LAN WebSocket. Coerce here, once, instead of every
      // consumer (LogsView's filter/render/copy) having to re-guard.
      const entry: LogEntry = {
        level: p.level,
        message: typeof p.message === "string" ? p.message : String(p.message),
        args: Array.isArray(p.args) ? p.args : [],
        ts: envelope.ts,
      };
      return { ...appData, logs: [entry, ...appData.logs].slice(0, MAX_LOG_ENTRIES) };
    }

    case "network/request": {
      const p = envelope.payload;
      // A reconnect replays the (single) cached `network/request` for this
      // app — dedupe by requestId instead of blindly prepending, or the
      // same request shows up twice (and React trips on the duplicate key).
      const existingIndex = appData.network.findIndex((e) => e.requestId === p.requestId);
      if (existingIndex !== -1) return appData;

      const entry: NetworkEntry = {
        requestId: p.requestId,
        method: p.method,
        url: p.url,
        requestHeaders: p.headers,
        requestBody: p.body,
        startedAt: envelope.ts,
      };
      return { ...appData, network: [entry, ...appData.network].slice(0, MAX_NETWORK_ENTRIES) };
    }

    case "network/response": {
      const p = envelope.payload;
      const index = appData.network.findIndex((e) => e.requestId === p.requestId);

      if (index === -1) {
        // Response for a request we never saw the start of (e.g. it began
        // just before this session connected) — show it as a standalone entry.
        const entry: NetworkEntry = {
          requestId: p.requestId,
          method: "?",
          url: "?",
          startedAt: envelope.ts,
          status: p.status,
          statusText: p.statusText,
          ok: p.ok,
          responseHeaders: p.headers,
          responseBody: p.body,
          durationMs: p.durationMs,
          error: p.error,
        };
        return { ...appData, network: [entry, ...appData.network].slice(0, MAX_NETWORK_ENTRIES) };
      }

      const network = appData.network.slice();
      network[index] = {
        ...network[index],
        status: p.status,
        statusText: p.statusText,
        ok: p.ok,
        responseHeaders: p.headers,
        responseBody: p.body,
        durationMs: p.durationMs,
        error: p.error,
      };
      return { ...appData, network };
    }

    case "perf/sample": {
      const p = envelope.payload;
      const entry: PerfSample = { ...p, ts: envelope.ts };
      return { ...appData, perfSamples: [entry, ...appData.perfSamples].slice(0, MAX_PERF_SAMPLES) };
    }

    case "perf/stall": {
      const p = envelope.payload;
      const entry: PerfStall = { ...p, ts: envelope.ts };
      return { ...appData, perfStalls: [entry, ...appData.perfStalls].slice(0, MAX_PERF_STALLS) };
    }

    default:
      return appData;
  }
}

function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}

function upsertNode(
  nodes: Record<string, NavNode>,
  name: string,
  params: Record<string, unknown> | undefined,
  now: number,
  options: { visit?: boolean } = {},
): Record<string, NavNode> {
  const existing = nodes[name];
  const node: NavNode = existing
    ? {
        ...existing,
        params: params ?? existing.params,
        visits: existing.visits + (options.visit ? 1 : 0),
        lastSeenAt: now,
      }
    : {
        name,
        params,
        visits: options.visit ? 1 : 0,
        firstSeenAt: now,
        lastSeenAt: now,
      };
  return { ...nodes, [name]: node };
}

/**
 * Walks the recursive `nav/state` tree, upserting a persistent node per
 * screen **name** and a structural edge between consecutive routes within
 * each navigator's `routes` array (its back-stack / tab order). Edges are
 * only *created* here, never counted — `nav/transition` is the sole source
 * of truth for how many times a link was actually traversed, so a screen
 * that merely re-renders its current stack doesn't inflate edge counts.
 */
function applyNavStateToGraph(graph: NavGraph, payload: NavStatePayload, now: number): NavGraph {
  let nodes = graph.nodes;
  let edges = graph.edges;
  let activeName: string | undefined;

  function visit(state: SpyglassNavState) {
    // `state` traces back to an unauthenticated LAN WebSocket frame — guard
    // against a malformed/malicious `nav/state` (e.g. `routes` missing or
    // not an array) instead of throwing mid-render.
    if (!state || !Array.isArray(state.routes)) return;
    for (let i = 0; i < state.routes.length; i++) {
      const route = state.routes[i];
      nodes = upsertNode(nodes, route.name, route.params, now);
      if (route.key === payload.activeRouteKey) activeName = route.name;

      if (i > 0) {
        const prev = state.routes[i - 1];
        const id = edgeId(prev.name, route.name);
        if (!edges[id]) {
          edges = { ...edges, [id]: { from: prev.name, to: route.name, count: 0, lastAt: now } };
        }
      }

      if (route.state) visit(route.state);
    }
  }

  visit(payload.state);

  return { ...graph, nodes, edges, activeName: activeName ?? graph.activeName };
}

/**
 * Applies a single `nav/transition` — the authoritative navigation event —
 * bumping the target screen's visit count and the traversed edge's count,
 * without ever removing an existing node/edge.
 */
function applyNavTransitionToGraph(graph: NavGraph, payload: NavTransitionPayload, now: number): NavGraph {
  const { from, to } = payload;
  if (to.key && to.key === graph.lastAppliedRouteKey) return graph; // replay of the cached last transition — see NavGraph.lastAppliedRouteKey

  let nodes = upsertNode(graph.nodes, to.name, to.params, now, { visit: true });
  let edges = graph.edges;
  let lastEdgeId = graph.lastEdgeId;

  if (from) {
    // Ensure the source node exists even if this app connected mid-session
    // and we never saw it via `nav/state`.
    nodes = upsertNode(nodes, from.name, undefined, now);

    const id = edgeId(from.name, to.name);
    const existing = edges[id];
    edges = {
      ...edges,
      [id]: { from: from.name, to: to.name, count: (existing?.count ?? 0) + 1, lastAt: now, action: payload.action },
    };
    lastEdgeId = id;
  }

  const transitionEvent: NavTransitionEvent = { from: from?.name, to: to.name, action: payload.action, ts: now };
  const transitions = [transitionEvent, ...graph.transitions].slice(0, MAX_NAV_TRANSITIONS);

  return {
    ...graph,
    nodes,
    edges,
    transitions,
    activeName: to.name,
    lastEdgeId,
    lastTransitionAt: now,
    lastAppliedRouteKey: to.key,
  };
}
