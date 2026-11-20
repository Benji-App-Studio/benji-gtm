// Planning a creative batch: which jobs a format card or brief turns into (N variants × aspect ratios
// × kinds), what each costs in Higgsfield credits, and what QA will check against. Plain TypeScript
// with no runtime APIs, so the browser (live estimate), the API routes and the Node tests share it.
// Meta placements (meta-formats.ts) pick the aspect ratios and add their size and safe zones to the prompts.
import { awarenessLine, cleanAwareness } from "./awareness";
import { brandBlocks, brandRules, cleanMustAvoid, type BrandQa, type RulesKind } from "./brand-rules";
import type { BrandSystem } from "./brand-system";
import { cleanComposedProduct, cleanCopy, COMPOSED_ASPECTS, fitProblems, layoutById, layoutRoles, platePrompt, unplacedCopy, unplacedNote, type ComposedCopy, type ComposedProduct } from "./composed-ads";
import type { ProductProfile } from "./product-insight";
import { APP_BEST_PRACTICE, CAROUSEL, CAROUSEL_PLACEMENTS, carouselPrompt, placementById, PLACEMENT_IDS, VIDEO_BEST_PRACTICE, type AdFormatId, type Aspect, type Placement, type PlacementId } from "./meta-formats";
import type { PLAYGROUND_SOURCE } from "./playground";
import type { PlaygroundSettings } from "./playground-plan";
import type { TEMPLATE_SOURCE } from "./playground-templates";
import type { TemplateRemakeSettings } from "./playground-templates-plan";
import { cleanLogo, logoBriefLines, logoCandidates, logoParams, type LogoSettings } from "./logo-overlay";
import { adStyleById } from "./ad-styles";
import { forProvider, normalizeImageProvider, type ImageProvider, type ProviderJob } from "./image-provider";
import { fill, m } from "./i18n/translate";

export type { Aspect, PlacementId, AdFormatId };
export { cleanMustAvoid, MUST_AVOID } from "./brand-rules";
export type CreativeKind = "ugc_video" | "ai_video" | "image" | "reddit" | "tweet";
export type VideoMode = "ugc" | "ugc_how_to" | "ugc_unboxing" | "product_review" | "product_showcase" | "tv_spot" | "wild_card";
export type VideoResolution = "480p" | "720p" | "1080p";
export type ImageModel = "gpt_image_2_5" | "marketing_studio_image";
export type ImageQuality = "low" | "medium" | "high" | "xhigh" | "max";
export type ImageResolution = "1k" | "2k" | "4k";
export type PolicyProfile = "health" | "immigration_tax" | "general";

export const KINDS: CreativeKind[] = ["ugc_video", "ai_video", "image", "reddit", "tweet"];
export const ASPECTS: Aspect[] = ["9:16", "4:5", "1:1", "16:9"];
export const KIND_LABEL: Record<CreativeKind, string> = { ugc_video: m("AI UGC video"), ai_video: m("AI video"), image: m("Image ad"), reddit: m("Reddit-style post"), tweet: m("Tweet-style post") };
export const VIDEO_MODES: { id: VideoMode; label: string; hint: string }[] = [
  { id: "ugc", label: "UGC", hint: m("A presenter, phone-filmed feel") },
  { id: "ugc_how_to", label: m("How-to"), hint: m("A presenter shows how it works") },
  { id: "product_review", label: m("Product review"), hint: m("A presenter's take on the app") },
  { id: "ugc_unboxing", label: m("Unboxing"), hint: m("A first-look reveal") },
  { id: "product_showcase", label: m("Showcase"), hint: m("The product itself, polished") },
  { id: "tv_spot", label: m("TV spot"), hint: m("Broadcast-style commercial") },
  { id: "wild_card", label: m("Wild card"), hint: m("The model picks the vibe") },
];
/** Modes that take a Marketing Studio hook and setting. */
export const SETUP_MODES: VideoMode[] = ["ugc", "ugc_how_to", "ugc_unboxing", "product_review"];

export interface VideoOptions {
  mode: VideoMode;
  duration: number;
  resolution: VideoResolution;
  generateAudio: boolean;
  avatar?: { id: string; type: "preset" | "custom"; name?: string } | null;
  hookId?: string | null;
  settingId?: string | null;
  /** Where Marketing Studio gets the product: the App Store page, the brand kit's screenshots, or nothing. */
  product: "app_store" | "screenshots" | "none";
}

/** Seedance 2.5 on the Higgsfield API: a clip from the brief, with the app's screenshots as references. */
export interface AiVideoOptions { duration: number; resolution: VideoResolution; generateAudio: boolean; useScreenshots: boolean }

export interface ImageOptions {
  model: ImageModel; quality: ImageQuality; resolution: ImageResolution; useScreenshots: boolean;
  /**
   * Who makes GPT Image 2.5 images (lib/image-provider.ts): Higgsfield (default) or OpenAI, the same
   * model. Marketing Studio Image is Higgsfield's alone.
   */
  provider?: ImageProvider;
  /**
   * Composed ads (lib/composed-ads.ts): the model makes a text-free plate and the copy is set on it in
   * the brand's fonts afterwards (exact words, mobile type floors, editable). Single images in 4:5, 1:1 and 9:16.
   * `product`: "Use the real product": a product image's cut-out (Product page), composited into the
   * layout's product box with a floor shadow instead of the model drawing the product.
   */
  composed?: { layout: string; copy: ComposedCopy; product?: ComposedProduct | null } | null;
}

/** Copy for one Reddit- or tweet-style post: real text, rendered from a template. */
export interface PostCopy { title?: string; body: string }

