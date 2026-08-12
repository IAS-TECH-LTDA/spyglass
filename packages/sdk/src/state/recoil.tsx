import { useEffect, useRef } from "react";
import { useRecoilTransactionObserver_UNSTABLE } from "recoil";
import { createEnvelope, diffValues, hashValue, safeSerialize } from "spyglass-protocol";
import type { StateActionPayload, StateInitPayload } from "spyglass-protocol";
import { getCore } from "../core.js";

export interface RecoilAtomWatch {
  atom: unknown;
  /** Display name in the desktop inspector. */
  name: string;
}

export interface RecoilAdapterOptions {
  storeId?: string;
}

interface RecoilSnapshotLike {
  getLoadable(atom: unknown): { contents: unknown };
}

/**
 * Recoil has no vanilla store to attach to outside React (unlike Jotai), so
 * this adapter is a hook mounted once inside your `RecoilRoot`. It uses
 * Recoil's transaction observer to catch every atom update and streams the
 * watched atoms' diffs to the desktop inspector.
 *
 * ```tsx
 * function RecoilInspectorBridge() {
 *   useSpyglassRecoil([
 *     { atom: countAtom, name: "count" },
 *     { atom: userAtom, name: "user" },
 *   ]);
 *   return null;
 * }
 *
 * <RecoilRoot>
 *   <RecoilInspectorBridge />
 *   <App />
 * </RecoilRoot>
 * ```
 */
export function useSpyglassRecoil(atoms: RecoilAtomWatch[], options: RecoilAdapterOptions = {}): void {
  const core = getCore();
  const storeId = options.storeId ?? "recoil";
  const prevValues = useRef(new Map<string, unknown>());

  useEffect(() => {
    core.registerCapability("state:recoil");
  }, [core]);

  useRecoilTransactionObserver_UNSTABLE(({ snapshot }: { snapshot: RecoilSnapshotLike }) => {
    for (const { atom, name } of atoms) {
      const value = safeSerialize(snapshot.getLoadable(atom).contents);

      if (!prevValues.current.has(name)) {
        prevValues.current.set(name, value);
        const initPayload: StateInitPayload = { storeId, storeType: "recoil", label: name, state: value };
        core.transport.send(createEnvelope("state/init", core.appId, initPayload));
        continue;
      }

      const prev = prevValues.current.get(name);
      const diff = diffValues(prev, value);
      prevValues.current.set(name, value);
      if (diff.length === 0) continue;

      const payload: StateActionPayload = {
        storeId,
        storeType: "recoil",
        action: { type: `set:${name}` },
        diff,
        nextStateHash: hashValue(value),
      };
      core.transport.send(createEnvelope("state/action", core.appId, payload));
    }
  });
}
