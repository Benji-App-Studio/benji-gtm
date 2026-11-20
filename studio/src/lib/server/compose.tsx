import "server-only";
// Composed ads, server side: sets a composed ad's copy (lib/composed-ads.ts) on its text-free plate in
// the brand's own fonts. Measures with opentype.js, renders the PNG with Satori (next/og), and writes
// an editable SVG (the plate, pills as rects, every line its own <text>, fonts embedded or linked) and
// a layers.json with every line's position and baseline, like static-ads-paper's compose-text.py.
// Text colours are chosen per zone for contrast against the plate behind them. When the batch asked,
// our real logo file goes in the layout's logo slot and the product's real cut-out into its product
// box, resting on a soft floor shadow (the plate left that spot empty); both are separate SVG layers.
// Chinese, Japanese and Korean the brand font lacks come from the fonts bundled with the app (no fetch;
// release/docs/LANGUAGES.md), and only the glyphs an ad uses go to Satori and into the SVG.
import path from "node:path";
import { ImageResponse } from "next/og";
import opentype from "opentype.js";
import sharp from "sharp";
import type { BrandSystem, FontRole } from "@/lib/brand-system";
import { CJK_FAMILY, cjkScriptOf, fontUrlFromCss, subsetCssUrl, TRUETYPE_USER_AGENT, type CjkScript } from "@/lib/cjk-fonts";
import { bestText, fitLayout, fontRuns, hasCjk, luminance, type CanvasLayout, type ComposedCopy, type ComposedLayout, type ComposedPlan, type FontUse, type Measure } from "@/lib/composed-ads";
import type { Aspect } from "@/lib/meta-formats";
import { bundledCjkFont, fontWithOnly, type BundledFont } from "@/lib/server/cjk-font-files";
import { layerPlate } from "@/lib/server/compose-layers";

/** Used when the brand system has no font file for a role (Inter, from @fontsource, WOFF: Satori and opentype.js read it). */
const FALLBACK: Record<FontUse, { url: string; family: string; weight: number }> = {
  headline: { url: "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.1.0/files/inter-latin-700-normal.woff", family: "Inter", weight: 700 },
  body: { url: "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.1.0/files/inter-latin-500-normal.woff", family: "Inter", weight: 500 },
  legal: { url: "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.1.0/files/inter-latin-400-normal.woff", family: "Inter", weight: 400 },
};
const NAME: Record<FontUse, string> = { headline: "BrandHeadline", body: "BrandBody", legal: "BrandLegal" };
/**
 * Characters a brand font (or Inter) can't draw, like the ★ in "4.9★ · 13,000+ ratings", come from this
 * symbols font (Noto Sans Symbols 2: stars, check marks…) instead of rendering as an empty box.
 */
const SYMBOLS = { url: "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-symbols-2@5.1.0/files/noto-sans-symbols-2-symbols-400-normal.woff", name: "BrandSymbols", family: "Noto Sans Symbols 2", weight: 400 };

interface LoadedFont { use: FontUse; data: ArrayBuffer; font: opentype.Font; family: string; weight: number; url: string; fallback: boolean }

/** The whole font step (the brand's files, the symbols font, any CJK fallback) shares one time budget. */
const FONT_BUDGET_MS = 25_000;

const fontCache = new Map<string, Promise<ArrayBuffer>>();
function fetchFont(url: string, timeoutMs = 20_000): Promise<ArrayBuffer> {
  if (!fontCache.has(url)) {
    fontCache.set(url, fetch(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(20_000, timeoutMs))) }).then(async (r) => {
      if (!r.ok) throw new Error(`Couldn't load the font (${r.status}).`);
      const data = await r.arrayBuffer();
      opentype.parse(data); // a file that isn't a font isn't kept
      return data;
    }).catch((e) => { fontCache.delete(url); throw e; }));
  }
  return fontCache.get(url)!;
}

