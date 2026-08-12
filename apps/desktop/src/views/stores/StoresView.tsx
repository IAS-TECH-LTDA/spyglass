import { useState } from "react";
import { useConnectionStore } from "../../state/connection";

export function StoresView({ appId }: { appId: string }) {
  const appData = useConnectionStore((s) => s.data[appId]);
  const stores = appData?.stores ?? {};
  const storeIds = Object.keys(stores);
  const [selected, setSelected] = useState<string | null>(null);

  if (storeIds.length === 0) {
    return (
      <div className="view-empty">
        <p>
          No state store connected yet. Attach a state adapter, e.g.{" "}
          <code>createSpyglassReduxMiddleware()</code> from <code>spyglass-react/state/redux</code>.
        </p>
      </div>
    );
  }

  const activeId = selected && stores[selected] ? selected : storeIds[0];
  const active = stores[activeId];

  return (
    <div className="stores-view">
      <aside className="side-list">
        {storeIds.map((id) => {
          const s = stores[id];
          return (
            <button
              key={id}
              className={`side-item ${id === activeId ? "active" : ""}`}
              onClick={() => setSelected(id)}
            >
              <span className="badge">{s.storeType}</span>
              <span className="side-item-label">{s.label ?? s.storeId}</span>
            </button>
          );
        })}
      </aside>

      <section className="store-state">
        <h3>State</h3>
        <pre>{JSON.stringify(active.state, null, 2)}</pre>
      </section>

      <section className="store-log">
        <h3>Actions ({active.log.length})</h3>
        <ul>
          {active.log.map((entry, i) => (
            <li key={i}>
              <code>{entry.action?.type ?? "update"}</code>
              <span className="diff-count">
                {entry.diff.length} change{entry.diff.length === 1 ? "" : "s"}
              </span>
            </li>
          ))}
          {active.log.length === 0 && <li className="muted">No actions yet.</li>}
        </ul>
      </section>
    </div>
  );
}
