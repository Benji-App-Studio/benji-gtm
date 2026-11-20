// Dates, times, numbers, money and percentages in the page's language: one helper for the whole app.
// Plain TypeScript with no browser or Next.js imports, so the server, the browser and the Node tests
// format the same way (the server renders first and the browser takes over: a difference would be a
// hydration error).
//
// Pass the translator's `intl` ("en-US", "zh-TW", "ja-JP", "ko-KR"), or the translator itself:
//   const { intl } = useT();                     // or: await getTranslator()
//   formatMoney(intl, 1234.5, "USD")             → "$1,234.50" · "US$1,234.50" · "$1,234.50" · "US$1,234.50"
//   formatCompact(intl, 125_000)                 → "125K" · "12.5萬" · "12.5万" · "12.5만"
//   formatRelative(intl, then, now)              → "3 days ago" · "3 天前" · "3 日前" · "3일 전"
//   const f = formatters(intl); f.percent(0.27)  → "27%"
//
// Times of day and calendar dates depend on a time zone as well as a language: the server runs in UTC
// and the browser in the viewer's zone. Pass `timeZone` (e.g. "UTC", or the account's zone) wherever a
// server-rendered date must match the browser's exactly; leave it out in client-only components.
import { DEFAULT_LOCALE, INTL_LOCALE, isLocale } from "./locales";

/** An `intl` string, a Locale ("ja"), or anything carrying `intl` (a Translator). */
export type IntlLike = string | { intl: string } | null | undefined;

const EN = INTL_LOCALE[DEFAULT_LOCALE];

/** The BCP 47 tag for Intl: a translator's `intl`, an app Locale mapped to its formatting locale, or en-US. */
export function intlOf(value: IntlLike): string {
  if (!value) return EN;
  const tag = typeof value === "string" ? value : value.intl;
  if (isLocale(tag)) return INTL_LOCALE[tag];
  return tag || EN;
}

// Intl objects are slow to build and identical for the same arguments: keep one per key.
const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat>();
function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat>(kind: string, locale: string, options: object, make: () => T): T {
  const key = `${kind}|${locale}|${JSON.stringify(options)}`;
  let found = cache.get(key) as T | undefined;
  if (!found) {
    found = make();
    if (cache.size > 500) cache.clear();
    cache.set(key, found);
  }
  return found;
}
const numberFormat = (locale: string, options: Intl.NumberFormatOptions) => cached("n", locale, options, () => new Intl.NumberFormat(locale, options));
const dateFormat = (locale: string, options: Intl.DateTimeFormatOptions) => cached("d", locale, options, () => new Intl.DateTimeFormat(locale, options));
const relativeFormat = (locale: string, options: Intl.RelativeTimeFormatOptions) => cached("r", locale, options, () => new Intl.RelativeTimeFormat(locale, options));

/** What a missing number shows as. */
export const NO_VALUE = "–";
const finite = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

// MARK: Numbers

/** 1234.5 → "1,234.5" (at most `maximumFractionDigits`, default 0 for whole-number counts). */
export function formatNumber(intl: IntlLike, n: number | null | undefined, options: Intl.NumberFormatOptions = {}): string {
  if (!finite(n)) return NO_VALUE;
  return numberFormat(intlOf(intl), { maximumFractionDigits: 0, ...options }).format(n);
}

/** 125000 → "125K" in English, "12.5萬" / "12.5万" / "12.5만" in CJK (their own units of ten thousand). */
export function formatCompact(intl: IntlLike, n: number | null | undefined, maximumFractionDigits = 1): string {
  if (!finite(n)) return NO_VALUE;
  if (Math.abs(n) < 1000) return formatNumber(intl, n);
  return numberFormat(intlOf(intl), { notation: "compact", maximumFractionDigits }).format(n);
}

