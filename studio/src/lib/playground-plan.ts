// Playground → the creative pipeline. A PlaygroundRequest (lib/playground.ts) becomes one batch tagged
// settings.source = "playground", planned with its own tight prompt instead of the Studio's (no profile,
// placements or avatar copy: the reference decides the look, the person's words decide the change).
// Image mode makes GPT Image 2.5 jobs; video mode makes Seedance 2.5 `ai_video` jobs (the Studio's AI
// video model and price table), with the prompt as written unless "Use my brand" is on. The brand's rules (banned words, offers, forbidden claims, must-avoid) come from
// lib/brand-rules.ts like every other prompt, and QA checks the same rules (Plan.qa). Plain TypeScript,
// safe in the browser (live estimate) and on the server.
import { brandRules, ruleLines, type BrandRules } from "./brand-rules";
import { fill, m, type Vars } from "./i18n/translate";

/** Words a plan's notes in the reader's language (a route's `t`); English by default. */
type Words = (text: string, vars?: Vars) => string;
const englishWords: Words = (text, vars) => fill(text, vars);
import { lookBlock, type BrandSystem } from "./brand-system";
import { ANGLES, ASPECTS, cleanMustAvoid, DEFAULT_REQUEST, jobCost, totals, videoAspect, type BatchRequest, type ImageQuality, type ImageResolution, type Plan, type PlannedJob } from "./creative-plan";
import { cleanReviewIds } from "./reviews";
import { publicInstall } from "./install/public";
import { DEFAULT_IMAGE_PROVIDER, forProvider, normalizeImageProvider, type ImageProvider, type OpenAiImagePlan } from "./image-provider";
import { DEFAULT_PLAYGROUND_VIDEO, PLAYGROUND_MAX_INPUTS, PLAYGROUND_SOURCE, PLAYGROUND_VIDEO, type PlaygroundRequest, type PlaygroundVideo } from "./playground";

export type PlaygroundVariant = "flare" | "sunburst";

/**
 * GPT Image 2.5's knobs (Marketing Studio image 2.5 on Higgsfield's API) and who makes it: Higgsfield
 * (default) or OpenAI, the same model (lib/image-provider.ts). Video mode is Seedance, Higgsfield's alone.
 */
export interface PlaygroundOptions { quality: ImageQuality; resolution: ImageResolution; variant: PlaygroundVariant; provider: ImageProvider }

/** What a playground batch keeps in creative_batches.settings.playground, so it can be reopened. */
export interface PlaygroundSettings extends PlaygroundRequest { options: PlaygroundOptions }

export const PLAYGROUND_MODEL = "gpt_image_2_5";
/** Video mode's model: Seedance 2.5 (the Higgsfield API's text- or reference-to-video, or the desktop runner's CLI). */
export const PLAYGROUND_VIDEO_MODEL = "seedance_2_5";
export const PLAYGROUND_VIDEO_RESOLUTIONS: PlaygroundVideo["resolution"][] = ["720p", "1080p"];
export const PLAYGROUND_ASPECTS = ["1:1", "4:5", "9:16", "16:9"] as const;
export const PLAYGROUND_QUALITIES: ImageQuality[] = ["low", "medium", "high", "xhigh", "max"];
export const PLAYGROUND_RESOLUTIONS: ImageResolution[] = ["1k", "2k", "4k"];
export const PLAYGROUND_PROMPT = { min: 3, max: 2000 };
/** The desktop runner's CLI takes at most this many images; a job with more runs on Higgsfield's API (up to 16). */
export const RUNNER_MAX_IMAGES = 4;

export const DEFAULT_PLAYGROUND_OPTIONS: PlaygroundOptions = { quality: "medium", resolution: "2k", variant: "flare", provider: DEFAULT_IMAGE_PROVIDER };
export const EMPTY_PLAYGROUND_REQUEST: PlaygroundRequest = { mode: "image", prompt: "", referenceUrl: null, inputUrls: [], aspect: "4:5", count: 1, styleId: null, styleFields: null, mustAvoid: [], video: null };

export const isHttpsUrl = (u: unknown): u is string => typeof u === "string" && /^https:\/\/\S+$/i.test(u) && u.length <= 2000;

