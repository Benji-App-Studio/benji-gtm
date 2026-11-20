// A product's brand system: the art direction and the rules every creative follows
// (products.brand_system, migration 20261005100000). The Brand page edits it together with the brand
// kit's basics (name, icon, screenshots, App Store link), and saving keeps the kit's colours, tone and
// forbidden claims in step with the palette and voice (lib/brand.ts). It is the art direction and the
// rules every generator follows:
// - look: the prompt modifier that opens every image prompt, the photography and packaging rules;
// - voice: how the brand writes, words it uses and avoids, signature lines;
// - avatars: the named people ads speak to (variants rotate through them);
// - offers: the CLOSED list of offers; no generator may state any other price, discount, trial or code,
//   and QA fails a creative that does; each may carry its source (a live ad, the App Store…);
// - facts: verified numbers a creative may show ("4.9★ · 13,000+ ratings"), each with its source and
//   the date it was checked; QA fails a number that isn't one of them or an offer's wording;
// - wording: substitutions ("say 'licensed provider', never 'dermatologist'") and phrases that must
//   come with a word ("prescription" → "if it's right for you");
// - description disclaimers: the lines Meta's link description carries ("Results vary.");
// - palette (named colours with roles), fonts (uploaded files, used by composed ads), products (facts
//   that copy may cite), positioning.
// Filled by "Import a brand guide" (lib/brand-import.ts reads a pasted guide, a file or a brand folder) or by
// hand on the Brand page. Pure TypeScript: the browser, the server and the Node tests share it.
import { m } from "./i18n/translate";

export interface BrandAvatar {
  id: string;
  /** "Maya", as every generator refers to them. */
  name: string;
  /** "The busy parent, 30–45". */
  type: string;
  /** One concrete scene where the product matters. */
  moment: string;
  /** Their own words, used verbatim in headlines. */
  painWords: string[];
  wants: string;
  objections: { doubt: string; answer: string }[];
  driver: string;
  /** What an ad for them leads with and proves first. */
  pov: string;
}

/** Where a fact, a price or an offer was checked, and when. */
export type FactSourceKind = "live_ad" | "app_store" | "website" | "manual";
export interface FactSource {
  kind: FactSourceKind;
  /** The live ad, the App Store page or the web page it was read from. */
  url?: string;
  note?: string;
  /** When someone last checked it (ISO). */
  verifiedAt?: string;
}
export const FACT_SOURCE_KINDS: { id: FactSourceKind; label: string }[] = [
  { id: "live_ad", label: m("Live ad") },
  { id: "app_store", label: "App Store" },
  { id: "website", label: m("Website") },
  { id: "manual", label: m("Our own records") },
];

/** A verified number or statement a creative may show as written ("App Store rating": "4.9★ · 13,000+ ratings"). */
export interface BrandFact { id: string; label: string; value: string; source: FactSource }

/** Say `use`, never `avoid` ("dermatologist" → "licensed provider"). */
export interface BrandSubstitution { avoid: string; use: string; note?: string }

/** When copy says `when` ("prescription"), it also says `phrase` ("if it's right for you"). */
export interface RequiredPhrase { when: string; phrase: string }

export interface BrandOffer {
  /** "O1". */
  id: string;
  name: string;
  /** Terms in plain words (price points, eligibility, how it cancels). */
  terms: string;
  /** The exact wording a creative may show ("From $9.99/month"); empty means name only. */
  wording: string;
  /** Where the price and terms were checked (a live ad, the App Store…). */
  source?: FactSource;
}

export type ColorRole = "primary" | "secondary" | "accent" | "neutral" | "background";
export interface BrandColor { name: string; hex: string; role: ColorRole; use: string }

export type FontRole = "headline" | "body" | "accent" | "legal";
export interface BrandFont {
  role: FontRole;
  family: string;
  /** 100–900. */
  weight: number;
  /** The uploaded font file (TTF/OTF/WOFF), when there is one; composed ads need it. */
  url?: string;
  /** How it looks, for when the file is missing. */
  description: string;
}

