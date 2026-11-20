// Brand import: reads a brand guide into a BrandSystem, in the browser. Two ways in:
// - a brand folder, one file per part: visual-guidelines.md, brand-voice.md, avatars.md, offers.md,
//   counter-positioning.md, color-palette.json, typography.json and products.json, with fonts/, logos/
//   and product-images/ beside them;
// - one guide, pasted or picked (any other .md or .json file): the same parts are found by their
//   headings (Markdown) or their keys (JSON), and only the parts it has are read (`parts`).
// Font files, logos and product images are only listed here; the Brand page uploads them (fonts to the
// workspace bucket, images as product images) and fills in the font URLs and each product's image ids.
// Pure; tested in scripts/creative-runner/tests/brand-system.test.ts.
import { fill, m, type Translator } from "./i18n/translate";
import { cleanBrandSystem, EMPTY_BRAND_SYSTEM, type BrandAvatar, type BrandFont, type BrandOffer, type BrandProduct, type BrandSystem, type ColorRole, type FontRole } from "./brand-system";

export interface ImportFile { path: string; text?: string }
export interface FontFileTask { path: string; family: string; role: FontRole; weight: number }
export interface ImageTask { path: string; kind: "logo" | "product"; label: string; productSlug?: string }
export interface BrandImport {
  system: BrandSystem;
  fonts: FontFileTask[];
  images: ImageTask[];
  /** What was read, for the import summary. */
  read: string[];
  warnings: string[];
  /** The parts of the system this import brings; the Brand page keeps every other part as it is. */
  parts: (keyof BrandSystem)[];
}

/** The headings a pasted guide is read by, for the Brand page's help. */
export const GUIDE_HEADINGS: { part: string; headings: string }[] = [
  { part: m("Look"), headings: "## Prompt modifier, ## Photography, ## Packaging, ## Ad formats (bullets like \"- **Lighting:** soft daylight\")" },
  { part: m("Voice"), headings: "## Voice in one line, ## How it sounds, ## Words we use, ## Words we never use (or ## Vocabulary), ## Signature lines, ## Example copy" },
  { part: m("Positioning"), headings: "## Counter-position, ## Value proposition, ## What this brand stands against" },
  { part: m("Offers"), headings: "## Offers, then ### O1 — Free trial, 7 days free (one per offer), ## Stacking rules, ## Not offered" },
  { part: m("People"), headings: "## 1. The busy parent — \"Maya\", 30–45 (one per person, with bullets like \"- **Wants:** …\")" },
  { part: m("Colours"), headings: "## Colours, with bullets like \"- Ink #111111 (primary)\"; or JSON: { \"primary\": [{ \"name\": \"Ink\", \"hex\": \"#111111\" }], \"accent\": [] }" },
];

const base = (path: string) => path.split("/").pop() ?? path;
const dirOf = (path: string) => path.split("/").slice(-2, -1)[0] ?? "";
const clean = (t: string) => t.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();

/** `## Heading` → body, keyed by the lower-cased heading (level 2 by default). */
export function sections(md: string, level = 2): Map<string, string> {
  const out = new Map<string, string>();
  const marker = `${"#".repeat(level)} `;
  let key: string | null = null;
  let body: string[] = [];
  for (const line of md.replace(/\r/g, "").split("\n")) {
    if (line.startsWith(marker) && !line.startsWith(`${marker}#`)) {
      if (key !== null) out.set(key, body.join("\n").trim());
      key = line.slice(marker.length).trim().toLowerCase();
      body = [];
    } else if (key !== null) body.push(line);
  }
  if (key !== null) out.set(key, body.join("\n").trim());
  return out;
}

/** The body of the first section whose heading starts with (or contains) `name`. */
const section = (all: Map<string, string>, ...names: string[]) => {
  for (const name of names) for (const [k, v] of all) if (k.startsWith(name)) return v;
  for (const name of names) for (const [k, v] of all) if (k.includes(name)) return v;
  return "";
};

