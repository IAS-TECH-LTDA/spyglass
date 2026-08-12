import { createEnvelope, safeSerialize } from "spyglass-protocol";
import type { KVEntry, StorageChangeKind, StorageChangePayload, StorageSnapshotPayload } from "spyglass-protocol";
import { getCore } from "../core.js";
import { parseMaybeJson } from "./shared.js";

/** Structural subset of `@react-native-async-storage/async-storage`'s default export. */
interface AsyncStorageLike {
  getAllKeys(): Promise<readonly string[]>;
  multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiSet(pairs: [string, string][]): Promise<void>;
  multiRemove(keys: string[]): Promise<void>;
  mergeItem?(key: string, value: string): Promise<void>;
  clear?(): Promise<void>;
}

export interface AsyncStorageAdapterOptions {
  /** Label shown in the desktop inspector if the app uses more than one engine instance. */
  dbName?: string;
}

/**
 * Monkey-patches the AsyncStorage module's mutating methods in place so
 * every write in the app — regardless of where it's called from — is
 * observed, without requiring call sites to switch to a wrapped import.
 * Sends a full snapshot on attach, then a `storage/change` per mutation.
 *
 * ```ts
 * import AsyncStorage from "@react-native-async-storage/async-storage";
 * import { attachAsyncStorage } from "spyglass-react/storage/async-storage";
 *
 * attachAsyncStorage(AsyncStorage);
 * ```
 */
export function attachAsyncStorage(
  AsyncStorage: AsyncStorageLike,
  options: AsyncStorageAdapterOptions = {},
): () => void {
  const core = getCore();
  core.registerCapability("storage:asyncStorage");

  const sendSnapshot = async (): Promise<void> => {
    const keys = await AsyncStorage.getAllKeys();
    const pairs = await AsyncStorage.multiGet(keys);
    const entries: KVEntry[] = pairs.map(([key, value]) => ({ key, value: parseMaybeJson(value) }));
    const payload: StorageSnapshotPayload = { engine: "asyncStorage", dbName: options.dbName, entries };
    core.transport.send(createEnvelope("storage/snapshot", core.appId, payload));
  };

  void sendSnapshot();

  const emitChange = (changeType: StorageChangeKind, key?: string, value?: unknown): void => {
    const payload: StorageChangePayload = {
      engine: "asyncStorage",
      dbName: options.dbName,
      changeType,
      key,
      value: value !== undefined ? safeSerialize(value) : undefined,
    };
    core.transport.send(createEnvelope("storage/change", core.appId, payload));
  };

  const original = {
    setItem: AsyncStorage.setItem.bind(AsyncStorage),
    removeItem: AsyncStorage.removeItem.bind(AsyncStorage),
    multiSet: AsyncStorage.multiSet.bind(AsyncStorage),
    multiRemove: AsyncStorage.multiRemove.bind(AsyncStorage),
    mergeItem: AsyncStorage.mergeItem?.bind(AsyncStorage),
    clear: AsyncStorage.clear?.bind(AsyncStorage),
  };

  AsyncStorage.setItem = async (key, value) => {
    await original.setItem(key, value);
    emitChange("set", key, parseMaybeJson(value));
  };

  AsyncStorage.removeItem = async (key) => {
    await original.removeItem(key);
    emitChange("remove", key);
  };

  AsyncStorage.multiSet = async (pairs) => {
    await original.multiSet(pairs);
    for (const [key, value] of pairs) emitChange("set", key, parseMaybeJson(value));
  };

  AsyncStorage.multiRemove = async (keys) => {
    await original.multiRemove(keys);
    for (const key of keys) emitChange("remove", key);
  };

  if (original.mergeItem) {
    AsyncStorage.mergeItem = async (key, value) => {
      await original.mergeItem!(key, value);
      emitChange("set", key, parseMaybeJson(value));
    };
  }

  if (original.clear) {
    AsyncStorage.clear = async () => {
      await original.clear!();
      void sendSnapshot();
    };
  }

  return () => {
    AsyncStorage.setItem = original.setItem;
    AsyncStorage.removeItem = original.removeItem;
    AsyncStorage.multiSet = original.multiSet;
    AsyncStorage.multiRemove = original.multiRemove;
    if (original.mergeItem) AsyncStorage.mergeItem = original.mergeItem;
    if (original.clear) AsyncStorage.clear = original.clear;
  };
}
