import dagre from "@dagrejs/dagre";

/**
 * Shared dagre layout helper — the ~20 lines `GraphView.tsx` and
 * `SchemaDiagram.tsx` each independently duplicate (build a dagre graph, set
 * per-node width/height, run layout, convert dagre's center coordinates to
 * React Flow's top-left-corner convention). New consumers (like
 * `JsonGraph.tsx`) should use this instead of a third copy.
 *
 * Deliberately NOT a `<DiagramCanvas>` component — the three consumers
 * diverge too much beyond this shared math (cluster splitting, per-node
 * height formulas, live re-layout with preserved expansion state) for a
 * shared canvas abstraction to pay for itself yet. Retrofitting
 * `GraphView`/`SchemaDiagram` onto this helper is a separate, independent
 * follow-up — not part of introducing it here.
 */

export interface LayoutInputNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutInputEdge {
  source: string;
  target: string;
}

export interface LayoutOptions {
  rankdir?: "LR" | "RL" | "TB" | "BT";
  nodesep?: number;
  ranksep?: number;
}

export interface LayoutPosition {
  x: number;
  y: number;
}

/** Returns each node's top-left position (React Flow's convention), keyed by id. */
export function layoutNodes(
  nodes: LayoutInputNode[],
  edges: LayoutInputEdge[],
  options: LayoutOptions = {},
): Map<string, LayoutPosition> {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: options.rankdir ?? "LR",
    nodesep: options.nodesep ?? 32,
    ranksep: options.ranksep ?? 80,
  });

  for (const node of nodes) {
    graph.setNode(node.id, { width: node.width, height: node.height });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  const positions = new Map<string, LayoutPosition>();
  for (const node of nodes) {
    const pos = graph.node(node.id);
    // dagre positions are node centers — React Flow expects top-left corners.
    positions.set(node.id, { x: pos.x - node.width / 2, y: pos.y - node.height / 2 });
  }
  return positions;
}
