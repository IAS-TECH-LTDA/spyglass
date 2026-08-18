import { beforeEach, describe, expect, it } from "vitest";
import { createEnvelope } from "spyglass-protocol";
import {
  useConnectionStore,
  type AppData,
  type PendingCacheClear,
  type PendingQueryCommand,
  type PendingQueryWrite,
  type PendingStateWrite,
  type PendingStorageClear,
  type PendingWrite,
} from "../connection";
import type { AppInfo } from "../../ipc";

const APP_ID = "app-1";

function fakeAppInfo(overrides: Partial<AppInfo> = {}): AppInfo {
  return {
    appId: APP_ID,
    appName: "TestApp",
    platform: "ios",
    sdkVersion: "0.1.1",
    capabilities: ["storage:asyncStorage"],
    connectedAt: Date.now(),
    lastSeen: Date.now(),
    connected: true,
    ...overrides,
  };
}

function pendingWrite(overrides: Partial<PendingWrite> = {}): PendingWrite {
  return {
    requestId: "req-1",
    engine: "asyncStorage",
    key: "token",
    op: "set",
    value: "new-value",
    sentAt: Date.now(),
    status: "pending",
    ...overrides,
  };
}

function seedAppWithPendingWrite(write: PendingWrite): void {
  useConnectionStore.setState((s) => ({
    apps: { ...s.apps, [APP_ID]: fakeAppInfo() },
    data: {
      ...s.data,
      [APP_ID]: {
        ...emptyAppDataFor(APP_ID),
        storage: { asyncStorage: { engine: "asyncStorage", entries: [{ key: "token", value: "old-value" }] } },
        pendingWrites: { [write.requestId]: write },
      },
    },
  }));
}

function pendingStateWrite(overrides: Partial<PendingStateWrite> = {}): PendingStateWrite {
  return {
    requestId: "sreq-1",
    storeId: "zustand",
    state: { count: 1 },
    sentAt: Date.now(),
    status: "pending",
    ...overrides,
  };
}

function seedAppWithPendingStateWrite(write: PendingStateWrite): void {
  useConnectionStore.setState((s) => ({
    apps: { ...s.apps, [APP_ID]: fakeAppInfo() },
    data: {
      ...s.data,
      [APP_ID]: {
        ...emptyAppDataFor(APP_ID),
        stores: { zustand: { storeId: "zustand", storeType: "zustand", state: { count: 0 }, log: [] } },
        pendingStateWrites: { [write.requestId]: write },
      },
    },
  }));
}

function pendingCacheClear(overrides: Partial<PendingCacheClear> = {}): PendingCacheClear {
  return {
    requestId: "creq-1",
    sentAt: Date.now(),
    status: "pending",
    ...overrides,
  };
}

function seedAppWithPendingCacheClear(clear: PendingCacheClear): void {
  useConnectionStore.setState((s) => ({
    apps: { ...s.apps, [APP_ID]: fakeAppInfo() },
    data: {
      ...s.data,
      [APP_ID]: {
        ...emptyAppDataFor(APP_ID),
        pendingCacheClears: { [clear.requestId]: clear },
      },
    },
  }));
}

function pendingStorageClear(overrides: Partial<PendingStorageClear> = {}): PendingStorageClear {
  return {
    requestId: "screq-1",
    engine: "asyncStorage",
    scope: "all",
    sentAt: Date.now(),
    status: "pending",
    ...overrides,
  };
}

function seedAppWithPendingStorageClear(clear: PendingStorageClear): void {
  useConnectionStore.setState((s) => ({
    apps: { ...s.apps, [APP_ID]: fakeAppInfo() },
    data: {
      ...s.data,
      [APP_ID]: {
        ...emptyAppDataFor(APP_ID),
        pendingStorageClears: { [clear.requestId]: clear },
      },
    },
  }));
}

function pendingQueryWrite(overrides: Partial<PendingQueryWrite> = {}): PendingQueryWrite {
  return {
    requestId: "qwreq-1",
    queryHash: "hash-1",
    data: { n: 5 },
    sentAt: Date.now(),
    status: "pending",
    ...overrides,
  };
}

function seedAppWithPendingQueryWrite(write: PendingQueryWrite): void {
  useConnectionStore.setState((s) => ({
    apps: { ...s.apps, [APP_ID]: fakeAppInfo() },
    data: {
      ...s.data,
      [APP_ID]: {
        ...emptyAppDataFor(APP_ID),
        pendingQueryWrites: { [write.requestId]: write },
      },
    },
  }));
}

