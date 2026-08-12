import { describe, expect, it } from "vitest";
import type { AnyEnvelope } from "spyglass-protocol";
import { appAlertKey, classifyEnvelope, formatAlert, isFailedResponse, RateLimiter, shouldAlert } from "../alerts.js";

describe("isFailedResponse", () => {
  it("a successful response is not a failure", () => {
    expect(isFailedResponse({ status: 200, ok: true })).toBe(false);
  });

  it("a 4xx with ok:false is a failure", () => {
    expect(isFailedResponse({ status: 404, ok: false })).toBe(true);
  });

  it("a status >=400 with no explicit ok is a failure", () => {
    expect(isFailedResponse({ status: 500 })).toBe(true);
  });

  it("ok:false wins even for a 2xx-looking status (trust the SDK)", () => {
    expect(isFailedResponse({ status: 301, ok: false })).toBe(true);
  });

  it("an explicit transport error is a failure", () => {
    expect(isFailedResponse({ error: "Network request failed" })).toBe(true);
  });

  it("no status, no error, no ok is still a failure — transport failure, not 'in flight' (this payload is always concluded)", () => {
    expect(isFailedResponse({})).toBe(true);
  });
});

describe("classifyEnvelope", () => {
  function logEnvelope(level: "log" | "info" | "warn" | "error" | "debug"): AnyEnvelope {
    return {
      v: 1,
      type: "log/entry",
      appId: "app-1",
      ts: 0,
      payload: { level, message: "boom", args: [] },
    } as AnyEnvelope;
  }

  function networkResponseEnvelope(payload: Partial<{ status: number; ok: boolean; error: string; statusText: string }>): AnyEnvelope {
    return {
      v: 1,
      type: "network/response",
      appId: "app-1",
      ts: 0,
      payload: { requestId: "req-1", durationMs: 12, ...payload },
    } as AnyEnvelope;
  }

  it("classifies a log/entry at level error", () => {
    expect(classifyEnvelope(logEnvelope("error"))).toEqual(
      expect.objectContaining({ kind: "log", level: "error", appId: "app-1" }),
    );
  });

  it("classifies a log/entry at level warn", () => {
    // Gating on whether warn actually alerts is shouldAlert's job, not this function's.
    expect(classifyEnvelope(logEnvelope("warn"))).toEqual(expect.objectContaining({ kind: "log", level: "warn" }));
  });

  it("does not classify log/info, log/log, or log/debug", () => {
    expect(classifyEnvelope(logEnvelope("info"))).toBeNull();
    expect(classifyEnvelope(logEnvelope("log"))).toBeNull();
    expect(classifyEnvelope(logEnvelope("debug"))).toBeNull();
  });

  it("classifies a failed network/response", () => {
    expect(classifyEnvelope(networkResponseEnvelope({ status: 500, ok: false }))).toEqual(
      expect.objectContaining({ kind: "network", requestId: "req-1" }),
    );
  });

  it("does not classify a successful network/response", () => {
    expect(classifyEnvelope(networkResponseEnvelope({ status: 200, ok: true }))).toBeNull();
  });

  it("does not classify a network/request (no verdict yet)", () => {
    const envelope = {
      v: 1,
      type: "network/request",
      appId: "app-1",
      ts: 0,
      payload: { requestId: "req-1", method: "GET", url: "https://x" },
    } as AnyEnvelope;
    expect(classifyEnvelope(envelope)).toBeNull();
  });

  it("does not classify unrelated envelope types", () => {
    const envelope = { v: 1, type: "ping", appId: "app-1", ts: 0, payload: { seq: 1 } } as AnyEnvelope;
    expect(classifyEnvelope(envelope)).toBeNull();
  });
});

