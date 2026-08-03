import { useState } from "react";
import type { QueryInfo } from "@datamobile/protocol";
import { useConnectionStore } from "../../state/connection";
import { JsonTree } from "../../components/JsonTree";
import { CopyButton } from "../../components/CopyButton";

export function QueriesView({ appId }: { appId: string }) {
  const queries = useConnectionStore((s) => s.data[appId]?.queries ?? {});
  const [selectedHash, setSelectedHash] = useState<string | null>(null);

  const list = Object.values(queries).sort((a, b) => b.dataUpdatedAt - a.dataUpdatedAt);

  if (list.length === 0) {
    return (
      <div className="view-empty">
        <p>
          No query cache connected yet. Attach <code>attachReactQuery(queryClient)</code> from{" "}
          <code>@datamobile/sdk/query/react-query</code>.
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
            className={`side-item query-item ${q.queryHash === active.queryHash ? "active" : ""}`}
            onClick={() => setSelectedHash(q.queryHash)}
          >
            <span className={`status-pill ${statusClass(q)}`}>{q.status}</span>
            <span className="query-item-key">{formatQueryKey(q.queryKey)}</span>
            {q.observersCount > 0 && <small className="query-item-observers">{q.observersCount}</small>}
          </button>
        ))}
      </aside>

      <QueryDetail query={active} />
    </div>
  );
}

function QueryDetail({ query }: { query: QueryInfo }) {
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
      </div>

      <div className="query-section">
        <div className="query-section-head">
          <h4>Data</h4>
          {query.data !== undefined && (
            <CopyButton size="sm" title="Copy data" text={() => JSON.stringify(query.data, null, 2)} />
          )}
        </div>
        {query.data !== undefined ? (
          <JsonTree data={query.data} defaultExpandDepth={2} />
        ) : (
          <div className="view-empty">No data yet.</div>
        )}
      </div>

      {query.error !== undefined && (
        <div className="query-section">
          <h4>Error</h4>
          <JsonTree data={query.error} defaultExpandDepth={2} />
        </div>
      )}
    </section>
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
