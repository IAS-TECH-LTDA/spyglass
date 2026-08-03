import { createEnvelope, diffValues, hashValue, safeSerialize } from "@datamobile/protocol";
import type { StateActionPayload, StateInitPayload } from "@datamobile/protocol";
import { getCore } from "../core.js";

/** Structural subset of `mobx`'s `spy()` event shape we care about. */
interface MobxSpyEvent {
  type: string;
  name?: string;
  object?: unknown;
  [key: string]: unknown;
}

interface MobxLike {
  spy(listener: (event: MobxSpyEvent) => void): () => void;
  toJS(value: unknown): unknown;
}

export interface MobxAdapterOptions {
  storeId?: string;
  label?: string;
}

/**
 * Attaches to one or more MobX observable stores via `spy()` (MobX's global
 * change-observation hook) and reports a diff after every action/reaction
 * that mutates them. `toJS` is used to unwrap observables into plain data
 * before serializing.
 *
 * ```ts
 * import * as mobx from "mobx";
 * import { attachMobx } from "@datamobile/sdk/state/mobx";
 *
 * export const store = new RootStore();
 * attachMobx(mobx, () => store, { label: "RootStore" });
 * ```
 */
export function attachMobx(
  mobx: MobxLike,
  getState: () => unknown,
  options: MobxAdapterOptions = {},
): () => void {
  const core = getCore();
  core.registerCapability("state:mobx");
  const storeId = options.storeId ?? "mobx";

  let prevState = safeSerialize(mobx.toJS(getState()));
  const initPayload: StateInitPayload = {
    storeId,
    storeType: "mobx",
    label: options.label,
    state: prevState,
  };
  core.transport.send(createEnvelope("state/init", core.appId, initPayload));

  // `spy()` fires for every observable read/write/action/reaction across the
  // whole app; we only care about mutation-flavored events to avoid emitting
  // on plain reads.
  const mutationEventTypes = new Set(["action", "update", "add", "remove", "splice"]);

  return mobx.spy((event) => {
    if (!mutationEventTypes.has(event.type)) return;

    const state = safeSerialize(mobx.toJS(getState()));
    const diff = diffValues(prevState, state);
    prevState = state;
    if (diff.length === 0) return;

    const payload: StateActionPayload = {
      storeId,
      storeType: "mobx",
      action: { type: event.name ?? event.type },
      diff,
      nextStateHash: hashValue(state),
    };
    core.transport.send(createEnvelope("state/action", core.appId, payload));
  });
}