function pendingQueryCommand(overrides: Partial<PendingQueryCommand> = {}): PendingQueryCommand {
  return {
    requestId: "qcreq-1",
    queryHash: "hash-1",
    command: "refetch",
    sentAt: Date.now(),
    status: "pending",
    ...overrides,
  };
}

function seedAppWithPendingQueryCommand(command: PendingQueryCommand): void {
  useConnectionStore.setState((s) => ({
    apps: { ...s.apps, [APP_ID]: fakeAppInfo() },
    data: {
      ...s.data,
      [APP_ID]: {
        ...emptyAppDataFor(APP_ID),
        pendingQueryCommands: { [command.requestId]: command },
      },
    },
  }));
}

/** Mirrors connection.ts's own emptyAppData() shape — not exported, so reconstructed here for the seed helper. */
function emptyAppDataFor(_appId: string): AppData {
  return {
    navGraph: { nodes: {}, edges: {}, transitions: [] },
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
    pendingStorageClears: {},
    pendingQueryWrites: {},
    pendingQueryCommands: {},
    queriesMeta: {},
    storageMeta: {},
  };
}

beforeEach(() => {
  useConnectionStore.setState({ apps: {}, selectedAppId: null, data: {}, activeTab: "graph" });
});

describe("pendingWrites reconciliation", () => {
  it("storage/write-result ok:true marks the matching pending write applied", () => {
    seedAppWithPendingWrite(pendingWrite());

    const result = createEnvelope("storage/write-result", APP_ID, { requestId: "req-1", ok: true });
    useConnectionStore.getState().handleEnvelope(result);

    expect(useConnectionStore.getState().data[APP_ID].pendingWrites["req-1"].status).toBe("applied");
  });

  it("storage/write-result ok:false marks it failed, carrying the error through", () => {
    seedAppWithPendingWrite(pendingWrite());

    const result = createEnvelope("storage/write-result", APP_ID, {
      requestId: "req-1",
      ok: false,
      errorCode: "engine-error",
      error: "setItem rejected",
    });
    useConnectionStore.getState().handleEnvelope(result);

    const write = useConnectionStore.getState().data[APP_ID].pendingWrites["req-1"];
    expect(write.status).toBe("failed");
    expect(write.error).toBe("setItem rejected");
  });

  it("a storage/write-result for an unknown requestId is ignored, not crashing or creating a phantom entry", () => {
    seedAppWithPendingWrite(pendingWrite());

    const result = createEnvelope("storage/write-result", APP_ID, { requestId: "some-other-request", ok: true });
    expect(() => useConnectionStore.getState().handleEnvelope(result)).not.toThrow();

    const pendingWrites = useConnectionStore.getState().data[APP_ID].pendingWrites;
    expect(pendingWrites["req-1"].status).toBe("pending"); // untouched
    expect(pendingWrites["some-other-request"]).toBeUndefined();
  });

  it("a matching storage/change (same value) marks the pending write applied", () => {
    seedAppWithPendingWrite(pendingWrite({ value: "new-value" }));

    const change = createEnvelope("storage/change", APP_ID, {
      engine: "asyncStorage",
      changeType: "set",
      key: "token",
      value: "new-value",
    });
    useConnectionStore.getState().handleEnvelope(change);

    expect(useConnectionStore.getState().data[APP_ID].pendingWrites["req-1"].status).toBe("applied");
  });

  it("a non-matching storage/change for the same key marks the pending write superseded", () => {
    seedAppWithPendingWrite(pendingWrite({ value: "new-value" }));

    const change = createEnvelope("storage/change", APP_ID, {
      engine: "asyncStorage",
      changeType: "set",
      key: "token",
      value: "something-else-entirely",
    });
    useConnectionStore.getState().handleEnvelope(change);

    expect(useConnectionStore.getState().data[APP_ID].pendingWrites["req-1"].status).toBe("superseded");
  });

  it("a storage/change for a different key doesn't touch an unrelated pending write", () => {
    seedAppWithPendingWrite(pendingWrite({ key: "token" }));

    const change = createEnvelope("storage/change", APP_ID, {
      engine: "asyncStorage",
      changeType: "set",
      key: "unrelated-key",
      value: "whatever",
    });
    useConnectionStore.getState().handleEnvelope(change);

    expect(useConnectionStore.getState().data[APP_ID].pendingWrites["req-1"].status).toBe("pending");
  });

  it("markDisconnected fails every still-pending write for that app immediately", () => {
    seedAppWithPendingWrite(pendingWrite());
    // A second, already-resolved write must be left alone.
    useConnectionStore.setState((s) => ({
      data: {
        ...s.data,
        [APP_ID]: {
          ...s.data[APP_ID],
          pendingWrites: {
            ...s.data[APP_ID].pendingWrites,
            "req-2": pendingWrite({ requestId: "req-2", status: "applied" }),
          },
        },
      },
    }));

    useConnectionStore.getState().markDisconnected(APP_ID);

    const pendingWrites = useConnectionStore.getState().data[APP_ID].pendingWrites;
    expect(pendingWrites["req-1"].status).toBe("failed");
    expect(pendingWrites["req-1"].error).toBe("App disconnected");
    expect(pendingWrites["req-2"].status).toBe("applied"); // untouched — wasn't pending
  });

  it("a truncated value is rejected before ever being sent — the pending entry fails immediately", () => {
    useConnectionStore.setState((s) => ({ apps: { ...s.apps, [APP_ID]: fakeAppInfo() }, data: { ...s.data, [APP_ID]: emptyAppDataFor(APP_ID) } }));

    const truncated = { __spyglass_truncated: true, preview: "[Object]", originalType: "object" };
    useConnectionStore.getState().sendStorageWrite(APP_ID, "asyncStorage", undefined, "token", "set", { nested: truncated });

    const [entry] = Object.values(useConnectionStore.getState().data[APP_ID].pendingWrites);
    expect(entry.status).toBe("failed");
    expect(entry.error).toMatch(/truncated/i);
  });
});

