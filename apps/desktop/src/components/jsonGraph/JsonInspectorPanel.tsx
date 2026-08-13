import { useState } from "react";
import type { JsonGraphEditable, JsonGraphNode, JsonRow } from "./buildJsonGraph";
import { CopyButton } from "../CopyButton";

export interface JsonInspectorPanelProps {
  node: JsonGraphNode;
  /**
   * The specific field currently focused, if any. Absent right after
   * navigating into a node via a `child-ref` click — there's no single
   * field yet, just the node's own fields listed below, unfocused.
   */
  row?: JsonRow;
  editable?: JsonGraphEditable;
  /** Same row-click contract as `JsonValueNode`'s row list — reused verbatim for the fields table below, so a `child-ref`/primitive/inline-array/circular field there does exactly what clicking it on the canvas card would. */
  onSelectRow: (nodeId: string, row: JsonRow) => void;
  /** Collapsed/overflow rows never go through `onSelectRow` — same split as `JsonValueNode`'s own rows, since expanding/paginating isn't "selecting a value". */
  onToggleExpand: (nodeId: string) => void;
  onToggleOverflow: (nodeId: string) => void;
  onClose: () => void;
}

/**
 * The side column a row click opens (spec: "click a field, see + edit it in
 * a column"). Replaces the old per-row inline `<input>` edit (one line,
 * truncated by the row's fixed height) with a real multi-line editor, plus a
 * fixed Field/Value table of the whole node below it — so the field being
 * edited stays visible in context (highlighted) instead of the person
 * losing track of which one they're looking at among the node's other rows.
 */
export function JsonInspectorPanel({ node, row, editable, onSelectRow, onToggleExpand, onToggleOverflow, onClose }: JsonInspectorPanelProps) {
  const pathLabel = row ? (row.path.length === 0 ? "(root)" : row.path.join(".")) : node.label || "(root)";

  const handleRowClick = (r: JsonRow) => {
    if (r.kind === "collapsed") {
      if (r.childNodeId) onToggleExpand(r.childNodeId);
      return;
    }
    if (r.kind === "overflow") {
      onToggleOverflow(node.id);
      return;
    }
    onSelectRow(node.id, r);
  };

  return (
    <aside className="json-inspector">
      <div className="json-inspector-head">
        <span className="json-inspector-path" title={pathLabel}>
          {pathLabel}
        </span>
        {row && (row.kind === "primitive" || row.kind === "inline-array") && (
          <CopyButton size="sm" title="Copy value" text={() => JSON.stringify(row.value, null, 2)} />
        )}
        <button type="button" className="icon-btn json-inspector-close" title="Close" aria-label="Close" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {row && <FieldEditor node={node} row={row} editable={editable} />}

      {node.rows.length > 0 && (
        <div className="json-inspector-fields">
          <h4>Fields</h4>
          <table className="json-inspector-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {node.rows.map((r) => (
                <tr
                  key={`${r.kind}:${r.key}`}
                  className={`json-inspector-row ${r === row ? "json-inspector-row-selected" : ""}`}
                  onClick={() => handleRowClick(r)}
                >
                  <td className="json-inspector-row-key">{r.kind === "overflow" ? "" : r.key}</td>
                  <td className="json-inspector-row-value" title={fieldPreview(r)}>
                    {fieldPreview(r)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </aside>
  );
}

function FieldEditor({ node, row, editable }: { node: JsonGraphNode; row: JsonRow; editable?: JsonGraphEditable }) {
  const canEdit = Boolean(editable) && !editable?.disabled && row.kind === "primitive";
  const statusKey = row.path.join(".");
  const status = editable?.status?.[statusKey];
  const [draft, setDraft] = useState(() => (row.kind === "circular" ? "" : JSON.stringify(row.value, null, 2)));

  if (row.kind === "circular") {
    return (
      <div className="json-inspector-editor">
        <p className="json-inspector-circular">
          Circular reference — {node.label || "this node"} refers back to an ancestor, nothing to show here.
        </p>
      </div>
    );
  }

  const save = () => {
    if (!editable) return;
    // JSON.parse lets the user change the value's *type* (e.g. "1" -> 1),
    // not just its content. Anything that isn't valid JSON falls back to the
    // raw typed string rather than silently discarding the edit.
    let nextValue: unknown;
    try {
      nextValue = draft === "" ? draft : JSON.parse(draft);
    } catch {
      nextValue = draft;
    }
    editable.onEdit(row.path, nextValue);
  };

  return (
    <div className="json-inspector-editor">
      <textarea
        className="json-inspector-textarea"
        value={draft}
        readOnly={!canEdit}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
      />
      {canEdit && (
        <div className="json-inspector-editor-actions">
          <button type="button" className="btn-accent" disabled={status === "pending"} onClick={save}>
            Save
          </button>
          {status && <span className={`jgn-status-dot jgn-status-dot-${status}`} title={status} />}
        </div>
      )}
    </div>
  );
}

function fieldPreview(row: JsonRow): string {
  switch (row.kind) {
    case "collapsed":
    case "overflow":
      return row.summary ?? "";
    case "circular":
      return "[Circular]";
    case "child-ref":
      return "→";
    default: {
      const s = JSON.stringify(row.value);
      if (s === undefined) return String(row.value);
      return s.length > 60 ? `${s.slice(0, 60)}…` : s;
    }
  }
}
