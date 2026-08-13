import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Dismissal state for `LiveEditBanner` instances (spec 0011) — keyed by a
 * free-form `noticeId` per view (`"storage-edit"`, `"stores-edit"`,
 * `"queries-edit"`, `"memory-clear-cache"`), so dismissing the banner on
 * one editable screen doesn't hide it on another. Persisted so a dismissed
 * banner stays dismissed across app restarts; unlike pending-write state,
 * this has no reason to ever expire on its own.
 */
interface UiNoticesState {
  dismissed: Record<string, true>;
  dismiss(noticeId: string): void;
  isDismissed(noticeId: string): boolean;
}

export const useUiNotices = create<UiNoticesState>()(
  persist(
    (set, get) => ({
      dismissed: {},
      dismiss(noticeId) {
        set((s) => ({ dismissed: { ...s.dismissed, [noticeId]: true } }));
      },
      isDismissed(noticeId) {
        return get().dismissed[noticeId] === true;
      },
    }),
    { name: "dm:ui-notices", version: 1 },
  ),
);
