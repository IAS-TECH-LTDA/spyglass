import { createEnvelope, safeSerialize } from "spyglass-protocol";
import type { QueryChangePayload, QueryInfo, QuerySnapshotPayload } from "spyglass-protocol";
import { getCore } from "../core.js";

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

/** Structural subset of `@tanstack/query-core`'s `QueryClient`. */
export interface QueryClientLike {
  getQueryCache(): QueryCacheLike;
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

  return cache.subscribe((event) => {
    if (event.type !== "added" && event.type !== "updated" && event.type !== "removed") return;

    const payload: QueryChangePayload =
      event.type === "removed"
        ? { changeType: "removed", queryHash: event.query.queryHash }
        : { changeType: event.type, queryHash: event.query.queryHash, query: toQueryInfo(event.query) };

    core.transport.send(createEnvelope("query/change", core.appId, payload));
  });
}