describe("pendingStateWrites reconciliation (spec 0007-state)", () => {
  it("state/write-result ok:true marks the matching pending write applied", () => {
    seedAppWithPendingStateWrite(pendingStateWrite());

    const result = createEnvelope("state/write-result", APP_ID, { requestId: "sreq-1", ok: true });
    useConnectionStore.getState().handleEnvelope(result);

    expect(useConnectionStore.getState().data[APP_ID].pendingStateWrites["sreq-1"].status).toBe("applied");
  });

  it("state/write-result ok:false marks it failed, carrying the error through", () => {
    seedAppWithPendingStateWrite(pendingStateWrite());

    const result = createEnvelope("state/write-result", APP_ID, {
      requestId: "sreq-1",
      ok: false,
      errorCode: "no-store",
      error: "No attached store",
    });
    useConnectionStore.getState().handleEnvelope(result);

    const write = useConnectionStore.getState().data[APP_ID].pendingStateWrites["sreq-1"];
    expect(write.status).toBe("failed");
    expect(write.error).toBe("No attached store");
  });

  it("a state/write-result for an unknown requestId is ignored, not crashing or creating a phantom entry", () => {
    seedAppWithPendingStateWrite(pendingStateWrite());

    const result = createEnvelope("state/write-result", APP_ID, { requestId: "some-other-request", ok: true });
    expect(() => useConnectionStore.getState().handleEnvelope(result)).not.toThrow();

    const pendingStateWrites = useConnectionStore.getState().data[APP_ID].pendingStateWrites;
    expect(pendingStateWrites["sreq-1"].status).toBe("pending"); // untouched
    expect(pendingStateWrites["some-other-request"]).toBeUndefined();
  });

  it("markDisconnected fails every still-pending state write for that app immediately, leaving pendingWrites' own bookkeeping untouched", () => {
    seedAppWithPendingStateWrite(pendingStateWrite());
    useConnectionStore.getState().markDisconnected(APP_ID);

    const pendingStateWrites = useConnectionStore.getState().data[APP_ID].pendingStateWrites;
    expect(pendingStateWrites["sreq-1"].status).toBe("failed");
    expect(pendingStateWrites["sreq-1"].error).toBe("App disconnected");
  });

  it("a truncated value is rejected before ever being sent — the pending entry fails immediately", () => {
    useConnectionStore.setState((s) => ({ apps: { ...s.apps, [APP_ID]: fakeAppInfo() }, data: { ...s.data, [APP_ID]: emptyAppDataFor(APP_ID) } }));

    const truncated = { __spyglass_truncated: true, preview: "[Object]", originalType: "object" };
    useConnectionStore.getState().sendStateWrite(APP_ID, "zustand", { token: truncated });

    const [entry] = Object.values(useConnectionStore.getState().data[APP_ID].pendingStateWrites);
    expect(entry.status).toBe("failed");
    expect(entry.error).toMatch(/truncated/i);
  });
});

