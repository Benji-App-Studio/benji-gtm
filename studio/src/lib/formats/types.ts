// The format library: every winning post or paid ad the research finds becomes a card describing its
// format (hook pattern, beat structure, pacing, CTA and the evidence that it works), and each card
// turns into ready-to-run Higgsfield inputs for one of our own apps. Cards copy the FORMAT, never
// the asset: prompts are rebuilt from our product's own angles and never reuse a competitor's lines,
// footage, name or likeness.
//
// Everything in lib/formats is plain TypeScript with relative imports (no Next.js, no network), so
// the server, the browser and the Node tests (scripts/creative-runner/tests/formats.test.ts) share it.
import type { Platform } from "../types";

export type Source = "organic" | "paid";
/** Paid ads come from ad libraries rather than a channel's feed. */
export type AdPlatform = "meta_ads" | "tiktok_ads";
export type CardPlatform = Platform | AdPlatform;
export type Medium = "video" | "text" | "image";

export const CARD_PLATFORM_LABEL: Record<CardPlatform, string> = {
  instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube Shorts", x: "X", linkedin: "LinkedIn",
  meta_ads: "Meta ads", tiktok_ads: "TikTok ads",
};

/** One line of a decoded script (the shape reports already store). */
export interface Line { text: string; start?: number | null; role: string | null; visual?: string | null }

/**
 * A paid ad, as the research agent (Meta Ad Library, TikTok Creative Center) hands it over. Only
 * `id`, `platform`, `url`, `advertiser` and `body` are required; the more it carries (a decoded
 * transcript, format and hook from Jev), the richer its card.
 */
export interface PaidAd {
  id: string;
  platform: AdPlatform;
  url: string;
  advertiser: string;
  medium: "video" | "image" | "carousel";
  body: string;
  headline?: string | null;
  cta?: string | null;
  thumb?: string | null;
  startedAt?: string | null;
  lastSeenAt?: string | null;
  /** Days the ad has been running: advertisers keep paying for what converts, so long runs are the signal. */
  daysRunning?: number | null;
  /** How many variations of the same creative the advertiser runs (more = they're scaling it). */
  variants?: number | null;
  durationSec?: number | null;
  /** Jev's decode of the ad's script, in the same shape as organic posts. */
  transcript?: Line[] | null;
  format?: string | null;
  formatName?: string | null;
  hookType?: string | null;
  /** Any reach or impressions figure the library exposes (EU ads only, for Meta). */
  reach?: number | null;
  /** The research agent's own 0–100 strength score, when it has one. */
  score?: number | null;
  /** Someone chose it for the library ("Send to format library"): it's a winner whatever its numbers. */
  curated?: boolean;
}

/**
 * What Research → Ads hands over when someone presses "Send to format library": `paid_ads.library_seed`
 * (the research engine, engine/adlibrary.ts FormatSeed). Mirrored here because the studio can't import
 * edge code; keep the two in step.
 */
export interface FormatSeed {
  kind: "paid_ad";
  adId: string;
  network: "meta" | "tiktok";
  competitor: string;
  format: string | null;
  hookType: string | null;
  hook: string | null;
  structure: { role: string; text: string; visual?: string }[];
  mediaType: "video" | "image" | "carousel" | "dco" | "text" | "unknown";
  daysRunning: number | null;
  variants: number;
  placements: string[];
  cta: string;
  snapshotUrl: string | null;
  thumb: string | null;
}

/** The paid_ads columns the library reads (rows with sent_to_library_at set). */
export interface PaidAdSeedRow {
  id: string;
  network: "meta" | "tiktok";
  ad_id: string;
  page_name: string;
  competitor: string | null;
  body: string;
  headline: string;
  cta: string;
  thumb: string | null;
  snapshot_url: string | null;
  media_type: FormatSeed["mediaType"];
  started_at: string | null;
  stopped_at: string | null;
  last_seen_at: string | null;
  variants: number;
  library_seed: FormatSeed | null;
}

/** A winning post or ad, normalised so organic and paid winners cluster together. */
export interface Winner {
  id: string;
  source: Source;
  /** A paid ad someone hand-picked (sent to the library from Research): it gets a card of its own. */
  curated?: boolean;
  platform: CardPlatform;
  medium: Medium;
  url: string;
  account: string;
  thumb: string | null;
  postedAt: string | null;
  formatId: string;
  formatName: string;
  formatDescription: string;
  hookType: string | null;
  hookLine: string;
  script: Line[];
  caption: string;
  hashtags: string[];
  durationSec: number | null;
  views: number | null;
  score: number;
  outlier: number | null;
  buyerIntent: number | null;
  daysRunning: number | null;
  hasCta: boolean;
  reasons: string[];
  runId: string | null;
}

/** A beat of the format: what job it does, how much of the runtime it takes and what's on screen. */
export interface Beat { role: string; share: number; visual: string | null }

export interface FormatExample {
  id: string;
  source: Source;
  platform: CardPlatform;
  url: string;
  account: string;
  thumb: string | null;
  /** Their opening line, verbatim: reference only, never reused in a prompt. */
  hook: string;
  views: number | null;
  score: number;
  outlier: number | null;
  buyerIntent: number | null;
  daysRunning: number | null;
  postedAt: string | null;
  runId: string | null;
}

