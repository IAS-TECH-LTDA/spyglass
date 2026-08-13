import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { JsonGraphEditable, JsonGraphNode, JsonRow } from "./buildJsonGraph";

export interface JsonValueNodeProps {
  data: JsonGraphNode;
  editable?: JsonGraphEditable;
  onToggleExpand: (nodeId: string) => void;
  onToggleOverflow: (nodeId: string) => void;
  /**
   * Absent only for the one `JsonGraph` usage that opts out of the
   * inspector column (Navigation's params panel — see `JsonGraph`'s
   * `inspector` prop). When absent, rows that would otherwise open the
   * column (everything but collapsed/overflow, which always
   * expand/paginate regardless) render as plain, non-interactive text.
   */
  onSelectRow?: (nodeId: string, row: JsonRow) => void;
  /** Drives `.jgn-row-selected` — both must match (path keys alone collide across sibling nodes, e.g. every array node has a row keyed "0"). */
  selectedNodeId?: string;
  selectedPathKey?: string | null;
  /** True inside a ReactFlow canvas (needs connection handles); false in the flat/single-card mode. */
  showHandles?: boolean;
}

/** The visual content of one graph node — a header plus one row per key/index. Reused both as a plain card (flat mode) and wrapped with xyflow Handles (canvas mode, via JsonValueXyflowNode below). */
export function JsonValueNode({
  data,
  editable,
  onToggleExpand,
  onToggleOverflow,
  onSelectRow,
  selectedNodeId,
  selectedPathKey,
  showHandles,
}: JsonValueNodeProps) {
  return (
    // No `nodrag` here — the node itself (its header, in particular)
    // should stay draggable like GraphView's/SchemaDiagram's nodes. `nodrag`
    // is applied only to the specific interactive rows below (clickable
    // collapse/overflow toggles, select-to-inspect rows) so *those* clicks
    // don't also start a drag — not to the whole card.
    <div className="json-graph-node">
      {showHandles && <Handle type="target" position={Position.Left} className="json-graph-handle" />}
      <div className="json-graph-node-header">{data.label || (data.isArray ? "[ ]" : "{ }")}</div>
      <div className="json-graph-node-rows nowheel">
        {data.rows.length === 0 && <div className="jgn-row jgn-row-empty">{data.isArray ? "[ ]" : "{ }"}</div>}
        {data.rows.map((row) => (
          <JsonRowView
            key={`${row.kind}:${row.key}`}
            row={row}
            nodeId={data.id}
            editable={editable}
            onToggleExpand={onToggleExpand}
            onToggleOverflow={onToggleOverflow}
            onSelectRow={onSelectRow}
            selected={selectedNodeId === data.id && selectedPathKey === row.path.join(".")}
          />
        ))}
      </div>
      {showHandles && <Handle type="source" position={Position.Right} className="json-graph-handle" />}
    </div>
  );
}

interface JsonValueXyflowData extends Record<string, unknown> {
  node: JsonGraphNode;
  editable?: JsonGraphEditable;
  onToggleExpand: (nodeId: string) => void;
  onToggleOverflow: (nodeId: string) => void;
  onSelectRow?: (nodeId: string, row: JsonRow) => void;
  selectedNodeId?: string;
  selectedPathKey?: string | null;
}

/** Adapter registered in JsonGraphCanvas's `nodeTypes` — xyflow calls this with `NodeProps`, we just unwrap `data` onto JsonValueNode. */
export function JsonValueXyflowNode({ data }: NodeProps & { data: JsonValueXyflowData }) {
  return (
    <JsonValueNode
      data={data.node}
      editable={data.editable}
      onToggleExpand={data.onToggleExpand}
      onToggleOverflow={data.onToggleOverflow}
      onSelectRow={data.onSelectRow}
      selectedNodeId={data.selectedNodeId}
      selectedPathKey={data.selectedPathKey}
      showHandles
    />
  );
}

