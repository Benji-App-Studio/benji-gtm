// Higgsfield's public REST API (https://docs.higgsfield.ai), for running jobs without the Mac.
// Auth is an API key ID and secret from console.higgsfield.ai, sent as `Authorization: Key ID:SECRET`
// (one secret here: HIGGSFIELD_API_KEY="<id>:<secret>"). Requests are asynchronous: submit to a
// model endpoint, keep the request_id, poll status_url until completed / failed / nsfw / canceled.
// Concurrency is per account (4 on pro); going over answers 400 "Maximum number of concurrent
// requests". Estimates: POST /estimate/<endpoint> with the same body.
//
// As documented on 2026-10-02 (docs.higgsfield.ai/docs/models) the API offers Marketing Studio
// *Image* (2.0 Alpha, 2.5 Flare, 2.5 Sunburst) and Seedance 2.5 video (text-to-video,
// reference-to-video with up to 30 image URLs, and image-to-video from a start frame), but not Marketing Studio *Video* (UGC modes,
// avatars, hooks), which stays on the local runner. The CLI's `gpt_image_2_5` (variants
// flare/sunburst) maps to the 2.5 workflows, its `marketing_studio_image` to 2.0 Alpha, and
// `seedance_2_5` to Seedance 2.5. Neither takes 4:5: those are made at 3:4 (Meta trims to 4:5).
// API credits are a pay-as-you-go balance on console.higgsfield.ai, separate from the web plan.

export const HF_API = "https://api.higgsfield.ai";

/** CLI model ids the API backend can run. */
export const API_MODELS = ["gpt_image_2_5", "marketing_studio_image", "seedance_2_5"] as const;

/** Ratios the API endpoints take; 4:5 (and anything else) falls back to the nearest. */
const API_ASPECTS = ["1:1", "3:4", "4:3", "9:16", "16:9", "21:9", "2:3", "3:2"];
export const apiAspect = (aspect: string) => (API_ASPECTS.includes(aspect) ? aspect : aspect === "4:5" ? "3:4" : aspect === "5:4" ? "4:3" : "1:1");

export interface ApiRequest { endpoint: string; body: Record<string, unknown> }

const httpsList = (list: unknown) => (Array.isArray(list) ? list : []).filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u));

/**
 * A job's reference images, in the order its prompt numbers them: `image_refs` as given (the
 * Playground), else the competitor's image(s) (Recreate's `style_refs`), our logo (`logo_ref`, right
 * after them so the prompt's "image N is our logo" holds), our picked images (`product_refs`), then
 * the brand kit screenshots. apiRequestFor trims the list to what each endpoint takes.
 */
export function referenceUrls(params: Record<string, unknown>, screenshots: unknown = []): string[] {
  const exact = httpsList(params.image_refs);
  if (exact.length) return exact.slice(0, 16);
  const logo = httpsList([params.logo_ref]);
  const style = httpsList(params.style_refs).slice(0, logo.length ? 3 : 4);
  const ours = httpsList(params.product_refs).slice(0, 3);
  const shots = params.use_screenshots ? httpsList(screenshots) : [];
  return [...style, ...logo, ...ours, ...shots];
}

