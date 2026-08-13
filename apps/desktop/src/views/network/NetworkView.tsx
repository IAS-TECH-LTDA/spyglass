import { useMemo, useState } from "react";
import type { NetworkEntry } from "../../state/connection";
import { useConnectionStore } from "../../state/connection";
import { CopyButton } from "../../components/CopyButton";
import { JsonGraph } from "../../components/jsonGraph/JsonGraph";
import { toCurl } from "../../lib/curl";
import { correlateNetworkEntry } from "../../lib/correlateNetworkEntry";
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
                No network activity yet. Attach <code>attachNetwork()</code> from <code>spyglass-react/network</code>.
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
              <small className="network-time">{formatTime(entry.startedAt)}</small>
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

      {/* Keyed by requestId so switching the selected request resets the
          accordion sections back to their default (open) state instead of
          carrying over whatever was collapsed for the previous one. */}
      {selected && <NetworkDetail key={selected.requestId} appId={appId} entry={selected} />}
    </div>
  );
}

function NetworkDetail({ appId, entry }: { appId: string; entry: NetworkEntry }) {
  const requestBody = parseBody(entry.requestBody);
  const responseBody = parseBody(entry.responseBody);
  const [requestOpen, setRequestOpen] = useState(true);
  const [responseOpen, setResponseOpen] = useState(true);

  const queries = useConnectionStore((s) => s.data[appId]?.queries ?? {});
  const queriesMeta = useConnectionStore((s) => s.data[appId]?.queriesMeta ?? {});
  const storage = useConnectionStore((s) => s.data[appId]?.storage ?? {});
  const storageMeta = useConnectionStore((s) => s.data[appId]?.storageMeta ?? {});
  const highlightAndNavigate = useConnectionStore((s) => s.highlightAndNavigate);

  // Heuristic, best-effort (spec 0011) — see correlateNetworkEntry's doc
  // comment for why an ambiguous match shows nothing rather than guessing.
  const related = useMemo(
    () => correlateNetworkEntry(entry, { queries, queriesMeta, storage, storageMeta }),
    [entry, queries, queriesMeta, storage, storageMeta],
  );
  const hasRelated = related.queries.length > 0 || related.storage.length > 0;

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
          <span>{formatTime(entry.startedAt)}</span>
        </div>
        <CopyButton
          className="network-curl-btn"
          title="Copy as cURL"
          text={() => toCurl({ method: entry.method, url: entry.url, requestHeaders: entry.requestHeaders, requestBody: entry.requestBody })}
        />
        <span className="network-curl-label">Copy as cURL</span>
      </div>

      {hasRelated && (
        <div className="network-related">
          <h4>Related</h4>
          <div className="network-related-chips">
            {related.queries.map((q) => (
              <button
                key={q.queryHash}
                type="button"
                className="network-related-chip"
                onClick={() => highlightAndNavigate({ tab: "queries", queryHash: q.queryHash })}
              >
                Query: {formatQueryKeyPreview(q.queryKey)}
              </button>
            ))}
            {related.storage.map((s) => (
              <button
                key={`${s.engine}:${s.key}`}
                type="button"
                className="network-related-chip"
                onClick={() => highlightAndNavigate({ tab: "storage", storageKey: { engine: s.engine, key: s.key } })}
              >
                Storage: {s.key} ({s.engine})
              </button>
            ))}
          </div>
        </div>
      )}

      <NetworkSection
        title="Request"
        open={requestOpen}
        onToggle={() => setRequestOpen((v) => !v)}
        copyText={requestBody !== undefined ? () => JSON.stringify(requestBody, null, 2) : undefined}
      >
        {entry.requestHeaders && Object.keys(entry.requestHeaders).length > 0 && <HeadersTable headers={entry.requestHeaders} />}
        {requestBody !== undefined && <JsonGraph data={requestBody} defaultExpandDepth={1} />}
      </NetworkSection>

      <NetworkSection
        title="Response"
        open={responseOpen}
        onToggle={() => setResponseOpen((v) => !v)}
        copyText={responseBody !== undefined ? () => JSON.stringify(responseBody, null, 2) : undefined}
      >
        {entry.error && <p className="network-error">{entry.error}</p>}
        {entry.responseHeaders && Object.keys(entry.responseHeaders).length > 0 && <HeadersTable headers={entry.responseHeaders} />}
        {responseBody !== undefined && <JsonGraph data={responseBody} defaultExpandDepth={1} />}
      </NetworkSection>
    </section>
  );
}

/**
 * Collapsible "Request"/"Response" block — the JsonGraph diagram inside can
 * get tall, so collapsing one lets the headers table (or the other section)
 * stay in view without scrolling past it.
 */
function NetworkSection({
  title,
  open,
  onToggle,
  copyText,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  copyText?: () => string;
  children: React.ReactNode;
}) {
  return (
    <div className="network-section">
      <div className="network-section-head network-section-head-clickable" onClick={onToggle}>
        <span className={`jt-toggle ${open ? "open" : ""}`}>▸</span>
        <h4>{title}</h4>
        {copyText && <CopyButton size="sm" title={`Copy ${title.toLowerCase()} body`} text={copyText} />}
      </div>
      {open && <div className="network-section-body">{children}</div>}
    </div>
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

/** HH:MM:SS the request started at — same clock-time shown in the list row and the detail panel's "Started" field. */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

/** One-line, human-readable rendering of a query key for the "Related" chips — same format as QueriesView's formatQueryKey. */
function formatQueryKeyPreview(key: unknown[]): string {
  return key.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(", ");
}

/** Parses a JSON-string body into a real object so JsonGraph gets structured data either way. */
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