export interface BrandProduct {
  slug: string;
  name: string;
  category: string;
  description: string;
  /** Claims copy may make about it, exactly as written. */
  claims: string[];
  /** What it's for (concerns, jobs). */
  uses: string[];
  results: string;
  warnings: string[];
  price: string;
  /** Where the price was checked. */
  priceSource?: FactSource;
  size: string;
  /** Its own accent colour (a cap, a label), "#RRGGBB". */
  accent: string;
  /** Its pictures among the product's images (product_assets ids). */
  assetIds: string[];
}

export interface BrandSystem {
  version: 1;
  source: "brand-skill" | "manual";
  updatedAt: string;
  importedFrom?: string;
  look: {
    /** Opens every image prompt: exact hexes, light, grade, surfaces, mood, hard rules. */
    promptModifier: string;
    lighting: string;
    grade: string;
    composition: string;
    subjects: string;
    surfaces: string;
    mood: string;
    /** Physical form, label placement, distinctive features: how the product must look. */
    packaging: string;
    /** How copy sits on images (typeface, colour, placement, scale). */
    textOnImage: string;
    /** How prices and offers are shown, or not. */
    offerStyle: string;
  };
  voice: {
    oneLine: string;
    rules: string[];
    use: string[];
    avoid: string[];
    signatureLines: string[];
    examples: string[];
    dos: string[];
    donts: string[];
    /**
     * Claims a creative must never make or imply ("guarantees results"), one per entry. Kept in step
     * with products.brand_kit.forbiddenClaims on save (lib/brand.ts); QA fails copy that makes one.
     */
    forbiddenClaims: string[];
    /** Say X, never Y. Always present once cleaned. */
    substitutions?: BrandSubstitution[];
    /** Phrases that must come with a word. Always present once cleaned. */
    requiredPhrases?: RequiredPhrase[];
  };
  avatars: BrandAvatar[];
  offers: BrandOffer[];
  /** Stacking and framing rules for the offers. */
  offerRules: string[];
  /** Things the brand does NOT offer ("free trial", "discount codes"): never shown. */
  notOffered: string[];
  palette: BrandColor[];
  fonts: BrandFont[];
  products: BrandProduct[];
  positioning: { counterPosition: string; valueProposition: string; standsAgainst: string };
  /** Verified numbers and statements creatives may show. Always present once cleaned. */
  facts?: BrandFact[];
  /** Lines the Meta link description carries ("Results vary."). Always present once cleaned. */
  descriptionDisclaimers?: string[];
}

export const BRAND_SYSTEM_LIMITS = { avatars: 6, offers: 12, palette: 16, fonts: 8, products: 60, list: 24, text: 1200, modifier: 900, claims: 50, facts: 30, substitutions: 30, requiredPhrases: 20, disclaimers: 6 };

export const EMPTY_BRAND_SYSTEM: BrandSystem = {
  version: 1, source: "manual", updatedAt: "",
  look: { promptModifier: "", lighting: "", grade: "", composition: "", subjects: "", surfaces: "", mood: "", packaging: "", textOnImage: "", offerStyle: "" },
  voice: { oneLine: "", rules: [], use: [], avoid: [], signatureLines: [], examples: [], dos: [], donts: [], forbiddenClaims: [], substitutions: [], requiredPhrases: [] },
  avatars: [], offers: [], offerRules: [], notOffered: [], palette: [], fonts: [], products: [],
  positioning: { counterPosition: "", valueProposition: "", standsAgainst: "" },
  facts: [], descriptionDisclaimers: [],
};

// MARK: Cleaning

const s = (v: unknown, max: number = BRAND_SYSTEM_LIMITS.text) => (typeof v === "string" ? v.replace(/\r/g, "").trim().slice(0, max) : "");
const list = (v: unknown, n: number = BRAND_SYSTEM_LIMITS.list, max = 300) =>
  [...new Set((Array.isArray(v) ? v : typeof v === "string" ? v.split("\n") : []).map((x) => s(x, max)).filter(Boolean))].slice(0, n);
