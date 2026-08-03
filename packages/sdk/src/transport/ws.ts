import { decodeEnvelope, encodeEnvelope } from "@datamobile/protocol";
import type { AnyEnvelope } from "@datamobile/protocol";

export interface TransportOptions {
  /**
   * Resolved fresh on every connection attempt (initial + each reconnect),
   * not just once — a function lets host detection that depends on
   * not-yet-ready native state (e.g. a bundler URL the native bridge hasn't
   * delivered yet at boot) self-correct on the next retry instead of being
   * locked into a wrong value computed at `init()` time.
   */
  host: string | (() => string);
  port: number;
  /** Override for testing; defaults to the environment's global `WebSocket`. */
  webSocketImpl?: WebSocketLike;
  /** Oldest messages are dropped once the offline queue hits this size. */
  maxQueueSize?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  /**
   * Delays the *first* `connect()` attempt only (reconnects already have
   * their own backoff delay). Confirmed workaround for a physical-iOS-device
   * quirk: React Native's own "connect to React DevTools" WebSocket opens
   * automatically at boot, and a second app-initiated WebSocket connection
   * started around the same moment can stall indefinitely (no SYN-ACK, no
   * refusal — observed hung 60+s) instead of failing fast or succeeding.
   * Starting after DevTools' own connection has resolved avoids it.
   */
  initialConnectDelayMs?: number;
  /**
   * Awaited once before the *first* `connect()` attempt only (reconnects
   * never wait on it again — by then `host` has whatever cached value the
   * warm-up produced). Lets async host detection (see `transport/devHost.ts`,
   * which resolves the dev server's IP from the bundler URL) finish before
   * the socket opens, without making `host` itself async. A rejection is
   * treated the same as a resolution — `host` always has a synchronous
   * fallback — so this can never block connecting indefinitely.
   */
  hostReady?: Promise<unknown>;
  /**
   * Abandons a connection attempt still stuck in `CONNECTING` after this
   * many ms and lets the normal reconnect/backoff path retry against the
   * next candidate. Needed because a genuinely unreachable host doesn't
   * always fail fast: a socket to the wrong host has been observed (see the
   * `initialConnectDelayMs` quirk above) to hang 60+s with no error and no
   * close. Without this, host-candidate rotation would stall forever on the
   * first wrong guess. Defaults to 8000ms; pass 0 to disable.
   */
  connectTimeoutMs?: number;
  /**
   * Structured connection-lifecycle events, for diagnostics/logging built on
   * top of `Transport` (see `packages/sdk/src/diagnostics.ts`). Optional and
   * effectively free when omitted — `Transport` itself never formats,
   * throttles, or logs anything on its own.
   */
  onDiagnostic?: (event: TransportDiagnostic) => void;
}

/**
 * One event per connection lifecycle transition. `attempt` counts
 * consecutive attempts since the last successful `open` (reset to 0 there),
 * so a diagnostics layer can throttle without re-deriving that from timing.
 */
export type TransportDiagnostic =
  | { kind: "connecting"; url: string; attempt: number }
  | { kind: "open"; url: string }
  | { kind: "closed"; url: string; attempt: number }
  | { kind: "timeout"; url: string; attempt: number }
  | { kind: "error"; url: string; attempt: number; error: unknown };

/** Minimal shape of the standard `WebSocket` API, enough for RN/browser/tests. */
export interface WebSocketLike {
  new (url: string): WebSocketInstanceLike;
}

