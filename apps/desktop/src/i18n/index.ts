import { useLocaleStore } from "../state/locale";
import { en } from "./en";
import { pt } from "./pt";

export type Locale = "en" | "pt";
export type TranslationKey = keyof typeof en;
/** `pt.ts` is declared `satisfies Translations` — a key missing there is a `pnpm typecheck` error, not a silent runtime fallback. */
export type Translations = Record<TranslationKey, string>;

const DICTIONARIES: Record<Locale, Translations> = { en, pt };

type Vars = Record<string, string | number>;

/**
 * Replaces `{name}` tokens with `vars.name`. Deliberately only matches
 * `\w+` inside the braces — a literal `{…}`/`{ }` in a template (JsonTree's
 * container summaries) has no word characters, so it passes through
 * untouched without needing to be escaped.
 */
function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

/**
 * Standalone translator for callers that build a string outside a
 * component's render — pure functions like `ConnectView`'s `noteFor()`, or
 * `state/connection.ts`'s failure messages, which run in a Zustand action,
 * not a hook. Reads the *current* locale straight from the store (Zustand's
 * vanilla `getState()`, no subscription) — always in sync, since
 * `useLocaleStore.setLocale` is the only writer.
 *
 * A component that renders text should prefer `useT()` instead, so it
 * re-renders when the language changes; `t()`/`tp()` alone don't trigger a
 * re-render on their own.
 */
export function t(key: TranslationKey, vars?: Vars): string {
  const locale = useLocaleStore.getState().locale;
  const template = DICTIONARIES[locale][key] ?? DICTIONARIES.en[key] ?? key;
  return interpolate(template, vars);
}

/** Plural helper: picks `${key}_one` when `count === 1`, else `${key}_other`, and always makes `count` available for interpolation. */
export function tp(key: string, count: number, vars?: Vars): string {
  const suffix = count === 1 ? "_one" : "_other";
  return t((key + suffix) as TranslationKey, { count, ...vars });
}

/** Subscribes to the active locale (so the component re-renders on change) and hands back the same `t`/`tp` every other caller uses. */
export function useT(): { t: typeof t; tp: typeof tp } {
  useLocaleStore((s) => s.locale);
  return { t, tp };
}
