// The AI product profile (`products.insight`, written by the `insight` edge function from the product's
// website, subpages and store listings) and "Replace with AI insight": which of the product profile's
// typed fields it replaces, and with what. The brand is never overwritten: the profile's tagline,
// colours, tone and claims are suggestions the Brand page and Product page offer one by one
// (lib/brand.ts brandSuggestions). Safe in the browser; the apply route saves what `insightChanges`
// returns, and keeps the old values in `products.insight_backup` for Undo.
import type { ProductKind, ProductRow, Stage } from "./db";
import { KIND_LABEL, STAGE_LABEL } from "./db";
import { ALL_QUESTIONS, PRICES, SALES } from "./product-questions";
import { PLATFORMS, type Platform } from "./types";
import { m } from "./i18n/translate";

/** The product form's fields as the AI filled them from the sources (null / missing where they say nothing). */
export interface InsightProductFields {
  kind: ProductKind;
  stage: Stage | null;
  audience: string | null;
  price_tier: "budget" | "mid" | "premium" | null;
  sales_channel: string | null;
  region: string | null;
  /** The form's kind-specific answers (lib/product-questions.ts keys), plus differentiator. */
  answers: Record<string, string>;
  /** Handles, without @: instagram, tiktok, youtube, x, linkedin, facebook. */
  socials: Partial<Record<Platform | "facebook", string>>;
}

export interface ProductInsight {
  /** Missing on profiles written before 2026-10-03 evening. */
  product?: InsightProductFields;
  summary: string;
  tagline: string;
  category: string;
  aim: string;
  problem: string;
  solution: string;
  audience: { primary: string; segments: { name: string; description: string; pains: string[]; motivations: string[] }[] };
  value_props: string[];
  features: { name: string; benefit: string }[];
  differentiators: string[];
  pricing: { model: string; details: string; price_tier: "budget" | "mid" | "premium" | "unknown" };
  sales_channel: string;
  region: string;
  proof: string[];
  brand: { colors: { hex: string; name: string; role: string; evidence: string }[]; tone: string; voice: string[]; visual_style: string; typography: string };
  messaging: { hooks: string[]; phrases: string[]; ctas: string[] };
  keywords: string[];
  competitors: string[];
  claims_to_avoid: string[];
  gaps: string[];
  sources: { url: string; kind: "website" | "subpage" | "app_store" | "google_play"; title: string; ok: boolean; note?: string }[];
  images: { url: string; label: string }[];
  socials: string[];
  colorCandidates: string[];
  appStore: {
    url: string; name: string; seller: string; sellerUrl: string | null; genre: string; rating: number | null; ratingCount: number | null; price: string; iconUrl: string | null; screenshots: string[];
    /** Customer reviews, verbatim (the insight function: Apple's RSS feed, else the App Store page). Missing before 2026-10-09. */
    reviews?: import("./reviews").AppStoreReview[];
    reviewsSource?: "rss" | "page";
    reviewsAt?: string;
  } | null;
  model: string;
  generatedAt: string;
}

/** A run that has said nothing for this long is dead (the edge function's limit is far below it). */
export const INSIGHT_STALE_MS = 8 * 60_000;

export type InsightState = "none" | "running" | "done" | "failed";

export function insightState(p: Pick<ProductRow, "insight_status" | "insight_started_at" | "insight">, now = Date.now()): InsightState {
  if (p.insight_status === "running") {
    const last = p.insight_started_at ? Date.parse(p.insight_started_at) : 0;
    return now - last < INSIGHT_STALE_MS ? "running" : "failed";
  }
  if (p.insight_status === "failed") return "failed";
  return p.insight ? "done" : "none";
}

