import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `detectPlatform`/`detectFramework` cache their result at module scope, so
 * each test needs a fresh module instance (`vi.resetModules()` + re-import)
 * to see a different mocked environment.
 *
 * Mocked at the `../reactNative.js` boundary (`loadPlatform`), not at
 * `react-native` itself — see the doc comment on `requireReactNativeLeaf` in
 * `reactNative.ts` for why `react-native` itself can no longer be mocked
 * this way (it's resolved via a literal `require()`, which no Vitest
 * mocking primitive can intercept).
 */
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("../reactNative.js");
  vi.doUnmock("expo-constants");
  vi.unstubAllGlobals();
});

describe("detectFramework", () => {
  it("returns \"expo\" when expo-constants reports a populated execution environment", async () => {
    vi.doMock("expo-constants", () => ({
      default: { executionEnvironment: "storeClient", appOwnership: "expo" },
    }));
    vi.doMock("../reactNative.js", () => ({ loadPlatform: async () => ({ OS: "ios" }) }));

    const { detectFramework } = await import("../index.js");
    await expect(detectFramework()).resolves.toBe("expo");
  });

  it("returns \"bare-rn\" when react-native resolves but expo-constants is absent", async () => {
    vi.doMock("../reactNative.js", () => ({ loadPlatform: async () => ({ OS: "android" }) }));

    const { detectFramework } = await import("../index.js");
    await expect(detectFramework()).resolves.toBe("bare-rn");
  });

  it("returns \"web\" when there is no react-native runtime but a real DOM exists", async () => {
    vi.doMock("../reactNative.js", () => ({ loadPlatform: async () => null }));
    vi.stubGlobal("document", {});
    vi.stubGlobal("window", {});

    const { detectFramework } = await import("../index.js");
    await expect(detectFramework()).resolves.toBe("web");
  });

  it("returns \"unknown\" when neither react-native, expo-constants nor a DOM are present", async () => {
    vi.doMock("../reactNative.js", () => ({ loadPlatform: async () => null }));

    const { detectFramework } = await import("../index.js");
    await expect(detectFramework()).resolves.toBe("unknown");
  });

  it("does not classify a bare RN app with a stray expo-constants install as expo", async () => {
    vi.doMock("expo-constants", () => ({ default: {} }));
    vi.doMock("../reactNative.js", () => ({ loadPlatform: async () => ({ OS: "android" }) }));

    const { detectFramework } = await import("../index.js");
    await expect(detectFramework()).resolves.toBe("bare-rn");
  });
});
