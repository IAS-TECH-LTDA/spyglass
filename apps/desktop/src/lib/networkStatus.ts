import type { NetworkEntry } from "../state/connection";

/**
 * One classification shared by the status pill's color (`NetworkView`) and
 * the status filter chips, so a request can never be painted red but
 * excluded by the "errors" filter, or vice versa.
 *
 * Deliberately *not* `alerts.ts#isFailedResponse` — that one reads a
 * concluded `NetworkResponsePayload`, where an absent `status` always means
 * the request failed before a response arrived. Here the input is a
 * `NetworkEntry`, which can still be in flight — an absent `status` there
 * means "no response yet, not necessarily a failure" — so `"pending"` has
 * to be its own bucket, distinct from `"failed"`.
 */
export type StatusBucket = "pending" | "ok" | "client" | "server" | "failed";

export function statusBucket(entry: NetworkEntry): StatusBucket {
  if (entry.error) return "failed"; // network error/timeout — never got a response
  if (entry.status === undefined) return "pending";
  if (entry.status >= 500) return "server";
  if (entry.status >= 400) return "client";
  if (entry.ok === false) return "client"; // 3xx flagged !ok by the XHR patch — already painted red today
  return "ok";
}

/** Only three visual buckets today — `client`/`server`/`failed` all read the same as `status-error`. */
export function statusClass(entry: NetworkEntry): string {
  const bucket = statusBucket(entry);
  if (bucket === "ok") return "status-ok";
  if (bucket === "pending") return "status-pending";
  return "status-error";
}

export function statusLabel(entry: NetworkEntry): string {
  if (entry.error) return "ERR";
  if (entry.status === undefined) return "…";
  return String(entry.status);
}
