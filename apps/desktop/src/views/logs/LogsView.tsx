import { useMemo, useState } from "react";
import type { LogLevel } from "spyglass-protocol";
import { useConnectionStore } from "../../state/connection";
import { CopyButton } from "../../components/CopyButton";
import { JsonGraph } from "../../components/jsonGraph/JsonGraph";
import { useT } from "../../i18n";
import { Trans } from "../../i18n/Trans";
import { currentBcp47 } from "../../state/locale";

const LEVELS: LogLevel[] = ["log", "info", "warn", "error", "debug"];

/** A log entry gets a collapse/expand toggle once it's this long or has structured args. */
const LONG_MESSAGE_THRESHOLD = 160;

export function LogsView({ appId }: { appId: string }) {
  const { t } = useT();
  const logs = useConnectionStore((s) => s.data[appId]?.logs ?? []);
  const clearLogs = useConnectionStore((s) => s.clearLogs);
  const [filter, setFilter] = useState<Set<LogLevel>>(new Set(LEVELS));
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((entry) => {
      if (!filter.has(entry.level)) return false;
      if (!q) return true;
      if (entry.message.toLowerCase().includes(q)) return true;
      return entry.args.some((arg) => argToSearchText(arg).includes(q));
    });
  }, [logs, filter, query]);

  const toggleLevel = (level: LogLevel) => {
    setFilter((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  return (
    <div className="logs-view">
      <div className="logs-toolbar">
        <input
          className="toolbar-search"
          placeholder={t("logs.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <nav className="engine-tabs logs-level-row">
        <div className="tabs-group">
          {LEVELS.map((level) => (
            <button
              key={level}
              className={`tab log-level-${level} ${filter.has(level) ? "active" : ""}`}
              onClick={() => toggleLevel(level)}
            >
              {level}
            </button>
          ))}
        </div>
        <button className="icon-btn logs-clear" title={t("logs.clearAllAria")} aria-label={t("logs.clearAllAria")} onClick={() => clearLogs(appId)}>
          <TrashIcon />
        </button>
      </nav>

      {logs.length === 0 ? (
        <div className="view-empty">
          <p>
            <Trans k="logs.emptyState" values={{ call: <code>attachConsole()</code>, module: <code>spyglass-react/console</code> }} />
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="list-empty-hint">{t("logs.noMatches")}</div>
      ) : (
        <ul className="log-list">
          {filtered.map((entry, i) => (
            <LogRow key={i} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}

function argToSearchText(arg: unknown): string {
  if (typeof arg === "string") return arg.toLowerCase();
  if (arg !== null && typeof arg === "object") {
    try {
      return JSON.stringify(arg).toLowerCase();
    } catch {
      return "";
    }
  }
  return String(arg).toLowerCase();
}

function LogRow({ entry }: { entry: { level: LogLevel; message: string; args: unknown[]; ts: number } }) {
  const { t } = useT();
  const hasStructuredArgs = entry.args.some((a) => a !== null && typeof a === "object");
  const isLong = entry.message.length > LONG_MESSAGE_THRESHOLD || hasStructuredArgs;
  const [expanded, setExpanded] = useState(false);

  const copyText = () => {
    const argsText = entry.args.length
      ? "\n" + entry.args.map((a) => (typeof a === "object" && a !== null ? JSON.stringify(a, null, 2) : String(a))).join("\n")
      : "";
    return entry.message + argsText;
  };

  return (
    <li className={`log-entry log-level-${entry.level}`}>
      <div className="log-entry-row" onClick={() => isLong && setExpanded((v) => !v)}>
        {isLong && <span className={`jt-toggle log-expand ${expanded ? "open" : ""}`}>▸</span>}
        <span className="log-time">{new Date(entry.ts).toLocaleTimeString(currentBcp47())}</span>
        <span className="log-badge">{entry.level}</span>
        <span className={`log-message ${isLong && !expanded ? "clamped" : ""}`}>{entry.message}</span>
        <CopyButton size="sm" className="log-copy" title={t("logs.copyLine")} text={copyText} />
      </div>
      {isLong && expanded && entry.args.length > 0 && (
        <div className="log-args">
          {entry.args.map((arg, i) =>
            arg !== null && typeof arg === "object" ? (
              <JsonGraph key={i} data={arg} defaultExpandDepth={1} />
            ) : (
              <div key={i} className="jt-row">
                <PrimitiveArg value={arg} />
              </div>
            ),
          )}
        </div>
      )}
    </li>
  );
}

function PrimitiveArg({ value }: { value: unknown }) {
  if (typeof value === "string") return <span className="jt-string">"{value}"</span>;
  if (typeof value === "number") return <span className="jt-number">{value}</span>;
  if (typeof value === "boolean") return <span className="jt-boolean">{String(value)}</span>;
  return <span className="jt-null">{String(value)}</span>;
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
