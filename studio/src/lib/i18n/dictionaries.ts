// The dictionary for each language. Server only: a page is sent the one dictionary for its language
// (lib/i18n/server.ts), never all of them.
import "server-only";
import { JA } from "./dict/ja";
import { KO } from "./dict/ko";
import { ZHTW } from "./dict/zh-TW";
import type { Locale } from "./locales";
import type { Dictionary } from "./translate";

const DICTIONARIES: Record<Exclude<Locale, "en">, Dictionary> = { "zh-TW": ZHTW, ja: JA, ko: KO };

/** null for English, which needs none. */
export const dictionaryFor = (locale: Locale): Dictionary | null => (locale === "en" ? null : DICTIONARIES[locale]);
