import { createEnvelope, diffValues, hashValue, safeSerialize } from "@datamobile/protocol";
import type { StateActionPayload, StateInitPayload } from "@datamobile/protocol";
import { getCore } from "../core.js";

/**
 * Structural subset of Zustand's `StateCreator` — avoids depending on
 * `zustand`'s types. `set`'s two-overload shape mirrors zustand's real
 * `SetState` exactly (a partial merge, or `replace: true` for a full
 * replacement) — matching it precisely, rather than collapsing to a single
 * signature, is what keeps this assignable to real zustand's `StateCreator`.
 */
type SetState<T> = {
  (partial: Partial<T> | ((state: T) => Partial<T>), replace?: false): void;
  (state: T | ((state: T) => T), replace: true): void;
};
type GetState<T> = () => T;
type StateCreatorLike<T> = (set: SetState<T>, get: GetState<T>, api: unknown) => T;

export interface ZustandAdapterOptions {
  storeId?: string;
  label?: string;
}

/**
 * Zustand middleware, applied around your store's creator function, that
 * mirrors every `set()` call to the desktop inspector as a diff.
 *
 * ```ts
 * import { create } from "zustand";
 * import { withDataMobile } from "@datamobile/sdk/state/zustand";
 *
 * const useStore = create(withDataMobile((set, get) => ({
 *   count: 0,
 *   increment: () => set((s) => ({ count: s.count + 1 })),
 * })));
 * ```
 */
export function withDataMobile<T extends object>(
  config: StateCreatorLike<T>,
  options: ZustandAdapterOptions = {},
): StateCreatorLike<T> {
  const core = getCore();
  core.registerCapability("state:zustand");
  const storeId = options.storeId ?? "zustand";

  return (set, get, api) => {
    let prevState: unknown;

    // Implemented as a single loosely-typed function and cast to the
    // overloaded `SetState<T>` — TS can't check a arrow function body
    // against multiple call signatures directly, only named function
    // declarations support that.
    const wrappedSet = ((partial: unknown, replace?: boolean) => {
      const setterName =
        typeof partial === "function" ? (partial as { name?: string }).name || "setState" : "setState";
      (set as (p: unknown, r?: boolean) => void)(partial, replace);
      const state = safeSerialize(get());
      const diff = diffValues(prevState, state);
      prevState = state;
      if (diff.length === 0) return;

      const payload: StateActionPayload = {
        storeId,
        storeType: "zustand",
        action: { type: setterName },
        diff,
        nextStateHash: hashValue(state),
      };
      core.transport.send(createEnvelope("state/action", core.appId, payload));
    }) as SetState<T>;

    const initialState = config(wrappedSet, get, api);
    prevState = safeSerialize(initialState);

    const initPayload: StateInitPayload = {
      storeId,
      storeType: "zustand",
      label: options.label,
      state: prevState,
    };
    core.transport.send(createEnvelope("state/init", core.appId, initPayload));

    return initialState;
  };
}