/** The brand's font for each use: its own file for that role, else a related role's, else Inter. */
async function loadFonts(system: BrandSystem | null, timeLeft: () => number): Promise<Record<FontUse, LoadedFont>> {
  const fonts = system?.fonts.filter((f) => f.url) ?? [];
  const pick = (...roles: FontRole[]) => roles.map((r) => fonts.find((f) => f.role === r)).find(Boolean);
  const wanted: Record<FontUse, ReturnType<typeof pick>> = { headline: pick("headline", "body"), body: pick("body", "headline"), legal: pick("legal", "body", "headline") };
  const out = {} as Record<FontUse, LoadedFont>;
  for (const use of ["headline", "body", "legal"] as FontUse[]) {
    const own = wanted[use];
    let loaded: LoadedFont | null = null;
    if (own?.url) {
      try {
        const data = await fetchFont(own.url, timeLeft());
        loaded = { use, data, font: opentype.parse(data), family: own.family, weight: own.weight, url: own.url, fallback: false };
      } catch { /* a file it can't read: Inter instead, with a warning */ }
    }
    if (!loaded) {
      const f = FALLBACK[use];
      const data = await fetchFont(f.url, Math.max(5_000, timeLeft()));
      loaded = { use, data, font: opentype.parse(data), family: f.family, weight: f.weight, url: f.url, fallback: true };
    }
    out[use] = loaded;
  }
  return out;
}

/** A font that draws what the brand font can't: a CJK font for a role, or the symbols font. */
interface ExtraFont { font: opentype.Font; data: ArrayBuffer; name: string; family: string; weight: number; url: string; embed: boolean }
/**
 * What each role's font lacks comes from these, in order: the bundled Noto Sans TC/JP/KR (and, only with
 * CJK_FONT_FALLBACK=google, Google's copy for characters it lacks), then the symbols font. `missing`: CJK
 * characters no font here has (they are set as empty boxes, with a warning).
 */
interface Fallbacks { cjk: Partial<Record<FontUse, ExtraFont[]>>; script: CjkScript | null; symbols: ExtraFont | null; missing: string[] }
const CJK_NAME: Record<FontUse, string> = { headline: "BrandCjkHeadline", body: "BrandCjkBody", legal: "BrandCjkLegal" };

/** The fonts that set a role's text, first choice first. */
const chainOf = (fonts: Record<FontUse, LoadedFont>, fb: Fallbacks, use: FontUse): opentype.Font[] =>
  [fonts[use].font, ...(fb.cjk[use] ?? []).map((f) => f.font), fb.symbols?.font].filter((f): f is opentype.Font => !!f);

/** Widths with the font that draws each run (fontRuns): spaces in the role's font, as Satori draws them. */
const measureWith = (fonts: Record<FontUse, LoadedFont>, fb: Fallbacks): Measure => (text, use, size, tracking) => {
  const chain = chainOf(fonts, fb, use);
  const runs = fontRuns(text, chain.map((f) => (ch: string) => f.charToGlyphIndex(ch) > 0));
  return runs.reduce((w, r) => w + chain[r.font].getAdvanceWidth(r.text, size, { kerning: true }), 0) + Math.max(0, Array.from(text).length - 1) * tracking * size;
};

/** Google's copy is asked for only when the install opts in: it sends the ad's missing characters to Google. */
const googleFallback = () => process.env.CJK_FONT_FALLBACK === "google";