describe("pendingCacheClears reconciliation (spec 0008)", () => {
  it("memory/clear-cache-result ok:true marks the matching pending clear applied", () => {
    seedAppWithPendingCacheClear(pendingCacheClear());

    const result = createEnvelope("memory/clear-cache-result", APP_ID, { requestId: "creq-1", ok: true });
    useConnectionStore.getState().handleEnvelope(result);

    expect(useConnectionStore.getState().data[APP_ID].pendingCacheClears["creq-1"].status).toBe("applied");
  });

  it("memory/clear-cache-result ok:false marks it failed, carrying the error through", () => {
    seedAppWithPendingCacheClear(pendingCacheClear());

    const result = createEnvelope("memory/clear-cache-result", APP_ID, {
      requestId: "creq-1",
      ok: false,
      errorCode: "engine-error",
      error: "gc threw",
    });
    useConnectionStore.getState().handleEnvelope(result);

    const clear = useConnectionStore.getState().data[APP_ID].pendingCacheClears["creq-1"];
    expect(clear.status).toBe("failed");
    expect(clear.error).toBe("gc threw");
  });

  it("a memory/clear-cache-result for an unknown requestId is ignored, not crashing or creating a phantom entry", () => {
    seedAppWithPendingCacheClear(pendingCacheClear());

    const result = createEnvelope("memory/clear-cache-result", APP_ID, { requestId: "some-other-request", ok: true });
    expect(() => useConnectionStore.getState().handleEnvelope(result)).not.toThrow();

    const pendingCacheClears = useConnectionStore.getState().data[APP_ID].pendingCacheClears;
    expect(pendingCacheClears["creq-1"].status).toBe("pending"); // untouched
    expect(pendingCacheClears["some-other-request"]).toBeUndefined();
  });

  it("markDisconnected fails every still-pending cache clear for that app immediately", () => {
    seedAppWithPendingCacheClear(pendingCacheClear());
    useConnectionStore.getState().markDisconnected(APP_ID);

    const pendingCacheClears = useConnectionStore.getState().data[APP_ID].pendingCacheClears;
    expect(pendingCacheClears["creq-1"].status).toBe("failed");
    expect(pendingCacheClears["creq-1"].error).toBe("App disconnected");
  });

  it("sendClearCache tracks a new pending entry with no target/value", () => {
    useConnectionStore.setState((s) => ({ apps: { ...s.apps, [APP_ID]: fakeAppInfo() }, data: { ...s.data, [APP_ID]: emptyAppDataFor(APP_ID) } }));

    useConnectionStore.getState().sendClearCache(APP_ID);

    const [entry] = Object.values(useConnectionStore.getState().data[APP_ID].pendingCacheClears);
    expect(entry.status).toBe("pending");
    expect(entry.requestId).toMatch(/^cc_/);
  });
});

