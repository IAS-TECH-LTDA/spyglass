import { useMemo, useState } from "react";
import type { NetworkEntry } from "../../state/connection";
import { useConnectionStore } from "../../state/connection";
import { CopyButton } from "../../components/CopyButton";
import { JsonTree } from "../../components/JsonTree";
import { toCurl } from "../../lib/curl";
import { useResizableWidth } from "../../lib/useResizableWidth";

/** Preferred display order for the most common verbs; anything else is appended alphabetically. */
const METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function NetworkView({ appId }: { appId: string }) {
  const requests = useConnectionStore((s) => s.data[appId]?.network ?? []);
  const clearNetwork = useConnectionStore((s) => s.clearNetwork);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState<Set<string>>(new Set());
  const {
    width: sidebarWidth,
    resizing,
    containerRef: viewRef,
    startResize,
  } = useResizableWidth({
    storageKey: "dm:network-sidebar-width",
    defaultWidth: 360,
    minWidth: 260,
    minOppositeWidth: 320,
    handleEdge: "right",
  });

  const availableMethods = useMemo(() => {
    const methods = new Set(requests.map((r) => r.method.toUpperCase()));
    return Array.from(methods).sort((a, b) => {
      const ai = METHOD_ORDER.indexOf(a);
      const bi = METHOD_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [requests]);

  const toggleMethod = (method: string) => {
    setMethodFilter((prev) => {
      const next = new Set(prev);
      if (next.has(method)) next.delete(method);
      else next.add(method);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter((r) => {
      if (methodFilter.size > 0 && !methodFilter.has(r.method.toUpperCase())) return false;
      if (!q) return true;
      return r.url.toLowerCase().includes(q) || r.method.toLowerCase().startsWith(q) || String(r.status ?? "").startsWith(q);
    });
  }, [requests, query, methodFilter]);

  const selected = filtered.find((r) => r.requestId === selectedId) ?? filtered[0];

  const handleClear = () => {
    clearNetwork(appId);
    setSelectedId(null);
  };

  return (
    <div
      className="network-view"
      ref={viewRef}
      style={{ gridTemplateColumns: `${sidebarWidth}px 6px 1fr` }}
    >
      <div className="network-list-col">
        <div className="network-toolbar">
          <input
            className="toolbar-search"
            placeholder="Filter by URL, method or status…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {availableMethods.length > 0 && (
          <nav className="engine-tabs network-method-filters">
            {availableMethods.map((method) => (
              <button
                key={method}
                className={`tab method-${method.toLowerCase()} ${methodFilter.has(method) ? "active" : ""}`}
                onClick={() => toggleMethod(method)}
              >
                {method}
              </button>
            ))}
          </nav>
        )}
        <div className="network-list-meta">
          <span className="network-count">
            {filtered.length} request{filtered.length === 1 ? "" : "s"}
          </span>
          <button className="icon-btn network-clear" title="Clear all requests" aria-label="Clear all requests" onClick={handleClear}>
            <TrashIcon />
          </button>
        </div>

        <div className="side-list network-list">
          {requests.length === 0 && (
            <div className="view-empty">
              <p>
                No network activity yet. Attach <code>attachNetwork()</code> from <code>@datamobile/sdk/network</code>.
              </p>
            </div>
          )}
          {requests.length > 0 && filtered.length === 0 && <div className="list-empty-hint">No matches.</div>}
          {filtered.map((entry) => (
            <button
              key={entry.requestId}
              className={`side-item network-item ${entry.requestId === selected?.requestId ? "active" : ""}`}
              onClick={() => setSelectedId(entry.requestId)}
            >
              <span className={`status-pill ${statusClass(entry)}`}>{statusLabel(entry)}</span>
              <span className="network-method">{entry.method}</span>
              <span className="network-url">{entry.url}</span>
              {entry.durationMs !== undefined && <small>{entry.durationMs}ms</small>}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`view-resizer ${resizing ? "resizing" : ""}`}
        onMouseDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize request list"
      />

      {selected && <NetworkDetail entry={selected} />}
    </div>
  );
}

function NetworkDetail({ entry }: { entry: NetworkEntry }) {
  const requestBody = parseBody(entry.requestBody);
  const responseBody = parseBody(entry.responseBody);

  return (
    <section className="network-detail">
      <div className="network-detail-head">
        <h3>
          {entry.method} {entry.url}
        </h3>
        <div className="network-meta-row">
          <span>Status</span>
          <span className={statusClass(entry)}>{statusLabel(entry)}</span>
        </div>
        <div className="network-meta-row">
          <span>Method</span>
          <span>{entry.method}</span>
        </div>
        {entry.durationMs !== undefined && (
          <div className="network-meta-row">
            <span>Duration</span>
            <span>{entry.durationMs}ms</span>
          </div>
        )}
        <div className="network-meta-row">
          <span>Started</span>
          <span>{new Date(entry.startedAt).toLocaleTimeString()}</span>
        </div>
        <CopyButton
          className="network-curl-btn"
          title="Copy as cURL"
          text={() => toCurl({ method: entry.method, url: entry.url, requestHeaders: entry.requestHeaders, requestBody: entry.requestBody })}
        />
        <span className="network-curl-label">Copy as cURL</span>
      </div>

      <div className="network-section">
        <div className="network-section-head">
          <h4>Request</h4>
          {requestBody !== undefined && <CopyButton size="sm" title="Copy request body" text={() => JSON.stringify(requestBody, null, 2)} />}
        </div>
        {entry.requestHeaders && Object.keys(entry.requestHeaders).length > 0 && <HeadersTable headers={entry.requestHeaders} />}
        {requestBody !== undefined && <JsonTree data={requestBody} defaultExpandDepth={1} />}
      </div>

      <div className="network-section">
        <div className="network-section-head">
          <h4>Response</h4>
          {responseBody !== undefined && <CopyButton size="sm" title="Copy response body" text={() => JSON.stringify(responseBody, null, 2)} />}
        </div>
        {entry.error && <p className="network-error">{entry.error}</p>}
        {entry.responseHeaders && Object.keys(entry.responseHeaders).length > 0 && <HeadersTable headers={entry.responseHeaders} />}
        {responseBody !== undefined && <JsonTree data={responseBody} defaultExpandDepth={1} />}
      </div>
    </section>
  );
}

function HeadersTable({ headers }: { headers: Record<string, string> }) {
  return (
    <table className="headers-table">
      <tbody>
        {Object.entries(headers).map(([key, value]) => (
          <tr key={key}>
            <td className="headers-key">{key}</td>
            <td className="headers-value">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function statusClass(entry: NetworkEntry): string {
  if (entry.error) return "status-error";
  if (entry.status === undefined) return "status-pending";
  if (entry.ok) return "status-ok";
  return "status-error";
}

function statusLabel(entry: NetworkEntry): string {
  if (entry.error) return "ERR";
  if (entry.status === undefined) return "…";
  return String(entry.status);
}

/** Parses a JSON-string body into a real object so JsonTree gets structured data either way. */
function parseBody(body: unknown): unknown {
  if (body === undefined) return undefined;
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  return body;
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
