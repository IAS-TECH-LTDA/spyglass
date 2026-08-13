import { createEnvelope, DEFAULT_HOST, DEFAULT_PORT, HEARTBEAT_INTERVAL_MS } from "spyglass-protocol";
import type { Capability, Framework, HelloPayload, Platform } from "spyglass-protocol";
import { enableInboundCommands } from "./commands.js";
import { attachConsole } from "./console.js";
import { getCore, setCore } from "./core.js";
import { createDiagnostics } from "./diagnostics.js";
import { isDevEnvironment } from "./env.js";
import { attachNetwork } from "./network.js";
import { attachPerformance } from "./performance.js";
import { loadPlatform } from "./reactNative.js";
import { tryAutoAttachZustand } from "./state/autoAttachZustand.js";
import { attachAsyncStorage } from "./storage/asyncStorage.js";
import { attachWebStorage } from "./storage/webStorage.js";
import { createDevHostResolver, warmDevHost } from "./transport/devHost.js";
import { Transport } from "./transport/ws.js";

/**
 * Sent in every `hello` and shown in the desktop's app list — kept in sync
 * with `package.json` by `__tests__/version.test.ts` (nothing rewrites this
 * automatically, so a release that forgets to bump it fails `pnpm test`
 * instead of silently shipping a stale version string).
 */
export const SDK_VERSION = "0.1.2";

export interface AutoAttachOptions {
  /** Defaults to the same dev-environment detection as `InitOptions.diagnostics`. */
  console?: boolean;
  network?: boolean;
  performance?: boolean;
  /**
   * Unlike navigation/state adapters, these two storage engines have
   * exactly one real instance per app (the AsyncStorage module itself is a
   * singleton; `window.localStorage`/`sessionStorage` are globals) — there's
   * no app-specific reference to hand over, so `init()` can find and attach
   * them itself. MMKV/SQLite/Realm/WatermelonDB are deliberately absent
   * here: each has app-specific construction (encryption key, db path,
   * possibly multiple instances) that `init()` can't safely guess — see
   * the SDK README's "Why not every adapter?" section.
   */
  storage?: {
    /** Dynamically imports `@react-native-async-storage/async-storage`; silently skipped if it's not installed. */
    asyncStorage?: boolean;
    /** Attaches both `window.localStorage` and `window.sessionStorage` when present. */
    webStorage?: boolean;
  };
  /**
   * `zustand` is the only state manager listed here — it's the only one
   * with a single factory (`create()`) every store passes through, which is
   * what makes auto-attaching it even possible. Best-effort: patching that
   * factory only works under some bundlers' CJS interop (Metro, this SDK's
   * primary target, is one) — under strict ESM it silently doesn't attach
   * rather than throwing. See `state/autoAttachZustand.ts` and the SDK
   * README's "Why not every adapter?" for the full story, including
   * Redux/Jotai/Recoil/MobX's lack of an equivalent single interception
   * point.
   */
  state?: {
    zustand?: boolean;
  };
}

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
  /**
   * Auto-attaches `attachConsole()`/`attachNetwork()`/`attachPerformance()`,
   * and optionally AsyncStorage/web Storage (see `AutoAttachOptions.storage`)
   * — no adapter call needed for any of them. Unlike navigation, state
   * managers, and the storage engines with app-specific construction
   * (MMKV/SQLite/Realm/WatermelonDB), none of these need anything only your
   * code could hand over. Defaults to on in dev-style environments and off
   * in production, same detection as `diagnostics`. Pass `false` to disable
   * entirely, `true` to force everything on even in production, or an
   * object to override per capability (e.g. `{ network: false }` keeps
   * everything else on but skips network; `{ storage: { asyncStorage: true } }`
   * adds AsyncStorage on top of the usual three). Calling the adapter's own
   * `attachX()` yourself afterwards is a safe no-op if `init()` already
   * attached it — it won't double-report.
   */
  autoAttach?: boolean | AutoAttachOptions;
  /**
   * Lets the desktop write data back into this app, live: the Storage KV
   * editor (spec 0007) does an in-place `set`/`remove` through the same
   * adapter that already observes AsyncStorage/MMKV/localStorage-
   * sessionStorage, the Stores editor (spec 0007-state) shallow-merges an
   * edited field back into a Zustand store through its own `set()`, and the
   * Memory panel's "Clear caches" button (spec 0008) triggers a Hermes GC +
   * `expo-image` cache clear. Unlike `autoAttach`/`diagnostics`, this is
   * **not** a dev-default-with-override: it's hard-gated to dev-style
   * environments and cannot be forced on in production via this option —
   * there's no authentication on the desktop's WebSocket yet, and letting
   * the desktop mutate/trigger actions in a production build over an open
   * LAN socket is a different risk class entirely. Pass `false` to disable
   * even in dev (e.g. a shared demo device). Defaults to on in dev-style
   * environments, matching `autoAttach`'s own detection.
   */
  allowRemoteWrites?: boolean;
}

