import { createEnvelope } from "spyglass-protocol";
import type {
  MemoryClearCacheErrorCode,
  MemoryClearCacheResultPayload,
  QueryCommandErrorCode,
  QueryCommandKind,
  QueryCommandResultPayload,
  QueryWriteErrorCode,
  QueryWriteResultPayload,
  StateWriteErrorCode,
  StateWriteResultPayload,
  StorageClearErrorCode,
  StorageClearResultPayload,
  StorageEngine,
  StorageWriteErrorCode,
  StorageWriteOp,
  StorageWriteResultPayload,
} from "spyglass-protocol";
import type { SpyglassCore } from "./core.js";
import { clearCaches } from "./memoryClear.js";

/**
 * Inbound command handling (spec 0007, spec 0007-state, spec 0008, spec
 * 0010) — the SDK's Desktop -> SDK directions (storage KV writes,
 * state-manager writes, clearing the app's own caches, and React Query
 * cache writes/commands). Everything here is only ever wired up when
 * `init()`'s `allowRemoteWrites` gate is on (dev-only by default); see
 * `index.ts`. Kept in its own module so that gate is a single call to
 * `enableInboundCommands()`, not something scattered across every adapter.
 */

export type StorageWriteHandler = (op: StorageWriteOp, key: string, value: unknown) => void | Promise<void>;

/** @see StorageClearPayload's doc comment (packages/protocol). `table` is present only for `scope: "table"`. */
export type StorageClearHandler = (scope: "all" | "table", table?: string) => void | Promise<void>;

/** @see StateWritePayload's doc comment (packages/protocol) for why this is a shallow-merge contract, not a replace. */
export type StateWriteHandler = (nextState: unknown) => void | Promise<void>;

/** @see QueryWritePayload's doc comment (packages/protocol) for why this is addressed by queryHash, never queryKey. */
export type QueryWriteHandler = (queryHash: string, data: unknown) => void | Promise<void>;

/** @see QueryCommandPayload's doc comment (packages/protocol). */
export type QueryCommandHandler = (queryHash: string, command: QueryCommandKind) => void | Promise<void>;

function storageHandlerKey(engine: StorageEngine, dbName: string | undefined): string {
  return `${engine}::${dbName ?? ""}`;
}

const storageWriteHandlers = new Map<string, StorageWriteHandler>();
const storageClearHandlers = new Map<string, StorageClearHandler>();
const stateWriteHandlers = new Map<string, StateWriteHandler>();
let queryWriteHandler: QueryWriteHandler | undefined;
let queryCommandHandler: QueryCommandHandler | undefined;

/**
 * @internal Called by a storage adapter (`attachAsyncStorage`,
 * `attachMmkv`, `attachWebStorage`) at attach time — those already hold the
 * real module/instance reference their observe path patches, so routing an
 * inbound write back through that same reference is natural. Returns an
 * unregister function, called on the adapter's own detach.
 */
export function registerStorageWriteHandler(
  engine: StorageEngine,
  dbName: string | undefined,
  handler: StorageWriteHandler,
): () => void {
  const key = storageHandlerKey(engine, dbName);
  storageWriteHandlers.set(key, handler);
  return () => {
    // Only remove if we're still the registered handler — a second
    // attachAsyncStorage() call (dev hot-reload, a second instance) may
    // have already replaced us, and our later detach must not evict it.
    if (storageWriteHandlers.get(key) === handler) storageWriteHandlers.delete(key);
  };
}

/**
 * @internal Same registration discipline as `registerStorageWriteHandler`,
 * for `storage/clear` (spec 0014) — a separate map, keyed the same way, so
 * an engine can register a write handler without a clear handler (or vice
 * versa): a runner without an `exec` still gets `no-adapter`/`unsupported-op`
 * rather than being forced to implement clearing to support writes at all.
 */
export function registerStorageClearHandler(
  engine: StorageEngine,
  dbName: string | undefined,
  handler: StorageClearHandler,
): () => void {
  const key = storageHandlerKey(engine, dbName);
  storageClearHandlers.set(key, handler);
  return () => {
    if (storageClearHandlers.get(key) === handler) storageClearHandlers.delete(key);
  };
}

/**
 * @internal Called by `state/zustand.ts`'s `withSpyglass` at store-creation
 * time. Unlike storage adapters, a store creator never re-runs/detaches on
 * its own, so there's no unregister call here — a second `withSpyglass()`
 * call for the same `storeId` (dev hot-reload) simply overwrites the entry,
 * same end result as storage's guarded unregister without needing one.
 */
export function registerStateWriteHandler(storeId: string, handler: StateWriteHandler): void {
  stateWriteHandlers.set(storeId, handler);
}

/**
 * Thrown by a `QueryWriteHandler`/`QueryCommandHandler` to signal "no query
 * with this hash exists right now" — distinct from any other throw, which
 * `enableInboundCommands` reports as `errorCode: "engine-error"` instead of
 * `"no-query"`.
 */
export class QueryNotFoundError extends Error {}

