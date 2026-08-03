import { createEnvelope, DEFAULT_HOST, DEFAULT_PORT, HEARTBEAT_INTERVAL_MS } from "@datamobile/protocol";
import type { Capability, Framework, HelloPayload, Platform } from "@datamobile/protocol";
import { setCore } from "./core.js";
import { createDiagnostics } from "./diagnostics.js";
import { createDevHostResolver, warmDevHost } from "./transport/devHost.js";
import { Transport } from "./transport/ws.js";

/**
 * Sent in every `hello` and shown in the desktop's app list — kept in sync
 * with `package.json` by `__tests__/version.test.ts` (nothing rewrites this
 * automatically, so a release that forgets to bump it fails `pnpm test`
 * instead of silently shipping a stale version string).
 */
export const SDK_VERSION = "0.1.0";

export interface InitOptions {
  /** Shown in the desktop app's connected-apps list. */
  appName: string;
  /**
   * Desktop server host. Auto-detected by default: the SDK parses the
   * Metro/Expo dev-server URL (`NativeModules.SourceCode.scriptURL` and
   * friends) to find the machine running the desktop app, which is what
   * makes iOS Simulator, Android Emulator and a physical device on the same
   * Wi-Fi all "just work" without passing this. Pass a string to skip
   * detection and connect to a fixed host — or a function if the value has
   * to come from runtime state that isn't ready yet at `init()` time; it's
   * re-invoked on every connection attempt, not just the first, so it can
   * self-correct on retry. If auto-detection is wrong for your setup
   * (uncommon — e.g. an Expo tunnel), the desktop's empty screen lists the
   * reachable LAN addresses to pass here instead.
   */
  host?: string | (() => string);
  port?: number;
  /** Skip runtime auto-detection (see below) and report explicitly. */
  platform?: Platform;
  /** Skip runtime auto-detection (see below) and report explicitly. */
  framework?: Framework;
  rnVersion?: string;
  /**
   * Delays the first connection attempt by this many ms. On a physical iOS
   * device, React Native's own automatic "connect to React DevTools"
   * WebSocket can starve a second app-initiated WebSocket started around the
   * same moment at boot (confirmed hang of 60+s, no error) — starting after
   * it resolves avoids that. Not needed on Android or the iOS Simulator.
   */
  initialConnectDelayMs?: number;
  /**
   * Logs connection attempts/failures/successes to the console (the
   * original `console.warn`/`console.info`, never the one adapters patch —
   * see `console.ts` — so this never loops back into the desktop's own
   * Console tab). Defaults to on in dev-style environments (`__DEV__`, or
   * `NODE_ENV !== "production"`) and off otherwise, matching the SDK's
   * "no-ops safely in production" contract. Pass `false` to silence even in
   * dev, or `true` to force it on.
   */
  diagnostics?: boolean;
}

export interface DataMobileHandle {
  /** Underlying app id sent in every message — useful for debugging. */
  appId: string;
  /** Stops the heartbeat and closes the WebSocket connection. */
  close(): void;
}

/**
 * Boots the DataMobile SDK: opens the WebSocket connection to the desktop
 * inspector and sends the `hello` handshake once connected. Call this once,
 * as early as possible (e.g. top of `App.tsx`), then attach whichever
 * adapters your app uses:
 *
 * ```ts
 * import { init } from "@datamobile/sdk";
 * import { attachNavigation } from "@datamobile/sdk/navigation";
 * import { dataMobileReduxEnhancer } from "@datamobile/sdk/state/redux";
 *
 * init({ appName: "MyApp" });
 * ```
 *
 * No-ops safely in production-style environments with no reachable desktop:
 * the transport just keeps retrying in the background with backoff.
 */
