import "server-only";
// Reddit- and tweet-style ads, rendered from templates with real text (never AI-drawn letters).
// They're posts from the brand's own account, with no invented likes or replies (POLICY.md PR-5:
// nothing that passes as an organic post by a member of the public, and no fake social proof).
import { ImageResponse } from "next/og";
import { cjkScriptOf } from "@/lib/cjk-fonts";
import type { Aspect, PostCopy } from "@/lib/creative-plan";
import { bundledCjkFont, fontWithOnly } from "@/lib/server/cjk-font-files";

export const SIZES: Record<Aspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

export interface RenderBrand { appName: string; iconUrl?: string; colors: string[]; tagline?: string }
export interface Rendered { bytes: Uint8Array; width: number; height: number; minTextFrac: number; contrast: number; truncated: boolean; warnings: string[] }

/**
 * Posts with Chinese, Japanese or Korean are set in the bundled Noto Sans (lib/server/cjk-font-files.ts,
 * which has Latin too), so next/og never asks Google for a font. A character it lacks is drawn as □ with
 * the composed ads' warning, unless the install opts into Google (CJK_FONT_FALLBACK=google).
 */
async function postFonts(texts: string[]): Promise<{ fonts: { name: string; data: ArrayBuffer; weight: 400; style: "normal" }[]; missing: Set<string> } | null> {
  const all = texts.join("\n");
  const script = cjkScriptOf(all);
  if (!script) return null;
  const bundled = await bundledCjkFont(script, 400);
  const chars = new Set(Array.from(all).filter((ch) => !/\s/.test(ch)));
  const google = process.env.CJK_FONT_FALLBACK === "google";
  const missing = new Set(google ? [] : [...chars].filter((ch) => !(bundled.font.charToGlyphIndex(ch) > 0)));
  return { fonts: [{ name: "PostSans", data: fontWithOnly(bundled.font, [...chars, "□", " ", "\u00a0"], "PostSans", 400), weight: 400, style: "normal" }], missing };
}

const INK = "#0f1419";
const SECONDARY = "#536471"; // 5.9:1 on white
const SECONDARY_CONTRAST = 5.9;
const CARD_WIDTH = 940;
const TEXT_WIDTH = CARD_WIDTH - 2 * 56;

