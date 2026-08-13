/**
 * Wrapper over `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process`.
 * Lives in `lib/`, not `ipc.ts` — `ipc.ts` is reserved for this app's own
 * Rust commands (see its module doc comment); third-party plugin API is
 * consumed here directly, same as `lib/alertNotification.ts` does with
 * `@tauri-apps/plugin-notification`.
 *
 * `checkForUpdate` degrades silently on failure, exactly like
 * `alertNotification.ts`: no GitHub release yet, no network, a malformed
 * `latest.json`, dev mode with no valid endpoint — none of that may ever
 * surface as an error to the caller or break the UI. The app works
 * perfectly offline; a failed update check is not a user-facing failure.
 *
 * Download and restart are deliberately two separate steps rather than
 * `downloadAndInstall` + immediate relaunch: restarting drops every
 * connected app's WebSocket (the SDK's `Transport` reconnects with
 * backoff, but the desktop's in-memory log/network history for the
 * session is gone), so it must be a choice the user makes at a moment
 * they pick — never something that fires the instant a download finishes.
 */
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export interface UpdateInfo {
  version: string;
  notes: string | null;
  date: string | null;
}

/** Holds the live `Update` handle across `checkForUpdate` → `downloadUpdate` → `installAndRelaunch` — the plugin API needs the same object for all three. */
let pendingUpdate: Update | null = null;

/**
 * Checks the configured endpoint for a newer release. Returns `null` both
 * when already up to date and when the check itself fails — the caller
 * can't (and shouldn't need to) tell those apart.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const update = await check();
    if (!update?.available) return null;
    pendingUpdate = update;
    return { version: update.version, notes: update.body ?? null, date: update.date ?? null };
  } catch {
    return null;
  }
}

export type DownloadProgress = { downloaded: number; contentLength: number | null };

/**
 * Downloads the update found by `checkForUpdate` (but does not install it
 * or touch the running app). Allowed to throw — the user explicitly
 * clicked "Update", so a network/signature failure needs to reach the UI
 * as a visible error state, not vanish silently.
 */
export async function downloadUpdate(onProgress: (p: DownloadProgress) => void): Promise<void> {
  const update = pendingUpdate;
  if (!update) return;

  let contentLength: number | null = null;
  let downloaded = 0;

  await update.download((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? null;
        onProgress({ downloaded: 0, contentLength });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress({ downloaded, contentLength });
        break;
      case "Finished":
        onProgress({ downloaded: contentLength ?? downloaded, contentLength });
        break;
    }
  });
}

/**
 * Installs the already-downloaded update and relaunches the app. Only ever
 * called from the user clicking "Restart now" on the "ready" banner state
 * — see the module doc comment for why this is never automatic.
 */
export async function installAndRelaunch(): Promise<void> {
  const update = pendingUpdate;
  if (!update) return;
  await update.install();
  await relaunch();
}
