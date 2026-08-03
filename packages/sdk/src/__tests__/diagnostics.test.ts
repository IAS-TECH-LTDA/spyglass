import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransportDiagnostic } from "../transport/ws.js";

describe("createDiagnostics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("logs the very first failed attempt", async () => {
    const warnSpy = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(warnSpy);

    const { createDiagnostics } = await import("../diagnostics.js");
    const diagnostics = createDiagnostics({ enabled: true });
    diagnostics.handle({ kind: "closed", url: "ws://localhost:8098", attempt: 1 });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("ws://localhost:8098");
  });

  it("throttles repeated failures to at most once per 30s", async () => {
    const warnSpy = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(warnSpy);

    const { createDiagnostics } = await import("../diagnostics.js");
    const diagnostics = createDiagnostics({ enabled: true });

    for (let attempt = 1; attempt <= 10; attempt++) {
      diagnostics.handle({ kind: "closed", url: "ws://localhost:8098", attempt });
      vi.advanceTimersByTime(10_000); // 10 events spaced 10s apart = 90s total
    }

    // attempt 1 (t=0), then every 30s: ~t=30s, ~t=60s, ~t=90s -> 4 logs, not 10.
    expect(warnSpy.mock.calls.length).toBeLessThan(10);
    expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("resets the throttle on a successful open", async () => {
    const warnSpy = vi.fn();
    const infoSpy = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(warnSpy);
    vi.spyOn(console, "info").mockImplementation(infoSpy);

    const { createDiagnostics } = await import("../diagnostics.js");
    const diagnostics = createDiagnostics({ enabled: true });

    diagnostics.handle({ kind: "closed", url: "ws://localhost:8098", attempt: 1 });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    diagnostics.handle({ kind: "open", url: "ws://localhost:8098" });
    expect(infoSpy).toHaveBeenCalledTimes(1);

    // Immediately after open, well within the 30s window — should still log
    // right away because `open` resets the throttle.
    diagnostics.handle({ kind: "closed", url: "ws://localhost:8098", attempt: 1 });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("never calls a patched console.warn — it captures the original at module load", async () => {
    // Simulate `attachConsole()` patching console.warn *after* diagnostics.ts
    // has already been imported/evaluated (which is always the real order —
    // see the comment in diagnostics.ts).
    const { createDiagnostics } = await import("../diagnostics.js");

    const patchedSpy = vi.fn();
    const originalWarn = console.warn;
    console.warn = patchedSpy;
    try {
      const diagnostics = createDiagnostics({ enabled: true });
      diagnostics.handle({ kind: "closed", url: "ws://localhost:8098", attempt: 1 });
      expect(patchedSpy).not.toHaveBeenCalled();
    } finally {
      console.warn = originalWarn;
    }
  });

  it("does not log anything when disabled", async () => {
    const warnSpy = vi.fn();
    const infoSpy = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(warnSpy);
    vi.spyOn(console, "info").mockImplementation(infoSpy);

    const { createDiagnostics } = await import("../diagnostics.js");
    const diagnostics = createDiagnostics({ enabled: false });
    const events: TransportDiagnostic[] = [
      { kind: "connecting", url: "ws://localhost:8098", attempt: 1 },
      { kind: "closed", url: "ws://localhost:8098", attempt: 1 },
      { kind: "open", url: "ws://localhost:8098" },
    ];
    for (const event of events) diagnostics.handle(event);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("defaults to enabled when __DEV__ is true", async () => {
    vi.stubGlobal("__DEV__", true);
    const { createDiagnostics } = await import("../diagnostics.js");
    expect(createDiagnostics().enabled).toBe(true);
  });

  it("defaults to disabled when __DEV__ is false", async () => {
    vi.stubGlobal("__DEV__", false);
    const { createDiagnostics } = await import("../diagnostics.js");
    expect(createDiagnostics().enabled).toBe(false);
  });

  it("an explicit `enabled: false` overrides __DEV__: true", async () => {
    vi.stubGlobal("__DEV__", true);
    const { createDiagnostics } = await import("../diagnostics.js");
    expect(createDiagnostics({ enabled: false }).enabled).toBe(false);
  });

  it("logResolvedHost logs once and only once", async () => {
    const infoSpy = vi.fn();
    vi.spyOn(console, "info").mockImplementation(infoSpy);

    const { createDiagnostics } = await import("../diagnostics.js");
    const diagnostics = createDiagnostics({ enabled: true });
    diagnostics.logResolvedHost("192.168.1.5");
    diagnostics.logResolvedHost("192.168.1.5");

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0]?.[0]).toContain("192.168.1.5");
  });
});
