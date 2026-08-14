import { useCallback, useMemo, useState } from "react";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { buildJsonGraph, type JsonGraphEditable, type JsonGraphNode, type JsonRow } from "./buildJsonGraph";
import { JsonInspectorPanel } from "./JsonInspectorPanel";
import { JsonValueNode, JsonValueXyflowNode } from "./JsonValueNode";
import { layoutNodes } from "../../lib/dagreLayout";
import { JsonTree } from "../JsonTree";
import { useT } from "../../i18n";

export type { JsonGraphEditable } from "./buildJsonGraph";

export interface JsonGraphProps {
  data: unknown;
  rootLabel?: string;
  /** Depth auto-expanded on first render (root is depth 0). Default 1 — same meaning as JsonTree's. */
  defaultExpandDepth?: number;
  /** Passed by whichever call site supports write-back (Storage KV, Stores/Zustand — see spec 0007/0007-state); every other usage renders read-only inside the inspector column. */
  editable?: JsonGraphEditable;
  /** Canvas height for the multi-node case. Auto-derived (clamped [160, 520]) when omitted — a canvas needs an explicit height, unlike JsonTree's grow-to-content. */
  height?: number;
  /**
   * Click-a-field-to-inspect-and-edit side column. On for every usage except
   * Navigation's route-params panel, which is already its own detail panel
   * one level up (`GraphView`'s `.nav-detail`) — stacking a second one
   * inside it would be a panel-in-a-panel for no benefit.
   */
  inspector?: boolean;
}

// Matches .json-graph-node's min-width in styles.css — dagre needs a real
// width estimate to space nodes apart; keeping the two in sync avoids
// nodes visually overlapping once the actual (CSS-driven) render is wider
// than what layout assumed.
const NODE_WIDTH = 420;
const HEADER_HEIGHT = 30;
const ROW_HEIGHT = 22;
/** Above this serialized size, deriving+laying out a graph isn't worth it — React Flow has no virtualization, every node is real DOM. Falls back to the original JsonTree, which is already tuned for large payloads via its own collapse-by-default heuristics. */
const GRAPH_MAX_BYTES = 256 * 1024;

