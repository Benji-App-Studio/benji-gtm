// The languages the app speaks, and how a request's language is chosen. Plain TypeScript with no
// imports from the browser or Next.js, so the server, the browser and the Node tests share it.
//
// English is the language the app is written in: every other language is a dictionary keyed by the
// English sentence (dict/*.ts). A sentence with no entry shows in English, never blank.

export const LOCALES = ["en", "zh-TW", "ja", "ko"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Each language in its own words, for the language menu. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", "zh-TW": "繁體中文", ja: "日本語", ko: "한국어" };
/** The `lang` attribute of the page. */
export const HTML_LANG: Record<Locale, string> = { en: "en", "zh-TW": "zh-Hant-TW", ja: "ja", ko: "ko" };
/**
 * The locale every date and number is formatted with. One per language, used on the server and in the
 * browser alike, so the two always format the same way (a mismatch is a hydration error).
 */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", "zh-TW": "zh-TW", ja: "ja-JP", ko: "ko-KR" };

export const isLocale = (value: unknown): value is Locale => typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/** The best language for a browser's Accept-Language header. Any Chinese gets Traditional Chinese, the only Chinese the app has. */
export function fromAcceptLanguage(header: string | null | undefined): Locale {
  const ranked = (header ?? "")
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.trim().slice(2) ?? "1");
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((entry) => entry.tag && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranked) {
    if (tag.startsWith("zh")) return "zh-TW";
    if (tag.startsWith("ja")) return "ja";
    if (tag.startsWith("ko")) return "ko";
    if (tag.startsWith("en")) return "en";
  }
  return DEFAULT_LOCALE;
}

/** A saved choice (the cookie) wins; otherwise the browser's languages decide. */
export const chooseLocale = (saved: string | null | undefined, acceptLanguage: string | null | undefined): Locale =>
  isLocale(saved) ? saved : fromAcceptLanguage(acceptLanguage);
