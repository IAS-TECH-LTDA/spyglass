import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Locale = "en" | "pt";

interface LocaleState {
  /** Default is English, not the OS locale — a debug tool's UI should be predictable across machines, and every other piece of copy in this repo (README, SDK diagnostics) is English-first already. */
  locale: Locale;
  setLocale(locale: Locale): void;
}

/**
 * Persisted via `zustand/middleware`'s `persist`, the same precedent
 * `state/alertSettings.ts` documents: this is a nested/typed value read
 * reactively by multiple consumers (every view, plus standalone callers via
 * `i18n/index.ts`'s `t()`), not a single scalar read once — `persist` over a
 * hand-rolled `localStorage` module. `zustand` is already a dependency.
 *
 * Deliberately has no dependency on `../i18n` — `i18n/index.ts` reads this
 * store's `getState().locale` directly, so the dependency only ever points
 * one way and there's no import cycle between the two modules.
 */
export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: "en",
      setLocale(locale) {
        set({ locale });
      },
    }),
    { name: "dm:locale", version: 1 },
  ),
);

/**
 * Maps the app's two-value `Locale` to a real BCP-47 tag for
 * `toLocaleTimeString`/`toLocaleString` calls (timestamps in Network,
 * Graph, Queries, Logs, Performance, Memory) — those used to always follow
 * the OS locale regardless of the language picked here, which reads as
 * broken once the picker exists. Picks one concrete region per language
 * rather than trying to guess the user's own region from `Locale` alone.
 */
export function bcp47(locale: Locale): string {
  return locale === "pt" ? "pt-BR" : "en-US";
}

/** Standalone helper for the many small `toLocaleTimeString`/`toLocaleString` call sites that aren't already inside a component subscribed to the locale — reads the current locale the same way `i18n/index.ts`'s `t()` does. */
export function currentBcp47(): string {
  return bcp47(useLocaleStore.getState().locale);
}