export interface SpyglassHandle {
  /** Underlying app id sent in every message — useful for debugging. */
  appId: string;
  /** Stops the heartbeat and closes the WebSocket connection. */
  close(): void;
}

/**
 * Boots the Spyglass SDK: opens the WebSocket connection to the desktop
 * inspector and sends the `hello` handshake once connected. Call this once,
 * as early as possible (e.g. top of `App.tsx`), then attach whichever
 * adapters your app uses:
 *
 * ```ts
 * import { init } from "spyglass-react";
 * import { attachNavigation } from "spyglass-react/navigation";
 *
 * init({ appName: "MyApp" });
 * attachNavigation(navigationRef.current!);
 * ```
 *
 * No-ops safely in production-style environments with no reachable desktop:
 * the transport just keeps retrying in the background with backoff.
 */
export function init(options: InitOptions): SpyglassHandle {
  const appId = generateAppId();
  const port = options.port ?? DEFAULT_PORT;
  const capabilities = new Set<Capability>();
  const attachedAdapters = new Set<Capability>();

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
    markAttached: (capability) => {
      if (attachedAdapters.has(capability)) return false;
      attachedAdapters.add(capability);
      return true;
    },
  });

  // Console/network/performance need no app-specific reference (unlike
  // navigation/state/storage adapters), so there's nothing stopping `init()`
  // from attaching them itself — dev-only by default, matching `diagnostics`.
  const autoAttachDevDefault = isDevEnvironment();
  const detachAutoAttached: Array<() => void> = [];
  let closed = false;
  if (resolveAutoAttach("console", options.autoAttach, autoAttachDevDefault)) {
    detachAutoAttached.push(attachConsole());
  }
  if (resolveAutoAttach("network", options.autoAttach, autoAttachDevDefault)) {
    detachAutoAttached.push(attachNetwork());
  }
  if (resolveAutoAttach("performance", options.autoAttach, autoAttachDevDefault)) {
    detachAutoAttached.push(attachPerformance());
  }

  // AsyncStorage and web Storage are the only two storage engines with
  // exactly one real instance per app (see AutoAttachOptions.storage) —
  // everything else (MMKV, SQLite, Realm, WatermelonDB) still needs a
  // manual attachX(instance) call, since `init()` has no safe way to guess
  // which instance/config an app actually uses.
  if (resolveStorageAutoAttach("asyncStorage", options.autoAttach, autoAttachDevDefault)) {
    void (async () => {
      try {
        const mod = (await import("@react-native-async-storage/async-storage")) as { default?: unknown };
        if (closed || !mod.default) return;
        // biome-ignore lint: structurally checked inside attachAsyncStorage itself; the dynamic import can't carry real types without the optional peer dep installed
        detachAutoAttached.push(attachAsyncStorage(mod.default as any));
      } catch {
        // @react-native-async-storage/async-storage isn't installed — silent skip, same spirit as detectFramework()'s expo-constants probe.
      }
    })();
  }
  if (resolveStorageAutoAttach("webStorage", options.autoAttach, autoAttachDevDefault) && typeof window !== "undefined") {
    try {
      if (window.localStorage) detachAutoAttached.push(attachWebStorage(window.localStorage));
    } catch {
      // Some browser privacy modes throw on localStorage access instead of leaving it undefined.
    }
    try {
      if (window.sessionStorage) detachAutoAttached.push(attachWebStorage(window.sessionStorage));
    } catch {
      // Same as above.
    }
  }

  // Best-effort — see AutoAttachOptions.state and state/autoAttachZustand.ts
  // for why this is the one state manager even attemptable this way, and
  // why it can silently no-op under some bundlers.
  if (resolveStateAutoAttach("zustand", options.autoAttach, autoAttachDevDefault)) {
    void (async () => {
      const detach = await tryAutoAttachZustand();
      if (!detach) return;
      if (closed) {
        detach(); // restore before this handle is ever used again
        return;
      }
      detachAutoAttached.push(detach);
    })();
  }

  // Dev-only, and NOT forcible into production via `allowRemoteWrites: true`
  // (unlike autoAttach/diagnostics) — see InitOptions.allowRemoteWrites for
  // why. When off, `transport.onMessage` is never called: no handler is
  // registered at all, not just hidden behind a UI flag on the desktop side.
  let disableInboundCommands: (() => void) | undefined;
  if (resolveRemoteWrites(options.allowRemoteWrites, autoAttachDevDefault)) {
    capabilities.add("storage:write");
    // Advertised unconditionally alongside storage:write, independent of
    // whether any store has actually registered a handler yet (the zustand
    // auto-attach above is async) — an unregistered storeId simply gets
    // `errorCode: "no-store"` back, same as storage:write against an engine
    // with no attached adapter.
    capabilities.add("state:write");
    // Same "advertised unconditionally" reasoning as state:write above —
    // there's no "target" to be missing for memory/clear-cache (spec 0008),
    // so this is really just announcing that the inbound channel is on.
    capabilities.add("memory:clear-cache");
    disableInboundCommands = enableInboundCommands(getCore());
  }

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
      closed = true; // guards the still-pending AsyncStorage dynamic import above from attaching after close()
      clearInterval(heartbeat);
      for (const detach of detachAutoAttached) detach();
      disableInboundCommands?.();
      transport.close();
      setCore(null);
    },
  };
}