export function JsonGraph({ data, rootLabel, defaultExpandDepth = 1, editable, height, inspector = true }: JsonGraphProps) {
  const { t } = useT();
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [expandedOverflow, setExpandedOverflow] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<{ nodeId: string; pathKey: string | null } | null>(null);

  const oversized = useMemo(() => isOversized(data), [data]);

  const graph = useMemo(() => {
    if (oversized) return null;
    return buildJsonGraph(data, { rootLabel, defaultExpandDepth, expandedPaths, expandedOverflow });
  }, [data, rootLabel, defaultExpandDepth, expandedPaths, expandedOverflow, oversized]);

  const onToggleExpand = useCallback((nodeId: string) => {
    setExpandedPaths((prev) => (prev.has(nodeId) ? prev : new Set(prev).add(nodeId)));
  }, []);

  const onToggleOverflow = useCallback((nodeId: string) => {
    setExpandedOverflow((prev) => (prev.has(nodeId) ? prev : new Set(prev).add(nodeId)));
  }, []);

  // A `child-ref` row navigates the panel to that child node (pathKey null
  // — nothing focused yet, just the node's own fields); everything else
  // (primitive/inline-array/circular) focuses that exact field. Collapsed/
  // overflow rows never reach here — they keep their own onToggleExpand/
  // onToggleOverflow click handled directly in JsonValueNode.
  const onSelectRow = useCallback((nodeId: string, row: JsonRow) => {
    if (row.kind === "child-ref") {
      if (row.childNodeId) setSelection({ nodeId: row.childNodeId, pathKey: null });
      return;
    }
    setSelection({ nodeId, pathKey: row.path.join(".") });
  }, []);

  if (oversized || !graph) {
    return (
      <div className="json-graph-fallback">
        <p className="empty-hint">{t("jsonGraph.largePayload")}</p>
        <JsonTree data={data} defaultExpandDepth={defaultExpandDepth} rootLabel={rootLabel} />
      </div>
    );
  }

  const selectedNode = selection ? graph.nodes.find((n) => n.id === selection.nodeId) : undefined;
  const selectedRow =
    selection?.pathKey != null ? selectedNode?.rows.find((r) => r.path.join(".") === selection.pathKey) : undefined;
  const activeOnSelectRow = inspector ? onSelectRow : undefined;

  // Single node: render the card alone, no canvas chrome (no pan/zoom,
  // no floating box in an empty void) — this is also always the shape for
  // a flat object/array of primitives, the most common case for e.g.
  // network bodies and query data.
  const main = graph.isFlat ? (
    <div className="json-graph json-graph-flat">
      {graph.nodes[0] && (
        <JsonValueNode
          data={graph.nodes[0]}
          editable={editable}
          onToggleExpand={onToggleExpand}
          onToggleOverflow={onToggleOverflow}
          onSelectRow={activeOnSelectRow}
          selectedNodeId={selection?.nodeId}
          selectedPathKey={selection?.pathKey}
        />
      )}
    </div>
  ) : (
    <div className="json-graph" style={{ height: height ?? defaultHeight(graph.nodes) }}>
      <JsonGraphCanvas
        graphNodes={graph.nodes}
        graphEdges={graph.edges}
        editable={editable}
        onToggleExpand={onToggleExpand}
        onToggleOverflow={onToggleOverflow}
        onSelectRow={activeOnSelectRow}
        selectedNodeId={selection?.nodeId}
        selectedPathKey={selection?.pathKey}
      />
    </div>
  );

  if (!inspector) return main;

  return (
    <div className="json-graph-shell">
      <div className="json-graph-main">{main}</div>
      {selectedNode && (
        <JsonInspectorPanel
          // Forces a clean remount (fresh draft state) on every selection
          // change instead of an effect reconciling stale draft text.
          key={`${selection?.nodeId}::${selection?.pathKey ?? ""}`}
          node={selectedNode}
          row={selectedRow}
          editable={editable}
          onSelectRow={onSelectRow}
          onToggleExpand={onToggleExpand}
          onToggleOverflow={onToggleOverflow}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  );
}

function JsonGraphCanvas({
  graphNodes,
  graphEdges,
  editable,
  onToggleExpand,
  onToggleOverflow,
  onSelectRow,
  selectedNodeId,
  selectedPathKey,
}: {
  graphNodes: JsonGraphNode[];
  graphEdges: { id: string; source: string; target: string }[];
  editable?: JsonGraphEditable;
  onToggleExpand: (nodeId: string) => void;
  onToggleOverflow: (nodeId: string) => void;
  onSelectRow?: (nodeId: string, row: JsonRow) => void;
  selectedNodeId?: string;
  selectedPathKey?: string | null;
}) {
  const { nodes, edges } = useMemo(() => {
    const layoutInputs = graphNodes.map((n) => ({
      id: n.id,
      width: NODE_WIDTH,
      height: HEADER_HEIGHT + Math.max(1, n.rows.length) * ROW_HEIGHT,
    }));
    const positions = layoutNodes(layoutInputs, graphEdges, { rankdir: "LR", nodesep: 24, ranksep: 90 });

    const xyNodes: Node[] = graphNodes.map((n) => ({
      id: n.id,
      type: "jsonValue",
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      // Explicit width, matching what dagre laid out against — without
      // this, React Flow only learns the real (CSS-driven) width after an
      // async ResizeObserver measurement, and `fitView` (which runs on
      // mount) can compute its pan/zoom against stale/zero dimensions,
      // rendering the node partially outside the visible viewport.
      style: { width: NODE_WIDTH },
      data: { node: n, editable, onToggleExpand, onToggleOverflow, onSelectRow, selectedNodeId, selectedPathKey },
    }));
    const xyEdges: Edge[] = graphEdges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
    return { nodes: xyNodes, edges: xyEdges };
  }, [graphNodes, graphEdges, editable, onToggleExpand, onToggleOverflow, onSelectRow, selectedNodeId, selectedPathKey]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      fitView
      proOptions={{ hideAttribution: true }}
      // A debug JSON viewer embedded in a scrollable side panel must never
      // hijack the page's own scroll — zoom stays available via Controls.
      zoomOnScroll={false}
      panOnScroll={false}
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}

const NODE_TYPES = { jsonValue: JsonValueXyflowNode };

function isOversized(data: unknown): boolean {
  try {
    return JSON.stringify(data).length > GRAPH_MAX_BYTES;
  } catch {
    // Threw on a circular reference or a bigint, etc. — real wire data
    // already went through the SDK's safeSerialize (which resolves cycles
    // to a TruncatedValue marker before it ever reaches the desktop), so
    // this should be rare; fall back to the always-safe JsonTree either way.
    return true;
  }
}

function defaultHeight(nodes: JsonGraphNode[]): number {
  const maxRows = nodes.reduce((max, n) => Math.max(max, n.rows.length), 1);
  const estimate = HEADER_HEIGHT + maxRows * ROW_HEIGHT + 80;
  return Math.min(520, Math.max(160, estimate));
}