/** The public bucket the setup wizard copies this app's own images into (the Style Library's examples). */
export const APP_ASSETS_BUCKET = "app-assets";
/**
 * Where the Style Library's example images can be fetched from the internet. They are this app's own
 * files (public/ad-styles/), referenced as site-relative paths; Higgsfield needs a public https link.
 * A deployed copy serves them itself (its public origin). A copy run on someone's own machine can't
 * (Higgsfield can't reach localhost), so setup copies them into the project's public `app-assets`
 * bucket and they are linked from there. "" before setup.
 */
export function styleAssetBase(): string {
  const install = publicInstall();
  if (!install) return "";
  return install.origin ?? `${install.url}/storage/v1/object/public/${APP_ASSETS_BUCKET}`;
}
/** The only site-relative images allowed: the Style Library's files. */
const STYLE_ASSET = /^\/ad-styles\/[A-Za-z0-9._-]+$/;
/** An image link the form may hold: public https, or a Style Library file (resolved by resolveStyleAssets). */
export const isPlaygroundImage = (u: unknown): u is string => isHttpsUrl(u) || (typeof u === "string" && STYLE_ASSET.test(u) && !u.includes(".."));
const resolveOne = (u: unknown) => (typeof u === "string" && STYLE_ASSET.test(u) && !u.includes("..") ? `${styleAssetBase()}${u}` : u);

/** A raw request with any Style Library path (/ad-styles/…) turned into a public https link; run before validating. */
export function resolveStyleAssets<T>(input: T): T {
  if (!input || typeof input !== "object") return input;
  const r = input as Record<string, unknown>;
  return { ...r, referenceUrl: resolveOne(r.referenceUrl), ...(Array.isArray(r.inputUrls) ? { inputUrls: r.inputUrls.map(resolveOne) } : {}) } as T;
}

/**
 * A request from anywhere (the browser, the Style Library, a saved batch) made safe. Throws nothing; drops
 * what's invalid. Keeps Style Library paths (/ad-styles/…) as they are, so the form can show them; the API
 * resolves them to public links (resolveStyleAssets) before it validates.
 */
export function normalizePlaygroundRequest(input: Partial<PlaygroundRequest> | null | undefined): PlaygroundRequest {
  const r = input ?? {};
  const video = r.mode === "video";
  const count = Math.round(Number(r.count));
  const fields = r.styleFields && typeof r.styleFields === "object" && !Array.isArray(r.styleFields)
    ? Object.fromEntries(Object.entries(r.styleFields).filter(([k, v]) => typeof v === "string" && k.length <= 60).slice(0, 30).map(([k, v]) => [k, String(v).slice(0, 500)]))
    : null;
  const inputUrls = [...new Set((Array.isArray(r.inputUrls) ? r.inputUrls : []).filter(isPlaygroundImage))].slice(0, PLAYGROUND_MAX_INPUTS);
  return {
    mode: video ? "video" : "image",
    prompt: typeof r.prompt === "string" ? r.prompt.slice(0, PLAYGROUND_PROMPT.max) : "",
    // A video has no style reference: its images are all in inputUrls (one may be the start frame).
    referenceUrl: !video && isPlaygroundImage(r.referenceUrl) ? r.referenceUrl : null,
    inputUrls,
    aspect: (PLAYGROUND_ASPECTS as readonly string[]).includes(r.aspect as string) ? r.aspect! : video ? "9:16" : "4:5",
    count: (count >= 1 && count <= (video ? PLAYGROUND_VIDEO.maxCount : 4) ? count : 1) as PlaygroundRequest["count"],
    styleId: !video && typeof r.styleId === "string" && r.styleId ? r.styleId.slice(0, 120) : null,
    styleFields: !video && fields && Object.keys(fields).length ? fields : null,
    mustAvoid: cleanMustAvoid(r.mustAvoid),
    video: video ? normalizePlaygroundVideo(r.video, inputUrls) : null,
    ...(!video && cleanReviewIds(r.reviewIds).length ? { reviewIds: cleanReviewIds(r.reviewIds) } : {}),
  };
}