describe("pendingStorageClears reconciliation (spec 0014)", () => {
  it("storage/clear-result ok:true marks the matching pending clear applied", () => {
    seedAppWithPendingStorageClear(pendingStorageClear());

    const result = createEnvelope("storage/clear-result", APP_ID, { requestId: "screq-1", ok: true });
    useConnectionStore.getState().handleEnvelope(result);

    expect(useConnectionStore.getState().data[APP_ID].pendingStorageClears["screq-1"].status).toBe("applied");
  });

  it("storage/clear-result ok:false marks it failed, carrying the error and errorCode through", () => {
    seedAppWithPendingStorageClear(pendingStorageClear({ engine: "sqlite", scope: "table", table: "todos" }));

    const result = createEnvelope("storage/clear-result", APP_ID, {
      requestId: "screq-1",
      ok: false,
      errorCode: "unsupported-op",
      error: "no exec()",
    });
    useConnectionStore.getState().handleEnvelope(result);

    const clear = useConnectionStore.getState().data[APP_ID].pendingStorageClears["screq-1"];
    expect(clear.status).toBe("failed");
    expect(clear.error).toBe("no exec()");
  });

  it("a storage/clear-result for an unknown requestId is ignored, not crashing or creating a phantom entry", () => {
    seedAppWithPendingStorageClear(pendingStorageClear());

    const result = createEnvelope("storage/clear-result", APP_ID, { requestId: "some-other-request", ok: true });
    expect(() => useConnectionStore.getState().handleEnvelope(result)).not.toThrow();

    const pendingStorageClears = useConnectionStore.getState().data[APP_ID].pendingStorageClears;
    expect(pendingStorageClears["screq-1"].status).toBe("pending"); // untouched
    expect(pendingStorageClears["some-other-request"]).toBeUndefined();
  });

  it("markDisconnected fails every still-pending storage clear for that app immediately", () => {
    seedAppWithPendingStorageClear(pendingStorageClear());
    useConnectionStore.getState().markDisconnected(APP_ID);

    const pendingStorageClears = useConnectionStore.getState().data[APP_ID].pendingStorageClears;
    expect(pendingStorageClears["screq-1"].status).toBe("failed");
    expect(pendingStorageClears["screq-1"].error).toBe("App disconnected");
  });

  it("sendStorageClear tracks a new pending entry for scope: \"all\"", () => {
    useConnectionStore.setState((s) => ({ apps: { ...s.apps, [APP_ID]: fakeAppInfo() }, data: { ...s.data, [APP_ID]: emptyAppDataFor(APP_ID) } }));

    useConnectionStore.getState().sendStorageClear(APP_ID, "asyncStorage", undefined, "all");

    const [entry] = Object.values(useConnectionStore.getState().data[APP_ID].pendingStorageClears);
    expect(entry.status).toBe("pending");
    expect(entry.requestId).toMatch(/^sc_/);
    expect(entry.engine).toBe("asyncStorage");
    expect(entry.scope).toBe("all");
  });

  it("sendStorageClear tracks the table name for scope: \"table\"", () => {
    useConnectionStore.setState((s) => ({ apps: { ...s.apps, [APP_ID]: fakeAppInfo() }, data: { ...s.data, [APP_ID]: emptyAppDataFor(APP_ID) } }));

    useConnectionStore.getState().sendStorageClear(APP_ID, "sqlite", "app.db", "table", "sessions");

    const [entry] = Object.values(useConnectionStore.getState().data[APP_ID].pendingStorageClears);
    expect(entry.scope).toBe("table");
    expect(entry.table).toBe("sessions");
    expect(entry.dbName).toBe("app.db");
  });
});

