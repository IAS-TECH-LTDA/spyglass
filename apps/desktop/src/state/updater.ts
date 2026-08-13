import { create } from "zustand";
import { persist } from "zustand/middleware";
import { checkForUpdate, downloadUpdate, installAndRelaunch, type DownloadProgress } from "../lib/updater";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

interface UpdaterState {
  status: UpdateStatus;
  version: string | null;
  notes: string | null;
  /** 0-1, or null before the download reports a content length. */
  progress: number | null;
  /** Persisted so "Later" means later-for-this-version, not later-until-restart — see spec. */
  dismissedVersion: string | null;

  runCheck(): Promise<void>;
  download(): Promise<void>;
  restart(): Promise<void>;
  dismiss(): void;
}

/**
 * `dismissedVersion` is the only persisted field (see `partialize` below) —
 * everything else is transient session state that shouldn't survive a
 * reload with a stale "downloading" status stuck on screen.
 */
export const useUpdaterStore = create<UpdaterState>()(
  persist(
    (set, get) => ({
      status: "idle",
      version: null,
      notes: null,
      progress: null,
      dismissedVersion: null,

      async runCheck() {
        if (get().status === "checking" || get().status === "downloading") return;
        set({ status: "checking" });
        const update = await checkForUpdate();
        if (!update) {
          set({ status: "idle", version: null, notes: null });
          return;
        }
        set({ status: "available", version: update.version, notes: update.notes, progress: null });
      },

      async download() {
        if (get().status !== "available") return;
        set({ status: "downloading", progress: null });
        try {
          await downloadUpdate((p: DownloadProgress) => {
            set({ progress: p.contentLength ? p.downloaded / p.contentLength : null });
          });
          set({ status: "ready" });
        } catch {
          // Distinct state (not back to "available") so the banner can
          // offer a retry instead of silently reverting — this path only
          // runs after the user explicitly clicked "Update".
          set({ status: "error" });
        }
      },

      async restart() {
        if (get().status !== "ready") return;
        // No local state update on success — the app relaunches out from
        // under this store before there'd be anything left to render.
        await installAndRelaunch();
      },

      dismiss() {
        const { version } = get();
        set({ status: "idle", dismissedVersion: version });
      },
    }),
    {
      name: "dm:updater",
      version: 1,
      partialize: (s) => ({ dismissedVersion: s.dismissedVersion }),
    },
  ),
);
