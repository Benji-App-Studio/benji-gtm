// Who makes GPT Image 2.5 images: Higgsfield (the default) or OpenAI directly. The model is the same
// either way: Higgsfield's `gpt_image_2_5` (variants Flare and Sunburst) is OpenAI's
// `gpt-image-2.5-flare` / `gpt-image-2.5-sunburst`. Higgsfield is priced in its credits (the Studio's
// one price table, lib/creative-plan.ts jobCost); OpenAI in dollars, estimated here from OpenAI's
// published prices. An OpenAI job carries `provider: "openai"` and the exact request (`openai`: model,
// size, quality, background) in its params, runs on backend "api", and the creatives edge function makes
// it with OpenAI's Images API (supabase/functions/creatives/core/openai_images.ts, the twin of the size
// and price rules below; a Node test keeps them equal). Plain TypeScript with relative imports, safe in
// the browser, on the server and in the Node tests.

export type ImageProvider = "higgsfield" | "openai";
export const IMAGE_PROVIDERS: ImageProvider[] = ["higgsfield", "openai"];
export const DEFAULT_IMAGE_PROVIDER: ImageProvider = "higgsfield";

/** Anything else (missing, misspelt, an older batch) is Higgsfield. */
export const normalizeImageProvider = (value: unknown): ImageProvider => (value === "openai" ? "openai" : DEFAULT_IMAGE_PROVIDER);

export const PROVIDER_NAME: Record<ImageProvider, string> = { higgsfield: "Higgsfield", openai: "OpenAI" };
/** "GPT Image 2.5 · via Higgsfield" / "GPT Image 2.5 · via OpenAI". */
export const gptImageLabel = (provider: ImageProvider) => `GPT Image 2.5 · via ${PROVIDER_NAME[provider]}`;
export const otherProvider = (provider: ImageProvider): ImageProvider => (provider === "openai" ? "higgsfield" : "openai");
/** The button on a failed image: switching is always the person's click, never automatic. */
export const tryOtherLabel = (provider: ImageProvider) => `Try with ${PROVIDER_NAME[otherProvider(provider)]} instead`;

/** OpenAI's ids for Higgsfield's two GPT Image 2.5 variants. */
export const OPENAI_IMAGE_MODELS = { flare: "gpt-image-2.5-flare", sunburst: "gpt-image-2.5-sunburst" } as const;
export const openAiModelFor = (variant: unknown) => OPENAI_IMAGE_MODELS[variant === "sunburst" ? "sunburst" : "flare"];

// MARK: OpenAI's prices

/**
 * OpenAI's published prices for GPT Image 2.5 (both models), the one table every OpenAI estimate uses.
 * Tokens: $5 / 1M text input, $8 / 1M image input, $30 / 1M image output
 * (developers.openai.com/api/docs/pricing). Output tokens per image: OpenAI's own calculator in the
 * image generation guide (developers.openai.com/api/docs/guides/image-generation, "GPT Image 2.5 and
 * GPT Image 2 output tokens"): a base per quality for the long edge, scaled by the shape and the pixel
 * count (openAiOutputTokens). OpenAI publishes no input-token figure for GPT Image 2.5's reference
 * images, so each one is estimated at 6,500 image tokens (the closest published rule: gpt-image-1 at
 * high input fidelity, 4,160 to 6,240 extra tokens plus its tiles). The worker records the real cost
 * from the tokens OpenAI reports (params.cost_usd).
 */
export const OPENAI_IMAGE_PRICING = {
  checked: "2026-10-05",
  sources: ["https://developers.openai.com/api/docs/pricing", "https://developers.openai.com/api/docs/guides/image-generation"],
  usdPerMillion: { textInput: 5, imageInput: 8, imageOutput: 30 },
  outputBaseTokens: { low: 16, medium: 24, high: 48, xhigh: 64, max: 96 },
  referenceImageTokens: 6500,
} as const;

type Quality = keyof typeof OPENAI_IMAGE_PRICING.outputBaseTokens;
export const OPENAI_QUALITIES = Object.keys(OPENAI_IMAGE_PRICING.outputBaseTokens) as Quality[];

/** Image output tokens for one image, as OpenAI's calculator works them out. */
export function openAiOutputTokens(width: number, height: number, quality: string): number {
  const base = OPENAI_IMAGE_PRICING.outputBaseTokens[quality as Quality] ?? OPENAI_IMAGE_PRICING.outputBaseTokens.medium;
  const long = Math.max(width, height), short = Math.min(width, height);
  const s = base / (long / short);
  const floor = Math.floor(s);
  const other = s - floor === 0.5 ? floor + (floor % 2) : Math.round(s);
  return Math.ceil((base * other * (2e6 + width * height)) / 4e6);
}

