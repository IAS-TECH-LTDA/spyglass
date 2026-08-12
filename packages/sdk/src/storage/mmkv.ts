import { createEnvelope } from "spyglass-protocol";
import type { KVEntry, StorageChangePayload, StorageSnapshotPayload } from "spyglass-protocol";
import { getCore } from "../core.js";
import { parseMaybeJson } from "./shared.js";

/** Structural subset of a `react-native-mmkv` `MMKV` instance. */
interface MMKVLike {
  getAllKeys(): string[];
  getString(key: string): string | undefined;
  getNumber(key: string): number | undefined;
  getBoolean(key: string): boolean | undefined;
  set(key: string, value: string | number | boolean): void;
  delete(key: string): void;
  /** Available since react-native-mmkv v2.5; used when present for real push notifications. */
  addOnValueChangedListener?(listener: (key: string) => void): { remove(): void };
}

export interface MmkvAdapterOptions {
  dbName?: string;
}

/**
 * Streams an MMKV instance's contents and changes to the desktop inspector.
 * Prefers `addOnValueChangedListener` (react-native-mmkv >= 2.5); falls back
 * to monkey-patching `set`/`delete` on older versions.
 *
 * ```ts
 * import { MMKV } from "react-native-mmkv";
 * import { attachMmkv } from "spyglass-react/storage/mmkv";
 *
 * export const storage = new MMKV();
 * attachMmkv(storage);
 * ```
 */
export function attachMmkv(instance: MMKVLike, options: MmkvAdapterOptions = {}): () => void {
  const core = getCore();
  core.registerCapability("storage:mmkv");

  const readValue = (key: string): unknown => {
    const str = instance.getString(key);
    if (str !== undefined) return parseMaybeJson(str);
    const num = instance.getNumber(key);
    if (num !== undefined) return num;
    const bool = instance.getBoolean(key);
    if (bool !== undefined) return bool;
    return undefined;
  };

  const sendSnapshot = (): void => {
    const entries: KVEntry[] = instance.getAllKeys().map((key) => ({ key, value: readValue(key) }));
    const payload: StorageSnapshotPayload = { engine: "mmkv", dbName: options.dbName, entries };
    core.transport.send(createEnvelope("storage/snapshot", core.appId, payload));
  };

  sendSnapshot();

  const emitChange = (key: string): void => {
    const value = readValue(key);
    const payload: StorageChangePayload = {
      engine: "mmkv",
      dbName: options.dbName,
      changeType: value === undefined ? "remove" : "set",
      key,
      value,
    };
    core.transport.send(createEnvelope("storage/change", core.appId, payload));
  };

  if (instance.addOnValueChangedListener) {
    const subscription = instance.addOnValueChangedListener(emitChange);
    return () => subscription.remove();
  }

  const originalSet = instance.set.bind(instance);
  const originalDelete = instance.delete.bind(instance);
  instance.set = (key, value) => {
    originalSet(key, value);
    emitChange(key);
  };
  instance.delete = (key) => {
    originalDelete(key);
    emitChange(key);
  };
  return () => {
    instance.set = originalSet;
    instance.delete = originalDelete;
  };
}
