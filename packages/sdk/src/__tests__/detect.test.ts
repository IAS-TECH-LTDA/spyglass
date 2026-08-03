import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `detectPlatform`/`detectFramework` cache their result at module scope, so
 * each test needs a fresh module instance (`vi.resetModules()` + re-import)
 * to see a different mocked environment.
 */
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("react-native");
  vi.doUnmock("expo-constants");
  vi.unstubAllGlobals();
});

describe("detectFramework", () => {
  it("returns \"expo\" when expo-constants reports a populated execution environment", async () => {
    vi.doMock("expo-constants", () => ({
      default: { executionEnvironment: "storeClient", appOwnership: "expo" },
    }));
    vi.doMock("react-native", () => ({ Platform: { OS: "ios" } }));

    const { detectFramework } = await import("../index.js");
    await expect(detectFramework()).resolves.toBe("expo");
  });

  it("returns \"bare-rn\" when react-native resolves but expo-constants is absent", async () => {
    vi.doMock("react-native", () => ({ Platform: { OS: "android" } }));

    const { detectFramework } = await import("../index.js");
    await expect(detectFramework()).resolves.toBe("bare-rn");
  });

  it("returns \"web\" when there is no react-native runtime but a real DOM exists", async () => {
    vi.doMock("react-native", () => {
      throw new Error("not a React Native runtime");
    });
    vi.stubGlobal("document", {});
    vi.stubGlobal("window", {});

    const { detectFramework } = await import("../index.js");
    await expect(detectFramework()).resolves.toBe("web");
  });

  it("returns \"unknown\" when neither react-native, expo-constants nor a DOM are present", async () => {
    vi.doMock("react-native", () => {
      throw new Error("not a React Native runtime");
    });

    const { detectFramework } = await import("../index.js");
    await expect(detectFramework()).resolves.toBe("unknown");
  });

  it("does not classify a bare RN app with a stray expo-constants install as expo", async () => {
    vi.doMock("expo-constants", () => ({ default: {} }));
    vi.doMock("react-native", () => ({ Platform: { OS: "android" } }));

    const { detectFramework } = await import("../index.js");
    await expect(detectFramework()).resolves.toBe("bare-rn");
  });
});