/**
 * Thrown by a `QueryWriteHandler` after a write that neither threw nor
 * changed anything — reported as `errorCode: "not-applied"` instead of the
 * `ok: true` that "it didn't throw" used to earn it. @see QueryWriteErrorCode
 */
export class QueryWriteNotAppliedError extends Error {}

/**
 * Thrown by a `StorageClearHandler` to signal "this engine/scope combination
 * genuinely can't be cleared" (e.g. a `SqliteQueryRunner` with no `exec`, or
 * a `scope: "table"` request against an engine that only supports clearing
 * everything) — reported as `errorCode: "unsupported-op"` instead of the
 * default `"engine-error"` a real failure gets, so the desktop can tell "not
 * possible" apart from "tried and failed".
 */
export class StorageClearUnsupportedError extends Error {}

/**
 * @internal Called by `attachReactQuery` at attach time. Unlike storage
 * adapters (possibly several, keyed by engine/dbName) there's only ever one
 * query client per app, so this is a single module-level slot rather than a
 * map. Unlike `registerStateWriteHandler`, `attachReactQuery` already has a
 * real detach path (it returns an unsubscribe), so this — like storage's
 * registration — returns an unregister that only clears the slot if it's
 * still pointing at this exact handler, so a second `attachReactQuery()`
 * call's detach can't evict a newer registration.
 */
export function registerQueryWriteHandler(handler: QueryWriteHandler): () => void {
  queryWriteHandler = handler;
  return () => {
    if (queryWriteHandler === handler) queryWriteHandler = undefined;
  };
}

/** @internal Same registration discipline as `registerQueryWriteHandler`, for the four React Query lifecycle commands. */
export function registerQueryCommandHandler(handler: QueryCommandHandler): () => void {
  queryCommandHandler = handler;
  return () => {
    if (queryCommandHandler === handler) queryCommandHandler = undefined;
  };
}

function replyStorage(core: SpyglassCore, requestId: string, ok: boolean, errorCode?: StorageWriteErrorCode, error?: string): void {
  const payload: StorageWriteResultPayload = { requestId, ok };
  if (errorCode !== undefined) payload.errorCode = errorCode;
  if (error !== undefined) payload.error = error;
  core.transport.send(createEnvelope("storage/write-result", core.appId, payload));
}

function replyStorageClear(core: SpyglassCore, requestId: string, ok: boolean, errorCode?: StorageClearErrorCode, error?: string): void {
  const payload: StorageClearResultPayload = { requestId, ok };
  if (errorCode !== undefined) payload.errorCode = errorCode;
  if (error !== undefined) payload.error = error;
  core.transport.send(createEnvelope("storage/clear-result", core.appId, payload));
}

function replyState(core: SpyglassCore, requestId: string, ok: boolean, errorCode?: StateWriteErrorCode, error?: string): void {
  const payload: StateWriteResultPayload = { requestId, ok };
  if (errorCode !== undefined) payload.errorCode = errorCode;
  if (error !== undefined) payload.error = error;
  core.transport.send(createEnvelope("state/write-result", core.appId, payload));
}

function replyMemory(core: SpyglassCore, requestId: string, ok: boolean, errorCode?: MemoryClearCacheErrorCode, error?: string): void {
  const payload: MemoryClearCacheResultPayload = { requestId, ok };
  if (errorCode !== undefined) payload.errorCode = errorCode;
  if (error !== undefined) payload.error = error;
  core.transport.send(createEnvelope("memory/clear-cache-result", core.appId, payload));
}

function replyQueryWrite(core: SpyglassCore, requestId: string, ok: boolean, errorCode?: QueryWriteErrorCode, error?: string): void {
  const payload: QueryWriteResultPayload = { requestId, ok };
  if (errorCode !== undefined) payload.errorCode = errorCode;
  if (error !== undefined) payload.error = error;
  core.transport.send(createEnvelope("query/write-result", core.appId, payload));
}

function replyQueryCommand(core: SpyglassCore, requestId: string, ok: boolean, errorCode?: QueryCommandErrorCode, error?: string): void {
  const payload: QueryCommandResultPayload = { requestId, ok };
  if (errorCode !== undefined) payload.errorCode = errorCode;
  if (error !== undefined) payload.error = error;
  core.transport.send(createEnvelope("query/command-result", core.appId, payload));
}

/**
 * @internal Wired by `init()` only when the inbound channel is enabled.
 * This is the first-ever caller of `Transport.onMessage` — the receive
 * plumbing has existed since the transport was written, unused until now.
 * Returns the transport's own unsubscribe.
 */