const ttfCache = new Map<string, Promise<ArrayBuffer>>();
/** Noto Sans TC/JP/KR at `weight`, cut down by Google Fonts to the characters in `text` (lib/cjk-fonts.ts). Only with CJK_FONT_FALLBACK=google. */
function fetchCjkSubset(script: CjkScript, weight: number, text: string, timeoutMs: number): Promise<ArrayBuffer> {
  const cssUrl = subsetCssUrl(CJK_FAMILY[script], weight, text);
  if (!ttfCache.has(cssUrl)) {
    if (ttfCache.size > 200) ttfCache.clear();
    ttfCache.set(cssUrl, (async () => {
      const signal = AbortSignal.timeout(timeoutMs);
      const css = await fetch(cssUrl, { headers: { "User-Agent": TRUETYPE_USER_AGENT }, signal });
      if (!css.ok) throw new Error(`Google Fonts answered ${css.status}.`);
      const url = fontUrlFromCss(await css.text());
      if (!url) throw new Error("Google Fonts sent no TrueType file.");
      const file = await fetch(url, { signal });
      if (!file.ok) throw new Error(`Google Fonts answered ${file.status}.`);
      const data = await file.arrayBuffer();
      opentype.parse(data); // a file that isn't a font isn't kept
      return data;
    })().catch((e) => { ttfCache.delete(cssUrl); throw e; }));
  }
  return ttfCache.get(cssUrl)!;
}

const SCRIPT_NAME: Record<CjkScript, string> = { "zh-TW": "Chinese", ja: "Japanese", ko: "Korean" };

/**
 * The fonts for characters the brand's fonts can't draw: Chinese, Japanese and Korean from the fonts
 * bundled with the app (lib/server/cjk-font-files.ts; the script from the copy, Chinese characters alone
 * by `language`) at the role's weight, and stars, check marks and the like in the symbols font. A CJK
 * character outside the bundled set is reported in `missing` (the ad is still made, with a warning);
 * any other character no font here has throws a ComposeError: it would be set as an empty box.
 */
async function fallbacksFor(copy: ComposedCopy, canvas: CanvasLayout, fonts: Record<FontUse, LoadedFont>, language: string | null | undefined, timeLeft: () => number): Promise<Fallbacks> {
  const lacking: Record<FontUse, Set<string>> = { headline: new Set(), body: new Set(), legal: new Set() };
  const used: Record<FontUse, Set<string>> = { headline: new Set(), body: new Set(), legal: new Set() };
  for (const s of canvas.slots) {
    const raw = copy[s.role];
    if (!raw) continue;
    const text = s.uppercase ? raw.toUpperCase() : raw;
    for (const ch of Array.from(text)) {
      if (/\s/.test(ch)) continue;
      used[s.font].add(ch);
      if (!fonts[s.font].font.charToGlyphIndex(ch)) lacking[s.font].add(ch);
    }
  }
  const fb: Fallbacks = { cjk: {}, script: null, symbols: null, missing: [] };
  const uses = (["headline", "body", "legal"] as FontUse[]).filter((use) => lacking[use].size);
  if (!uses.length) return fb;
  fb.script = cjkScriptOf(uses.flatMap((use) => [...lacking[use]]).join(""), language);
  const missing = new Set<string>();
  if (fb.script) {
    const script = fb.script;
    await Promise.all(uses.map(async (use) => {
      const chars = [...lacking[use]].filter((ch) => hasCjk(ch));
      if (!chars.length) return;
      let bundled: BundledFont;
      try {
        bundled = await bundledCjkFont(script, fonts[use].weight);
      } catch (error) {
        console.error("[compose] built-in CJK font:", error);
        const problem = `Couldn't load the ${SCRIPT_NAME[script]} font (${CJK_FAMILY[script]}) to set this copy. Try again in a moment.`;
        throw new ComposeError(problem, [problem]);
      }
      // The ad's own characters only, for Satori and the SVG (the bundled file is megabytes).
      // Every character of the role's lines that it has, punctuation and digits too: Satori may set a whole
      // run ("규칙,") in the font that has its CJK, so the comma must be there as well.
      const drawn = [...used[use]].filter((ch) => bundled.font.charToGlyphIndex(ch) > 0);
      const list: ExtraFont[] = [{
        font: bundled.font, data: fontWithOnly(bundled.font, [...drawn, "□", " ", "\u00a0"], CJK_NAME[use], bundled.weight), name: CJK_NAME[use],
        family: CJK_FAMILY[script], weight: bundled.weight, url: `assets/fonts/cjk/${path.basename(bundled.file)}`, embed: true,
      }];
      let rest = chars.filter((ch) => !(bundled.font.charToGlyphIndex(ch) > 0));
      if (rest.length && googleFallback() && timeLeft() > 1000) {
        try {
          const data = await fetchCjkSubset(script, fonts[use].weight, rest.join(""), timeLeft());
          const font = opentype.parse(data);
          list.push({ font, data, name: `${CJK_NAME[use]}Extra`, family: CJK_FAMILY[script], weight: fonts[use].weight, url: subsetCssUrl(CJK_FAMILY[script], fonts[use].weight, rest.join("")), embed: true });
          rest = rest.filter((ch) => !(font.charToGlyphIndex(ch) > 0));
        } catch (error) { console.error("[compose] Google CJK fallback:", error); }
      }
      rest.forEach((ch) => missing.add(ch));
      fb.cjk[use] = list;
    }));
  }
  fb.missing = [...missing];
  const left = new Map<string, FontUse>();
  for (const use of uses) for (const ch of lacking[use]) if (!missing.has(ch) && !(fb.cjk[use] ?? []).some((f) => f.font.charToGlyphIndex(ch) > 0)) left.set(ch, use);
  if (!left.size) return fb;
  const data = timeLeft() > 500 ? await fetchFont(SYMBOLS.url, timeLeft()).catch(() => null) : null;
  const font = data ? opentype.parse(data) : null;
  const symbolsMissing = [...left.keys()].filter((ch) => !font?.charToGlyphIndex(ch));
  if (symbolsMissing.length) {
    const use = left.get(symbolsMissing[0])!;
    const family = [fonts[use].family, fb.cjk[use]?.[0]?.family].filter(Boolean).join(", ");
    const problem = `${symbolsMissing.map((ch) => `"${ch}"`).join(", ")} can't be set in ${family}${font ? " or the symbols font" : ""}: replace ${symbolsMissing.length === 1 ? "it" : "them"} (e.g. "4.9 stars").`;
    throw new ComposeError(problem, [problem]);
  }
  fb.symbols = { font: font!, data: data!, name: SYMBOLS.name, family: SYMBOLS.family, weight: SYMBOLS.weight, url: SYMBOLS.url, embed: false };
  return fb;
}

