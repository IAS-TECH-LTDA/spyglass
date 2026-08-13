/**
 * Pure derivation of a JSON value into a graph of nodes/edges for
 * `JsonGraph.tsx` to render with `@xyflow/react`. No import of
 * `@xyflow/react` here on purpose — this file is unit-testable without a
 * DOM, and `JsonGraph.tsx` maps the plain structs below onto xyflow's
 * `Node`/`Edge` shapes.
 *
 * Traversal is breadth-first, not depth-first (a deliberate divergence from
 * `JsonTree`'s DFS): the node budget below should be spent on the shallow,
 * structurally-informative layer first — that's what reads well on a
 * canvas. DFS would burn the whole budget down one arbitrary branch.
 *
 * The collapse/truncation thresholds mirror `JsonTree.tsx`'s already-tuned
 * values (`MAX_ARRAY_ITEMS_OPEN`, `MAX_OBJECT_KEYS_OPEN`) rather than
 * inventing new numbers.
 */

/** Mirrors JsonTree's MAX_OBJECT_KEYS_OPEN. */
const MAX_OBJECT_KEYS_OPEN = 50;
/** Mirrors JsonTree's MAX_ARRAY_ITEMS_OPEN. */
const MAX_ARRAY_ITEMS_OPEN = 100;
/** A primitives-only array up to this length renders as one inline row instead of its own node — the single biggest node-count saver. */
const INLINE_ARRAY_MAX_ITEMS = 10;
/** Global cap on materialized nodes across the whole graph. Containers beyond this degrade to collapsed rows. */
export const MAX_NODES = 300;

export type JsonPathSegment = string | number;

export type JsonRowKind = "primitive" | "inline-array" | "child-ref" | "collapsed" | "circular" | "overflow";

export interface JsonRow {
  key: string;
  path: JsonPathSegment[];
  kind: JsonRowKind;
  /** Set for "primitive" and "inline-array". */
  value?: unknown;
  /** Set for "child-ref" and "collapsed" — the node id the row refers to. */
  childNodeId?: string;
  /** Set for "collapsed" and "overflow". */
  summary?: string;
}

export interface JsonGraphNode {
  id: string;
  label: string;
  isArray: boolean;
  depth: number;
  rows: JsonRow[];
}

export interface JsonGraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface JsonGraphResult {
  nodes: JsonGraphNode[];
  edges: JsonGraphEdge[];
  /** True when there's at most one node — nothing to pan/zoom, callers should skip canvas chrome. */
  isFlat: boolean;
  /** True when the node budget was exhausted before the whole value could be materialized. */
  truncated: boolean;
}

/**
 * Wiring for the edit UX — only ever passed by the one call site that
 * actually supports write-back (the Storage KV row; see spec 0007). Every
 * other `JsonGraph` usage renders read-only. Defined here (not in
 * `JsonGraph.tsx`) so both `JsonGraph.tsx` and `JsonValueNode.tsx` can
 * import it without a circular module dependency.
 */
export interface JsonGraphEditable {
  onEdit: (path: JsonPathSegment[], nextValue: unknown) => void;
  /** Per-path (dot-joined) pending/failed/superseded state, drives a row's status dot. */
  status?: Record<string, "pending" | "applied" | "failed" | "superseded">;
  disabled?: boolean;
}

export interface BuildJsonGraphOptions {
  rootLabel?: string;
  /** Depth auto-materialized as real nodes (root is depth 0); containers deeper than this render as a collapsed row. Default 1. */
  defaultExpandDepth?: number;
  /** Node ids force-expanded past defaultExpandDepth (user clicked a collapsed row). */
  expandedPaths?: Set<string>;
  /** Node ids whose overflow row is force-expanded to show every row instead of the first N + an overflow row. */
  expandedOverflow?: Set<string>;
}

/** Canonical, deterministic node id for a path — stable across re-derivations of structurally-equal data, so live updates don't lose the user's expansion state. */
export function pathToId(path: JsonPathSegment[]): string {
  let out = "$";
  for (const seg of path) {
    out += typeof seg === "number" ? `[${seg}]` : `.${seg}`;
  }
  return out;
}

