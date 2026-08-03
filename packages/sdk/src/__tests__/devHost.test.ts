import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDevServerHost } from "../transport/devHost.js";

describe("parseDevServerHost", () => {
  it("extracts the host from a Metro bundle URL", () => {
    expect(parseDevServerHost("http://192.168.1.5:8081/index.bundle?platform=ios&dev=true")).toBe("192.168.1.5");
  });

  it("accepts https", () => {
    expect(parseDevServerHost("https://192.168.1.5:8081/index.bundle")).toBe("192.168.1.5");
  });

  it("preserves bracketed IPv6 form", () => {
    expect(parseDevServerHost("http://[fe80::1]:8081/x")).toBe("[fe80::1]");
  });

  it("skips userinfo before the host", () => {
    expect(parseDevServerHost("http://user:pw@10.0.0.4:8081/x")).toBe("10.0.0.4");
  });

  it("works without a port", () => {
    expect(parseDevServerHost("http://myhost/x")).toBe("myhost");
  });

  it("returns null for a file:// bundle URL (iOS release)", () => {
    expect(parseDevServerHost("file:///var/containers/Bundle/main.jsbundle")).toBeNull();
  });

  it("returns null for an assets:// bundle URL (Android release)", () => {
    expect(parseDevServerHost("assets://index.android.bundle")).toBeNull();
  });

  it("returns null for non-string/empty/malformed input", () => {
    expect(parseDevServerHost("")).toBeNull();
    expect(parseDevServerHost(undefined)).toBeNull();
    expect(parseDevServerHost(42)).toBeNull();
    expect(parseDevServerHost("not a url")).toBeNull();
  });
});

/**
 * `getDevHostCandidates`/`warmDevHost` cache their result at module scope,
 * so each test needs a fresh module instance to see a different mocked
 * environment — same pattern as `detect.test.ts`.
 */
describe("devHost candidate resolution", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("react-native");
    vi.doUnmock("expo-constants");
    vi.unstubAllGlobals();
  });

  it("uses the LAN IP parsed from scriptURL on a physical device", async () => {
    vi.doMock("react-native", () => ({
      NativeModules: { SourceCode: { scriptURL: "http://192.168.1.5:8081/index.bundle?platform=ios" } },
      Platform: { OS: "ios" },
    }));

    const { warmDevHost } = await import("../transport/devHost.js");
    await expect(warmDevHost()).resolves.toEqual(["192.168.1.5"]);
  });

  it("falls back to localhost when react-native has no SourceCode", async () => {
    vi.doMock("react-native", () => ({ Platform: { OS: "ios" } }));

    const { warmDevHost } = await import("../transport/devHost.js");
    await expect(warmDevHost()).resolves.toEqual(["localhost"]);
  });

  it("falls back to localhost when scriptURL is absent and nothing else resolves (standalone build)", async () => {
    vi.doMock("react-native", () => ({
      NativeModules: { SourceCode: {} },
      Platform: { OS: "android" },
    }));

    const { warmDevHost } = await import("../transport/devHost.js");
    await expect(warmDevHost()).resolves.toEqual(["localhost"]);
  });

  it("appends 10.0.2.2 only on Android when Metro resolves to loopback", async () => {
    vi.doMock("react-native", () => ({
      NativeModules: { SourceCode: { scriptURL: "http://localhost:8081/index.bundle" } },
      Platform: { OS: "android" },
    }));

    const { getDevHostCandidates, warmDevHost } = await import("../transport/devHost.js");
    await warmDevHost();
    expect(getDevHostCandidates()).toEqual(["localhost", "10.0.2.2"]);
  });

  it("does not append 10.0.2.2 on iOS with loopback", async () => {
    vi.doMock("react-native", () => ({
      NativeModules: { SourceCode: { scriptURL: "http://localhost:8081/index.bundle" } },
      Platform: { OS: "ios" },
    }));

    const { warmDevHost } = await import("../transport/devHost.js");
    await expect(warmDevHost()).resolves.toEqual(["localhost"]);
  });

  it("reads Platform.constants.ServerHost when there is no SourceCode.scriptURL", async () => {
    vi.doMock("react-native", () => ({
      NativeModules: {},
      Platform: { OS: "android", constants: { ServerHost: "localhost:8081" } },
    }));

    const { warmDevHost } = await import("../transport/devHost.js");
    await expect(warmDevHost()).resolves.toEqual(["localhost", "10.0.2.2"]);
  });

  it("falls back to location.hostname when there is no react-native runtime", async () => {
    vi.doMock("react-native", () => {
      throw new Error("not a React Native runtime");
    });
    vi.stubGlobal("location", { hostname: "192.168.0.9", protocol: "http:" });

    const { warmDevHost } = await import("../transport/devHost.js");
    await expect(warmDevHost()).resolves.toEqual(["192.168.0.9"]);
  });

  it("ignores location when the protocol is file:", async () => {
    vi.doMock("react-native", () => {
      throw new Error("not a React Native runtime");
    });
    vi.stubGlobal("location", { hostname: "192.168.0.9", protocol: "file:" });

    const { warmDevHost } = await import("../transport/devHost.js");
    await expect(warmDevHost()).resolves.toEqual(["localhost"]);
  });

  it("reads expoConfig.hostUri when react-native is unavailable", async () => {
    vi.doMock("react-native", () => {
      throw new Error("not a React Native runtime");
    });
    vi.doMock("expo-constants", () => ({ default: { expoConfig: { hostUri: "192.168.1.5:8081" } } }));

    const { warmDevHost } = await import("../transport/devHost.js");
    await expect(warmDevHost()).resolves.toEqual(["192.168.1.5"]);
  });

  it("reads expoGoConfig.debuggerHost as a fallback", async () => {
    vi.doMock("react-native", () => {
      throw new Error("not a React Native runtime");
    });
    vi.doMock("expo-constants", () => ({ default: { expoGoConfig: { debuggerHost: "192.168.1.7:19000" } } }));

    const { warmDevHost } = await import("../transport/devHost.js");
    await expect(warmDevHost()).resolves.toEqual(["192.168.1.7"]);
  });

  it("reads legacy manifest.debuggerHost as a fallback", async () => {
    vi.doMock("react-native", () => {
      throw new Error("not a React Native runtime");
    });
    vi.doMock("expo-constants", () => ({ default: { manifest: { debuggerHost: "192.168.1.9:19000" } } }));

    const { warmDevHost } = await import("../transport/devHost.js");
    await expect(warmDevHost()).resolves.toEqual(["192.168.1.9"]);
  });

  it("demotes a DNS/tunnel host behind localhost instead of dropping it", async () => {
    vi.doMock("react-native", () => ({
      NativeModules: { SourceCode: { scriptURL: "http://abc123.exp.direct:80/index.bundle" } },
      Platform: { OS: "ios" },
    }));

    const { warmDevHost } = await import("../transport/devHost.js");
    await expect(warmDevHost()).resolves.toEqual(["localhost", "abc123.exp.direct"]);
  });

  it("falls back to localhost when nothing resolves and nothing throws", async () => {
    vi.doMock("react-native", () => {
      throw new Error("not a React Native runtime");
    });

    const { warmDevHost } = await import("../transport/devHost.js");
    await expect(warmDevHost()).resolves.toEqual(["localhost"]);
  });

  it("getDevHostCandidates returns the fallback before warmDevHost resolves", async () => {
    const { getDevHostCandidates } = await import("../transport/devHost.js");
    expect(getDevHostCandidates()).toEqual(["localhost"]);
  });
});