/** Top-level bullets ("- …", continuation lines joined), without their dash. */
export function bullets(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split("\n")) {
    if (/^\s{0,1}[-*]\s+/.test(line)) out.push(line.replace(/^\s{0,1}[-*]\s+/, ""));
    else if (/^\s{2,}\S/.test(line) && out.length) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out.map((b) => b.trim()).filter(Boolean);
}

/** "**Label:** value" bullets as label → value (labels lower-cased). */
export function labelled(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of bullets(body)) {
    const m = b.match(/^\*\*([^*]+?):?\*\*:?\s*(.*)$/);
    if (m) out.set(m[1].replace(/:$/, "").trim().toLowerCase(), clean(m[2]));
  }
  return out;
}
const pick = (m: Map<string, string>, ...keys: string[]) => {
  for (const k of keys) for (const [label, v] of m) if (label.startsWith(k)) return v;
  return "";
};

/**
 * The words or lines in a value: quoted phrases when that's all it is, else its items split on nested
 * bullets, commas, semicolons and " / " (quotes and end punctuation off).
 */
export function phrases(text: string): string[] {
  const nested = /\s-\s/.test(` ${text}`);
  const quoted = [...text.matchAll(/["“]([^"”]{2,200})["”]/g)].map((m) => m[1].trim());
  if (quoted.length && !nested && quoted.join("").length >= text.replace(/[^A-Za-z]/g, "").length * 0.5) return quoted;
  return [...new Set(` ${text}`.split(/\s-\s|[;,·•]|\s\/\s|\s→\s/).map((x) => clean(x).replace(/^["'“]+|["'”.]+$/g, "").replace(/\.$/, "").trim()).filter((x) => x && x.length <= 80))];
}

/** A section's own text, before any sub-heading inside it (in one pasted guide the next part may follow). */
const untilHeading = (body: string) => { const lines = body.split("\n"); const at = lines.findIndex((l) => /^#{1,6}\s/.test(l)); return (at < 0 ? lines : lines.slice(0, at)).join("\n"); };

/** The prompt modifier: the paragraph (or block quote) under its heading, without brackets or quote marks. */
function modifierOf(body: string): string {
  return untilHeading(body).split("\n").map((l) => l.replace(/^>\s?/, "").trim()).filter((l) => l && !/^\(.*\)$/.test(l)).join(" ").replace(/^\[|\]$/g, "").trim();
}

// MARK: Files

function visualGuidelines(md: string, sys: BrandSystem) {
  const all = sections(md);
  const photo = labelled(section(all, "photography"));
  const pack = labelled(section(all, "packaging"));
  const ads = labelled(section(all, "ad formats"));
  sys.look = {
    ...sys.look,
    promptModifier: modifierOf(section(all, "prompt modifier")),
    lighting: pick(photo, "lighting"), grade: pick(photo, "colour grade", "color grade"), composition: pick(photo, "composition"),
    subjects: pick(photo, "what appears", "subjects"), surfaces: pick(photo, "surfaces"), mood: pick(photo, "overall mood", "mood"),
    packaging: [...pack.entries()].map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)}: ${v}`).join(" "),
    textOnImage: pick(ads, "text on image"), offerStyle: pick(ads, "pricing"),
  };
  // A one-page capsule's "Prompt modifier" can also come as "> …" inside brand-context.md; this file wins.
}

/** A guide can name its word lists with their own headings instead of bullets under "Vocabulary". */
const USE_HEADINGS = ["words we use", "words to use", "words the brand uses"];
const AVOID_HEADINGS = ["words we never use", "words we avoid", "words to avoid", "words the brand avoids", "never say"];
/** The Vocabulary bullet's words, else the words under the section's own heading (one per bullet, or a comma list). */
const words = (fromVocabulary: string, body: string): string[] => {
  if (fromVocabulary) return phrases(fromVocabulary);
  const own = untilHeading(body);
  const items = bullets(own);
  return (items.length ? items.flatMap((b) => phrases(b)) : phrases(own.split("\n").filter((l) => l.trim()).join(", "))).slice(0, 40);
};

function brandVoice(md: string, sys: BrandSystem) {
  const all = sections(md);
  const vocab = labelled(section(all, "vocabulary"));
  const dosDonts = bullets(section(all, "do / don", "do/don", "dos"));
  sys.voice = {
    oneLine: clean(untilHeading(section(all, "voice in one line")).split("\n").filter((l) => l.trim() && !l.startsWith("[")).join(" ")),
    rules: bullets(section(all, "how it sounds")).map(clean),
    use: words(pick(vocab, "words the brand uses", "words we use", "uses"), section(all, ...USE_HEADINGS)),
    avoid: words(pick(vocab, "words the brand avoids", "words we avoid", "avoids"), section(all, ...AVOID_HEADINGS)),
    signatureLines: bullets(section(all, "signature")).flatMap((b) => phrases(b).length ? phrases(b) : [clean(b)]).slice(0, 12),
    examples: bullets(section(all, "example copy")).map(clean),
    dos: dosDonts.filter((b) => b.startsWith("✅")).map((b) => clean(b.replace(/^✅\s*/, ""))),
    donts: dosDonts.filter((b) => b.startsWith("❌")).map((b) => clean(b.replace(/^❌\s*/, ""))),
    // Forbidden claims are the brand's own list on the Brand page; an import keeps them (brand-view.tsx).
    forbiddenClaims: sys.voice.forbiddenClaims ?? [],
  };
}

/** "## 1. The Busy Parent — "Maya", 30–45" and its six bullets. */
export function parseAvatars(md: string): BrandAvatar[] {
  const out: BrandAvatar[] = [];
  for (const [heading, body] of sections(md)) {
    const quoted = heading.match(/["“]([^"”]+)["”]/);
    if (!quoted) continue;
    const raw = md.split("\n").find((l) => l.toLowerCase() === `## ${heading}`) ?? `## ${heading}`;
    const original = raw.slice(3);
    const name = (original.match(/["“]([^"”]+)["”]/)?.[1] ?? quoted[1]).trim();
    const type = clean(original.replace(/^\d+[.)]\s*/, "").split(/\s+[—–-]\s+["“]/)[0]);
    const age = original.split(/["”],?\s*/).pop()?.trim() ?? "";
    const f = labelled(body);
    const objections = [...pick(f, "objections").matchAll(/["“]([^"”]+)["”]\s*\(?\s*(?:→|->)\s*([^)"“]+)\)?/g)].map((m) => ({ doubt: m[1].trim(), answer: clean(m[2]).replace(/[;.]$/, "") }));
    out.push({
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, type: [type, age && /\d/.test(age) ? age : ""].filter(Boolean).join(", "),
      moment: pick(f, "morning", "life", "moment"), painWords: phrases(pick(f, "pain words")).slice(0, 10), wants: pick(f, "wants"),
      objections, driver: pick(f, "emotional driver"), pov: pick(f, "congruent ad pov", "ad pov", "pov"),
    });
  }
  return out;
}

/** "### O1 — Free skin scan" / "### O2 — Treatment plans, From $9.99/month", plus the rules and what isn't offered. */
export function parseOffers(md: string): { offers: BrandOffer[]; rules: string[]; notOffered: string[] } {
  const offers: BrandOffer[] = [];
  for (const [heading, body] of sections(md, 3)) {
    const raw = md.split("\n").find((l) => l.toLowerCase() === `### ${heading}`)?.slice(4) ?? heading;
    const m = raw.match(/^\s*(O\d+)\s*[—–:-]\s*(.+)$/i);
    if (!m) continue;
    let name = clean(m[2]).replace(/\s+[—–-]\s+code\s+.*/i, "");
    let wording = "";
    const tail = name.match(/^(.*?),\s*([^,]*[\d$€£¥%][^,]*)$/);
    if (tail) { name = tail[1].trim(); wording = tail[2].trim(); }
    const said = body.match(/(?:exact wording|say|wording)[^"“]*["“]([^"”]+)["”]/i)?.[1];
    if (said) wording = said.trim();
    offers.push({ id: m[1].toUpperCase(), name, wording, terms: bullets(body).map(clean).join(" ").slice(0, 600) });
  }
  const all = sections(md);
  const rules = bullets(section(all, "stacking")).concat(section(all, "stacking").split("\n").filter((l) => /^\d+\.\s/.test(l)).map((l) => l.replace(/^\d+\.\s*/, ""))).map(clean);
  const notOffered = bullets(section(all, "not available", "not offered", "do not use", "never offer")).map((b) => clean(b).replace(/[.;]$/, "").slice(0, 120));
  return { offers, rules: [...new Set(rules)].slice(0, 10), notOffered };
}

function counterPositioning(md: string, sys: BrandSystem) {
  const all = sections(md);
  const para = (body: string) => clean(untilHeading(body).split("\n").filter((l) => l.trim()).join(" ")).slice(0, 600);
  sys.positioning = {
    counterPosition: para(section(all, "counter-position")),
    valueProposition: para(section(all, "value proposition")),
    standsAgainst: para(section(all, "what this brand stands against", "stands against")),
  };
}

const ROLE_OF: Record<string, ColorRole> = { primary: "primary", secondary: "secondary", accent: "accent", neutral: "neutral", background: "background" };

function palette(json: string, sys: BrandSystem, warnings: string[], t: Translator["t"]) {
  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    sys.palette = Object.entries(ROLE_OF).flatMap(([key, role]) => (Array.isArray(data[key]) ? data[key] as Record<string, unknown>[] : [])
      .map((c) => ({ name: String(c.name ?? ""), hex: String(c.hex ?? ""), role, use: String(c.use ?? "") })));
  } catch { warnings.push(t("color-palette.json isn't valid JSON; colours skipped.")); }
}

const COLOUR_HEADINGS = ["colours", "colors", "colour palette", "color palette", "palette"];
const HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/;

/** "## Colours" in a guide: one colour per bullet, "- Pine #1B5E20 (primary)" or "- **Primary:** Pine #1B5E20, for buttons". */
export function parseColours(md: string): BrandSystem["palette"] {
  const out: BrandSystem["palette"] = [];
  for (const raw of bullets(untilHeading(section(sections(md), ...COLOUR_HEADINGS)))) {
    const hex = raw.match(HEX)?.[0];
    if (!hex) continue;
    const text = clean(raw);
    const named = Object.keys(ROLE_OF).find((role) => new RegExp(`\\b${role}\\b`, "i").test(text));
    // No role written: the first colour leads, the rest are accents.
    const role: ColorRole = named ? ROLE_OF[named] : out.some((c) => c.role === "primary") ? "accent" : "primary";
    const [before, after = ""] = text.split(hex);
    const tidy = (t: string) => t.replace(new RegExp(`\\(?\\b(${Object.keys(ROLE_OF).join("|")})\\b\\)?:?`, "ig"), "").replace(/^[\s:,;.()\u2013\u2014-]+|[\s:,;.()\u2013\u2014-]+$/g, "").trim();
    out.push({ name: tidy(before).slice(0, 60), hex: hex.toUpperCase(), role, use: tidy(after).slice(0, 160) });
  }
  return out;
}

const WEIGHT_NAMES: [RegExp, number][] = [[/thin|hairline/i, 100], [/extra-?light|ultra-?light/i, 200], [/light/i, 300], [/medium/i, 500], [/semi-?bold|demi-?bold/i, 600], [/extra-?bold|ultra-?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700], [/regular|book|normal|roman/i, 400]];
export const weightFromName = (name: string) => WEIGHT_NAMES.find(([re]) => re.test(name))?.[1] ?? 400;
const FONT_ROLE: Record<string, FontRole> = { heading: "headline", headline: "headline", display: "headline", title: "headline", body: "body", ui: "body", text: "body", accent: "accent", serif: "accent", legal: "legal", caption: "legal" };
const FONT_EXT = /\.(ttf|otf|woff)$/i; // Satori (composed ads) reads TTF, OTF and WOFF, not WOFF2

/** typography.json's fonts by role, each matched to a font file in fonts/ (family words + weight in its name). */
function typography(json: string, sys: BrandSystem, fontFiles: string[], warnings: string[], t: Translator["t"]): FontFileTask[] {
  const tasks: FontFileTask[] = [];
  try {
    const data = JSON.parse(json) as { fonts?: Record<string, unknown>[] };
    const fonts: BrandFont[] = [];
    for (const f of data.fonts ?? []) {
      const family = String(f.family ?? "").trim();
      if (!family || family.toLowerCase() === "unknown") continue;
      const role = FONT_ROLE[String(f.role ?? "").toLowerCase()] ?? "body";
      const weights = (Array.isArray(f.weights) ? f.weights : String(f.weights ?? "").split(/[,;\s–-]+/)).map((w) => (Number(w) >= 100 ? Math.round(Number(w)) : weightFromName(String(w ?? "")))).filter((w) => w >= 100 && w <= 900);
      const weight = role === "headline" ? Math.max(...(weights.length ? weights : [600])) : role === "body" ? (weights.includes(500) ? 500 : weights[0] ?? 400) : weights[0] ?? 400;
      const words = family.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const candidates = fontFiles.filter((p) => FONT_EXT.test(p) && words.every((w) => base(p).toLowerCase().includes(w)));
      const file = candidates.find((p) => weightFromName(base(p)) === weight) ?? candidates.find((p) => weightFromName(base(p)) === 400) ?? candidates[0];
      fonts.push({ role, family, weight: file ? weightFromName(base(file)) : weight, description: String(f.description ?? "").slice(0, 300) });
      if (file) tasks.push({ path: file, family, role, weight: weightFromName(base(file)) });
      else warnings.push(t("No TTF/OTF/WOFF file for {family} ({role}) in fonts/: composed ads fall back to a system font for it.", { family, role }));
    }
    // Legal text: the body face at Regular, when there's a file for it.
    const body = fonts.find((f) => f.role === "body");
    if (body && !fonts.some((f) => f.role === "legal")) {
      const words = body.family.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const regular = fontFiles.find((p) => FONT_EXT.test(p) && words.every((w) => base(p).toLowerCase().includes(w)) && weightFromName(base(p)) === 400);
      fonts.push({ role: "legal", family: body.family, weight: 400, description: "The body face at Regular, for legal lines." });
      if (regular) tasks.push({ path: regular, family: body.family, role: "legal", weight: 400 });
    }
    sys.fonts = fonts;
  } catch { warnings.push(t("typography.json isn't valid JSON; fonts skipped.")); }
  return tasks;
}

/** products.json's products, each with its images in product-images/ (files named <slug>-NN.*). */
function products(json: string, sys: BrandSystem, imageFiles: string[], warnings: string[], t: Translator["t"]): ImageTask[] {
  const tasks: ImageTask[] = [];
  try {
    const data = JSON.parse(json) as { products?: Record<string, unknown>[] };
    const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : typeof v === "string" && v ? [v] : []);
    sys.products = (data.products ?? []).map((p): BrandProduct => {
      const name = String(p.name ?? "");
      const slug = String(p.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
      const named = new Set(arr(p.images).map(base));
      const files = imageFiles.filter((f) => named.has(base(f)) || base(f).toLowerCase().startsWith(`${slug.toLowerCase()}-`));
      for (const f of files.slice(0, 6)) tasks.push({ path: f, kind: "product", label: name, productSlug: slug });
      const results = typeof p.results_timeline === "string" ? p.results_timeline : Array.isArray(p.results_timeline) ? arr(p.results_timeline).join("; ") : String(p.results ?? "");
      return {
        slug, name, category: String(p.category ?? ""), description: String(p.description ?? ""), claims: arr(p.claims),
        uses: [...arr(p.concerns), ...arr(p.uses)], results, warnings: arr(p.warnings), price: String(p.price ?? ""), size: String(p.size ?? ""),
        accent: String(p.cap_hex ?? p.accent ?? p.color ?? ""), assetIds: [],
      };
    });
  } catch { warnings.push(t("products.json isn't valid JSON; products skipped.")); }
  return tasks;
}

/** The start (or a part) of every `##` heading a guide is read by. */
const READ_HEADINGS = [
  "prompt modifier", "photography", "packaging", "ad formats", "voice in one line", "how it sounds", "vocabulary", "signature", "example copy",
  "do / don", "do/don", "dos", ...USE_HEADINGS, ...AVOID_HEADINGS, "counter-position", "value proposition", "stands against", "offers", "stacking",
  "not available", "not offered", "do not use", "never offer", ...COLOUR_HEADINGS,
];
/** The `##` headings of a guide that no part is read from, as written (a person's heading, with a quoted name, is read). */
function unreadHeadings(md: string): string[] {
  return md.replace(/\r/g, "").split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim())
    .filter((h) => h && !/["“][^"”]+["”]/.test(h) && !READ_HEADINGS.some((known) => h.toLowerCase().includes(known)));
}

const KNOWN = ["visual-guidelines.md", "brand-voice.md", "avatars.md", "offers.md", "counter-positioning.md", "color-palette.json", "typography.json", "products.json", "brand-context.md"];
const hasHeading = (md: string, ...names: string[]) => { const all = [...sections(md).keys()]; return names.some((n) => all.some((k) => k.includes(n))); };

/** Everything the folder (or one guide) holds, read into a brand system plus the files to upload. `t` words the summary and warnings. */
export function readBrandFolder(files: ImportFile[], folderName = "", t: Translator["t"] = fill): BrandImport {
  const count = (n: number, one: string, other: string) => t(n === 1 ? one : other, { n });
  const sys: BrandSystem = structuredClone(EMPTY_BRAND_SYSTEM);
  const read: string[] = [];
  const warnings: string[] = [];
  const parts = new Set<keyof BrandSystem>();
  const paths = files.map((f) => f.path);
  // A file that isn't one of the folder's own is a guide: its parts are found by heading or by key.
  const guides = files.filter((f) => typeof f.text === "string" && /\.(md|markdown|txt|json)$/i.test(f.path) && !KNOWN.includes(base(f.path).toLowerCase()));
  const guideMd = guides.filter((f) => !/\.json$/i.test(f.path)).map((f) => f.text as string);
  const guideJson = guides.filter((f) => /\.json$/i.test(f.path)).map((f) => f.text as string);
  const named = (name: string) => files.find((f) => base(f.path).toLowerCase() === name && typeof f.text === "string")?.text;
  const md = (name: string, ...headings: string[]) => named(name) ?? guideMd.find((g) => hasHeading(g, ...headings));
  const json = (name: string, ...keys: string[]) => named(name) ?? guideJson.find((g) => { try { const d = JSON.parse(g) as Record<string, unknown>; return keys.some((k) => k in d); } catch { return false; } });

  const vg = md("visual-guidelines.md", "prompt modifier", "photography", "packaging", "ad formats");
  if (vg) { visualGuidelines(vg, sys); read.push(t("look")); parts.add("look"); }
  if (!sys.look.promptModifier) {
    const capsule = named("brand-context.md");
    const quote = capsule?.split("\n").filter((l) => l.startsWith(">")).map((l) => l.replace(/^>\s?/, "")).join(" ").trim();
    if (quote) { sys.look.promptModifier = quote; parts.add("look"); }
  }
  const voice = md("brand-voice.md", "voice in one line", "how it sounds", "vocabulary", "signature", "example copy", ...USE_HEADINGS, ...AVOID_HEADINGS);
  if (voice) { brandVoice(voice, sys); read.push(t("voice")); parts.add("voice"); }
  const avatars = named("avatars.md") ?? guideMd.find((g) => parseAvatars(g).length > 0);
  if (avatars) { sys.avatars = parseAvatars(avatars); read.push(count(sys.avatars.length, m("{n} person"), m("{n} people"))); parts.add("avatars"); }
  const offers = named("offers.md") ?? guideMd.find((g) => parseOffers(g).offers.length > 0);
  if (offers) {
    const o = parseOffers(offers);
    Object.assign(sys, { offers: o.offers, offerRules: o.rules, notOffered: o.notOffered });
    read.push(count(o.offers.length, m("{n} offer"), m("{n} offers")));
    for (const part of ["offers", "offerRules", "notOffered"] as const) parts.add(part);
  }
  const cp = md("counter-positioning.md", "counter-position", "value proposition", "stands against");
  if (cp) { counterPositioning(cp, sys); read.push(t("positioning")); parts.add("positioning"); }
  const pal = json("color-palette.json", ...Object.keys(ROLE_OF));
  if (pal) { palette(pal, sys, warnings, t); read.push(count(sys.palette.length, m("{n} colour"), m("{n} colours"))); parts.add("palette"); }
  else {
    // No palette file: a guide's own "## Colours" section, one colour per bullet.
    const listed = guideMd.map(parseColours).find((colours) => colours.length > 0);
    if (listed) { sys.palette = listed; read.push(count(listed.length, m("{n} colour"), m("{n} colours"))); parts.add("palette"); }
  }
  const fontFiles = paths.filter((p) => dirOf(p).toLowerCase() === "fonts");
  const typ = json("typography.json", "fonts");
  const fonts = typ ? typography(typ, sys, fontFiles, warnings, t) : [];
  if (typ) { read.push(count(sys.fonts.length, m("{n} font"), m("{n} fonts"))); parts.add("fonts"); }
  const imageFiles = paths.filter((p) => dirOf(p).toLowerCase() === "product-images" && /\.(png|jpe?g|webp)$/i.test(p));
  const prod = json("products.json", "products");
  const images = prod ? products(prod, sys, imageFiles, warnings, t) : [];
  if (prod) { read.push(count(sys.products.length, m("{n} product"), m("{n} products"))); parts.add("products"); }
  for (const p of paths.filter((p) => dirOf(p).toLowerCase() === "logos" && /\.(png|jpe?g|webp)$/i.test(p))) images.push({ path: p, kind: "logo", label: base(p).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") });

  const system = cleanBrandSystem({ ...sys, source: "brand-skill", importedFrom: folderName, updatedAt: new Date().toISOString() });
  // A guide's sections nothing here reads: say which, so a part the person wrote isn't dropped without a word.
  const skipped = [...new Set(guideMd.flatMap(unreadHeadings))];
  if (read.length && skipped.length) {
    const list = skipped.slice(0, 6).map((h) => `“${h}”`).join(", ");
    warnings.push(skipped.length > 6
      ? t("Not read: {list} and {n} more. Only the headings under “What it reads” are imported; add the rest by hand below.", { list, n: skipped.length - 6 })
      : t("Not read: {list}. Only the headings under “What it reads” are imported; add the rest by hand below.", { list }));
  }
  if (!read.length) warnings.push(t("Nothing in this guide could be read. Use the headings listed under “What it reads”, or fill in the fields by hand."));
  else {
    if (parts.has("look") && !system.look.promptModifier) warnings.push(t("No prompt modifier found: write one on the Brand page (it opens every image prompt)."));
    if (parts.has("offers") && !system.offers.length) warnings.push(t("No offers found: creatives will show no price or offer until you add them."));
  }
  return { system, fonts, images, read, warnings, parts: [...parts] };
}

/** One guide, pasted as text: Markdown, or JSON when it starts with a brace. */
export function readBrandGuide(text: string, name = "Pasted guide", t: Translator["t"] = fill): BrandImport {
  return readBrandFolder([{ path: /^\s*\{/.test(text) ? "guide.json" : "guide.md", text }], name, t);
}
