/**
 * Wrapper over `@tauri-apps/plugin-opener`, same rationale as
 * `lib/updater.ts`'s doc comment for living outside `ipc.ts`: this is
 * third-party plugin API, not one of this app's own Rust commands.
 *
 * A plain `<a href>` inside the webview would try to navigate the app's own
 * window instead of the system browser — `openUrl` is Tauri's supported way
 * to hand a URL off to the OS. Degrades silently on failure (no default
 * browser configured, sandboxing denies it, ...) — same "never surface a
 * failure the user can't act on" convention as `checkForUpdate`.
 */
import { openUrl } from "@tauri-apps/plugin-opener";

export const REPO_URL = "https://github.com/IAS-TECH-LTDA/spyglass";
export const IASTECH_URL = "https://iastechconsultoria.com.br/";

function open(url: string): void {
  void openUrl(url).catch(() => {});
}

export function openRepoLink(): void {
  open(REPO_URL);
}

export function openIasTechSite(): void {
  open(IASTECH_URL);
}