/** A share (0.273) as a percentage: "27%"; `digits` decimals (default 0). */
export function formatPercent(intl: IntlLike, ratio: number | null | undefined, digits = 0): string {
  if (!finite(ratio)) return NO_VALUE;
  return numberFormat(intlOf(intl), { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(ratio);
}

/** A change as a signed percentage: +12%, −4%; 0 shows without a sign. */
export function formatChange(intl: IntlLike, ratio: number | null | undefined, digits = 0): string {
  if (!finite(ratio)) return NO_VALUE;
  return numberFormat(intlOf(intl), { style: "percent", signDisplay: "exceptZero", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(ratio);
}

export interface MoneyOptions {
  /** Decimals. Default: 2 under 100, none from 100 up (spend and revenue read as whole amounts). */
  decimals?: number;
  /** Short form for big amounts: "$1.2M", "US$120萬". */
  compact?: boolean;
}

/**
 * An amount in a currency (ISO code, e.g. "USD", "JPY", "TWD", "KRW"): "$1,234", "¥1,234", "₩1,234".
 * Currencies without minor units (JPY, KRW) never show decimals. An unknown code falls back to "1,234 XYZ".
 */
export function formatMoney(intl: IntlLike, amount: number | null | undefined, currency = "USD", options: MoneyOptions = {}): string {
  if (!finite(amount)) return NO_VALUE;
  const locale = intlOf(intl);
  const code = (currency || "USD").toUpperCase();
  try {
    const minor = numberFormat("en-US", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
    const decimals = Math.min(minor, options.decimals ?? (Math.abs(amount) < 100 ? 2 : 0));
    if (options.compact && Math.abs(amount) >= 10_000) {
      return numberFormat(locale, { style: "currency", currency: code, notation: "compact", maximumFractionDigits: 1 }).format(amount);
    }
    return numberFormat(locale, { style: "currency", currency: code, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(amount);
  } catch {
    return `${formatNumber(locale, amount, { maximumFractionDigits: 2 })} ${code}`;
  }
}

// MARK: Dates

/**
 * The shapes the app shows dates in:
 *   date       "Nov 19, 2026"   · "2026年11月19日" · "2026/11/19"…  (medium)
 *   short      "Nov 19"         · "11月19日"       · "11월 19일"     (month and day)
 *   numeric    "11/19/2026"     · "2026/11/19"     · "2026. 11. 19."
 *   long       "November 19, 2026"
 *   month      "Nov 2026"       · "2026年11月"
 *   weekday    "Thu, Nov 19"
 *   time       "3:05 PM"        · "15:05"          · "오후 3:05"
 *   dateTime   "Nov 19, 2026, 3:05 PM"
 *   shortTime  "Nov 19, 3:05 PM"
 */
export type DateStyle = "date" | "short" | "numeric" | "long" | "month" | "weekday" | "time" | "dateTime" | "shortTime";

const DATE_STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  date: { dateStyle: "medium" },
  short: { month: "short", day: "numeric" },
  numeric: { year: "numeric", month: "numeric", day: "numeric" },
  long: { dateStyle: "long" },
  month: { year: "numeric", month: "short" },
  weekday: { weekday: "short", month: "short", day: "numeric" },
  time: { timeStyle: "short" },
  dateTime: { dateStyle: "medium", timeStyle: "short" },
  shortTime: { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
};

const toDate = (value: Date | string | number | null | undefined): Date | null => {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

/** A date (Date, ISO string or epoch ms) in one of the app's shapes. "" when there is no valid date. */
export function formatDate(intl: IntlLike, value: Date | string | number | null | undefined, style: DateStyle = "date", timeZone?: string): string {
  const date = toDate(value);
  if (!date) return "";
  return dateFormat(intlOf(intl), { ...DATE_STYLES[style], ...(timeZone ? { timeZone } : {}) }).format(date);
}

/** From–to as one range in the language's own way: "Nov 3 – 19" · "11月3日～19日" · "11월 3일~19일". */
export function formatDateRange(intl: IntlLike, from: Date | string | number, to: Date | string | number, style: DateStyle = "short", timeZone?: string): string {
  const a = toDate(from), b = toDate(to);
  if (!a || !b) return "";
  return dateFormat(intlOf(intl), { ...DATE_STYLES[style], ...(timeZone ? { timeZone } : {}) }).formatRange(a, b);
}

const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

/**
 * How long ago (or until) a moment is, in words: "just now", "5 min. ago", "yesterday", "3 months ago";
 * "たった今", "5 分前", "昨日"… `now` is a parameter so the server and the browser agree (pass the same
 * value, or render it only in the browser).
 */
export function formatRelative(intl: IntlLike, value: Date | string | number | null | undefined, now: number = Date.now(), style: "long" | "short" = "long"): string {
  const date = toDate(value);
  if (!date) return "";
  const diff = date.getTime() - now;
  const abs = Math.abs(diff);
  const rtf = relativeFormat(intlOf(intl), { numeric: "auto", style });
  if (abs < 45 * SECOND) return rtf.format(0, "second");
  if (abs < 45 * MINUTE) return rtf.format(Math.round(diff / MINUTE), "minute");
  if (abs < 22 * HOUR) return rtf.format(Math.round(diff / HOUR), "hour");
  if (abs < 26 * DAY) return rtf.format(Math.round(diff / DAY), "day");
  if (abs < 320 * DAY) return rtf.format(Math.round(diff / (30.44 * DAY)), "month");
  return rtf.format(Math.round(diff / (365.25 * DAY)), "year");
}

/** A length of time: 90 → "1 min 30 sec" style units in the language ("1分30秒", "1분 30초"); seconds in. */
export function formatDuration(intl: IntlLike, seconds: number | null | undefined): string {
  if (!finite(seconds) || seconds < 0) return NO_VALUE;
  const locale = intlOf(intl);
  // CJK writes the units tight against the number ("1分30秒"); English spaces them ("1 min 30 sec").
  const tight = /^(ja|zh)/.test(locale);
  const unit = (n: number, u: "hour" | "minute" | "second") => {
    const text = numberFormat(locale, { style: "unit", unit: u, unitDisplay: "short", maximumFractionDigits: 0 }).format(n);
    return tight ? text.replace(/(\d)\s+/, "$1") : text;
  };
  // Whole seconds first, so 119.6 s is "2 min", never "1 min 60 sec".
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const parts = [h ? unit(h, "hour") : "", m ? unit(m, "minute") : "", s || (!h && !m) ? unit(s, "second") : ""].filter(Boolean);
  return parts.join(tight ? "" : " ");
}

/** A list: ["Meta", "TikTok", "Google"] → "Meta, TikTok, and Google" · "Meta、TikTok和Google" · "Meta、TikTok、Google"… */
export function formatList(intl: IntlLike, items: string[], type: "conjunction" | "disjunction" = "conjunction"): string {
  return new Intl.ListFormat(intlOf(intl), { style: "long", type }).format(items);
}

// MARK: All of them, bound to one language

export interface Formatters {
  intl: string;
  number: (n: number | null | undefined, options?: Intl.NumberFormatOptions) => string;
  compact: (n: number | null | undefined, maximumFractionDigits?: number) => string;
  percent: (ratio: number | null | undefined, digits?: number) => string;
  change: (ratio: number | null | undefined, digits?: number) => string;
  money: (amount: number | null | undefined, currency?: string, options?: MoneyOptions) => string;
  date: (value: Date | string | number | null | undefined, style?: DateStyle, timeZone?: string) => string;
  dateRange: (from: Date | string | number, to: Date | string | number, style?: DateStyle, timeZone?: string) => string;
  relative: (value: Date | string | number | null | undefined, now?: number, style?: "long" | "short") => string;
  duration: (seconds: number | null | undefined) => string;
  list: (items: string[], type?: "conjunction" | "disjunction") => string;
}

/** Every formatter above with the language filled in: `const f = formatters(useT())`. */
export function formatters(value: IntlLike): Formatters {
  const intl = intlOf(value);
  return {
    intl,
    number: (n, options) => formatNumber(intl, n, options),
    compact: (n, digits) => formatCompact(intl, n, digits),
    percent: (ratio, digits) => formatPercent(intl, ratio, digits),
    change: (ratio, digits) => formatChange(intl, ratio, digits),
    money: (amount, currency, options) => formatMoney(intl, amount, currency, options),
    date: (v, style, timeZone) => formatDate(intl, v, style, timeZone),
    dateRange: (from, to, style, timeZone) => formatDateRange(intl, from, to, style, timeZone),
    relative: (v, now, style) => formatRelative(intl, v, now, style),
    duration: (seconds) => formatDuration(intl, seconds),
    list: (items, type) => formatList(intl, items, type),
  };
}
