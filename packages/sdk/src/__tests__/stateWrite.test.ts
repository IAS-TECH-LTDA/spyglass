import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEnvelope, decodeEnvelope } from "spyglass-protocol";
import type { AnyEnvelope } from "spyglass-protocol";
import type { WebSocketInstanceLike, WebSocketLike } from "../transport/ws.js";

/** Same fake as storageWrite.test.ts/transport.test.ts/autoAttach.test.ts — `init()` has no way to inject `webSocketImpl` directly, so these stub the global `WebSocket` constructor instead. */
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

describe("inbound state/write dispatch (spec 0007-state)", () => {
  it("routes a write to the registered handler and replies ok", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { registerStateWriteHandler } = await import("../commands.js");

    const received: unknown[] = [];
    registerStateWriteHandler("counter", (nextState) => {
      received.push(nextState);
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("state/write", handle.appId, {
        requestId: "req-1",
        storeId: "counter",
        state: { count: 5 },
      });
      socket.onmessage?.({ data: JSON.stringify(write) });

      const result = await waitForFrame(socket, "state/write-result");
      expect(received).toEqual([{ count: 5 }]);
      expect(result.payload).toMatchObject({ requestId: "req-1", ok: true });
    } finally {
      handle.close();
    }
  });

  it("replies no-store when nothing is registered for that storeId", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("state/write", handle.appId, {
        requestId: "req-2",
        storeId: "unknown-store",
        state: { x: 1 },
      });
      socket.onmessage?.({ data: JSON.stringify(write) });

      const result = await waitForFrame(socket, "state/write-result");
      expect(result.payload).toMatchObject({ requestId: "req-2", ok: false, errorCode: "no-store" });
    } finally {
      handle.close();
    }
  });

  it("replies engine-error when the handler throws", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { registerStateWriteHandler } = await import("../commands.js");

    registerStateWriteHandler("boom", () => {
      throw new Error("nope");
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("state/write", handle.appId, {
        requestId: "req-3",
        storeId: "boom",
        state: { x: 1 },
      });
      socket.onmessage?.({ data: JSON.stringify(write) });

      const result = await waitForFrame(socket, "state/write-result");
      expect(result.payload).toMatchObject({ requestId: "req-3", ok: false, errorCode: "engine-error", error: "nope" });
    } finally {
      handle.close();
    }
  });

  it("ignores a write addressed to a different appId", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { registerStateWriteHandler } = await import("../commands.js");

    const received: unknown[] = [];
    registerStateWriteHandler("counter", (nextState) => {
      received.push(nextState);
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("state/write", "some-other-app-id", {
        requestId: "req-4",
        storeId: "counter",
        state: { count: 1 },
      });
      socket.onmessage?.({ data: JSON.stringify(write) });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(received).toHaveLength(0);
      expect(framesOfType(socket, "state/write-result")).toHaveLength(0);
    } finally {
      handle.close();
    }
  });

  it("production: never registers the inbound handler — a state/write goes silently unanswered", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { init } = await import("../index.js");
    const { registerStateWriteHandler } = await import("../commands.js");

    const received: unknown[] = [];
    registerStateWriteHandler("counter", (nextState) => {
      received.push(nextState);
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("state/write", handle.appId, {
        requestId: "req-5",
        storeId: "counter",
        state: { count: 1 },
      });
      socket.onmessage?.({ data: JSON.stringify(write) });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(received).toHaveLength(0); // the handler was never invoked
      expect(framesOfType(socket, "state/write-result")).toHaveLength(0); // and nothing replied at all
    } finally {
      handle.close();
    }
  });

  it("production: does not advertise the state:write capability", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { init } = await import("../index.js");
    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();
      const hello = await waitForFrame(socket, "hello");
      expect((hello.payload as { capabilities: string[] }).capabilities).not.toContain("state:write");
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
      expect((hello.payload as { capabilities: string[] }).capabilities).not.toContain("state:write");
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
      expect((hello.payload as { capabilities: string[] }).capabilities).not.toContain("state:write");
    } finally {
      handle.close();
    }
  });

  it("dev: advertises the state:write capability", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();
      const hello = await waitForFrame(socket, "hello");
      expect((hello.payload as { capabilities: string[] }).capabilities).toContain("state:write");
    } finally {
      handle.close();
    }
  });
});

describe("withSpyglass (zustand) write-through", () => {
  it("routes an inbound write through the wrapped set(), shallow-merging and emitting a state/action", async () => {
    const { setCore } = await import("../core.js");
    const { withSpyglass } = await import("../state/zustand.js");
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

    // Minimal hand-rolled zustand-shaped store — withSpyglass only needs
    // set/get/api, not a real zustand `create()`.
    let state = { count: 0, label: "hi", increment: () => set((s: { count: number }) => ({ count: s.count + 1 })) };
    function set(partial: unknown, replace?: boolean): void {
      if (replace) {
        state = { ...(partial as typeof state) };
      } else {
        const patch = typeof partial === "function" ? (partial as (s: typeof state) => Partial<typeof state>)(state) : partial;
        state = { ...state, ...(patch as Partial<typeof state>) };
      }
    }
    function get(): typeof state {
      return state;
    }

    const creator = withSpyglass<typeof state>((s, g) => ({
      count: 0,
      label: "hi",
      increment: () => s((prev) => ({ count: prev.count + 1 })),
    }));
    state = creator(set as never, get as never, {});

    const write = createEnvelope("state/write", "app-1", {
      requestId: "req-1",
      storeId: "zustand",
      state: { count: 42 },
    });
    messageHandler?.(write);

    await vi.waitFor(() => {
      if (!sent.some((e) => e.type === "state/write-result")) throw new Error("no result yet");
    });

    // Shallow merge: count updated, but `label`/`increment` (never sent by
    // the desktop, since it only knows the serialized half of the store)
    // survive untouched — a `replace: true` would have wiped them out.
    expect(state.count).toBe(42);
    expect(state.label).toBe("hi");
    expect(typeof state.increment).toBe("function");
    expect(sent.some((e) => e.type === "state/action")).toBe(true);
    const result = sent.find((e) => e.type === "state/write-result")!;
    expect(result.payload).toMatchObject({ requestId: "req-1", ok: true });
  });
});
