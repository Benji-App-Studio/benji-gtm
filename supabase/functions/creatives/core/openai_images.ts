// GPT Image 2.5 straight from OpenAI's Images API, for image jobs whose provider is "openai" (the
// person's choice in the Studio, the Playground or a template remake; Higgsfield is the default). Plain
// TypeScript with no runtime APIs, so the Deno tests and the Node tests (which compare it with the
// studio's twin, studio/src/lib/image-provider.ts) both load it.
//
// As documented on 2026-10-05 (developers.openai.com/api/docs/guides/image-generation and
// /api/docs/models/gpt-image-2.5-flare): GPT Image 2.5 is `gpt-image-2.5-flare` (fast everyday
// generation) and `gpt-image-2.5-sunburst` (editing precision), the same two variants Higgsfield's
// `gpt_image_2_5` offers. Without reference images a job goes to POST /v1/images/generations (JSON);
// with them to POST /v1/images/edits (multipart, one `image[]` part per image). Both take size
// (WIDTHxHEIGHT: multiples of 16, ratio up to 3:1, edges up to 3840 px, 655,360 to 8,294,400 pixels),
// quality (low, medium, high, xhigh, max), background (auto, opaque, transparent) and output_format,
// and answer with base64 images (`data[].b64_json`) and the tokens used. A safety refusal is an error
// with `code: "moderation_blocked"` (and `moderation_details`); OpenAI says not to retry those unchanged.
import { MODEL_DEFAULTS } from "../../_shared/ai/models.ts";

export const OPENAI_IMAGES = "https://api.openai.com/v1/images";

/** Higgsfield's GPT Image 2.5 variants and OpenAI's model ids for the same models. */
export const OPENAI_IMAGE_MODELS = { flare: MODEL_DEFAULTS.image, sunburst: MODEL_DEFAULTS.imageEdit } as const;
export const OPENAI_QUALITIES = ["low", "medium", "high", "xhigh", "max"] as const;
export type OpenAiQuality = (typeof OPENAI_QUALITIES)[number];

/**
 * OpenAI's published token prices for both GPT Image 2.5 models (USD per million tokens), checked on
 * 2026-10-05 on developers.openai.com/api/docs/pricing. The studio's estimate uses the same numbers
 * (studio/src/lib/image-provider.ts OPENAI_IMAGE_PRICING; a Node test keeps the two equal).
 */
export const OPENAI_TOKEN_PRICES = { textInput: 5, imageInput: 8, imageOutput: 30 } as const;