describe("pendingQueryWrites reconciliation (spec 0010)", () => {
  it("query/write-result ok:true marks the matching pending write applied", () => {
    seedAppWithPendingQueryWrite(pendingQueryWrite());

    const result = createEnvelope("query/write-result", APP_ID, { requestId: "qwreq-1", ok: true });
    useConnectionStore.getState().handleEnvelope(result);

    expect(useConnectionStore.getState().data[APP_ID].pendingQueryWrites["qwreq-1"].status).toBe("applied");
  });

  it("query/write-result ok:false marks it failed, carrying the error through", () => {
    seedAppWithPendingQueryWrite(pendingQueryWrite());

    const result = createEnvelope("query/write-result", APP_ID, {
      requestId: "qwreq-1",
      ok: false,
      errorCode: "no-query",
      error: 'No query with hash "hash-1".',
    });
    useConnectionStore.getState().handleEnvelope(result);

    const write = useConnectionStore.getState().data[APP_ID].pendingQueryWrites["qwreq-1"];
    expect(write.status).toBe("failed");
    expect(write.error).toBe('No query with hash "hash-1".');
  });

  it("a query/write-result for an unknown requestId is ignored, not crashing or creating a phantom entry", () => {
    seedAppWithPendingQueryWrite(pendingQueryWrite());

    const result = createEnvelope("query/write-result", APP_ID, { requestId: "some-other-request", ok: true });
    expect(() => useConnectionStore.getState().handleEnvelope(result)).not.toThrow();

    const pendingQueryWrites = useConnectionStore.getState().data[APP_ID].pendingQueryWrites;
    expect(pendingQueryWrites["qwreq-1"].status).toBe("pending"); // untouched
    expect(pendingQueryWrites["some-other-request"]).toBeUndefined();
  });

  it("markDisconnected fails every still-pending query write for that app immediately", () => {
    seedAppWithPendingQueryWrite(pendingQueryWrite());
    useConnectionStore.getState().markDisconnected(APP_ID);

    const pendingQueryWrites = useConnectionStore.getState().data[APP_ID].pendingQueryWrites;
    expect(pendingQueryWrites["qwreq-1"].status).toBe("failed");
    expect(pendingQueryWrites["qwreq-1"].error).toBe("App disconnected");
  });

  it("a truncated value is rejected before ever being sent — the pending entry fails immediately", () => {
    useConnectionStore.setState((s) => ({ apps: { ...s.apps, [APP_ID]: fakeAppInfo() }, data: { ...s.data, [APP_ID]: emptyAppDataFor(APP_ID) } }));

    const truncated = { __spyglass_truncated: true, preview: "[Object]", originalType: "object" };
    useConnectionStore.getState().sendQueryWrite(APP_ID, "hash-1", { value: truncated });

    const [entry] = Object.values(useConnectionStore.getState().data[APP_ID].pendingQueryWrites);
    expect(entry.status).toBe("failed");
    expect(entry.error).toMatch(/truncated/i);
  });

  it("sendQueryWrite tracks a new pending entry addressed by queryHash", () => {
    useConnectionStore.setState((s) => ({ apps: { ...s.apps, [APP_ID]: fakeAppInfo() }, data: { ...s.data, [APP_ID]: emptyAppDataFor(APP_ID) } }));

    useConnectionStore.getState().sendQueryWrite(APP_ID, "hash-1", { n: 42 });

    const [entry] = Object.values(useConnectionStore.getState().data[APP_ID].pendingQueryWrites);
    expect(entry.status).toBe("pending");
    expect(entry.requestId).toMatch(/^qw_/);
    expect(entry.queryHash).toBe("hash-1");
  });

  it("an undefined value is rejected before ever being sent — it wouldn't survive the wire", () => {
    useConnectionStore.setState((s) => ({ apps: { ...s.apps, [APP_ID]: fakeAppInfo() }, data: { ...s.data, [APP_ID]: emptyAppDataFor(APP_ID) } }));

    useConnectionStore.getState().sendQueryWrite(APP_ID, "hash-1", undefined);

    const [entry] = Object.values(useConnectionStore.getState().data[APP_ID].pendingQueryWrites);
    expect(entry.status).toBe("failed");
    expect(entry.error).toMatch(/undefined/i);
  });

  it("query/write-result carries errorCode through onto the pending entry", () => {
    seedAppWithPendingQueryWrite(pendingQueryWrite());

    const result = createEnvelope("query/write-result", APP_ID, {
      requestId: "qwreq-1",
      ok: false,
      errorCode: "not-applied",
      error: "left its cached data untouched",
    });
    useConnectionStore.getState().handleEnvelope(result);

    const write = useConnectionStore.getState().data[APP_ID].pendingQueryWrites["qwreq-1"];
    expect(write.status).toBe("failed");
    expect(write.errorCode).toBe("not-applied");
    expect(write.error).toBe("left its cached data untouched");
  });
});

