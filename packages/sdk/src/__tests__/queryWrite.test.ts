import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEnvelope, decodeEnvelope } from "spyglass-protocol";
import type { AnyEnvelope, QueryCommandKind } from "spyglass-protocol";
import type { WebSocketInstanceLike, WebSocketLike } from "../transport/ws.js";

/** Same fake as stateWrite.test.ts/storageWrite.test.ts/transport.test.ts — `init()` has no way to inject `webSocketImpl` directly, so these stub the global `WebSocket` constructor instead. */
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

describe("inbound query/write dispatch (spec 0010)", () => {
  it("routes a write to the registered handler and replies ok", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { registerQueryWriteHandler } = await import("../commands.js");

    const received: unknown[] = [];
    registerQueryWriteHandler((queryHash, data) => {
      received.push([queryHash, data]);
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("query/write", handle.appId, { requestId: "req-1", queryHash: "hash-1", data: { n: 5 } });
      socket.onmessage?.({ data: JSON.stringify(write) });

      const result = await waitForFrame(socket, "query/write-result");
      expect(received).toEqual([["hash-1", { n: 5 }]]);
      expect(result.payload).toMatchObject({ requestId: "req-1", ok: true });
    } finally {
      handle.close();
    }
  });

  it("replies no-adapter when no attachReactQuery has run", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("query/write", handle.appId, { requestId: "req-2", queryHash: "hash-1", data: 1 });
      socket.onmessage?.({ data: JSON.stringify(write) });

      const result = await waitForFrame(socket, "query/write-result");
      expect(result.payload).toMatchObject({ requestId: "req-2", ok: false, errorCode: "no-adapter" });
    } finally {
      handle.close();
    }
  });

  it("replies no-query when the handler throws QueryNotFoundError", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { registerQueryWriteHandler, QueryNotFoundError } = await import("../commands.js");

    registerQueryWriteHandler((queryHash) => {
      throw new QueryNotFoundError(`No query with hash "${queryHash}".`);
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("query/write", handle.appId, { requestId: "req-3", queryHash: "missing", data: 1 });
      socket.onmessage?.({ data: JSON.stringify(write) });

      const result = await waitForFrame(socket, "query/write-result");
      expect(result.payload).toMatchObject({ requestId: "req-3", ok: false, errorCode: "no-query" });
    } finally {
      handle.close();
    }
  });

  it("replies engine-error when the handler throws a non-QueryNotFoundError", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { registerQueryWriteHandler } = await import("../commands.js");

    registerQueryWriteHandler(() => {
      throw new Error("nope");
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("query/write", handle.appId, { requestId: "req-4", queryHash: "hash-1", data: 1 });
      socket.onmessage?.({ data: JSON.stringify(write) });

      const result = await waitForFrame(socket, "query/write-result");
      expect(result.payload).toMatchObject({ requestId: "req-4", ok: false, errorCode: "engine-error", error: "nope" });
    } finally {
      handle.close();
    }
  });

  it("ignores a write addressed to a different appId", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { registerQueryWriteHandler } = await import("../commands.js");

    const received: unknown[] = [];
    registerQueryWriteHandler((queryHash, data) => {
      received.push([queryHash, data]);
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("query/write", "some-other-app-id", { requestId: "req-5", queryHash: "hash-1", data: 1 });
      socket.onmessage?.({ data: JSON.stringify(write) });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(received).toHaveLength(0);
      expect(framesOfType(socket, "query/write-result")).toHaveLength(0);
    } finally {
      handle.close();
    }
  });

  it("production: never registers the inbound handler — a query/write goes silently unanswered", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { init } = await import("../index.js");
    const { registerQueryWriteHandler } = await import("../commands.js");

    const received: unknown[] = [];
    registerQueryWriteHandler((queryHash, data) => {
      received.push([queryHash, data]);
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const write = createEnvelope("query/write", handle.appId, { requestId: "req-6", queryHash: "hash-1", data: 1 });
      socket.onmessage?.({ data: JSON.stringify(write) });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(received).toHaveLength(0);
      expect(framesOfType(socket, "query/write-result")).toHaveLength(0);
    } finally {
      handle.close();
    }
  });

  it("production: does not advertise the query:write capability", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { init } = await import("../index.js");
    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();
      const hello = await waitForFrame(socket, "hello");
      expect((hello.payload as { capabilities: string[] }).capabilities).not.toContain("query:write");
    } finally {
      handle.close();
    }
  });

  it("allowRemoteWrites: true does NOT force it on in production", async () => {
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
      expect((hello.payload as { capabilities: string[] }).capabilities).not.toContain("query:write");
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
      expect((hello.payload as { capabilities: string[] }).capabilities).not.toContain("query:write");
    } finally {
      handle.close();
    }
  });

  it("dev: advertises the query:write capability", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();
      const hello = await waitForFrame(socket, "hello");
      expect((hello.payload as { capabilities: string[] }).capabilities).toContain("query:write");
    } finally {
      handle.close();
    }
  });
});

