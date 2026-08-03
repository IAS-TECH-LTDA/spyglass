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
});

describe("safeSerialize", () => {
  it("marks circular references instead of throwing", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const result = safeSerialize(obj) as Record<string, unknown>;
    expect(result.a).toBe(1);
    expect((result.self as { __datamobile_truncated: boolean }).__datamobile_truncated).toBe(true);
  });

  it("passes through plain JSON-safe values untouched", () => {
    expect(safeSerialize({ a: [1, 2, "x"] })).toEqual({ a: [1, 2, "x"] });
  });
});

describe("hashValue", () => {
  it("is stable for equal input and differs on change", () => {
    expect(hashValue({ a: 1 })).toBe(hashValue({ a: 1 }));
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
  });
});