describe("query/change reconciliation against pendingQueryWrites (spec 0010)", () => {
  function queryChangeEnvelope(overrides: { data?: unknown; changeType?: "added" | "updated" | "removed" } = {}) {
    const { data = { n: 5 }, changeType = "updated" } = overrides;
    if (changeType === "removed") {
      return createEnvelope("query/change", APP_ID, { changeType: "removed", queryHash: "hash-1" });
    }
    return createEnvelope("query/change", APP_ID, {
      changeType,
      queryHash: "hash-1",
      query: {
        queryHash: "hash-1",
        queryKey: ["todos"],
        status: "success",
        fetchStatus: "idle",
        data,
        dataUpdatedAt: Date.now(),
        errorUpdatedAt: 0,
        isInvalidated: false,
        observersCount: 0,
      },
    });
  }

  it("a query/change reporting the same data marks a pending write applied", () => {
    seedAppWithPendingQueryWrite(pendingQueryWrite({ data: { n: 5 } }));
    useConnectionStore.getState().handleEnvelope(queryChangeEnvelope({ data: { n: 5 } }));

    expect(useConnectionStore.getState().data[APP_ID].pendingQueryWrites["qwreq-1"].status).toBe("applied");
  });

  it("a query/change reporting different data marks a pending write superseded", () => {
    seedAppWithPendingQueryWrite(pendingQueryWrite({ data: { n: 5 } }));
    useConnectionStore.getState().handleEnvelope(queryChangeEnvelope({ data: { n: 999 } }));

    expect(useConnectionStore.getState().data[APP_ID].pendingQueryWrites["qwreq-1"].status).toBe("superseded");
  });

  it("an already-applied write is superseded when the app later reports different data (the refetch-overwrite case)", () => {
    seedAppWithPendingQueryWrite(pendingQueryWrite({ data: { n: 5 }, status: "applied" }));
    useConnectionStore.getState().handleEnvelope(queryChangeEnvelope({ data: { n: 999 } }));

    expect(useConnectionStore.getState().data[APP_ID].pendingQueryWrites["qwreq-1"].status).toBe("superseded");
  });

  it("an already-applied write reporting matching data again stays applied (same reference, no needless re-render)", () => {
    seedAppWithPendingQueryWrite(pendingQueryWrite({ data: { n: 5 }, status: "applied" }));
    const before = useConnectionStore.getState().data[APP_ID].pendingQueryWrites;
    useConnectionStore.getState().handleEnvelope(queryChangeEnvelope({ data: { n: 5 } }));

    const after = useConnectionStore.getState().data[APP_ID].pendingQueryWrites;
    expect(after["qwreq-1"].status).toBe("applied");
    expect(after).toBe(before); // reference preserved — nothing actually changed
  });

  it("a removed query/change supersedes a pending/applied write for that hash", () => {
    seedAppWithPendingQueryWrite(pendingQueryWrite({ status: "applied" }));
    useConnectionStore.getState().handleEnvelope(queryChangeEnvelope({ changeType: "removed" }));

    expect(useConnectionStore.getState().data[APP_ID].pendingQueryWrites["qwreq-1"].status).toBe("superseded");
  });

  it("a query/change for a different queryHash leaves the pending write untouched", () => {
    seedAppWithPendingQueryWrite(pendingQueryWrite({ queryHash: "hash-1", data: { n: 5 } }));
    const other = createEnvelope("query/change", APP_ID, {
      changeType: "updated",
      queryHash: "hash-2",
      query: {
        queryHash: "hash-2",
        queryKey: ["other"],
        status: "success",
        fetchStatus: "idle",
        data: { n: 999 },
        dataUpdatedAt: Date.now(),
        errorUpdatedAt: 0,
        isInvalidated: false,
        observersCount: 0,
      },
    });
    useConnectionStore.getState().handleEnvelope(other);

    expect(useConnectionStore.getState().data[APP_ID].pendingQueryWrites["qwreq-1"].status).toBe("pending");
  });

  it("a query/change never resurrects an already-failed write", () => {
    seedAppWithPendingQueryWrite(pendingQueryWrite({ data: { n: 5 }, status: "failed", error: "boom" }));
    useConnectionStore.getState().handleEnvelope(queryChangeEnvelope({ data: { n: 5 } }));

    const write = useConnectionStore.getState().data[APP_ID].pendingQueryWrites["qwreq-1"];
    expect(write.status).toBe("failed");
    expect(write.error).toBe("boom");
  });
});

