import { useUpdaterStore } from "../state/updater";
import { useT } from "../i18n";

/**
 * Non-blocking strip above the topbar, not a modal and not a tray menu item
 * — Spyglass typically sits in the background while the dev debugs a
 * separate RN app/simulator, so stealing focus with a modal (possibly the
 * instant a log the dev is watching comes in) would be hostile to the
 * exact workflow the app exists to support. The tray icon today has no
 * menu and left-click just focuses the window (see `main.rs`); giving it
 * an update entry would change that click behavior for no real gain here.
 */
export function UpdateBanner() {
  const { t } = useT();
  const status = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.version);
  const notes = useUpdaterStore((s) => s.notes);
  const progress = useUpdaterStore((s) => s.progress);
  const dismissedVersion = useUpdaterStore((s) => s.dismissedVersion);
  const download = useUpdaterStore((s) => s.download);
  const restart = useUpdaterStore((s) => s.restart);
  const dismiss = useUpdaterStore((s) => s.dismiss);
  const runCheck = useUpdaterStore((s) => s.runCheck);

  if (status === "idle" || status === "checking") return null;
  if (status === "available" && version === dismissedVersion) return null;

  return (
    <div className="update-banner">
      {status === "available" && (
        <>
          <span>
            {t("update.available", { version: version ?? "" })}
            {/* Release notes come from the `latest.json` payload over IPC, never
                fetched from the webview — rendered as plain text on purpose,
                never dangerouslySetInnerHTML, since this string originates
                on the network. */}
            {notes && <span className="update-banner-notes">{notes}</span>}
          </span>
          <div className="update-banner-actions">
            <button type="button" className="update-banner-btn update-banner-btn-primary" onClick={() => void download()}>
              {t("update.updateBtn")}
            </button>
            <button type="button" className="update-banner-btn" onClick={dismiss}>
              {t("update.later")}
            </button>
          </div>
        </>
      )}

      {status === "downloading" && (
        <>
          <span>{t("update.downloading", { version: version ?? "" })}</span>
          <div className="update-banner-progress-track">
            <div
              className="update-banner-progress-fill"
              style={{ width: progress != null ? `${Math.round(progress * 100)}%` : "30%" }}
            />
          </div>
        </>
      )}

      {status === "ready" && (
        <>
          <span>{t("update.ready", { version: version ?? "" })}</span>
          <div className="update-banner-actions">
            <button type="button" className="update-banner-btn update-banner-btn-primary" onClick={() => void restart()}>
              {t("update.restartNow")}
            </button>
          </div>
        </>
      )}

      {status === "error" && (
        <>
          <span>{t("update.error", { version: version ?? "" })}</span>
          <div className="update-banner-actions">
            <button type="button" className="update-banner-btn update-banner-btn-primary" onClick={() => void runCheck()}>
              {t("update.tryAgain")}
            </button>
            <button type="button" className="update-banner-btn" onClick={dismiss}>
              {t("update.dismiss")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