/** Video mode's settings made safe: a whole number of seconds in range, a known resolution, a start frame only if it's one of the images. */
export function normalizePlaygroundVideo(input: Partial<PlaygroundVideo> | null | undefined, inputUrls: string[] = []): PlaygroundVideo {
  const v = input ?? {};
  const duration = Math.round(Number(v.duration));
  return {
    duration: Number.isFinite(duration) && duration > 0 ? Math.min(PLAYGROUND_VIDEO.maxDuration, Math.max(PLAYGROUND_VIDEO.minDuration, duration)) : DEFAULT_PLAYGROUND_VIDEO.duration,
    resolution: PLAYGROUND_VIDEO_RESOLUTIONS.includes(v.resolution as PlaygroundVideo["resolution"]) ? v.resolution! : DEFAULT_PLAYGROUND_VIDEO.resolution,
    audio: typeof v.audio === "boolean" ? v.audio : DEFAULT_PLAYGROUND_VIDEO.audio,
    startFrame: typeof v.startFrame === "string" && inputUrls.includes(v.startFrame) ? v.startFrame : null,
    useBrand: v.useBrand === true,
  };
}

export function normalizePlaygroundOptions(input: Partial<PlaygroundOptions> | null | undefined): PlaygroundOptions {
  const o = input ?? {};
  return {
    quality: PLAYGROUND_QUALITIES.includes(o.quality as ImageQuality) ? o.quality! : DEFAULT_PLAYGROUND_OPTIONS.quality,
    resolution: PLAYGROUND_RESOLUTIONS.includes(o.resolution as ImageResolution) ? o.resolution! : DEFAULT_PLAYGROUND_OPTIONS.resolution,
    variant: o.variant === "sunburst" ? "sunburst" : "flare",
    provider: normalizeImageProvider(o.provider),
  };
}

/**
 * The server's check of what the browser sent (after resolveStyleAssets), before anything is planned: https links only, at most
 * PLAYGROUND_MAX_INPUTS of the person's images, a prompt of a sensible length. Null when it's fine.
 */
export function playgroundRequestProblem(input: unknown): string | null {
  const r = (input ?? {}) as Record<string, unknown>;
  if (typeof r.prompt !== "string" || r.prompt.trim().length < PLAYGROUND_PROMPT.min) return m("Say what to make or change.");
  if (r.prompt.length > PLAYGROUND_PROMPT.max) return `Keep the prompt under ${PLAYGROUND_PROMPT.max} characters.`;
  if (r.referenceUrl != null && !isHttpsUrl(r.referenceUrl)) return m("The reference image has to be a public https link.");
  if (r.inputUrls != null && !Array.isArray(r.inputUrls)) return m("Your images have to be a list of links.");
  const inputs = (r.inputUrls as unknown[] | undefined) ?? [];
  if (inputs.length > PLAYGROUND_MAX_INPUTS) return `Add at most ${PLAYGROUND_MAX_INPUTS} of your own images.`;
  if (inputs.some((u) => !isHttpsUrl(u))) return m("Each of your images has to be a public https link.");
  if (!(PLAYGROUND_ASPECTS as readonly unknown[]).includes(r.aspect)) return m("Pick 1:1, 4:5, 9:16 or 16:9.");
  if (r.mode != null && r.mode !== "image" && r.mode !== "video") return m("Pick image or video.");
  if (r.mode === "video") {
    if (![1, 2].includes(Number(r.count))) return m("Make 1 or 2 versions of a video.");
    const v = (r.video ?? {}) as Record<string, unknown>;
    const duration = Number(v.duration ?? DEFAULT_PLAYGROUND_VIDEO.duration);
    if (!Number.isInteger(duration) || duration < PLAYGROUND_VIDEO.minDuration || duration > PLAYGROUND_VIDEO.maxDuration) return `A video lasts ${PLAYGROUND_VIDEO.minDuration} to ${PLAYGROUND_VIDEO.maxDuration} seconds.`;
    if (v.resolution != null && !(PLAYGROUND_VIDEO_RESOLUTIONS as unknown[]).includes(v.resolution)) return m("Pick 720p or 1080p.");
    if (v.startFrame != null && !inputs.includes(v.startFrame)) return m("The start frame has to be one of your images.");
    return null;
  }
  if (![1, 2, 3, 4].includes(Number(r.count))) return m("Make 1 to 4 versions.");
  return null;
}

