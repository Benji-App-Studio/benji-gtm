import "server-only";
// The Chinese, Japanese and Korean fonts bundled with the app (studio/assets/fonts/cjk, built by
// scripts/build-cjk-fonts.mjs from Noto Sans TC/JP/KR under the SIL Open Font License): common characters
// only, regular and bold. Composed ads use them where the brand's font has no such characters; nothing is
// fetched. Each file is read and parsed once per server instance, and checked before it is kept.
import fs from "node:fs/promises";
import path from "node:path";
import opentype from "opentype.js";
import type { CjkScript } from "@/lib/cjk-fonts";

const FAMILY_FILE: Record<CjkScript, string> = { "zh-TW": "NotoSansTC", ja: "NotoSansJP", ko: "NotoSansKR" };
/** A character every bundled font of the script must have: a file without it is not the right font. */
const PROBE: Record<CjkScript, string> = { "zh-TW": "的", ja: "あ", ko: "가" };
/** The weights bundled. */
export const BUNDLED_WEIGHTS = [400, 700] as const;
/** A brand font's weight → the bundled one nearest in feel: bold (700) from 600 up, regular below. */
export const bundledWeight = (weight: number): 400 | 700 => (weight >= 600 ? 700 : 400);

export interface BundledFont { font: opentype.Font; bytes: ArrayBuffer; family: string; weight: 400 | 700; file: string }

/** Where the files are: the app folder at run time (the compose route traces them in: next.config.ts), or studio/ from the repository root. */
async function fontDir(): Promise<string> {
  const candidates = [process.env.CJK_FONT_DIR, path.join(process.cwd(), "assets", "fonts", "cjk"), path.join(process.cwd(), "studio", "assets", "fonts", "cjk")].filter((d): d is string => !!d);
  for (const dir of candidates) {
    try { await fs.access(path.join(dir, "fonts.json")); return dir; } catch { /* the next */ }
  }
  throw new Error("The built-in CJK fonts are missing (studio/assets/fonts/cjk). Run node scripts/build-cjk-fonts.mjs.");
}

const cache = new Map<string, Promise<BundledFont>>();

/** The bundled font for `script` nearest `weight`, read and parsed once. Throws when the file is missing or isn't a usable font. */
export function bundledCjkFont(script: CjkScript, weight: number): Promise<BundledFont> {
  const w = bundledWeight(weight);
  const key = `${script}:${w}`;
  let found = cache.get(key);
  if (!found) {
    found = (async () => {
      const file = path.join(await fontDir(), `${FAMILY_FILE[script]}-${w}.ttf`);
      const buffer = await fs.readFile(file);
      // TrueType files start with 0x00010000; anything else (an LFS pointer, an HTML page) is refused.
      if (buffer.length < 10_000 || buffer.readUInt32BE(0) !== 0x00010000) throw new Error(`${path.basename(file)} isn't a TrueType font.`);
      const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
      const font = opentype.parse(bytes);
      if (!(font.unitsPerEm > 0) || !(font.charToGlyphIndex(PROBE[script]) > 0)) throw new Error(`${path.basename(file)} doesn't have the expected characters.`);
      return { font, bytes, family: font.names.fontFamily?.en ?? FAMILY_FILE[script], weight: w, file };
    })();
    // A failed read isn't kept, so the next ad tries again.
    found.catch(() => cache.delete(key));
    cache.set(key, found);
  }
  return found;
}

/**
 * A small font holding only `chars` from `source` (same outlines and widths), for Satori and to embed in
 * the editable SVG: the bundled files are megabytes, the characters of one ad a few kilobytes.
 */
export function fontWithOnly(source: opentype.Font, chars: Iterable<string>, family: string, weight: number): ArrayBuffer {
  const notdef = source.glyphs.get(0);
  const glyphs: opentype.Glyph[] = [new opentype.Glyph({ name: ".notdef", unicode: 0, advanceWidth: notdef.advanceWidth ?? source.unitsPerEm, path: notdef.path })];
  const seen = new Set<number>();
  for (const ch of chars) {
    const cp = ch.codePointAt(0)!;
    const index = source.charToGlyphIndex(ch);
    if (!index || seen.has(cp)) continue;
    seen.add(cp);
    const g = source.glyphs.get(index);
    glyphs.push(new opentype.Glyph({ name: `u${cp.toString(16)}`, unicode: cp, advanceWidth: g.advanceWidth ?? source.unitsPerEm, path: g.path }));
  }
  const font = new opentype.Font({
    familyName: family, styleName: weight >= 600 ? "Bold" : "Regular", unitsPerEm: source.unitsPerEm,
    ascender: source.ascender, descender: source.descender, glyphs,
  });
  return font.toArrayBuffer();
}