export function enableInboundCommands(core: SpyglassCore): () => void {
  return core.transport.onMessage((envelope) => {
    if (envelope.appId !== core.appId) return; // addressed to a different app instance

    switch (envelope.type) {
      case "storage/write": {
        const p = envelope.payload;
        const handler = storageWriteHandlers.get(storageHandlerKey(p.engine, p.dbName));
        if (!handler) {
          replyStorage(core, p.requestId, false, "no-adapter", `No attached adapter for "${p.engine}"${p.dbName ? ` (${p.dbName})` : ""}.`);
          return;
        }
        if (p.op !== "set" && p.op !== "remove") {
          replyStorage(core, p.requestId, false, "unsupported-op", `Unsupported op: ${String(p.op)}`);
          return;
        }
        // `Promise.resolve().then(() => handler(...))`, not
        // `Promise.resolve(handler(...))` — the latter evaluates `handler(...)`
        // eagerly, so a *synchronous* throw (not just a rejected promise)
        // would escape uncaught instead of landing in the `.then` rejection
        // branch below.
        Promise.resolve()
          .then(() => handler(p.op, p.key, p.value))
          .then(
            () => replyStorage(core, p.requestId, true),
            (err: unknown) => replyStorage(core, p.requestId, false, "engine-error", err instanceof Error ? err.message : String(err)),
          );
        return;
      }
      case "storage/clear": {
        const p = envelope.payload;
        const handler = storageClearHandlers.get(storageHandlerKey(p.engine, p.dbName));
        if (!handler) {
          replyStorageClear(core, p.requestId, false, "no-adapter", `No attached adapter for "${p.engine}"${p.dbName ? ` (${p.dbName})` : ""}.`);
          return;
        }
        if (p.scope !== "all" && p.scope !== "table") {
          replyStorageClear(core, p.requestId, false, "unsupported-op", `Unsupported scope: ${String(p.scope)}`);
          return;
        }
        if (p.scope === "table" && !p.table) {
          replyStorageClear(core, p.requestId, false, "unsupported-op", 'scope: "table" requires a table name.');
          return;
        }
        Promise.resolve()
          .then(() => handler(p.scope, p.table))
          .then(
            () => replyStorageClear(core, p.requestId, true),
            (err: unknown) =>
              replyStorageClear(
                core,
                p.requestId,
                false,
                err instanceof StorageClearUnsupportedError ? "unsupported-op" : "engine-error",
                err instanceof Error ? err.message : String(err),
              ),
          );
        return;
      }
      case "state/write": {
        const p = envelope.payload;
        const handler = stateWriteHandlers.get(p.storeId);
        if (!handler) {
          replyState(core, p.requestId, false, "no-store", `No attached store for "${p.storeId}".`);
          return;
        }
        Promise.resolve()
          .then(() => handler(p.state))
          .then(
            () => replyState(core, p.requestId, true),
            (err: unknown) => replyState(core, p.requestId, false, "engine-error", err instanceof Error ? err.message : String(err)),
          );
        return;
      }
      case "query/write": {
        const p = envelope.payload;
        if (!queryWriteHandler) {
          replyQueryWrite(core, p.requestId, false, "no-adapter", "No attached React Query client.");
          return;
        }
        // Rejected here, before the handler, for the same reason
        // `storage/write` validates `op` here: it's a payload problem, not
        // an engine problem. `data: undefined` can't be distinguished from a
        // missing key (JSON drops it), and React Query would treat it as a
        // silent no-op. @see QueryWriteErrorCode's "invalid-data".
        if (p.data === undefined) {
          replyQueryWrite(core, p.requestId, false, "invalid-data", "query/write carried no `data`.");
          return;
        }
        Promise.resolve()
          .then(() => queryWriteHandler!(p.queryHash, p.data))
          .then(
            () => replyQueryWrite(core, p.requestId, true),
            (err: unknown) =>
              replyQueryWrite(
                core,
                p.requestId,
                false,
                err instanceof QueryNotFoundError
                  ? "no-query"
                  : err instanceof QueryWriteNotAppliedError
                    ? "not-applied"
                    : "engine-error",
                err instanceof Error ? err.message : String(err),
              ),
          );
        return;
      }
      case "query/command": {
        const p = envelope.payload;
        if (!queryCommandHandler) {
          replyQueryCommand(core, p.requestId, false, "no-adapter", "No attached React Query client.");
          return;
        }
        Promise.resolve()
          .then(() => queryCommandHandler!(p.queryHash, p.command))
          .then(
            () => replyQueryCommand(core, p.requestId, true),
            (err: unknown) =>
              replyQueryCommand(
                core,
                p.requestId,
                false,
                err instanceof QueryNotFoundError ? "no-query" : "engine-error",
                err instanceof Error ? err.message : String(err),
              ),
          );
        return;
      }
      case "memory/clear-cache": {
        const p = envelope.payload;
        // No handler lookup — unlike storage/state, there's no "target" to
        // be missing (see MemoryClearCachePayload's doc comment), so this
        // always attempts the action; only a genuine throw inside
        // clearCaches() itself replies with an error.
        Promise.resolve()
          .then(() => clearCaches())
          .then(
            () => replyMemory(core, p.requestId, true),
            (err: unknown) => replyMemory(core, p.requestId, false, "engine-error", err instanceof Error ? err.message : String(err)),
          );
        return;
      }
      default:
        return; // closed-world: nothing else is handled inbound today
    }
  });
}
