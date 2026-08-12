import { createEnvelope, safeSerialize } from "spyglass-protocol";
import type { StorageSnapshotPayload, TableSchema } from "spyglass-protocol";
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

  const snapshot = async (): Promise<void> => {
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

    const payload: StorageSnapshotPayload = { engine: "sqlite", dbName, schema, rows: serializedRows };
    core.transport.send(createEnvelope("storage/snapshot", core.appId, payload));
  };

  void snapshot();
  const timer = pollIntervalMs > 0 ? setInterval(() => void snapshot(), pollIntervalMs) : null;

  return {
    refresh: snapshot,
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