const hex = (v: unknown) => {
  const t = s(v, 9).replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(t)) return `#${t.split("").map((c) => c + c).join("")}`.toUpperCase();
  return /^[0-9a-f]{6}$/i.test(t) ? `#${t}`.toUpperCase() : "";
};
const https = (v: unknown) => { const t = s(v, 2000); return /^https:\/\/\S+$/i.test(t) ? t : undefined; };
const slug = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const obj = (v: unknown) => (v && typeof v === "object" ? v as Record<string, unknown> : {});
const ROLES: ColorRole[] = ["primary", "secondary", "accent", "neutral", "background"];
const FONT_ROLES: FontRole[] = ["headline", "body", "accent", "legal"];
const SOURCE_KINDS = FACT_SOURCE_KINDS.map((k) => k.id);

/** A date as ISO, or "" when it isn't one. */
const isoDate = (v: unknown) => {
  const t = s(v, 40);
  const ms = t ? Date.parse(t) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
};

/** A stored or submitted source, made safe; undefined when there's nothing in it. */
export function cleanFactSource(raw: unknown): FactSource | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const x = obj(raw);
  const kind = SOURCE_KINDS.includes(x.kind as FactSourceKind) ? x.kind as FactSourceKind : "manual";
  const url = https(x.url), note = s(x.note, 300), verifiedAt = isoDate(x.verifiedAt);
  if (!SOURCE_KINDS.includes(x.kind as FactSourceKind) && !url && !note && !verifiedAt) return undefined;
  return { kind, ...(url ? { url } : {}), ...(note ? { note } : {}), ...(verifiedAt ? { verifiedAt } : {}) };
}
const withSource = <K extends string>(key: K, raw: unknown): { [P in K]?: FactSource } => {
  const source = cleanFactSource(raw);
  return (source ? { [key]: source } : {}) as { [P in K]?: FactSource };
};