export function init(options: InitOptions): DataMobileHandle {
  const appId = generateAppId();
  const port = options.port ?? DEFAULT_PORT;
  const capabilities = new Set<Capability>();

  const resolver = createDevHostResolver(options.host);
  const diagnostics = createDiagnostics(options.diagnostics === undefined ? undefined : { enabled: options.diagnostics });

  const transport = new Transport({
    host: () => resolver.next(),
    port,
    initialConnectDelayMs: options.initialConnectDelayMs,
    // Gate only the *first* connect attempt on the async warm-up; reconnects
    // read whatever `getDevHostCandidates()` already has cached. Racing it
    // against a short timer means a pathological `import()` can never block
    // `connect()` indefinitely.
    hostReady: resolver.needsWarmUp ? withTimeout(warmDevHost(), 1000) : undefined,
    onDiagnostic: diagnostics.enabled ? diagnostics.handle : undefined,
  });

  if (resolver.needsWarmUp) {
    void warmDevHost().then((candidates) => {
      const [primary] = candidates;
      if (primary && primary !== DEFAULT_HOST) diagnostics.logResolvedHost(primary);
    });
  }

  setCore({
    transport,
    appId,
    registerCapability: (capability) => capabilities.add(capability),
  });

  transport.onOpen(() => {
    resolver.pin();
    void sendHello();
  });

  async function sendHello(): Promise<void> {
    const platform = options.platform ?? (await detectPlatform());
    const framework = options.framework ?? (await detectFramework());
    const hello: HelloPayload = {
      appName: options.appName,
      platform,
      framework,
      rnVersion: options.rnVersion,
      sdkVersion: SDK_VERSION,
      capabilities: Array.from(capabilities),
    };
    transport.send(createEnvelope("hello", appId, hello));
  }

  let seq = 0;
  const heartbeat = setInterval(() => {
    transport.send(createEnvelope("ping", appId, { seq: seq++ }));
  }, HEARTBEAT_INTERVAL_MS);

  transport.connect();

  return {
    appId,
    close() {
      clearInterval(heartbeat);
      transport.close();
      setCore(null);
    },
  };
}

function generateAppId(): string {
  return `app_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

/**
 * Races a promise against a timer so a pathological `import()` (see
 * `devHost.ts`) can never hold up the first `connect()` indefinitely. Never
 * rejects — `warmDevHost()` doesn't either, so timing out just means the
 * cache stays at its `[DEFAULT_HOST]` fallback a little longer.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as unknown as { unref?: () => void }).unref?.();
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

let cachedPlatform: Platform | undefined;

export async function detectPlatform(): Promise<Platform> {
  if (cachedPlatform) return cachedPlatform;
  try {
    const rn = (await import("react-native")) as { Platform?: { OS?: string } };
    const os = rn.Platform?.OS;
    if (os === "ios" || os === "android") {
      cachedPlatform = os;
      return os;
    }
  } catch {
    // Not running inside a React Native runtime (e.g. Node/tests) — fall through.
  }
  cachedPlatform = "web";
  return cachedPlatform;
}

let cachedFramework: Framework | undefined;

export async function detectFramework(): Promise<Framework> {
  if (cachedFramework) return cachedFramework;

  try {
    const expoConstants = (await import("expo-constants")) as {
      default?: { executionEnvironment?: string | null; appOwnership?: string | null };
    };
    const constants = expoConstants.default;
    // Presence of the package alone isn't enough — a bare RN app can have
    // `expo-constants` installed without being an Expo project. Only trust
    // it once it actually reports Expo-populated fields.
    if (constants?.executionEnvironment != null || constants?.appOwnership != null) {
      cachedFramework = "expo";
      return cachedFramework;
    }
  } catch {
    // expo-constants not installed — not an Expo project.
  }

  const platform = await detectPlatform();
  if (platform === "ios" || platform === "android") {
    cachedFramework = "bare-rn";
    return cachedFramework;
  }

  if (typeof document !== "undefined" && typeof window !== "undefined") {
    cachedFramework = "web";
    return cachedFramework;
  }

  cachedFramework = "unknown";
  return cachedFramework;
}

export { getCore, hasCore } from "./core.js";
export type { DataMobileCore } from "./core.js";
export { Transport } from "./transport/ws.js";
export type { TransportDiagnostic, TransportOptions, WebSocketLike } from "./transport/ws.js";
export { createDevHostResolver, getDevHostCandidates, parseDevServerHost, warmDevHost } from "./transport/devHost.js";
export type { DevHostResolver } from "./transport/devHost.js";
export { createDiagnostics } from "./diagnostics.js";
export type { Diagnostics, DiagnosticsOptions } from "./diagnostics.js";