function isPrimitiveIsh(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

function describeContainer(value: object): string {
  if (Array.isArray(value)) return `[…] ${value.length} item${value.length === 1 ? "" : "s"}`;
  const n = Object.keys(value).length;
  return `{…} ${n} key${n === 1 ? "" : "s"}`;
}

function labelFor(path: JsonPathSegment[], rootLabel?: string): string {
  if (path.length === 0) return rootLabel ?? "";
  const last = path[path.length - 1];
  return typeof last === "number" ? `[${last}]` : String(last);
}

interface QueueItem {
  id: string;
  path: JsonPathSegment[];
  value: object;
  depth: number;
  /** Object references from root down to (and including) this item — cycle detection only, not a global "already rendered" set, so a repeated-but-non-circular reference doesn't false-positive. */
  ancestors: object[];
}

export function buildJsonGraph(data: unknown, options: BuildJsonGraphOptions = {}): JsonGraphResult {
  const { rootLabel, defaultExpandDepth = 1, expandedPaths = new Set(), expandedOverflow = new Set() } = options;

  if (data === null || typeof data !== "object") {
    return {
      nodes: [
        {
          id: "$",
          label: rootLabel ?? "",
          isArray: false,
          depth: 0,
          rows: [{ key: rootLabel ?? "value", path: [], kind: "primitive", value: data }],
        },
      ],
      edges: [],
      isFlat: true,
      truncated: false,
    };
  }

  const nodes: JsonGraphNode[] = [];
  const edges: JsonGraphEdge[] = [];
  const seen = new Set<string>();
  const queue: QueueItem[] = [{ id: "$", path: [], value: data, depth: 0, ancestors: [] }];
  let truncated = false;

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);

    const isArray = Array.isArray(item.value);
    const rawEntries: Array<[string, unknown]> = isArray
      ? (item.value as unknown[]).map((v, i): [string, unknown] => [String(i), v])
      : Object.entries(item.value as Record<string, unknown>);

    const maxOpen = isArray ? MAX_ARRAY_ITEMS_OPEN : MAX_OBJECT_KEYS_OPEN;
    const overflowExpanded = expandedOverflow.has(item.id);
    const visibleCount = overflowExpanded ? rawEntries.length : Math.min(rawEntries.length, maxOpen);
    const hasOverflow = !overflowExpanded && rawEntries.length > maxOpen;

    const ancestorsIncludingSelf = [...item.ancestors, item.value];
    const rows: JsonRow[] = [];

    for (let i = 0; i < visibleCount; i++) {
      const [key, child] = rawEntries[i];
      const childPath = [...item.path, isArray ? i : key];
      const rowKey = isArray ? String(i) : key;

      if (child === null || typeof child !== "object") {
        rows.push({ key: rowKey, path: childPath, kind: "primitive", value: child });
        continue;
      }

      if (ancestorsIncludingSelf.includes(child)) {
        rows.push({ key: rowKey, path: childPath, kind: "circular" });
        continue;
      }

      const childIsArray = Array.isArray(child);
      const childValues = childIsArray ? (child as unknown[]) : Object.values(child as Record<string, unknown>);

      if (childIsArray && childValues.length > 0 && childValues.length <= INLINE_ARRAY_MAX_ITEMS && childValues.every(isPrimitiveIsh)) {
        rows.push({ key: rowKey, path: childPath, kind: "inline-array", value: child });
        continue;
      }

      const childId = pathToId(childPath);
      const childDepth = item.depth + 1;
      const forceExpand = expandedPaths.has(childId);
      // +1 reserves a slot for `item` itself — it isn't in `nodes` yet (only
      // pushed once this whole loop finishes) or in `queue` (already shifted
      // out), but it's guaranteed to become a node.
      const overBudget = nodes.length + 1 + queue.length >= MAX_NODES;

      if ((childDepth > defaultExpandDepth && !forceExpand) || overBudget) {
        if (overBudget) truncated = true;
        rows.push({ key: rowKey, path: childPath, kind: "collapsed", childNodeId: childId, summary: describeContainer(child) });
        continue;
      }

      rows.push({ key: rowKey, path: childPath, kind: "child-ref", childNodeId: childId });
      edges.push({ id: `${item.id}->${childId}`, source: item.id, target: childId });
      queue.push({ id: childId, path: childPath, value: child, depth: childDepth, ancestors: ancestorsIncludingSelf });
    }

    if (hasOverflow) {
      rows.push({
        key: "__overflow__",
        path: item.path,
        kind: "overflow",
        childNodeId: item.id,
        summary: `+${rawEntries.length - visibleCount} more`,
      });
    }

    nodes.push({ id: item.id, label: labelFor(item.path, rootLabel), isArray, depth: item.depth, rows });
  }

  return { nodes, edges, isFlat: nodes.length <= 1, truncated };
}
