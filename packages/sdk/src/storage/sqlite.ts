import { createEnvelope, safeSerialize } from "spyglass-protocol";
import type { StorageLocation, StorageSnapshotPayload, TableSchema } from "spyglass-protocol";
import { registerStorageClearHandler, StorageClearUnsupportedError } from "../commands.js";
import { getCore } from "../core.js";

/**
 * SQLite/WatermelonDB apps use several incompatible driver APIs (expo-sqlite's
 * legacy transaction API, its newer async API, react-native-sqlite-storage,
 * op-sqlite, WatermelonDB's own adapter...). Rather than special-case each
 * one, this adapter asks the caller for a single read-only query function —
 * a thin bridge you write once per driver, e.g.:
 *
 * ```ts
 * // expo-sqlite (SDK 49+ async API)
 * const runner: SqliteQueryRunner = { query: (sql, params) => db.getAllAsync(sql, params) };
 * ```
 */
export interface SqliteQueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /**
   * Optional write path (spec 0014) — the only thing `storage/clear` needs.
   * Without it, this adapter is read-only and a clear request replies
   * `errorCode: "unsupported-op"` instead of doing nothing silently.
   */
  exec?(sql: string, params?: unknown[]): Promise<void>;
}

export interface SqliteAdapterOptions {
  dbName?: string;
  /**
   * There is no generic cross-driver "on write" hook, so this adapter polls
   * on an interval and diff-suppresses unchanged snapshots. Call `refresh()`
   * right after a write for near-instant updates instead of waiting for the
   * next tick; set to `0` to disable polling entirely and rely on `refresh()`.
   */
  pollIntervalMs?: number;
  /** Row cap per table per snapshot, to keep large tables from flooding the socket. */
  maxRowsPerTable?: number;
}

export interface SqliteHandle {
  refresh(): Promise<void>;
  stop(): void;
}

export function attachSqlite(runner: SqliteQueryRunner, options: SqliteAdapterOptions = {}): SqliteHandle {
  const core = getCore();
  core.registerCapability("storage:sqlite");
  const dbName = options.dbName;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const maxRowsPerTable = options.maxRowsPerTable ?? 500;

  let lastSnapshotJson = "";
  // Resolved once (spec 0013) — the backing file doesn't move while the
  // connection is open, so there's no reason to re-run PRAGMA database_list
  // on every poll tick. `undefined` after the first attempt means it
  // genuinely failed (a driver that doesn't support PRAGMA), not "not tried
  // yet" — `locationResolved` is what distinguishes the two.
  let location: StorageLocation | undefined;
  let locationResolved = false;

  const resolveLocation = async (): Promise<void> => {
    if (locationResolved) return;
    locationResolved = true;
    try {
      const rows = await runner.query<{ seq: number; name: string; file: string }>("PRAGMA database_list");
      const main = rows.find((r) => r.name === "main") ?? rows[0];
      if (main?.file) location = { path: main.file, source: "exact" };
    } catch {
      // Driver doesn't support PRAGMA (or the query failed for some other
      // reason) — `location` stays undefined, the desktop just won't show a
      // path rather than a wrong one.
    }
  };

  const snapshot = async (): Promise<void> => {
    await resolveLocation();

    const tables = await runner.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    );

    const schema: TableSchema[] = [];
    const rows: Record<string, unknown[]> = {};

    for (const { name } of tables) {
      const columns = await runner.query<{ name: string; type: string; pk: number }>(
        `PRAGMA table_info(${quoteIdent(name)})`,
      );
      schema.push({
        name,
        columns: columns.map((c) => ({ name: c.name, type: c.type || undefined, isPrimaryKey: c.pk > 0 })),
      });
      rows[name] = await runner.query(`SELECT * FROM ${quoteIdent(name)} LIMIT ${maxRowsPerTable}`);
    }

    const serializedRows = safeSerialize(rows) as Record<string, unknown[]>;
    const json = JSON.stringify(serializedRows);
    if (json === lastSnapshotJson) return;
    lastSnapshotJson = json;

    const payload: StorageSnapshotPayload = { engine: "sqlite", dbName, schema, rows: serializedRows, location };
    core.transport.send(createEnvelope("storage/snapshot", core.appId, payload));
  };

  void snapshot();
  const timer = pollIntervalMs > 0 ? setInterval(() => void snapshot(), pollIntervalMs) : null;

  const unregisterClear = registerStorageClearHandler("sqlite", dbName, async (scope, table) => {
    if (!runner.exec) throw new StorageClearUnsupportedError("This SqliteQueryRunner has no exec() — read-only.");
    if (scope === "table") {
      if (!table) throw new StorageClearUnsupportedError('scope: "table" requires a table name.');
      await runner.exec(`DELETE FROM ${quoteIdent(table)}`);
    } else {
      const tables = await runner.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      );
      for (const { name } of tables) await runner.exec(`DELETE FROM ${quoteIdent(name)}`);
    }
    await snapshot();
  });

  return {
    refresh: snapshot,
    stop() {
      if (timer) clearInterval(timer);
      unregisterClear();
    },
  };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
