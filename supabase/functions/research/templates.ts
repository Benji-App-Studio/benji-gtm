// Playground templates: what OpenAI is asked when it reads an uploaded ad (`template-analyze`), and the
// answer made safe before it's stored in product_templates.analysis (with what the format is for:
// bestFor, angle, fits, adaptTip). The shape is TemplateAnalysis in
// studio/src/lib/playground-templates.ts. Pure functions, no network, so templates_test.ts covers them.

export const TEMPLATE_ASPECTS = ["1:1", "4:5", "9:16", "16:9"] as const;
export const TEMPLATE_GROUPS = ["social", "proof", "hero"] as const;
/** The product kinds a template suits (TemplateFit in the studio): offer = promo- or discount-led. */
export const TEMPLATE_FITS = ["physical", "app", "service", "offer"] as const;
/** The angles the read names, when one fits; another short phrase is kept as written. */
export const TEMPLATE_ANGLES = ["price comparison", "social proof", "problem awareness", "curiosity", "offer/urgency", "authority/news", "humour", "education"] as const;
export const TEMPLATE_LIMITS = { fields: 12, brands: 30, brandChars: 80, layout: 900, minField: 12, maxField: 220, bestFor: 240, angle: 40, adaptTip: 240 };
/** The name a custom template has until the analysis names it. */
export const DEFAULT_TEMPLATE_NAME = "New template";

const str = { type: "string" };

/** The strict JSON schema the analysis answers in. */
export const TEMPLATE_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["name", "tagline", "layout", "aspect", "fields", "brands", "productSlot", "hasPeople", "group", "bestFor", "angle", "fits", "adaptTip"],
  properties: {
    name: str,
    tagline: str,
    layout: str,
    aspect: { type: "string", enum: [...TEMPLATE_ASPECTS] },
    fields: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["key", "label", "example", "maxLength", "multiline", "sensitive"],
        properties: { key: str, label: str, example: str, maxLength: { type: "integer" }, multiline: { type: "boolean" }, sensitive: { type: "boolean" } },
      },
    },
    brands: { type: "array", items: str },
    productSlot: str,
    hasPeople: { type: "boolean" },
    group: { type: "string", enum: [...TEMPLATE_GROUPS] },
    bestFor: str,
    angle: str,
    fits: { type: "array", items: { type: "string", enum: [...TEMPLATE_FITS] } },
    adaptTip: str,
  },
};

export const TEMPLATE_SYSTEM = [
  "You read one ad image so it can be rebuilt as a reusable, brand-neutral template. Report only what is visible. Never invent text, numbers, brands or elements that are not in the image.",
  "name: 2 to 5 words naming the format (e.g. \"Big stat hero\", \"Notes app breakup\"), never a brand.",
  "tagline: one sentence on why this format works on Meta (Facebook/Instagram) feeds.",
  "layout: a precise description another designer could rebuild from, under 900 characters: the zones top to bottom (and left to right) with rough proportions; typography (serif/sans, weight, case, relative sizes, alignment); exact colours (names or hex); where the product sits and how big; UI elements (cards, badges, stars, buttons, app chrome); the background.",
  "aspect: the nearest of 1:1, 4:5, 9:16, 16:9 to the image's shape.",
  "fields: every piece of text printed on the image, in reading order, at most 12 (merge tiny repeated labels). key: snake_case, unique. label: what the slot is (\"Headline\", \"Stat 1 number\", \"Review quote\"). example: the exact visible text with every brand, product name, handle or website replaced by BRAND. maxLength: about 1.4x the example's length, at least 12, at most 220. multiline: true when it runs over more than one line. sensitive: true for statistics, percentages, ratings, star counts, reviews, testimonials, certifications or seals, before/after results, prices, offers and any claim that must be the advertiser's own and true.",
  "brands: every brand name, product name, wordmark, @handle, website and certification or seal name visible, as written. [] when there are none.",
  "productSlot: in a few words, what the advertiser's own image fills (\"a bottle in hand\", \"an app screen on a phone\", \"none\").",
  "hasPeople: true when a person or a recognisable part of one (face, hands holding the product) appears.",
  "group: social (looks like an organic post, chat, notes app, comment or story), proof (built on stats, reviews, ratings, before/after or badges), or hero (the product itself is the focus).",
  "The next four say what the format is for, so someone can tell whether it suits their product before using it. Be honest and specific; never a brand.",
  "bestFor: one sentence on the products this format suits best and why (e.g. \"Physical products with a price advantage over a premium rival: dupes, generics, value brands.\").",
  `angle: the persuasion mechanism in a few words, lower case; one of ${TEMPLATE_ANGLES.map((a) => `"${a}"`).join(", ")} when one fits, written exactly as listed (in English, whatever language the rest is in).`,
  "fits: the product kinds it suits best, 1 to 3 of physical (a physical product), app (an app or software), service (a service), offer (promo- or discount-led: the deal is the message). Only those the format really works for as it is.",
  "adaptTip: one sentence on adapting it to a product kind it doesn't naturally fit (e.g. \"For an app, replace the product shots with two phone screens and compare plans instead of prices.\").",
].join("\n");

