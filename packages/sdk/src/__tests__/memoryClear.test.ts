import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEnvelope, decodeEnvelope } from "spyglass-protocol";
import type { AnyEnvelope } from "spyglass-protocol";
import type { WebSocketInstanceLike, WebSocketLike } from "../transport/ws.js";

/** Same fake as storageWrite.test.ts/stateWrite.test.ts — `init()` has no way to inject `webSocketImpl` directly, so these stub the global `WebSocket` constructor instead. */
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
  // `vi.doMock` registrations outlive `vi.resetModules()` (that only clears
  // the module cache, not the mock registry) — without these, a mock set up
  // by one test leaks into every later dynamic import() of the same
  // specifier in this file.
  vi.doUnmock("../memoryClear.js");
  vi.doUnmock("expo-image");
});

describe("inbound memory/clear-cache dispatch (spec 0008)", () => {
  it("routes a write and replies ok", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("memory/clear-cache", handle.appId, { requestId: "req-1" });
      socket.onmessage?.({ data: JSON.stringify(write) });

      const result = await waitForFrame(socket, "memory/clear-cache-result");
      expect(result.payload).toMatchObject({ requestId: "req-1", ok: true });
    } finally {
      handle.close();
    }
  });

  it("replies engine-error when clearCaches() throws", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.doMock("../memoryClear.js", () => ({
      clearCaches: () => {
        throw new Error("boom");
      },
    }));
    const { init } = await import("../index.js");

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("memory/clear-cache", handle.appId, { requestId: "req-2" });
      socket.onmessage?.({ data: JSON.stringify(write) });

      const result = await waitForFrame(socket, "memory/clear-cache-result");
      expect(result.payload).toMatchObject({ requestId: "req-2", ok: false, errorCode: "engine-error", error: "boom" });
    } finally {
      handle.close();
    }
  });

  it("ignores a write addressed to a different appId", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("memory/clear-cache", "some-other-app-id", { requestId: "req-3" });
      socket.onmessage?.({ data: JSON.stringify(write) });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(framesOfType(socket, "memory/clear-cache-result")).toHaveLength(0);
    } finally {
      handle.close();
    }
  });

  it("production: never registers the inbound handler — a memory/clear-cache goes silently unanswered", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { init } = await import("../index.js");

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("memory/clear-cache", handle.appId, { requestId: "req-4" });
      socket.onmessage?.({ data: JSON.stringify(write) });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(framesOfType(socket, "memory/clear-cache-result")).toHaveLength(0);
    } finally {
      handle.close();
    }
  });

  it("production: does not advertise the memory:clear-cache capability", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { init } = await import("../index.js");
    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();
      const hello = await waitForFrame(socket, "hello");
      expect((hello.payload as { capabilities: string[] }).capabilities).not.toContain("memory:clear-cache");
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
      expect((hello.payload as { capabilities: string[] }).capabilities).not.toContain("memory:clear-cache");
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
      expect((hello.payload as { capabilities: string[] }).capabilities).not.toContain("memory:clear-cache");
    } finally {
      handle.close();
    }
  });

  it("dev: advertises the memory:clear-cache capability", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();
      const hello = await waitForFrame(socket, "hello");
      expect((hello.payload as { capabilities: string[] }).capabilities).toContain("memory:clear-cache");
    } finally {
      handle.close();
    }
  });
});

describe("clearCaches()", () => {
  it("calls global.gc() when present", async () => {
    const gc = vi.fn();
    vi.stubGlobal("gc", gc);
    const { clearCaches } = await import("../memoryClear.js");
    await clearCaches();
    expect(gc).toHaveBeenCalledOnce();
  });

  it("doesn't throw when global.gc is absent", async () => {
    const { clearCaches } = await import("../memoryClear.js");
    await expect(clearCaches()).resolves.toBeUndefined();
  });

  it("clears expo-image's caches when the package is installed", async () => {
    const clearMemoryCache = vi.fn().mockResolvedValue(true);
    const clearDiskCache = vi.fn().mockResolvedValue(true);
    vi.doMock("expo-image", () => ({ Image: { clearMemoryCache, clearDiskCache } }));
    const { clearCaches } = await import("../memoryClear.js");
    await clearCaches();
    expect(clearMemoryCache).toHaveBeenCalledOnce();
    expect(clearDiskCache).toHaveBeenCalledOnce();
  });

  it("silently skips expo-image when it isn't installed — no throw", async () => {
    vi.doMock("expo-image", () => {
      throw new Error("Cannot find module 'expo-image'");
    });
    const { clearCaches } = await import("../memoryClear.js");
    await expect(clearCaches()).resolves.toBeUndefined();
  });
});