/**
 * A blanket `true`/`false` for `autoAttach` applies to every capability
 * uniformly. An object overrides per capability, falling back to the
 * dev-environment default for any key it doesn't mention.
 */
function resolveAutoAttach(
  key: "console" | "network" | "performance",
  option: boolean | AutoAttachOptions | undefined,
  devDefault: boolean,
): boolean {
  if (typeof option === "boolean") return option;
  const perCapability = option?.[key];
  return perCapability ?? devDefault;
}

/**
 * Same resolution rules as `resolveAutoAttach`, one level deeper — a
 * blanket `true`/`false` for `autoAttach` still applies to the storage
 * sub-keys, an object form reads `option.storage?.[key]`.
 */
function resolveStorageAutoAttach(
  key: "asyncStorage" | "webStorage",
  option: boolean | AutoAttachOptions | undefined,
  devDefault: boolean,
): boolean {
  if (typeof option === "boolean") return option;
  const perEngine = option?.storage?.[key];
  return perEngine ?? devDefault;
}

/** Same resolution rules as `resolveStorageAutoAttach`, for `AutoAttachOptions.state`. */
function resolveStateAutoAttach(
  key: "zustand",
  option: boolean | AutoAttachOptions | undefined,
  devDefault: boolean,
): boolean {
  if (typeof option === "boolean") return option;
  const perManager = option?.state?.[key];
  return perManager ?? devDefault;
}

/**
 * Deliberately NOT the same shape as `resolveAutoAttach`: `true` does not
 * force this on outside of `devDefault` — see `InitOptions.allowRemoteWrites`.
 * Only `false` has any effect beyond the dev-environment default.
 */
function resolveRemoteWrites(option: boolean | undefined, devDefault: boolean): boolean {
  if (option === false) return false;
  return devDefault;
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
  const platform = await loadPlatform();
  const os = platform?.OS;
  if (os === "ios" || os === "android") {
    cachedPlatform = os;
    return os;
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
export type { SpyglassCore } from "./core.js";
export { Transport } from "./transport/ws.js";
export type { TransportDiagnostic, TransportOptions, WebSocketLike } from "./transport/ws.js";
export { createDevHostResolver, getDevHostCandidates, parseDevServerHost, warmDevHost } from "./transport/devHost.js";
export type { DevHostResolver } from "./transport/devHost.js";
export { createDiagnostics } from "./diagnostics.js";
export type { Diagnostics, DiagnosticsOptions } from "./diagnostics.js";