/** Pixel budgets for Higgsfield's resolutions: 1k ≈ 1024², 2k ≈ 2048², 4k = OpenAI's 4K ceiling. */
export const RESOLUTION_PIXELS: Record<string, number> = { "1k": 1024 * 1024, "2k": 2048 * 2048, "4k": 8_294_400 };
export const OPENAI_SIZE_LIMITS = { step: 16, minPixels: 655_360, maxPixels: 8_294_400, maxEdge: 3840, maxRatio: 3 } as const;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * The OpenAI size for an aspect ratio and a Higgsfield resolution: the exact ratio, both edges multiples
 * of 16, as many pixels as the resolution's budget allows (never more), within OpenAI's limits. OpenAI
 * makes 4:5 itself (Higgsfield's API makes it in 3:4). Unknown or out-of-range ratios fall back to square.
 */
export function openAiSize(aspect: string, resolution: string): { width: number; height: number; size: string } {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(aspect);
  let w = m ? Number(m[1]) : 1, h = m ? Number(m[2]) : 1;
  if (!w || !h || Math.max(w, h) / Math.min(w, h) > OPENAI_SIZE_LIMITS.maxRatio) { w = 1; h = 1; }
  const g = gcd(w, h);
  w /= g; h /= g;
  const unitW = OPENAI_SIZE_LIMITS.step * w, unitH = OPENAI_SIZE_LIMITS.step * h;
  const budget = Math.min(RESOLUTION_PIXELS[resolution] ?? RESOLUTION_PIXELS["2k"], OPENAI_SIZE_LIMITS.maxPixels);
  let k = Math.floor(Math.sqrt(budget / (unitW * unitH)));
  while (k > 1 && Math.max(unitW, unitH) * k > OPENAI_SIZE_LIMITS.maxEdge) k--;
  while (unitW * unitH * k * k < OPENAI_SIZE_LIMITS.minPixels) k++;
  const width = unitW * k, height = unitH * k;
  return { width, height, size: `${width}x${height}` };
}

/** Image output tokens per OpenAI's calculator for GPT Image 2.5 (the image generation guide, 2026-10-05). */
export const OUTPUT_BASE_TOKENS: Record<OpenAiQuality, number> = { low: 16, medium: 24, high: 48, xhigh: 64, max: 96 };

/**
 * Output tokens for one image, as OpenAI's own calculator works them out: the quality's base for the
 * long edge, the short edge scaled by the ratio (halves round to even), times (2,000,000 + pixels) / 4,000,000.
 */
export function openAiOutputTokens(width: number, height: number, quality: string): number {
  const base = OUTPUT_BASE_TOKENS[quality as OpenAiQuality] ?? OUTPUT_BASE_TOKENS.medium;
  const long = Math.max(width, height), short = Math.min(width, height);
  const s = base / (long / short);
  const floor = Math.floor(s);
  const other = s - floor === 0.5 ? floor + (floor % 2) : Math.round(s);
  return Math.ceil((base * other * (2e6 + width * height)) / 4e6);
}

/** What a finished request cost, from the tokens OpenAI reported (USD, 4 decimals); null without usage. */
export function costFromUsage(usage: unknown): number | null {
  const u = (usage ?? {}) as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } };
  if (!Number.isFinite(Number(u.output_tokens))) return null;
  const imageIn = Number(u.input_tokens_details?.image_tokens) || 0;
  const textIn = Number.isFinite(Number(u.input_tokens_details?.text_tokens)) ? Number(u.input_tokens_details!.text_tokens) : Math.max(0, (Number(u.input_tokens) || 0) - imageIn);
  const usd = (textIn * OPENAI_TOKEN_PRICES.textInput + imageIn * OPENAI_TOKEN_PRICES.imageInput + Number(u.output_tokens) * OPENAI_TOKEN_PRICES.imageOutput) / 1e6;
  return Math.round(usd * 10_000) / 10_000;
}

// MARK: Request

export interface OpenAiImageParams { model: string; size: string; quality: OpenAiQuality; background: "opaque" | "auto" }

const SIZE = /^(\d{3,4})x(\d{3,4})$/;
const validSize = (size: unknown): size is string => {
  const m = typeof size === "string" ? SIZE.exec(size) : null;
  if (!m) return false;
  const w = Number(m[1]), h = Number(m[2]);
  return w % 16 === 0 && h % 16 === 0 && Math.max(w, h) <= OPENAI_SIZE_LIMITS.maxEdge && w * h >= OPENAI_SIZE_LIMITS.minPixels && w * h <= OPENAI_SIZE_LIMITS.maxPixels && Math.max(w, h) / Math.min(w, h) <= OPENAI_SIZE_LIMITS.maxRatio;
};

/**
 * The model, size, quality and background for a job: what the planner put in `params.openai`, checked
 * (known model ids only, a size within OpenAI's rules), else worked out from the job's Higgsfield
 * params (variant, aspect_ratio, resolution, quality) the same way the planner does.
 */
