import { createEnvelope, diffValues, hashValue, safeSerialize } from "spyglass-protocol";
import type { StateActionPayload, StateInitPayload } from "spyglass-protocol";
import { getCore } from "../core.js";

/**
 * Structural subset of Redux's types — avoids a hard dependency on `redux`.
 * `action`/`next`/the return type are all `unknown`-shaped on purpose:
 * Redux's real `UnknownAction.type` is `unknown` (not `string`), and
 * matching that loosely is what keeps this middleware's type assignable to
 * real Redux/RTK's `Middleware<{}, S>` without importing its types.
 */
interface MinimalStoreAPI<S> {
  getState(): S;
}
type Dispatch = (action: unknown) => unknown;
type Middleware<S = unknown> = (store: MinimalStoreAPI<S>) => (next: Dispatch) => (action: unknown) => unknown;

export interface ReduxAdapterOptions {
  /** Distinguishes multiple stores (e.g. a root store + a feature-sliced one). */
  storeId?: string;
  label?: string;
}

/**
 * Redux middleware that streams every dispatched action's resulting diff to
 * the desktop inspector. Works with plain Redux and Redux Toolkit stores.
 *
 * ```ts
 * import { configureStore } from "@reduxjs/toolkit";
 * import { createSpyglassReduxMiddleware } from "spyglass-react/state/redux";
 *
 * const store = configureStore({
 *   reducer: rootReducer,
 *   middleware: (getDefault) => getDefault().concat(createSpyglassReduxMiddleware()),
 * });
 * ```
 */
export function createSpyglassReduxMiddleware<S = unknown>(
  options: ReduxAdapterOptions = {},
): Middleware<S> {
  const core = getCore();
  core.registerCapability("state:redux");
  const storeId = options.storeId ?? "redux";

  let initialized = false;
  let prevState: unknown;

  return (store) => (next) => (action) => {
    const result = next(action);
    const state = safeSerialize(store.getState());

    if (!initialized) {
      initialized = true;
      prevState = state;
      const initPayload: StateInitPayload = {
        storeId,
        storeType: "redux",
        label: options.label,
        state,
      };
      core.transport.send(createEnvelope("state/init", core.appId, initPayload));
      return result;
    }

    const diff = diffValues(prevState, state);
    prevState = state;
    if (diff.length === 0) return result;

    const actionRecord = action as { type?: unknown; payload?: unknown } | null | undefined;
    const payload: StateActionPayload = {
      storeId,
      storeType: "redux",
      action: {
        type: typeof actionRecord?.type === "string" ? actionRecord.type : "UNKNOWN",
        payload: safeSerialize(actionRecord?.payload),
      },
      diff,
      nextStateHash: hashValue(state),
    };
    core.transport.send(createEnvelope("state/action", core.appId, payload));
    return result;
  };
}