/** The links the AI reads, as the edge function picks them (website, extra links, the kit's App Store link). */
export function insightLinks(p: Pick<ProductRow, "website" | "links" | "brand_kit">): string[] {
  const kit = (p.brand_kit ?? {}) as { appStoreUrl?: unknown };
  const raw = [p.website ?? "", ...(p.links ?? []), typeof kit.appStoreUrl === "string" ? kit.appStoreUrl : ""];
  const seen = new Set<string>();
  return raw.map((l) => l.trim()).filter((l) => {
    const key = l.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
    if (!key.includes(".") || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// MARK: Replace with AI insight

/** The product fields "Replace" writes. */
type ProductField = "kind" | "stage" | "description" | "audience" | "category_label" | "price_tier" | "sales_channel" | "region" | "keywords" | "known_competitors" | "website" | "answers" | "socials";

export interface InsightChange { label: string; before: string; after: string }

export interface InsightPatch {
  product: Partial<Pick<ProductRow, ProductField>>;
  changes: InsightChange[];
}

const optionLabel = (options: { value: string; label: string }[], value: string | null | undefined) => (value ? options.find((o) => o.value === value)?.label ?? value : "");
const questionLabel = (key: string) => ALL_QUESTIONS.find((q) => q.key === key)?.label ?? key;
const answerLabel = (key: string, value: string) => optionLabel(ALL_QUESTIONS.find((q) => q.key === key)?.options ?? [], value);
const show = (v: unknown): string => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v));
const merge = (a: string[], b: string[], max: number) => {
  const seen = new Set<string>();
  return [...a, ...b].map((x) => x.trim()).filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase())).slice(0, max);
};

/** The platforms', stores' and site builders' own accounts (linked from badges), never a product's handle. */
export const isPlatformAccount = (handle: string) => /^(app-?store|apple|itunes|google|google-?play|googleplay|android|meta|facebook|instagram|threads|whatsapp|messenger|x|twitter|youtube|tiktok|linkedin|pinterest|wix|shopify|squarespace|webflow|wordpress|framer|stripe|trustpilot|producthunt)$/i.test(handle.replace(/^@/, ""));

/** "https://instagram.com/volt/" → ["instagram", "volt"]; null for share links, posts and the like. */
export function socialHandle(url: string): [Platform | "facebook", string] | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.replace(/^(www|m)\./, "").toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (host === "linkedin.com") return parts[0] === "company" && parts[1] ? ["linkedin", parts[1]] : null;
  const map: Record<string, Platform | "facebook"> = { "instagram.com": "instagram", "tiktok.com": "tiktok", "youtube.com": "youtube", "x.com": "x", "twitter.com": "x", "facebook.com": "facebook" };
  const key = map[host];
  const first = parts[0]?.replace(/^@/, "");
  if (isPlatformAccount(first ?? "")) return null;
  if (!key || !first || parts.length > 1 || /^(share|sharer|intent|home|p|reel|watch|hashtag|explore|channel|c|user|profile|people|pages|groups)(\.php)?$/i.test(first)) return null;
  return [key, first];
}

/**
 * What "Replace with AI insight" writes, on the product profile only. The profile's text replaces what
 * was typed (description, who it's for, category, price point, where people buy, market, keywords);
 * competitors gain the AI's; filled-in handles are only filled when empty. The brand kit and brand
 * system are left alone (the brand suggestions are lib/brand.ts brandSuggestions).
 */
