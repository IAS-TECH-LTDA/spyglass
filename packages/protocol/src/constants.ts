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

export const PROTOCOL_VERSION = 1 as const;