export interface BatchRequest {
  formatCardId?: string | null;
  brief: string;
  kinds: CreativeKind[];
  /** AI variants per kind and placement (posts make one per copy instead). A carousel makes this many sets. */
  variants: number;
  /** Used when no placements are picked (older requests and format-card jobs). */
  aspects: Aspect[];
  /** Meta placements to make each creative for; they set the aspect ratios and add their specs to the prompts. */
  placements?: PlacementId[];
  /** Single image/video ads, or carousel sets of `cards` image cards. */
  format?: AdFormatId;
  cards?: number;
  video: VideoOptions;
  /** Optional for older requests; DEFAULT_REQUEST.aiVideo fills it in. */
  aiVideo?: AiVideoOptions;
  image: ImageOptions;
  reddit: PostCopy[];
  tweets: PostCopy[];
  /** The subreddit line on Reddit-style posts, e.g. "r/productivity". */
  community?: string;
  /**
   * Research → Recreate: what must never appear in these creatives (the competitor's brand and page name,
   * their links, handles, phone numbers…). Added to QA's competitor list, so Jev flags it in on-screen text.
   * At most MUST_AVOID.items items of MUST_AVOID.chars characters (cleanMustAvoid).
   */
  mustAvoid?: string[];
  /**
   * Research → Recreate: the competitor ad's own image(s), stored copies, sent to Higgsfield ahead of the
   * brand kit screenshots so image creatives follow its layout and style; for a video ad, its stored key
   * frames, which AI videos (Seedance) follow the same way. Never sent with UGC videos (Marketing Studio
   * takes no reference images). At most STYLE_REFERENCES (cleanStyleReferences).
   */
  styleReferences?: string[];
  /**
   * Our own product images the user picked (Product page images), sent to Higgsfield after any
   * competitor image and before the screenshots, for images and AI videos. At most PRODUCT_REFERENCES.
   */
  productReferences?: ProductReference[];
  /** The brief already describes the attached images (Recreate): the plan adds no line of its own. */
  referencesInBrief?: boolean;
  /**
   * Use the product's brand system (lib/brand-system.ts): its prompt modifier opens every image prompt,
   * copy follows its voice and speaks to one avatar per variant, and only its offers may appear. On
   * unless false; Recreate turns it off when its brief already carries the brand.
   */
  useBrandSystem?: boolean;
  /**
   * The brief already states the brand rules (Recreate composes it with lib/brand-rules.ts): the plan
   * adds no brand look, profile, copy or rules of its own, and QA still checks every rule (the brand
   * system's offers and banned words included). Cleared when the brief is replaced.
   */
  brandInBrief?: boolean;
  /**
   * A Research recreate: the brief already describes the ad to make (their structure, our brand, what
   * our product is and whether our app's screens belong in it), so image jobs add no app framing,
   * best practice or opening angles of their own; those turned every recreate into a phone-mockup ad.
   */
  fromRecreate?: boolean;
  /**
   * Research → Recreate at "Exact": the brief is an edit of their attached ad and is sent as written,
   * with only the output size and (for more than one variant) a small-variation line. No app line,
   * angles, best practices, look or profile: each of those changed the ad into something else.
   */
  exactRecreate?: boolean;
  /**
   * Add the AI product profile (what it is, who it's for and their pain, the promise, proof, look,
   * claims to avoid) to every AI prompt. On unless false; off for briefs that already carry it
   * (Recreate) and for format-card recipes (their angle comes from it).
   */
  useProfile?: boolean;
  /**
   * Where the batch came from: unset for the Studio, "playground" for the Playground, whose batches
   * are planned by planPlayground (lib/playground-plan.ts) with their own prompt, "playground-template"
   * for a template remake (planTemplateRemake, lib/playground-templates-plan.ts). Saved in settings.
   */
  source?: typeof PLAYGROUND_SOURCE | typeof TEMPLATE_SOURCE;
  /** Playground: the request as the person made it, kept in settings so it can be reopened. */
  playground?: PlaygroundSettings;
  /** Template remake: which template and how, kept in settings so the API can link the result back. */
  template?: TemplateRemakeSettings;
  /**
   * Our real logo for image creatives: placed on each finished image (lib/logo-overlay.ts; the Studio's
   * "Place the real logo", on by default when there is a logo, and Recreate) and, from Recreate, also
   * sent as a labelled reference right after the competitor's image(s). Composed ads place it in their
   * layout's logo slot instead. The model is told to draw no logo of its own. Checked by cleanLogo.
   */
  logo?: LogoSettings | null;
  /**
   * The awareness level the batch is aimed at (lib/awareness.ts, 1 unaware … 5 most aware): its job goes
   * into every AI prompt (not Exact recreations, whose brief is the whole prompt), each job carries it as
   * `awareness_level`, and the batch and its creatives store it. Unset: no level.
   */
  awarenessLevel?: number | null;
  /**
   * The competitor ad a Research recreate ("Make this for your app", Recreate) was made from, saved in
   * the batch's settings so Launch's Ads view can trace an ad back to it. Checked by cleanSourceAd.
   */
  sourceAd?: SourceAdRef | null;
}

/** A Research ad: paid_ads.id, its Ad Library id and the page (or competitor) that ran it. */
export interface SourceAdRef { adId: string; libraryId: string; pageName: string }

export function cleanSourceAd(value: unknown): SourceAdRef | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const str = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
  const adId = str(v.adId, 64), libraryId = str(v.libraryId, 40);
  if (!/^[0-9a-f-]{36}$/i.test(adId) && !/^\d{5,25}$/.test(libraryId)) return null;
  return { adId: /^[0-9a-f-]{36}$/i.test(adId) ? adId : "", libraryId: /^\d{5,25}$/.test(libraryId) ? libraryId : "", pageName: str(v.pageName, 120) };
}

export const STYLE_REFERENCES = 4;

export interface ProductReference { url: string; label: string; kind: string }

/** Our product images made safe: https links, labels trimmed, no duplicates, at most 3. */
export function cleanProductReferences(list: unknown): ProductReference[] {
  if (!Array.isArray(list)) return [];
  const out: ProductReference[] = [];
  for (const item of list) {
    const url = typeof item?.url === "string" && /^https:\/\/\S+$/i.test(item.url) && item.url.length <= 2000 ? item.url : null;
    if (!url || out.some((o) => o.url === url)) continue;
    out.push({ url, label: typeof item.label === "string" ? item.label.replace(/\s+/g, " ").trim().slice(0, 80) : "", kind: typeof item.kind === "string" ? item.kind.slice(0, 20) : "other" });
    if (out.length >= 3) break;
  }
  return out;
}

/** The line a Studio prompt gets for our own images (unless the brief already describes them). */
export function ourImagesLine(refs: ProductReference[], competitorImages: number): string {
  if (!refs.length) return "";
  const first = competitorImages + 1;
  const list = refs.map((r, i) => `${first + i}) ${r.label || "our product"} (${r.kind.replace("_", " ")})`).join("; ");
  return `OUR IMAGES: attached image${refs.length > 1 ? "s" : ""} ${refs.length > 1 ? `${first}–${first + refs.length - 1}` : first} ${refs.length > 1 ? "are" : "is"} ours: ${list}. Build the creative around them: re-compose the scene so they belong there (scale, angle, lighting, layout adjusted) and keep our product exactly as it looks; never paste it flat onto the image.`;
}

/** Reference image links made safe: https only, no duplicates, at most STYLE_REFERENCES. */
export function cleanStyleReferences(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out = list.filter((u): u is string => typeof u === "string" && /^https:\/\/\S+$/i.test(u) && u.length <= 2000);
  return [...new Set(out)].slice(0, STYLE_REFERENCES);
}

export interface PlannedJob {
  kind: CreativeKind;
  model: string;
  prompt: string;
  params: Record<string, unknown>;
  aspect: Aspect;
  variant: number;
  backend: "auto" | "local" | "api" | "template";
  /** Higgsfield credits (0 for an OpenAI job). */
  costEstimate: number;
  /** An OpenAI job's estimated cost in USD (lib/image-provider.ts OPENAI_IMAGE_PRICING). */
  costUsd?: number;
}

export interface Plan {
  jobs: PlannedJob[]; credits: number; byKind: Partial<Record<CreativeKind, { jobs: number; credits: number; usd?: number }>>; warnings: string[]; errors: string[];
  /** What the OpenAI jobs are estimated to cost, in USD (none: Higgsfield only). Confirmed like the credits. */
  usd?: number;
  /** The brand rules the prompts were built with (lib/brand-rules.ts): createBatch freezes QA from them. */
  qa?: BrandQa;
}

export const LIMITS = { variants: 6, aiJobs: 24, jobs: 72, minDuration: 4, maxDuration: 30, briefChars: 4000 };

export const DEFAULT_REQUEST: BatchRequest = {
  brief: "", kinds: ["ugc_video", "image"], variants: 2, aspects: ["9:16", "4:5"], placements: ["stories_reels", "feed_vertical"], format: "single", cards: CAROUSEL.defaultCards,
  video: { mode: "ugc", duration: 15, resolution: "720p", generateAudio: true, product: "screenshots" },
  aiVideo: { duration: 10, resolution: "720p", generateAudio: true, useScreenshots: true },
  image: { model: "gpt_image_2_5", quality: "medium", resolution: "2k", useScreenshots: true },
  reddit: [], tweets: [],
};

// MARK: Prices

