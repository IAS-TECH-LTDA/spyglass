import { describe, expect, it, vi } from "vitest";
import { createEnvelope, decodeEnvelope } from "@datamobile/protocol";
import { Transport, type WebSocketInstanceLike, type WebSocketLike } from "../transport/ws.js";

/** Minimal fake WebSocket the test controls by hand (no real network). */
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

const FakeSocketCtor = FakeSocket as unknown as WebSocketLike;

function freshFakeSocket(): FakeSocket {
  FakeSocket.instances.length = 0;
  return undefined as unknown as FakeSocket; // instances created lazily by Transport
}

describe("Transport", () => {
  it("queues messages while disconnected and flushes them on open", () => {
    freshFakeSocket();
    const transport = new Transport({ host: "localhost", port: 8097, webSocketImpl: FakeSocketCtor });
    transport.connect();

    const env = createEnvelope("ping", "app-1", { seq: 1 });
    transport.send(env);
    expect(transport.queuedMessageCount).toBe(1);

    const socket = FakeSocket.instances[0];
    socket.open();

    expect(transport.queuedMessageCount).toBe(0);
    expect(socket.sent).toHaveLength(1);
    expect(decodeEnvelope(socket.sent[0])).toEqual(env);
  });

  it("sends immediately once open without queuing", () => {
    freshFakeSocket();
    const transport = new Transport({ host: "localhost", port: 8097, webSocketImpl: FakeSocketCtor });
    transport.connect();
    FakeSocket.instances[0].open();

    const env = createEnvelope("ping", "app-1", { seq: 2 });
    transport.send(env);

    expect(transport.queuedMessageCount).toBe(0);
    expect(FakeSocket.instances[0].sent).toHaveLength(1);
  });

  it("drops the oldest queued message once maxQueueSize is exceeded", () => {
    freshFakeSocket();
    const transport = new Transport({
      host: "localhost",
      port: 8097,
      webSocketImpl: FakeSocketCtor,
      maxQueueSize: 2,
    });
    transport.connect();

    transport.send(createEnvelope("ping", "app-1", { seq: 1 }));
    transport.send(createEnvelope("ping", "app-1", { seq: 2 }));
    transport.send(createEnvelope("ping", "app-1", { seq: 3 }));

    expect(transport.queuedMessageCount).toBe(2);
  });

  it("invokes message handlers with decoded envelopes", () => {
    freshFakeSocket();
    const transport = new Transport({ host: "localhost", port: 8097, webSocketImpl: FakeSocketCtor });
    const handler = vi.fn();
    transport.onMessage(handler);
    transport.connect();
    FakeSocket.instances[0].open();

    const env = createEnvelope("pong", "app-1", { seq: 5 });
    FakeSocket.instances[0].onmessage?.({ data: JSON.stringify(env) });

    expect(handler).toHaveBeenCalledWith(env);
  });

  it("reconnects with a new socket after the previous one closes", () => {
    vi.useFakeTimers();
    freshFakeSocket();
    const transport = new Transport({
      host: "localhost",
      port: 8097,
      webSocketImpl: FakeSocketCtor,
      reconnectBaseDelayMs: 100,
    });
    transport.connect();
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].close();

    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(FakeSocket.instances).toHaveLength(2);

    vi.useRealTimers();
  });

  it("does not reconnect after an explicit close()", () => {
    vi.useFakeTimers();
    freshFakeSocket();
    const transport = new Transport({
      host: "localhost",
      port: 8097,
      webSocketImpl: FakeSocketCtor,
      reconnectBaseDelayMs: 100,
    });
    transport.connect();
    FakeSocket.instances[0].open();
    transport.close();

    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(1);

    vi.useRealTimers();
  });

  it("re-invokes a function host on every reconnect", () => {
    vi.useFakeTimers();
    freshFakeSocket();
    let calls = 0;
    const transport = new Transport({
      host: () => `host-${++calls}`,
      port: 8097,
      webSocketImpl: FakeSocketCtor,
      reconnectBaseDelayMs: 100,
    });
    transport.connect();
    expect(FakeSocket.instances[0].url).toBe("ws://host-1:8097");

    FakeSocket.instances[0].open();
    FakeSocket.instances[0].close();
    vi.advanceTimersByTime(100);

    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[1].url).toBe("ws://host-2:8097");

    vi.useRealTimers();
  });

  it("waits for hostReady before the first connect, but not on reconnects", async () => {
    freshFakeSocket();
    let resolveReady: () => void = () => {};
    const hostReady = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const transport = new Transport({ host: "localhost", port: 8097, webSocketImpl: FakeSocketCtor, hostReady });

    transport.connect();
    expect(FakeSocket.instances).toHaveLength(0);

    resolveReady();
    await Promise.resolve();
    await Promise.resolve();

    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("still connects when hostReady rejects", async () => {
    freshFakeSocket();
    const hostReady = Promise.reject(new Error("warm-up failed"));
    const transport = new Transport({ host: "localhost", port: 8097, webSocketImpl: FakeSocketCtor, hostReady });

    transport.connect();
    await Promise.resolve();
    await Promise.resolve();

    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("does not connect if close() is called before hostReady settles", async () => {
    freshFakeSocket();
    let resolveReady: () => void = () => {};
    const hostReady = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const transport = new Transport({ host: "localhost", port: 8097, webSocketImpl: FakeSocketCtor, hostReady });

    transport.connect();
    transport.close();
    resolveReady();
    await Promise.resolve();
    await Promise.resolve();

    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("abandons a connection stuck in CONNECTING after connectTimeoutMs and retries", () => {
    vi.useFakeTimers();
    freshFakeSocket();
    const transport = new Transport({
      host: "localhost",
      port: 8097,
      webSocketImpl: FakeSocketCtor,
      connectTimeoutMs: 5000,
      reconnectBaseDelayMs: 100,
    });
    transport.connect();
    // Never call .open() — the socket stays stuck in CONNECTING.

    vi.advanceTimersByTime(5000);
    expect(FakeSocket.instances[0].readyState).toBe(3); // CLOSED, from the timeout's socket.close()

    vi.advanceTimersByTime(100);
    expect(FakeSocket.instances).toHaveLength(2);

    vi.useRealTimers();
  });

  it("reports connecting then open via onDiagnostic", () => {
    freshFakeSocket();
    const events: unknown[] = [];
    const transport = new Transport({
      host: "localhost",
      port: 8097,
      webSocketImpl: FakeSocketCtor,
      onDiagnostic: (e) => events.push(e),
    });
    transport.connect();
    FakeSocket.instances[0].open();

    expect(events).toEqual([
      { kind: "connecting", url: "ws://localhost:8097", attempt: 1 },
      { kind: "open", url: "ws://localhost:8097" },
    ]);
  });

  it("never throws when onDiagnostic is omitted", () => {
    freshFakeSocket();
    const transport = new Transport({ host: "localhost", port: 8097, webSocketImpl: FakeSocketCtor });
    expect(() => {
      transport.connect();
      FakeSocket.instances[0].open();
      FakeSocket.instances[0].close();
    }).not.toThrow();
  });
});