/** A stored or submitted brand system, made safe and complete (every field present). */
export function cleanBrandSystem(raw: unknown): BrandSystem {
  const r = obj(raw);
  const look = obj(r.look), voice = obj(r.voice), pos = obj(r.positioning);
  const L = BRAND_SYSTEM_LIMITS;
  return {
    version: 1,
    source: r.source === "brand-skill" ? "brand-skill" : "manual",
    updatedAt: s(r.updatedAt, 40),
    ...(s(r.importedFrom, 200) ? { importedFrom: s(r.importedFrom, 200) } : {}),
    look: {
      promptModifier: s(look.promptModifier, L.modifier), lighting: s(look.lighting, 400), grade: s(look.grade, 400), composition: s(look.composition, 400),
      subjects: s(look.subjects, 400), surfaces: s(look.surfaces, 400), mood: s(look.mood, 200), packaging: s(look.packaging, 800),
      textOnImage: s(look.textOnImage, 400), offerStyle: s(look.offerStyle, 400),
    },
    voice: {
      oneLine: s(voice.oneLine, 400), rules: list(voice.rules, 12, 400), use: list(voice.use, 30, 80), avoid: list(voice.avoid, 40, 80),
      signatureLines: list(voice.signatureLines, 12, 160), examples: list(voice.examples, 12, 300), dos: list(voice.dos, 12, 300), donts: list(voice.donts, 12, 300),
      forbiddenClaims: list(voice.forbiddenClaims, BRAND_SYSTEM_LIMITS.claims, 300),
      substitutions: dedupe((Array.isArray(voice.substitutions) ? voice.substitutions : []).map((x) => {
        const o = obj(x);
        const note = s(o.note, 200);
        return { avoid: s(o.avoid, 80), use: s(o.use, 120), ...(note ? { note } : {}) };
      }).filter((x) => x.avoid && x.use), (x) => x.avoid).slice(0, L.substitutions),
      requiredPhrases: dedupe((Array.isArray(voice.requiredPhrases) ? voice.requiredPhrases : []).map((x) => ({ when: s(obj(x).when, 80), phrase: s(obj(x).phrase, 200) }))
        .filter((x) => x.when && x.phrase), (x) => `${x.when}\n${x.phrase}`).slice(0, L.requiredPhrases),
    },
    avatars: (Array.isArray(r.avatars) ? r.avatars : []).slice(0, L.avatars).map((a, i) => {
      const x = obj(a);
      const name = s(x.name, 40) || `Avatar ${i + 1}`;
      return {
        id: s(x.id, 40) || slug(name) || `a${i + 1}`, name, type: s(x.type, 120), moment: s(x.moment, 600), painWords: list(x.painWords, 10, 200),
        wants: s(x.wants, 400), driver: s(x.driver, 300), pov: s(x.pov, 400),
        objections: (Array.isArray(x.objections) ? x.objections : []).slice(0, 6).map((o) => ({ doubt: s(obj(o).doubt, 300), answer: s(obj(o).answer, 400) })).filter((o) => o.doubt),
      };
    }),
    offers: (Array.isArray(r.offers) ? r.offers : []).slice(0, L.offers).map((o, i) => {
      const x = obj(o);
      return { id: s(x.id, 8) || `O${i + 1}`, name: s(x.name, 120), terms: s(x.terms, 600), wording: s(x.wording, 160), ...withSource("source", x.source) };
    }).filter((o) => o.name || o.wording),
    offerRules: list(r.offerRules, 10, 300),
    notOffered: list(r.notOffered, 12, 120),
    palette: (Array.isArray(r.palette) ? r.palette : []).slice(0, L.palette).map((c) => {
      const x = obj(c);
      return { name: s(x.name, 60), hex: hex(x.hex), role: ROLES.includes(x.role as ColorRole) ? x.role as ColorRole : "accent", use: s(x.use, 200) };
    }).filter((c) => c.hex),
    fonts: (Array.isArray(r.fonts) ? r.fonts : []).slice(0, L.fonts).map((f) => {
      const x = obj(f);
      const weight = Math.round(Number(x.weight) / 100) * 100;
      return {
        role: FONT_ROLES.includes(x.role as FontRole) ? x.role as FontRole : "body", family: s(x.family, 80), weight: weight >= 100 && weight <= 900 ? weight : 400,
        ...(https(x.url) ? { url: https(x.url) } : {}), description: s(x.description, 300),
      };
    }).filter((f) => f.family),
    products: (Array.isArray(r.products) ? r.products : []).slice(0, L.products).map((p) => {
      const x = obj(p);
      const name = s(x.name, 80);
      return {
        slug: s(x.slug, 60) || slug(name), name, category: s(x.category, 80), description: s(x.description, 600), claims: list(x.claims, 10, 300),
        uses: list(x.uses, 10, 120), results: s(x.results, 400), warnings: list(x.warnings, 8, 300), price: s(x.price, 80), ...withSource("priceSource", x.priceSource), size: s(x.size, 40),
        accent: hex(x.accent), assetIds: list(x.assetIds, 12, 40).filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
      };
    }).filter((p) => p.name),
    positioning: { counterPosition: s(pos.counterPosition, 600), valueProposition: s(pos.valueProposition, 600), standsAgainst: s(pos.standsAgainst, 600) },
    facts: dedupe((Array.isArray(r.facts) ? r.facts : []).map((f, i) => {
      const x = obj(f);
      const label = s(x.label, 80);
      return { id: s(x.id, 40) || slug(label) || `f${i + 1}`, label, value: s(x.value, 160), source: cleanFactSource(x.source) ?? { kind: "manual" as const } };
    }).filter((f) => f.value), (f) => f.id).slice(0, L.facts),
    descriptionDisclaimers: list(r.descriptionDisclaimers, L.disclaimers, 300),
  };
}

