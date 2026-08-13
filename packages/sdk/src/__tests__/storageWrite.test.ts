import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEnvelope, decodeEnvelope } from "spyglass-protocol";
import type { AnyEnvelope } from "spyglass-protocol";
import type { WebSocketInstanceLike, WebSocketLike } from "../transport/ws.js";

/** Same fake as transport.test.ts/autoAttach.test.ts — `init()` has no way to inject `webSocketImpl` directly, so these stub the global `WebSocket` constructor instead. */
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

describe("inbound storage/write dispatch (spec 0007)", () => {
  it("routes a write to the registered handler and replies ok", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { registerStorageWriteHandler } = await import("../commands.js");

    const received: Array<[string, string, unknown]> = [];
    const unregister = registerStorageWriteHandler("asyncStorage", undefined, (op, key, value) => {
      received.push([op, key, value]);
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("storage/write", handle.appId, {
        requestId: "req-1",
        engine: "asyncStorage",
        key: "token",
        op: "set",
        value: "abc",
      });
      socket.onmessage?.({ data: JSON.stringify(write) });

      const result = await waitForFrame(socket, "storage/write-result");
      expect(received).toEqual([["set", "token", "abc"]]);
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

      const write = createEnvelope("storage/write", handle.appId, {
        requestId: "req-2",
        engine: "mmkv",
        key: "x",
        op: "set",
        value: 1,
      });
      socket.onmessage?.({ data: JSON.stringify(write) });

      const result = await waitForFrame(socket, "storage/write-result");
      expect(result.payload).toMatchObject({ requestId: "req-2", ok: false, errorCode: "no-adapter" });
    } finally {
      handle.close();
    }
  });

  it("ignores a write addressed to a different appId", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { registerStorageWriteHandler } = await import("../commands.js");

    const received: unknown[] = [];
    const unregister = registerStorageWriteHandler("asyncStorage", undefined, (op, key, value) => {
      received.push([op, key, value]);
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("storage/write", "some-other-app-id", {
        requestId: "req-3",
        engine: "asyncStorage",
        key: "x",
        op: "set",
        value: 1,
      });
      socket.onmessage?.({ data: JSON.stringify(write) });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(received).toHaveLength(0);
      expect(framesOfType(socket, "storage/write-result")).toHaveLength(0);
    } finally {
      unregister();
      handle.close();
    }
  });

  it("production: never registers the inbound handler — a storage/write goes silently unanswered, not just unhandled by a specific adapter", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { init } = await import("../index.js");
    const { registerStorageWriteHandler } = await import("../commands.js");

    const received: unknown[] = [];
    const unregister = registerStorageWriteHandler("asyncStorage", undefined, (op, key, value) => {
      received.push([op, key, value]);
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("storage/write", handle.appId, {
        requestId: "req-4",
        engine: "asyncStorage",
        key: "x",
        op: "set",
        value: 1,
      });
      socket.onmessage?.({ data: JSON.stringify(write) });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(received).toHaveLength(0); // the adapter's handler was never invoked
      expect(framesOfType(socket, "storage/write-result")).toHaveLength(0); // and nothing replied at all
    } finally {
      unregister();
      handle.close();
    }
  });

  it("production: does not advertise the storage:write capability", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { init } = await import("../index.js");
    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();
      const hello = await waitForFrame(socket, "hello");
      expect((hello.payload as { capabilities: string[] }).capabilities).not.toContain("storage:write");
    } finally {
      handle.close();
    }
  });

  it("allowRemoteWrites: true does NOT force it on in production — a hard gate, unlike autoAttach", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { init } = await import("../index.js");
    const handle = init({
      appName: "Test",
      host: "localhost",
      diagnostics: false,
      autoAttach: false,
      allowRemoteWrites: true,
    });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();
      const hello = await waitForFrame(socket, "hello");
      expect((hello.payload as { capabilities: string[] }).capabilities).not.toContain("storage:write");
    } finally {
      handle.close();
    }
  });

  it("allowRemoteWrites: false disables it even in dev", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const handle = init({
      appName: "Test",
      host: "localhost",
      diagnostics: false,
      autoAttach: false,
      allowRemoteWrites: false,
    });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();
      const hello = await waitForFrame(socket, "hello");
      expect((hello.payload as { capabilities: string[] }).capabilities).not.toContain("storage:write");
    } finally {
      handle.close();
    }
  });

  it("dev: advertises the storage:write capability", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();
      const hello = await waitForFrame(socket, "hello");
      expect((hello.payload as { capabilities: string[] }).capabilities).toContain("storage:write");
    } finally {
      handle.close();
    }
  });
});

describe("attachAsyncStorage write-through", () => {
  it("routes an inbound write through the patched setItem, emitting exactly one storage/change (no double-emit)", async () => {
    const { setCore } = await import("../core.js");
    const { attachAsyncStorage } = await import("../storage/asyncStorage.js");
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

    const store = new Map<string, string>();
    const AsyncStorage = {
      getAllKeys: async () => Array.from(store.keys()),
      multiGet: async (keys: readonly string[]) => keys.map((k) => [k, store.get(k) ?? null] as [string, string | null]),
      setItem: async (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: async (k: string) => {
        store.delete(k);
      },
      multiSet: async (pairs: [string, string][]) => {
        for (const [k, v] of pairs) store.set(k, v);
      },
      multiRemove: async (keys: string[]) => {
        for (const k of keys) store.delete(k);
      },
    };

    // biome-ignore lint: structural fake of AsyncStorageLike
    const detach = attachAsyncStorage(AsyncStorage as any);
    try {
      await vi.waitFor(() => {
        if (!sent.some((e) => e.type === "storage/snapshot")) throw new Error("no snapshot yet");
      });
      sent.length = 0; // drop the initial snapshot, only care about what the write itself produces

      const write = createEnvelope("storage/write", "app-1", {
        requestId: "req-1",
        engine: "asyncStorage",
        key: "token",
        op: "set",
        value: "abc",
      });
      messageHandler?.(write);

      await vi.waitFor(() => {
        if (!sent.some((e) => e.type === "storage/write-result")) throw new Error("no result yet");
      });

      expect(store.get("token")).toBe("abc"); // the real write happened, through the patched setItem
      expect(sent.filter((e) => e.type === "storage/change")).toHaveLength(1);
      const result = sent.find((e) => e.type === "storage/write-result")!;
      expect(result.payload).toMatchObject({ requestId: "req-1", ok: true });
    } finally {
      detach();
    }
  });
});
