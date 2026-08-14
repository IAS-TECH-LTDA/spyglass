import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useRef, useState } from "react";
import { appAlertKey } from "../lib/alerts";
import { openIasTechSite, openRepoLink } from "../lib/externalLinks";
import { useAlertSettings } from "../state/alertSettings";
import { useConnectionStore } from "../state/connection";
import { useLocaleStore, type Locale } from "../state/locale";
import { useT, type TranslationKey } from "../i18n";

const LEVEL_META: Record<"error" | "warn", { labelKey: TranslationKey; color: string }> = {
  error: { labelKey: "settings.level.error", color: "var(--red)" },
  warn: { labelKey: "settings.level.warn", color: "#facc15" },
};

const LANGUAGES: Array<{ id: Locale; labelKey: TranslationKey }> = [
  { id: "en", labelKey: "settings.language.english" },
  { id: "pt", labelKey: "settings.language.portuguese" },
];

interface AppRow {
  key: string;
  label: string;
  platform?: string;
}

/**
 * Gear popover in the topbar — settings for the whole app. Started out as
 * just the alerts feature's settings (hence the file used to be named
 * `AlertSettingsPanel`); the language picker (spec 0012) made it the app's
 * one general Settings entry point, so it was renamed and Language became
 * its first section.
 */
export function SettingsPanel() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    void getVersion().then(setVersion);
  }, []);

  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  const muted = useAlertSettings((s) => s.muted);
  const levels = useAlertSettings((s) => s.levels);
  const network = useAlertSettings((s) => s.network);
  const sound = useAlertSettings((s) => s.sound);
  const nativeNotification = useAlertSettings((s) => s.nativeNotification);
  const mutedApps = useAlertSettings((s) => s.mutedApps);
  const notificationPermission = useAlertSettings((s) => s.notificationPermission);
  const setMuted = useAlertSettings((s) => s.setMuted);
  const toggleLevel = useAlertSettings((s) => s.toggleLevel);
  const setNetwork = useAlertSettings((s) => s.setNetwork);
  const setSound = useAlertSettings((s) => s.setSound);
  const setNativeNotification = useAlertSettings((s) => s.setNativeNotification);
  const toggleAppMute = useAlertSettings((s) => s.toggleAppMute);
  const resetNotificationPermission = useAlertSettings((s) => s.resetNotificationPermission);

  const apps = useConnectionStore((s) => s.apps);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Every connected app, plus any muted key that isn't currently connected —
  // so a dev can un-mute an app that isn't running right now.
  const connectedKeys = new Set(Object.values(apps).map((a) => appAlertKey(a.appName, a.platform)));
  const rows: AppRow[] = [
    ...Object.values(apps).map((a) => ({ key: appAlertKey(a.appName, a.platform), label: a.appName, platform: a.platform })),
    ...Object.keys(mutedApps)
      .filter((key) => !connectedKeys.has(key))
      .map((key) => ({ key, label: key.split(":")[0] ?? key, platform: key.split(":")[1] })),
  ];

  return (
    <div className="alerts-anchor" ref={anchorRef}>
      <button type="button" className="icon-btn" title={t("settings.title")} aria-label={t("settings.title")} onClick={() => setOpen((v) => !v)}>
        <GearIcon />
      </button>
      {open && (
        <div className="alerts-popover">
          <div className="alerts-popover-section">
            <span>{t("settings.language")}</span>
            <div className="alerts-chip-row">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.id}
                  type="button"
                  className={`storage-chip ${locale === lang.id ? "active" : ""}`}
                  style={{ "--chip-color": "var(--accent)" } as React.CSSProperties}
                  onClick={() => setLocale(lang.id)}
                >
                  {t(lang.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="alerts-popover-section">
            <span>{t("settings.alerts")}</span>
            <div className="alerts-chip-row">
              <button
                type="button"
                className={`storage-chip ${!muted ? "active" : ""}`}
                style={{ "--chip-color": muted ? "var(--red)" : "var(--green)" } as React.CSSProperties}
                onClick={() => setMuted(!muted)}
              >
                {muted ? t("settings.alerts.muted") : t("settings.alerts.on")}
              </button>
            </div>
          </div>

          <div className="alerts-popover-section">
            <span>{t("settings.triggerOn")}</span>
            <div className="alerts-chip-row">
              {(["error", "warn"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`storage-chip ${levels[level] ? "active" : ""}`}
                  style={{ "--chip-color": LEVEL_META[level].color } as React.CSSProperties}
                  onClick={() => toggleLevel(level)}
                >
                  {t(LEVEL_META[level].labelKey)}
                </button>
              ))}
              <button
                type="button"
                className={`storage-chip ${network ? "active" : ""}`}
                style={{ "--chip-color": "var(--accent)" } as React.CSSProperties}
                onClick={() => setNetwork(!network)}
              >
                {t("settings.networkFailures")}
              </button>
            </div>
          </div>

          <div className="alerts-popover-section">
            <span>{t("settings.notifyWith")}</span>
            <div className="alerts-chip-row">
              <button
                type="button"
                className={`storage-chip ${sound ? "active" : ""}`}
                style={{ "--chip-color": "var(--accent)" } as React.CSSProperties}
                onClick={() => setSound(!sound)}
              >
                {t("settings.sound")}
              </button>
              <button
                type="button"
                className={`storage-chip ${nativeNotification ? "active" : ""}`}
                style={{ "--chip-color": "var(--accent)" } as React.CSSProperties}
                onClick={() => setNativeNotification(!nativeNotification)}
              >
                {t("settings.macNotification")}
              </button>
            </div>
            {notificationPermission === "denied" && (
              <p className="empty-hint">
                {t("settings.notificationBlocked")}{" "}
                <button type="button" className="icon-btn alerts-retry-btn" onClick={() => resetNotificationPermission()}>
                  {t("settings.tryAgain")}
                </button>
              </p>
            )}
          </div>

          <div className="alerts-popover-section">
            <span>{t("settings.apps")}</span>
            {rows.length === 0 && <p className="empty-hint">{t("settings.noAppsYet")}</p>}
            {rows.map((row) => (
              <div key={row.key} className="alerts-app-row">
                <span>
                  {row.label} {row.platform && <small>{row.platform}</small>}
                </span>
                <button
                  type="button"
                  className={`storage-chip ${!mutedApps[row.key] ? "active" : ""}`}
                  style={{ "--chip-color": mutedApps[row.key] ? "var(--red)" : "var(--green)" } as React.CSSProperties}
                  onClick={() => toggleAppMute(row.key)}
                >
                  {mutedApps[row.key] ? t("settings.alerts.muted") : t("settings.alerts.on")}
                </button>
              </div>
            ))}
          </div>

          <p className="settings-version">
            {version && <>{t("settings.version", { version })} · </>}
            <button type="button" className="text-link" onClick={openRepoLink}>
              {t("common.repoLink")}
            </button>
          </p>

          <button type="button" className="settings-brand" onClick={openIasTechSite} title={t("settings.madeBy")}>
            <span>{t("settings.madeBy")}</span>
            <img src="/iastech-logo.png" alt="IASTech" className="settings-brand-logo" />
          </button>
        </div>
      )}
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.5v1.3M8 13.2v1.3M14.5 8h-1.3M2.8 8H1.5M12.5 3.5l-.9.9M4.4 11.6l-.9.9M12.5 12.5l-.9-.9M4.4 4.4l-.9-.9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
