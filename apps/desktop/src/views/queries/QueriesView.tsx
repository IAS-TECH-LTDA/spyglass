import { useEffect, useMemo, useState } from "react";
import { applyPatch } from "spyglass-protocol";
import type { QueryCommandKind, QueryInfo } from "spyglass-protocol";
import { useConnectionStore, type PendingQueryCommand, type PendingQueryWrite } from "../../state/connection";
import { JsonGraph, type JsonGraphEditable } from "../../components/jsonGraph/JsonGraph";
import { CopyButton } from "../../components/CopyButton";
import { LiveEditBanner } from "../../components/LiveEditBanner";
import { toJsonPointer } from "../../lib/jsonPointer";

const COMMANDS: Array<{ kind: QueryCommandKind; label: string }> = [
  { kind: "refetch", label: "Refetch" },
  { kind: "invalidate", label: "Invalidate" },
  { kind: "reset", label: "Reset" },
  { kind: "remove", label: "Remove" },
];

export function QueriesView({ appId }: { appId: string }) {
  const queries = useConnectionStore((s) => s.data[appId]?.queries ?? {});
  const [selectedHash, setSelectedHash] = useState<string | null>(null);

  // Consumes a "jump here from Network" request (spec 0011) exactly once —
  // selects the target query and pulses it, mirroring StorageView's
  // RelationalStorage.navigateToRelated highlight pattern.
  const pendingHighlight = useConnectionStore((s) => s.pendingHighlight);
  const clearPendingHighlight = useConnectionStore((s) => s.clearPendingHighlight);
  const [highlightedHash, setHighlightedHash] = useState<string | null>(null);

  useEffect(() => {
    if (pendingHighlight?.tab !== "queries" || !pendingHighlight.queryHash) return;
    if (!queries[pendingHighlight.queryHash]) return; // target no longer/not yet present
    setSelectedHash(pendingHighlight.queryHash);
    setHighlightedHash(pendingHighlight.queryHash);
    clearPendingHighlight();
    const timer = setTimeout(() => setHighlightedHash(null), 1800);
    return () => clearTimeout(timer);
  }, [pendingHighlight, queries, clearPendingHighlight]);

  const list = Object.values(queries).sort((a, b) => b.dataUpdatedAt - a.dataUpdatedAt);

  if (list.length === 0) {
    return (
      <div className="view-empty">
        <p>
          No query cache connected yet. Attach <code>attachReactQuery(queryClient)</code> from{" "}
          <code>spyglass-react/query/react-query</code>.
        </p>
      </div>
    );
  }

  const active = (selectedHash && queries[selectedHash]) || list[0];

  return (
    <div className="queries-view">
      <aside className="side-list">
        {list.map((q) => (
          <button
            key={q.queryHash}
            className={`side-item query-item ${q.queryHash === active.queryHash ? "active" : ""} ${q.queryHash === highlightedHash ? "row-highlighted" : ""}`}
            onClick={() => setSelectedHash(q.queryHash)}
          >
            <span className={`status-pill ${statusClass(q)}`}>{q.status}</span>
            <span className="query-item-key">{formatQueryKey(q.queryKey)}</span>
            {q.observersCount > 0 && <small className="query-item-observers">{q.observersCount}</small>}
          </button>
        ))}
      </aside>

      <QueryDetail appId={appId} query={active} />
    </div>
  );
}