export function openAiImageParams(params: Record<string, unknown>, aspect: string): OpenAiImageParams {
  const given = (params.openai ?? {}) as Record<string, unknown>;
  const models = Object.values(OPENAI_IMAGE_MODELS) as string[];
  const variant = params.variant === "sunburst" ? "sunburst" : "flare";
  const model = typeof given.model === "string" && models.includes(given.model) ? given.model : OPENAI_IMAGE_MODELS[variant];
  const quality = [given.quality, params.quality].find((q): q is OpenAiQuality => OPENAI_QUALITIES.includes(q as OpenAiQuality)) ?? "medium";
  const size = validSize(given.size) ? given.size : openAiSize(typeof params.aspect_ratio === "string" ? params.aspect_ratio : aspect, String(params.resolution ?? "2k")).size;
  return { model, size, quality, background: given.background === "auto" ? "auto" : "opaque" };
}

export interface OpenAiImageRequest { url: string; body: Record<string, unknown> | FormData; multipart: boolean }

/**
 * The request for one image: generations (JSON) with no reference images, edits (multipart, the
 * images as `image[]` files in the order the prompt numbers them) with some. PNG out, one image,
 * OpenAI's standard moderation.
 */
export function openAiImageRequest(prompt: string, p: OpenAiImageParams, images: { bytes: Uint8Array; mime: string; name: string }[] = []): OpenAiImageRequest {
  const fields = { model: p.model, prompt, size: p.size, quality: p.quality, background: p.background, output_format: "png", n: 1, moderation: "auto" };
  if (!images.length) return { url: `${OPENAI_IMAGES}/generations`, body: fields, multipart: false };
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  for (const image of images.slice(0, 16)) form.append("image[]", new Blob([new Uint8Array(image.bytes)], { type: image.mime }), image.name);
  return { url: `${OPENAI_IMAGES}/edits`, body: form, multipart: true };
}

// MARK: Answer

export type OpenAiOutcome =
  | { ok: true; images: Uint8Array[]; costUsd: number | null; requestId: string | null }
  /** `blocked`: the safety filter refused it. `retryable`: a rate limit or overload before anything ran. */
  | { ok: false; blocked: boolean; retryable: boolean; message: string };

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Reads OpenAI's answer (its HTTP status and JSON) into an image, a safety block, a busy answer or a failure. */
export function readOpenAiAnswer(status: number, body: unknown, requestId: string | null = null): OpenAiOutcome {
  const data = (body ?? {}) as { data?: { b64_json?: string }[]; usage?: unknown; error?: { code?: string; type?: string; message?: string; moderation_details?: { moderation_stage?: string; categories?: string[] } } };
  const error = data.error;
  if (status >= 200 && status < 300 && !error) {
    const images = (data.data ?? []).map((d) => d.b64_json).filter((b): b is string => typeof b === "string" && b.length > 0).map(decode);
    if (!images.length) return { ok: false, blocked: false, retryable: false, message: "OpenAI answered without an image." };
    return { ok: true, images, costUsd: costFromUsage(data.usage), requestId };
  }
  const message = String(error?.message ?? `error ${status}`).replace(/\s+/g, " ").slice(0, 300);
  if (error?.code === "moderation_blocked" || /moderation_blocked|safety system/i.test(message)) {
    const d = error?.moderation_details;
    const detail = [d?.moderation_stage && d.moderation_stage !== "unknown" ? `${d.moderation_stage === "output" ? "the image it made" : "the prompt or images"}` : "", d?.categories?.length ? d.categories.slice(0, 4).join(", ") : ""].filter(Boolean).join(": ");
    return { ok: false, blocked: true, retryable: false, message: `OpenAI's safety filter blocked it (moderation_blocked${detail ? `, ${detail}` : ""}). Rephrase the prompt, or try with Higgsfield instead.` };
  }
  // A rate limit or an overload: nothing ran, so the job can wait and go again on OpenAI (never on Higgsfield).
  if (status === 429 && error?.code !== "insufficient_quota" && error?.type !== "insufficient_quota") return { ok: false, blocked: false, retryable: true, message: `OpenAI is busy (429): ${message}` };
  if (status === 503) return { ok: false, blocked: false, retryable: true, message: `OpenAI is overloaded (503): ${message}` };
  if (status === 401) return { ok: false, blocked: false, retryable: false, message: "OpenAI refused the key (401). Check your OpenAI key in Settings > API keys." };
  if (error?.code === "insufficient_quota" || error?.type === "insufficient_quota") return { ok: false, blocked: false, retryable: false, message: `OpenAI: out of credit on the API account (${message})` };
  return { ok: false, blocked: false, retryable: false, message: `OpenAI ${status}: ${message}` };
}

