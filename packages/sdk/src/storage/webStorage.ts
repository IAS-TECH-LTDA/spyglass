import { createEnvelope, safeSerialize } from "spyglass-protocol";
import type { KVEntry, StorageChangeKind, StorageChangePayload, StorageEngine, StorageSnapshotPayload } from "spyglass-protocol";
import { registerStorageWriteHandler } from "../commands.js";
import { getCore } from "../core.js";
import { parseMaybeJson, serializeForKv } from "./shared.js";

export interface WebStorageAdapterOptions {
  /** Defaults to auto-detecting by comparing against `window.localStorage`. */
  engine?: "localStorage" | "sessionStorage";
  dbName?: string;
}

/**
 * Wraps the browser's `localStorage`/`sessionStorage` (web's equivalent of
 * AsyncStorage/MMKV) — same monkey-patch approach as `attachAsyncStorage`,
 * just synchronous since the web Storage API is.
 *
 * The native `storage` event only fires for changes made in *other* tabs
 * (a same-tab `setItem` never triggers it — that's a spec quirk, not a
 * bug), so same-tab reactivity still needs the monkey-patch; the `storage`
 * listener is added on top to also pick up cross-tab writes for free.
 *
 * ```ts
 * import { attachWebStorage } from "spyglass-react/storage/web-storage";
 *
 * attachWebStorage(window.localStorage);
 * attachWebStorage(window.sessionStorage);
 * ```
 */
export function attachWebStorage(storage: Storage, options: WebStorageAdapterOptions = {}): () => void {
  const core = getCore();
  const engine: StorageEngine = options.engine ?? (storage === globalThis.localStorage ? "localStorage" : "sessionStorage");
  core.registerCapability(`storage:${engine}`);

  const sendSnapshot = (): void => {
    const entries: KVEntry[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === null) continue;
      entries.push({ key, value: parseMaybeJson(storage.getItem(key)) });
    }
    const payload: StorageSnapshotPayload = { engine, dbName: options.dbName, entries };
    core.transport.send(createEnvelope("storage/snapshot", core.appId, payload));
  };

  sendSnapshot();

  const emitChange = (changeType: StorageChangeKind, key?: string, value?: unknown): void => {
    const payload: StorageChangePayload = {
      engine,
      dbName: options.dbName,
      changeType,
      key,
      value: value !== undefined ? safeSerialize(value) : undefined,
    };
    core.transport.send(createEnvelope("storage/change", core.appId, payload));
  };

  const original = {
    setItem: storage.setItem.bind(storage),
    removeItem: storage.removeItem.bind(storage),
    clear: storage.clear.bind(storage),
  };

  storage.setItem = (key, value) => {
    original.setItem(key, value);
    emitChange("set", key, parseMaybeJson(value));
  };

  storage.removeItem = (key) => {
    original.removeItem(key);
    emitChange("remove", key);
  };

  storage.clear = () => {
    original.clear();
    sendSnapshot();
  };

  const onCrossTabChange = (event: StorageEvent) => {
    if (event.storageArea !== storage) return;
    // A cross-tab event doesn't tell us which key changed in a way we can
    // patch in place reliably (key can be null on clear()), so just re-snapshot.
    sendSnapshot();
  };
  globalThis.addEventListener?.("storage", onCrossTabChange);

  // Through the patched `storage.setItem`/`removeItem` above, same reasoning
  // as the AsyncStorage adapter: the echo comes for free via emitChange.
  const unregisterWrite = registerStorageWriteHandler(engine, options.dbName, (op, key, value) => {
    if (op === "remove") storage.removeItem(key);
    else storage.setItem(key, serializeForKv(value));
  });

  return () => {
    storage.setItem = original.setItem;
    storage.removeItem = original.removeItem;
    storage.clear = original.clear;
    globalThis.removeEventListener?.("storage", onCrossTabChange);
    unregisterWrite();
  };
}
