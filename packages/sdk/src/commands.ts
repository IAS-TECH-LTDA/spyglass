import { createEnvelope } from "spyglass-protocol";
import type {
  MemoryClearCacheErrorCode,
  MemoryClearCacheResultPayload,
  StateWriteErrorCode,
  StateWriteResultPayload,
  StorageEngine,
  StorageWriteErrorCode,
  StorageWriteOp,
  StorageWriteResultPayload,
} from "spyglass-protocol";
import type { SpyglassCore } from "./core.js";
import { clearCaches } from "./memoryClear.js";

/**
 * Inbound command handling (spec 0007, spec 0007-state, spec 0008) — the
 * SDK's three Desktop -> SDK directions (storage KV writes, state-manager
 * writes, and clearing the app's own caches). Everything here is only ever
 * wired up when `init()`'s `allowRemoteWrites` gate is on (dev-only by
 * default); see `index.ts`. Kept in its own module so that gate is a
 * single call to `enableInboundCommands()`, not something scattered across
 * every adapter.
 */

export type StorageWriteHandler = (op: StorageWriteOp, key: string, value: unknown) => void | Promise<void>;

/** @see StateWritePayload's doc comment (packages/protocol) for why this is a shallow-merge contract, not a replace. */
export type StateWriteHandler = (nextState: unknown) => void | Promise<void>;

function storageHandlerKey(engine: StorageEngine, dbName: string | undefined): string {
  return `${engine}::${dbName ?? ""}`;
}

const storageWriteHandlers = new Map<string, StorageWriteHandler>();
const stateWriteHandlers = new Map<string, StateWriteHandler>();

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
 * @internal Called by `state/zustand.ts`'s `withSpyglass` at store-creation
 * time. Unlike storage adapters, a store creator never re-runs/detaches on
 * its own, so there's no unregister call here — a second `withSpyglass()`
 * call for the same `storeId` (dev hot-reload) simply overwrites the entry,
 * same end result as storage's guarded unregister without needing one.
 */
export function registerStateWriteHandler(storeId: string, handler: StateWriteHandler): void {
  stateWriteHandlers.set(storeId, handler);
}

function replyStorage(core: SpyglassCore, requestId: string, ok: boolean, errorCode?: StorageWriteErrorCode, error?: string): void {
  const payload: StorageWriteResultPayload = { requestId, ok };
  if (errorCode !== undefined) payload.errorCode = errorCode;
  if (error !== undefined) payload.error = error;
  core.transport.send(createEnvelope("storage/write-result", core.appId, payload));
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
