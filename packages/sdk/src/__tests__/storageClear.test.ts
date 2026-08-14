import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEnvelope, decodeEnvelope } from "spyglass-protocol";
import type { AnyEnvelope } from "spyglass-protocol";
import type { WebSocketInstanceLike, WebSocketLike } from "../transport/ws.js";

/**
 * Spec 0014 — `storage/clear`. Same fake socket and gate-testing shape as
 * `storageWrite.test.ts` (dev-only registration, appId scoping, capability
 * advertisement), plus the per-engine `unsupported-op` distinction that's
 * new to this pair.
 */
class FakeSocket implements WebSocketInstanceLike {
  static instances: FakeSocket[] = [];
  readyState = 0; // CONNECTING
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  open(): void {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }
}

function framesOfType(socket: FakeSocket, type: string): AnyEnvelope[] {
  return socket.sent.map((f) => decodeEnvelope(f)).filter((e): e is AnyEnvelope => e?.type === type);
}

async function waitForFrame(socket: FakeSocket, type: string): Promise<AnyEnvelope> {
  await vi.waitFor(
    () => {
      if (framesOfType(socket, type).length === 0) throw new Error(`no "${type}" frame yet`);
    },
    { timeout: 2000, interval: 10 },
  );
  return framesOfType(socket, type)[0];
}

beforeEach(() => {
  vi.resetModules();
  FakeSocket.instances.length = 0;
  vi.stubGlobal("WebSocket", FakeSocket as unknown as WebSocketLike);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("inbound storage/clear dispatch (spec 0014)", () => {
  it("routes a clear to the registered handler and replies ok", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { registerStorageClearHandler } = await import("../commands.js");

    const received: Array<["all" | "table", string | undefined]> = [];
    const unregister = registerStorageClearHandler("asyncStorage", undefined, (scope, table) => {
      received.push([scope, table]);
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const clear = createEnvelope("storage/clear", handle.appId, { requestId: "req-1", engine: "asyncStorage", scope: "all" });
      socket.onmessage?.({ data: JSON.stringify(clear) });

      const result = await waitForFrame(socket, "storage/clear-result");
      expect(received).toEqual([["all", undefined]]);
      expect(result.payload).toMatchObject({ requestId: "req-1", ok: true });
    } finally {
      unregister();
      handle.close();
    }
  });

  it("replies no-adapter when nothing is registered for that engine", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const clear = createEnvelope("storage/clear", handle.appId, { requestId: "req-2", engine: "mmkv", scope: "all" });
      socket.onmessage?.({ data: JSON.stringify(clear) });

      const result = await waitForFrame(socket, "storage/clear-result");
      expect(result.payload).toMatchObject({ requestId: "req-2", ok: false, errorCode: "no-adapter" });
    } finally {
      handle.close();
    }
  });

  it("replies unsupported-op (not engine-error) when the handler throws StorageClearUnsupportedError", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { registerStorageClearHandler, StorageClearUnsupportedError } = await import("../commands.js");

    const unregister = registerStorageClearHandler("sqlite", undefined, () => {
      throw new StorageClearUnsupportedError("no exec()");
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const clear = createEnvelope("storage/clear", handle.appId, { requestId: "req-3", engine: "sqlite", scope: "all" });
      socket.onmessage?.({ data: JSON.stringify(clear) });

      const result = await waitForFrame(socket, "storage/clear-result");
      expect(result.payload).toMatchObject({ requestId: "req-3", ok: false, errorCode: "unsupported-op", error: "no exec()" });
    } finally {
      unregister();
      handle.close();
    }
  });

  it("replies engine-error (not unsupported-op) for any other thrown error", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { registerStorageClearHandler } = await import("../commands.js");

    const unregister = registerStorageClearHandler("sqlite", undefined, () => {
      throw new Error("disk full");
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const clear = createEnvelope("storage/clear", handle.appId, { requestId: "req-4", engine: "sqlite", scope: "all" });
      socket.onmessage?.({ data: JSON.stringify(clear) });

      const result = await waitForFrame(socket, "storage/clear-result");
      expect(result.payload).toMatchObject({ requestId: "req-4", ok: false, errorCode: "engine-error", error: "disk full" });
    } finally {
      unregister();
      handle.close();
    }
  });

  it("ignores a clear addressed to a different appId", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { registerStorageClearHandler } = await import("../commands.js");

    const received: unknown[] = [];
    const unregister = registerStorageClearHandler("asyncStorage", undefined, (scope) => {
      received.push(scope);
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const clear = createEnvelope("storage/clear", "some-other-app-id", { requestId: "req-5", engine: "asyncStorage", scope: "all" });
      socket.onmessage?.({ data: JSON.stringify(clear) });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(received).toHaveLength(0);
      expect(framesOfType(socket, "storage/clear-result")).toHaveLength(0);
    } finally {
      unregister();
      handle.close();
    }
  });

  it("production: never registers the inbound handler — a storage/clear goes silently unanswered", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { init } = await import("../index.js");
    const { registerStorageClearHandler } = await import("../commands.js");

    const received: unknown[] = [];
    const unregister = registerStorageClearHandler("asyncStorage", undefined, (scope) => {
      received.push(scope);
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const clear = createEnvelope("storage/clear", handle.appId, { requestId: "req-6", engine: "asyncStorage", scope: "all" });
      socket.onmessage?.({ data: JSON.stringify(clear) });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(received).toHaveLength(0); // the adapter's handler was never invoked
      expect(framesOfType(socket, "storage/clear-result")).toHaveLength(0); // and nothing replied at all
    } finally {
      unregister();
      handle.close();
    }
  });

  it("production: does not advertise the storage:clear capability", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { init } = await import("../index.js");
    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();
      const hello = await waitForFrame(socket, "hello");
      expect((hello.payload as { capabilities: string[] }).capabilities).not.toContain("storage:clear");
    } finally {
      handle.close();
    }
  });

  it("dev: advertises the storage:clear capability", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();
      const hello = await waitForFrame(socket, "hello");
      expect((hello.payload as { capabilities: string[] }).capabilities).toContain("storage:clear");
    } finally {
      handle.close();
    }
  });
});

