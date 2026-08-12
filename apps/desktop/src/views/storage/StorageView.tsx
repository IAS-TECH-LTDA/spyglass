import { useEffect, useMemo, useRef, useState } from "react";
import type { StorageEngine } from "spyglass-protocol";
import { useConnectionStore } from "../../state/connection";
import { JsonTree } from "../../components/JsonTree";
import { CopyButton } from "../../components/CopyButton";
import { useResizableWidth } from "../../lib/useResizableWidth";
import { SchemaDiagram } from "./SchemaDiagram";
import { inferForeignKeys } from "./inferForeignKeys";

type EngineKind = "kv" | "relational";

const ENGINE_META: Record<StorageEngine, { label: string; color: string; kind: EngineKind }> = {
  asyncStorage: { label: "AsyncStorage", color: "#5b8cff", kind: "kv" },
  mmkv: { label: "MMKV", color: "#a78bfa", kind: "kv" },
  localStorage: { label: "localStorage", color: "#22d3ee", kind: "kv" },
  sessionStorage: { label: "sessionStorage", color: "#94a3b8", kind: "kv" },
  sqlite: { label: "SQLite", color: "#fb923c", kind: "relational" },
  watermelondb: { label: "WatermelonDB", color: "#34d399", kind: "relational" },
  realm: { label: "Realm", color: "#f472b6", kind: "relational" },
};

/** How deep a row/entry's JSON expands once you click it open — "detailed" mode. */
const DETAIL_EXPAND_DEPTH = 6;

