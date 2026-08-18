import { describe, expect, it } from "vitest";
import type { NetworkEntry } from "../../state/connection.js";
import { statusBucket, statusClass, statusLabel } from "../networkStatus.js";

function entry(overrides: Partial<NetworkEntry> = {}): NetworkEntry {
  return { requestId: "r1", method: "GET", url: "https://example.com", startedAt: 0, ...overrides };
}

describe("statusBucket", () => {
  it("in-flight (no status, no error) is pending", () => {
    expect(statusBucket(entry())).toBe("pending");
  });

  it("a successful response is ok", () => {
    expect(statusBucket(entry({ status: 200, ok: true }))).toBe("ok");
  });

  it("a 404 is a client error", () => {
    expect(statusBucket(entry({ status: 404, ok: false }))).toBe("client");
  });

  it("a 500 is a server error", () => {
    expect(statusBucket(entry({ status: 500, ok: false }))).toBe("server");
  });

  it("ok:false on a 3xx status (the XHR patch's redirect handling) is a client error, not ok", () => {
    expect(statusBucket(entry({ status: 301, ok: false }))).toBe("client");
  });

  it("a network error with no status is failed, not pending", () => {
    expect(statusBucket(entry({ error: "Network request failed" }))).toBe("failed");
  });

  it("an orphaned response entry (method/url unknown, but status/error present) is still classified by its status", () => {
    expect(statusBucket(entry({ method: "?", url: "?", status: 500, ok: false }))).toBe("server");
  });
});

describe("statusClass/statusLabel", () => {
  it("pending renders as status-pending / an ellipsis", () => {
    const e = entry();
    expect(statusClass(e)).toBe("status-pending");
    expect(statusLabel(e)).toBe("…");
  });

  it("ok renders as status-ok / the numeric status", () => {
    const e = entry({ status: 200, ok: true });
    expect(statusClass(e)).toBe("status-ok");
    expect(statusLabel(e)).toBe("200");
  });

  it("client, server and failed all render as status-error", () => {
    expect(statusClass(entry({ status: 404, ok: false }))).toBe("status-error");
    expect(statusClass(entry({ status: 500, ok: false }))).toBe("status-error");
    expect(statusClass(entry({ error: "timeout" }))).toBe("status-error");
  });

  it("a network error labels as ERR even if it somehow also carried a status", () => {
    expect(statusLabel(entry({ error: "timeout" }))).toBe("ERR");
  });
});
