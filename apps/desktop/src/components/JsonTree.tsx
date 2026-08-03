import { useState } from "react";

export interface JsonTreeProps {
  data: unknown;
  /** Depth auto-expanded on first render (root is depth 0). Default 1. */
  defaultExpandDepth?: number;
  rootLabel?: string;
}

const MAX_ARRAY_ITEMS_OPEN = 100;
const MAX_OBJECT_KEYS_OPEN = 50;
const MAX_STRING_PREVIEW = 200;

export function JsonTree({ data, defaultExpandDepth = 1, rootLabel }: JsonTreeProps) {
  return (
    <div className="json-tree">
      <Node name={rootLabel} value={data} depth={0} defaultExpandDepth={defaultExpandDepth} ancestors={[]} />
    </div>
  );
}

interface NodeProps {
  name?: string;
  value: unknown;
  depth: number;
  defaultExpandDepth: number;
  /** Object references from root down to this node's parent — used for cycle detection only (not a global "already rendered" set, so repeated-but-non-circular references don't false-positive). */
  ancestors: object[];
}

function Node({ name, value, depth, defaultExpandDepth, ancestors }: NodeProps) {
  if (value !== null && typeof value === "object") {
    return <ContainerNode name={name} value={value} depth={depth} defaultExpandDepth={defaultExpandDepth} ancestors={ancestors} />;
  }
  return (
    <div className="jt-row">
      {name !== undefined && <span className="jt-key">{name}:</span>}
      <PrimitiveValue value={value} />
    </div>
  );
}

function ContainerNode({ name, value, depth, defaultExpandDepth, ancestors }: NodeProps & { value: object }) {
  const isCircular = ancestors.includes(value);
  const isArray = Array.isArray(value);
  const entries = isCircular
    ? []
    : isArray
      ? (value as unknown[]).map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>);

  const tooLarge = isArray ? entries.length > MAX_ARRAY_ITEMS_OPEN : entries.length > MAX_OBJECT_KEYS_OPEN;
  const [open, setOpen] = useState(!tooLarge && depth < defaultExpandDepth);

  if (isCircular) {
    return (
      <div className="jt-row">
        {name !== undefined && <span className="jt-key">{name}:</span>}
        <span className="jt-null">[Circular]</span>
      </div>
    );
  }

  const summary = isArray
    ? `[…] ${entries.length} item${entries.length === 1 ? "" : "s"}`
    : `{…} ${entries.length} key${entries.length === 1 ? "" : "s"}`;
  const childAncestors = [...ancestors, value];

  return (
    <div className="jt-container">
      <div className="jt-row jt-clickable" onClick={() => setOpen((o) => !o)}>
        <span className={`jt-toggle ${open ? "open" : ""}`}>▸</span>
        {name !== undefined && <span className="jt-key">{name}:</span>}
        {!open && <span className="jt-summary">{summary}</span>}
        {open && <span className="jt-summary jt-summary-muted">{isArray ? "[" : "{"}</span>}
      </div>
      {open && (
        <div className="jt-children">
          {entries.map(([key, child]) => (
            <Node
              key={key}
              name={isArray ? undefined : key}
              value={child}
              depth={depth + 1}
              defaultExpandDepth={defaultExpandDepth}
              ancestors={childAncestors}
            />
          ))}
        </div>
      )}
      {open && <div className="jt-row jt-summary jt-summary-muted">{isArray ? "]" : "}"}</div>}
    </div>
  );
}

function PrimitiveValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="jt-null">{value === null ? "null" : "undefined"}</span>;
  }
  if (typeof value === "string") {
    return <TruncatedString value={value} />;
  }
  if (typeof value === "number") {
    return <span className="jt-number">{value}</span>;
  }
  if (typeof value === "boolean") {
    return <span className="jt-boolean">{String(value)}</span>;
  }
  if (typeof value === "function") {
    return <span className="jt-null">ƒ {value.name || "anonymous"}()</span>;
  }
  if (typeof value === "symbol") {
    return <span className="jt-null">{value.toString()}</span>;
  }
  if (typeof value === "bigint") {
    return <span className="jt-number">{value.toString()}n</span>;
  }
  return <span className="jt-null">{String(value)}</span>;
}

function TruncatedString({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > MAX_STRING_PREVIEW;
  const shown = expanded || !isLong ? value : `${value.slice(0, MAX_STRING_PREVIEW)}…`;

  return (
    <span className="jt-string">
      "{shown}"
      {isLong && (
        <span
          className="jt-str-more"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {expanded ? " less" : " more"}
        </span>
      )}
    </span>
  );
}