const RESOLUTION_PIXELS: Record<string, number> = { "1k": 1024 * 1024, "2k": 2048 * 2048, "4k": 8_294_400 };
const LIMITS = { step: 16, minPixels: 655_360, maxPixels: 8_294_400, maxEdge: 3840, maxRatio: 3 };
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * The size OpenAI is asked for: the aspect's exact ratio, both edges multiples of 16, as many pixels as
 * Higgsfield's resolution means (1k ≈ 1024², 2k ≈ 2048², 4k = OpenAI's 4K ceiling) and never more,
 * inside OpenAI's limits. 4:5 is made as 4:5.
 */
export function openAiSize(aspect: string, resolution: string): { width: number; height: number; size: string } {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(aspect);
  let w = m ? Number(m[1]) : 1, h = m ? Number(m[2]) : 1;
  if (!w || !h || Math.max(w, h) / Math.min(w, h) > LIMITS.maxRatio) { w = 1; h = 1; }
  const g = gcd(w, h);
  w /= g; h /= g;
  const unitW = LIMITS.step * w, unitH = LIMITS.step * h;
  const budget = Math.min(RESOLUTION_PIXELS[resolution] ?? RESOLUTION_PIXELS["2k"], LIMITS.maxPixels);
  let k = Math.floor(Math.sqrt(budget / (unitW * unitH)));
  while (k > 1 && Math.max(unitW, unitH) * k > LIMITS.maxEdge) k--;
  while (unitW * unitH * k * k < LIMITS.minPixels) k++;
  const width = unitW * k, height = unitH * k;
  return { width, height, size: `${width}x${height}` };
}

/** One image's estimated OpenAI cost in USD: its output, the reference images sent and the prompt (≈4 characters a token). */
export function openAiImageUsd(o: { aspect: string; resolution: string; quality: string; references?: number; promptChars?: number }): number {
  const { width, height } = openAiSize(o.aspect, o.resolution);
  const p = OPENAI_IMAGE_PRICING.usdPerMillion;
  const usd = (openAiOutputTokens(width, height, o.quality) * p.imageOutput
    + Math.max(0, o.references ?? 0) * OPENAI_IMAGE_PRICING.referenceImageTokens * p.imageInput
    + Math.ceil(Math.max(0, o.promptChars ?? 0) / 4) * p.textInput) / 1e6;
  return Math.round(usd * 10_000) / 10_000;
}

/** "$0.05", "$0.006", "$1.20" ("US$0.05" in Chinese and Korean when given the translator's `intl`). */
export function fmtUsd(usd: number, intl = "en-US"): string {
  const money = (n: number, decimals: number) => new Intl.NumberFormat(intl, { style: "currency", currency: "USD", minimumFractionDigits: Math.min(2, decimals), maximumFractionDigits: decimals }).format(n);
  if (!Number.isFinite(usd) || usd <= 0) return money(0, 0);
  return money(usd, usd >= 0.1 ? 2 : usd >= 0.01 ? 3 : 4);
}

const fmtCredits = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(2));

/** The cost as each provider charges it: "~1 credit" (Higgsfield) or "~$0.05" (OpenAI). */
export function costLabel(provider: ImageProvider, cost: { credits?: number; usd?: number }): string {
  if (provider === "openai") return `~${fmtUsd(cost.usd ?? 0)}`;
  const credits = cost.credits ?? 0;
  return `~${fmtCredits(credits)} credit${credits === 1 ? "" : "s"}`;
}

/** A plan's cost in one line: credits, dollars, or both when a batch has some of each. */
export function planCostLabel(plan: { credits: number; usd?: number }): string {
  const parts = [plan.credits > 0 || !plan.usd ? costLabel("higgsfield", { credits: plan.credits }) : "", plan.usd ? `${costLabel("openai", { usd: plan.usd })} at OpenAI` : ""].filter(Boolean);
  return parts.join(" + ");
}

// MARK: What the Supabase plan does with each OpenAI quality

/** How one OpenAI image is made on this install: in one run, handed over and collected later, or not at all. */
export type OpenAiImageMode = "wait" | "collect" | "refuse";

/**
 * The creatives backend's `health.openaiImagePlan` (supabase/functions/creatives/core/openai_jobs.ts
 * imagePlan): for each resolution and quality, the expected seconds and how the job is run on this
 * install's Supabase plan. An older backend doesn't send it; then nothing is known and nothing is said.
 */
export interface OpenAiImagePlan {
  /** The plan's time limit for one run of a function, in seconds. */
  wallClockSec: number | null;
  qualities: Record<string, Record<string, { seconds: number | null; mode: OpenAiImageMode }>>;
}

