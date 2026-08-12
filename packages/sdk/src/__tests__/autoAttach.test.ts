import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeEnvelope } from "spyglass-protocol";
import type { HelloPayload } from "spyglass-protocol";
import type { WebSocketInstanceLike, WebSocketLike } from "../transport/ws.js";

/** Minimal fake WebSocket, same shape as transport.test.ts's — `init()` has
 * no way to inject `webSocketImpl` directly, so these tests stub the global
 * `WebSocket` constructor instead. */
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

/**
 * `sendHello()` awaits `detectPlatform()`/`detectFramework()`, each doing a
 * dynamic `import()` that's expected to fail in this Node test environment
 * (no `react-native`/`expo-constants` installed) — how many ticks that
 * rejection takes isn't guaranteed, so poll for the `hello` frame instead of
 * racing a fixed delay.
 */
async function waitForHello(socket: FakeSocket): Promise<HelloPayload> {
  await vi.waitFor(
    () => {
      if (!socket.sent.some((frame) => decodeEnvelope(frame)?.type === "hello")) {
        throw new Error("hello not sent yet");
      }
    },
    { timeout: 2000, interval: 10 },
  );
  const frame = socket.sent.find((f) => decodeEnvelope(f)?.type === "hello")!;
  return decodeEnvelope(frame)!.payload as HelloPayload;
}

function logEntryCount(socket: FakeSocket): number {
  return socket.sent.filter((frame) => decodeEnvelope(frame)?.type === "log/entry").length;
}

beforeEach(() => {
  vi.resetModules();
  FakeSocket.instances.length = 0;
  vi.stubGlobal("WebSocket", FakeSocket as unknown as WebSocketLike);
  // attachPerformance() (auto-attached in these tests) schedules a rAF loop;
  // Node has no such global, unlike every real RN/browser runtime it
  // targets. Cancelled via `handle.close()` in every test's `finally` —
  // never left dangling, or a leaked recursive setTimeout would eventually
  // fire in a *later* test, after these stubs are already torn down.
  vi.stubGlobal(
    "requestAnimationFrame",
    (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number,
  );
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => clearTimeout(handle));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("auto-attach (console/network/performance)", () => {
  it("attaches all three by default in a dev-style environment", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false });
    try {
      FakeSocket.instances[0].open();
      const hello = await waitForHello(FakeSocket.instances[0]);
      expect(hello.capabilities).toEqual(expect.arrayContaining(["console", "network", "performance"]));
    } finally {
      handle.close();
    }
  });

  it("attaches none of the three by default in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { init } = await import("../index.js");

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false });
    try {
      FakeSocket.instances[0].open();
      const hello = await waitForHello(FakeSocket.instances[0]);
      expect(hello.capabilities).not.toContain("console");
      expect(hello.capabilities).not.toContain("network");
      expect(hello.capabilities).not.toContain("performance");
    } finally {
      handle.close();
    }
  });

  it("a per-capability override wins over the dev default", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");

    const handle = init({
      appName: "Test",
      host: "localhost",
      diagnostics: false,
      autoAttach: { network: false },
    });
    try {
      FakeSocket.instances[0].open();
      const hello = await waitForHello(FakeSocket.instances[0]);
      expect(hello.capabilities).toContain("console");
      expect(hello.capabilities).toContain("performance");
      expect(hello.capabilities).not.toContain("network");
    } finally {
      handle.close();
    }
  });

  it("a per-capability override wins over the production default", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { init } = await import("../index.js");

    const handle = init({
      appName: "Test",
      host: "localhost",
      diagnostics: false,
      autoAttach: { console: true },
    });
    try {
      FakeSocket.instances[0].open();
      const hello = await waitForHello(FakeSocket.instances[0]);
      expect(hello.capabilities).toContain("console");
      expect(hello.capabilities).not.toContain("network");
      expect(hello.capabilities).not.toContain("performance");
    } finally {
      handle.close();
    }
  });

  it("a blanket true forces all three on even in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { init } = await import("../index.js");

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: true });
    try {
      FakeSocket.instances[0].open();
      const hello = await waitForHello(FakeSocket.instances[0]);
      expect(hello.capabilities).toEqual(expect.arrayContaining(["console", "network", "performance"]));
    } finally {
      handle.close();
    }
  });

  it("a blanket false forces all three off even in dev", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      FakeSocket.instances[0].open();
      const hello = await waitForHello(FakeSocket.instances[0]);
      expect(hello.capabilities).not.toContain("console");
      expect(hello.capabilities).not.toContain("network");
      expect(hello.capabilities).not.toContain("performance");
    } finally {
      handle.close();
    }
  });

  it("calling attachConsole() manually after auto-attach is a safe no-op — no duplicate log/entry", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { attachConsole } = await import("../console.js");

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false });
    try {
      FakeSocket.instances[0].open();
      await waitForHello(FakeSocket.instances[0]);

      const detach = attachConsole(); // manual call on top of the auto-attach
      console.log("hello from the test");
      detach();

      expect(logEntryCount(FakeSocket.instances[0])).toBe(1);
    } finally {
      handle.close();
    }
  });

  it("re-runs auto-attach from scratch on a fresh core after close() + init()", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");

    const first = init({ appName: "Test", host: "localhost", diagnostics: false });
    try {
      FakeSocket.instances[0].open();
      const firstHello = await waitForHello(FakeSocket.instances[0]);
      expect(firstHello.capabilities).toEqual(expect.arrayContaining(["console", "network", "performance"]));
    } finally {
      first.close();
    }

    const second = init({ appName: "Test", host: "localhost", diagnostics: false });
    try {
      FakeSocket.instances[1].open();
      const secondHello = await waitForHello(FakeSocket.instances[1]);
      expect(secondHello.capabilities).toEqual(expect.arrayContaining(["console", "network", "performance"]));
    } finally {
      second.close();
    }
  });
});
