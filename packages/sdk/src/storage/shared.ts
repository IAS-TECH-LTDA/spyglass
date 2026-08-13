/** Best-effort JSON parse for KV engines that store everything as strings. */
export function parseMaybeJson(value: string | null | undefined): unknown {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Inverse of `parseMaybeJson`, for writing a desktop-edited value back into
 * a string-typed KV engine (spec 0007). A known-lossy edge case, documented
 * rather than fought: a stored string that merely *looks* like JSON (e.g.
 * `"42"`) round-trips as the number `42` through `parseMaybeJson` — editing
 * and writing it back re-serializes to the same string, so this is stable,
 * just not distinguishable from "the app actually stored the number 42".
 */
export function serializeForKv(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
