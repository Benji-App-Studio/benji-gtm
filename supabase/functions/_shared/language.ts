// The language AI-written text comes back in. The studio speaks English, Traditional Chinese (Taiwan),
// Japanese and Korean (studio/src/lib/i18n); what the AI writes for a person to read (a product profile,
// an ad's analysis, a review summary, a competitor's description, a template's notes) follows the
// person's language, while everything the code reads (JSON keys, enum values, ids, URLs) and everything
// quoted from the source (the words on an ad, a review, the owner's own phrases) stays as it is.
//
// Ad copy for the person's own ads follows the ad's language instead (the language its audience reads),
// which is the person's language unless a request names another.
//
// Where the language comes from:
//   a request   the studio sends the page's language in the `x-ui-locale` header (lib/server/functions.ts),
//               or a body may carry `locale`;
//   a worker    the account's saved language, profiles.locale (Settings › Language), read by user id.
// English needs no rule at all: every prompt is written in English, so an English request is unchanged.
// Plain TypeScript (language_test.ts).
import type { SupabaseClient } from "@supabase/supabase-js";

export const UI_LOCALES = ["en", "zh-TW", "ja", "ko"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];
export const DEFAULT_UI_LOCALE: UiLocale = "en";
/** The header the studio sends with every call (studio/src/lib/server/functions.ts). */
export const LOCALE_HEADER = "x-ui-locale";

/** A locale the app speaks from a loose tag ("ja-JP", "zh-Hant", "ko_KR", "EN"), or null. Any Chinese is Traditional Chinese, the only one the app has. */
export function toUiLocale(value: unknown): UiLocale | null {
  if (typeof value !== "string") return null;
  const tag = value.trim().replace(/_/g, "-").toLowerCase();
  if (!tag) return null;
  if (tag.startsWith("zh")) return "zh-TW";
  if (tag === "ja" || tag.startsWith("ja-")) return "ja";
  if (tag === "ko" || tag.startsWith("ko-")) return "ko";
  if (tag === "en" || tag.startsWith("en-")) return "en";
  return null;
}

/** The language of a request: the body's `locale`, else the studio's header, else null (unknown). */
export function requestLocale(req: Request | null | undefined, body?: unknown): UiLocale | null {
  const fromBody = body && typeof body === "object" ? toUiLocale((body as { locale?: unknown }).locale) : null;
  return fromBody ?? toUiLocale(req?.headers.get(LOCALE_HEADER));
}

/** The account's saved language (profiles.locale), or null when there's none, the column is missing or the read fails. */
export async function savedLocale(db: SupabaseClient, userId: string | null | undefined): Promise<UiLocale | null> {
  if (!userId) return null;
  try {
    const { data, error } = await db.from("profiles").select("locale").eq("id", userId).maybeSingle<{ locale: string | null }>();
    return error ? null : toUiLocale(data?.locale);
  } catch {
    return null;
  }
}

/** The request's language, else the account's saved one, else English. */
export async function localeFor(db: SupabaseClient, req: Request | null | undefined, userId: string | null | undefined, body?: unknown): Promise<UiLocale> {
  return requestLocale(req, body) ?? (await savedLocale(db, userId)) ?? DEFAULT_UI_LOCALE;
}

/**
 * The language for a tenant's work (_shared/tenant.ts): its request's (member() sets it from the header),
 * else the account's saved one, else English. Workers' tenants have no request, so the profile decides.
 */
export async function tenantLocale(db: SupabaseClient, tenant: { locale?: UiLocale | null; userId: string | null } | null | undefined, userId?: string | null): Promise<UiLocale> {
  return tenant?.locale ?? (await savedLocale(db, tenant?.userId ?? userId)) ?? DEFAULT_UI_LOCALE;
}

/** How a prompt names each language: what the model should write, and how natives write it. */
export const LANGUAGE_NAME: Record<UiLocale, string> = {
  en: "English",
  "zh-TW": "Traditional Chinese as written in Taiwan (繁體中文, Taiwan usage and punctuation)",
  ja: "Japanese (日本語, natural です/ます style for sentences)",
  ko: "Korean (한국어, natural 해요체 for sentences)",
};

export interface LanguageOptions {
  /** The language of ad copy for the person's own ads (headlines, primary text, captions, scripts). Default: the locale. */
  adCopy?: UiLocale | null;
  /** What this prompt's free text is, to name it in the rule (e.g. "summaries and reasons"). */
  writes?: string;
}

/**
 * The language rule to add to a system prompt: "" for English with English ad copy (prompts are written
 * in English, so nothing changes). Structured values and quoted text are kept as they are.
 */
export function languageRule(locale: UiLocale | null | undefined, o: LanguageOptions = {}): string {
  const ui = locale ?? DEFAULT_UI_LOCALE;
  const ad = o.adCopy ?? ui;
  if (ui === "en" && ad === "en") return "";
  const lines = ["", "LANGUAGE"];
  if (ui !== "en") {
    lines.push(
      `Write every human-readable text you produce${o.writes ? ` (${o.writes})` : " (summaries, explanations, reasons, descriptions, advice, and names or labels you make up)"} in ${LANGUAGE_NAME[ui]}. Write it the way a native product writer would, not as a word-for-word translation.`,
      "Keep exactly as they are: JSON keys, enum and option values, ids, URLs, @handles, numbers, and brand, product and app names. Words you transcribe or quote from the material (the text on an ad, its spoken words, a review, the owner's own phrases) stay in the language they were written in.",
      "Marketing acronyms such as CAC, LTV, ROAS, CTR, CPM, CPI and UGC stay in Latin letters.",
    );
  }
  if (ad !== ui) lines.push(`The one exception is ad copy written for OUR ads (headlines, primary text, descriptions, captions, on-image lines, voiceover scripts): write that in ${LANGUAGE_NAME[ad]}, the language its audience reads.`);
  else if (ad !== "en") lines.push(`Ad copy written for OUR ads (headlines, primary text, descriptions, captions, on-image lines, voiceover scripts) is in ${LANGUAGE_NAME[ad]} too.`);
  return lines.join("\n");
}

/** `system` with the language rule for `locale` appended (unchanged for English). */
export function withLanguage(system: string, locale: UiLocale | null | undefined, o: LanguageOptions = {}): string {
  const rule = languageRule(locale, o);
  return rule ? `${system}\n${rule}` : system;
}

/** The rule for a prompt whose whole answer is ad copy for OUR ads: write it all in `language`. "" for English. */
export function adCopyRule(language: UiLocale | null | undefined): string {
  if (!language || language === "en") return "";
  return `\nLANGUAGE\nWrite all the ad copy in ${LANGUAGE_NAME[language]}, the language the ad's audience reads, as a native copywriter would (not a word-for-word translation). Keep brand, product and app names, URLs, @handles and numbers as they are, and keep every JSON key and enum value exactly as given.`;
}
