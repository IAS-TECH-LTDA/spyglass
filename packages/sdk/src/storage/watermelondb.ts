import { createEnvelope, safeSerialize } from "spyglass-protocol";
import type { StorageLocation, StorageSnapshotPayload, TableSchema } from "spyglass-protocol";
import { getCore } from "../core.js";

/** Structural subset of a WatermelonDB `Model` instance. */
interface WatermelonModelLike {
  id: string;
  _raw: Record<string, unknown>;
}

interface WatermelonObservableLike {
  subscribe(observer: (records: WatermelonModelLike[]) => void): { unsubscribe(): void };
}

interface WatermelonQueryLike {
  observe(): WatermelonObservableLike;
}

interface WatermelonCollectionLike {
  query(): WatermelonQueryLike;
}

interface WatermelonTableSchemaLike {
  name: string;
  /** WatermelonDB's per-column schema — `type` is `"string" | "number" | "boolean"`. */
  columns: Record<string, { name: string; type?: string }>;
}

interface WatermelonDatabaseLike {
  schema: { tables: Record<string, WatermelonTableSchemaLike> };
  collections: { get(tableName: string): WatermelonCollectionLike };
}

export interface WatermelonAdapterOptions {
  dbName?: string;
  /** Defaults to every table in the schema; pass a subset to skip large/irrelevant tables. */
  tables?: string[];
  /**
   * Absolute path to the underlying SQLite file (spec 0013) — WatermelonDB's
   * own `Database`/`SQLiteAdapter` types don't expose the path this adapter
   * receives, so there's no way to read it back; pass it yourself if you
   * know it (e.g. the same value you gave `SQLiteAdapter({ dbName })`).
   * Reported to the desktop as `source: "configured"`, not `"exact"`, since
   * it isn't verified against the real file.
   */
  path?: string;
}

/**
 * Subscribes to every WatermelonDB collection's `.query().observe()` (its
 * native reactivity, not polling) and streams a full snapshot on every
 * change. Row shape is `{ id, ...record._raw }` — WatermelonDB's raw column
 * data, which matches the columns declared in your `appSchema`.
 *
 * ```ts
 * import { database } from "./database";
 * import { attachWatermelonDB } from "spyglass-react/storage/watermelondb";
 *
 * attachWatermelonDB(database);
 * ```
 */
export function attachWatermelonDB(
  database: WatermelonDatabaseLike,
  options: WatermelonAdapterOptions = {},
): () => void {
  const core = getCore();
  core.registerCapability("storage:watermelondb");
  const dbName = options.dbName;

  const tableNames = options.tables ?? Object.keys(database.schema.tables);
  const schema: TableSchema[] = tableNames.map((name) => {
    const declaredColumns = Object.values(database.schema.tables[name]?.columns ?? {}).map((c) => ({
      name: c.name,
      type: c.type,
      isPrimaryKey: false,
    }));
    // WatermelonDB's declared schema only lists your custom columns — `id`
    // is implicit on every row (`record.id`, see the row shape below) but
    // isn't part of `appSchema()`, so it's added explicitly here.
    return { name, columns: [{ name: "id", type: "string", isPrimaryKey: true }, ...declaredColumns] };
  });

  const latestRows = new Map<string, unknown[]>();
  const location: StorageLocation | undefined = options.path ? { path: options.path, source: "configured" } : undefined;

  const sendSnapshot = (): void => {
    const rows: Record<string, unknown[]> = {};
    for (const name of tableNames) rows[name] = latestRows.get(name) ?? [];
    const payload: StorageSnapshotPayload = { engine: "watermelondb", dbName, schema, rows, location };
    core.transport.send(createEnvelope("storage/snapshot", core.appId, payload));
  };

  const subscriptions = tableNames.map((name) => {
    const collection = database.collections.get(name);
    return collection.query().observe().subscribe((records) => {
      latestRows.set(
        name,
        safeSerialize(records.map((record) => ({ id: record.id, ...record._raw }))) as unknown[],
      );
      sendSnapshot();
    });
  });

  return () => {
    for (const subscription of subscriptions) subscription.unsubscribe();
  };
}
