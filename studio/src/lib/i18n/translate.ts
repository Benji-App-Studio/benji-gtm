// Looking a sentence up in a dictionary and filling in its values. Plain TypeScript (shared by the
// server, the browser and the Node tests).
//
//   t("Collect ads")                                → "收集廣告" in Traditional Chinese
//   t("{name} is ready", { name: app.name })        → values go in {braces}, in every language
//   tn(count, "{n} ad", "{n} ads")                  → English picks one or the other; each language
//                                                     has its own entry for both forms
import type { Locale } from "./locales";
import { INTL_LOCALE } from "./locales";

/** English sentence → the same sentence in one language. */
export type Dictionary = Readonly<Record<string, string>>;
export type Vars = Readonly<Record<string, string | number>>;

/** Puts each {name} value into the text. A name with no value stays as written, so a mistake is visible. */
export function fill(text: string, vars?: Vars, locale?: Locale): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    if (value === undefined) return whole;
    return typeof value === "number" ? value.toLocaleString(locale ? INTL_LOCALE[locale] : undefined) : value;
  });
}

export function translate(dict: Dictionary | null | undefined, text: string, vars?: Vars, locale?: Locale): string {
  return fill(dict?.[text] ?? text, vars, locale);
}

/** One of two English forms by count (1 → `one`), then looked up like any sentence. `{n}` is the count. */
export function translatePlural(dict: Dictionary | null | undefined, n: number, one: string, other: string, vars?: Vars, locale?: Locale): string {
  return translate(dict, n === 1 ? one : other, { n, ...vars }, locale);
}

/** What a page gets: the language, its two lookups, and the locale for formatting dates and numbers. */
/**
 * Marks an English sentence that lives in data (a label in a list, a message in a lib file) so the
 * coverage check and translators see it. It returns the text unchanged: render it with `t(label)`.
 *   const STEPS = [{ label: m("Get ads") }];   …   t(step.label)
 */
export const m = <T extends string>(text: T): T => text;

export interface Translator {
  locale: Locale;
  /** For Intl and toLocaleString: "en-US", "zh-TW", "ja-JP" or "ko-KR". */
  intl: string;
  t: (text: string, vars?: Vars) => string;
  tn: (n: number, one: string, other: string, vars?: Vars) => string;
}

export function translator(locale: Locale, dict: Dictionary | null | undefined): Translator {
  return {
    locale,
    intl: INTL_LOCALE[locale],
    t: (text, vars) => translate(dict, text, vars, locale),
    tn: (n, one, other, vars) => translatePlural(dict, n, one, other, vars, locale),
  };
}
