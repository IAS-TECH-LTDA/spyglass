import { withSpyglass } from "./zustand.js";

let storeCounter = 0;

/**
 * Attempts to globally patch zustand's own `create` export so every store
 * the app creates goes through `withSpyglass(...)` automatically, without an
 * explicit wrap at each call site — the one state manager where this is
 * even attemptable, since `create()` is a single factory every zustand
 * store in the app passes through (see the SDK README's "Why not every
 * adapter?" for why Redux/Jotai/Recoil/MobX don't have an equivalent).
 *
 * Best-effort, not guaranteed: reassigning a named ES module export
 * (`zustandModule.create = ...`) is only a mutable operation under some
 * bundlers' CJS interop — React Native's Metro is one, which is this SDK's
 * primary target, but a web app bundled by Vite/Rollup in strict ESM mode
 * will throw on the reassignment. Fails safe either way: catches it, and
 * simply doesn't advertise the capability rather than throwing or leaving
 * a half-patched module.
 *
 * Timing caveat, inherent to patching a *factory* rather than an instance
 * method: only stores created *after* this patch takes effect are
 * instrumented. Since installing it requires an `await import("zustand")`
 * first, a store created synchronously in the very same tick as `init()`
 * (e.g. at module top level, imported before that dynamic import resolves)
 * can be missed — wrap it explicitly with `withSpyglass(...)` if so.
 */
export async function tryAutoAttachZustand(): Promise<(() => void) | undefined> {
  let zustandModule: Record<string, unknown>;
  try {
    zustandModule = (await import("zustand")) as Record<string, unknown>;
  } catch {
    return undefined; // zustand not installed
  }

  const maybeCreate = zustandModule.create as ((...args: unknown[]) => unknown) | undefined;
  if (typeof maybeCreate !== "function") return undefined;
  // Re-bound to a definitely-typed const so TS carries the narrowing into
  // the closures below — `maybeCreate` itself stays `| undefined` to them.
  const originalCreate: (...args: unknown[]) => unknown = maybeCreate;

  function wrapConfig(configFn: unknown): unknown {
    if (typeof configFn !== "function") return configFn;
    storeCounter++;
    // biome-ignore lint: the real StateCreator shape lives behind zustand's own types, unavailable here since the import is dynamic/untyped
    return withSpyglass(configFn as never, { storeId: `zustand#${storeCounter}` });
  }

  function patchedCreate(first?: unknown, ...rest: unknown[]): unknown {
    if (typeof first === "function") {
      return originalCreate(wrapConfig(first), ...rest);
    }
    if (first === undefined) {
      // Curried form zustand supports for TS generic inference: create<T>()(actualCreator).
      return (actualConfig: unknown, ...moreRest: unknown[]) => originalCreate(wrapConfig(actualConfig), ...moreRest);
    }
    // Anything else (e.g. a vanilla store descriptor object in some zustand
    // versions) — pass through unmodified rather than guessing.
    return originalCreate(first, ...rest);
  }

  try {
    zustandModule.create = patchedCreate;
  } catch {
    return undefined; // read-only export under strict ESM — nothing was changed
  }

  return () => {
    try {
      zustandModule.create = originalCreate;
    } catch {
      // Same read-only concern on the way back out; if the forward patch
      // somehow succeeded but this doesn't, there's nothing more to do.
    }
  };
}