const MODES: OpenAiImageMode[] = ["wait", "collect", "refuse"];
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const seconds = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

/** Reads the health answer's plan leniently: unknown shapes and values are dropped; null when there is nothing usable. */
export function readOpenAiImagePlan(raw: unknown, wallClockSec?: unknown): OpenAiImagePlan | null {
  if (!isRecord(raw) || !isRecord(raw.qualities)) return null;
  const qualities: OpenAiImagePlan["qualities"] = {};
  for (const [resolution, byQuality] of Object.entries(raw.qualities)) {
    if (!isRecord(byQuality)) continue;
    for (const [quality, entry] of Object.entries(byQuality)) {
      if (!isRecord(entry) || !MODES.includes(entry.mode as OpenAiImageMode)) continue;
      (qualities[resolution] ??= {})[quality] = { seconds: seconds(entry.seconds), mode: entry.mode as OpenAiImageMode };
    }
  }
  if (!Object.keys(qualities).length) return null;
  return { wallClockSec: seconds(raw.wallClockSec) ?? seconds(wallClockSec), qualities };
}

/** How a quality at a resolution is made on this install, or null when the backend didn't say. */
export const openAiImageMode = (plan: OpenAiImagePlan | null | undefined, resolution: string, quality: string): OpenAiImageMode | null =>
  plan?.qualities[resolution]?.[quality]?.mode ?? null;

const QUALITY_NAME: Record<string, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };

/**
 * The short note for a quality that isn't made in one run: collected later ("takes longer, finishes in
 * the background") or refused on this plan. null for one that is, and when nothing is known.
 */
export function openAiQualityNote(plan: OpenAiImagePlan | null | undefined, resolution: string, quality: string): { mode: "collect" | "refuse"; text: string } | null {
  const mode = openAiImageMode(plan, resolution, quality);
  if (mode !== "collect" && mode !== "refuse") return null;
  const what = `${QUALITY_NAME[quality] ?? quality} quality at ${resolution.toUpperCase()}`;
  return mode === "collect"
    ? { mode, text: `${what} takes longer, finishes in the background: the image arrives a minute or more after the others.` }
    : { mode, text: `${what} can't run on this Supabase plan: it takes longer than one run is allowed. Pick a lower quality or resolution, or upgrade the Supabase plan.` };
}

// MARK: Jobs

const https = (list: unknown) => (Array.isArray(list) ? list : []).filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u));

/** How many reference images a job sends (as the creatives function's referenceUrls picks them, up to 16). */
export function referenceCount(params: Record<string, unknown>, screenshots = 0): number {
  const exact = https(params.image_refs);
  if (exact.length) return Math.min(16, exact.length);
  const logo = https([params.logo_ref]).length;
  const style = Math.min(https(params.style_refs).length, logo ? 3 : 4);
  const ours = Math.min(https(params.product_refs).length, 3);
  return Math.min(16, style + logo + ours + (params.use_screenshots ? Math.max(0, screenshots) : 0));
}

/** What a planned image job is turned into for a provider (the planner's PlannedJob fields it touches). */
export interface ProviderJob { model: string; prompt: string; params: Record<string, unknown>; aspect: string; backend: "auto" | "local" | "api" | "template"; costEstimate: number; costUsd?: number }

/**
 * A GPT Image 2.5 job for its provider. Higgsfield: as planned. OpenAI: `provider` and the exact
 * request in params, backend "api" (the desktop runner never takes it), no credits, the dollar estimate.
 * Other models (Marketing Studio Image) are Higgsfield's alone and stay as they are.
 */
export function forProvider<T extends ProviderJob>(job: T, provider: ImageProvider, screenshots = 0): T {
  if (provider !== "openai" || job.model !== "gpt_image_2_5") return job;
  const aspect = typeof job.params.aspect_ratio === "string" ? job.params.aspect_ratio : job.aspect;
  const resolution = String(job.params.resolution ?? "2k");
  const quality = OPENAI_QUALITIES.includes(job.params.quality as Quality) ? String(job.params.quality) : "medium";
  const { size } = openAiSize(aspect, resolution);
  const costUsd = openAiImageUsd({ aspect, resolution, quality, references: referenceCount(job.params, screenshots), promptChars: job.prompt.length });
  return {
    ...job,
    params: { ...job.params, provider: "openai", openai: { model: openAiModelFor(job.params.variant), size, quality, background: "opaque" }, est_usd: costUsd },
    backend: "api",
    costEstimate: 0,
    costUsd,
  };
}

/** The provider a saved job ran on (its params), Higgsfield when it doesn't say. */
export const providerOfJob = (params: Record<string, unknown> | null | undefined): ImageProvider => normalizeImageProvider(params?.provider);