describe("inbound query/command dispatch (spec 0010)", () => {
  const KINDS: QueryCommandKind[] = ["refetch", "invalidate", "reset", "remove"];

  it("routes each command kind to the registered handler and replies ok", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { registerQueryCommandHandler } = await import("../commands.js");

    const received: Array<[string, QueryCommandKind]> = [];
    registerQueryCommandHandler((queryHash, command) => {
      received.push([queryHash, command]);
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      for (const [i, command] of KINDS.entries()) {
        const cmd = createEnvelope("query/command", handle.appId, { requestId: `req-${i}`, queryHash: "hash-1", command });
        socket.onmessage?.({ data: JSON.stringify(cmd) });
      }

      await vi.waitFor(() => {
        if (framesOfType(socket, "query/command-result").length < KINDS.length) throw new Error("not all results yet");
      });

      expect(received).toEqual(KINDS.map((k) => ["hash-1", k]));
      for (const frame of framesOfType(socket, "query/command-result")) {
        expect(frame.payload).toMatchObject({ ok: true });
      }
    } finally {
      handle.close();
    }
  });

  it("replies no-adapter when no attachReactQuery has run", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const cmd = createEnvelope("query/command", handle.appId, { requestId: "req-1", queryHash: "hash-1", command: "refetch" });
      socket.onmessage?.({ data: JSON.stringify(cmd) });

      const result = await waitForFrame(socket, "query/command-result");
      expect(result.payload).toMatchObject({ requestId: "req-1", ok: false, errorCode: "no-adapter" });
    } finally {
      handle.close();
    }
  });

  it("replies no-query when the handler throws QueryNotFoundError", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { registerQueryCommandHandler, QueryNotFoundError } = await import("../commands.js");

    registerQueryCommandHandler((queryHash) => {
      throw new QueryNotFoundError(`No query with hash "${queryHash}".`);
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const cmd = createEnvelope("query/command", handle.appId, { requestId: "req-2", queryHash: "missing", command: "invalidate" });
      socket.onmessage?.({ data: JSON.stringify(cmd) });

      const result = await waitForFrame(socket, "query/command-result");
      expect(result.payload).toMatchObject({ requestId: "req-2", ok: false, errorCode: "no-query" });
    } finally {
      handle.close();
    }
  });

  it("replies engine-error when the handler throws a non-QueryNotFoundError", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { registerQueryCommandHandler } = await import("../commands.js");

    registerQueryCommandHandler(() => {
      throw new Error("nope");
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const cmd = createEnvelope("query/command", handle.appId, { requestId: "req-3", queryHash: "hash-1", command: "reset" });
      socket.onmessage?.({ data: JSON.stringify(cmd) });

      const result = await waitForFrame(socket, "query/command-result");
      expect(result.payload).toMatchObject({ requestId: "req-3", ok: false, errorCode: "engine-error", error: "nope" });
    } finally {
      handle.close();
    }
  });

  it("ignores a command addressed to a different appId", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { init } = await import("../index.js");
    const { registerQueryCommandHandler } = await import("../commands.js");

    const received: unknown[] = [];
    registerQueryCommandHandler((queryHash, command) => {
      received.push([queryHash, command]);
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const cmd = createEnvelope("query/command", "some-other-app-id", { requestId: "req-4", queryHash: "hash-1", command: "remove" });
      socket.onmessage?.({ data: JSON.stringify(cmd) });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(received).toHaveLength(0);
      expect(framesOfType(socket, "query/command-result")).toHaveLength(0);
    } finally {
      handle.close();
    }
  });

  it("production: never registers the inbound handler", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { init } = await import("../index.js");
    const { registerQueryCommandHandler } = await import("../commands.js");

    const received: unknown[] = [];
    registerQueryCommandHandler((queryHash, command) => {
      received.push([queryHash, command]);
    });

    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();

      const cmd = createEnvelope("query/command", handle.appId, { requestId: "req-5", queryHash: "hash-1", command: "refetch" });
      socket.onmessage?.({ data: JSON.stringify(cmd) });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(received).toHaveLength(0);
      expect(framesOfType(socket, "query/command-result")).toHaveLength(0);
    } finally {
      handle.close();
    }
  });

  it("production: does not advertise the query:write capability", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { init } = await import("../index.js");
    const handle = init({ appName: "Test", host: "localhost", diagnostics: false, autoAttach: false });
    try {
      const socket = FakeSocket.instances[0];
      socket.open();
      const hello = await waitForFrame(socket, "hello");
      expect((hello.payload as { capabilities: string[] }).capabilities).not.toContain("query:write");
    } finally {
      handle.close();
    }
  });
});

