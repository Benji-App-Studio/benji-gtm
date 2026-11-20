// Chinese, Japanese and Korean in images the server draws (composed ads, lib/server/compose.tsx): which
// Noto Sans to set them in. Plain TypeScript (tested in cjk-fonts.test.ts).
//
// The fonts come with the app (studio/assets/fonts/cjk: common characters, regular and bold, read by
// lib/server/cjk-font-files.ts). Only when an install sets CJK_FONT_FALLBACK=google are characters outside
// them asked from Google Fonts, cut down to just those characters (`text=`): the URL helpers below are for
// that. With an old Safari user agent Google answers with a TrueType file, which Satori and opentype.js
// both read (they can't read WOFF2).

/** The CJK scripts the app sets, by the app locale whose glyph shapes they use. */
export type CjkScript = "zh-TW" | "ja" | "ko";

export const CJK_FAMILY: Record<CjkScript, string> = { "zh-TW": "Noto Sans TC", ja: "Noto Sans JP", ko: "Noto Sans KR" };

const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const HAN = /[⺀-⿟　-〿㐀-䶿一-鿿豈-﫿＀-￯]|[\u{20000}-\u{3134f}]/u;

/**
 * The script to set `text` in: Korean when it has Hangul, Japanese when it has kana, and for Chinese
 * characters alone (which both Chinese and Japanese write) the `hint` (the ad's or the page's language),
 * else Traditional Chinese. Null when there is nothing CJK in it.
 */
export function cjkScriptOf(text: string, hint?: string | null): CjkScript | null {
  if (HANGUL.test(text)) return "ko";
  if (KANA.test(text)) return "ja";
  if (!HAN.test(text)) return null;
  const h = (hint ?? "").toLowerCase();
  if (h.startsWith("ja")) return "ja";
  if (h.startsWith("ko")) return "ko";
  return "zh-TW";
}

/** Google Fonts' weights run 100-900 in hundreds; a brand font's 650 asks for 700. */
export const cjkWeight = (weight: number) => Math.min(900, Math.max(100, Math.round((Number.isFinite(weight) ? weight : 400) / 100) * 100));

/** The stylesheet URL for `family` at `weight`, cut down to the characters in `text` (each once, sorted). */
export function subsetCssUrl(family: string, weight: number, text: string): string {
  const chars = [...new Set(Array.from(text).filter((ch) => !/\s/.test(ch)))].sort().join("");
  return `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${cjkWeight(weight)}&text=${encodeURIComponent(chars)}`;
}

/** The font file's URL in Google's answer (TrueType or OpenType only); null when there's none. */
export function fontUrlFromCss(css: string): string | null {
  return css.match(/src:\s*url\(([^)]+)\)\s*format\(['"](?:truetype|opentype)['"]\)/)?.[1]?.replace(/^['"]|['"]$/g, "") ?? null;
}

/** The user agent that makes Google Fonts answer with TrueType (a browser too old for WOFF2). */
export const TRUETYPE_USER_AGENT = "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1";