/** The first of each key, in order. */
function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => { const k = key(item).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * An import replaces the parts it brings, but what only the Brand page sets stays: the forbidden
 * claims (joined), verified facts, wording rules, description disclaimers, and the sources of offers and
 * prices that are still there.
 */
export function keepHandEntered(prev: BrandSystem, next: BrandSystem): BrandSystem {
  const offerSource = new Map(prev.offers.filter((o) => o.source).map((o) => [o.id, o.source]));
  const priceSource = new Map(prev.products.filter((p) => p.priceSource).map((p) => [p.slug, p.priceSource]));
  return {
    ...next,
    voice: {
      ...next.voice,
      forbiddenClaims: [...new Set([...prev.voice.forbiddenClaims, ...next.voice.forbiddenClaims])],
      substitutions: next.voice.substitutions?.length ? next.voice.substitutions : prev.voice.substitutions ?? [],
      requiredPhrases: next.voice.requiredPhrases?.length ? next.voice.requiredPhrases : prev.voice.requiredPhrases ?? [],
    },
    offers: next.offers.map((o) => (o.source || !offerSource.get(o.id) ? o : { ...o, source: offerSource.get(o.id) })),
    products: next.products.map((p) => (p.priceSource || !priceSource.get(p.slug) ? p : { ...p, priceSource: priceSource.get(p.slug) })),
    facts: next.facts?.length ? next.facts : prev.facts ?? [],
    descriptionDisclaimers: next.descriptionDisclaimers?.length ? next.descriptionDisclaimers : prev.descriptionDisclaimers ?? [],
  };
}

// MARK: Sources

const DAY = 86_400_000;

/** Days since a source was checked, or null when it never was. */
export function sourceAgeDays(source: FactSource | null | undefined, now = new Date()): number | null {
  const ms = source?.verifiedAt ? Date.parse(source.verifiedAt) : NaN;
  return Number.isFinite(ms) ? Math.max(0, Math.floor((now.getTime() - ms) / DAY)) : null;
}

/** "Live ad · verified 12 days ago", "App Store · not verified". */
export function sourceLabel(source: FactSource | null | undefined, now = new Date()): string {
  if (!source) return "No source";
  const kind = FACT_SOURCE_KINDS.find((k) => k.id === source.kind)?.label ?? "Source";
  const days = sourceAgeDays(source, now);
  const age = days === null ? "not verified" : days === 0 ? "verified today" : days === 1 ? "verified yesterday" : `verified ${days} days ago`;
  return `${kind} · ${age}`;
}

/** A source counts once someone checked it on a date. */
export const isVerified = (source: FactSource | null | undefined) => sourceAgeDays(source) !== null;

/**
 * The numbers and statements QA accepts on a creative: the verified facts, and every offer and product
 * price that has a source (its wording, or its name). The frozen QA context's `facts`.
 */
export function verifiedFacts(sys: BrandSystem | null | undefined): { label: string; value: string }[] {
  if (!sys) return [];
  const out = [
    ...(sys.facts ?? []).map((f) => ({ label: f.label || f.id, value: f.value })),
    ...sys.offers.filter((o) => o.source).map((o) => ({ label: o.name || o.id, value: o.wording || o.name })),
    ...sys.products.filter((p) => p.priceSource && p.price).map((p) => ({ label: `${p.name} price`, value: p.price })),
  ];
  return dedupe(out.filter((f) => f.value), (f) => f.value).slice(0, 40);
}

/** True when there's anything in it worth using. */
export function hasBrandSystem(sys: BrandSystem | null | undefined): sys is BrandSystem {
  return Boolean(sys && (sys.look.promptModifier || sys.avatars.length || sys.offers.length || sys.voice.oneLine || sys.products.length || sys.fonts.length
    || sys.facts?.length || sys.voice.substitutions?.length || sys.voice.requiredPhrases?.length || sys.descriptionDisclaimers?.length));
}

/** What's filled in, for the Brand page header and the Studio's "Using your brand system" line. */
export function brandSystemSummary(sys: BrandSystem): string[] {
  const out: string[] = [];
  if (sys.look.promptModifier) out.push("look");
  if (sys.voice.oneLine || sys.voice.rules.length) out.push("voice");
  if (sys.avatars.length) out.push(`${sys.avatars.length} avatar${sys.avatars.length === 1 ? "" : "s"}`);
  if (sys.offers.length) out.push(`${sys.offers.length} offer${sys.offers.length === 1 ? "" : "s"}`);
  if (sys.products.length) out.push(`${sys.products.length} product${sys.products.length === 1 ? "" : "s"}`);
  if (sys.fonts.length) out.push(`${sys.fonts.length} font${sys.fonts.length === 1 ? "" : "s"}`);
  if (sys.facts?.length) out.push(`${sys.facts.length} fact${sys.facts.length === 1 ? "" : "s"}`);
  if (sys.voice.substitutions?.length || sys.voice.requiredPhrases?.length) out.push("wording");
  return out;
}

// MARK: Prompts

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : text);
const bare = (t: string) => t.trim().replace(/[.;]+$/, "");