const WIDE_CHAR = /[ᄀ-ᇿ⺀-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/;
const hex = (value: string | undefined) => (value && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : undefined);
const handleOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The largest font size (down to `min`) at which `text` fits in `height` pixels, and the text that fits. */
export function fitText(text: string, height: number, max: number, min: number): { size: number; text: string; truncated: boolean } {
  // About half an em a character, a full em for Chinese, Japanese and Korean (set on a square).
  const ems = (para: string) => Array.from(para).reduce((w, ch) => w + (WIDE_CHAR.test(ch) ? 1 : 0.52), 0);
  const linesAt = (s: string, size: number) => s.split("\n").reduce((n, para) => n + Math.max(1, Math.ceil((ems(para) * size) / TEXT_WIDTH)), 0);
  for (let size = max; size >= min; size -= 2) {
    if (linesAt(text, size) * size * 1.35 <= height) return { size, text, truncated: false };
  }
  let cut = text;
  while (cut.length > 20 && linesAt(`${cut}…`, min) * min * 1.35 > height) cut = cut.slice(0, Math.floor(cut.length * 0.9)).replace(/\s+\S*$/, "");
  return { size: min, text: `${cut}…`, truncated: true };
}

function Icon({ brand, size }: { brand: RenderBrand; size: number }) {
  const color = hex(brand.colors[0]) ?? "#2563eb";
  return brand.iconUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={brand.iconUrl} width={size} height={size} style={{ borderRadius: size * 0.22 }} alt="" />
    : <div style={{ width: size, height: size, borderRadius: size * 0.22, background: color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.5 }}>{brand.appName.slice(0, 1).toUpperCase()}</div>;
}

export async function renderPost(kind: "reddit" | "tweet", aspect: Aspect, copy: PostCopy, brand: RenderBrand, community?: string): Promise<Rendered> {
  const { width, height } = SIZES[aspect];
  const primary = hex(brand.colors[0]) ?? "#7cc4f5";
  const second = hex(brand.colors[1]) ?? primary;
  const meta = 40; // smallest text: names, labels
  // Room for the post text: the card minus its header, footer and padding.
  const room = height - (kind === "reddit" ? 560 : 520);
  const titleSize = copy.title ? Math.min(64, Math.max(48, Math.floor(3200 / Math.max(20, copy.title.length)))) : 0;
  const titleHeight = copy.title ? Math.ceil((copy.title.length * titleSize * 0.52) / TEXT_WIDTH) * titleSize * 1.25 + 24 : 0;
  const body = fitText(copy.body, room - titleHeight, kind === "tweet" ? 58 : 50, meta);
  const handle = handleOf(brand.appName);
  // CJK posts: the bundled font, and □ for anything it can't draw (see postFonts).
  const own = await postFonts([copy.title ?? "", body.text, community ?? "", brand.appName, brand.tagline ?? "", `u/${handle} · Promoted`, `@${handle} · Ad`, `From ${brand.appName}`, "Vote Comment Share"]);
  const box = (text: string) => (own?.missing.size ? Array.from(text).map((ch) => (own.missing.has(ch) ? "□" : ch)).join("") : text);

  const header = kind === "reddit" ? (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <Icon brand={brand} size={84} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: meta + 2, color: INK }}>{box(community || `u/${handle}`)}</div>
        <div style={{ display: "flex", fontSize: meta, color: SECONDARY }}>{`u/${handle} · Promoted`}</div>
      </div>
    </div>
  ) : (
    <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
      <Icon brand={brand} size={96} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: meta + 6, color: INK }}>{box(brand.appName)}</div>
        <div style={{ display: "flex", fontSize: meta, color: SECONDARY }}>{`@${handle} · Ad`}</div>
      </div>
    </div>
  );

  const footer = kind === "reddit"
    ? <div style={{ display: "flex", gap: 40, fontSize: meta, color: SECONDARY }}><span>Vote</span><span>Comment</span><span>Share</span></div>
    : <div style={{ display: "flex", fontSize: meta, color: SECONDARY }}>{box(brand.tagline ? brand.tagline.slice(0, 60) : `From ${brand.appName}`)}</div>;

  const image = new ImageResponse(
    (
      <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(160deg, ${primary}, ${second})` }}>
        <div style={{ width: CARD_WIDTH, display: "flex", flexDirection: "column", gap: 36, padding: 56, background: "#ffffff", borderRadius: 44, boxShadow: "0 30px 80px rgba(0,0,0,0.18)" }}>
          {header}
          {copy.title && <div style={{ display: "flex", fontSize: titleSize, lineHeight: 1.2, color: INK }}>{box(copy.title)}</div>}
          <div style={{ display: "flex", flexDirection: "column", fontSize: body.size, lineHeight: 1.32, color: INK }}>
            {body.text.split("\n").map((para, i) => <div key={i} style={para ? { display: "flex" } : { display: "flex", height: body.size * 0.6 }}>{box(para)}</div>)}
          </div>
          {footer}
        </div>
      </div>
    ),
    { width, height, ...(own ? { fonts: own.fonts } : {}) },
  );
  const bytes = new Uint8Array(await image.arrayBuffer());
  const warnings = own?.missing.size ? [`Some characters aren't in the built-in font: ${[...own.missing].join(" ")}. They show as empty boxes: replace them or upload a brand font that has them.`] : [];
  return { bytes, width, height, minTextFrac: Math.min(meta, body.size) / height, contrast: SECONDARY_CONTRAST, truncated: body.truncated, warnings };
}
