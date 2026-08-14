import { useMemo, useState } from "react";
import { applyPatch } from "spyglass-protocol";
import { useConnectionStore } from "../../state/connection";
import type { PendingStateWrite, StoreEntry } from "../../state/connection";
import { JsonGraph } from "../../components/jsonGraph/JsonGraph";
import type { JsonGraphEditable } from "../../components/jsonGraph/JsonGraph";
import { CopyButton } from "../../components/CopyButton";
import { LiveEditBanner } from "../../components/LiveEditBanner";
import { toJsonPointer } from "../../lib/jsonPointer";
import { useT } from "../../i18n";
import { Trans } from "../../i18n/Trans";

export function StoresView({ appId }: { appId: string }) {
  const { t, tp } = useT();
  const appData = useConnectionStore((s) => s.data[appId]);
  const stores = appData?.stores ?? {};
  const storeIds = Object.keys(stores);
  const [selected, setSelected] = useState<string | null>(null);
  // Only advertised by a connected app in dev-style environments (spec
  // 0007-state) — absent means either a production build, or an SDK
  // version that predates this feature. Either way, editing simply isn't
  // offered.
  const canWrite = useConnectionStore((s) => s.apps[appId]?.capabilities.includes("state:write") ?? false);

  if (storeIds.length === 0) {
    return (
      <div className="view-empty">
        <p>
          <Trans
            k="stores.emptyState"
            values={{
              call: <code>createSpyglassReduxMiddleware()</code>,
              module: <code>spyglass-react/state/redux</code>,
            }}
          />
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

      <StoreStatePanel key={activeId} appId={appId} storeId={activeId} entry={active} canWrite={canWrite} />

      <section className="store-log">
        <h3>{t("stores.actions", { count: active.log.length })}</h3>
        <ul>
          {active.log.map((entry, i) => (
            <li key={i}>
              <code>{entry.action?.type ?? "update"}</code>
              <span className="diff-count">{tp("stores.changeCount", entry.diff.length)}</span>
            </li>
          ))}
          {active.log.length === 0 && <li className="muted">{t("stores.noActionsYet")}</li>}
        </ul>
      </section>
    </div>
  );
}

function StoreStatePanel({
  appId,
  storeId,
  entry,
  canWrite,
}: {
  appId: string;
  storeId: string;
  entry: StoreEntry;
  canWrite: boolean;
}) {
  const { t } = useT();
  const sendStateWrite = useConnectionStore((s) => s.sendStateWrite);
  const pendingStateWrites = useConnectionStore((s) => s.data[appId]?.pendingStateWrites);
  const [editedPathKey, setEditedPathKey] = useState<string | null>(null);

  // Zustand is the only state manager with a single set() funnel every
  // store routes through (see state/zustand.ts's write handler) —
  // Redux/Jotai/Recoil/MobX have no equivalent, so a write for one of those
  // storeIds would just come back with errorCode: "no-store". Simpler to
  // never offer the edit UI there than show a control that always fails.
  const isEditable = canWrite && entry.storeType === "zustand";

  // Most recently sent write to this store, if any — drives the status dot
  // on whichever field was last edited. Mirrors StorageView's KvRow.
  const latestWrite = useMemo(() => {
    if (!pendingStateWrites) return undefined;
    let latest: PendingStateWrite | undefined;
    for (const w of Object.values(pendingStateWrites)) {
      if (w.storeId !== storeId) continue;
      if (!latest || w.sentAt > latest.sentAt) latest = w;
    }
    return latest;
  }, [pendingStateWrites, storeId]);

  const handleEdit = (path: (string | number)[], newValue: unknown) => {
    setEditedPathKey(path.join("."));
    const updatedState =
      path.length === 0 ? newValue : applyPatch(entry.state, [{ op: "replace", path: toJsonPointer(path), value: newValue }]);
    sendStateWrite(appId, storeId, updatedState);
  };

  const editable: JsonGraphEditable | undefined = isEditable
    ? { onEdit: handleEdit, status: editedPathKey && latestWrite ? { [editedPathKey]: latestWrite.status } : undefined }
    : undefined;

  return (
    <section className={`store-state ${isEditable ? "live-edit-accent" : ""}`}>
      <div className="store-state-head">
        <h3>{t("stores.state")}</h3>
        <CopyButton size="sm" title={t("stores.copyState")} text={() => JSON.stringify(entry.state, null, 2)} />
      </div>
      {isEditable && <LiveEditBanner noticeId="stores-edit">{t("stores.editBanner")}</LiveEditBanner>}
      <JsonGraph data={entry.state} defaultExpandDepth={2} editable={editable} />
    </section>
  );
}
