// A language in the address: /?lang=ja. The app keeps the language in a cookie, so every page has one
// address in all four languages. Search engines don't keep cookies, so the public landing page also
// answers to ?lang=zh-TW / ja / ko: the proxy (src/proxy.ts) turns it into the cookie (for this request
// and the next ones, like choosing it in the language menu), and the page lists every language's address
// as an hreflang alternate. English is the plain address and the default for everyone else (x-default).
// Plain TypeScript (query-locale.test.ts).
import { LOCALE_COOKIE } from "../storage-keys";
import { isLocale, LOCALES, type Locale } from "./locales";

export const LANG_PARAM = "lang";

/**
 * The language a ?lang= value names, or null (missing or one the app doesn't speak). Any letter case
 * works (?lang=zh-tw, ?lang=JA): people type addresses in lower case.
 */
export function localeFromQuery(value: string | null | undefined): Locale | null {
  if (isLocale(value)) return value;
  const wanted = typeof value === "string" ? value.trim().toLowerCase().replace("_", "-") : "";
  return wanted ? LOCALES.find((locale) => locale.toLowerCase() === wanted) ?? null : null;
}

/** The cookie that makes the language stick, the same one the language menu sets (a year). */
export const queryLocaleCookie = (locale: Locale) => ({ name: LOCALE_COOKIE, value: locale, options: { path: "/", sameSite: "lax" as const, maxAge: 31536000 } });

/** A page's address in a language: the plain path for English, ?lang=… for the others. */
export function localizedPath(path: string, locale: Locale): string {
  return locale === "en" ? path : `${path}?${LANG_PARAM}=${encodeURIComponent(locale)}`;
}

/** hreflang alternates for Next.js metadata: every language's address, and x-default (English). */
export function languageAlternates(path: string): Record<string, string> {
  return { ...Object.fromEntries(LOCALES.map((locale) => [locale, localizedPath(path, locale)])), "x-default": path };
}

/** Open Graph's locale names (language_TERRITORY). */
export const OG_LOCALE: Record<Locale, string> = { en: "en_US", "zh-TW": "zh_TW", ja: "ja_JP", ko: "ko_KR" };