const sentence = (text: string) => text.trim().replace(/\s+$/, "").replace(/[.;:,\s]+$/, "");
const imageRange = (first: number, n: number) => (n === 1 ? `image ${first}` : `images ${first}–${first + n - 1}`);

/** The brand fields the Playground reads (lib/brand.ts MergedBrand: the kit and the system). */
export interface PlaygroundBrand { appName: string; tagline?: string | null; forbiddenClaims?: string[] | null; system?: BrandSystem | null }

/** The brand rules of a playground request (lib/brand-rules.ts): no profile; the system when the product has one. */
export const playgroundRules = (req: Pick<PlaygroundRequest, "mustAvoid" | "prompt">, brand: PlaygroundBrand): BrandRules =>
  brandRules(brand, { brief: req.prompt, mustAvoid: req.mustAvoid, useProfile: false });

/**
 * What makes version `variant` of `total` differ. Without a reference, the Studio's angles (ANGLES);
 * with a reference or a Style Library format the design and words are set, so only the photo varies.
 */
export function playgroundVersionLine(req: Pick<PlaygroundRequest, "referenceUrl" | "styleId">, variant: number, total: number): string {
  if (total <= 1) return "";
  if (req.referenceUrl || req.styleId) return `Version ${variant} of ${total}: keep the design and the words as asked; vary the photo itself (pose, framing, setting details, light) so it differs from the other versions.`;
  return `Variant ${variant} of ${total}: ${ANGLES[(variant - 1) % ANGLES.length]}`;
}

/**
 * The exact prompt Higgsfield gets. With a reference: copy it exactly and change only what was asked,
 * with our images standing in for theirs and every one of their names replaced by ours. Without one:
 * the person's prompt, the brand basics and the brand look. A Style Library request (styleId set) is
 * already a full prompt and goes as written. All end with the brand's rules (banned words, offers,
 * forbidden claims, must-avoid names); with several versions, each gets its own angle.
 */
export function playgroundPrompt(req: PlaygroundRequest, brand: PlaygroundBrand, o: { variant?: number; total?: number } = {}): string {
  const app = brand.appName.trim() || "our app";
  const change = sentence(req.prompt);
  const n = req.inputUrls.length;
  const rules = playgroundRules(req, brand);
  const r = ruleLines(rules);
  // A Style Library request already is a complete recreate prompt (the format's layout, our copy, our images): sent as written.
  const lines = req.styleId
    ? [req.prompt.trim()]
    : req.referenceUrl
    ? [
      "Recreate the reference image (image 1) exactly: same layout, composition, framing, typography, colours, lighting, UI elements and text placement.",
      `Apply only these changes: ${change}.`,
      n ? `Use the product and brand shown in the attached ${imageRange(2, n)} wherever the reference shows a product or brand, and keep them exactly as they look.` : "",
      `Replace every brand name, logo and handle from the reference with "${app}".`,
      "If the output's shape differs from the reference, extend or reflow the same design to fit; never squash, stretch or crop off text.",
    ]
    : [
      `${change}.`,
      `An ad image for "${app}"${brand.tagline?.trim() ? ` (${brand.tagline.trim()})` : ""}, ${req.aspect}. Spell "${app}" exactly wherever it appears.`,
      n ? `Use the attached ${imageRange(1, n)} as our product and brand, and keep them exactly as they look.` : "",
    ];
  // The look: without a reference (or a Style Library format) the brand look opens the prompt; with
  // one, the reference's style leads, so only how our product looks. The rules always.
  const sys = rules.system;
  const freeform = !req.referenceUrl && !req.styleId;
  return [
    ...(sys && freeform ? [lookBlock(sys, { max: 900 })] : []),
    ...lines,
    ...(sys && req.referenceUrl && !req.styleId && sys.look.packaging && n ? [`Our product must look like this: ${sys.look.packaging.slice(0, 300)}`] : []),
    playgroundVersionLine(req, o.variant ?? 1, o.total ?? 1),
    r.avoidWords,
    r.wording,
    r.required,
    r.offers,
    "Keep all text legible and spelled exactly as given in quotes.",
    r.mustAvoid,
    r.claims,
  ].filter(Boolean).join("\n");
}

