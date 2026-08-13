import { MAX_SERIALIZE_DEPTH, MAX_VALUE_SIZE } from "./constants.js";
import type { TruncatedValue } from "./types.js";

/**
 * Deep-clones a value into something JSON-safe, replacing values that are
 * circular, too deep, or too large with a `TruncatedValue` marker instead of
 * throwing or flooding the WebSocket. Used by every SDK adapter before a
 * payload is handed to the transport.
 */
export function safeSerialize(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  return walk(value, seen, 0);
}

function walk(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || typeof value !== "object") {
    return normalizePrimitive(value);
  }

  if (depth >= MAX_SERIALIZE_DEPTH) {
    return truncated(value, "max-depth-exceeded");
  }

  if (seen.has(value as object)) {
    return truncated(value, "circular-reference");
  }

  if (Array.isArray(value)) {
    seen.add(value);
    return value.map((item) => walk(item, seen, depth + 1));
  }

  if (value instanceof Map) {
    seen.add(value);
    return truncated(value, "Map", `Map(${value.size})`);
  }

  if (value instanceof Set) {
    seen.add(value);
    return truncated(value, "Set", `Set(${value.size})`);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    // `name`/`message`/`stack` are non-enumerable per spec, so the generic
    // "walk own enumerable keys" branch below sees none of them and would
    // serialize any Error to `{}` — silently dropping exactly the
    // information logging an error exists to show. Pull them out
    // explicitly, then still walk whatever *extra* own-enumerable
    // properties the error has (native bridge errors, DOMException-likes,
    // and custom Error subclasses often attach their own, e.g. `code`).
    seen.add(value);
    // Route through normalizePrimitive like any other string so a huge
    // message/stack (a deep RN bridge trace, say) can't bypass MAX_VALUE_SIZE
    // just because it's read off `.message`/`.stack` instead of a plain key.
    const out: Record<string, unknown> = {
      name: normalizePrimitive(value.name),
      message: normalizePrimitive(value.message),
      stack: normalizePrimitive(value.stack),
    };
    for (const key of Object.keys(value)) {
      if (key in out) continue;
      out[key] = walk((value as unknown as Record<string, unknown>)[key], seen, depth + 1);
    }
    return out;
  }

  // Plain object (or class instance) — walk own enumerable keys.
  seen.add(value as object);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = walk((value as Record<string, unknown>)[key], seen, depth + 1);
  }
  return out;
}

function normalizePrimitive(value: unknown): unknown {
  if (typeof value === "function") {
    return truncated(value, "function", `ƒ ${(value as { name?: string }).name || "anonymous"}()`);
  }
  if (typeof value === "symbol") {
    return truncated(value, "symbol", value.toString());
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "string" && value.length > MAX_VALUE_SIZE) {
    return truncated(value, "string", `${value.slice(0, 200)}…`, value.length);
  }
  return value;
}

function truncated(
  original: unknown,
  originalType: string,
  preview?: string,
  originalSize?: number,
): TruncatedValue {
  return {
    __spyglass_truncated: true,
    originalType,
    preview: preview ?? describeShape(original),
    originalSize,
  };
}

function describeShape(value: unknown): string {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value && typeof value === "object") {
    return `{ ${Object.keys(value).slice(0, 6).join(", ")}${Object.keys(value).length > 6 ? ", …" : ""} }`;
  }
  return String(value);
}

/**
 * Cheap, non-cryptographic hash of a JSON-safe value. Used as
 * `nextStateHash` so the desktop can detect out-of-order/duplicate
 * `state/action` messages without re-hashing the whole tree itself.
 */
export function hashValue(value: unknown): string {
  const json = JSON.stringify(value) ?? "null";
  let hash = 5381;
  for (let i = 0; i < json.length; i++) {
    hash = (hash * 33) ^ json.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}
