import type { JsonPatchOp } from "./types.js";

/**
 * Computes a minimal-effort JSON Patch (RFC 6902 subset: add/replace/remove)
 * between two already-JSON-safe values. Arrays are compared index-by-index
 * and replaced wholesale on length/shape change rather than diffed with an
 * LCS algorithm — state trees in RN apps are small enough that this stays
 * cheap, and a wholesale array replace is still far smaller than a full
 * state snapshot.
 */
export function diffValues(prev: unknown, next: unknown, basePath = ""): JsonPatchOp[] {
  if (Object.is(prev, next)) return [];

  const prevIsObj = isPlainObject(prev);
  const nextIsObj = isPlainObject(next);

  if (prevIsObj && nextIsObj) {
    return diffObjects(prev as Record<string, unknown>, next as Record<string, unknown>, basePath);
  }

  if (Array.isArray(prev) && Array.isArray(next)) {
    return diffArrays(prev, next, basePath);
  }

  // Type changed or primitive changed: single replace at this path.
  return [{ op: "replace", path: basePath || "/", value: next }];
}

function diffObjects(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  basePath: string,
): JsonPatchOp[] {
  const ops: JsonPatchOp[] = [];
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);

  for (const key of prevKeys) {
    if (!(key in next)) {
      ops.push({ op: "remove", path: `${basePath}/${escapePointer(key)}` });
    }
  }

  for (const key of nextKeys) {
    const path = `${basePath}/${escapePointer(key)}`;
    if (!(key in prev)) {
      ops.push({ op: "add", path, value: next[key] });
      continue;
    }
    ops.push(...diffValues(prev[key], next[key], path));
  }

  return ops;
}

function diffArrays(prev: unknown[], next: unknown[], basePath: string): JsonPatchOp[] {
  if (prev.length !== next.length) {
    return [{ op: "replace", path: basePath || "/", value: next }];
  }
  const ops: JsonPatchOp[] = [];
  for (let i = 0; i < next.length; i++) {
    ops.push(...diffValues(prev[i], next[i], `${basePath}/${i}`));
  }
  return ops;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// JSON Pointer (RFC 6901) escaping for `~` and `/` inside keys.
function escapePointer(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

function unescapePointer(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

/**
 * Applies a patch produced by `diffValues` and returns the resulting value.
 * Immutable: never mutates `value`, only the path being touched is cloned.
 * This is how the desktop UI reconstructs each store's live state from the
 * `state/init` snapshot plus the stream of `state/action` diffs.
 */
export function applyPatch(value: unknown, ops: JsonPatchOp[]): unknown {
  let result = value;
  for (const op of ops) {
    result = applyOp(result, op);
  }
  return result;
}

function applyOp(root: unknown, op: JsonPatchOp): unknown {
  const segments = op.path === "/" || op.path === "" ? [] : op.path.split("/").slice(1).map(unescapePointer);
  return setAtPath(root, segments, op);
}

function setAtPath(node: unknown, segments: string[], op: JsonPatchOp): unknown {
  if (segments.length === 0) {
    return op.op === "remove" ? undefined : op.value;
  }

  const [head, ...rest] = segments;

  if (Array.isArray(node)) {
    const index = Number(head);
    const copy = node.slice();
    if (rest.length === 0) {
      if (op.op === "remove") copy.splice(index, 1);
      else copy[index] = op.value;
    } else {
      copy[index] = setAtPath(copy[index], rest, op);
    }
    return copy;
  }

  const obj = node && typeof node === "object" ? (node as Record<string, unknown>) : {};
  const copy = { ...obj };
  if (rest.length === 0) {
    if (op.op === "remove") delete copy[head];
    else copy[head] = op.value;
  } else {
    copy[head] = setAtPath(copy[head], rest, op);
  }
  return copy;
}