/**
 * The images in the order the prompt numbers them (the reference first), and the job params that carry
 * them. `image_refs` is the exact list (read by the creatives edge function and the desktop runner once
 * they're deployed with it). Until then the same list is split over the params they already read in this
 * order, `style_refs` (4) then `product_refs` (3), so up to 7 images reach Higgsfield in the right order.
 */
export function playgroundImages(req: Pick<PlaygroundRequest, "referenceUrl" | "inputUrls">) {
  const images = [...(req.referenceUrl ? [req.referenceUrl] : []), ...req.inputUrls];
  const params = images.length ? { image_refs: images, style_refs: images.slice(0, 4), ...(images.length > 4 ? { product_refs: images.slice(4, 7) } : {}) } : {};
  return { images, params };
}

/** A video's images in the order the job sends them: the start frame first (Seedance opens on it), then the rest. */
export function playgroundVideoImages(req: Pick<PlaygroundRequest, "inputUrls" | "video">): string[] {
  const start = req.video?.startFrame && req.inputUrls.includes(req.video.startFrame) ? req.video.startFrame : null;
  return start ? [start, ...req.inputUrls.filter((u) => u !== start)] : [...req.inputUrls];
}

/**
 * The exact prompt Seedance gets for a video. As written by default, like a Style Library request: no
 * app line, look, angles or best practices (those turned a described shot into an app ad). Only the
 * person's own "never show" words follow it, and, when the start frame comes with other images, a line
 * saying which image opens the video (the Higgsfield API's reference-to-video has no start-frame field;
 * the desktop runner and the API's image-to-video take it as a frame). "Use my brand" adds the brand look,
 * name and rules, as a prompt-only image request has them.
 */
export function playgroundVideoPrompt(req: PlaygroundRequest, brand: PlaygroundBrand): string {
  const v = req.video ?? DEFAULT_PLAYGROUND_VIDEO;
  const images = playgroundVideoImages(req);
  const startLine = v.startFrame && images.length > 1 ? "Open on image 1 exactly as it is: it is the video's first frame." : "";
  if (!v.useBrand) {
    const avoid = cleanMustAvoid(req.mustAvoid);
    return [req.prompt.trim(), startLine, avoid.length ? `Never show these names or words: ${avoid.join(", ")}.` : ""].filter(Boolean).join("\n");
  }
  const app = brand.appName.trim() || "our app";
  const rules = playgroundRules(req, brand);
  const r = ruleLines(rules);
  return [
    rules.system ? lookBlock(rules.system, { max: 700 }) : "",
    req.prompt.trim(),
    startLine,
    `A video ad for "${app}"${brand.tagline?.trim() ? ` (${brand.tagline.trim()})` : ""}; if its name appears, spell it exactly.`,
    r.avoidWords, r.wording, r.required, r.offers, r.mustAvoid, r.claims,
  ].filter(Boolean).join("\n");
}

/** A video request's plan: one Seedance 2.5 `ai_video` job per version, priced from the Studio's table (jobCost). */
function planPlaygroundVideo(req: PlaygroundRequest, brand: PlaygroundBrand, t: Words): Plan {
  const v = req.video ?? DEFAULT_PLAYGROUND_VIDEO;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (req.prompt.trim().length < PLAYGROUND_PROMPT.min) errors.push(t("Describe the shot."));
  if (!ASPECTS.includes(req.aspect)) errors.push(t("Pick 9:16, 1:1, 4:5 or 16:9."));
  const images = playgroundVideoImages(req);
  if (req.aspect === "4:5") warnings.push(t("Seedance has no 4:5: the video is made in 3:4 (Meta trims it to 4:5)."));
  if (v.startFrame && images.length === 1) warnings.push(t("With only a start frame, the Higgsfield API makes the video in that image's shape (the aspect is used on the desktop runner)."));
  // The same params the Studio's AI videos carry (lib/creative-plan.ts planBatch), with the exact image
  // list (`image_refs`, split over style_refs/product_refs as image jobs do) and the start frame.
  const { params: imageParams } = playgroundImages({ referenceUrl: null, inputUrls: images });
  const params: Record<string, unknown> = {
    duration: v.duration, resolution: v.resolution, aspect_ratio: videoAspect(req.aspect), generate_audio: v.audio, use_screenshots: false,
    ...imageParams,
    ...(v.startFrame && images[0] === v.startFrame ? { start_frame: v.startFrame } : {}),
  };
  const prompt = playgroundVideoPrompt(req, brand);
  const costEstimate = jobCost(PLAYGROUND_VIDEO_MODEL, params);
  const jobs: PlannedJob[] = Array.from({ length: req.count }, (_, i) => ({
    kind: "ai_video", model: PLAYGROUND_VIDEO_MODEL, prompt, params, aspect: req.aspect, variant: i + 1, backend: "auto", costEstimate,
  }));
  return { ...totals(jobs), warnings, errors, qa: playgroundRules(req, brand).qa };
}