export interface TemplateFieldOut { key: string; label: string; example: string; maxLength: number; multiline: boolean; sensitive: boolean }
export interface TemplateAnalysisOut {
  name: string; tagline: string; layout: string; aspect: (typeof TEMPLATE_ASPECTS)[number]; fields: TemplateFieldOut[]; brands: string[];
  productSlot: string; hasPeople: boolean; group: (typeof TEMPLATE_GROUPS)[number];
  bestFor: string; angle: string; fits: (typeof TEMPLATE_FITS)[number][]; adaptTip: string;
}

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max).trim() : "");
/** Keeps line breaks (a multi-line example stays multi-line), collapses other whitespace. */
const clipText = (value: unknown, max: number) =>
  typeof value === "string" ? value.split(/\r?\n/).map((l) => l.replace(/[ \t\f\v]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max).trim() : "";
/** Known kinds only, once each, in TEMPLATE_FITS order. */
export function cleanFits(raw: unknown): (typeof TEMPLATE_FITS)[number][] {
  const given = new Set((Array.isArray(raw) ? raw : []).map((v) => (typeof v === "string" ? v.trim().toLowerCase() : "")));
  return TEMPLATE_FITS.filter((f) => given.has(f));
}
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Text the model may have missed as sensitive: numbers with %, prices (any currency sign), star ratings
 * ("4.8/5", "5 stars", a number then a symbol, a run of 3+ symbols), reviews, seals, before/after, "#1"...
 */
const SENSITIVE = /\d\s*%|\p{Sc}\s*\d|\d\s*(?:\/\s*(?:5|10)\b|stars?\b|\p{So})|\p{So}{3,}|\b(?:reviews?|rated|rating|testimonial|certified|certification|clinically|dermatologist|proven|guarantee[d]?|approved|award|before|after|#\s*1|no\.\s*1|number one)\b/iu;

/** The maxLength rule: about 1.4x the example, at least 12, at most 220 (the model's own number when there's no example). */
export function fieldMaxLength(example: string, modelValue?: unknown): number {
  const base = example.length ? Math.ceil(example.length * 1.4) : Math.round(Number(modelValue)) || TEMPLATE_LIMITS.minField;
  return Math.min(TEMPLATE_LIMITS.maxField, Math.max(TEMPLATE_LIMITS.minField, base));
}

/** Brands as a clean list: trimmed, at most 80 chars, no duplicates, never the placeholder itself. */
export function cleanBrands(list: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(list) ? list : []) {
    const text = clip(item, TEMPLATE_LIMITS.brandChars);
    const key = text.toLowerCase();
    if (!text || key === "brand" || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= TEMPLATE_LIMITS.brands) break;
  }
  return out;
}

/** Every listed brand (2+ characters) swapped for BRAND, case-insensitively, longest first. */
export function swapBrands(text: string, brands: string[]): string {
  let out = text;
  for (const brand of [...brands].filter((b) => b.length >= 2).sort((a, b) => b.length - a.length)) {
    // Whole words only when the brand starts/ends with a word character, so "Ro" never eats "Rome".
    const start = /^\w/.test(brand) ? "(?<![\\w])" : "";
    const end = /\w$/.test(brand) ? "(?![\\w])" : "";
    out = out.replace(new RegExp(`${start}${escapeRegExp(brand)}${end}`, "gi"), "BRAND");
  }
  return out;
}

const snakeKey = (value: unknown, i: number) => {
  const key = clip(value, 60).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 40);
  return key || `text_${i + 1}`;
};

