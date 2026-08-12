import { create } from "zustand";
import { applyPatch } from "spyglass-protocol";
import type {
  AnyEnvelope,
  SpyglassNavState,
  LogLevel,
  NavStatePayload,
  NavTransitionPayload,
  QueryInfo,
  StateActionPayload,
  StorageEngine,
  StorageSnapshotPayload,
  StoreType,
} from "spyglass-protocol";
import type { AppInfo } from "../ipc";

export type Tab = "graph" | "stores" | "storage" | "queries" | "logs" | "network" | "performance";

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

  upsertApp(app: AppInfo): void;
  markDisconnected(appId: string): void;
  removeApp(appId: string): void;
  selectApp(appId: string | null): void;
  setActiveTab(tab: Tab): void;
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
  };
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
      return { apps: { ...s.apps, [appId]: { ...existing, connected: false } } };
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
    set((s) => {
      const appData = s.data[envelope.appId] ?? emptyAppData();
      const next = applyEnvelopeToAppData(appData, envelope);
      if (next === appData) return s;
      return { data: { ...s.data, [envelope.appId]: next } };
    });
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
      const nextState = applyPatch(existing.state, p.diff);
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
      if (!existing?.entries || p.key === undefined) return appData;

      const entries = existing.entries.filter((e) => e.key !== p.key);
      if (p.changeType !== "remove") entries.push({ key: p.key, value: p.value });

      return { ...appData, storage: { ...appData.storage, [p.engine]: { ...existing, entries } } };
    }

    case "query/snapshot": {
      const p = envelope.payload;
      const queries: Record<string, QueryInfo> = {};
      for (const q of p.queries) queries[q.queryHash] = q;
      return { ...appData, queries };
    }

    case "query/change": {
      const p = envelope.payload;
      if (p.changeType === "removed") {
        const { [p.queryHash]: _removed, ...queries } = appData.queries;
        return { ...appData, queries };
      }
      if (!p.query) return appData;
      return { ...appData, queries: { ...appData.queries, [p.queryHash]: p.query } };
    }

    case "log/entry": {
      const p = envelope.payload;
      const entry: LogEntry = { level: p.level, message: p.message, args: p.args, ts: envelope.ts };
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
