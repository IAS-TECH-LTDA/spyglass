import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `loadPlatform`/`loadNativeModules` cache their result at module scope, so
 * each test needs a fresh module instance — same pattern as
 * `detect.test.ts`/`devHost.test.ts`.
 *
 * `require()` can't be intercepted by any Vitest mocking primitive (see the
 * doc comment on `requireReactNativeLeaf` in `reactNative.ts`) — confirmed
 * empirically: `vi.doMock` on the leaf specifiers below is silently ignored
 * by the literal `require()` call. `react-native` (and its leaf paths) is
 * never actually installed in this monorepo either, so
 * `require("react-native/Libraries/Utilities/Platform")` always genuinely
 * fails to resolve in this Node test environment — every test below
 * exercises that real "leaf path doesn't exist" failure branch directly,
 * without any mocking.
 */
beforeEach(() => {
  vi.resetModules();
});

describe("loadPlatform", () => {
  it("resolves to null when react-native isn't installed at all", async () => {
    const { loadPlatform } = await import("../reactNative.js");
    await expect(loadPlatform()).resolves.toBeNull();
  });

  it("caches the null result across repeated calls to both loaders", async () => {
    const { loadPlatform, loadNativeModules } = await import("../reactNative.js");
    await loadPlatform();
    await loadNativeModules();
    await expect(loadPlatform()).resolves.toBeNull();
  });
});

describe("loadNativeModules", () => {
  it("resolves to null when react-native isn't installed at all", async () => {
    const { loadNativeModules } = await import("../reactNative.js");
    await expect(loadNativeModules()).resolves.toBeNull();
  });
});
