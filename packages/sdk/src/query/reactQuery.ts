import { createEnvelope, safeSerialize } from "spyglass-protocol";
import type { QueryChangePayload, QueryInfo, QuerySnapshotPayload } from "spyglass-protocol";
import { getCore } from "../core.js";
import {
  QueryNotFoundError,
  QueryWriteNotAppliedError,
  registerQueryCommandHandler,
  registerQueryWriteHandler,
} from "../commands.js";

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
  /**
   * query-core's own `Query.setData` — writes into *this* instance, the one
   * already resolved by hash. Optional because it's an instance method this
   * SDK can't pin a version of (the whole point of `QueryLike` being
   * structural rather than importing `@tanstack/query-core`): a client shape
   * without it still works via the `setQueryData` fallback in the write
   * handler below.
   */
  setData?(newData: unknown, options?: { manual?: boolean }): unknown;
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
    const found = findByHash(queryHash);
    const beforeUpdatedAt = found.state.dataUpdatedAt;
    const beforeData = found.state.data;

    // Write into the Query instance already resolved by hash, rather than
    // through `queryClient.setQueryData(key, data)`. `setQueryData`
    // re-derives the hash from the *client's* default options
    // (`defaultQueryOptions({ queryKey })`), not the ones the query was
    // actually built with — so a query created with its own
    // `queryKeyHashFn` hashes to a different string and `queryCache.build()`
    // happily creates a brand-new, observer-less Query beside it. Nothing
    // throws, the desktop gets `ok: true`, and the app's screen never
    // changes. Going through the instance keeps this channel hash-addressed
    // end to end, which is the whole principle this payload is built on
    // (see `QueryWritePayload`'s doc comment). `manual: true` mirrors what
    // `setQueryData` itself passes, so the write isn't mistaken for a fetch
    // result by retry/refetch bookkeeping.
    if (typeof found.setData === "function") found.setData(data, { manual: true });
    else queryClient.setQueryData(found.queryKey, data);

    // Don't infer success from "it didn't throw". Every silent no-op this
    // channel can hit looks identical from here — a write landing on a
    // re-derived hash, `setQueryData`'s `undefined` early-return, the query
    // being garbage-collected mid-write — and all of them used to be
    // reported as `ok: true`, leaving the dev staring at an unchanged app
    // with no signal anywhere. Re-read by hash and prove something moved.
    const after = cache.getAll().find((q) => q.queryHash === queryHash);
    if (!after) {
      throw new QueryWriteNotAppliedError(`Query "${queryHash}" left the cache during the write.`);
    }
    // Both halves are needed. `dataUpdatedAt` alone false-negatives when two
    // writes land inside the same millisecond; the data reference alone
    // false-negatives whenever query-core's structural sharing
    // (`replaceEqualDeep`) hands back the *previous* reference because the
    // new value happens to be deeply equal. If neither moved, nothing did.
    if (after.state.dataUpdatedAt === beforeUpdatedAt && after.state.data === beforeData) {
      throw new QueryWriteNotAppliedError(
        `Write to query "${queryHash}" left its cached data untouched — the query may be registered under a different hash (custom queryKeyHashFn).`,
      );
    }
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