/** The longest one awaited request is given: what the slowest images need on a plan with room for it. */
export const OPENAI_WAIT_MS = 280_000;

/**
 * Sends one request and reads the answer. Never throws for an HTTP answer; a network failure or a
 * timeout comes back as a non-retryable failure (the request may have run, so it's never sent again).
 */
export async function generateOpenAiImage(apiKey: string, req: OpenAiImageRequest, o: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<OpenAiOutcome> {
  try {
    const response = await (o.fetchImpl ?? fetch)(req.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, ...(req.multipart ? {} : { "Content-Type": "application/json" }) },
      body: req.multipart ? (req.body as FormData) : JSON.stringify(req.body),
      signal: AbortSignal.timeout(o.timeoutMs ?? OPENAI_WAIT_MS),
    });
    const text = await response.text();
    let json: unknown = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { error: { message: text.slice(0, 200) } }; }
    return readOpenAiAnswer(response.status, json, response.headers.get("x-request-id"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = /abort|timed? ?out/i.test(message);
    return { ok: false, blocked: false, retryable: false, message: timedOut ? "OpenAI didn't answer in time; the image may still have been made and charged, so it isn't sent again. Retry to make it again." : `Couldn't reach OpenAI: ${message.slice(0, 200)}` };
  }
}

/** A job taken again after its OpenAI request was cut off: its result is gone, and it's never sent again on its own. */
export const INTERRUPTED_MESSAGE = "The OpenAI request was cut off before its image came back, so nothing was saved (OpenAI may still have charged it). Retry to make it again.";

// MARK: How long an image takes

/**
 * OpenAI's guide gives one number and one rule (developers.openai.com/api/docs/guides/image-generation,
 * read 2026-11-19): "Complex prompts may take up to 2 minutes to process", and latency is "proportional
 * to the number of tokens required". It gives no seconds per quality. So this is an ESTIMATE, on the
 * safe side: the documented 2 minutes is taken as the time for the largest `high` image (the top
 * quality when that sentence was written), and every other size and quality scales with its output
 * tokens (openAiOutputTokens). It decides whether a request is awaited in one run or handed over to be
 * collected later (core/openai_jobs.ts); it never changes what is sent.
 */
export const DOCUMENTED_SLOWEST_SEC = 120;
const SLOWEST_HIGH_TOKENS = openAiOutputTokens(2880, 2880, "high");

/** Seconds one image of this size and quality is expected to take (see DOCUMENTED_SLOWEST_SEC). */
export function expectedSeconds(size: string, quality: string): number {
  const m = SIZE.exec(size);
  const [width, height] = m ? [Number(m[1]), Number(m[2])] : [2048, 2048];
  return Math.max(5, Math.ceil((DOCUMENTED_SLOWEST_SEC * openAiOutputTokens(width, height, quality)) / SLOWEST_HIGH_TOKENS));
}

// MARK: Submit now, collect later (the Responses API in background mode)

/**
 * For an image that takes longer than one run of the function may last. As documented on 2026-11-19:
 *   - the Responses API makes images with its built-in `image_generation` tool; the image model is the
 *     tool's `model`, with the same size, quality, background, output_format and moderation options,
 *     `action` generate or edit, and `tool_choice: { type: "image_generation" }` to force the call
 *     (developers.openai.com/api/docs/guides/tools-image-generation);
 *   - any Responses request can run in the background: `background: true` answers at once with an id
 *     and status `queued`; GET /v1/responses/{id} is polled while it is `queued` or `in_progress`;
 *     POST /v1/responses/{id}/cancel stops it (developers.openai.com/api/docs/guides/background).
 * The two pages do not say in so many words that the image tool runs in background mode. If OpenAI
 * refuses the request, nothing has started: the job then says the quality doesn't fit the plan.
 * The Images API itself (generations, edits) has no submit-and-collect form.
 */
