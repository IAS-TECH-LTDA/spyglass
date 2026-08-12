export interface PlatformLike {
  OS?: string;
  constants?: { ServerHost?: string | null };
}

export interface NativeModulesLike {
  SourceCode?: { scriptURL?: string | null };
}

let cachedPlatform: PlatformLike | null | undefined;
let cachedNativeModules: NativeModulesLike | null | undefined;

/**
 * Loads a specific `react-native` leaf module (never `react-native`'s own
 * barrel `index.js`) via a literal, statically-analyzable `require()` call —
 * not a dynamic `import()`.
 *
 * **Why not `import("react-native")`** (the original bug): Metro's
 * ESM-interop for a *dynamic* `import()` of a non-`__esModule` CommonJS
 * module (which `react-native/index.js` is) wraps the result through a
 * namespace-building helper that eagerly enumerates every own property to
 * copy it onto a new object. That barrel's exports include several
 * deprecated APIs (e.g. `PushNotificationIOS`) surfaced as getters with side
 * effects — merely enumerating them, never a real property read this SDK
 * performs, can throw while constructing a `NativeEventEmitter` for a native
 * module the host app never linked. Confirmed in the wild: an app that never
 * touches push notifications at all crashed purely because this SDK's own
 * platform/host detection did `import("react-native")`.
 *
 * **Why not a bare `require("react-native")` guarded by `typeof require`**
 * (the first fix attempt, also confirmed broken): Metro never exposes a
 * global identifier literally named `require` — each module factory
 * receives it as a parameter Metro internally renames (`_$$_REQUIRE` in the
 * emitted bundle), so `typeof require` is always `"undefined"` at runtime
 * and the code permanently fell through to the exact `import("react-native")`
 * path it was meant to avoid.
 *
 * **Why not a dynamic `import()` of a leaf path either** (the second fix
 * attempt, also confirmed broken): swapping the *specifier* from the barrel
 * to a small leaf module (e.g. `react-native/Libraries/Utilities/Platform`)
 * still goes through `import()`, which Metro's dependency collector always
 * tags `asyncType: "async"` — an async/lazy segment boundary, resolved by a
 * separate on-demand fetch. Under a Metro dev server started with
 * `lazy=true` (this app's default), a path never otherwise reached as an
 * *async* boundary throws `Requiring unknown module "NNNN"` at runtime —
 * confirmed in the wild, survived a full Metro cache reset.
 *
 * **Why not one shared helper parameterized by a `specifier` argument**
 * (the third fix attempt, caught at build time before it ever shipped):
 * Metro's dependency collector only recognizes `require(...)` calls whose
 * argument is a literal string *at that exact call site* — `require(x)`
 * where `x` is a variable (even one only ever called with literal strings
 * elsewhere) can't be statically resolved, and Metro hard-fails the whole
 * bundle with `Invalid call ... require(specifier)` rather than falling
 * back to anything at runtime. Hence two near-identical functions below
 * instead of one — each needs its own literal `require("...")` expression
 * for Metro to see.
 *
 * **This fix**: a literal, syntactically-static `require("<leaf path>")`
 * call, one per leaf. Metro's dependency collector tags a plain `require()`
 * call `asyncType: null` — an ordinary *synchronous* dependency, always
 * folded into the main eager bundle graph regardless of `lazy` — so there's
 * no segment to fail to fetch. And because it's a plain `require()` (not a
 * namespace `import`), Metro compiles it to its own per-module `require`
 * directly, returning the raw `module.exports` — no namespace object, no
 * eager getter enumeration, no interop wrapper. Targeting a small, focused
 * leaf module rather than the barrel also means there's no wall of
 * deprecated re-exports to accidentally enumerate even if some other tool in
 * the chain did wrap it.
 *
 * Wrapped in try/catch same as every previous attempt: resolves `null`
 * (never throws) when `react-native` isn't installed at all (Node, tests, a
 * ReactJS/web app) or the leaf path doesn't exist on the installed version.
 *
 * Not unit-testable via Vitest's module-mocking primitives (`vi.doMock`,
 * `vi.stubGlobal`) — none can intercept a literal `require()` call, which is
 * resolved through the same kind of lexically-scoped, per-module binding
 * Metro uses, not a true global. In this Node test environment `require`
 * itself is real (unlike under Metro), so these tests exercise the actual
 * "leaf path doesn't exist" failure branch directly instead of mocking it.
 */
export async function loadPlatform(): Promise<PlatformLike | null> {
  if (cachedPlatform !== undefined) return cachedPlatform;
  let result: PlatformLike | null = null;
  try {
    // `require` is intentionally not declared as a global anywhere in this
    // package, to avoid a conflicting redeclaration wherever `@types/node`'s
    // own ambient `require` is also visible in the same TS program (it is,
    // via `__tests__/version.test.ts`'s `node:fs` import) — `@ts-ignore`
    // rather than `@ts-expect-error` because whether this line needs
    // suppressing depends on whether some *other* file in the same
    // compilation pulled that ambient declaration in.
    // @ts-ignore
    const mod = require("react-native/Libraries/Utilities/Platform");
    result = (mod?.default ?? mod) ?? null;
  } catch {
    result = null;
  }
  cachedPlatform = result;
  return result;
}

export async function loadNativeModules(): Promise<NativeModulesLike | null> {
  if (cachedNativeModules !== undefined) return cachedNativeModules;
  let result: NativeModulesLike | null = null;
  try {
    // @ts-ignore — see the comment on loadPlatform above.
    const mod = require("react-native/Libraries/BatchedBridge/NativeModules");
    result = (mod?.default ?? mod) ?? null;
  } catch {
    result = null;
  }
  cachedNativeModules = result;
  return result;
}