/** The avatar a variant speaks to: variants rotate through the avatars (variant 1 → the first). */
export function avatarFor(sys: BrandSystem | null | undefined, variant: number): BrandAvatar | null {
  if (!sys?.avatars.length) return null;
  return sys.avatars[(Math.max(1, variant) - 1) % sys.avatars.length];
}

/** The products a brief names (by name or slug), else none. */
export function productsIn(sys: BrandSystem | null | undefined, text: string): BrandProduct[] {
  if (!sys?.products.length || !text) return [];
  const t = text.toLowerCase();
  return sys.products.filter((p) => (p.name && new RegExp(`(?<![a-z0-9])${p.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(t)) || (p.slug && t.includes(p.slug)));
}

/**
 * BRAND LOOK: the prompt modifier first (it's written to open an image prompt), then the packaging
 * rule when a product is shown. Images get it whole; it's the single most useful line.
 */
export function lookBlock(sys: BrandSystem, o: { product?: BrandProduct | null; max?: number } = {}): string {
  const max = o.max ?? 1100;
  const lines: string[] = [];
  if (sys.look.promptModifier) lines.push(`BRAND LOOK (follow exactly): ${sys.look.promptModifier}`);
  else {
    const parts = [["Light", sys.look.lighting], ["Grade", sys.look.grade], ["Surfaces", sys.look.surfaces], ["Mood", sys.look.mood]].filter(([, v]) => v).map(([k, v]) => `${k}: ${bare(v)}`);
    if (parts.length) lines.push(`BRAND LOOK: ${parts.join(". ")}.`);
  }
  if (o.product) {
    const p = o.product;
    lines.push(`PRODUCT: ${p.name}${p.size ? ` (${p.size})` : ""}${p.accent ? `, accent ${p.accent}` : ""}. ${sys.look.packaging ? cut(bare(sys.look.packaging), 300) + ". " : ""}Show it exactly as in its reference images; never invent a pack or label.`);
  } else if (sys.look.packaging) {
    lines.push(`If the product appears: ${cut(bare(sys.look.packaging), 260)}.`);
  }
  return cut(lines.join("\n"), max);
}

/**
 * BRAND COPY: the voice, who this variant speaks to (their words, their point of view), the only offers
 * allowed (word for word), and the facts a named product's copy may cite. Every generator that writes
 * words (images, videos, Recreate) appends it.
 */
export function copyBlock(sys: BrandSystem, o: { variant?: number; products?: BrandProduct[]; kind?: "image" | "video"; max?: number; rules?: boolean } = {}): string {
  // rules: false leaves out the banned words and the offers: lib/brand-rules.ts states them in its own
  // block that is never trimmed (QA checks exactly that list).
  const rules = o.rules !== false;
  const video = o.kind === "video";
  const max = o.max ?? (video ? 1400 : 1000);
  const lines: { text: string; drop: number }[] = [];
  const v = sys.voice;
  if (v.oneLine) lines.push({ text: `- Voice: ${cut(bare(v.oneLine), 220)}`, drop: 7 });
  if (v.rules.length && video) lines.push({ text: `- Voice rules: ${v.rules.slice(0, 3).map((r) => cut(bare(r), 110)).join("; ")}`, drop: 3 });
  if (rules && v.avoid.length) lines.push({ text: `- Never use the words: ${v.avoid.slice(0, 14).map((w) => `"${w}"`).join(", ")}`, drop: 6 });
  if (v.signatureLines.length) lines.push({ text: `- Signature lines (may be used as written): ${v.signatureLines.slice(0, 3).map((l) => `"${cut(l, 80)}"`).join("; ")}`, drop: 2 });
  const avatar = avatarFor(sys, o.variant ?? 1);
  if (avatar) {
    lines.push({ text: `- Speak to ${avatar.name}${avatar.type ? ` (${cut(avatar.type, 70)})` : ""}: ${cut(bare(avatar.pov || avatar.wants), 200)}`, drop: 9 });
    if (avatar.painWords.length) lines.push({ text: `- ${avatar.name}'s own words (usable verbatim in a hook): ${avatar.painWords.slice(0, 3).map((w) => `"${cut(w, 70)}"`).join("; ")}`, drop: 8 });
    if (avatar.objections[0] && video) lines.push({ text: `- Answer their doubt "${cut(avatar.objections[0].doubt, 80)}" with: ${cut(bare(avatar.objections[0].answer), 120)}`, drop: 4 });
  }
  for (const p of o.products ?? []) {
    const facts = [p.claims.slice(0, 2).map((c) => cut(bare(c), 110)).join("; "), p.results ? `results: ${cut(bare(p.results), 100)}` : ""].filter(Boolean).join("; ");
    if (facts) lines.push({ text: `- ${p.name} facts (only as written): ${facts}`, drop: 8.5 });
  }
  if (rules && offersLine(sys)) lines.push({ text: offersLine(sys), drop: 10 });
  // Nothing to say yet: no heading on its own (in a prompt, or in the Brand page's preview).
  if (!lines.length) return "";
  const head ="BRAND COPY (the brand's own rules; every word on screen follows them):";
  const render = () => [head, ...lines.map((l) => l.text)].join("\n");
  while (render().length > max && lines.length > 1) {
    const lowest = lines.reduce((min, l, i) => (l.drop < lines[min].drop ? i : min), 0);
    lines.splice(lowest, 1);
  }
  return render().slice(0, max);
}

/**
 * The closed offer list as one prompt line; "" when the brand hasn't listed its offers yet (a voice or a
 * look alone says nothing about offers, so nothing is ruled out).
 */
export function offersLine(sys: BrandSystem): string {
  const offers = sys.offers.map((o) => (o.wording ? `"${o.wording}"` : o.name)).filter(Boolean);
  const never = sys.notOffered.length ? ` We do NOT offer: ${sys.notOffered.slice(0, 6).join(", ")}.` : "";
  // With verified facts listed, their prices ($59/mo, "$250+ a visit") are allowed too: the facts line names them.
  const rest = (sys.facts ?? []).length ? "No other discount, trial, code or deadline; prices only as in the verified facts." : "No other price, discount, trial, code or deadline.";
  if (offers.length) return `- Offers: only these, word for word: ${offers.join("; ")}. ${rest}${never}`;
  return never ? `-${never}` : "";
}

/** The colours by role, for prompts that name colours ("Colours: Mist #EEEEEE canvas; Espresso #251B13 type"). */
export function paletteLine(sys: BrandSystem, n = 6): string {
  const order: ColorRole[] = ["primary", "background", "neutral", "accent", "secondary"];
  const colors = [...sys.palette].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role)).slice(0, n);
  return colors.length ? `Colours: ${colors.map((c) => `${c.name ? `${c.name} ` : ""}${c.hex}${c.use ? ` (${cut(c.use, 40)})` : ""}`).join("; ")}.` : "";
}

// MARK: QA

/** What QA checks offers against (QaContext.offers): the exact wordings and names allowed, and what's never offered. */
export function offerRules(sys: BrandSystem | null | undefined): { allowed: string[]; notOffered: string[] } | null {
  if (!sys || (!sys.offers.length && !sys.notOffered.length)) return null;
  return {
    allowed: [...new Set(sys.offers.flatMap((o) => [o.wording, o.name]).map((x) => x.trim()).filter(Boolean))].slice(0, 30),
    notOffered: sys.notOffered.slice(0, 12),
  };
}
