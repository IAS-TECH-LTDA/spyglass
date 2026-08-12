import type { Capability } from "spyglass-protocol";
import type { Transport } from "./transport/ws.js";

export interface SpyglassCore {
  transport: Transport;
  appId: string;
  registerCapability: (capability: Capability) => void;
  /**
   * Returns `true` the first time it's called for a given capability on
   * *this* core, `false` on every call after that. Backs the idempotent
   * no-op behavior of auto-attached adapters (console/network/performance,
   * see `index.ts`'s `init()`): calling `attachConsole()` a second time —
   * whether the app did it manually or `init()` already auto-attached it —
   * must not double-patch and start reporting every log line twice. A
   * fresh `init()` call gets a fresh core (and a fresh set backing this),
   * so it isn't "stuck" remembering a previous, already-closed core.
   */
  markAttached: (capability: Capability) => boolean;
}

let core: SpyglassCore | null = null;

/** @internal set by `init()`; not part of the public API. */
export function setCore(next: SpyglassCore | null): void {
  core = next;
}

export function hasCore(): boolean {
  return core !== null;
}

/**
 * Every adapter (`navigation`, `state/*`, `storage/*`) calls this to reach
 * the shared transport. Throws with a clear message if `init()` hasn't run
 * yet — adapters are meant to be attached right after `init()`, e.g.:
 *
 * ```ts
 * import { init } from "spyglass-react";
 * import { attachNavigation } from "spyglass-react/navigation";
 *
 * init({ appName: "MyApp" });
 * attachNavigation(navigationRef);
 * ```
 */
export function getCore(): SpyglassCore {
  if (!core) {
    throw new Error(
      "[Spyglass] SDK not initialized. Call init() from 'spyglass-react' before attaching any adapter.",
    );
  }
  return core;
}
