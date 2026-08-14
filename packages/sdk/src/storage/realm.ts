import { createEnvelope, safeSerialize } from "spyglass-protocol";
import type { StorageChangePayload, StorageLocation, StorageSnapshotPayload, TableSchema } from "spyglass-protocol";
import { getCore } from "../core.js";

/** A Realm property schema entry is either a shorthand type string or a descriptor object with `.type`. */
type RealmPropertySchemaLike = string | { type?: string };

interface RealmObjectSchemaLike {
  name: string;
  primaryKey?: string;
  properties: Record<string, RealmPropertySchemaLike>;
}

interface RealmResultsLike {
  addListener(callback: () => void): void;
  removeAllListeners?(): void;
  [index: number]: unknown;
  length: number;
}

interface RealmLike {
  schema: RealmObjectSchemaLike[];
  objects(schemaName: string): RealmResultsLike;
  /** The real Realm instance always has this — declared optional here only because it's a structural interface and some test doubles won't bother. */
  path?: string;
}

export interface RealmAdapterOptions {
  dbName?: string;
}

/**
 * Reads a Realm instance's schema, snapshots every collection, and
 * re-snapshots + reports a `storage/change` whenever any collection fires
 * Realm's own change listener.
 *
 * ```ts
 * import Realm from "realm";
 * import { attachRealm } from "spyglass-react/storage/realm";
 *
 * const realm = await Realm.open({ schema: [...] });
 * attachRealm(realm);
 * ```
 */
export function attachRealm(realm: RealmLike, options: RealmAdapterOptions = {}): () => void {
  const core = getCore();
  core.registerCapability("storage:realm");
  const dbName = options.dbName;

  const schema: TableSchema[] = realm.schema.map((s) => ({
    name: s.name,
    columns: Object.entries(s.properties).map(([name, prop]) => ({
      name,
      type: typeof prop === "string" ? prop : prop.type,
      isPrimaryKey: name === s.primaryKey,
    })),
  }));
  const collections = schema.map((s) => ({ name: s.name, results: realm.objects(s.name) }));
  const location: StorageLocation | undefined = realm.path ? { path: realm.path, source: "exact" } : undefined;

  const snapshotAll = (): void => {
    const rows: Record<string, unknown[]> = {};
    for (const { name, results } of collections) {
      rows[name] = safeSerialize(Array.from(results as unknown as ArrayLike<unknown>)) as unknown[];
    }
    const payload: StorageSnapshotPayload = { engine: "realm", dbName, schema, rows, location };
    core.transport.send(createEnvelope("storage/snapshot", core.appId, payload));
  };

  snapshotAll();

  const disposers: Array<() => void> = [];
  for (const { name, results } of collections) {
    const listener = () => {
      const changePayload: StorageChangePayload = { engine: "realm", dbName, changeType: "update", table: name };
      core.transport.send(createEnvelope("storage/change", core.appId, changePayload));
      snapshotAll();
    };
    results.addListener(listener);
    disposers.push(() => results.removeAllListeners?.());
  }

  return () => {
    for (const dispose of disposers) dispose();
  };
}