describe("createDevHostResolver", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("react-native");
    vi.unstubAllGlobals();
  });

  it("an explicit string always wins, and never touches react-native", async () => {
    const rnFactory = vi.fn(() => ({ Platform: { OS: "ios" } }));
    vi.doMock("react-native", rnFactory);

    const { createDevHostResolver } = await import("../transport/devHost.js");
    const resolver = createDevHostResolver("10.1.2.3");

    expect(resolver.needsWarmUp).toBe(false);
    expect(resolver.next()).toBe("10.1.2.3");
    expect(resolver.next()).toBe("10.1.2.3");
    expect(rnFactory).not.toHaveBeenCalled();
  });

  it("an explicit function is re-invoked on every next()", async () => {
    const { createDevHostResolver } = await import("../transport/devHost.js");
    let calls = 0;
    const resolver = createDevHostResolver(() => `host-${++calls}`);

    expect(resolver.next()).toBe("host-1");
    expect(resolver.next()).toBe("host-2");
  });

  it("rotates through candidates and pin() freezes the last returned value", async () => {
    vi.doMock("react-native", () => ({
      NativeModules: { SourceCode: { scriptURL: "http://localhost:8081/index.bundle" } },
      Platform: { OS: "android" },
    }));

    const { createDevHostResolver, warmDevHost } = await import("../transport/devHost.js");
    await warmDevHost();
    const resolver = createDevHostResolver(undefined);

    expect(resolver.next()).toBe("localhost");
    expect(resolver.next()).toBe("10.0.2.2");
    resolver.pin();
    expect(resolver.next()).toBe("10.0.2.2");
    expect(resolver.next()).toBe("10.0.2.2");
  });

  it("needsWarmUp reflects whether the candidate cache has been filled", async () => {
    vi.doMock("react-native", () => ({
      NativeModules: { SourceCode: { scriptURL: "http://192.168.1.5:8081/index.bundle" } },
      Platform: { OS: "ios" },
    }));

    const { createDevHostResolver, warmDevHost } = await import("../transport/devHost.js");
    const resolver = createDevHostResolver(undefined);
    expect(resolver.needsWarmUp).toBe(true);

    await warmDevHost();
    expect(resolver.needsWarmUp).toBe(false);
  });
});