describe("shouldAlert", () => {
  const baseSettings = { muted: false, levels: { error: true, warn: false }, network: true, mutedApps: {} };

  it("a global mute blocks everything", () => {
    const trigger = { kind: "log" as const, appId: "a", level: "error" as const, detail: "x" };
    expect(shouldAlert(trigger, { ...baseSettings, muted: true }, "App:ios")).toBe(false);
  });

  it("levels.warn:false blocks a warn trigger", () => {
    const trigger = { kind: "log" as const, appId: "a", level: "warn" as const, detail: "x" };
    expect(shouldAlert(trigger, baseSettings, "App:ios")).toBe(false);
  });

  it("levels.error:true passes an error trigger", () => {
    const trigger = { kind: "log" as const, appId: "a", level: "error" as const, detail: "x" };
    expect(shouldAlert(trigger, baseSettings, "App:ios")).toBe(true);
  });

  it("network:false blocks a network trigger", () => {
    const trigger = { kind: "network" as const, appId: "a", detail: "x" };
    expect(shouldAlert(trigger, { ...baseSettings, network: false }, "App:ios")).toBe(false);
  });

  it("a muted app blocks even an otherwise-allowed trigger", () => {
    const trigger = { kind: "log" as const, appId: "a", level: "error" as const, detail: "x" };
    expect(shouldAlert(trigger, { ...baseSettings, mutedApps: { "App:ios": true } }, "App:ios")).toBe(false);
  });

  it("an app key not present in mutedApps is not muted", () => {
    const trigger = { kind: "log" as const, appId: "a", level: "error" as const, detail: "x" };
    expect(shouldAlert(trigger, { ...baseSettings, mutedApps: { "Other:android": true } }, "App:ios")).toBe(true);
  });
});

describe("appAlertKey", () => {
  it("is stable across different appIds for the same (name, platform) — the reconnect invariant", () => {
    expect(appAlertKey("MyApp", "ios")).toBe(appAlertKey("MyApp", "ios"));
  });

  it("differs across platforms for the same app name", () => {
    expect(appAlertKey("MyApp", "ios")).not.toBe(appAlertKey("MyApp", "android"));
  });
});

describe("formatAlert", () => {
  it("includes the suppressed count when present", () => {
    const trigger = { kind: "log" as const, appId: "a", level: "error" as const, detail: "boom" };
    const { body } = formatAlert(trigger, "MyApp", 3);
    expect(body).toContain("+3 more");
  });

  it("omits the suppressed suffix when zero", () => {
    const trigger = { kind: "log" as const, appId: "a", level: "error" as const, detail: "boom" };
    const { body } = formatAlert(trigger, "MyApp", 0);
    expect(body).not.toContain("more");
  });

  it("appends the URL for a network trigger when provided", () => {
    const trigger = { kind: "network" as const, appId: "a", detail: "500 · failed" };
    const { body } = formatAlert(trigger, "MyApp", 0, "https://api.example.com/x");
    expect(body).toContain("https://api.example.com/x");
  });
});

describe("RateLimiter", () => {
  it("allows the first call with zero suppressed", () => {
    const limiter = new RateLimiter(1000);
    expect(limiter.tryTake(0)).toEqual({ allow: true, suppressed: 0 });
  });

  it("blocks calls inside the window and counts them", () => {
    const limiter = new RateLimiter(1000);
    limiter.tryTake(0);
    expect(limiter.tryTake(100)).toEqual({ allow: false, suppressed: 1 });
    expect(limiter.tryTake(200)).toEqual({ allow: false, suppressed: 2 });
  });

  it("allows again after the window and reports how many were suppressed", () => {
    const limiter = new RateLimiter(1000);
    limiter.tryTake(0);
    limiter.tryTake(100);
    limiter.tryTake(200);
    expect(limiter.tryTake(1000)).toEqual({ allow: true, suppressed: 2 });
  });

  it("resets the suppressed count after an allowed call", () => {
    const limiter = new RateLimiter(1000);
    limiter.tryTake(0);
    limiter.tryTake(100); // suppressed
    limiter.tryTake(1000); // allowed, suppressed reported as 1, then reset
    expect(limiter.tryTake(1100)).toEqual({ allow: false, suppressed: 1 });
  });
});
