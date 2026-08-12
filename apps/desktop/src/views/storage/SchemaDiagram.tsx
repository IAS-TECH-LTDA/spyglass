import { useMemo } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import type { ColumnSchema, TableSchema } from "spyglass-protocol";
import { inferForeignKeys } from "./inferForeignKeys";

interface TableNodeData extends Record<string, unknown> {
  name: string;
  columns: ColumnSchema[];
  foreignKeyColumns: Set<string>;
  selected: boolean;
}

const NODE_WIDTH = 220;
const HEADER_HEIGHT = 32;
const ROW_HEIGHT = 22;

export function SchemaDiagram({
  schema,
  selectedTable,
  onSelectTable,
}: {
  schema: TableSchema[];
  selectedTable: string | null;
  onSelectTable: (name: string) => void;
}) {
  const { nodes, edges } = useMemo(() => buildGraph(schema, selectedTable), [schema, selectedTable]);

  return (
    <div className="schema-diagram">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_, node) => onSelectTable(node.id)}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

function buildGraph(schema: TableSchema[], selectedTable: string | null): { nodes: Node[]; edges: Edge[] } {
  const relations = schema.flatMap((table) =>
    Object.entries(inferForeignKeys(schema, table.name)).map(([column, targetTable]) => ({
      from: table.name,
      column,
      to: targetTable,
    })),
  );
  const foreignKeysByTable = new Map<string, Set<string>>();
  for (const table of schema) {
    foreignKeysByTable.set(table.name, new Set(relations.filter((r) => r.from === table.name).map((r) => r.column)));
  }

  const rawNodes: Node[] = schema.map((table) => ({
    id: table.name,
    type: "table",
    position: { x: 0, y: 0 },
    data: {
      name: table.name,
      columns: table.columns,
      foreignKeyColumns: foreignKeysByTable.get(table.name) ?? new Set(),
      selected: table.name === selectedTable,
    },
  }));

  const rawEdges: Edge[] = relations.map((r) => ({
    id: `${r.from}.${r.column}->${r.to}`,
    source: r.from,
    target: r.to,
    animated: false,
  }));

  return { nodes: layout(rawNodes, rawEdges, schema), edges: rawEdges };
}

function layout(nodes: Node[], edges: Edge[], schema: TableSchema[]): Node[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", nodesep: 32, ranksep: 80 });

  const heightByTable = new Map(schema.map((t) => [t.name, HEADER_HEIGHT + t.columns.length * ROW_HEIGHT]));

  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: heightByTable.get(node.id) ?? HEADER_HEIGHT });
  }
  for (const edge of edges) graph.setEdge(edge.source, edge.target);

  dagre.layout(graph);

  return nodes.map((node) => {
    const pos = graph.node(node.id);
    const height = heightByTable.get(node.id) ?? HEADER_HEIGHT;
    return {
      ...node,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - height / 2 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });
}

function TableNode({ data }: NodeProps & { data: TableNodeData }) {
  return (
    <div className={`schema-node ${data.selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="schema-node-handle" />
      <div className="schema-node-header">{data.name}</div>
      <div className="schema-node-columns">
        {data.columns.map((col) => (
          <div key={col.name} className="schema-node-column">
            <span className={`schema-col-icon ${col.isPrimaryKey ? "pk" : data.foreignKeyColumns.has(col.name) ? "fk" : ""}`}>
              {col.isPrimaryKey ? <KeyIcon /> : data.foreignKeyColumns.has(col.name) ? <LinkIcon /> : null}
            </span>
            <span className="schema-col-name">{col.name}</span>
            {col.type && <span className="schema-col-type">{col.type}</span>}
          </div>
        ))}
      </div>
      <Handle type="source" position={Position.Right} className="schema-node-handle" />
    </div>
  );
}

const NODE_TYPES = { table: TableNode };

function KeyIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
      <circle cx="5" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7.5 8h6.5M11 8v2M13 8v1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
      <path
        d="M6.5 9.5 9.5 6.5M6 5.5l.7-.7a2.5 2.5 0 0 1 3.5 3.5l-.7.7M10 10.5l-.7.7a2.5 2.5 0 0 1-3.5-3.5l.7-.7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
