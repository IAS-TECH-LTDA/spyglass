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

function createFakeAsyncStorage() {
  const map = new Map<string, string>();
  return {
    getAllKeys: async () => Array.from(map.keys()),
    multiGet: async (keys: readonly string[]) => keys.map((k): [string, string | null] => [k, map.get(k) ?? null]),
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: async (k: string) => {
      map.delete(k);
    },
    multiSet: async (pairs: [string, string][]) => {
      for (const [k, v] of pairs) map.set(k, v);
    },
    multiRemove: async (keys: string[]) => {
      for (const k of keys) map.delete(k);
    },
  };
}

function createFakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
  } as Storage;
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

describe("storage auto-attach (AsyncStorage / web Storage — no app-specific reference needed)", () => {
  afterEach(() => {
    vi.doUnmock("@react-native-async-storage/async-storage");
  });

  it("dev: attaches AsyncStorage when the package is installed", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.doMock("@react-native-async-storage/async-storage", () => ({ default: createFakeAsyncStorage() }));
    const { init } = await import("../index.js");

    const handle = init({
      appName: "Test",
      host: "localhost",
      diagnostics: false,
      autoAttach: { console: false, network: false, performance: false, storage: { asyncStorage: true } },
    });
    try {
      FakeSocket.instances[0].open();
      const hello = await waitForHello(FakeSocket.instances[0]);
      expect(hello.capabilities).toContain("storage:asyncStorage");
    } finally {
      handle.close();
    }
  });

  it("package not installed: skips silently — no throw, capability absent", async () => {
    vi.stubEnv("NODE_ENV", "development");
    // Deliberately no vi.doMock — matches "not installed" in this Node test env.
    const { init } = await import("../index.js");

    const handle = init({
      appName: "Test",
      host: "localhost",
      diagnostics: false,
      autoAttach: { console: false, network: false, performance: false, storage: { asyncStorage: true } },
    });
    try {
      FakeSocket.instances[0].open();
      const hello = await waitForHello(FakeSocket.instances[0]);
      expect(hello.capabilities).not.toContain("storage:asyncStorage");
    } finally {
      handle.close();
    }
  });

  it("dev: attaches both localStorage and sessionStorage when present as globals", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const fakeLocalStorage = createFakeStorage();
    const fakeSessionStorage = createFakeStorage();
    // `window.localStorage === globalThis.localStorage` mirrors real browsers
    // (window IS globalThis there) — attachWebStorage's own engine
    // auto-detection compares against `globalThis.localStorage`.
    vi.stubGlobal("localStorage", fakeLocalStorage);
    vi.stubGlobal("sessionStorage", fakeSessionStorage);
    vi.stubGlobal("window", { localStorage: fakeLocalStorage, sessionStorage: fakeSessionStorage });
    const { init } = await import("../index.js");

    const handle = init({
      appName: "Test",
      host: "localhost",
      diagnostics: false,
      autoAttach: { console: false, network: false, performance: false, storage: { webStorage: true } },
    });
    try {
      FakeSocket.instances[0].open();
      const hello = await waitForHello(FakeSocket.instances[0]);
      expect(hello.capabilities).toContain("storage:localStorage");
      expect(hello.capabilities).toContain("storage:sessionStorage");
    } finally {
      handle.close();
    }
  });

  it("per-engine override: storage.asyncStorage:false skips it while console/network/performance keep the dev default", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.doMock("@react-native-async-storage/async-storage", () => ({ default: createFakeAsyncStorage() }));
    const { init } = await import("../index.js");

    const handle = init({
      appName: "Test",
      host: "localhost",
      diagnostics: false,
      autoAttach: { storage: { asyncStorage: false } },
    });
    try {
      FakeSocket.instances[0].open();
      const hello = await waitForHello(FakeSocket.instances[0]);
      expect(hello.capabilities).not.toContain("storage:asyncStorage");
      expect(hello.capabilities).toEqual(expect.arrayContaining(["console", "network", "performance"]));
    } finally {
      handle.close();
    }
  });

  it("production: does not attach AsyncStorage by default", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.doMock("@react-native-async-storage/async-storage", () => ({ default: createFakeAsyncStorage() }));
    const { init } = await import("../index.js");

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false });
    try {
      FakeSocket.instances[0].open();
      const hello = await waitForHello(FakeSocket.instances[0]);
      expect(hello.capabilities).not.toContain("storage:asyncStorage");
    } finally {
      handle.close();
    }
  });

  it("close() called before the dynamic import resolves prevents the attach from taking effect afterwards", async () => {
    vi.stubEnv("NODE_ENV", "development");
    let resolveImport: () => void = () => {};
    const importGate = new Promise<void>((resolve) => {
      resolveImport = resolve;
    });
    const fakeAsyncStorage = createFakeAsyncStorage();
    const originalSetItem = fakeAsyncStorage.setItem;
    vi.doMock("@react-native-async-storage/async-storage", async () => {
      await importGate; // held open until after handle.close() below
      return { default: fakeAsyncStorage };
    });
    const { init } = await import("../index.js");

    const handle = init({
      appName: "Test",
      host: "localhost",
      diagnostics: false,
      autoAttach: { console: false, network: false, performance: false, storage: { asyncStorage: true } },
    });
    FakeSocket.instances[0].open();
    handle.close();
    resolveImport();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // If the `closed` guard didn't work, attachAsyncStorage would have
    // monkey-patched setItem after the app already considered the SDK shut
    // down — leaving it calling into a null core on every future write.
    expect(fakeAsyncStorage.setItem).toBe(originalSetItem);
  });
});