export interface WebSocketInstanceLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((err: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

const OPEN_STATE = 1;
const DEFAULT_CONNECT_TIMEOUT_MS = 8000;

type Unsubscribe = () => void;

/**
 * Node's `setTimeout` returns an object with `.unref()` (don't hold the
 * process open just for this timer); React Native/browsers return a plain
 * number with no such method. Calling it only when present keeps this safe
 * in every environment, and matters here specifically: without it, a timer
 * that outlives a short-lived Node process (e.g. a test) keeps that process
 * alive until the timer fires.
 */
function unref(timer: ReturnType<typeof setTimeout>): void {
  (timer as unknown as { unref?: () => void }).unref?.();
}

/**
 * WebSocket client used by the SDK core to talk to the DataMobile desktop
 * server. Handles automatic reconnection with exponential backoff and
 * queues outgoing messages while disconnected (bounded, drops oldest first)
 * so a brief desktop restart doesn't lose the SDK's `hello`/state stream.
 */
export class Transport {
  private socket: WebSocketInstanceLike | null = null;
  private queue: AnyEnvelope[] = [];
  private openHandlers: Array<() => void> = [];
  private messageHandlers: Array<(envelope: AnyEnvelope) => void> = [];
  private closed = true;
  private reconnectAttempt = 0;
  private attemptCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: TransportOptions) {}

  connect(): void {
    this.closed = false;

    const start = (): void => {
      if (this.closed) return;
      if (this.options.initialConnectDelayMs) {
        const timer = setTimeout(() => {
          if (!this.closed) this.openSocket();
        }, this.options.initialConnectDelayMs);
        unref(timer);
        return;
      }
      this.openSocket();
    };

    if (this.options.hostReady) {
      // Rejection is intentionally treated the same as resolution: `host`
      // always has a synchronous fallback, so there's nothing to recover
      // from here beyond proceeding with whatever it resolves to.
      void this.options.hostReady.then(start, start);
    } else {
      start();
    }
  }

  onOpen(handler: () => void): Unsubscribe {
    this.openHandlers.push(handler);
    return () => {
      this.openHandlers = this.openHandlers.filter((h) => h !== handler);
    };
  }

  onMessage(handler: (envelope: AnyEnvelope) => void): Unsubscribe {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
    };
  }

  send(envelope: AnyEnvelope): void {
    if (this.socket && this.socket.readyState === OPEN_STATE) {
      this.socket.send(encodeEnvelope(envelope));
      return;
    }
    const maxQueueSize = this.options.maxQueueSize ?? 500;
    this.queue.push(envelope);
    while (this.queue.length > maxQueueSize) {
      this.queue.shift();
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  get queuedMessageCount(): number {
    return this.queue.length;
  }

  private emitDiagnostic(event: TransportDiagnostic): void {
    this.options.onDiagnostic?.(event);
  }

  private openSocket(): void {
    const Impl = this.options.webSocketImpl ?? (globalThis as { WebSocket?: WebSocketLike }).WebSocket;
    if (!Impl) {
      throw new Error(
        "[DataMobile] No WebSocket implementation available in this environment. " +
          "Pass `webSocketImpl` explicitly if you're running outside React Native/a browser.",
      );
    }

    const host = typeof this.options.host === "function" ? this.options.host() : this.options.host;
    const url = `ws://${host}:${this.options.port}`;
    this.attemptCount++;
    const attempt = this.attemptCount;
    this.emitDiagnostic({ kind: "connecting", url, attempt });

    const socket = new Impl(url);
    this.socket = socket;

    const connectTimeoutMs = this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    if (connectTimeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (socket.readyState !== OPEN_STATE) {
          this.emitDiagnostic({ kind: "timeout", url, attempt });
          // Drives the existing onclose -> scheduleReconnect() path below;
          // no separate abandonment logic needed.
          socket.close();
        }
      }, connectTimeoutMs);
      unref(timeoutTimer);
    }

    socket.onopen = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      this.attemptCount = 0;
      this.reconnectAttempt = 0;
      this.flushQueue();
      this.emitDiagnostic({ kind: "open", url });
      for (const handler of this.openHandlers) handler();
    };

    socket.onmessage = (event: { data: unknown }) => {
      const decoded = decodeEnvelope(String(event.data));
      if (!decoded) return;
      for (const handler of this.messageHandlers) handler(decoded);
    };

    socket.onclose = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      this.socket = null;
      if (!this.closed) {
        this.emitDiagnostic({ kind: "closed", url, attempt });
        this.scheduleReconnect();
      }
    };

    socket.onerror = (err: unknown) => {
      // Every standard WebSocket implementation fires `onclose` right after
      // `onerror`; reconnection is handled there. This only ever reports —
      // it must never throw, or a transient network blip would crash the
      // host app.
      this.emitDiagnostic({ kind: "error", url, attempt, error: err });
    };
  }

  private flushQueue(): void {
    if (!this.socket) return;
    for (const envelope of this.queue) {
      this.socket.send(encodeEnvelope(envelope));
    }
    this.queue = [];
  }

  private scheduleReconnect(): void {
    const base = this.options.reconnectBaseDelayMs ?? 500;
    const max = this.options.reconnectMaxDelayMs ?? 10_000;
    const delay = Math.min(max, base * 2 ** this.reconnectAttempt);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      if (!this.closed) this.openSocket();
    }, delay);
    unref(this.reconnectTimer);
  }
}