export const OPENAI_RESPONSES = "https://api.openai.com/v1/responses";
/** A job's `external_id` while its background request is at OpenAI: this, then the response id. */
export const OPENAI_BACKGROUND = "openai-bg:";

/** What the text model is told: it only hands the prompt to the image tool, unchanged. */
export const BACKGROUND_SYSTEM = "Make exactly one image with the image generation tool. Use the user's text as the image prompt word for word: do not rewrite, shorten, translate or add to it. When images are attached, they are the reference images the prompt numbers, in that order. Do not answer in words.";

const dataUrlOf = (bytes: Uint8Array, mime: string) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
};

/** The background request for one image: the same model, size, quality and background as the direct request. */
export function openAiBackgroundRequest(textModel: string, prompt: string, p: OpenAiImageParams, images: { bytes: Uint8Array; mime: string; name: string }[] = []) {
  return {
    model: textModel,
    background: true,
    input: [
      { role: "system", content: BACKGROUND_SYSTEM },
      { role: "user", content: [{ type: "input_text", text: prompt }, ...images.slice(0, 16).map((image) => ({ type: "input_image", image_url: dataUrlOf(image.bytes, image.mime) }))] },
    ],
    tools: [{ type: "image_generation", model: p.model, size: p.size, quality: p.quality, background: p.background, output_format: "png", moderation: "auto", action: images.length ? "edit" : "generate" }],
    tool_choice: { type: "image_generation" },
  };
}

export type OpenAiSubmitted =
  | { ok: true; id: string }
  /**
   * `unsupported`: OpenAI refused the request itself (nothing started). `unknown`: no answer came, so it
   * may or may not have started. Otherwise as OpenAiOutcome's failure.
   */
  | { ok: false; unsupported: boolean; unknown: boolean; blocked: boolean; retryable: boolean; message: string };

/** Reads the answer to a background submit. */
export function readBackgroundSubmit(status: number, body: unknown): OpenAiSubmitted {
  const data = (body ?? {}) as { id?: unknown; status?: unknown; error?: unknown };
  if (status >= 200 && status < 300 && typeof data.id === "string" && data.id && !data.error) return { ok: true, id: data.id };
  if (status >= 200 && status < 300) return { ok: false, unsupported: false, unknown: true, blocked: false, retryable: false, message: "OpenAI answered without an id for the request, so its image can't be collected. It may still have been made and charged; it isn't sent again. Retry to make it again." };
  const failure = readOpenAiAnswer(status, body) as Extract<OpenAiOutcome, { ok: false }>;
  // A request OpenAI won't take as it is (a 4xx that isn't the key, the balance, a rate limit or the safety filter).
  const unsupported = !failure.blocked && !failure.retryable && [400, 404, 405, 422].includes(status);
  return { ok: false, unsupported, unknown: false, blocked: failure.blocked, retryable: failure.retryable, message: failure.message };
}

/** Starts a background request. Never throws: no answer comes back as `unknown` (it may have started). */
export async function submitOpenAiBackground(apiKey: string, body: unknown, o: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<OpenAiSubmitted> {
  try {
    const response = await (o.fetchImpl ?? fetch)(OPENAI_RESPONSES, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(o.timeoutMs ?? 60_000),
    });
    const text = await response.text();
    let json: unknown = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { error: { message: text.slice(0, 200) } }; }
    return readBackgroundSubmit(response.status, json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, unsupported: false, unknown: true, blocked: false, retryable: false, message: `OpenAI didn't confirm it took the request (${/abort|timed? ?out/i.test(message) ? "no answer in time" : message.slice(0, 160)}). It may still have started and be charged, so it isn't sent again. Retry to make it again.` };
  }
}