/**
 * Higgsfield credits, from `higgsfield generate cost` (free) on 2026-10-02. Marketing Studio video
 * costs per second by resolution (mode, aspect and audio didn't change it); GPT Image 2.5 by quality
 * and resolution (aspect didn't change it); Marketing Studio Image is flat per resolution. This is the
 * one price table: the Studio, the Playground and the format library (formats/recreate.ts) estimate with
 * it. Both backends ask for the live price before each job and refuse one above priceLimit(estimate)
 * (1.5× or 2 credits more: supabase/functions/creatives/core/jobs.ts PRICE_TOLERANCE), and record the
 * real charge as cost_credits (the runner: the CLI's reported cost, else its quote; the API: its
 * estimate, cleared to 0 when the request ends without a result). The Studio's "spent" sums cost_credits.
 */
export const PRICES_CHECKED = "2026-10-02";
const VIDEO_PER_SECOND: Record<VideoResolution, number> = { "480p": 3.5, "720p": 5, "1080p": 10 };
const GPT_IMAGE: Record<ImageQuality, Record<ImageResolution, number>> = {
  low: { "1k": 0.25, "2k": 0.5, "4k": 0.75 },
  medium: { "1k": 0.5, "2k": 1, "4k": 1.5 }, // 4k medium wasn't quoted (503); estimated between its neighbours
  high: { "1k": 1.5, "2k": 2.75, "4k": 4.25 },
  xhigh: { "1k": 2.5, "2k": 4.5, "4k": 7 },
  max: { "1k": 5, "2k": 9, "4k": 15 },
};
const MS_IMAGE: Record<ImageResolution, number> = { "1k": 2, "2k": 2, "4k": 4 };
/**
 * Seedance 2.5 per second (cost quote of 2026-10-02: 10 s at 480p 30, 720p 70, 1080p 120; rechecked
 * 2026-10-05: 7 s at 720p 49 and 1080p 84, 15 s at 720p 105 and 1080p 180, 4 s at 1080p 48). Sound,
 * aspect and mode (text-to-video, references, a start frame) didn't change it. The Studio's AI videos
 * and the Playground's videos both estimate with it; the API worker asks the API's own estimate before submitting.
 */
const SEEDANCE_PER_SECOND: Record<VideoResolution, number> = { "480p": 3, "720p": 7, "1080p": 12 };

export function jobCost(model: string, params: Record<string, unknown>): number {
  if (model === "marketing_studio_video") {
    const res = (params.resolution as VideoResolution) ?? "720p";
    return round((VIDEO_PER_SECOND[res] ?? VIDEO_PER_SECOND["720p"]) * clamp(Number(params.duration) || 15, LIMITS.minDuration, LIMITS.maxDuration));
  }
  if (model === "gpt_image_2_5") {
    const q = (params.quality as ImageQuality) ?? "medium";
    const r = (params.resolution as ImageResolution) ?? "2k";
    return GPT_IMAGE[q]?.[r] ?? GPT_IMAGE.medium["2k"];
  }
  if (model === "marketing_studio_image") return MS_IMAGE[(params.resolution as ImageResolution) ?? "2k"] ?? 2;
  if (model === "seedance_2_5") {
    const res = (params.resolution as VideoResolution) ?? "720p";
    return round((SEEDANCE_PER_SECOND[res] ?? SEEDANCE_PER_SECOND["720p"]) * clamp(Math.round(Number(params.duration)) || 10, LIMITS.minDuration, LIMITS.maxDuration));
  }
  return 0;
}

const round = (n: number) => Math.round(n * 100) / 100;
const roundUsd = (n: number) => Math.round(n * 10_000) / 10_000;

