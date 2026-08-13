import { describe, expect, it } from "vitest";
import { createEnvelope, decodeEnvelope, encodeEnvelope } from "../envelope.js";
import { applyPatch, diffValues } from "../diff.js";
import { safeSerialize, hashValue } from "../serialize.js";

describe("envelope", () => {
  it("round-trips through encode/decode", () => {
    const env = createEnvelope("ping", "app-1", { seq: 1 });
    const decoded = decodeEnvelope(encodeEnvelope(env));
    expect(decoded).toEqual(env);
  });

  it("rejects malformed frames without throwing", () => {
    expect(decodeEnvelope("not json")).toBeNull();
    expect(decodeEnvelope(JSON.stringify({ foo: "bar" }))).toBeNull();
  });

  it("round-trips the storage/write and storage/write-result pair (the one Desktop -> SDK direction)", () => {
    const write = createEnvelope("storage/write", "app-1", {
      requestId: "req-1",
      engine: "asyncStorage",
      key: "token",
      op: "set",
      value: "abc",
    });
    expect(decodeEnvelope(encodeEnvelope(write))).toEqual(write);

    const result = createEnvelope("storage/write-result", "app-1", { requestId: "req-1", ok: true });
    expect(decodeEnvelope(encodeEnvelope(result))).toEqual(result);
  });
});

describe("diffValues", () => {
  it("produces add/replace/remove ops for objects", () => {
    const prev = { a: 1, b: { c: 2 } };
    const next = { a: 1, b: { c: 3 }, d: 4 };
    const ops = diffValues(prev, next);
    expect(ops).toContainEqual({ op: "replace", path: "/b/c", value: 3 });
    expect(ops).toContainEqual({ op: "add", path: "/d", value: 4 });
  });

  it("replaces arrays wholesale on length change", () => {
    const ops = diffValues({ items: [1, 2] }, { items: [1, 2, 3] });
    expect(ops).toEqual([{ op: "replace", path: "/items", value: [1, 2, 3] }]);
  });

  it("returns no ops for identical values", () => {
    expect(diffValues({ a: 1 }, { a: 1 })).toEqual([]);
  });
});

describe("applyPatch", () => {
  it("round-trips: applying diffValues(prev, next) to prev reproduces next", () => {
    const cases: Array<[unknown, unknown]> = [
      [{ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 }, d: 4 }],
      [{ items: [1, 2] }, { items: [1, 2, 3] }],
      [{ user: { name: "Ana" } }, { user: { name: "Ana", age: 30 } }],
      [{ list: [{ id: 1 }, { id: 2 }] }, { list: [{ id: 1 }, { id: 9 }] }],
      [{ a: 1 }, { a: 1 }],
      [{ a: 1, toRemove: "x" }, { a: 1 }],
    ];

    for (const [prev, next] of cases) {
      const ops = diffValues(prev, next);
      expect(applyPatch(prev, ops)).toEqual(next);
    }
  });

  it("handles a top-level type change", () => {
    const ops = diffValues({ a: 1 }, "now a string");
    expect(applyPatch({ a: 1 }, ops)).toBe("now a string");
  });

  it("fails safe on a malformed/non-array diff instead of throwing", () => {
    const state = { a: 1 };
    // biome-ignore lint: deliberately wrong shape, simulating an attacker-controlled wire frame
    expect(applyPatch(state, { not: "an array" } as unknown as never)).toBe(state);
    // biome-ignore lint: same
    expect(applyPatch(state, null as unknown as never)).toBe(state);
  });

  it("rejects __proto__/constructor/prototype path segments without polluting Object.prototype", () => {
    const state = { a: { b: 1 } };
    const result = applyPatch(state, [
      { op: "replace", path: "/a/__proto__/polluted", value: "PWN" },
    ]) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(result.a)).toBe(Object.prototype);
    expect(result).toEqual(state);
  });

  it("rejects out-of-range/non-integer array indices instead of creating a sparse array", () => {
    const state = { items: [1, 2, 3] };
    const huge = applyPatch(state, [
      { op: "replace", path: "/items/999999999", value: "x" },
    ]) as typeof state;
    expect(huge.items.length).toBe(3);

    const negative = applyPatch(state, [{ op: "replace", path: "/items/-1", value: "x" }]) as typeof state;
    expect(negative).toEqual(state);

    // Appending exactly at length is still allowed (matches a legitimate diff).
    const appended = applyPatch(state, [{ op: "replace", path: "/items/3", value: 4 }]) as typeof state;
    expect(appended.items).toEqual([1, 2, 3, 4]);
  });

  it("ignores a patch whose path has an implausible number of segments instead of recursing unbounded", () => {
    const state = { a: 1 };
    const deepPath = `/${Array.from({ length: 5000 }, () => "x").join("/")}`;
    expect(() => applyPatch(state, [{ op: "replace", path: deepPath, value: 1 }])).not.toThrow();
    expect(applyPatch(state, [{ op: "replace", path: deepPath, value: 1 }])).toEqual(state);
  });
});

describe("safeSerialize", () => {
  it("marks circular references instead of throwing", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const result = safeSerialize(obj) as Record<string, unknown>;
    expect(result.a).toBe(1);
    expect((result.self as { __spyglass_truncated: boolean }).__spyglass_truncated).toBe(true);
  });

  it("passes through plain JSON-safe values untouched", () => {
    expect(safeSerialize({ a: [1, 2, "x"] })).toEqual({ a: [1, 2, "x"] });
  });

  it("serializes Error name/message/stack instead of producing {}", () => {
    const err = new Error("boom");
    const result = safeSerialize(err) as Record<string, unknown>;
    expect(result.name).toBe("Error");
    expect(result.message).toBe("boom");
    expect(typeof result.stack).toBe("string");
  });

  it("preserves extra own-enumerable properties on custom Error subclasses", () => {
    class CameraError extends Error {
      code: string;
      constructor(message: string, code: string) {
        super(message);
        this.name = "CameraError";
        this.code = code;
      }
    }
    const err = new CameraError("Encountered a fatal Camera error!", "camera/fatal-error");
    const result = safeSerialize(err) as Record<string, unknown>;
    expect(result.name).toBe("CameraError");
    expect(result.message).toBe("Encountered a fatal Camera error!");
    expect(result.code).toBe("camera/fatal-error");
  });

  it("handles an Error nested inside a plain object/array", () => {
    const result = safeSerialize({ error: new Error("nested") }) as { error: Record<string, unknown> };
    expect(result.error.message).toBe("nested");
  });

  it("truncates an oversized Error message/stack instead of shipping it unbounded", () => {
    const err = new Error("x".repeat(50_000));
    err.stack = "y".repeat(50_000);
    const result = safeSerialize(err) as Record<string, unknown>;
    expect((result.message as { __spyglass_truncated: boolean }).__spyglass_truncated).toBe(true);
    expect((result.stack as { __spyglass_truncated: boolean }).__spyglass_truncated).toBe(true);
  });
});

describe("hashValue", () => {
  it("is stable for equal input and differs on change", () => {
    expect(hashValue({ a: 1 })).toBe(hashValue({ a: 1 }));
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
  });
});
