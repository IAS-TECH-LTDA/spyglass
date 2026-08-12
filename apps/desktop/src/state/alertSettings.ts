import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * One trigger matrix (`muted`/`levels`/`network`/`mutedApps`) applied
 * uniformly to all three alert channels, plus two independent channel
 * switches (`sound`, `nativeNotification`). The badge has no channel switch
 * of its own — it's the free, non-intrusive channel; muting it specifically
 * would just be `muted`. Deliberately not a per-channel × per-trigger
 * matrix: the actual v1 trigger scope is two things (log errors, network
 * failures), so a 3-channel × N-trigger grid would just be more toggles for
 * the same two decisions.
 */
export interface AlertSettings {
  /** Master kill switch. Suppresses badge, sound and native notification alike. */
  muted: boolean;
  /** Which log levels alert. `error` on by default; `warn` off — see spec 0005's v1 scope. */
  levels: Record<"warn" | "error", boolean>;
  /** Alert on failed network responses (status >=400 or a transport failure). */
  network: boolean;
  /** Channel switch: play a sound. */
  sound: boolean;
  /** Channel switch: post a native macOS notification. */
  nativeNotification: boolean;
  /** Silenced apps, keyed by `appAlertKey(appName, platform)` (see `lib/alerts.ts`). Only muted apps are stored, so an unknown app defaults to un-muted. */
  mutedApps: Record<string, true>;
  /** Remembered outcome of the OS permission request, so it isn't re-asked every launch. */
  notificationPermission: "unknown" | "granted" | "denied";
}

interface AlertSettingsState extends AlertSettings {
  setMuted(muted: boolean): void;
  toggleLevel(level: "warn" | "error"): void;
  setNetwork(enabled: boolean): void;
  setSound(enabled: boolean): void;
  setNativeNotification(enabled: boolean): void;
  toggleAppMute(appKey: string): void;
  setNotificationPermission(permission: AlertSettings["notificationPermission"]): void;
  resetNotificationPermission(): void;
}

const DEFAULTS: AlertSettings = {
  muted: false,
  levels: { error: true, warn: false },
  network: true,
  sound: true,
  nativeNotification: true,
  mutedApps: {},
  notificationPermission: "unknown",
};

/**
 * Persisted via `zustand/middleware`'s `persist` rather than a hand-rolled
 * `localStorage` module (the only precedent, `lib/useResizableWidth.ts`, is
 * a single scalar read once per view — this is a nested object read
 * reactively by two independent consumers, the settings panel and the
 * alert runner). `zustand` is already a dependency; no new package.
 */
export const useAlertSettings = create<AlertSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      setMuted(muted) {
        set({ muted });
      },

      toggleLevel(level) {
        set((s) => ({ levels: { ...s.levels, [level]: !s.levels[level] } }));
      },

      setNetwork(enabled) {
        set({ network: enabled });
      },

      setSound(enabled) {
        set({ sound: enabled });
      },

      setNativeNotification(enabled) {
        set({ nativeNotification: enabled });
      },

      toggleAppMute(appKey) {
        set((s) => {
          if (s.mutedApps[appKey]) {
            const { [appKey]: _removed, ...rest } = s.mutedApps;
            return { mutedApps: rest };
          }
          return { mutedApps: { ...s.mutedApps, [appKey]: true } };
        });
      },

      setNotificationPermission(permission) {
        set({ notificationPermission: permission });
      },

      resetNotificationPermission() {
        set({ notificationPermission: "unknown" });
      },
    }),
    { name: "dm:alert-settings", version: 1 },
  ),
);
