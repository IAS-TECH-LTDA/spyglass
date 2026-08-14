import { describe, expect, it, beforeEach } from "vitest";
import { en } from "../en";
import { pt } from "../pt";
import { t, tp } from "../index";
import { useLocaleStore } from "../../state/locale";

describe("en/pt key parity", () => {
  it("pt has no keys beyond what en declares (en.ts is the source of truth for the key set)", () => {
    const enKeys = new Set(Object.keys(en));
    const extra = Object.keys(pt).filter((k) => !enKeys.has(k));
    expect(extra).toEqual([]);
  });

  it("every en key has a non-empty pt translation (missing keys are already a compile error via `satisfies Translations`, this catches empty strings)", () => {
    const empty = Object.entries(pt as Record<string, string>).filter(([, v]) => v.trim() === "");
    expect(empty).toEqual([]);
  });

  it("every _one plural key has a matching _other key in both languages", () => {
    for (const dict of [en, pt] as const) {
      const keys = new Set(Object.keys(dict));
      for (const key of keys) {
        if (key.endsWith("_one")) {
          expect(keys.has(key.replace(/_one$/, "_other"))).toBe(true);
        }
      }
    }
  });
});

describe("t() interpolation and locale switching", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
  });

  it("substitutes {name} tokens from vars", () => {
    expect(t("app.removeAppAria", { name: "MyApp" })).toBe("Remove MyApp");
  });

  it("leaves an unmatched {token} untouched rather than throwing", () => {
    expect(t("update.available", {})).toBe("Spyglass {version} is available");
  });

  it("passes a literal {…}/{ } summary token through unmodified — only \\w+ inside braces is treated as a var", () => {
    expect(tp("jsonGraph.itemCount", 3)).toBe("[…] 3 items");
  });

  it("follows useLocaleStore's locale without needing a React re-render (t() reads getState() directly)", () => {
    expect(t("common.copy")).toBe("Copy");
    useLocaleStore.getState().setLocale("pt");
    expect(t("common.copy")).toBe("Copiar");
  });
});

describe("tp() plural selection", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
  });

  it("selects the singular form at count === 1", () => {
    expect(tp("network.requestCount", 1)).toBe("1 request");
  });

  it("selects the plural form at count === 0", () => {
    expect(tp("network.requestCount", 0)).toBe("0 requests");
  });

  it("selects the plural form at count > 1", () => {
    expect(tp("network.requestCount", 5)).toBe("5 requests");
  });

  it("selects the correct Portuguese plural form too", () => {
    useLocaleStore.getState().setLocale("pt");
    expect(tp("network.requestCount", 1)).toBe("1 requisição");
    expect(tp("network.requestCount", 2)).toBe("2 requisições");
  });
});
