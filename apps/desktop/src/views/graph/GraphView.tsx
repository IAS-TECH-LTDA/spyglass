import { useMemo, useState } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { JsonGraph } from "../../components/jsonGraph/JsonGraph";
import { useResizableWidth } from "../../lib/useResizableWidth";
import type { NavEdge, NavNode, NavTransitionEvent } from "../../state/connection";
import { useConnectionStore } from "../../state/connection";

interface ScreenNodeData extends Record<string, unknown> {
  name: string;
  params?: Record<string, unknown>;
  visits: number;
  active: boolean;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 64;
/** Gap between disconnected clusters of screens (e.g. separate stacks the user hasn't linked by navigating between them yet). */
const CLUSTER_GAP = 32;

/** How long a just-traversed edge stays highlighted, in ms. */
const EDGE_HIGHLIGHT_WINDOW_MS = 1200;

export function GraphView({ appId }: { appId: string }) {
  const navGraph = useConnectionStore((s) => s.data[appId]?.navGraph);
  const clearNavGraph = useConnectionStore((s) => s.clearNavGraph);
  const [selected, setSelected] = useState<string | null>(null);
  const {
    width: detailWidth,
    resizing,
    containerRef: bodyRef,
    startResize,
  } = useResizableWidth({
    storageKey: "dm:nav-detail-width",
    defaultWidth: 300,
    minWidth: 260,
    minOppositeWidth: 420,
    handleEdge: "left",
  });

  const nodeList = useMemo(() => Object.values(navGraph?.nodes ?? {}), [navGraph]);
  const edgeList = useMemo(() => Object.values(navGraph?.edges ?? {}), [navGraph]);

  const { nodes, edges } = useMemo(() => layout(nodeList, edgeList, navGraph?.activeName), [nodeList, edgeList, navGraph?.activeName]);

  const selectedNode = selected ? navGraph?.nodes[selected] : undefined;

  const history = useMemo<NavTransitionEvent[]>(
    () => (selectedNode ? (navGraph?.transitions ?? []).filter((t) => t.from === selectedNode.name || t.to === selectedNode.name) : []),
    [navGraph, selectedNode],
  );

  if (!navGraph || nodeList.length === 0) {
    return (
      <div className="view-empty">
        <p>
          No navigation events yet. Call <code>attachNavigation(navigationRef)</code> from{" "}
          <code>spyglass-react/navigation</code> and navigate to a screen in the app.
        </p>
      </div>
    );
  }

  const edgeIsFresh = Boolean(navGraph.lastTransitionAt && Date.now() - navGraph.lastTransitionAt < EDGE_HIGHLIGHT_WINDOW_MS);

  const styledEdges = edges.map((e) => {
    const lit = edgeIsFresh && navGraph.lastEdgeId === e.id;
    return { ...e, animated: lit, className: lit ? "edge-lit" : "" };
  });

  return (
    <div className="nav-view">
      <div className="nav-toolbar">
        <span className="nav-count">
          {nodeList.length} screen{nodeList.length === 1 ? "" : "s"} · {edgeList.length} link{edgeList.length === 1 ? "" : "s"}
        </span>
        <button
          className="icon-btn nav-clear"
          title="Clear navigation graph"
          aria-label="Clear navigation graph"
          onClick={() => {
            clearNavGraph(appId);
            setSelected(null);
          }}
        >
          <TrashIcon />
        </button>
      </div>

      <div className="nav-body" ref={bodyRef} style={{ gridTemplateColumns: `1fr 6px ${detailWidth}px` }}>
        <div className="nav-canvas">
          <ReactFlow
            nodes={nodes}
            edges={styledEdges}
            nodeTypes={NODE_TYPES}
            onNodeClick={(_, node) => setSelected(node.id)}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        <div
          className={`view-resizer ${resizing ? "resizing" : ""}`}
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize detail panel"
        />

        <aside className="nav-detail">
          {selectedNode ? (
            <>
              <h3>{selectedNode.name}</h3>
              <div className="nav-detail-meta">
                <span>{selectedNode.visits} visit{selectedNode.visits === 1 ? "" : "s"}</span>
                <span>Last seen {new Date(selectedNode.lastSeenAt).toLocaleTimeString()}</span>
              </div>
              {selectedNode.params && Object.keys(selectedNode.params).length > 0 ? (
                // No inspector column here — this panel *is* already the
                // detail column (.nav-detail); a second one nested inside it
                // would be a panel-in-a-panel for no benefit.
                <JsonGraph data={selectedNode.params} defaultExpandDepth={2} inspector={false} />
              ) : (
                <p className="muted">No params.</p>
              )}

              <h3 className="nav-history-heading">History</h3>
              {history.length === 0 ? (
                <p className="muted">No transitions yet.</p>
              ) : (
                <ul className="nav-history">
                  {history.map((t, i) => (
                    <li key={i} className="nav-history-item">
                      {t.to === selectedNode.name ? (
                        <span className="nav-history-arrow">← {t.from ?? "(start)"}</span>
                      ) : (
                        <span className="nav-history-arrow">→ {t.to}</span>
                      )}
                      {t.action && <span className="badge">{t.action}</span>}
                      <span className="nav-history-time">{new Date(t.ts).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="muted">Select a screen to see its params and history.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function paramsSummary(params: Record<string, unknown> | undefined): string {
  if (!params) return "no params";
  const keys = Object.keys(params);
  if (keys.length === 0) return "no params";
  const [first, ...rest] = keys;
  const firstValue = params[first];
  const preview = `${first}: ${typeof firstValue === "object" && firstValue !== null ? "{…}" : String(firstValue)}`;
  return rest.length > 0 ? `${preview} · +${rest.length} more` : preview;
}

function ScreenNode({ data }: NodeProps & { data: ScreenNodeData }) {
  return (
    <div className={`screen-node ${data.active ? "active" : ""}`}>
      <Handle type="target" position={Position.Left} className="screen-node-handle" />
      <div className="screen-node-header">
        <span className="screen-node-name">{data.name}</span>
        {data.visits > 0 && <span className="screen-node-badge">{data.visits}</span>}
      </div>
      <div className="screen-node-params">{paramsSummary(data.params)}</div>
      <Handle type="source" position={Position.Right} className="screen-node-handle" />
    </div>
  );
}

const NODE_TYPES = { screen: ScreenNode };

/**
 * Auto-layout via dagre, one weakly-connected cluster of screens at a time
 * (screens flow left to right by navigation order). Clustering independent
 * components separately — rather than running dagre once over everything —
 * keeps disconnected islands (e.g. a stack the user hasn't linked to the
 * rest by navigating between them yet) from spreading `fitView` out with a
 * lot of dead space.
 */
function layout(nodeList: NavNode[], edgeList: NavEdge[], activeName: string | undefined): { nodes: Node[]; edges: Edge[] } {
  const rawEdges: Edge[] = edgeList.map((e) => ({
    id: `${e.from}->${e.to}`,
    source: e.from,
    target: e.to,
    label: e.count > 1 ? String(e.count) : undefined,
  }));

  const clusters = computeClusters(
    nodeList.map((n) => n.name),
    edgeList,
  );

  const nodes: Node[] = [];
  let offsetY = 0;

  for (const cluster of clusters) {
    const graph = new dagre.graphlib.Graph();
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 90 });
    for (const name of cluster) graph.setNode(name, { width: NODE_WIDTH, height: NODE_HEIGHT });
    for (const e of edgeList) {
      if (cluster.includes(e.from) && cluster.includes(e.to)) graph.setEdge(e.from, e.to);
    }
    dagre.layout(graph);

    let minY = Infinity;
    let maxY = -Infinity;
    for (const name of cluster) {
      const pos = graph.node(name);
      minY = Math.min(minY, pos.y - NODE_HEIGHT / 2);
      maxY = Math.max(maxY, pos.y + NODE_HEIGHT / 2);
    }

    for (const name of cluster) {
      const node = nodeList.find((n) => n.name === name)!;
      const pos = graph.node(name);
      nodes.push({
        id: name,
        type: "screen",
        data: { name, params: node.params, visits: node.visits, active: name === activeName },
        position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 - minY + offsetY },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
    }

    offsetY += maxY - minY + CLUSTER_GAP;
  }

  return { nodes, edges: rawEdges };
}

function computeClusters(names: string[], edgeList: NavEdge[]): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const name of names) adjacency.set(name, new Set());
  for (const e of edgeList) {
    adjacency.get(e.from)?.add(e.to);
    adjacency.get(e.to)?.add(e.from);
  }

  const seen = new Set<string>();
  const clusters: string[][] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    const cluster: string[] = [];
    const stack = [name];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      cluster.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) stack.push(next);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5 5 13a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.5-8.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