export type OpenAiCollected =
  /** Still queued or being made. */
  | { state: "pending" }
  | { state: "done"; images: Uint8Array[]; requestId: string }
  /** OpenAI ended it without an image (`blocked`: its safety filter), or no longer has it. */
  | { state: "failed"; blocked: boolean; message: string }
  /** The look itself didn't work (no answer, a busy answer): look again later. */
  | { state: "error"; message: string };

/** Reads GET /v1/responses/{id}: still going, the image, OpenAI's own failure, or a look that didn't work. */
export function readBackgroundResponse(status: number, body: unknown, id = ""): OpenAiCollected {
  const data = (body ?? {}) as { id?: string; status?: string; output?: { type?: string; status?: string; result?: unknown }[]; error?: { code?: string; message?: string } | null; incomplete_details?: { reason?: string } | null };
  if (status === 404) return { state: "failed", blocked: false, message: "OpenAI no longer has this request's result (it wasn't collected in time). Nothing was saved; retry to make it again." };
  if (status === 429 || status >= 500) return { state: "error", message: `OpenAI is busy (${status}); looking again shortly.` };
  if (status < 200 || status >= 300) {
    const failure = readOpenAiAnswer(status, body) as Extract<OpenAiOutcome, { ok: false }>;
    return { state: "failed", blocked: failure.blocked, message: failure.message };
  }
  const state = String(data.status ?? "");
  if (state === "queued" || state === "in_progress") return { state: "pending" };
  const reason = String(data.error?.message ?? data.incomplete_details?.reason ?? "").replace(/\s+/g, " ").slice(0, 300);
  if (state === "completed") {
    const images = (Array.isArray(data.output) ? data.output : []).filter((item) => item?.type === "image_generation_call")
      .map((item) => item.result).filter((b): b is string => typeof b === "string" && b.length > 0).map(decode);
    if (images.length) return { state: "done", images, requestId: String(data.id ?? id) };
    return { state: "failed", blocked: false, message: "OpenAI finished the request without an image. Retry to make it again." };
  }
  if (data.error?.code === "moderation_blocked" || /moderation_blocked|safety system/i.test(reason)) {
    return { state: "failed", blocked: true, message: `OpenAI's safety filter blocked it (moderation_blocked). Rephrase the prompt, or try with Higgsfield instead.` };
  }
  if (["failed", "cancelled", "canceled", "incomplete"].includes(state)) return { state: "failed", blocked: false, message: `OpenAI ended the request without an image (${state}${reason ? `: ${reason}` : ""}). Retry to make it again.` };
  return { state: "error", message: `OpenAI answered with a status this app doesn't know (${state || "none"}).` };
}

/** Looks at a background request. Never throws: no answer is an `error` to look again after. */
export async function collectOpenAiBackground(apiKey: string, id: string, o: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<OpenAiCollected> {
  try {
    const response = await (o.fetchImpl ?? fetch)(`${OPENAI_RESPONSES}/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(o.timeoutMs ?? 60_000) });
    const text = await response.text();
    let json: unknown = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
    return readBackgroundResponse(response.status, json, id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { state: "error", message: /abort|timed? ?out/i.test(message) ? "OpenAI didn't answer in time when asked for the image; looking again shortly." : `Couldn't reach OpenAI to collect the image: ${message.slice(0, 160)}` };
  }
}

/** Asks OpenAI to stop a background request nobody is waiting for any more. Best effort. */
export async function cancelOpenAiBackground(apiKey: string, id: string, o: { fetchImpl?: typeof fetch } = {}): Promise<void> {
  try {
    const response = await (o.fetchImpl ?? fetch)(`${OPENAI_RESPONSES}/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
    await response.body?.cancel();
  } catch { /* it ends by itself */ }
}
