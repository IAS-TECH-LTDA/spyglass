import { MAX_PATCH_PATH_SEGMENTS } from "./constants.js";
import type { JsonPatchOp } from "./types.js";

// Keys that can reach a prototype instead of a plain data property when
// assigned via bracket notation (`obj[key] = ...`). `applyPatch` runs on
// data that arrived over an unauthenticated LAN WebSocket, so a patch is
// attacker-controlled input, not just data this process produced itself.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

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
  // `ops` comes straight off the wire (see doc comment above) — a
  // malformed/non-array `diff` must fail safe (leave state untouched)
  // rather than throw `ops is not iterable` into an unguarded reducer.
  if (!Array.isArray(ops)) return value;
  let result = value;
  for (const op of ops) {
    result = applyOp(result, op);
  }
  return result;
}

function applyOp(root: unknown, op: JsonPatchOp): unknown {
  if (!op || typeof op.path !== "string") return root;
  const segments = op.path === "/" || op.path === "" ? [] : op.path.split("/").slice(1).map(unescapePointer);
  // See MAX_PATCH_PATH_SEGMENTS's doc comment — a path this long can only be
  // malformed/malicious input, never a real diff produced by diffValues.
  if (segments.length > MAX_PATCH_PATH_SEGMENTS) return root;
  return setAtPath(root, segments, op);
}

function setAtPath(node: unknown, segments: string[], op: JsonPatchOp): unknown {
  if (segments.length === 0) {
    return op.op === "remove" ? undefined : op.value;
  }

  const [head, ...rest] = segments;

  if (Array.isArray(node)) {
    const index = Number(head);
    // Reject non-integer/out-of-range indices instead of letting `copy[index]
    // = value` create a sparse array out to an attacker-chosen length (a
    // single patch could otherwise inflate an array to billions of slots).
    // `index === node.length` is allowed (append), matching what a
    // legitimate same-length diffArrays replace can produce.
    if (!Number.isInteger(index) || index < 0 || index > node.length) return node;
    const copy = node.slice();
    if (rest.length === 0) {
      if (op.op === "remove") {
        if (index < copy.length) copy.splice(index, 1);
      } else {
        copy[index] = op.value;
      }
    } else {
      if (index >= copy.length) return node; // nothing to descend into
      copy[index] = setAtPath(copy[index], rest, op);
    }
    return copy;
  }

  // A key of `__proto__`/`constructor`/`prototype` would otherwise reach
  // `copy[head] = ...` below and, for `__proto__` specifically, invoke the
  // inherited setter and replace this node's own prototype (confirmed:
  // Object.prototype itself stays clean, since `copy` is always a freshly
  // spread `{}` — but the affected node's `hasOwnProperty`/`Object.keys`
  // behavior breaks). Treat it as a no-op instead of a valid write target.
  if (UNSAFE_KEYS.has(head)) return node;

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
