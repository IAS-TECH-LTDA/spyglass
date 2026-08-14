import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnyEnvelope, StorageSnapshotPayload } from "spyglass-protocol";

/**
 * Spec 0013 — `StorageLocation` on `storage/snapshot`. Same minimal fake
 * `core` as `storageWrite.test.ts`'s `attachAsyncStorage` describe block:
 * `setCore(...)` directly rather than going through `init()`+a fake
 * WebSocket, since these adapters only need `core.transport.send` and
 * `core.registerCapability` to run.
 */

afterEach(() => {
  vi.resetModules();
});

// biome-ignore lint: minimal fake, not the real SpyglassCore/Transport shape
function fakeCore() {
  const sent: AnyEnvelope[] = [];
  const core = {
    appId: "app-1",
    transport: { send: (e: AnyEnvelope) => sent.push(e), onMessage: () => () => {} },
    registerCapability: () => {},
    markAttached: () => true,
    // biome-ignore lint: minimal fake, not the real SpyglassCore/Transport shape
  } as any;
  return { core, sent };
}

async function latestSnapshot(sent: AnyEnvelope[]): Promise<StorageSnapshotPayload> {
  await vi.waitFor(() => {
    if (!sent.some((e) => e.type === "storage/snapshot")) throw new Error("no snapshot yet");
  });
  const last = [...sent].reverse().find((e) => e.type === "storage/snapshot")!;
  return last.payload as StorageSnapshotPayload;
}

describe("attachSqlite reports an exact location via PRAGMA database_list", () => {
  it("resolves the main database's file path and marks it source: \"exact\"", async () => {
    const { setCore } = await import("../core.js");
    const { attachSqlite } = await import("../storage/sqlite.js");
    const { core, sent } = fakeCore();
    setCore(core);

    const runner = {
      query: async (sql: string) => {
        if (sql === "PRAGMA database_list") {
          return [{ seq: 0, name: "main", file: "/data/data/com.my.app/databases/app.db" }];
        }
        if (sql.startsWith("SELECT name FROM sqlite_master")) return [];
        return [];
      },
    };

    // biome-ignore lint: structural fake of SqliteQueryRunner (generic query() return type)
    const handle = attachSqlite(runner as any, { pollIntervalMs: 0 });
    try {
      const payload = await latestSnapshot(sent);
      expect(payload.location).toEqual({ path: "/data/data/com.my.app/databases/app.db", source: "exact" });
    } finally {
      handle.stop();
    }
  });

  it("omits location instead of guessing when PRAGMA database_list throws (a driver that doesn't support it)", async () => {
    const { setCore } = await import("../core.js");
    const { attachSqlite } = await import("../storage/sqlite.js");
    const { core, sent } = fakeCore();
    setCore(core);

    const runner = {
      query: async (sql: string) => {
        if (sql === "PRAGMA database_list") throw new Error("not supported");
        if (sql.startsWith("SELECT name FROM sqlite_master")) return [];
        return [];
      },
    };

    // biome-ignore lint: structural fake of SqliteQueryRunner (generic query() return type)
    const handle = attachSqlite(runner as any, { pollIntervalMs: 0 });
    try {
      const payload = await latestSnapshot(sent);
      expect(payload.location).toBeUndefined();
    } finally {
      handle.stop();
    }
  });
});

describe("attachRealm reports an exact location via realm.path", () => {
  it("includes realm.path as source: \"exact\" on every snapshot", async () => {
    const { setCore } = await import("../core.js");
    const { attachRealm } = await import("../storage/realm.js");
    const { core, sent } = fakeCore();
    setCore(core);

    const realm = {
      path: "/data/data/com.my.app/files/default.realm",
      schema: [],
      objects: () => ({ addListener: () => {}, removeAllListeners: () => {}, length: 0 }),
    };

    // biome-ignore lint: structural fake of RealmLike
    const detach = attachRealm(realm as any);
    try {
      const payload = await latestSnapshot(sent);
      expect(payload.location).toEqual({ path: "/data/data/com.my.app/files/default.realm", source: "exact" });
    } finally {
      detach();
    }
  });
});

describe("configured-only adapters (mmkv/asyncStorage/watermelondb) report source: \"configured\"", () => {
  it("attachMmkv includes the passed `path` option, marked configured", async () => {
    const { setCore } = await import("../core.js");
    const { attachMmkv } = await import("../storage/mmkv.js");
    const { core, sent } = fakeCore();
    setCore(core);

    const instance = {
      getAllKeys: () => [],
      getString: () => undefined,
      getNumber: () => undefined,
      getBoolean: () => undefined,
      set: () => {},
      delete: () => {},
    };

    // biome-ignore lint: structural fake of MMKVLike
    const detach = attachMmkv(instance as any, { path: "/data/user/0/com.my.app/files/mmkv/default" });
    try {
      const payload = await latestSnapshot(sent);
      expect(payload.location).toEqual({ path: "/data/user/0/com.my.app/files/mmkv/default", source: "configured" });
    } finally {
      detach();
    }
  });

  it("attachAsyncStorage omits location when no `path` option is given", async () => {
    const { setCore } = await import("../core.js");
    const { attachAsyncStorage } = await import("../storage/asyncStorage.js");
    const { core, sent } = fakeCore();
    setCore(core);

    const AsyncStorage = {
      getAllKeys: async () => [],
      multiGet: async () => [],
      setItem: async () => {},
      removeItem: async () => {},
      multiSet: async () => {},
      multiRemove: async () => {},
    };

    // biome-ignore lint: structural fake of AsyncStorageLike
    const detach = attachAsyncStorage(AsyncStorage as any);
    try {
      const payload = await latestSnapshot(sent);
      expect(payload.location).toBeUndefined();
    } finally {
      detach();
    }
  });
});
