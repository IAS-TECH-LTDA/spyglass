import type { Capability } from "@datamobile/protocol";
import type { Transport } from "./transport/ws.js";

export interface DataMobileCore {
  transport: Transport;
  appId: string;
  registerCapability: (capability: Capability) => void;
}

let core: DataMobileCore | null = null;

/** @internal set by `init()`; not part of the public API. */
export function setCore(next: DataMobileCore | null): void {
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
 * import { init } from "@datamobile/sdk";
 * import { attachNavigation } from "@datamobile/sdk/navigation";
 *
 * init({ appName: "MyApp" });
 * attachNavigation(navigationRef);
 * ```
 */
export function getCore(): DataMobileCore {
  if (!core) {
    throw new Error(
      "[DataMobile] SDK not initialized. Call init() from '@datamobile/sdk' before attaching any adapter.",
    );
  }
  return core;
}
