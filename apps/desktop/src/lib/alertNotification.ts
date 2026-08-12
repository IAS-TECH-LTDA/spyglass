import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useAlertSettings } from "../state/alertSettings";

/** Guards against a burst of errors firing N concurrent permission prompts. */
let pending: Promise<boolean> | null = null;

async function ensurePermission(): Promise<boolean> {
  const remembered = useAlertSettings.getState().notificationPermission;
  if (remembered === "granted") return true;
  if (remembered === "denied") return false; // never re-asked automatically — see resetNotificationPermission()

  if (pending) return pending;

  pending = (async () => {
    try {
      // Might already be granted from a previous install/run that predates
      // this settings store, or was granted outside the app entirely.
      if (await isPermissionGranted()) {
        useAlertSettings.getState().setNotificationPermission("granted");
        return true;
      }
      const result = await requestPermission();
      const granted = result === "granted";
      useAlertSettings.getState().setNotificationPermission(granted ? "granted" : "denied");
      return granted;
    } catch {
      // Plugin unavailable, platform doesn't support it, etc. — degrade
      // exactly as if the user had denied it, never throw.
      return false;
    } finally {
      pending = null;
    }
  })();

  return pending;
}

/**
 * Posts a native OS notification, requesting permission first if needed.
 * Never throws and never surfaces an error to the caller — a failure here
 * (denied permission, unsupported platform, plugin error) must be silent,
 * exactly as if the feature were switched off.
 */
export async function sendAlertNotification(title: string, body: string): Promise<void> {
  try {
    const granted = await ensurePermission();
    if (!granted) return;
    sendNotification({ title, body });
  } catch {
    // See above — swallow.
  }
}
