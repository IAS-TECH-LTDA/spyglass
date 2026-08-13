/**
 * JSON-Pointer path for a value produced by a `JsonGraph` edit callback —
 * reuses `spyglass-protocol`'s `applyPatch` (same escaping rules) to
 * reconstruct a whole value around one edited leaf. Shared by every editable
 * `JsonGraph` consumer (Storage KV, Stores/Zustand): a write down to the app
 * always replaces a whole value (KV entry, store state), never a sub-path,
 * so every caller needs this same "wrap one leaf back into the whole thing"
 * step before sending.
 */
export function toJsonPointer(path: (string | number)[]): string {
  return path.map((seg) => `/${String(seg).replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
}