/** A plan's credits (Higgsfield), dollars (OpenAI, when any) and both per kind. Every planner sums its jobs with it. */
export function totals(jobs: PlannedJob[]): Pick<Plan, "jobs" | "credits" | "byKind" | "usd"> {
  const byKind: Plan["byKind"] = {};
  for (const job of jobs) {
    const entry = byKind[job.kind] ?? { jobs: 0, credits: 0 };
    entry.jobs++;
    entry.credits = round(entry.credits + job.costEstimate);
    if (job.costUsd) entry.usd = roundUsd((entry.usd ?? 0) + job.costUsd);
    byKind[job.kind] = entry;
  }
  const usd = roundUsd(jobs.reduce((n, j) => n + (j.costUsd ?? 0), 0));
  return { jobs, credits: round(jobs.reduce((n, j) => n + j.costEstimate, 0)), byKind, ...(usd ? { usd } : {}) };
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// MARK: Planning

/** Marketing Studio video has no 4:5; 3:4 is the nearest it makes (Meta crops 3:4 to 4:5 cleanly). */
export const videoAspect = (aspect: Aspect) => (aspect === "4:5" ? "3:4" : aspect);

/** Different angles for each variant, so N variants of one brief don't come back near-identical (the Studio and the Playground). */
export const ANGLES = [
  "Open on the problem in the first second.",
  "Open with a surprising number or fact.",
  "Open mid-situation, as if the viewer just walked in.",
  "Open with a direct, calm question about the situation (never about the viewer's own status).",
  "Open by showing the app's screen straight away.",
  "Open with a short 'here's how I keep track' line.",
];

/** "Variant 2 of 3: <angle>", or "" for a single variant. */
export const variantLine = (variant: number, total: number) => (total > 1 ? `Variant ${variant} of ${total}: ${ANGLES[(variant - 1) % ANGLES.length]}` : "");

function videoPrompt(brief: string, appName: string, variant: number, total: number, placement?: Placement, about = "", look = "") {
  return [
    look,
    brief.trim(),
    about,
    `The app is called "${appName}"; say and show that name exactly.`,
    "The presenter explains and demonstrates the app; they don't claim to be a customer, doctor, lawyer or official.",
    variantLine(variant, total),
    placement ? placement.prompt : "",
    VIDEO_BEST_PRACTICE,
    APP_BEST_PRACTICE,
  ].filter(Boolean).join("\n");
}

function aiVideoPrompt(brief: string, appName: string, variant: number, total: number, placement?: Placement, about = "", look = "") {
  return [
    look,
    brief.trim(),
    about,
    `An ad for the mobile app "${appName}"; if its name appears, spell it exactly. Anyone on screen is an actor demonstrating the app, never a customer, doctor, lawyer or official.`,
    variantLine(variant, total),
    placement ? placement.prompt : "",
    VIDEO_BEST_PRACTICE,
    APP_BEST_PRACTICE,
  ].filter(Boolean).join("\n");
}

function imagePrompt(brief: string, appName: string, aspect: Aspect, variant: number, total: number, placement?: Placement, card?: { card: number; cards: number }, about = "", look = "") {
  return [
    // The brand's prompt modifier opens the prompt (/brand writes it to be read first).
    look,
    brief.trim(),
    about,
    `A ${aspect} mobile ad for the app "${appName}". If any text appears, keep it to a few large words and spell "${appName}" exactly.`,
    variantLine(variant, total),
    placement ? placement.prompt : "",
    card ? carouselPrompt(card.card, card.cards) : "",
    APP_BEST_PRACTICE,
  ].filter(Boolean).join("\n");
}

/** A recreate's prompt (not Exact): the brief as written, the size, the placement, and how variants differ. */
function recreateImagePrompt(brief: string, aspect: Aspect, variant: number, total: number, placement?: Placement, card?: { card: number; cards: number }, extra = "") {
  return [
    brief.trim(),
    extra,
    `Output: one ${aspect} image.`,
    total > 1 ? `Version ${variant} of ${total}: the same structure; vary the photo and the exact wording, not the format.` : "",
    placement ? placement.prompt : "",
    card ? carouselPrompt(card.card, card.cards) : "",
  ].filter(Boolean).join("\n");
}

/** An exact recreation's prompt: the brief as written, the output size, and how variants may differ. */
function exactImagePrompt(brief: string, aspect: Aspect, variant: number, total: number) {
  return [
    brief.trim(),
    `Output: one ${aspect} image.`,
    total > 1 ? `Version ${variant} of ${total}: the same ad; only the photo's small details may differ (light, the subject's exact angle).` : "",
  ].filter(Boolean).join("\n");
}

/**
 * A batch's name for lists: a Research recreate by what it made ("Recreate · carousel of 2 image cards ·
 * Square"), else the brief's first line. Briefs are prompts, too long and too raw to list as they are.
 */
export function batchTitle(brief: string | null | undefined): string {
  const text = (brief ?? "").trim();
  const exact = /^EDIT (?:THE ATTACHED AD|THE FIRST \d+ ATTACHED IMAGES)[^\n]*?, for ([^(\n]+?) \(/.exec(text);
  if (exact) return `Exact recreate · ${exact[1].replace(/ · /g, " ")}`;
  const recreate = /^RECREATE: an? (.+?) ad for .+?, for ([^(\n]+?) \(/.exec(text);
  if (recreate) return `Recreate · ${recreate[1]} · ${recreate[2].replace(/ · /g, " ")}`;
  const first = text.split("\n")[0].replace(/\s+/g, " ");
  return first ? (first.length > 90 ? `${first.slice(0, 88).trimEnd()}…` : first) : "Batch";
}

/** What a batch is made for: its placements, or bare aspect ratios when none are picked. */
export function targetsOf(req: Pick<BatchRequest, "aspects" | "placements">): { aspect: Aspect; placement?: Placement }[] {
  const placements = (req.placements ?? []).filter((id) => PLACEMENT_IDS.includes(id)).map((id) => placementById(id)!);
  if (placements.length) return placements.map((placement) => ({ aspect: placement.aspect, placement }));
  return ASPECTS.filter((a) => req.aspects.includes(a)).map((aspect) => ({ aspect }));
}

/** Puts a plan's messages into words: English by default; the app passes its translator's `t`. */
export type PlanWords = (text: string, vars?: Record<string, string | number>) => string;
const englishWords: PlanWords = (text, vars) => fill(text, vars);

export function planBatch(req: BatchRequest, brand: { appName: string; screenshotUrls?: string[]; appStoreUrl?: string; forbiddenClaims?: string[] | null; profile?: ProductProfile | null; system?: BrandSystem | null }, t: PlanWords = englishWords): Plan {
  const errors: string[] = [];
  const warnings: string[] = [];
  // The brand's rules (lib/brand-rules.ts): the look opens each prompt; the profile, the copy rules
  // (voice, the variant's avatar, facts of the products the brief names) and the rules QA checks
  // (banned words, the closed offer list, forbidden claims, must-avoid names) follow the brief.
  // Nothing is added when the brief already states them (Recreate); QA gets the same rules either way.
  const rules = brandRules(brand, req);
  const blocks = (kind: RulesKind, variant = 1) => brandBlocks(rules, kind, { variant });
  const look = (kind: RulesKind) => blocks(kind).look;
  // The awareness level's job (lib/awareness.ts) goes with the brand text in every AI prompt but an Exact recreation's.
  const awareness = cleanAwareness(req.awarenessLevel);
  const awareLine = awareness && !req.exactRecreate ? awarenessLine(awareness) : "";
  const brandText = (kind: "image" | "video", variant: number) => { const b = blocks(kind, variant); return [awareLine, b.about, b.copy, b.rules].filter(Boolean).join("\n"); };
  // Our own images (the user's picks): after any competitor image, before the screenshots.
  const ours = cleanProductReferences(req.productReferences);
  const oursParam = ours.length ? { product_refs: ours.map((r) => r.url) } : {};
  const oursLine = (competitorImages: number) => (req.referencesInBrief ? "" : ourImagesLine(ours, competitorImages));
  const brief = req.brief.trim().slice(0, LIMITS.briefChars);
  const kinds = KINDS.filter((k) => req.kinds.includes(k));
  const targets = targetsOf(req);
  const aspects = targets.map((t) => t.aspect);
  const variants = clamp(Math.round(req.variants) || 1, 1, LIMITS.variants);
  const carousel = req.format === "carousel";
  const cards = clamp(Math.round(req.cards ?? CAROUSEL.defaultCards) || CAROUSEL.defaultCards, CAROUSEL.minCards, CAROUSEL.maxCards);
  if (!kinds.length) errors.push(t("Pick at least one kind of creative."));
  if (!targets.length) errors.push(t("Pick at least one placement."));
  const ai = kinds.some((k) => k === "ugc_video" || k === "ai_video" || k === "image");
  if (ai && brief.length < 10) errors.push(t("Write a brief (or pick a format card) for the AI creatives."));

  const jobs: PlannedJob[] = [];
  if (kinds.includes("ugc_video")) {
    const v = req.video;
    const duration = clamp(Math.round(v.duration) || 15, LIMITS.minDuration, LIMITS.maxDuration);
    const setup = SETUP_MODES.includes(v.mode);
    if (!setup && (v.hookId || v.settingId)) warnings.push(t("The {mode} mode ignores hooks and settings; they were left out.", { mode: v.mode.replace("_", " ") }));
    if (aspects.includes("4:5")) warnings.push(t("Marketing Studio video has no 4:5; those videos are made in 3:4."));
    let product = v.product;
    if (product === "app_store" && !brand.appStoreUrl) { product = (brand.screenshotUrls?.length ? "screenshots" : "none"); warnings.push(t("No App Store link in the brand kit; the video uses the screenshots instead.")); }
    if (product === "screenshots" && !brand.screenshotUrls?.length) { product = "none"; warnings.push(t("No screenshots in the brand kit; the video is made from the brief alone.")); }
    if (carousel) warnings.push(t("Carousel cards are images; the videos are made as single ads."));
    if (cleanStyleReferences(req.styleReferences).length) warnings.push(kinds.includes("ai_video") ? t("Marketing Studio takes no reference images: only the AI videos follow the reference frames.") : t("Marketing Studio takes no reference images: the UGC videos are made from the brief alone (pick AI video to follow the reference)."));
    for (const { aspect, placement } of targets) {
      for (let variant = 1; variant <= variants; variant++) {
        const params: Record<string, unknown> = {
          mode: v.mode, duration, resolution: v.resolution, aspect_ratio: videoAspect(aspect), generate_audio: v.generateAudio, product,
          ...(placement ? { placement: placement.id } : {}),
          ...(v.avatar ? { avatars: [{ id: v.avatar.id, type: v.avatar.type }] } : {}),
          ...(setup && v.hookId ? { hook_id: v.hookId } : {}),
          ...(setup && v.settingId ? { setting_id: v.settingId } : {}),
        };
        jobs.push({ kind: "ugc_video", model: "marketing_studio_video", prompt: videoPrompt(brief, brand.appName, variant, variants, placement, brandText("video", variant), look("video")), params, aspect, variant, backend: "local", costEstimate: jobCost("marketing_studio_video", params) });
      }
    }
  }
  if (kinds.includes("ai_video")) {
    const o = { ...DEFAULT_REQUEST.aiVideo!, ...req.aiVideo };
    // A recreated video's key frames: first, then our images, then the screenshots (hf_api referenceUrls keeps that order).
    const frames = cleanStyleReferences(req.styleReferences);
    const framesLine = frames.length && !req.referencesInBrief ? `REFERENCE FRAMES: attached image${frames.length > 1 ? `s 1–${frames.length} are stills` : " 1 is a still"} from a reference video ad, in order: follow its shots, framing and pacing, and rebuild every brand-specific detail (people, product, screens, words, colours) as ours.` : "";
    const duration = clamp(Math.round(o.duration) || 10, LIMITS.minDuration, LIMITS.maxDuration);
    const screenshots = o.useScreenshots && Boolean(brand.screenshotUrls?.length);
    if (carousel && !kinds.includes("ugc_video")) warnings.push(t("Carousel cards are images; the videos are made as single ads."));
    if (aspects.includes("4:5")) warnings.push(t("Seedance has no 4:5; those AI videos are made in 3:4 (Meta trims them to 4:5)."));
    if (o.useScreenshots && !brand.screenshotUrls?.length) warnings.push(t("No screenshots in the brand kit; the AI videos are made from the brief alone."));
    for (const { aspect, placement } of targets) {
      for (let variant = 1; variant <= variants; variant++) {
        const params: Record<string, unknown> = {
          duration, resolution: o.resolution, aspect_ratio: aspect === "4:5" ? "3:4" : aspect, generate_audio: o.generateAudio, use_screenshots: screenshots,
          ...(placement ? { placement: placement.id } : {}),
          ...(frames.length ? { style_refs: frames } : {}),
          ...oursParam,
        };
        // Either backend makes Seedance: the Higgsfield API (when HIGGSFIELD_API_KEY is set) or the desktop runner's CLI.
        jobs.push({ kind: "ai_video", model: "seedance_2_5", prompt: aiVideoPrompt(brief, brand.appName, variant, variants, placement, [framesLine, oursLine(frames.length), brandText("video", variant)].filter(Boolean).join("\n"), look("video")), params, aspect, variant, backend: "auto", costEstimate: jobCost("seedance_2_5", params) });
      }
    }
  }
  if (kinds.includes("image")) {
    const o = req.image;
    // Who makes them: GPT Image 2.5 via Higgsfield (default) or via OpenAI; Marketing Studio Image only via Higgsfield.
    const provider = o.model === "gpt_image_2_5" ? normalizeImageProvider(o.provider) : "higgsfield";
    if (o.model !== "gpt_image_2_5" && normalizeImageProvider(o.provider) === "openai") warnings.push(t("Marketing Studio Image is Higgsfield's own model: it's made via Higgsfield."));
    const shots = o.useScreenshots ? brand.screenshotUrls?.length ?? 0 : 0;
    const push = (job: PlannedJob) => jobs.push(forProvider(job, provider, shots));
    if (aspects.includes("4:5") && provider === "higgsfield") warnings.push(t("On the Higgsfield API, 4:5 images are made in 3:4 (Meta trims them to 4:5); the desktop runner makes 4:5."));
    const imageTargets = carousel ? targets.filter((t) => !t.placement || CAROUSEL_PLACEMENTS.includes(t.placement.id)) : targets;
    if (carousel && imageTargets.length < targets.length) warnings.push(t("Carousel cards are square or 4:5; the other placements were left out of the image cards."));
    if (carousel && !imageTargets.length) errors.push(t("A carousel needs the Square or Feed · vertical placement."));
    // Our logo goes right after the competitor's image(s), so it stays inside the desktop runner's 4 images.
    const logo = cleanLogo(req.logo);
    const styles = cleanStyleReferences(req.styleReferences).slice(0, logo?.reference ? STYLE_REFERENCES - 1 : STYLE_REFERENCES);
    const logoLine = logo && !logo.inBrief ? logoBriefLines(logo, logo.reference ? styles.length + 1 : 0) : "";
    if (provider === "higgsfield" && logo?.reference && styles.length + 1 + ours.length > 4) warnings.push(t("The desktop runner sends at most 4 reference images (their ad, our logo, then your picks): the last of your picked images is left out there; the Higgsfield API sends them all."));
    // Composed ads: text-free plates, the copy set afterwards in the brand's fonts.
    const composedCopy = o.composed && !carousel ? cleanCopy(o.composed.copy) : null;
    const composedLayout = composedCopy ? layoutById(o.composed!.layout) : null;
    if (o.composed && carousel) warnings.push(t("Composed ads are single images; the carousel cards are made the usual way."));
    if (o.composed && !carousel && !composedCopy) errors.push(t("Write the headline for the composed ads."));
    if (composedCopy?.offer) {
      const allowed = rules.offers?.allowed ?? [];
      if (allowed.length && !allowed.some((a) => a.toLowerCase() === composedCopy.offer!.toLowerCase())) errors.push(t("\"{offer}\" isn't one of your offers (Brand page): pick one from the list.", { offer: composedCopy.offer }));
    }
    // Copy the layout has no slot for would silently be left off; copy that won't fit fails at compose
    // time, after the plates are paid for: both are said now, before credits are spent.
    if (composedCopy && composedLayout) {
      const unplaced = unplacedCopy(composedCopy, composedLayout);
      if (unplaced.length) warnings.push(unplacedNote(composedLayout, unplaced, t));
      const aspects = [...new Set(imageTargets.map((t) => t.aspect))].filter((a) => COMPOSED_ASPECTS.includes(a));
      for (const problem of fitProblems(composedCopy, composedLayout, aspects, t)) warnings.push(t("May not fit: {problem} (or pick another layout)", { problem }));
    }
    // Composed ads place our real logo in their layout's logo slot, and the product's cut-out in its product box.
    const composedProduct = composedCopy ? cleanComposedProduct(o.composed?.product) : null;
    if (o.composed?.product && composedCopy && !composedProduct) warnings.push(t("The real product's cut-out isn't a usable link: the model draws the product instead."));
    for (const { aspect, placement } of imageTargets) {
      const composing = Boolean(composedCopy && composedLayout && COMPOSED_ASPECTS.includes(aspect));
      if (composedCopy && !composing) warnings.push(t("Composed layouts cover 4:5, 1:1 and 9:16; the {aspect} images are made the usual way.", { aspect }));
      for (let variant = 1; variant <= variants; variant++) {
        if (composing) {
          const params: Record<string, unknown> = {
            aspect_ratio: aspect, resolution: o.resolution, ...(o.model === "gpt_image_2_5" ? { quality: o.quality, variant: "sunburst" } : {}),
            use_screenshots: o.useScreenshots && Boolean(brand.screenshotUrls?.length),
            ...(placement ? { placement: placement.id } : {}),
            ...(styles.length ? { style_refs: styles } : {}),
            ...oursParam,
            composed: { layout: composedLayout!.id, copy: composedCopy, ...(logo ? { logo: logo.url } : {}), ...(composedProduct ? { product: composedProduct.url } : {}) },
          };
          const prompt = platePrompt({
            brief: `${brief}${variants > 1 ? ` (variant ${variant} of ${variants}: a different angle, setting or light)` : ""}`, layout: composedLayout!, aspect, look: look("plate"), appName: brand.appName,
            productNote: [oursLine(styles.length), awareLine, blocks("plate").about].filter(Boolean).join("\n"),
            logo: Boolean(logo), realProduct: Boolean(composedProduct),
          });
          push({ kind: "image", model: o.model, prompt, params, aspect, variant, backend: "auto", costEstimate: jobCost(o.model, params) });
          continue;
        }
        for (let card = 1; card <= (carousel ? cards : 1); card++) {
          const params: Record<string, unknown> = {
            ...(o.model === "gpt_image_2_5"
              ? { aspect_ratio: aspect, resolution: o.resolution, quality: o.quality, variant: "flare", use_screenshots: o.useScreenshots && Boolean(brand.screenshotUrls?.length) }
              : { aspect_ratio: aspect, resolution: o.resolution, use_screenshots: o.useScreenshots && Boolean(brand.screenshotUrls?.length) }),
            ...(placement ? { placement: placement.id } : {}),
            ...(carousel ? { carousel: { set: variant, card, cards } } : {}),
            ...(styles.length ? { style_refs: styles } : {}),
            ...logoParams(logo, placement?.id),
            ...oursParam,
          };
          const prompt = req.exactRecreate
            ? exactImagePrompt(brief, aspect, variant, variants)
            : req.fromRecreate
            ? recreateImagePrompt(brief, aspect, variant, variants, placement, carousel ? { card, cards } : undefined, [logoLine, oursLine(styles.length + (logo?.reference ? 1 : 0)), awareLine].filter(Boolean).join("\n"))
            : imagePrompt(brief, brand.appName, aspect, variant, variants, placement, carousel ? { card, cards } : undefined, [logoLine, oursLine(styles.length + (logo?.reference ? 1 : 0)), brandText("image", variant)].filter(Boolean).join("\n"), look("image"));
          push({ kind: "image", model: o.model, prompt, params, aspect, variant, backend: "auto", costEstimate: jobCost(o.model, params) });
        }
      }
    }
  }
  for (const kind of ["reddit", "tweet"] as const) {
    if (!kinds.includes(kind)) continue;
    const copies = (kind === "reddit" ? req.reddit : req.tweets).map((c) => ({ title: c.title?.trim().slice(0, 300) || undefined, body: c.body.trim().slice(0, 1200) })).filter((c) => c.body);
    if (!copies.length) { errors.push(kind === "reddit" ? t("Write the copy for the reddit-style posts (separate posts with a line of three dashes).") : t("Write the copy for the tweet-style posts (separate posts with a line of three dashes).")); continue; }
    copies.slice(0, LIMITS.variants * 2).forEach((copy, i) => {
      for (const aspect of aspects.filter((a) => a !== "16:9")) {
        jobs.push({ kind, model: `template:${kind}`, prompt: [copy.title, copy.body].filter(Boolean).join("\n\n"), params: { copy, ...(kind === "reddit" && req.community ? { community: req.community.trim().slice(0, 60) } : {}) }, aspect, variant: i + 1, backend: "template", costEstimate: 0 });
      }
    });
  }

  const aiJobs = jobs.filter((j) => j.backend !== "template").length;
  if (aiJobs > LIMITS.aiJobs) errors.push(t("That's {n} AI jobs; keep a batch to {max} (fewer variants or ratios).", { n: String(aiJobs), max: String(LIMITS.aiJobs) }));
  if (jobs.length > LIMITS.jobs) errors.push(t("That's {n} creatives; keep a batch to {max}.", { n: String(jobs.length), max: String(LIMITS.jobs) }));
  // Every job carries the level, so the creatives it makes store it too.
  const leveled = awareness ? jobs.map((job) => ({ ...job, params: { ...job.params, awareness_level: awareness } })) : jobs;
  return { ...totals(leveled), warnings, errors, qa: rules.qa };
}

/** Splits a textarea of posts: posts separated by a "---" line; a post's first line ending in a blank line is its title. */
export function parsePosts(text: string, withTitles: boolean): PostCopy[] {
  return text.split(/^\s*-{3,}\s*$/m).map((block) => block.trim()).filter(Boolean).map((block) => {
    if (!withTitles) return { body: block };
    const [first, ...rest] = block.split(/\n\s*\n/);
    return rest.length ? { title: first.trim(), body: rest.join("\n\n").trim() } : { body: block };
  });
}

// MARK: Switching provider

/**
 * A GPT Image 2.5 job remade for the other provider ("Try with OpenAI/Higgsfield instead" on a failed
 * one): the same prompt, images and options, with that provider's params, backend and price. Null for
 * any other model (they're Higgsfield's alone). Never applied on its own: the person confirms the price.
 */
export function switchJobProvider(job: { model: string; prompt: string; params: Record<string, unknown>; aspect: string }, to: ImageProvider, screenshots = 0): Pick<PlannedJob, "params" | "backend" | "costEstimate" | "costUsd"> | null {
  if (job.model !== "gpt_image_2_5") return null;
  const base = { ...job.params };
  for (const key of ["provider", "openai", "est_usd", "cost_usd"]) delete base[key];
  // Via Higgsfield, more images than the desktop runner's CLI takes (4) go to Higgsfield's API (as the Playground plans them).
  const images = Array.isArray(base.image_refs) ? base.image_refs.length : 0;
  const higgsfield: ProviderJob = { model: job.model, prompt: job.prompt, params: base, aspect: job.aspect, backend: (images > 4 ? "api" : "auto") as PlannedJob["backend"], costEstimate: jobCost(job.model, base) };
  const out = forProvider(higgsfield, to, screenshots);
  return { params: out.params, backend: out.backend, costEstimate: out.costEstimate, ...(out.costUsd ? { costUsd: out.costUsd } : {}) };
}

// MARK: Jobs from the format library

/** What the format library hands over (the format library calls queueCreativeJob with this). */
export interface CreativeJobInput {
  productId: string;
  formatCardId?: string | null;
  model: string;
  prompt: string;
  params?: Record<string, unknown>;
}

/** Turns one format-card job into a batch request: the model picks the kind; params can add variants, aspects and options. */
export function requestFromJob(input: CreativeJobInput): BatchRequest {
  const p = input.params ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const aspects = (Array.isArray(p.aspects) ? p.aspects : str(p.aspect_ratio) ? [p.aspect_ratio] : []).filter((a): a is Aspect => ASPECTS.includes(a as Aspect));
  const placements = (Array.isArray(p.placements) ? p.placements : str(p.placement) ? [p.placement] : []).filter((id): id is PlacementId => PLACEMENT_IDS.includes(id as PlacementId));
  const model = input.model.replace(/^template:/, "");
  const kind: CreativeKind = model === "marketing_studio_video" ? "ugc_video" : model === "seedance_2_5" ? "ai_video" : model === "reddit" ? "reddit" : model === "tweet" ? "tweet" : "image";
  const copies = Array.isArray(p.copies) ? (p.copies as PostCopy[]).filter((c) => c && typeof c.body === "string") : [];
  return {
    ...DEFAULT_REQUEST,
    formatCardId: input.formatCardId ?? null,
    brief: input.prompt,
    useProfile: false,
    kinds: [kind],
    variants: Number(p.variants) || 1,
    aspects: aspects.length ? aspects : kind === "ugc_video" ? ["9:16"] : ["4:5"],
    placements,
    format: "single",
    video: {
      ...DEFAULT_REQUEST.video,
      ...(VIDEO_MODES.some((m) => m.id === p.mode) ? { mode: p.mode as VideoMode } : {}),
      ...(Number(p.duration) ? { duration: Number(p.duration) } : {}),
      ...(["480p", "720p", "1080p"].includes(String(p.resolution)) ? { resolution: p.resolution as VideoResolution } : {}),
      ...(typeof p.generate_audio === "boolean" ? { generateAudio: p.generate_audio } : {}),
      ...(Array.isArray(p.avatars) && p.avatars[0]?.id ? { avatar: { id: String(p.avatars[0].id), type: p.avatars[0].type === "custom" ? "custom" : "preset" } } : {}),
      ...(str(p.hook_id) ? { hookId: str(p.hook_id) } : {}),
      ...(str(p.setting_id) ? { settingId: str(p.setting_id) } : {}),
      ...(["app_store", "screenshots", "none"].includes(String(p.product)) ? { product: p.product as VideoOptions["product"] } : {}),
    },
    aiVideo: {
      ...DEFAULT_REQUEST.aiVideo!,
      ...(Number(p.duration) ? { duration: Number(p.duration) } : {}),
      ...(["480p", "720p", "1080p"].includes(String(p.resolution)) ? { resolution: p.resolution as VideoResolution } : {}),
      ...(typeof p.generate_audio === "boolean" ? { generateAudio: p.generate_audio } : {}),
    },
    image: {
      ...DEFAULT_REQUEST.image,
      ...(model === "marketing_studio_image" ? { model: "marketing_studio_image" as const } : {}),
      ...(["low", "medium", "high", "xhigh", "max"].includes(String(p.quality)) ? { quality: p.quality as ImageQuality } : {}),
      ...(["1k", "2k", "4k"].includes(String(p.resolution)) ? { resolution: p.resolution as ImageResolution } : {}),
      ...(p.provider === "openai" ? { provider: "openai" as const } : {}),
    },
    ...((kind === "image" || kind === "ai_video") && cleanStyleReferences(p.style_refs).length ? { styleReferences: cleanStyleReferences(p.style_refs) } : {}),
    reddit: kind === "reddit" ? (copies.length ? copies : [{ body: input.prompt }]) : [],
    tweets: kind === "tweet" ? (copies.length ? copies : [{ body: input.prompt }]) : [],
    community: str(p.community),
  };
}

// MARK: QA context

export interface QaContextShape {
  appName: string;
  aliases?: string[];
  blockedNames?: string[];
  competitors: string[];
  policy: PolicyProfile;
  forbiddenClaims: string[];
  description?: string;
  /** The brand system's closed offer list: any other price or offer on a creative fails QA. */
  offers?: { allowed: string[]; notOffered: string[] };
  /** Words the brand never uses (its voice): a creative that uses one gets a warning. */
  avoidWords?: string[];
  // Static generation v2 (docs/STATIC_GEN_V2.md, WS2): supabase/functions/creatives/core/types.ts QaContext.
  /** The exact on-image words asked for (Style Library quotes, template slots, composed copy): the spelling check. */
  intendedText?: string[];
  /** Verified facts: any price, %, rating or count on a creative must be one of these or an offer's wording. */
  facts?: QaFact[];
  /** Say `use`, never `avoid`. */
  substitutions?: QaSubstitution[];
  /** When `when` is said, `phrase` must be too. */
  requiredPhrases?: QaRequiredPhrase[];
  /** Person images used as references, with their consent and possible-minor flags. */
  people?: QaPerson[];
  /** The real logo, for the logo fidelity check. */
  logoUrl?: string;
  /** The batch's placement for safe-zone checks: "stories_reels" whenever it makes 9:16. */
  placement?: string;
}

export interface QaFact { label: string; value: string }
export interface QaSubstitution { avoid: string; use: string; note?: string }
export interface QaRequiredPhrase { when: string; phrase: string }
export type QaConsent = "confirmed" | "unknown" | "not_given";
export interface QaPerson { assetId: string; consent: QaConsent; possibleMinor: boolean }

/** How much of each the QA context keeps. */
export const QA_CONTEXT_LIMITS = { intendedText: 40, intendedChars: 300, facts: 40, wording: 30, people: 12 };

const QA_TEMPLATE_SOURCE: typeof TEMPLATE_SOURCE = "playground-template";
const textOf = (v: unknown, max = 300) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const rec = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);

/** Strings trimmed, without blanks or repeats (case-insensitive), at most `max`. */
function distinct(list: string[], max: number): string[] {
  const seen = new Set<string>();
  return list.filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())).slice(0, max);
}

/**
 * The exact words a request asks to put on the image, for QA's spelling check: a Style Library format's
 * on-image fields as filled in (a custom template's fields are all on-image), a template remake's text
 * slots (those it could read) and a composed ad's copy. Briefs and prompts aren't mined: they mix words
 * to show with rules about words never to show.
 */
export function intendedTextFor(req: Pick<BatchRequest, "playground" | "template" | "kinds" | "image" | "format">): string[] {
  const out: string[] = [];
  const pg = req.playground;
  const fields = rec(pg?.styleFields);
  if (pg && pg.mode !== "video" && pg.styleId && fields) {
    const style = pg.styleId.startsWith("custom:") ? null : adStyleById(pg.styleId);
    const keys = style ? style.fields.filter((f) => f.onImage).map((f) => f.key) : Object.keys(fields);
    for (const key of keys) out.push(textOf(fields[key], QA_CONTEXT_LIMITS.intendedChars));
  }
  for (const slot of req.template?.text ?? []) {
    const example = textOf(slot?.example, QA_CONTEXT_LIMITS.intendedChars);
    if (!/\[illegible\]/i.test(example)) out.push(example);
  }
  const composed = req.kinds?.includes("image") && req.format !== "carousel" && req.image?.composed ? cleanCopy(req.image.composed.copy) : null;
  // Only the words the layout sets: a role it has no slot for isn't on the image.
  const roles = composed ? layoutRoles(layoutById(req.image!.composed!.layout)) : [];
  if (composed) for (const key of roles) out.push(textOf(composed[key], QA_CONTEXT_LIMITS.intendedChars));
  return distinct(out, QA_CONTEXT_LIMITS.intendedText);
}

/**
 * Verified facts from a brand system, read defensively (lib/brand-system.ts gains them in static
 * generation v2): `facts`, every offer with a source (its wording, else its name) and every product
 * price with a source.
 */
export function qaFacts(system: unknown): QaFact[] {
  const sys = rec(system);
  if (!sys) return [];
  const out: QaFact[] = [];
  for (const f of Array.isArray(sys.facts) ? sys.facts : []) {
    const x = rec(f);
    const value = textOf(x?.value, 200);
    if (value) out.push({ label: textOf(x?.label, 120) || "Fact", value });
  }
  for (const o of Array.isArray(sys.offers) ? sys.offers : []) {
    const x = rec(o);
    const value = textOf(x?.wording, 200) || textOf(x?.name, 200);
    if (value && rec(x?.source)) out.push({ label: textOf(x?.name, 120) || "Offer", value });
  }
  for (const p of Array.isArray(sys.products) ? sys.products : []) {
    const x = rec(p);
    const value = textOf(x?.price, 200);
    if (value && rec(x?.priceSource)) out.push({ label: `${textOf(x?.name, 100) || "Product"} price`, value });
  }
  const seen = new Set<string>();
  return out.filter((f) => !seen.has(`${f.label}|${f.value}`.toLowerCase()) && seen.add(`${f.label}|${f.value}`.toLowerCase())).slice(0, QA_CONTEXT_LIMITS.facts);
}

/** The brand's wording rules (brand_system.voice.substitutions and requiredPhrases), read defensively. */
export function qaWording(system: unknown): { substitutions: QaSubstitution[]; requiredPhrases: QaRequiredPhrase[] } {
  const voice = rec(rec(system)?.voice);
  const substitutions = (Array.isArray(voice?.substitutions) ? voice!.substitutions as unknown[] : []).map(rec).map((x) => ({ avoid: textOf(x?.avoid, 120), use: textOf(x?.use, 120), note: textOf(x?.note, 200) }))
    .filter((x) => x.avoid && x.use && x.avoid.toLowerCase() !== x.use.toLowerCase()).map(({ note, ...x }) => (note ? { ...x, note } : x)).slice(0, QA_CONTEXT_LIMITS.wording);
  const requiredPhrases = (Array.isArray(voice?.requiredPhrases) ? voice!.requiredPhrases as unknown[] : []).map(rec).map((x) => ({ when: textOf(x?.when, 120), phrase: textOf(x?.phrase, 200) }))
    .filter((x) => x.when && x.phrase).slice(0, QA_CONTEXT_LIMITS.wording);
  return { substitutions, requiredPhrases };
}

/** The placement QA's safe-zone check reads: Stories and Reels whenever the batch makes it (9:16), else the first. */
export function qaPlacement(req: Pick<BatchRequest, "placements">): string | undefined {
  const ids = (req.placements ?? []).filter((id) => PLACEMENT_IDS.includes(id));
  return ids.find((id) => placementById(id)?.aspect === "9:16") ?? ids[0];
}

/**
 * Person images among a request's references (our own picked images: product_assets rows matched by
 * URL), with their consent and possible-minor flags read defensively (the columns arrive with static
 * generation v2; until then every person is "unknown"). Any image flagged as a possible minor counts.
 */
export function qaPeople(assets: unknown[], urls: string[]): QaPerson[] {
  const wanted = new Set(urls);
  const out: QaPerson[] = [];
  for (const a of assets) {
    const x = rec(a);
    if (!x || typeof x.id !== "string" || typeof x.url !== "string" || !wanted.has(x.url)) continue;
    const minor = x.possible_minor === true;
    if (x.kind !== "person" && !minor) continue;
    const consent: QaConsent = x.consent === "confirmed" || x.consent === "not_given" ? x.consent : "unknown";
    if (!out.some((p) => p.assetId === x.id)) out.push({ assetId: x.id, consent, possibleMinor: minor });
  }
  return out.slice(0, QA_CONTEXT_LIMITS.people);
}

/** Our own images a request sends as references (never a competitor's or a template's original). */
export const ownReferenceUrls = (req: Pick<BatchRequest, "productReferences">) =>
  [...new Set((req.productReferences ?? []).map((r) => r?.url).filter((u): u is string => typeof u === "string" && /^https:\/\/\S+$/i.test(u)))];

/**
 * The real logo for QA's fidelity check: the request's logo (Recreate's pick), else the best logo
 * among the product's images, else the brand kit's app icon (lib/logo-overlay.ts logoCandidates).
 */
export function qaLogoUrl(req: Pick<BatchRequest, "logo">, assets: Parameters<typeof logoCandidates>[0], iconUrl?: string | null): string | undefined {
  return cleanLogo(req.logo)?.url ?? logoCandidates(assets, iconUrl)[0]?.url;
}

/**
 * The static generation v2 part of a batch's QA context, frozen with it (createBatch). A template
 * remake is brand-neutral: only its text slots (intendedText) apply; it has no facts, wording, logo or
 * people. Every other batch freezes `facts`, even empty, so QA fails any number nobody verified.
 */
export function qaV2Context(o: { request: BatchRequest; system?: unknown; assets?: unknown[]; iconUrl?: string | null }): Pick<QaContextShape, "intendedText" | "facts" | "substitutions" | "requiredPhrases" | "people" | "logoUrl" | "placement"> {
  const intendedText = intendedTextFor(o.request);
  const placement = qaPlacement(o.request);
  const base = { ...(intendedText.length ? { intendedText } : {}), ...(placement ? { placement } : {}) };
  if (o.request.source === QA_TEMPLATE_SOURCE) return base;
  const assets = (o.assets ?? []).filter((a): a is Parameters<typeof logoCandidates>[0][number] => Boolean(rec(a)));
  const { substitutions, requiredPhrases } = qaWording(o.system);
  const people = qaPeople(assets, ownReferenceUrls(o.request));
  const logoUrl = qaLogoUrl(o.request, assets, o.iconUrl);
  return {
    ...base,
    facts: qaFacts(o.system),
    ...(substitutions.length ? { substitutions } : {}),
    ...(requiredPhrases.length ? { requiredPhrases } : {}),
    ...(people.length ? { people } : {}),
    ...(logoUrl ? { logoUrl } : {}),
  };
}

/**
 * Names the product must never appear under (a former name, a common misspelling): the "never" side
 * of the brand's own wording rules whose "say" side is the product's name (Brand page → Wording,
 * "Say Acme, never Acme Labs").
 */
function blockedNamesFor(appName: string, substitutions: BrandQa["substitutions"]): string[] {
  const own = appName.trim().toLowerCase();
  const names = (substitutions ?? []).filter((x) => x.use.trim().toLowerCase() === own).map((x) => x.avoid.trim()).filter((name) => name && name.toLowerCase() !== own);
  return names.filter((name, i) => names.findIndex((x) => x.toLowerCase() === name.toLowerCase()) === i);
}

/** Which category rules apply, from what the product is. */
export function policyFor(text: string): PolicyProfile {
  if (/\b(skin|skincare|acne|derma\w*|health|wellness|supplement|nutrition|weight|gut|clinic|medical)\b/i.test(text)) return "health";
  if (/\b(visa|visas|schengen|residen\w*|immigra\w*|citizenship|border|tax|183[- ]day|nomad|days abroad)\b/i.test(text)) return "immigration_tax";
  return "general";
}

/**
 * What QA checks a batch against: the product, its competitors and the brand rules the batch's prompts
 * were built with (`rules`: Plan.qa from lib/brand-rules.ts, so QA checks exactly what the prompts
 * said). Without `rules`, they're worked out from `forbiddenClaims`, `mustAvoid` and `system` the same
 * way. The must-avoid names (a recreated ad's brand, links, handles…) join the competitor names, so Jev
 * flags any of it in a creative's on-screen text.
 */
export function qaContext(o: { appName: string; description?: string; category?: string | null; competitors: string[]; rules?: BrandQa; forbiddenClaims?: string[]; mustAvoid?: string[]; system?: BrandSystem | null }): QaContextShape {
  const rules = o.rules ?? brandRules({ appName: o.appName, forbiddenClaims: o.forbiddenClaims, system: o.system }, { mustAvoid: o.mustAvoid }).qa;
  const key = o.appName.trim().toLowerCase();
  const own = [...new Set(o.competitors.map((c) => c.trim()).filter((c) => c && c.toLowerCase() !== key))].slice(0, 40);
  const extra = cleanMustAvoid(rules.mustAvoid).filter((c) => c.toLowerCase() !== key && !own.some((x) => x.toLowerCase() === c.toLowerCase()));
  const competitors = [...own, ...extra];
  return {
    appName: o.appName.trim(),
    blockedNames: blockedNamesFor(o.appName, rules.substitutions),
    competitors,
    policy: policyFor(`${o.appName} ${o.category ?? ""} ${o.description ?? ""}`),
    forbiddenClaims: rules.forbiddenClaims.map((c) => c.trim()).filter(Boolean),
    ...(o.description ? { description: o.description.slice(0, 400) } : {}),
    ...(rules.offers ? { offers: rules.offers } : {}),
    ...(rules.avoidWords?.length ? { avoidWords: rules.avoidWords } : {}),
  };
}
