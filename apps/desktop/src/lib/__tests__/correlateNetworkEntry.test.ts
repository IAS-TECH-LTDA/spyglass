import { describe, expect, it } from "vitest";
import type { QueryInfo, StorageEngine, StorageSnapshotPayload } from "spyglass-protocol";
import type { AppData, NetworkEntry, QueryMeta } from "../../state/connection.js";
import { correlateNetworkEntry } from "../correlateNetworkEntry.js";

function networkEntry(overrides: Partial<NetworkEntry> = {}): NetworkEntry {
  return {
    requestId: "req-1",
    method: "GET",
    url: "/users/42",
    startedAt: 1_000,
    durationMs: 50,
    ...overrides,
  };
}

function queryInfo(queryHash: string, queryKey: unknown[]): QueryInfo {
  return {
    queryHash,
    queryKey,
    status: "success",
    fetchStatus: "idle",
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    isInvalidated: false,
    observersCount: 0,
  };
}

function storageSnapshot(engine: StorageEngine, keys: string[]): StorageSnapshotPayload {
  return { engine, entries: keys.map((key) => ({ key, value: null })) };
}

type CorrelationInput = Pick<AppData, "queries" | "queriesMeta" | "storage" | "storageMeta">;

function appDataFor(opts: {
  queries?: Record<string, QueryInfo>;
  queriesMeta?: Record<string, QueryMeta>;
  storage?: Partial<Record<StorageEngine, StorageSnapshotPayload>>;
  storageMeta?: Partial<Record<StorageEngine, Record<string, number>>>;
}): CorrelationInput {
  return {
    queries: opts.queries ?? {},
    queriesMeta: opts.queriesMeta ?? {},
    storage: opts.storage ?? {},
    storageMeta: opts.storageMeta ?? {},
  };
}

describe("correlateNetworkEntry", () => {
  it("matches a query by shared URL/queryKey tokens", () => {
    const entry = networkEntry({ url: "/users/42" });
    const appData = appDataFor({ queries: { h1: queryInfo("h1", ["users", 42]) } });

    expect(correlateNetworkEntry(entry, appData)).toEqual({
      queries: [{ queryHash: "h1", queryKey: ["users", 42] }],
      storage: [],
    });
  });

  it("matches a storage key by shared tokens", () => {
    const entry = networkEntry({ url: "/cart/items" });
    const appData = appDataFor({ storage: { asyncStorage: storageSnapshot("asyncStorage", ["cart_items"]) } });

    expect(correlateNetworkEntry(entry, appData)).toEqual({
      queries: [],
      storage: [{ engine: "asyncStorage", dbName: undefined, key: "cart_items" }],
    });
  });

  it("excludes orphan requests (url === '?')", () => {
    const entry = networkEntry({ url: "?" });
    const appData = appDataFor({ queries: { h1: queryInfo("h1", ["users", 42]) } });

    expect(correlateNetworkEntry(entry, appData)).toEqual({ queries: [], storage: [] });
  });

  it("excludes tokens shorter than MIN_TOKEN_LENGTH", () => {
    // "ab"/"cd" are 2 chars — below the minimum, so the URL yields zero
    // usable tokens and nothing can match, even a would-be exact queryKey.
    const entry = networkEntry({ url: "/ab/cd" });
    const appData = appDataFor({ queries: { h1: queryInfo("h1", ["ab", "cd"]) } });

    expect(correlateNetworkEntry(entry, appData)).toEqual({ queries: [], storage: [] });
  });

  it("excludes stopwords like 'api'/'v1' from contributing to a match", () => {
    const entry = networkEntry({ url: "/api/v1/reports" });
    const appData = appDataFor({
      queries: {
        // Would only match via the stopworded "api" token if stopwords
        // weren't filtered — must NOT appear in the result.
        stopwordOnly: queryInfo("stopwordOnly", ["api"]),
        real: queryInfo("real", ["reports"]),
      },
    });

    expect(correlateNetworkEntry(entry, appData)).toEqual({
      queries: [{ queryHash: "real", queryKey: ["reports"] }],
      storage: [],
    });
  });

  it("ambiguity: two equally-strong query candidates with no timing signal → returns neither", () => {
    const entry = networkEntry({ url: "/user/42" });
    const appData = appDataFor({
      queries: {
        a: queryInfo("a", ["user", 42]),
        b: queryInfo("b", ["user", 42, "details"]),
      },
      // No queriesMeta at all — neither candidate is timing-confirmed.
    });

    expect(correlateNetworkEntry(entry, appData).queries).toEqual([]);
  });

  it("timing signal disambiguates two token-tied candidates when only one is within TIMING_WINDOW_MS", () => {
    const entry = networkEntry({ url: "/user/42", startedAt: 1_000, durationMs: 50 }); // resolves at 1050
    const appData = appDataFor({
      queries: {
        a: queryInfo("a", ["user", 42]),
        b: queryInfo("b", ["user", 42, "details"]),
      },
      queriesMeta: {
        a: { lastChangedAt: 1_100 }, // within the 5s window of 1050
        b: { lastChangedAt: 50_000 }, // far outside it
      },
    });

    expect(correlateNetworkEntry(entry, appData).queries).toEqual([{ queryHash: "a", queryKey: ["user", 42] }]);
  });

  it("timing signal alone (no token overlap) never produces a match", () => {
    const entry = networkEntry({ url: "/orders/9", startedAt: 1_000, durationMs: 0 });
    const appData = appDataFor({
      queries: { unrelated: queryInfo("unrelated", ["completely", "unrelated"]) },
      queriesMeta: { unrelated: { lastChangedAt: 1_000 } }, // perfectly timed, but shares no tokens
    });

    expect(correlateNetworkEntry(entry, appData).queries).toEqual([]);
  });

  it("ignores path tokens from a different host/query-string", () => {
    const entry = networkEntry({ url: "https://api.example.com/users/42?token=secretvalue" });
    const appData = appDataFor({
      queries: {
        viaHostOrQuery: queryInfo("viaHostOrQuery", ["secretvalue"]), // only in host/querystring, must not match
        viaPath: queryInfo("viaPath", ["users", 42]), // in the pathname, should match
      },
    });

    expect(correlateNetworkEntry(entry, appData).queries).toEqual([{ queryHash: "viaPath", queryKey: ["users", 42] }]);
  });

  it("returns a match (not throwing) when queriesMeta/storageMeta are absent for older cached data", () => {
    const entry = networkEntry({ url: "/users/42" });
    const appData: CorrelationInput = { queries: { h1: queryInfo("h1", ["users", 42]) }, queriesMeta: {}, storage: {}, storageMeta: {} };

    expect(() => correlateNetworkEntry(entry, appData)).not.toThrow();
    expect(correlateNetworkEntry(entry, appData).queries).toEqual([{ queryHash: "h1", queryKey: ["users", 42] }]);
  });
});