/** Minimal fake zustand module — `create(configFn)` calls it with a working `set`/`get` and returns a vanilla store, enough for `withSpyglass`'s wrapping to exercise. Also supports the curried `create<T>()(configFn)` form. */
function createFakeZustandModule() {
  function create(configOrNothing?: unknown): unknown {
    if (configOrNothing === undefined) {
      return (actualConfig: unknown) => create(actualConfig);
    }
    const configFn = configOrNothing as (set: (p: unknown, r?: boolean) => void, get: () => unknown, api: unknown) => unknown;
    let state: unknown;
    const set = (partial: unknown, replace?: boolean) => {
      const next = typeof partial === "function" ? (partial as (s: unknown) => unknown)(state) : partial;
      state = replace ? next : { ...(state as object), ...(next as object) };
    };
    const get = () => state;
    state = configFn(set, get, {});
    return { getState: get, setState: set };
  }
  return { create };
}

describe("state auto-attach (zustand — the one state manager with a single factory to patch)", () => {
  afterEach(() => {
    vi.doUnmock("zustand");
  });

  it("dev: patches zustand's create so a store made afterwards is auto-instrumented", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const fakeModule = createFakeZustandModule();
    const originalCreateRef = fakeModule.create;
    vi.doMock("zustand", () => fakeModule);
    const { init } = await import("../index.js");

    const handle = init({
      appName: "Test",
      host: "localhost",
      diagnostics: false,
      autoAttach: { console: false, network: false, performance: false, state: { zustand: true } },
    });
    try {
      // Wait for the patch to land before creating a store — creating one
      // too early (before the async import resolves) is exactly the
      // documented timing caveat, not what this test is checking.
      await vi.waitFor(
        () => {
          if (fakeModule.create === originalCreateRef) throw new Error("zustand.create not patched yet");
        },
        { timeout: 2000, interval: 10 },
      );

      fakeModule.create((set: (p: unknown) => void) => ({ count: 0 }));

      FakeSocket.instances[0].open();
      const hello = await waitForHello(FakeSocket.instances[0]);
      expect(hello.capabilities).toContain("state:zustand");
      expect(FakeSocket.instances[0].sent.some((f) => decodeEnvelope(f)?.type === "state/init")).toBe(true);
    } finally {
      handle.close();
    }
  });

  it("gives each auto-wrapped store its own storeId instead of colliding under one shared id", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const fakeModule = createFakeZustandModule();
    const originalCreateRef = fakeModule.create;
    vi.doMock("zustand", () => fakeModule);
    const { init } = await import("../index.js");

    const handle = init({
      appName: "Test",
      host: "localhost",
      diagnostics: false,
      autoAttach: { console: false, network: false, performance: false, state: { zustand: true } },
    });
    try {
      await vi.waitFor(
        () => {
          if (fakeModule.create === originalCreateRef) throw new Error("zustand.create not patched yet");
        },
        { timeout: 2000, interval: 10 },
      );

      fakeModule.create(() => ({ a: 1 }));
      fakeModule.create(() => ({ b: 2 }));

      FakeSocket.instances[0].open();
      await waitForHello(FakeSocket.instances[0]);

      const storeIds = FakeSocket.instances[0].sent
        .map((f) => decodeEnvelope(f))
        .filter((e) => e?.type === "state/init")
        .map((e) => (e!.payload as { storeId: string }).storeId);
      expect(new Set(storeIds).size).toBe(2); // distinct ids — one store's data can't overwrite the other's in the desktop's per-storeId map
    } finally {
      handle.close();
    }
  });

  it("package not installed: skips silently — no throw, capability absent", async () => {
    vi.stubEnv("NODE_ENV", "development");
    // Deliberately no vi.doMock — matches "not installed" in this Node test env.
    const { init } = await import("../index.js");

    const handle = init({
      appName: "Test",
      host: "localhost",
      diagnostics: false,
      autoAttach: { console: false, network: false, performance: false, state: { zustand: true } },
    });
    try {
      FakeSocket.instances[0].open();
      const hello = await waitForHello(FakeSocket.instances[0]);
      expect(hello.capabilities).not.toContain("state:zustand");
    } finally {
      handle.close();
    }
  });

  it("read-only export (simulated strict-ESM bundler): fails safe, no throw, capability absent", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const readonlyModule: Record<string, unknown> = {};
    Object.defineProperty(readonlyModule, "create", { value: () => ({}), writable: false, configurable: false });
    vi.doMock("zustand", () => readonlyModule);
    const { init } = await import("../index.js");

    const handle = init({
      appName: "Test",
      host: "localhost",
      diagnostics: false,
      autoAttach: { console: false, network: false, performance: false, state: { zustand: true } },
    });
    try {
      FakeSocket.instances[0].open();
      const hello = await waitForHello(FakeSocket.instances[0]);
      expect(hello.capabilities).not.toContain("state:zustand");
    } finally {
      handle.close();
    }
  });

  it("per-manager override: state.zustand:false skips it while console/network/performance keep the dev default", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const fakeModule = createFakeZustandModule();
    vi.doMock("zustand", () => fakeModule);
    const { init } = await import("../index.js");

    const handle = init({
      appName: "Test",
      host: "localhost",
      diagnostics: false,
      autoAttach: { state: { zustand: false } },
    });
    try {
      FakeSocket.instances[0].open();
      const hello = await waitForHello(FakeSocket.instances[0]);
      expect(hello.capabilities).not.toContain("state:zustand");
      expect(hello.capabilities).toEqual(expect.arrayContaining(["console", "network", "performance"]));
    } finally {
      handle.close();
    }
  });

  it("production: does not attach zustand by default", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fakeModule = createFakeZustandModule();
    vi.doMock("zustand", () => fakeModule);
    const { init } = await import("../index.js");

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false });
    try {
      FakeSocket.instances[0].open();
      const hello = await waitForHello(FakeSocket.instances[0]);
      expect(hello.capabilities).not.toContain("state:zustand");
    } finally {
      handle.close();
    }
  });
});