/** What a playground request costs and the jobs it makes (the confirm dialog shows this; createBatch runs it). */
export function planPlayground(input: PlaygroundRequest, optionsIn: PlaygroundOptions, brand: PlaygroundBrand, t: Words = englishWords): Plan {
  const req = normalizePlaygroundRequest(input);
  if (req.mode === "video") return planPlaygroundVideo(req, brand, t);
  const options = normalizePlaygroundOptions(optionsIn);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (req.prompt.trim().length < PLAYGROUND_PROMPT.min) errors.push(t("Say what to make or change."));
  const { images, params: imageParams } = playgroundImages(req);
  const backend = images.length > RUNNER_MAX_IMAGES ? "api" : "auto";
  const viaHiggsfield = options.provider === "higgsfield";
  if (viaHiggsfield && backend === "api") warnings.push(t("With {n} images it runs on Higgsfield's API (the desktop runner sends at most {max}).", { n: images.length, max: RUNNER_MAX_IMAGES }));
  if (viaHiggsfield && req.aspect === "4:5") warnings.push(t("On the Higgsfield API, 4:5 is made in 3:4 (Meta trims it to 4:5); the desktop runner makes 4:5."));
  if (!ASPECTS.includes(req.aspect)) errors.push(t("Pick 1:1, 4:5, 9:16 or 16:9."));
  const params: Record<string, unknown> = {
    aspect_ratio: req.aspect, resolution: options.resolution, quality: options.quality, variant: options.variant, use_screenshots: false,
    ...imageParams,
    // The App Store reviews quoted word for word, so each one can be traced back from the creative.
    ...(req.reviewIds?.length ? { review_ids: req.reviewIds } : {}),
  };
  const jobs: PlannedJob[] = Array.from({ length: req.count }, (_, i): PlannedJob => forProvider({
    kind: "image", model: PLAYGROUND_MODEL, prompt: playgroundPrompt(req, brand, { variant: i + 1, total: req.count }), params, aspect: req.aspect, variant: i + 1, backend, costEstimate: jobCost(PLAYGROUND_MODEL, params),
  }, options.provider));
  return { ...totals(jobs), warnings, errors, qa: playgroundRules(req, brand).qa };
}

/** The batch the creative pipeline runs for a playground request (createBatch plans it with planPlayground). */
export function playgroundBatchRequest(input: PlaygroundRequest, optionsIn: PlaygroundOptions): BatchRequest {
  const req = normalizePlaygroundRequest(input);
  const options = normalizePlaygroundOptions(optionsIn);
  if (req.mode === "video") {
    const v = req.video ?? DEFAULT_PLAYGROUND_VIDEO;
    return {
      ...DEFAULT_REQUEST,
      brief: req.prompt.trim(),
      kinds: ["ai_video"],
      variants: req.count,
      aspects: [req.aspect],
      placements: [],
      format: "single",
      aiVideo: { duration: v.duration, resolution: v.resolution, generateAudio: v.audio, useScreenshots: false },
      reddit: [],
      tweets: [],
      mustAvoid: req.mustAvoid,
      productReferences: playgroundVideoImages(req).map((url) => ({ url, label: url === v.startFrame ? "start frame" : "", kind: "other" })),
      referencesInBrief: true,
      useProfile: false,
      useBrandSystem: v.useBrand,
      source: PLAYGROUND_SOURCE,
      playground: { ...req, options },
    };
  }
  return {
    ...DEFAULT_REQUEST,
    brief: req.prompt.trim(),
    kinds: ["image"],
    variants: req.count,
    aspects: [req.aspect],
    placements: [],
    format: "single",
    image: { model: PLAYGROUND_MODEL, quality: options.quality, resolution: options.resolution, useScreenshots: false, provider: options.provider },
    reddit: [],
    tweets: [],
    mustAvoid: req.mustAvoid,
    styleReferences: req.referenceUrl ? [req.referenceUrl] : [],
    productReferences: req.inputUrls.map((url) => ({ url, label: "", kind: "other" })),
    referencesInBrief: true,
    useProfile: false,
    source: PLAYGROUND_SOURCE,
    playground: { ...req, options },
  };
}