function QueryDetail({ appId, query }: { appId: string; query: QueryInfo }) {
  const canWrite = useConnectionStore((s) => s.apps[appId]?.capabilities.includes("query:write") ?? false);
  const sendQueryWrite = useConnectionStore((s) => s.sendQueryWrite);
  const pendingQueryWrites = useConnectionStore((s) => s.data[appId]?.pendingQueryWrites);
  const [editedPathKey, setEditedPathKey] = useState<string | null>(null);

  // Most recently sent write to this query, if any — drives the status dot
  // on whichever field was last edited. Mirrors StoresView's StoreStatePanel.
  const latestWrite = useMemo(() => {
    if (!pendingQueryWrites) return undefined;
    let latest: PendingQueryWrite | undefined;
    for (const w of Object.values(pendingQueryWrites)) {
      if (w.queryHash !== query.queryHash) continue;
      if (!latest || w.sentAt > latest.sentAt) latest = w;
    }
    return latest;
  }, [pendingQueryWrites, query.queryHash]);

  const handleEdit = (path: (string | number)[], newValue: unknown) => {
    setEditedPathKey(path.join("."));
    const updatedData =
      path.length === 0 ? newValue : applyPatch(query.data, [{ op: "replace", path: toJsonPointer(path), value: newValue }]);
    sendQueryWrite(appId, query.queryHash, updatedData);
  };

  const editable: JsonGraphEditable | undefined = canWrite
    ? { onEdit: handleEdit, status: editedPathKey && latestWrite ? { [editedPathKey]: latestWrite.status } : undefined }
    : undefined;

  return (
    <section className="query-detail">
      <div className="query-detail-head">
        <h3>{formatQueryKey(query.queryKey)}</h3>

        <div className="query-meta-row">
          <span>Status</span>
          <span className={statusClass(query)}>{query.status}</span>
        </div>
        <div className="query-meta-row">
          <span>Fetch status</span>
          <span className={`fetch-status fetch-status-${query.fetchStatus}`}>{query.fetchStatus}</span>
        </div>
        <div className="query-meta-row">
          <span>Observers</span>
          <span>{query.observersCount}</span>
        </div>
        <div className="query-meta-row">
          <span>Data updated</span>
          <span>{query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toLocaleTimeString() : "—"}</span>
        </div>
        {query.isInvalidated && (
          <div className="query-meta-row">
            <span>Invalidated</span>
            <span>yes — refetch pending</span>
          </div>
        )}

        <CopyButton title="Copy query key" text={() => JSON.stringify(query.queryKey, null, 2)} />

        {canWrite && (
          <QueryActionsToolbar appId={appId} queryHash={query.queryHash} observersCount={query.observersCount} />
        )}
      </div>

      {canWrite && <LiveEditBanner noticeId="queries-edit">Editar os dados aqui, ou usar Refetch/Invalidate/Reset/Remove, afeta imediatamente o cache do React Query no app conectado.</LiveEditBanner>}

      <div className={`query-section ${canWrite ? "live-edit-accent" : ""}`}>
        <div className="query-section-head">
          <h4>Data</h4>
          {query.data !== undefined && (
            <CopyButton size="sm" title="Copy data" text={() => JSON.stringify(query.data, null, 2)} />
          )}
        </div>
        {query.data !== undefined ? (
          <JsonGraph data={query.data} defaultExpandDepth={2} editable={editable} />
        ) : (
          <div className="view-empty">No data yet.</div>
        )}
      </div>

      {query.error !== undefined && (
        <div className="query-section">
          <h4>Error</h4>
          <JsonGraph data={query.error} defaultExpandDepth={2} />
        </div>
      )}
    </section>
  );
}

/**
 * Refetch/Invalidate/Reset/Remove (spec 0010) — only rendered when the
 * connected app advertises `query:write` (dev-only build with
 * `allowRemoteWrites` on), same "don't show a control that can only time
 * out" reasoning as `StorageView`'s `canWrite` gate. All four buttons
 * share one disabled state, keyed off whether *any* command for this
 * `queryHash` is still pending — simpler and safer than letting multiple
 * commands race against the same query.
 */
function QueryActionsToolbar({ appId, queryHash, observersCount }: { appId: string; queryHash: string; observersCount: number }) {
  const sendQueryCommand = useConnectionStore((s) => s.sendQueryCommand);
  const pendingQueryCommands = useConnectionStore((s) => s.data[appId]?.pendingQueryCommands);

  const latest = useMemo(() => {
    if (!pendingQueryCommands) return undefined;
    let result: PendingQueryCommand | undefined;
    for (const c of Object.values(pendingQueryCommands)) {
      if (c.queryHash !== queryHash) continue;
      if (!result || c.sentAt > result.sentAt) result = c;
    }
    return result;
  }, [pendingQueryCommands, queryHash]);

  const disabled = latest?.status === "pending";

  return (
    <div className="query-actions">
      {COMMANDS.map(({ kind, label }) => (
        <button
          key={kind}
          type="button"
          className={`query-action-btn ${kind === "remove" ? "query-action-btn-remove" : ""}`}
          disabled={disabled}
          title={
            kind === "remove" && observersCount > 0
              ? `This query has ${observersCount} active observer(s) — it may reappear immediately via their automatic refetch.`
              : undefined
          }
          onClick={() => sendQueryCommand(appId, queryHash, kind)}
        >
          {label}
        </button>
      ))}
      {latest?.status && <span className={`jgn-status-dot jgn-status-dot-${latest.status}`} title={latest.error ?? latest.status} />}
    </div>
  );
}

function statusClass(q: QueryInfo): string {
  if (q.status === "success") return "status-ok";
  if (q.status === "error") return "status-error";
  return "status-pending";
}

/** One-line, human-readable rendering of a query's structural key, e.g. `todos, {"page":2}`. */
function formatQueryKey(key: unknown[]): string {
  return key.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(", ");
}