export function insightChanges(product: ProductRow, insight: ProductInsight): InsightPatch {
  const out: InsightPatch["product"] = {};
  const changes: InsightChange[] = [];
  const set = <K extends ProductField>(key: K, label: string, value: ProductRow[K] | undefined, display?: [string, string]) => {
    if (value === undefined || JSON.stringify(value) === JSON.stringify(product[key] ?? null)) return;
    out[key] = value;
    changes.push({ label, before: display?.[0] ?? show(product[key]), after: display?.[1] ?? show(value) });
  };

  // The onboarding form's fields, as the AI filled them from the sources (older profiles: from the prose).
  const f = insight.product;
  if (f?.kind) set("kind", m("What you're building"), f.kind, [KIND_LABEL[product.kind] ?? product.kind, KIND_LABEL[f.kind] ?? f.kind]);
  if (f?.stage) set("stage", m("Where you are today"), f.stage, [product.stage ? STAGE_LABEL[product.stage] : "", STAGE_LABEL[f.stage]]);
  if (insight.summary.length >= 15) set("description", m("What it is"), insight.summary.slice(0, 2000));
  const audience = f?.audience || insight.audience.primary;
  if (audience) set("audience", m("Who it's for"), audience);
  if (insight.category) set("category_label", m("Category"), insight.category);
  const tier = f?.price_tier ?? (insight.pricing.price_tier !== "unknown" ? insight.pricing.price_tier : null);
  if (tier) set("price_tier", m("Price point"), tier, [optionLabel(PRICES, product.price_tier), optionLabel(PRICES, tier)]);
  const channel = f?.sales_channel ?? (insight.sales_channel && insight.sales_channel !== "unknown" ? insight.sales_channel : null);
  if (channel) set("sales_channel", m("Where people buy it"), channel, [optionLabel(SALES, product.sales_channel), optionLabel(SALES, channel)]);
  const region = f?.region || insight.region;
  if (region) set("region", m("Market"), region);
  if (insight.keywords.length) set("keywords", m("Niche keywords"), insight.keywords.slice(0, 12));
  if (insight.competitors.length) set("known_competitors", m("Competitors"), merge(product.known_competitors, insight.competitors, 200));
  const site = insight.sources.find((s) => s.ok && s.kind === "website");
  if (!product.website && site) set("website", m("Website"), site.url);

  // Every question the form asks that the AI could answer; the user's other answers stay.
  const found: Record<string, string> = { ...(f?.answers ?? {}) };
  if (!found.differentiator && insight.differentiators.length) found.differentiator = insight.differentiators.slice(0, 3).join("; ").slice(0, 600);
  const answers = { ...product.answers, ...found };
  const answerLines = (a: Record<string, string>) => Object.keys(found).filter((k) => a[k]).map((k) => `${questionLabel(k)} ${answerLabel(k, a[k])}`).join(" · ");
  if (Object.keys(found).length) set("answers", m("Answers"), answers, [answerLines(product.answers ?? {}), answerLines(answers)]);

  // Handles: the AI's (from the site's links, footers and structured data) fill the empty ones; ones you typed stay.
  const socials = { ...(product.socials as Record<string, string>) };
  const foundHandles: Record<string, string> = { ...(f?.socials ?? {}) };
  for (const link of insight.socials) {
    const hit = socialHandle(link);
    if (hit && !foundHandles[hit[0]]) foundHandles[hit[0]] = hit[1];
  }
  for (const [key, handle] of Object.entries(foundHandles)) {
    if (handle && !isPlatformAccount(handle) && !socials[key] && (PLATFORMS as string[]).concat("facebook").includes(key)) socials[key] = handle;
  }
  const handles = (s: Record<string, string | undefined>) => Object.entries(s).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ");
  set("socials", m("Social handles"), socials, [handles(product.socials ?? {}), handles(socials)]);

  return { product: out, changes };
}

/** What Replace overwrites, kept for Undo: the product fields it changes. */
export function backupOf(product: ProductRow, patch: InsightPatch) {
  return {
    product: Object.fromEntries(Object.keys(patch.product).map((k) => [k, product[k as ProductField] ?? null])),
    at: new Date().toISOString(),
  };
}

export const SALES_LABEL: Record<string, string> = {
  online_store: m("Their own website / online store"), retail: m("Shops and retail partners"), app_store: m("App Store / Google Play"),
  sales_team: m("A sales team or demos"), physical_location: m("A place people visit"), marketplace: m("Marketplaces"), unknown: m("Not clear"),
};

// MARK: The profile in prompts

/** The parts of the AI profile the creative prompts use (what ResearchBrand and the Studio carry). */
export interface ProductProfile {
  summary: string;
  solution: string;
  audience: string;
  /** Customer groups, each with its main pain (Format library angles: one per group). */
  segments: { name: string; pain: string; motivation: string }[];
  pains: string[];
  promises: string[];
  differentiators: string[];
  features: { name: string; benefit: string }[];
  proof: string[];
  visualStyle: string;
  voice: string;
  phrases: string[];
  ctas: string[];
  avoid: string[];
}