/** The API endpoint and body for a job, or null when only the local runner can run it. */
export function apiRequestFor(model: string, prompt: string, params: Record<string, unknown>, imageUrls: string[] = []): ApiRequest | null {
  const aspect = apiAspect(typeof params.aspect_ratio === "string" ? params.aspect_ratio : "1:1");
  if (model === "gpt_image_2_5") {
    const variant = params.variant === "sunburst" ? "sunburst" : "flare";
    return {
      endpoint: `marketing-studio/image/${variant}`,
      body: {
        prompt, aspect_ratio: aspect,
        resolution: params.resolution ?? "2k", quality: params.quality ?? "medium",
        enhance_prompt: false, ...(imageUrls.length ? { image_urls: imageUrls.slice(0, 16) } : {}),
      },
    };
  }
  if (model === "seedance_2_5") {
    // Seedance takes 16:9, 4:3, 1:1, 3:4, 9:16, 21:9.
    const videoAspect = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"].includes(aspect) ? aspect : "9:16";
    const duration = Math.min(30, Math.max(4, Math.round(Number(params.duration) || 10)));
    const body = {
      prompt, duration, aspect_ratio: videoAspect,
      resolution: ["480p", "720p", "1080p"].includes(String(params.resolution)) ? params.resolution : "720p",
      generate_audio: params.generate_audio !== false, bitrate_mode: "high",
    };
    // A start frame alone (the Playground's `start_frame`, first in the list): image-to-video, which
    // opens on that image and takes its shape (it has no aspect_ratio). With other images too it goes
    // to reference-to-video (no start-frame field there; the prompt names image 1 as the first frame).
    const start = typeof params.start_frame === "string" && imageUrls[0] === params.start_frame ? params.start_frame : null;
    if (start && imageUrls.length === 1) {
      const { prompt: text, duration: seconds, resolution, generate_audio, bitrate_mode } = body;
      return { endpoint: "bytedance/seedance-2.5/image-to-video", body: { prompt: text, duration: seconds, resolution, generate_audio, bitrate_mode, image_url: start } };
    }
    return imageUrls.length
      ? { endpoint: "bytedance/seedance-2.5/reference-to-video", body: { ...body, image_urls: imageUrls.slice(0, 30) } }
      : { endpoint: "bytedance/seedance-2.5/text-to-video", body: { ...body, output_format: "mp4" } };
  }
  if (model === "marketing_studio_image") {
    return { endpoint: "marketing-studio/image", body: { prompt, aspect_ratio: aspect, resolution: params.resolution ?? "2k", ...(imageUrls.length ? { image_urls: imageUrls.slice(0, 16) } : {}) } };
  }
  return null;
}

export type ApiStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
export interface ApiResult { status: ApiStatus; request_id: string; status_url?: string; cancel_url?: string; images?: { url: string }[]; video?: { url: string }; error?: string | null }

export const isTerminal = (status: ApiStatus) => status === "completed" || status === "failed" || status === "nsfw" || status === "canceled";
export const outputUrls = (result: ApiResult) => [...(result.images ?? []).map((i) => i.url), ...(result.video ? [result.video.url] : [])];

/**
 * Higgsfield is busy, not the job at fault: a concurrency or rate refusal, or a 502 / 503 (its gateway or
 * servers overloaded or restarting). Wait and try again, with backoff (core/jobs.ts busyBackoff). Safe
 * at submit too: the retry carries the same Idempotency-Key, so a request that did get through is
 * not made twice.
 */
export const isBusy = (status: number, text: string) =>
  status === 429 || status === 502 || status === 503 || (status === 400 && /concurrent requests|rate limit/i.test(text));

export class HiggsfieldApiError extends Error {
  constructor(readonly status: number, message: string, readonly busy = false) { super(message); }
}

type Fetch = typeof fetch;

export function higgsfieldApi(key: string, fetchImpl: Fetch = fetch) {
  const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
  async function call<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetchImpl(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    if (!response.ok) throw new HiggsfieldApiError(response.status, `Higgsfield API ${response.status}: ${text.slice(0, 300)}`, isBusy(response.status, text));
    return (text ? JSON.parse(text) : {}) as T;
  }
  return {
    /** Submits a job; the idempotency key (our job id) makes a retried submit safe. */
    submit: (req: ApiRequest, idempotencyKey: string) =>
      call<ApiResult>(`${HF_API}/${req.endpoint}`, { method: "POST", body: JSON.stringify(req.body), headers: { "Idempotency-Key": idempotencyKey } }),
    status: (requestId: string) => call<ApiResult>(`${HF_API}/requests/${encodeURIComponent(requestId)}/status`, { method: "GET" }),
    estimate: (req: ApiRequest) => call<{ credits: string; usd: string }>(`${HF_API}/estimate/${req.endpoint}`, { method: "POST", body: JSON.stringify(req.body) }),
  };
}
