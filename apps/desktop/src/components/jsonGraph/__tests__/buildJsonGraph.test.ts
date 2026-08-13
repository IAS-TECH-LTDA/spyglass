import { describe, expect, it } from "vitest";
import { buildJsonGraph, MAX_NODES, pathToId } from "../buildJsonGraph";

describe("buildJsonGraph", () => {
  it("renders a flat object of primitives as a single node with no edges", () => {
    const { nodes, edges, isFlat } = buildJsonGraph({ a: 1, b: "x", c: true, d: null });
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0);
    expect(isFlat).toBe(true);
    expect(nodes[0].rows.every((r) => r.kind === "primitive")).toBe(true);
  });

  it("materializes a nested object as parent + child node joined by an edge", () => {
    const { nodes, edges, isFlat } = buildJsonGraph({ user: { name: "Ana" } });
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(isFlat).toBe(false);

    const root = nodes.find((n) => n.id === "$")!;
    const child = nodes.find((n) => n.id === "$.user")!;
    expect(root.rows).toContainEqual(expect.objectContaining({ key: "user", kind: "child-ref", childNodeId: "$.user" }));
    expect(child.rows).toContainEqual(expect.objectContaining({ key: "name", kind: "primitive", value: "Ana" }));
    expect(edges[0]).toMatchObject({ source: "$", target: "$.user" });
  });

  it("inlines a short array of primitives as a single row instead of a child node", () => {
    const { nodes, edges } = buildJsonGraph({ items: [1, 2, 3] });
    expect(nodes).toHaveLength(1); // no child node for `items`
    expect(edges).toHaveLength(0);
    expect(nodes[0].rows).toContainEqual(expect.objectContaining({ key: "items", kind: "inline-array", value: [1, 2, 3] }));
  });

  it("gives an array of objects its own child node per element", () => {
    const { nodes, edges } = buildJsonGraph({ list: [{ id: 1 }, { id: 2 }] }, { defaultExpandDepth: 2 });
    // root + list + 2 elements
    expect(nodes.map((n) => n.id).sort()).toEqual(["$", "$.list", "$.list[0]", "$.list[1]"]);
    expect(edges).toHaveLength(3);
  });

  it("renders a circular reference as a terminal [Circular] row without recursing forever", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const { nodes } = buildJsonGraph(obj);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].rows).toContainEqual(expect.objectContaining({ key: "self", kind: "circular" }));
  });

  it("handles a cycle one level removed from the root (not just direct self-reference)", () => {
    const child: Record<string, unknown> = { name: "child" };
    const root: Record<string, unknown> = { child };
    child.parent = root;
    const { nodes } = buildJsonGraph(root, { defaultExpandDepth: 3 });
    const childNode = nodes.find((n) => n.id === "$.child")!;
    expect(childNode.rows).toContainEqual(expect.objectContaining({ key: "parent", kind: "circular" }));
  });

  it("respects the global node budget instead of materializing an unbounded graph", () => {
    // A linear chain (one key per level) sidesteps MAX_OBJECT_KEYS_OPEN — the
    // only thing that should stop materialization here is the node budget.
    let chain: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < MAX_NODES + 50; i++) {
      chain = { next: chain };
    }
    const { nodes, truncated } = buildJsonGraph(chain, { defaultExpandDepth: MAX_NODES + 100 });
    expect(nodes.length).toBeLessThanOrEqual(MAX_NODES);
    expect(truncated).toBe(true);
  });

  it("produces stable ids across two builds of structurally-equal data", () => {
    const a = { user: { name: "Ana", items: [{ id: 1 }] } };
    const b = { user: { name: "Ana", items: [{ id: 1 }] } };
    const g1 = buildJsonGraph(a, { defaultExpandDepth: 3 });
    const g2 = buildJsonGraph(b, { defaultExpandDepth: 3 });
    expect(g1.nodes.map((n) => n.id).sort()).toEqual(g2.nodes.map((n) => n.id).sort());
  });

  it("honors defaultExpandDepth, collapsing containers past it", () => {
    const data = { a: { b: { c: 1 } } };
    const shallow = buildJsonGraph(data, { defaultExpandDepth: 1 });
    // root materialized, "a" materialized (depth 1), "b" collapsed (depth 2 > 1)
    expect(shallow.nodes.map((n) => n.id).sort()).toEqual(["$", "$.a"]);
    const aNode = shallow.nodes.find((n) => n.id === "$.a")!;
    expect(aNode.rows).toContainEqual(expect.objectContaining({ key: "b", kind: "collapsed", childNodeId: "$.a.b" }));
  });

  it("force-expands a path listed in expandedPaths past defaultExpandDepth", () => {
    const data = { a: { b: { c: 1 } } };
    const expanded = buildJsonGraph(data, { defaultExpandDepth: 1, expandedPaths: new Set(["$.a.b"]) });
    expect(expanded.nodes.map((n) => n.id).sort()).toEqual(["$", "$.a", "$.a.b"]);
  });

  it("emits an overflow row when an object/array exceeds the open threshold", () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 60; i++) big[`k${i}`] = i; // > MAX_OBJECT_KEYS_OPEN (50)
    const { nodes } = buildJsonGraph(big);
    expect(nodes[0].rows.some((r) => r.kind === "overflow")).toBe(true);
    expect(nodes[0].rows.filter((r) => r.kind === "primitive")).toHaveLength(50);
  });

  it("shows every row when the overflow node id is in expandedOverflow", () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 60; i++) big[`k${i}`] = i;
    const { nodes } = buildJsonGraph(big, { expandedOverflow: new Set(["$"]) });
    expect(nodes[0].rows.some((r) => r.kind === "overflow")).toBe(false);
    expect(nodes[0].rows.filter((r) => r.kind === "primitive")).toHaveLength(60);
  });

  it("treats a bare primitive root as a single node with one row", () => {
    const { nodes, isFlat } = buildJsonGraph(42, { rootLabel: "value" });
    expect(nodes).toHaveLength(1);
    expect(nodes[0].rows).toEqual([{ key: "value", path: [], kind: "primitive", value: 42 }]);
    expect(isFlat).toBe(true);
  });

  it("treats null as a primitive root, not a container", () => {
    const { nodes } = buildJsonGraph(null);
    expect(nodes[0].rows[0]).toMatchObject({ kind: "primitive", value: null });
  });
});

describe("pathToId", () => {
  it("renders object keys and array indices in a stable, distinguishable format", () => {
    expect(pathToId([])).toBe("$");
    expect(pathToId(["user"])).toBe("$.user");
    expect(pathToId(["items", 0])).toBe("$.items[0]");
    expect(pathToId(["a", "b", 2, "c"])).toBe("$.a.b[2].c");
  });
});