/** The model's answer made safe: everything clipped, enums checked, keys unique, brands swapped out of examples. */
export function cleanTemplateAnalysis(raw: Record<string, any>): TemplateAnalysisOut {
  const brands = cleanBrands(raw?.brands);
  const used = new Set<string>();
  const fields: TemplateFieldOut[] = [];
  for (const [i, f] of (Array.isArray(raw?.fields) ? raw.fields : []).entries()) {
    if (!f || typeof f !== "object") continue;
    const example = swapBrands(clipText(f.example, 400), brands);
    const label = clip(f.label, 60) || `Text ${fields.length + 1}`;
    if (!example && !clip(f.label, 60)) continue;
    let key = snakeKey(f.key || label, i);
    for (let n = 2; used.has(key); n++) key = `${snakeKey(f.key || label, i).slice(0, 36)}_${n}`;
    used.add(key);
    fields.push({
      key, label, example, maxLength: fieldMaxLength(example, f.maxLength),
      multiline: f.multiline === true || example.includes("\n"),
      sensitive: f.sensitive === true || SENSITIVE.test(example) || SENSITIVE.test(label),
    });
    if (fields.length >= TEMPLATE_LIMITS.fields) break;
  }
  return {
    name: swapBrands(clip(raw?.name, 60), brands).replace(/\bBRAND\b\s*/g, "").trim() || "Uploaded ad",
    tagline: swapBrands(clip(raw?.tagline, 240), brands),
    layout: swapBrands(clip(raw?.layout, TEMPLATE_LIMITS.layout), brands),
    aspect: (TEMPLATE_ASPECTS as readonly string[]).includes(raw?.aspect) ? raw.aspect : "4:5",
    fields,
    brands,
    productSlot: swapBrands(clip(raw?.productSlot, 160), brands) || "none",
    hasPeople: raw?.hasPeople === true,
    group: (TEMPLATE_GROUPS as readonly string[]).includes(raw?.group) ? raw.group : "hero",
    bestFor: swapBrands(clip(raw?.bestFor, TEMPLATE_LIMITS.bestFor), brands),
    angle: swapBrands(clip(raw?.angle, TEMPLATE_LIMITS.angle), brands).toLowerCase(),
    fits: cleanFits(raw?.fits),
    adaptTip: swapBrands(clip(raw?.adaptTip, TEMPLATE_LIMITS.adaptTip), brands),
  };
}

/** Pulls the JSON text out of a Responses API answer; throws a plain-words error on a refusal or junk. */
export function responseJson(data: any): Record<string, any> {
  const parts = (data?.output ?? []).flatMap((item: any) => item?.content ?? []);
  const refusal = parts.find((part: any) => part?.type === "refusal")?.refusal;
  if (refusal) throw new Error(`OpenAI declined to read this image: ${String(refusal).slice(0, 200)}`);
  const text = data?.output_text ?? parts.find((part: any) => part?.type === "output_text")?.text;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch { /* falls through */ }
  throw new Error("OpenAI's answer wasn't readable. Try again.");
}

/** Only our own uploads are read: the public workspace bucket, under this user's and product's templates folder. */
export function isOwnTemplateUpload(url: unknown, supabaseUrl: string, user: string, productId: string): url is string {
  if (typeof url !== "string" || url.length > 2000 || url.includes("..")) return false;
  const prefix = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/workspace/${user}/${productId}/playground/templates/`;
  return url.startsWith(prefix) && /^[A-Za-z0-9._-]+$/.test(url.slice(prefix.length));
}