describe("attachReactQuery write-through", () => {
  interface FakeQueryLike {
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
  }

  function fakeQuery(queryHash: string, queryKey: readonly unknown[]): FakeQueryLike {
    return {
      queryHash,
      queryKey,
      state: { status: "success", fetchStatus: "idle", dataUpdatedAt: 0, errorUpdatedAt: 0, isInvalidated: false, data: 1 },
      getObserversCount: () => 0,
    };
  }

  function setupCore(appId: string) {
    const sent: AnyEnvelope[] = [];
    let messageHandler: ((e: AnyEnvelope) => void) | undefined;
    const core = {
      appId,
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
    return { core, sent, dispatch: (e: AnyEnvelope) => messageHandler?.(e) };
  }

  it("setQueryData is called with the ORIGINAL (unserialized) queryKey from the found Query, never a reconstructed one", async () => {
    const { setCore } = await import("../core.js");
    const { attachReactQuery } = await import("../query/reactQuery.js");
    const { enableInboundCommands } = await import("../commands.js");

    const { core, sent, dispatch } = setupCore("app-1");
    setCore(core);
    enableInboundCommands(core);

    // A Date inside queryKey is exactly the kind of value safeSerialize
    // normalizes (Date -> ISO string) — if the SDK ever used a
    // reconstructed queryKey from the wire instead of the live one, this
    // reference would differ (or the Date would already be a string).
    const originalKey = ["user", { createdAt: new Date(2020, 0, 1) }] as const;
    const query = fakeQuery("hash-1", originalKey);

    const setQueryDataCalls: Array<[readonly unknown[], unknown]> = [];
    const client = {
      getQueryCache: () => ({ getAll: () => [query], subscribe: () => () => {} }),
      setQueryData: (queryKey: readonly unknown[], data: unknown) => {
        setQueryDataCalls.push([queryKey, data]);
        return data;
      },
      invalidateQueries: async () => {},
      refetchQueries: async () => {},
      resetQueries: async () => {},
      removeQueries: () => {},
    };

    attachReactQuery(client);

    const write = createEnvelope("query/write", "app-1", { requestId: "req-1", queryHash: "hash-1", data: { n: 9 } });
    dispatch(write);

    await vi.waitFor(() => {
      if (!sent.some((e) => e.type === "query/write-result")) throw new Error("no result yet");
    });

    expect(setQueryDataCalls).toHaveLength(1);
    expect(setQueryDataCalls[0][0]).toBe(originalKey); // referential identity, not a reconstructed array
    expect(setQueryDataCalls[0][1]).toEqual({ n: 9 });
    const result = sent.find((e) => e.type === "query/write-result")!;
    expect(result.payload).toMatchObject({ requestId: "req-1", ok: true });
  });

  it("detach() unregisters both handlers — a second attachReactQuery() call isn't clobbered by the first's detach", async () => {
    const { setCore } = await import("../core.js");
    const { attachReactQuery } = await import("../query/reactQuery.js");
    const { enableInboundCommands } = await import("../commands.js");

    const { core, sent, dispatch } = setupCore("app-1");
    setCore(core);
    enableInboundCommands(core);

    const queryA = fakeQuery("hash-a", ["a"]);
    const queryB = fakeQuery("hash-b", ["b"]);
    const callsA: unknown[] = [];
    const callsB: unknown[] = [];

    const clientA = {
      getQueryCache: () => ({ getAll: () => [queryA], subscribe: () => () => {} }),
      setQueryData: (_k: readonly unknown[], data: unknown) => {
        callsA.push(data);
      },
      invalidateQueries: async () => {},
      refetchQueries: async () => {},
      resetQueries: async () => {},
      removeQueries: () => {},
    };
    const clientB = {
      getQueryCache: () => ({ getAll: () => [queryB], subscribe: () => () => {} }),
      setQueryData: (_k: readonly unknown[], data: unknown) => {
        callsB.push(data);
      },
      invalidateQueries: async () => {},
      refetchQueries: async () => {},
      resetQueries: async () => {},
      removeQueries: () => {},
    };

    const detachA = attachReactQuery(clientA);
    const detachB = attachReactQuery(clientB); // overwrites the module-level handler
    detachA(); // must NOT evict clientB's handler

    const write = createEnvelope("query/write", "app-1", { requestId: "req-1", queryHash: "hash-b", data: "still-works" });
    dispatch(write);

    await vi.waitFor(() => {
      if (!sent.some((e) => e.type === "query/write-result")) throw new Error("no result yet");
    });

    expect(callsA).toHaveLength(0);
    expect(callsB).toEqual(["still-works"]);

    detachB();
  });
});