describe("attachSqlite clear support", () => {
  it("without exec(), the registered handler throws StorageClearUnsupportedError -> unsupported-op", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { setCore } = await import("../core.js");
    const { attachSqlite } = await import("../storage/sqlite.js");
    const { enableInboundCommands } = await import("../commands.js");

    const sent: AnyEnvelope[] = [];
    let messageHandler: ((e: AnyEnvelope) => void) | undefined;
    const core = {
      appId: "app-1",
      transport: {
        send: (e: AnyEnvelope) => sent.push(e),
        onMessage: (h: (e: AnyEnvelope) => void) => {
          messageHandler = h;
          return () => {
            messageHandler = undefined;
          };
        },
      },
      registerCapability: () => {},
      markAttached: () => true,
      // biome-ignore lint: minimal fake, not the real SpyglassCore/Transport shape
    } as any;
    setCore(core);
    enableInboundCommands(core);

    // biome-ignore lint: structural fake of SqliteQueryRunner, no exec()
    const runner = { query: async () => [] } as any;
    const handle = attachSqlite(runner, { pollIntervalMs: 0 });
    try {
      await vi.waitFor(() => {
        if (!sent.some((e) => e.type === "storage/snapshot")) throw new Error("no snapshot yet");
      });

      const clear = createEnvelope("storage/clear", "app-1", { requestId: "req-1", engine: "sqlite", scope: "all" });
      messageHandler?.(clear);

      await vi.waitFor(() => {
        if (!sent.some((e) => e.type === "storage/clear-result")) throw new Error("no result yet");
      });
      const result = sent.find((e) => e.type === "storage/clear-result")!;
      expect(result.payload).toMatchObject({ requestId: "req-1", ok: false, errorCode: "unsupported-op" });
    } finally {
      handle.stop();
    }
  });

  it("with exec(), DELETEs every table for scope: \"all\" and re-snapshots", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { setCore } = await import("../core.js");
    const { attachSqlite } = await import("../storage/sqlite.js");
    const { enableInboundCommands } = await import("../commands.js");

    const sent: AnyEnvelope[] = [];
    let messageHandler: ((e: AnyEnvelope) => void) | undefined;
    const core = {
      appId: "app-1",
      transport: {
        send: (e: AnyEnvelope) => sent.push(e),
        onMessage: (h: (e: AnyEnvelope) => void) => {
          messageHandler = h;
          return () => {
            messageHandler = undefined;
          };
        },
      },
      registerCapability: () => {},
      markAttached: () => true,
      // biome-ignore lint: minimal fake, not the real SpyglassCore/Transport shape
    } as any;
    setCore(core);
    enableInboundCommands(core);

    let rows = [{ id: 1 }];
    const execCalls: string[] = [];
    const runner = {
      query: async (sql: string) => {
        if (sql === "PRAGMA database_list") return [];
        if (sql.startsWith("SELECT name FROM sqlite_master")) return [{ name: "todos" }];
        if (sql.startsWith("PRAGMA table_info")) return [{ name: "id", type: "integer", pk: 1 }];
        if (sql.startsWith("SELECT * FROM")) return rows;
        return [];
      },
      exec: async (sql: string) => {
        execCalls.push(sql);
        rows = [];
      },
      // biome-ignore lint: structural fake of SqliteQueryRunner
    } as any;

    const handle = attachSqlite(runner, { pollIntervalMs: 0 });
    try {
      await vi.waitFor(() => {
        if (!sent.some((e) => e.type === "storage/snapshot")) throw new Error("no snapshot yet");
      });

      const clear = createEnvelope("storage/clear", "app-1", { requestId: "req-1", engine: "sqlite", scope: "all" });
      messageHandler?.(clear);

      await vi.waitFor(() => {
        if (!sent.some((e) => e.type === "storage/clear-result")) throw new Error("no result yet");
      });
      const result = sent.find((e) => e.type === "storage/clear-result")!;
      expect(result.payload).toMatchObject({ requestId: "req-1", ok: true });
      expect(execCalls).toEqual(['DELETE FROM "todos"']);

      // Re-snapshots after clearing, without waiting for the next poll tick.
      const snapshots = sent.filter((e) => e.type === "storage/snapshot");
      const lastSnapshot = snapshots[snapshots.length - 1];
      expect((lastSnapshot.payload as { rows: Record<string, unknown[]> }).rows).toEqual({ todos: [] });
    } finally {
      handle.stop();
    }
  });
});