export function StorageView({ appId }: { appId: string }) {
  const appData = useConnectionStore((s) => s.data[appId]);
  const storage = appData?.storage ?? {};
  const engines = Object.keys(storage) as StorageEngine[];
  const [selectedEngine, setSelectedEngine] = useState<StorageEngine | null>(null);

  const activeEngine = selectedEngine && storage[selectedEngine] ? selectedEngine : engines[0];
  const snapshot = activeEngine ? storage[activeEngine] : undefined;

  if (engines.length === 0) {
    return (
      <div className="view-empty">
        <p>
          No storage engine connected yet. Attach a storage adapter, e.g. <code>attachAsyncStorage(AsyncStorage)</code>{" "}
          from <code>spyglass-react/storage/async-storage</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="storage-view">
      <nav className="storage-chips">
        {engines.map((engine) => {
          const meta = ENGINE_META[engine];
          const snap = storage[engine];
          const count = meta.kind === "kv" ? (snap?.entries?.length ?? 0) : (snap?.schema?.length ?? 0);
          return (
            <button
              key={engine}
              className={`storage-chip ${engine === activeEngine ? "active" : ""}`}
              style={{ "--chip-color": meta.color } as React.CSSProperties}
              onClick={() => setSelectedEngine(engine)}
            >
              <EngineIcon kind={meta.kind} />
              <span>{meta.label}</span>
              <span className="storage-chip-count">{count}</span>
            </button>
          );
        })}
      </nav>

      {snapshot?.entries && <KvTable entries={snapshot.entries} />}
      {snapshot?.schema && snapshot.rows && <RelationalStorage schema={snapshot.schema} rows={snapshot.rows} />}
    </div>
  );
}

function KvTable({ entries }: { entries: { key: string; value: unknown }[] }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (entries.length === 0) return <div className="view-empty">Empty.</div>;

  return (
    <div className="table-rows">
      <table className="data-table">
        <thead>
          <tr>
            <th className="row-toggle-cell"></th>
            <th>Key</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const isOpen = expandedKey === entry.key;
            return (
              <RowGroup
                key={entry.key}
                open={isOpen}
                onToggle={() => setExpandedKey(isOpen ? null : entry.key)}
                colSpan={2}
                summaryCells={
                  <>
                    <td className="kv-key">{entry.key}</td>
                    <td className="kv-preview">{previewValue(entry.value)}</td>
                  </>
                }
              >
                <div className="row-detail-head">
                  <span>{entry.key}</span>
                  <CopyButton size="sm" title="Copy value" text={() => JSON.stringify(entry.value, null, 2)} />
                </div>
                <JsonTree data={entry.value} defaultExpandDepth={DETAIL_EXPAND_DEPTH} />
              </RowGroup>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RelationalStorage({
  schema,
  rows,
}: {
  schema: import("spyglass-protocol").TableSchema[];
  rows: Record<string, unknown[]>;
}) {
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [highlightRowId, setHighlightRowId] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const {
    width: detailWidth,
    resizing,
    containerRef: viewRef,
    startResize,
  } = useResizableWidth({
    storageKey: "dm:storage-detail-width",
    defaultWidth: 380,
    minWidth: 260,
    minOppositeWidth: 420,
    handleEdge: "left",
  });

  const tableName = selectedTable ?? schema[0]?.name ?? null;
  const tableSchema = schema.find((t) => t.name === tableName);
  const tableRows = tableName ? rows[tableName] ?? [] : [];

  const foreignKeys = useMemo(
    () => (tableName ? inferForeignKeys(schema, tableName) : {}),
    [schema, tableName],
  );

  useEffect(() => {
    if (!highlightRowId) return;
    const el = rowRefs.current.get(highlightRowId);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    setExpandedRowId(highlightRowId);
    const timer = setTimeout(() => setHighlightRowId(null), 1800);
    return () => clearTimeout(timer);
  }, [highlightRowId, tableName]);

  const selectTable = (name: string) => {
    setSelectedTable(name);
    setExpandedRowId(null);
  };

  const navigateToRelated = (targetTable: string, id: string) => {
    rowRefs.current.clear();
    setSelectedTable(targetTable);
    setHighlightRowId(id);
  };

  const labelColumn = tableSchema?.columns.find((c) => !c.isPrimaryKey)?.name ?? tableSchema?.columns[0]?.name;

  return (
    <div
      className="schema-view"
      ref={viewRef}
      style={{ gridTemplateColumns: tableName ? `220px 1fr 6px ${detailWidth}px` : "220px 1fr" }}
    >
      <aside className="side-list">
        {schema.map((t) => (
          <button
            key={t.name}
            className={`side-item ${t.name === tableName ? "active" : ""}`}
            onClick={() => selectTable(t.name)}
          >
            <span className="badge">{(rows[t.name] ?? []).length} rows</span>
            <span className="side-item-label">{t.name}</span>
          </button>
        ))}
      </aside>

      <SchemaDiagram schema={schema} selectedTable={tableName} onSelectTable={selectTable} />

      {tableName && (
        <div
          className={`view-resizer ${resizing ? "resizing" : ""}`}
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize detail panel"
        />
      )}

      {tableName && (
        <aside className="schema-detail-panel">
          <h3>{tableName}</h3>
          {tableRows.length === 0 ? (
            <div className="view-empty">No rows.</div>
          ) : (
            <ul className="schema-rows-list">
              {tableRows.map((row, i) => {
                const record = row as Record<string, unknown>;
                const rowId = record.id !== undefined ? String(record.id) : String(i);
                const isOpen = expandedRowId === rowId;
                const label = labelColumn ? String(record[labelColumn] ?? rowId) : rowId;
                return (
                  <li
                    key={i}
                    ref={(el) => {
                      if (el) rowRefs.current.set(rowId, el);
                      else rowRefs.current.delete(rowId);
                    }}
                  >
                    <div
                      className={`schema-row-summary ${rowId === highlightRowId ? "row-highlighted" : ""}`}
                      onClick={() => setExpandedRowId(isOpen ? null : rowId)}
                    >
                      <span className={`jt-toggle ${isOpen ? "open" : ""}`}>▸</span>
                      <span className="schema-row-label">{label}</span>
                    </div>
                    {isOpen && (
                      <div className="row-detail-fields">
                        {tableSchema?.columns.map((c) => (
                          <div key={c.name} className="row-detail-field">
                            <span className="row-detail-label">{c.name}</span>
                            <Cell
                              value={record[c.name]}
                              targetTable={foreignKeys[c.name]}
                              onNavigate={navigateToRelated}
                              detailed
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      )}
    </div>
  );
}

/**
 * One row that's always visible (`summaryCells`) plus an accordion detail
 * row that expands beneath it on click, showing `children` — used by the
 * KV table for the click-to-see-everything-detailed interaction.
 */
function RowGroup({
  open,
  onToggle,
  summaryCells,
  children,
  colSpan,
}: {
  open: boolean;
  onToggle: () => void;
  summaryCells: React.ReactNode;
  children: React.ReactNode;
  colSpan: number;
}) {
  return (
    <>
      <tr className="data-row" onClick={onToggle}>
        <td className="row-toggle-cell">
          <span className={`jt-toggle ${open ? "open" : ""}`}>▸</span>
        </td>
        {summaryCells}
      </tr>
      {open && (
        <tr className="row-detail">
          <td colSpan={colSpan + 1}>{children}</td>
        </tr>
      )}
    </>
  );
}

function Cell({
  value,
  targetTable,
  onNavigate,
  detailed = false,
}: {
  value: unknown;
  targetTable?: string;
  onNavigate: (table: string, id: string) => void;
  detailed?: boolean;
}) {
  if (value === null || value === undefined) return null;

  if (targetTable) {
    const id = String(value);
    return (
      <button
        className="fk-link"
        title={`Go to ${targetTable}.id = ${id}`}
        onClick={(e) => {
          e.stopPropagation();
          onNavigate(targetTable, id);
        }}
      >
        {id}
      </button>
    );
  }

  const parsed = parseCellValue(value);
  if (parsed !== value) {
    return <JsonTree data={parsed} defaultExpandDepth={detailed ? DETAIL_EXPAND_DEPTH : 0} />;
  }

  return <>{String(value)}</>;
}

/** One-line summary for a KV table's "Value" column — the row itself expands to the full value on click. */
function previewValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  if (Array.isArray(value)) return `[…] ${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    return `{…} ${keys.length} key${keys.length === 1 ? "" : "s"}`;
  }
  return String(value);
}

/** Tries to JSON.parse a string cell value (common for SQLite TEXT columns storing structured data). */
function parseCellValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function EngineIcon({ kind }: { kind: EngineKind }) {
  if (kind === "kv") {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <circle cx="5.5" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8.2 8h6.3M11.5 8v2.2M13.4 8v1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <ellipse cx="8" cy="3.6" rx="5" ry="1.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 3.6v8.8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V3.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