function JsonRowView({
  row,
  nodeId,
  editable,
  onToggleExpand,
  onToggleOverflow,
  onSelectRow,
  selected,
}: {
  row: JsonRow;
  nodeId: string;
  editable?: JsonGraphEditable;
  onToggleExpand: (nodeId: string) => void;
  onToggleOverflow: (nodeId: string) => void;
  onSelectRow?: (nodeId: string, row: JsonRow) => void;
  selected: boolean;
}) {
  if (row.kind === "collapsed") {
    return (
      <button
        type="button"
        className="jgn-row jgn-row-clickable nodrag"
        onClick={() => row.childNodeId && onToggleExpand(row.childNodeId)}
      >
        <span className="jgn-toggle">▸</span>
        <span className="jgn-key">{row.key}:</span>
        <span className="jgn-summary">{row.summary}</span>
      </button>
    );
  }

  if (row.kind === "overflow") {
    return (
      <button type="button" className="jgn-row jgn-row-clickable nodrag" onClick={() => onToggleOverflow(nodeId)}>
        <span className="jgn-summary jgn-summary-muted">{row.summary}</span>
      </button>
    );
  }

  // "circular", "child-ref", "primitive", "inline-array" — everything that
  // has (or points at) an actual value opens the inspector column on click,
  // when one's wired up (see JsonValueNodeProps.onSelectRow).
  const statusKey = row.path.join(".");
  const status = editable?.status?.[statusKey];
  const rowClass = `jgn-row ${onSelectRow ? "jgn-row-clickable nodrag" : ""} ${selected ? "jgn-row-selected" : ""} ${status ? `jgn-status-${status}` : ""}`;

  if (row.kind === "circular") {
    return (
      <RowTag className={rowClass} onClick={onSelectRow ? () => onSelectRow(nodeId, row) : undefined}>
        <span className="jgn-key">{row.key}:</span>
        <span className="jgn-null">[Circular]</span>
      </RowTag>
    );
  }

  if (row.kind === "child-ref") {
    return (
      <RowTag className={rowClass} onClick={onSelectRow ? () => onSelectRow(nodeId, row) : undefined}>
        <span className="jgn-key">{row.key}:</span>
        <span className="jgn-summary jgn-summary-muted">➜</span>
      </RowTag>
    );
  }

  // "primitive" or "inline-array".
  return (
    <RowTag
      className={rowClass}
      title={status === "failed" ? "Failed to apply — see the inspector column for details" : undefined}
      onClick={onSelectRow ? () => onSelectRow(nodeId, row) : undefined}
    >
      <span className="jgn-key">{row.key}:</span>
      <span className="jgn-value" title={typeof row.value === "string" ? row.value : undefined}>
        <PrimitiveValueView value={row.value} />
      </span>
      {status && <span className={`jgn-status-dot jgn-status-dot-${status}`} />}
    </RowTag>
  );
}

/** Renders a `<button>` when clickable (keyboard-accessible, per the a11y pass — the row count that can be clicked grew a lot with the inspector column), a plain `<div>` when not (read-only usage, e.g. Navigation's params panel). */
function RowTag({
  className,
  onClick,
  title,
  children,
}: {
  className: string;
  onClick?: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  if (!onClick) {
    return (
      <div className={className} title={title}>
        {children}
      </div>
    );
  }
  return (
    <button type="button" className={className} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

function PrimitiveValueView({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="jt-null">{value === null ? "null" : "undefined"}</span>;
  }
  if (Array.isArray(value)) {
    return <span className="jt-string">[{value.map((v) => JSON.stringify(v)).join(", ")}]</span>;
  }
  if (typeof value === "string") {
    const shown = value.length > 200 ? `${value.slice(0, 200)}…` : value;
    return <span className="jt-string">"{shown}"</span>;
  }
  if (typeof value === "number") return <span className="jt-number">{value}</span>;
  if (typeof value === "boolean") return <span className="jt-boolean">{String(value)}</span>;
  return <span className="jt-null">{String(value)}</span>;
}
