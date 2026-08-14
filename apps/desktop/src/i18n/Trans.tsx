import type { ReactNode } from "react";
import { useLocaleStore } from "../state/locale";
import { t, type TranslationKey } from "./index";

/**
 * Renders a translation whose template needs a real React node in the
 * middle of a sentence — a `<code>` snippet, mostly — which `t()` alone
 * can't produce (it only ever returns a string). Splits the template on
 * `{slot}` tokens and swaps each one for `values[slot]`; every part around
 * the slots renders as plain text, `{unknownToken}` included, so a slot
 * name in `values` that doesn't match the template just doesn't get used
 * rather than crashing.
 *
 * Subscribes to the locale itself (not just relying on the parent
 * re-rendering) so `<Trans>` stays correct even in the rare case its parent
 * doesn't otherwise call `useT()`.
 */
export function Trans({ k, values }: { k: TranslationKey; values: Record<string, ReactNode> }): JSX.Element {
  useLocaleStore((s) => s.locale);
  const template = t(k);
  const parts = template.split(/(\{\w+\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = /^\{(\w+)\}$/.exec(part);
        if (match && match[1] in values) {
          return <span key={i}>{values[match[1]]}</span>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
