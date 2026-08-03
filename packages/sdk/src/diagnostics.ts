import type { TransportDiagnostic } from "./transport/ws.js";

// Captured at module evaluation time — before `init()` (and therefore before
// any adapter can run). `attachConsole()` (`console.ts`) only ever succeeds
// *after* `init()` has set up a core for `getCore()` to return, and `init()`
// lives in this package's entry module, which imports this file statically.
// So these are always the original, unpatched functions: a diagnostic here
// can never turn into a `log/entry` envelope that shows up in the desktop's
// own Console tab.
const rawWarn = console.warn.bind(console);
const rawInfo = console.info.bind(console);

const THROTTLE_MS = 30_000;

export interface DiagnosticsOptions {
  /** Explicit override; otherwise on in dev-style environments, off in production-style ones. */
  enabled?: boolean;
}

export interface Diagnostics {
  readonly enabled: boolean;
  /** Feed every `Transport` lifecycle event through this. */
  handle: (event: TransportDiagnostic) => void;
  /** One-off note when host auto-detection picked something other than the default — call once, after warm-up resolves. */
  logResolvedHost: (host: string) => void;
}

function isDevEnvironment(): boolean {
  const dev = (globalThis as { __DEV__?: unknown }).__DEV__;
  if (typeof dev === "boolean") return dev;
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.NODE_ENV !== "production";
}

/**
 * Builds the console-facing half of connection diagnostics. `Transport`
 * itself only emits structured events (see `TransportDiagnostic`) — all
 * formatting, throttling and the dev/production default live here, kept
 * separate so `Transport` stays presentation-free and easy to unit test.
 *
 * Anti-spam: logs on the very first failed attempt, then at most once every
 * 30s while failures continue (`Transport` retries forever with backoff —
 * without a throttle this would spam indefinitely). A successful `open`
 * always logs once and resets the throttle, so a later failure (e.g. after
 * the desktop restarts) is reported immediately again instead of staying
 * silent for up to 30s.
 */
export function createDiagnostics(options?: DiagnosticsOptions): Diagnostics {
  const enabled = options?.enabled ?? isDevEnvironment();
  let loggedOnce = false;
  let lastLoggedAt = 0;
  let resolvedHostLogged = false;

  function shouldLog(now: number): boolean {
    if (!loggedOnce || now - lastLoggedAt >= THROTTLE_MS) {
      loggedOnce = true;
      lastLoggedAt = now;
      return true;
    }
    return false;
  }

  function handle(event: TransportDiagnostic): void {
    if (!enabled) return;

    if (event.kind === "open") {
      // Reset the throttle: a failure right after a successful connection
      // (e.g. the desktop app closing again) should be reported right away,
      // not silently absorbed by whatever window is left from before.
      loggedOnce = false;
      rawInfo(`[DataMobile] connected to ${event.url}`);
      return;
    }

    if (event.kind === "connecting") return;

    if (!shouldLog(Date.now())) return;
    rawWarn(
      `[DataMobile] can't reach the desktop app at ${event.url} (attempt ${event.attempt}, still retrying).\n` +
        "  · Is the desktop app running?\n" +
        '  · Physical device: init({ appName, host: "<your Mac\'s LAN IP>" }) — the desktop\'s empty screen lists them\n' +
        "  · Android emulator: adb reverse tcp:8098 tcp:8098 (the desktop app applies this automatically)",
    );
  }

  function logResolvedHost(host: string): void {
    if (!enabled || resolvedHostLogged) return;
    resolvedHostLogged = true;
    rawInfo(`[DataMobile] resolved dev host "${host}" from the bundler URL.`);
  }

  return { enabled, handle, logResolvedHost };
}