/** The library's families: the research engine's format LIBRARY (engine/formats.ts), which picks the Higgsfield route. */
export type FamilyId =
  | "storytime" | "how_to_steps" | "proof_then_method" | "listicle" | "myth_vs_reality" | "news_update" | "explainer"
  | "expert_answers" | "hack_or_secret" | "comparison" | "pov_skit" | "day_in_life" | "reaction" | "silent_text"
  | "product_demo" | "ugc_testimonial" | "challenge_or_test" | "behind_the_scenes" | "motivational"
  // Paid-ad formats (the research engine's AD_FORMATS).
  | "hook_demo" | "static_benefit" | "reddit_style" | "tweet_style" | "ai_ugc" | "before_after" | "us_vs_them"
  | "quiz_funnel" | "testimonial_review" | "green_screen" | "founder_story";

export interface Evidence {
  examples: number;
  medianViews: number | null;
  bestViews: number | null;
  medianScore: number;
  bestScore: number;
  maxOutlier: number | null;
  buyerIntent: number | null;
  daysRunning: number | null;
  reasons: string[];
}

export interface FormatCard {
  /** Stable cluster key (source, medium, format, hook type): one card per key per workspace. */
  key: string;
  source: Source;
  medium: Medium;
  platform: CardPlatform;
  platforms: CardPlatform[];
  formatType: string;
  formatName: string;
  formatDescription: string;
  family: FamilyId;
  hookType: string | null;
  /** The best example's opening, verbatim, for reference only (never in a prompt). */
  hookLine: string;
  /** The hook as a reusable pattern, in our words. */
  hookPattern: string;
  /** Role sequence, e.g. hook → setup → method → cta. */
  structure: string[];
  /** "winners": read from the best example's script; "format": the format's usual order (the winners' scripts don't show one). */
  structureSource: "winners" | "format";
  beats: Beat[];
  lengthSec: number | null;
  lengthBucket: string | null;
  /** Text posts: typical length in words. */
  words: number | null;
  /** Share of examples that ask for an action. */
  ctaShare: number;
  /** Words that describe what the winners are about (hashtags and frequent words), for picking our angle. */
  topics: string[];
  evidence: Evidence;
  why: string[];
  examples: FormatExample[];
  rank: number;
}

/** A card as the API returns it: stored (with an id Measure and Launch reference) or computed on the fly. */
export interface FormatCardRow extends FormatCard {
  id: string;
  productId: string;
  persisted: boolean;
  updatedAt: string | null;
}

/** The workspace's brand kit (the shared contract in lib/workspace.ts). */
export interface BrandKit {
  appName: string;
  tagline?: string;
  iconUrl?: string;
  colors: string[];
  screenshotUrls: string[];
  tone?: string;
  forbiddenClaims?: string[];
  appStoreUrl?: string;
}

/** Everything the generator knows about our app. */
export interface AppContext {
  productId: string;
  name: string;
  brandKit: BrandKit;
  description: string;
  audience: string | null;
  keywords: string[];
  /** Names and handles the prompts must never mention. */
  competitorNames: string[];
  /** The AI product profile (Product page): the angles, claims to avoid and tone. */
  profile?: import("../product-insight").ProductProfile | null;
}

/**
 * One way to sell our app: the problem it solves for one audience, in the pieces the templates
 * slot into each beat. A product with an AI profile has one per customer group; any other gets one
 * derived from its description.
 */
export interface Angle {
  id: string;
  label: string;
  keywords: string[];
  audience: string;
  topic: string;
  pain: string;
  stakes: string;
  outcome: string;
  feature: string;
  /** The one useful insight (how the rule or the problem actually works). Must be true. */
  mechanism: string;
  steps: [string, string, string];
  benefit: string;
  proof: string;
  /** What the screen recording shows. */
  demoShot: string;
  broll: string;
  question: string;
  claim: string;
  story: string;
  pov: string;
  mistake: string;
  myth: string;
  setup: string;
  cta: string;
}

export type HiggsfieldModel = "marketing_studio_video" | "seedance_2_5" | "gpt_image_2_5";

export interface RecipeBeat {
  role: string;
  from: number | null;
  to: number | null;
  /** What's said (voice-over or to camera), or the copy for a still. */
  line: string;
  onScreen: string;
  shot: string;
  /** What's on screen, in the decoder's terms (talking_head, screen_demo, …). */
  visual: string;
}

/** Ready-to-run Higgsfield inputs for one card, rewritten for our app. */
export interface Recipe {
  cardKey: string;
  model: HiggsfieldModel;
  modelLabel: string;
  mode: string | null;
  why: string;
  aspectRatio: string;
  duration: number | null;
  resolution: string;
  angle: { id: string; label: string };
  prompt: string;
  beats: RecipeBeat[];
  onScreenText: string[];
  caption: string;
  /** Text posts (X, LinkedIn): the post itself, rewritten for our app. */
  postCopy: string | null;
  /** Everything `higgsfield generate create` takes besides the prompt. */
  /** `style_refs`: a paid image ad's own picture, sent to Higgsfield as the layout and style reference. */
  params: Record<string, string | number | boolean | string[]>;
  cli: string;
  costCli: string;
  /** Optional one-time setup (e.g. importing the App Store page as a Marketing Studio web product). */
  setup: string[];
  estCredits: number | null;
  notes: string[];
  /** Automatic checks: competitor names, their lines, ruled-out claims (each issue starts with its POLICY.md rule id). */
  checks: { ok: boolean; issues: string[] };
  /** POLICY.md rules a person must confirm before this runs (e.g. PR-3: the review quotes are real and on file). */
  needsHuman: string[];
}

export const POLICY_NOTE =
  "Copy the format, never the asset. Their footage, script, voice and likeness stay theirs: reusing them invites copyright and IP reports, and Meta acts on those by rejecting ads and can restrict the ad account. These prompts keep only the structure, hook pattern and pacing, rewritten for your app, with an original presenter who never poses as a customer or an expert.";
