import type { ReactNode } from "react";
import { useUiNotices } from "../state/uiNotices";
import { useT } from "../i18n";

/**
 * Dismissible explanation banner shown at the top of any screen that can
 * write back into the connected app (spec 0011) — Storage, Stores, Queries,
 * Memory. Reuses the visual language already established by the desktop's
 * auto-update banner (`.update-banner` in styles.css: same accent colors,
 * same padding/border-radius) under its own classes, since this is a
 * per-view, locally-instantiated notice, not a global one.
 *
 * Dismissing this does NOT remove the editable affordance itself — pair
 * this with a `.live-edit-accent` border on the editable container so the
 * screen still visibly reads as "editable" after the explanation is
 * dismissed (see StorageView/StoresView/QueriesView/MemoryPanel).
 */
export function LiveEditBanner({ noticeId, children }: { noticeId: string; children: ReactNode }) {
  const { t } = useT();
  const dismissed = useUiNotices((s) => s.isDismissed(noticeId));
  const dismiss = useUiNotices((s) => s.dismiss);

  if (dismissed) return null;

  return (
    <div className="live-edit-banner">
      <span>{children}</span>
      <button
        type="button"
        className="live-edit-banner-dismiss"
        onClick={() => dismiss(noticeId)}
        aria-label={t("liveEditBanner.dismissAria")}
        title={t("liveEditBanner.dismissAria")}
      >
        ×
      </button>
    </div>
  );
}
