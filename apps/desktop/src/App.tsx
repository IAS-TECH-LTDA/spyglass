import { useEffect, useState } from "react";
import { AlertSettingsPanel } from "./components/AlertSettingsPanel";
import { SplashScreen } from "./components/SplashScreen";
import { forgetApp, getCachedMessages, listApps, onAppConnected, onAppDisconnected, onMessage } from "./ipc";
import { handleEnvelopeForAlerts, primeAlerts } from "./lib/alertRunner";
import { useConnectionStore, type Tab } from "./state/connection";
import { ConnectView } from "./views/connect/ConnectView";
import { GraphView } from "./views/graph/GraphView";
import { StoresView } from "./views/stores/StoresView";
import { StorageView } from "./views/storage/StorageView";
import { QueriesView } from "./views/queries/QueriesView";
import { LogsView } from "./views/logs/LogsView";
import { NetworkView } from "./views/network/NetworkView";
import { PerformanceView } from "./views/performance/PerformanceView";
import "./styles.css";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "graph", label: "Navigation" },
  { id: "stores", label: "State" },
  { id: "storage", label: "Storage" },
  { id: "queries", label: "Queries" },
  { id: "logs", label: "Console" },
  { id: "network", label: "Network" },
  { id: "performance", label: "Performance" },
];

function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export default function App() {
  const apps = useConnectionStore((s) => s.apps);
  const data = useConnectionStore((s) => s.data);
  const selectedAppId = useConnectionStore((s) => s.selectedAppId);
  const upsertApp = useConnectionStore((s) => s.upsertApp);
  const markDisconnected = useConnectionStore((s) => s.markDisconnected);
  const removeApp = useConnectionStore((s) => s.removeApp);
  const selectApp = useConnectionStore((s) => s.selectApp);
  const handleEnvelope = useConnectionStore((s) => s.handleEnvelope);
  const hydrateFromCache = useConnectionStore((s) => s.hydrateFromCache);
  const tab = useConnectionStore((s) => s.activeTab);
  const setTab = useConnectionStore((s) => s.setActiveTab);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unlisten: Array<() => void> = [];
    let cancelled = false;

    primeAlerts();

    listApps().then(async (initial) => {
      if (cancelled) return;
      for (const app of initial) upsertApp(app);
      // Cached replay only — never wired to alerts, see alertRunner.ts's
      // doc comment. A reload/reconnect must not re-fire sound/notification
      // for whatever error happened to be the last one cached.
      await Promise.all(
        initial.map((app) => getCachedMessages(app.appId).then((cached) => hydrateFromCache(app.appId, cached))),
      );
      if (!cancelled) setReady(true);
    });

    onAppConnected((app) => {
      upsertApp(app);
      getCachedMessages(app.appId).then((cached) => hydrateFromCache(app.appId, cached));
    }).then((un) => unlisten.push(un));

    onAppDisconnected((appId) => markDisconnected(appId)).then((un) => unlisten.push(un));

    onMessage((envelope) => {
      handleEnvelope(envelope); // fold into AppData first — the alert runner reads it back (e.g. a network entry's URL)
      handleEnvelopeForAlerts(envelope); // live envelopes only — see the note above
    }).then((un) => unlisten.push(un));

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
      <SplashScreen ready={ready} />
      <header className="topbar">
        <div className="brand">Spyglass</div>
        <div className="app-pills">
          {appList.length === 0 && <span className="empty-hint">Waiting for an app…</span>}
          {appList.map((app) => {
            const alerts = data[app.appId]?.alerts;
            const unseen = (alerts?.log ?? 0) + (alerts?.network ?? 0);
            return (
              <div key={app.appId} className={`app-pill ${app.appId === selectedAppId ? "selected" : ""}`}>
                <button className="app-pill-main" onClick={() => selectApp(app.appId)}>
                  <span className={`dot ${app.connected ? "dot-on" : "dot-off"}`} />
                  {app.appName} <small>{app.platform}</small>
                  {unseen > 0 && <span className="alert-badge">{formatBadgeCount(unseen)}</span>}
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
            );
          })}
        </div>
        <AlertSettingsPanel />
      </header>

      {selectedAppId ? (
        <>
          <nav className="tabs">
            {TABS.map((t) => {
              const alerts = data[selectedAppId]?.alerts;
              const unseen = t.id === "logs" ? (alerts?.log ?? 0) : t.id === "network" ? (alerts?.network ?? 0) : 0;
              return (
                <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
                  {t.label}
                  {unseen > 0 && <span className="alert-badge tab-badge">{formatBadgeCount(unseen)}</span>}
                </button>
              );
            })}
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
