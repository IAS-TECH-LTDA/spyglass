import { DEFAULT_HOST } from "@datamobile/protocol";

/**
 * Parses the host portion out of a Metro/Expo dev-server URL, e.g.
 * `http://192.168.1.5:8081/index.bundle?platform=ios&dev=true` -> `192.168.1.5`.
 * Pure and synchronous — no imports, safe to unit test directly.
 *
 * Hand-rolled instead of `new URL()`: React Native's `URL` is a partial
 * polyfill with a documented history of wrong/absent `hostname` on some
 * engines. Only `http`/`https` schemes are accepted, so `file://…/main.jsbundle`
 * (iOS release) and `assets://index.android.bundle` (Android release) both
 * return `null` and the caller falls back to `DEFAULT_HOST` — exactly the
 * behavior production builds already have today, unchanged.
 */
export function parseDevServerHost(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(?:[^@/?#]*@)?(\[[0-9a-fA-F:.]+\]|[^/:?#]+)/.exec(url);
  if (!match) return null;
  const [, scheme, host] = match;
  if (scheme.toLowerCase() !== "http" && scheme.toLowerCase() !== "https") return null;
  return host || null;
}

/** `"localhost:8081"` -> `"localhost"`. Used for the simpler `host:port` strings RN/Expo report elsewhere. */
function hostPortToHost(value: string | null | undefined): string | null {
  if (!value) return null;
  const host = value.split(":")[0]?.trim();
  return host || null;
}

function isLikelyIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
}

interface ReactNativeModuleShape {
  NativeModules?: { SourceCode?: { scriptURL?: string | null } };
  Platform?: { OS?: string; constants?: { ServerHost?: string | null } };
}

interface ExpoConstantsShape {
  default?: {
    expoConfig?: { hostUri?: string | null } | null;
    expoGoConfig?: { debuggerHost?: string | null } | null;
    manifest?: { debuggerHost?: string | null } | null;
    manifest2?: { extra?: { expoGo?: { debuggerHost?: string | null } | null } | null } | null;
  };
}

let cachedCandidates: string[] | undefined;

/**
 * Synchronous, cached view of the current best-guess host candidates, in
 * priority order. Returns `[DEFAULT_HOST]` until `warmDevHost()` has
 * resolved at least once — `TransportOptions.host` is synchronous (see
 * `ws.ts`), so detection can only ever be read through a cache one async
 * warm-up fills, never awaited directly on each connection attempt.
 */
export function getDevHostCandidates(): string[] {
  return cachedCandidates ?? [DEFAULT_HOST];
}

/**
 * Resolves and caches the host candidate list from whatever runtime signals
 * are available. Never rejects — every resolution step is independently
 * try/caught, and the worst case is falling back to `[DEFAULT_HOST]`, i.e.
 * today's behavior.
 */
export async function warmDevHost(): Promise<string[]> {
  if (cachedCandidates) return cachedCandidates;
  cachedCandidates = await resolveDevHostCandidates();
  return cachedCandidates;
}

async function resolveDevHostCandidates(): Promise<string[]> {
  let isAndroid = false;
  let host: string | null = null;

  try {
    const rn = (await import("react-native")) as ReactNativeModuleShape;
    isAndroid = rn.Platform?.OS === "android";
    host =
      parseDevServerHost(rn.NativeModules?.SourceCode?.scriptURL) ??
      // Android/bridgeless fallback — cheaper and less version-sensitive
      // than reaching into RN's internal `getDevServer()` module, whose
      // path has moved between versions.
      hostPortToHost(rn.Platform?.constants?.ServerHost);
  } catch {
    // Not running inside a React Native runtime (e.g. Node, tests, or a
    // ReactJS/web app) — fall through to the other signals below.
  }

  if (host == null) {
    try {
      const expoConstants = (await import("expo-constants")) as ExpoConstantsShape;
      const constants = expoConstants.default;
      const hostUri =
        constants?.expoConfig?.hostUri ??
        constants?.expoGoConfig?.debuggerHost ??
        constants?.manifest?.debuggerHost ??
        constants?.manifest2?.extra?.expoGo?.debuggerHost;
      host = hostPortToHost(hostUri);
    } catch {
      // expo-constants not installed — not an Expo project.
    }
  }

  if (host == null) {
    // ReactJS/web: use the page's own host. Guard on `location.hostname`,
    // not on `window` — React Native defines a `window` global with no
    // meaningful `location`, so checking `window` alone would misfire there.
    const location = (globalThis as { location?: { hostname?: string; protocol?: string } }).location;
    if (location?.hostname && location.protocol !== "file:") {
      host = location.hostname;
    }
  }

  if (host == null) {
    // Release build, no bridge, no DOM — nothing to detect from.
    return [DEFAULT_HOST];
  }

  if (host === "localhost" || host === "127.0.0.1") {
    // `localhost` from an Android runtime means "the emulator itself", not
    // the host machine — correct only once `adb reverse tcp:8098 tcp:8098`
    // is in place (the desktop app applies this automatically). Appending
    // `10.0.2.2` as a second candidate rather than rewriting the first
    // covers the no-adb case too, without needing to tell an AVD apart from
    // a USB-attached physical device (for which only `localhost`+reverse
    // works).
    return isAndroid ? [DEFAULT_HOST, "10.0.2.2"] : [DEFAULT_HOST];
  }

  if (isLikelyIpAddress(host)) {
    return [host];
  }

  // A DNS/tunnel name (Expo `--tunnel`'s `*.exp.direct`, ngrok, mDNS
  // `*.local`) isn't reliably reachable over a raw `ws://` — a tunnel host
  // never is, but a `.local` mDNS name often is. Demote it behind
  // `localhost` instead of dropping it, so both cases still get a chance.
  return [DEFAULT_HOST, host];
}

export interface DevHostResolver {
  /** Next host to try. Re-evaluated by `Transport` on every connection attempt. */
  next(): string;
  /** Freezes the resolver on whatever `next()` last returned — call once a connection opens. */
  pin(): void;
  /** Whether `next()` currently reads a not-yet-warmed cache (still just the fallback). */
  readonly needsWarmUp: boolean;
}

/**
 * Builds the host resolver `init()` hands to `Transport`. An explicit
 * `options.host` short-circuits everything below it — no warm-up, no
 * rotation, no `import("react-native")` at all — while still re-evaluating
 * a function form on every attempt, exactly as already documented on
 * `TransportOptions.host`.
 */
export function createDevHostResolver(explicit?: string | (() => string)): DevHostResolver {
  if (explicit !== undefined) {
    return {
      next: () => (typeof explicit === "function" ? explicit() : explicit),
      pin: () => {},
      needsWarmUp: false,
    };
  }

  let index = 0;
  let last = DEFAULT_HOST;
  let pinned: string | null = null;

  return {
    next(): string {
      if (pinned) return pinned;
      const candidates = getDevHostCandidates();
      last = candidates[index % candidates.length] ?? DEFAULT_HOST;
      index++;
      return last;
    },
    pin(): void {
      pinned = last;
    },
    get needsWarmUp(): boolean {
      return cachedCandidates === undefined;
    },
  };
}
