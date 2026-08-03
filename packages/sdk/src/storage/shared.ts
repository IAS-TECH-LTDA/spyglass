/** Best-effort JSON parse for KV engines that store everything as strings. */
export function parseMaybeJson(value: string | null | undefined): unknown {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
