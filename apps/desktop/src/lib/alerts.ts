import type { AnyEnvelope, LogLevel } from "spyglass-protocol";
import { t } from "../i18n";

export type AlertKind = "log" | "network";

export interface AlertTrigger {
  kind: AlertKind;
  appId: string;
  /** Present only when `kind === "log"`. */
  level?: LogLevel;
  /** Present only when `kind === "network"` — used to look up the matching `NetworkEntry` (for its URL) in the connection store. */
  requestId?: string;
  /** Short one-line detail for the notification body, already truncated. */
  detail: string;
}

const DETAIL_MAX_LENGTH = 120;

function truncate(text: string): string {
  return text.length > DETAIL_MAX_LENGTH ? `${text.slice(0, DETAIL_MAX_LENGTH - 1)}…` : text;
}

/**
 * Per-app mute/settings key. Deliberately NOT `appId` — the SDK mints a
 * fresh random `appId` on every `init()` call, so a hot-restart of the
 * target app would silently un-mute it. Mirrors the identity `upsertApp`
 * already uses to collapse a reconnecting app onto its existing pill
 * (`state/connection.ts`). `platform` never contains `":"`, so this
 * separator is unambiguous.
 */
export function appAlertKey(appName: string, platform: string): string {
  return `${appName}:${platform}`;
}

/**
 * Did this *concluded* response fail? Mirrors `NetworkView`'s `statusClass`
 * rules, but for a different input domain — deliberately not reused as-is.
 * `NetworkView.tsx#statusClass` operates on a `NetworkEntry`, which can
 * still be in flight (`status === undefined` there means "no response yet,
 * not necessarily a failure"). Here the response has already arrived (this
 * is a `NetworkResponsePayload`), so an absent `status` always means the
 * request failed before any response was received (network error, timeout
 * — see the payload's own doc comment in `packages/protocol/src/types.ts`).
 */
export function isFailedResponse(payload: { status?: number; ok?: boolean; error?: string }): boolean {
  if (payload.error) return true;
  if (payload.status === undefined) return true;
  if (payload.ok !== undefined) return !payload.ok;
  return payload.status >= 400;
}

/** Envelope -> trigger, or `null` if this envelope can never be alert-worthy. Gating by user settings is `shouldAlert`'s job, not this function's. */
export function classifyEnvelope(envelope: AnyEnvelope): AlertTrigger | null {
  switch (envelope.type) {
    case "log/entry": {
      const { level, message } = envelope.payload;
      if (level !== "warn" && level !== "error") return null;
      return { kind: "log", appId: envelope.appId, level, detail: truncate(message) };
    }
    case "network/response": {
      const payload = envelope.payload;
      if (!isFailedResponse(payload)) return null;
      const detail = truncate(`${payload.status ?? "failed"} · ${payload.error ?? payload.statusText ?? t("alerts.requestFailed")}`);
      return { kind: "network", appId: envelope.appId, requestId: payload.requestId, detail };
    }
    default:
      return null;
  }
}

export interface AlertSettingsShape {
  muted: boolean;
  levels: Record<"warn" | "error", boolean>;
  network: boolean;
  mutedApps: Record<string, true>;
}

/** Do the user's settings permit this trigger to alert at all (any channel)? */
export function shouldAlert(trigger: AlertTrigger, settings: AlertSettingsShape, appKey: string): boolean {
  if (settings.muted) return false;
  if (settings.mutedApps[appKey]) return false;
  if (trigger.kind === "network") return settings.network;
  return settings.levels[trigger.level as "warn" | "error"];
}

/** Notification title/body, with an optional "+N more" suffix from the rate limiter. */
export function formatAlert(
  trigger: AlertTrigger,
  appName: string,
  suppressed: number,
  url?: string,
): { title: string; body: string } {
  const title =
    trigger.kind === "log" ? t("alerts.logTitle", { app: appName, level: trigger.level ?? "" }) : t("alerts.networkTitle", { app: appName });
  const detail = trigger.kind === "network" && url ? `${trigger.detail} · ${url}` : trigger.detail;
  const body = suppressed > 0 ? `${detail}\n${t("alerts.moreSinceLast", { count: suppressed })}` : detail;
  return { title, body };
}

/**
 * Global min-interval gate: at most one `allow: true` per `intervalMs`.
 * `tryTake` reports how many calls were swallowed since the last allowed
 * one, so the caller can say "+N more". Clock is a parameter, not
 * `Date.now()`, so tests never depend on real time.
 */
export class RateLimiter {
  private lastAllowedAt: number | null = null;
  private suppressedSinceLastAllow = 0;

  constructor(private readonly intervalMs: number) {}

  tryTake(now: number): { allow: boolean; suppressed: number } {
    if (this.lastAllowedAt === null || now - this.lastAllowedAt >= this.intervalMs) {
      const suppressed = this.suppressedSinceLastAllow;
      this.lastAllowedAt = now;
      this.suppressedSinceLastAllow = 0;
      return { allow: true, suppressed };
    }
    this.suppressedSinceLastAllow++;
    return { allow: false, suppressed: this.suppressedSinceLastAllow };
  }
}
