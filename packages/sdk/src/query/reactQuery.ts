import { createEnvelope, safeSerialize } from "spyglass-protocol";
import type { QueryChangePayload, QueryInfo, QuerySnapshotPayload } from "spyglass-protocol";
import { getCore } from "../core.js";
import { QueryNotFoundError, registerQueryCommandHandler, registerQueryWriteHandler } from "../commands.js";

/** Structural subset of `@tanstack/query-core`'s `Query`, avoids depending on `@tanstack/react-query`. */
interface QueryLike {
  queryHash: string;
  queryKey: readonly unknown[];
  state: {
    data?: unknown;
    error?: unknown;
    status: "pending" | "success" | "error";
    fetchStatus: "fetching" | "paused" | "idle";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    isInvalidated: boolean;
  };
  getObserversCount(): number;
}

interface QueryCacheNotifyEvent {
  type: "added" | "removed" | "updated" | string;
  query: QueryLike;
}

interface QueryCacheLike {
  getAll(): QueryLike[];
  subscribe(listener: (event: QueryCacheNotifyEvent) => void): () => void;
}

/** Minimal filter shape accepted by `QueryClientLike`'s mutating methods — always addressed by the exact, live `queryKey` found in the cache (never a reconstructed one, see `QueryWritePayload`'s doc comment), so `exact: true` is the only mode this SDK ever needs. */
export interface QueryFiltersLike {
  queryKey: readonly unknown[];
  exact: true;
}

/** Structural subset of `@tanstack/query-core`'s `QueryClient`. */
export interface QueryClientLike {
  getQueryCache(): QueryCacheLike;
  setQueryData(queryKey: readonly unknown[], data: unknown): unknown;
  invalidateQueries(filters: QueryFiltersLike): Promise<void>;
  refetchQueries(filters: QueryFiltersLike): Promise<void>;
  resetQueries(filters: QueryFiltersLike): Promise<void>;
  removeQueries(filters: QueryFiltersLike): void;
}

function toQueryInfo(query: QueryLike): QueryInfo {
  return {
    queryHash: query.queryHash,
    queryKey: safeSerialize(query.queryKey) as unknown[],
    status: query.state.status,
    fetchStatus: query.state.fetchStatus,
    data: safeSerialize(query.state.data),
    error: query.state.error === undefined ? undefined : safeSerialize(query.state.error),
    dataUpdatedAt: query.state.dataUpdatedAt,
    errorUpdatedAt: query.state.errorUpdatedAt,
    isInvalidated: query.state.isInvalidated,
    observersCount: query.getObserversCount(),
  };
}

/**
 * Streams a React Query `QueryClient`'s cache to the desktop inspector: a
 * full snapshot on attach (`query/snapshot`), then one `query/change` per
 * cache event (query added, its data/status updated, or garbage-collected).
 *
 * Also wires up the desktop's Queries tab live-write/command channel (spec
 * 0010, dev-only — gated the same way as every other inbound command by
 * `InitOptions.allowRemoteWrites`, see `index.ts`): editing a query's data,
 * or clicking Refetch/Invalidate/Reset/Remove, are routed through
 * `queryClient`'s own methods rather than a bespoke code path, so the
 * resulting cache event flows back out through the same `cache.subscribe`
 * below that already exists — no separate confirmation/render path needed.
 *
 * ```ts
 * import { QueryClient } from "@tanstack/react-query";
 * import { attachReactQuery } from "spyglass-react/query/react-query";
 *
 * const queryClient = new QueryClient();
 * attachReactQuery(queryClient);
 * ```
 */
export function attachReactQuery(queryClient: QueryClientLike): () => void {
  const core = getCore();
  core.registerCapability("query:react-query");
  const cache = queryClient.getQueryCache();

  const snapshot: QuerySnapshotPayload = { queries: cache.getAll().map(toQueryInfo) };
  core.transport.send(createEnvelope("query/snapshot", core.appId, snapshot));

  const unsubscribe = cache.subscribe((event) => {
    if (event.type !== "added" && event.type !== "updated" && event.type !== "removed") return;

    const payload: QueryChangePayload =
      event.type === "removed"
        ? { changeType: "removed", queryHash: event.query.queryHash }
        : { changeType: event.type, queryHash: event.query.queryHash, query: toQueryInfo(event.query) };

    core.transport.send(createEnvelope("query/change", core.appId, payload));
  });

  // Addressed by queryHash only — `found.queryKey` below is the live,
  // never-serialized reference the cache already indexes by, not anything
  // reconstructed from the wire (see QueryWritePayload's doc comment).
  const findByHash = (queryHash: string): QueryLike => {
    const found = cache.getAll().find((q) => q.queryHash === queryHash);
    if (!found) throw new QueryNotFoundError(`No query with hash "${queryHash}".`);
    return found;
  };

  const unregisterWrite = registerQueryWriteHandler((queryHash, data) => {
    queryClient.setQueryData(findByHash(queryHash).queryKey, data);
  });

  const unregisterCommand = registerQueryCommandHandler(async (queryHash, command) => {
    const filters: QueryFiltersLike = { queryKey: findByHash(queryHash).queryKey, exact: true };
    if (command === "refetch") await queryClient.refetchQueries(filters);
    else if (command === "invalidate") await queryClient.invalidateQueries(filters);
    else if (command === "reset") await queryClient.resetQueries(filters);
    else queryClient.removeQueries(filters);
  });

  return () => {
    unsubscribe();
    unregisterWrite();
    unregisterCommand();
  };
}