/** A saved batch's settings back as a request and options (for "edit and regenerate"), or null if it isn't a playground batch. */
export function playgroundFromSettings(settings: unknown): PlaygroundSettings | null {
  const s = (settings ?? {}) as { source?: unknown; playground?: Partial<PlaygroundSettings> };
  if (s.source !== PLAYGROUND_SOURCE || !s.playground) return null;
  return { ...normalizePlaygroundRequest(s.playground), options: normalizePlaygroundOptions(s.playground.options) };
}

// MARK: What the page reads (GET /api/playground/[productId])

/** A creative job's status (lib/creative-types.ts JobStatus); finalizing: finished, its result being saved. */
export type PlaygroundJobStatus = "queued" | "running" | "finalizing" | "done" | "failed" | "cancelled";
/** Still being made (or saved): counts as in progress, can't be dismissed. */
export const ACTIVE_JOB_STATUSES: readonly PlaygroundJobStatus[] = ["queued", "running", "finalizing"];
export const isActiveJob = (status: PlaygroundJobStatus) => ACTIVE_JOB_STATUSES.includes(status);

export interface PlaygroundJob {
  id: string;
  variant: number;
  status: PlaygroundJobStatus;
  error: string | null;
  backend: "auto" | "local" | "api" | "template";
  notBefore: string | null;
  costEstimate: number;
  costCredits: number | null;
  /** Who made (or makes) it: Higgsfield unless the job says OpenAI. */
  provider: ImageProvider;
  /** OpenAI jobs: the estimate and, once made, the cost from the tokens OpenAI reported (USD). */
  estUsd: number | null;
  costUsd: number | null;
}

export interface PlaygroundOutput {
  id: string;
  jobId: string | null;
  /** A video (video mode) or an image. */
  kind: "image" | "video";
  url: string;
  /** A video's poster frame, when the backend made one (the desktop runner does; the API doesn't). */
  posterUrl: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  aspect: string;
  model: string | null;
  createdAt: string;
  qaStatus: string;
  approval: string;
}

/** One generation: what was asked, its jobs and the images that came back. */
export interface PlaygroundItem {
  batchId: string;
  createdAt: string;
  credits: number;
  /** The OpenAI estimate (USD) the generation was confirmed at, when it ran via OpenAI. */
  usd: number | null;
  request: PlaygroundSettings;
  jobs: PlaygroundJob[];
  outputs: PlaygroundOutput[];
}

export interface PlaygroundPick { url: string; label: string | null; kind?: string | null }

export interface PlaygroundOverview {
  workspace: { id: string; name: string; appName: string; tagline: string | null; forbiddenClaims: string[] } | null;
  /** What the creatives backend's health check says. `wallClockSec` and `openaiImagePlan` are null on an older backend. */
  backend: { runner: boolean; higgsfieldApi: boolean; typesafe: boolean; openaiImages: boolean; wallClockSec?: number | null; openaiImagePlan?: OpenAiImagePlan | null } | null;
  /** This product's remembered image provider (products.image_provider); Higgsfield until changed. */
  imageProvider: ImageProvider;
  items: PlaygroundItem[];
  /** The workspace's product images (Product page). */
  productImages: (PlaygroundPick & { kind: string })[];
  /** Stored copies of competitors' image ads (Research). */
  researchImages: (PlaygroundPick & { page: string | null })[];
  error?: string;
}