describe("pendingQueryCommands reconciliation (spec 0010)", () => {
  it("query/command-result ok:true marks the matching pending command applied", () => {
    seedAppWithPendingQueryCommand(pendingQueryCommand());

    const result = createEnvelope("query/command-result", APP_ID, { requestId: "qcreq-1", ok: true });
    useConnectionStore.getState().handleEnvelope(result);

    expect(useConnectionStore.getState().data[APP_ID].pendingQueryCommands["qcreq-1"].status).toBe("applied");
  });

  it("query/command-result ok:false marks it failed, carrying the error through", () => {
    seedAppWithPendingQueryCommand(pendingQueryCommand());

    const result = createEnvelope("query/command-result", APP_ID, {
      requestId: "qcreq-1",
      ok: false,
      errorCode: "engine-error",
      error: "refetch threw",
    });
    useConnectionStore.getState().handleEnvelope(result);

    const command = useConnectionStore.getState().data[APP_ID].pendingQueryCommands["qcreq-1"];
    expect(command.status).toBe("failed");
    expect(command.error).toBe("refetch threw");
  });

  it("a query/command-result for an unknown requestId is ignored, not crashing or creating a phantom entry", () => {
    seedAppWithPendingQueryCommand(pendingQueryCommand());

    const result = createEnvelope("query/command-result", APP_ID, { requestId: "some-other-request", ok: true });
    expect(() => useConnectionStore.getState().handleEnvelope(result)).not.toThrow();

    const pendingQueryCommands = useConnectionStore.getState().data[APP_ID].pendingQueryCommands;
    expect(pendingQueryCommands["qcreq-1"].status).toBe("pending"); // untouched
    expect(pendingQueryCommands["some-other-request"]).toBeUndefined();
  });

  it("markDisconnected fails every still-pending query command for that app immediately", () => {
    seedAppWithPendingQueryCommand(pendingQueryCommand());
    useConnectionStore.getState().markDisconnected(APP_ID);

    const pendingQueryCommands = useConnectionStore.getState().data[APP_ID].pendingQueryCommands;
    expect(pendingQueryCommands["qcreq-1"].status).toBe("failed");
    expect(pendingQueryCommands["qcreq-1"].error).toBe("App disconnected");
  });

  it("sendQueryCommand tracks a new pending entry with the queryHash and command kind", () => {
    useConnectionStore.setState((s) => ({ apps: { ...s.apps, [APP_ID]: fakeAppInfo() }, data: { ...s.data, [APP_ID]: emptyAppDataFor(APP_ID) } }));

    useConnectionStore.getState().sendQueryCommand(APP_ID, "hash-1", "invalidate");

    const [entry] = Object.values(useConnectionStore.getState().data[APP_ID].pendingQueryCommands);
    expect(entry.status).toBe("pending");
    expect(entry.requestId).toMatch(/^qc_/);
    expect(entry.queryHash).toBe("hash-1");
    expect(entry.command).toBe("invalidate");
  });
});

describe("queriesMeta / storageMeta bookkeeping (spec 0011)", () => {
  it("query/change records lastChangedAt for the matching queryHash", () => {
    useConnectionStore.setState((s) => ({ apps: { ...s.apps, [APP_ID]: fakeAppInfo() }, data: { ...s.data, [APP_ID]: emptyAppDataFor(APP_ID) } }));

    const change = createEnvelope("query/change", APP_ID, {
      changeType: "updated",
      queryHash: "hash-1",
      query: {
        queryHash: "hash-1",
        queryKey: ["a"],
        status: "success",
        fetchStatus: "idle",
        dataUpdatedAt: 0,
        errorUpdatedAt: 0,
        isInvalidated: false,
        observersCount: 0,
      },
    });
    useConnectionStore.getState().handleEnvelope(change);

    expect(useConnectionStore.getState().data[APP_ID].queriesMeta["hash-1"]).toEqual({ lastChangedAt: change.ts });
  });

  it("query/change keeps recording lastChangedAt even for changeType: 'removed' — it's a history, not an existence flag", () => {
    useConnectionStore.setState((s) => ({ apps: { ...s.apps, [APP_ID]: fakeAppInfo() }, data: { ...s.data, [APP_ID]: emptyAppDataFor(APP_ID) } }));

    const change = createEnvelope("query/change", APP_ID, { changeType: "removed", queryHash: "hash-1" });
    useConnectionStore.getState().handleEnvelope(change);

    expect(useConnectionStore.getState().data[APP_ID].queries["hash-1"]).toBeUndefined();
    expect(useConnectionStore.getState().data[APP_ID].queriesMeta["hash-1"]).toEqual({ lastChangedAt: change.ts });
  });

  it("storage/change records lastChangedAt for the matching engine+key", () => {
    useConnectionStore.setState((s) => ({ apps: { ...s.apps, [APP_ID]: fakeAppInfo() }, data: { ...s.data, [APP_ID]: emptyAppDataFor(APP_ID) } }));

    const change = createEnvelope("storage/change", APP_ID, { engine: "asyncStorage", changeType: "set", key: "token", value: "abc" });
    useConnectionStore.getState().handleEnvelope(change);

    expect(useConnectionStore.getState().data[APP_ID].storageMeta.asyncStorage?.token).toBe(change.ts);
  });
});
