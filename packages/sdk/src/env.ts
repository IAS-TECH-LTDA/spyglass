/**
 * True in dev-style environments (`__DEV__` when defined, else
 * `NODE_ENV !== "production"`), false otherwise. Shared by every "on by
 * default in dev, off in production" default in the SDK (`diagnostics`,
 * auto-attach) so they can't silently drift from each other.
 */
export function isDevEnvironment(): boolean {
  const dev = (globalThis as { __DEV__?: unknown }).__DEV__;
  if (typeof dev === "boolean") return dev;
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.NODE_ENV !== "production";
}
