// Putting translated sentences (or a short list) side by side the way each language writes them. Chinese
// and Japanese end a sentence with 。 and put nothing after it; English and Korean put a space between
// sentences. The one home for this: components/rich.tsx re-exports sentenceGap for markup.
//   joinSentences(locale, saved, checkedWhenSaved)            (sentences already translated)
//   <p>{first}{sentenceGap(locale)}<Link …>{second}</Link></p>
import type { Locale } from "./locales";

const cjk = (locale: string) => locale === "zh-TW" || locale === "ja";

/** The gap between two sentences in this language: "" in Chinese and Japanese, " " in English and Korean. */
export function sentenceGap(locale: Locale | string): string {
  return cjk(locale) ? "" : " ";
}

/**
 * The gap between two given sentences: the language's gap, except that in Chinese and Japanese a space
 * still goes after a sentence that didn't end in a full-width mark or before one with no Chinese or
 * Japanese in it (an English message from a provider kept as it came), so "…沒有儲存任何內容。" and "Invalid key." never glue.
 */
export function gapBetween(locale: Locale | string, before: string, after: string): string {
  if (!cjk(locale)) return " ";
  const fullStop = /[\u3000-\u303f\uff01-\uff60」』）】]$/.test(before.trimEnd());
  const english = !/[\u3000-\u9fff\uac00-\ud7af\uff01-\uff60]/.test(after);
  return fullStop && !english ? "" : " ";
}

/** The sentences given, empty ones left out, joined the way this language joins sentences. */
export function joinSentences(locale: Locale, ...parts: (string | null | undefined | false)[]): string {
  const kept = parts.filter((part): part is string => !!part);
  return kept.reduce((out, part, i) => (i === 0 ? part : `${out}${gapBetween(locale, out, part)}${part}`), "");
}

/** The same for pieces that may lack their full stop (labels, short phrases): each gets one if it has none. */
export function joinAsSentences(locale: Locale, parts: (string | null | undefined | false)[]): string {
  const stop = cjk(locale) ? "。" : ".";
  return joinSentences(locale, ...parts.filter((p): p is string => !!p && !!p.trim()).map((p) => (/[.!?。！？…]$/.test(p.trim()) ? p.trim() : `${p.trim()}${stop}`)));
}

/** A short list inside a sentence: "a, b" or 「a、b」. */
export function joinList(locale: Locale, items: string[]): string {
  return items.join(cjk(locale) ? "、" : ", ");
}
