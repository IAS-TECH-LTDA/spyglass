import type { AnyEnvelope } from "spyglass-protocol";
import { useAlertSettings } from "../state/alertSettings";
import { useConnectionStore } from "../state/connection";
import { appAlertKey, classifyEnvelope, formatAlert, RateLimiter, shouldAlert } from "./alerts";
import { sendAlertNotification } from "./alertNotification";
import { playAlertSound, primeAudio } from "./alertSound";

const SOUND_MIN_INTERVAL_MS = 3_000;
const NOTIFICATION_MIN_INTERVAL_MS = 10_000;

// Global, not per-app — two apps in a crash loop at once shouldn't double
// the effective rate. The "+N more" count in a notification can therefore
// span apps while its title names one; that's an acceptable, documented
// tradeoff for keeping this simple.
const soundLimiter = new RateLimiter(SOUND_MIN_INTERVAL_MS);
const notifyLimiter = new RateLimiter(NOTIFICATION_MIN_INTERVAL_MS);

/** Call once on mount, alongside the other IPC subscriptions in `App.tsx`. */
export function primeAlerts(): void {
  primeAudio();
}

/**
 * The one impure module in the alerts feature — reads both stores via
 * `getState()` (non-reactive; this is an event handler, not a component)
 * and reaches into the DOM (sound) and Tauri (notification).
 *
 * MUST only ever be called for *live* envelopes (`App.tsx`'s `onMessage`),
 * never for cached/replayed ones (`hydrateFromCache`). The desktop's Rust
 * side caches the latest envelope per `(appId, type)` and replays it on
 * every reconnect/reload — wiring this into that path would re-fire sound
 * and a native notification for a stale error every time the frontend
 * reloads. See spec 0005's "achado crítico".
 */
export function handleEnvelopeForAlerts(envelope: AnyEnvelope): void {
  const trigger = classifyEnvelope(envelope);
  if (!trigger) return;

  const connection = useConnectionStore.getState();
  const app = connection.apps[trigger.appId];
  const appName = app?.appName ?? trigger.appId;
  const platform = app?.platform ?? "unknown";
  const appKey = appAlertKey(appName, platform);

  const settings = useAlertSettings.getState();
  if (!shouldAlert(trigger, settings, appKey)) return;

  // Always recorded — the badge is a plain counter and should be accurate,
  // independent of the rate limits below (those only govern sound/notification).
  connection.recordAlert(trigger.appId, trigger.kind);

  const now = Date.now();

  if (settings.sound) {
    const { allow } = soundLimiter.tryTake(now);
    if (allow) playAlertSound();
  }

  if (settings.nativeNotification) {
    const { allow, suppressed } = notifyLimiter.tryTake(now);
    if (allow) {
      // The response payload carries no URL/method of its own — look up the
      // matching NetworkEntry, which the store has already folded in by now.
      const url =
        trigger.kind === "network"
          ? connection.data[trigger.appId]?.network.find((entry) => entry.requestId === trigger.requestId)?.url
          : undefined;
      const { title, body } = formatAlert(trigger, appName, suppressed, url);
      void sendAlertNotification(title, body);
    }
  }
}
