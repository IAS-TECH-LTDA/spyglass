/**
 * 8097 is React DevTools' own long-standing default WebSocket port, which
 * React Native's built-in "connect to React DevTools" dev-mode setup also
 * targets automatically — colliding with it starves a physical iOS app's
 * second connection attempt to the same host:port indefinitely (confirmed:
 * iOS's Network.framework never completes it, even after 60+s). Picked 8098
 * to not collide with that or Metro's own 8081/8082.
 */
export const DEFAULT_PORT = 8098;
export const DEFAULT_HOST = "localhost";

/** How often the SDK sends `ping` and expects a `pong` back. */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/** Desktop marks an app as disconnected after this many missed heartbeats. */
export const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 3;

/** Values serialized in a payload larger than this (chars) get truncated. */
export const MAX_VALUE_SIZE = 20_000;

/** Max depth walked when truncating nested objects/arrays. */
export const MAX_SERIALIZE_DEPTH = 12;

/**
 * Max JSON-Pointer segments `applyPatch` walks for a single op. A patch is
 * attacker-reachable data on the desktop (comes straight off an
 * unauthenticated LAN WebSocket) — without a cap, a path with tens of
 * thousands of segments recurses `setAtPath` that many times and blows the
 * stack. Well above any real state tree (`MAX_SERIALIZE_DEPTH` already caps
 * how deep a value can be before it's even serialized), so this only ever
 * bites a malformed/malicious patch.
 */
export const MAX_PATCH_PATH_SEGMENTS = 64;

export const PROTOCOL_VERSION = 1 as const;

/**
 * How long the desktop waits for a `storage/write-result` (or
 * `state/write-result`) before giving up on a `storage/write`/`state/write`
 * (spec 0007, spec 0007-state). There's no delivery guarantee on that
 * direction — the app may have disconnected, or (in production) never
 * registered a handler at all — so this is the backstop that turns "no
 * response" into a visible failure instead of a write that silently never
 * resolves. Shared by both channels rather than duplicated per-channel.
 */
export const STORAGE_WRITE_TIMEOUT_MS = 3_000;