/** The prompt-ready profile from a stored insight; null when there's none (or it says nothing useful). */
export function profileOf(insight: ProductInsight | null | undefined): ProductProfile | null {
  if (!insight?.summary) return null;
  const segments = insight.audience?.segments ?? [];
  return {
    summary: insight.summary,
    solution: insight.solution ?? "",
    audience: insight.audience?.primary || segments[0]?.name || "",
    segments: segments.slice(0, 3).map((s) => ({ name: s.name, pain: s.pains[0] ?? "", motivation: s.motivations[0] ?? "" })),
    pains: [...new Set(segments.flatMap((s) => s.pains.slice(0, 2)))].slice(0, 4),
    promises: insight.value_props.slice(0, 4),
    differentiators: insight.differentiators.slice(0, 3),
    features: insight.features.slice(0, 5),
    proof: insight.proof.slice(0, 3),
    visualStyle: insight.brand?.visual_style ?? "",
    voice: [insight.brand?.tone, insight.brand?.voice?.length ? `(${insight.brand.voice.join(", ")})` : ""].filter(Boolean).join(" "),
    phrases: insight.messaging?.phrases.slice(0, 6) ?? [],
    ctas: insight.messaging?.ctas.slice(0, 3) ?? [],
    avoid: insight.claims_to_avoid.slice(0, 8),
  };
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : text);

/**
 * The profile as a short block for a Studio prompt: what the product is, who it's for and their pain,
 * what it promises, proof that may be said as written, the look and the voice, and what never to
 * claim. Images get the tighter version (image models drift on long prompts).
 */
export function profileBrief(p: ProductProfile, o: { kind: "image" | "video"; max?: number }): string {
  const max = o.max ?? (o.kind === "image" ? 850 : 1100);
  const video = o.kind === "video";
  const bare = (t: string) => t.trim().replace(/[.;]+$/, "");
  // Lower `drop` goes first when the block is too long; the promise and who it's for stay.
  const lines: { text: string; drop: number }[] = [
    { text: `- What it is: ${cut(bare(p.summary), video ? 240 : 130)}`, drop: 9 },
    p.audience ? { text: `- For: ${cut(bare(p.audience), video ? 120 : 90)}${p.pains[0] ? `; their pain: ${cut(bare(p.pains[0]), video ? 100 : 80)}` : ""}`, drop: 8 } : null,
    p.promises.length ? { text: `- Promise: ${p.promises.slice(0, video ? 2 : 1).map((x) => cut(bare(x), 100)).join("; ")}`, drop: 10 } : null,
    video && p.differentiators.length ? { text: `- Different: ${cut(bare(p.differentiators[0]), 110)}`, drop: 2 } : null,
    p.proof.length ? { text: `- Proof (only as written): ${p.proof.slice(0, 2).map((x) => cut(bare(x), 90)).join("; ")}`, drop: 6 } : null,
    p.visualStyle ? { text: `- Look: ${cut(bare(p.visualStyle), 140)}`, drop: video ? 5 : 8.5 } : null,
    video && p.voice ? { text: `- Voice: ${cut(bare(p.voice), 120)}`, drop: 3 } : null,
    p.avoid.length ? { text: `- Never claim: ${p.avoid.slice(0, 3).map((x) => cut(bare(x), 70)).join("; ")}`, drop: 7 } : null,
  ].filter((l): l is { text: string; drop: number } => Boolean(l));
  const head = "ABOUT THE PRODUCT (from its own website and store listing; build the message from this, invent nothing beyond it):";
  const render = () => [head, ...lines.map((l) => l.text)].join("\n");
  while (render().length > max && lines.length > 1) {
    const lowest = lines.reduce((min, l, i) => (l.drop < lines[min].drop ? i : min), 0);
    lines.splice(lowest, 1);
  }
  return render().slice(0, max);
}
