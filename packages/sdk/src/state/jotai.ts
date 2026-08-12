import { createEnvelope, diffValues, hashValue, safeSerialize } from "spyglass-protocol";
import type { StateActionPayload, StateInitPayload } from "spyglass-protocol";
import { getCore } from "../core.js";

/** Structural subset of Jotai's vanilla `Store` (from `createStore()` in `jotai/vanilla`). */
interface JotaiStoreLike {
  get<T>(atom: unknown): T;
  sub(atom: unknown, callback: () => void): () => void;
}

export interface JotaiAtomWatch {
  atom: unknown;
  /** Display name in the desktop inspector — Jotai atoms have no name at runtime. */
  name: string;
}

export interface JotaiAdapterOptions {
  storeId?: string;
}

/**
 * Watches a fixed list of Jotai atoms via a vanilla store and streams their
 * values/diffs to the desktop inspector. Jotai has no single "root state"
 * the way Redux/Zustand do, so each watched atom is reported as its own
 * named slice under one `storeId`.
 *
 * ```ts
 * import { createStore } from "jotai/vanilla";
 * import { attachJotai } from "spyglass-react/state/jotai";
 *
 * export const store = createStore();
 * attachJotai(store, [
 *   { atom: countAtom, name: "count" },
 *   { atom: userAtom, name: "user" },
 * ]);
 * ```
 */
export function attachJotai(
  store: JotaiStoreLike,
  atoms: JotaiAtomWatch[],
  options: JotaiAdapterOptions = {},
): () => void {
  const core = getCore();
  core.registerCapability("state:jotai");
  const storeId = options.storeId ?? "jotai";
  const prevValues = new Map<string, unknown>();

  const unsubscribes = atoms.map(({ atom, name }) => {
    const emitInit = () => {
      const value = safeSerialize(store.get(atom));
      prevValues.set(name, value);
      const initPayload: StateInitPayload = { storeId, storeType: "jotai", label: name, state: value };
      core.transport.send(createEnvelope("state/init", core.appId, initPayload));
    };

    const emitChange = () => {
      const value = safeSerialize(store.get(atom));
      const prev = prevValues.get(name);
      const diff = diffValues(prev, value);
      prevValues.set(name, value);
      if (diff.length === 0) return;

      const payload: StateActionPayload = {
        storeId,
        storeType: "jotai",
        action: { type: `set:${name}` },
        diff,
        nextStateHash: hashValue(value),
      };
      core.transport.send(createEnvelope("state/action", core.appId, payload));
    };

    emitInit();
    return store.sub(atom, emitChange);
  });

  return () => {
    for (const unsub of unsubscribes) unsub();
  };
}
