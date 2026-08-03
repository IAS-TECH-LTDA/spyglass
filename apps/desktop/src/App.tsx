import { useEffect, useState } from "react";
import { forgetApp, getCachedMessages, listApps, onAppConnected, onAppDisconnected, onMessage } from "./ipc";
import { useConnectionStore } from "./state/connection";
import { ConnectView } from "./views/connect/ConnectView";
import { GraphView } from "./views/graph/GraphView";
import { StoresView } from "./views/stores/StoresView";
import { StorageView } from "./views/storage/StorageView";
import { QueriesView } from "./views/queries/QueriesView";
import { LogsView } from "./views/logs/LogsView";
import { NetworkView } from "./views/network/NetworkView";
import { PerformanceView } from "./views/performance/PerformanceView";
import "./styles.css";

type Tab = "graph" | "stores" | "storage" | "queries" | "logs" | "network" | "performance";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "graph", label: "Navigation" },
  { id: "stores", label: "State" },
  { id: "storage", label: "Storage" },
  { id: "queries", label: "Queries" },
  { id: "logs", label: "Console" },
  { id: "network", label: "Network" },
  { id: "performance", label: "Performance" },
];

export default function App() {
  const apps = useConnectionStore((s) => s.apps);
  const selectedAppId = useConnectionStore((s) => s.selectedAppId);
  const upsertApp = useConnectionStore((s) => s.upsertApp);
  const markDisconnected = useConnectionStore((s) => s.markDisconnected);
  const removeApp = useConnectionStore((s) => s.removeApp);
  const selectApp = useConnectionStore((s) => s.selectApp);
  const handleEnvelope = useConnectionStore((s) => s.handleEnvelope);
  const hydrateFromCache = useConnectionStore((s) => s.hydrateFromCache);

  const [tab, setTab] = useState<Tab>("graph");

  useEffect(() => {
    const unlisten: Array<() => void> = [];
    let cancelled = false;

    listApps().then((initial) => {
      if (cancelled) return;
      for (const app of initial) {
        upsertApp(app);
        getCachedMessages(app.appId).then((cached) => hydrateFromCache(app.appId, cached));
      }
    });

    onAppConnected((app) => {
      upsertApp(app);
      getCachedMessages(app.appId).then((cached) => hydrateFromCache(app.appId, cached));
    }).then((un) => unlisten.push(un));

    onAppDisconnected((appId) => markDisconnected(appId)).then((un) => unlisten.push(un));

    onMessage((envelope) => handleEnvelope(envelope)).then((un) => unlisten.push(un));

    return () => {
      cancelled = true;
      for (const fn of unlisten) fn();
    };
  }, [upsertApp, markDisconnected, handleEnvelope, hydrateFromCache]);

  const appList = Object.values(apps).sort((a, b) => b.connectedAt - a.connectedAt);

  const handleForget = (appId: string) => {
    removeApp(appId);
    void forgetApp(appId);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">DataMobile</div>
        <div className="app-pills">
          {appList.length === 0 && <span className="empty-hint">Waiting for an app…</span>}
          {appList.map((app) => (
            <div key={app.appId} className={`app-pill ${app.appId === selectedAppId ? "selected" : ""}`}>
              <button className="app-pill-main" onClick={() => selectApp(app.appId)}>
                <span className={`dot ${app.connected ? "dot-on" : "dot-off"}`} />
                {app.appName} <small>{app.platform}</small>
              </button>
              <button
                className="app-pill-close"
                title="Remove from list"
                aria-label={`Remove ${app.appName}`}
                onClick={() => handleForget(app.appId)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </header>

      {selectedAppId ? (
        <>
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <main className="content">
            {tab === "graph" && <GraphView appId={selectedAppId} />}
            {tab === "stores" && <StoresView appId={selectedAppId} />}
            {tab === "storage" && <StorageView appId={selectedAppId} />}
            {tab === "queries" && <QueriesView appId={selectedAppId} />}
            {tab === "logs" && <LogsView appId={selectedAppId} />}
            {tab === "network" && <NetworkView appId={selectedAppId} />}
            {tab === "performance" && <PerformanceView appId={selectedAppId} />}
          </main>
        </>
      ) : (
        <ConnectView />
      )}
    </div>
  );
}