/** The brand's ink, light and accent colours (palette by role), with safe defaults. */
function colours(system: BrandSystem | null) {
  const palette = system?.palette ?? [];
  const byLum = [...palette].sort((a, b) => luminance(a.hex) - luminance(b.hex));
  const ink = byLum.find((c) => c.role === "neutral" || c.role === "primary")?.hex ?? byLum[0]?.hex ?? "#111111";
  const light = [...byLum].reverse().find((c) => c.role === "neutral" || c.role === "background")?.hex ?? "#FFFFFF";
  const accent = palette.find((c) => c.role === "accent")?.hex ?? palette.find((c) => c.role === "primary")?.hex ?? ink;
  return { ink: luminance(ink) < 0.2 ? ink : "#111111", light: luminance(light) > 0.6 ? light : "#FFFFFF", accent };
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONT_MIME = (url: string) => (/\.woff(\?|$)/i.test(url) ? "font/woff" : /\.otf(\?|$)/i.test(url) ? "font/otf" : "font/ttf");
/** Fonts are embedded in the SVG up to this many bytes in all; bigger ones are linked by URL. */
const EMBED_FONTS_MAX = 3 * 1024 * 1024;

export class ComposeError extends Error {
  constructor(message: string, readonly problems: string[]) { super(message); }
}

export interface ComposedOutput {
  png: Buffer;
  svg: string;
  layers: Record<string, unknown>;
  plan: ComposedPlan;
  warnings: string[];
  /** For QA: the smallest text as a share of the height, and the lowest text/background contrast. */
  minTextFrac: number;
  contrast: number;
}

const pngDataUrl = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;

/**
 * Sets `copy` on the plate in the layout's canvas for `aspect`, with our real `logo` file in the logo
 * slot and the real `product` cut-out in the product box when given. Throws ComposeError (with the
 * problems) when the copy doesn't fit at the type floors. Chinese, Japanese and Korean copy is set in
 * the bundled Noto Sans TC/JP/KR where the brand font has no such characters; `language` (the ad's language, else the
 * page's: "ja", "zh-TW"…) decides the glyph shapes for copy written in Chinese characters alone.
 */
export async function composeAd(o: { plate: Uint8Array; aspect: Aspect; layout: ComposedLayout; copy: ComposedCopy; system: BrandSystem | null; logo?: Uint8Array | null; product?: Uint8Array | null; language?: string | null }): Promise<ComposedOutput> {
  const canvas: CanvasLayout = o.layout.canvases[o.aspect] ?? o.layout.canvases["4:5"]!;
  const { width: W, height: H } = canvas;
  const deadline = Date.now() + FONT_BUDGET_MS;
  const timeLeft = () => deadline - Date.now();
  const fonts = await loadFonts(o.system, timeLeft);
  const fb = await fallbacksFor(o.copy, canvas, fonts, o.language, timeLeft);
  const symbols = fb.symbols;
  // A character no font here has is set as a visible box (□, in the bundled fonts) rather than left to
  // Satori, which would otherwise fetch a font for it from Google with the character in the address.
  const missing = new Set(fb.missing);
  const drawn: ComposedCopy = missing.size
    ? Object.fromEntries(Object.entries(o.copy).map(([k, v]) => [k, typeof v === "string" ? Array.from(v).map((ch) => (missing.has(ch) ? "□" : ch)).join("") : v])) as ComposedCopy
    : o.copy;
  const plan = fitLayout(drawn, canvas, measureWith(fonts, fb));
  if (plan.errors.length) throw new ComposeError(plan.errors[0], plan.errors);
  const warnings = [...plan.warnings];
  for (const use of ["headline", "body"] as FontUse[]) if (fonts[use].fallback) warnings.push(`No ${use} font file in the brand system: set in Inter. Upload it on the Brand page.`);
  if (fb.missing.length) warnings.push(`Some characters aren't in the built-in font: ${fb.missing.join(" ")}. They show as empty boxes: replace them or upload a brand font that has them.`);

  // The plate at the canvas size (cover: a 3:4 plate made for 4:5 loses a sliver top and bottom).
  const bare = await sharp(o.plate).rotate().resize(W, H, { fit: "cover", position: "centre" }).removeAlpha().jpeg({ quality: 92 }).toBuffer();
  // Then the real product (on its floor shadow) and our real logo, before any text colour is chosen.
  const { plate, product, logo } = await layerPlate(bare, canvas, { logo: o.logo, product: o.product });
  const palette = colours(o.system);
  const zoneLum = async (left: number, top: number, width: number, height: number) => {
    const region = { left: Math.max(0, Math.floor(left)), top: Math.max(0, Math.floor(top)), width: Math.max(1, Math.min(W - Math.floor(left), Math.ceil(width))), height: Math.max(1, Math.min(H - Math.floor(top), Math.ceil(height))) };
    const stats = await sharp(plate).extract(region).stats();
    return luminance([stats.channels[0].mean, stats.channels[1].mean, stats.channels[2].mean]);
  };

  // A colour for every text (and its pill): the best-reading of the brand's ink and light on what's behind it.
  const styled = await Promise.all(plan.texts.map(async (t) => {
    if (t.pill) {
      const fill = t.pill.kind === "accent" ? palette.accent : palette.ink;
      const best = bestText(luminance(fill), [palette.light, palette.ink, "#FFFFFF"]);
      return { t, color: best.color, ratio: best.ratio, fill };
    }
    const left = Math.min(...t.lines.map((l) => l.x)), right = Math.max(...t.lines.map((l) => l.x + l.width));
    const top = t.lines[0].top, bottom = t.lines[t.lines.length - 1].top + t.size * 1.1;
    const bg = await zoneLum(left, top, right - left, bottom - top);
    const best = bestText(bg, t.role === "eyebrow" ? [palette.accent, palette.ink, palette.light] : [palette.ink, palette.light]);
    return { t, color: best.color, ratio: best.ratio, fill: null as string | null };
  }));
  const contrastMin = Math.min(...styled.map((s) => s.ratio));
  if (contrastMin < 4.5) warnings.push(`Lowest text contrast is ${contrastMin.toFixed(1)}:1 (aim for 4.5:1): the plate is busy behind the copy; regenerate it or pick another layout.`);
  const minTextFrac = Math.min(...plan.texts.map((t) => t.size / H));

  // PNG: Satori draws every line where the plan put it (on the plate with the product and logo in place).
  // Each role's font first, then its CJK cut and the symbols font for what it lacks.
  const familyOf = (use: FontUse) => [NAME[use], ...(fb.cjk[use] ?? []).map((f) => f.name), symbols?.name].filter(Boolean).join(", ");
  const cjkFaces = Object.values(fb.cjk).flatMap((list) => list ?? []);
  const dataUrl = `data:image/jpeg;base64,${plate.toString("base64")}`;
  const bareUrl = product || logo ? `data:image/jpeg;base64,${bare.toString("base64")}` : dataUrl;
  const element = (
    <div style={{ width: W, height: H, display: "flex", position: "relative" }}>
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img src={dataUrl} width={W} height={H} style={{ position: "absolute", left: 0, top: 0, width: W, height: H }} />
      {styled.filter((s) => s.t.pill).map(({ t, fill }, i) => (
        <div key={`p${i}`} style={{ position: "absolute", left: t.pill!.left, top: t.pill!.top, width: t.pill!.width, height: t.pill!.height, borderRadius: t.pill!.radius, backgroundColor: fill! }} />
      ))}
      {styled.flatMap(({ t, color }) => t.lines.map((line, i) => (
        <div key={`${t.role}${i}`} style={{
          position: "absolute", left: line.x, top: line.top, display: "flex", whiteSpace: "pre", color,
          fontFamily: familyOf(t.font), fontSize: t.size, lineHeight: `${t.size * 1.1}px`, letterSpacing: `${t.tracking}em`,
        }}>{line.text}</div>
      )))}
    </div>
  );
  const png = Buffer.from(await new ImageResponse(element, {
    width: W, height: H,
    fonts: [
      ...(["headline", "body", "legal"] as FontUse[]).map((use) => ({ name: NAME[use], data: fonts[use].data, weight: fonts[use].weight as 400, style: "normal" as const })),
      ...cjkFaces.map((f) => ({ name: f.name, data: f.data, weight: f.weight as 400, style: "normal" as const })),
      ...(symbols ? [{ name: SYMBOLS.name, data: symbols.data, weight: SYMBOLS.weight as 400, style: "normal" as const }] : []),
    ],
  }).arrayBuffer());

  // Editable SVG: plate, pills, one <text> per line; fonts embedded when small enough, else linked.
  const totalFontBytes = [...new Map(Object.values(fonts).map((f) => [f.url, f.data.byteLength])).values()].reduce((a, b) => a + b, 0);
  const embed = totalFontBytes <= EMBED_FONTS_MAX;
  const faces = (["headline", "body", "legal"] as FontUse[]).map((use) => {
    const f = fonts[use];
    const src = embed ? `data:${FONT_MIME(f.url)};base64,${Buffer.from(f.data).toString("base64")}` : f.url;
    return `@font-face{font-family:'${NAME[use]}';src:url('${src}');font-weight:${f.weight};}`;
  }).join("")
    // The CJK cuts hold only this ad's characters (tens of KB), so they are always embedded.
    + cjkFaces.map((f) => `@font-face{font-family:'${f.name}';src:url('data:${new TextDecoder().decode(f.data.slice(0, 4)) === "OTTO" ? "font/otf" : "font/ttf"};base64,${Buffer.from(f.data).toString("base64")}');font-weight:${f.weight};}`).join("")
    + (symbols ? `@font-face{font-family:'${SYMBOLS.name}';src:url('${SYMBOLS.url}');font-weight:${SYMBOLS.weight};}` : "");
  /** In the SVG: our embedded faces, then the families by name, for an editor that has them installed. */
  const svgFamily = (use: FontUse) => [NAME[use], escapeXml(fonts[use].family), ...(fb.cjk[use] ?? []).map((f) => `${f.name}, ${f.family}`), symbols ? SYMBOLS.name : "", "sans-serif"].filter(Boolean).join(", ");
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<defs><style>${faces}</style></defs>`,
    `<image id="plate" x="0" y="0" width="${W}" height="${H}" href="${bareUrl}" xlink:href="${bareUrl}"/>`,
    product ? `<g id="product"><image id="product-shadow" x="${Math.round(product.shadow.left)}" y="${Math.round(product.shadow.top)}" width="${product.shadow.width}" height="${product.shadow.height}" href="${pngDataUrl(product.shadow.png)}"/><image id="product-cutout" x="${product.place.left}" y="${product.place.top}" width="${product.place.width}" height="${product.place.height}" href="${pngDataUrl(product.png)}"/></g>` : "",
    logo ? `<image id="logo" x="${logo.rect.left}" y="${logo.rect.top}" width="${logo.rect.width}" height="${logo.rect.height}" href="${pngDataUrl(logo.png)}"/>` : "",
    `<g id="copy">`,
    ...styled.map(({ t, color, fill }) => [
      `<g id="${t.role}">`,
      t.pill ? `<rect id="${t.role}-pill" x="${t.pill.left.toFixed(1)}" y="${t.pill.top.toFixed(1)}" width="${t.pill.width.toFixed(1)}" height="${t.pill.height.toFixed(1)}" rx="${t.pill.radius.toFixed(1)}" fill="${fill}"/>` : "",
      ...t.lines.map((line, i) => `<text id="${t.role}-${i + 1}" x="${line.x.toFixed(1)}" y="${line.baseline.toFixed(1)}" font-family="${svgFamily(t.font)}"${fb.script ? ` xml:lang="${fb.script}"` : ""} font-weight="${fonts[t.font].weight}" font-size="${t.size.toFixed(1)}" letter-spacing="${(t.tracking * t.size).toFixed(2)}" fill="${color}">${escapeXml(line.text)}</text>`),
      `</g>`,
    ].join("")),
    `</g></svg>`,
  ].join("");

  const layers = {
    aspect: o.aspect, layout: o.layout.id, width: W, height: H,
    ...(logo ? { logo: { box: logo.rect } } : {}),
    ...(product ? { product: { box: { left: product.place.left, top: product.place.top, width: product.place.width, height: product.place.height }, shadow: product.place.shadow } } : {}),
    fonts: Object.fromEntries((["headline", "body", "legal"] as FontUse[]).map((use) => [use, {
      family: fonts[use].family, weight: fonts[use].weight, url: fonts[use].url, fallback: fonts[use].fallback,
      ...(fb.cjk[use]?.length ? { cjk: { family: fb.cjk[use]![0].family, weight: fb.cjk[use]![0].weight, script: fb.script, source: fb.cjk[use]!.map((f) => f.url) } } : {}),
    }])),
    layers: styled.map(({ t, color, ratio, fill }) => ({
      id: t.role, text: o.copy[t.role], font: t.font, size_px: Math.round(t.size * 10) / 10, line_height: t.lineHeight, align: t.align, color, contrast: Math.round(ratio * 10) / 10,
      ...(t.pill ? { pill: { ...t.pill, fill } } : {}),
      lines: t.lines.map((l) => ({ text: l.text, x: Math.round(l.x * 10) / 10, top: Math.round(l.top * 10) / 10, baseline_y: Math.round(l.baseline * 10) / 10, width: Math.round(l.width * 10) / 10 })),
    })),
  };
  return { png, svg, layers, plan, warnings, minTextFrac, contrast: Math.round(contrastMin * 10) / 10 };
}
