// One draft's way to a paused ad, a step at a time so the worker can stop and resume anywhere:
//   queued → (image: upload bytes → hash) → creating
//   queued → (video: upload from URL → id) → processing → (poll until Meta has processed it) → creating
//   creating → ad creative → paused ad → draft
// Each step returns the fields to save. Meta ids are saved as soon as they exist, so a retried step
// never uploads or creates twice.
//
// Drafts from the "Send to Meta" sheet carry a `spec` (a carousel or placement customisation has
// several pieces of media): the same states, one upload per step, every video polled until ready,
// then one creative (pipeline.ts creativeBody) and one paused ad in the chosen ad set.
import { type Graph, GraphError, UnsafeWriteError } from "./graph.ts";
import { adPayload, createAd, createCreative, creativePayload, explain, uploadImage, uploadVideo, videoState } from "./meta.ts";
import { creativeBody, type DraftSpec } from "./pipeline.ts";
import type { DraftRow, LaunchSettingsRow } from "./types.ts";

export const VIDEO_POLL_SECONDS = 10;
export const VIDEO_LIMIT_MINUTES = 30;
export const MAX_ATTEMPTS = 5;
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

export interface StepContext {
  graph: Graph;
  settings: LaunchSettingsRow;
  /** Downloads a creative's file (the studio's storage URL). Injectable for tests. */
  download: (url: string) => Promise<Uint8Array>;
  now?: () => Date;
}

const later = (now: Date, seconds: number) => new Date(now.getTime() + seconds * 1000).toISOString();

export async function stepDraft(d: DraftRow, ctx: StepContext): Promise<Partial<DraftRow>> {
  const now = ctx.now?.() ?? new Date();
  const adAccountId = ctx.settings.meta.adAccountId;
  if (!adAccountId) return { status: "error", error: "No Meta ad account is connected." };
  if (d.spec) return stepSpecDraft(d, d.spec, adAccountId, ctx, now);
  try {
    switch (d.status) {
      case "queued": {
        if (d.creative.kind === "video") {
          const videoId = d.video_id ?? await uploadVideo(ctx.graph, adAccountId, d.ad_name, d.creative.url);
          return { video_id: videoId, status: "processing", next_check_at: later(now, VIDEO_POLL_SECONDS), attempts: 0, error: null };
        }
        if (d.image_hash) return { status: "creating", next_check_at: null };
        const bytes = await ctx.download(d.creative.url);
        if (bytes.byteLength > MAX_IMAGE_BYTES) return { status: "error", error: "The image is over Meta's 30 MB limit." };
        const hash = await uploadImage(ctx.graph, adAccountId, d.ad_name, bytes);
        return { image_hash: hash, status: "creating", next_check_at: null, attempts: 0, error: null };
      }
      case "processing": {
        const state = await videoState(ctx.graph, d.video_id!);
        if (state.state === "ready") {
          return { status: "creating", thumbnail_url: state.thumbnail ?? d.creative.thumbnailUrl ?? null, next_check_at: null };
        }
        if (state.state === "error") return { status: "error", error: state.message, next_check_at: null };
        const started = new Date(d.created_at).getTime();
        if (now.getTime() - started > VIDEO_LIMIT_MINUTES * 60_000) {
          return { status: "error", error: `Meta was still processing the video after ${VIDEO_LIMIT_MINUTES} minutes.`, next_check_at: null };
        }
        return { next_check_at: later(now, VIDEO_POLL_SECONDS) };
      }
      case "creating": {
        let creativeId = d.meta_creative_id;
        if (!creativeId) {
          if (d.creative.kind === "video" && !d.thumbnail_url) {
            return { status: "error", error: "Meta gave the video no thumbnail; add a cover image to the creative." };
          }
          creativeId = await createCreative(ctx.graph, adAccountId, creativePayload(ctx.settings, {
            name: d.ad_name, primaryText: d.primary_text, headline: d.headline, cta: d.cta, link: d.link,
            description: d.creative.description, aiDisclosure: d.creative.aiDisclosure,
            imageHash: d.image_hash, videoId: d.video_id, thumbnailUrl: d.thumbnail_url,
          }));
          // Saved before the ad is made, so a retry reuses this creative.
          return { meta_creative_id: creativeId };
        }
        const adId = await createAd(ctx.graph, adAccountId, adPayload(d.ad_name, d.adset_id, creativeId));
        return { ad_id: adId, status: "draft", next_check_at: null, error: null };
      }
      default:
        return {};
    }
  } catch (error) {
    if (error instanceof UnsafeWriteError) return { status: "error", error: error.message, next_check_at: null };
    const attempts = (d.attempts ?? 0) + 1;
    if (error instanceof GraphError && error.transient && attempts < MAX_ATTEMPTS) {
      // Back off: 30 s, 60 s, 120 s, 240 s.
      return { attempts, error: explain(error), next_check_at: later(now, 30 * 2 ** (attempts - 1)) };
    }
    return { status: "error", attempts, error: explain(error), next_check_at: null };
  }
}

/** A sheet draft's next step; the media list is saved back after every upload. */
async function stepSpecDraft(d: DraftRow, spec: DraftSpec, adAccountId: string, ctx: StepContext, now: Date): Promise<Partial<DraftRow>> {
  const media = spec.media.map((m) => ({ ...m }));
  const save = (patch: Partial<DraftRow>): Partial<DraftRow> => ({ spec: { ...spec, media }, ...patch });
  try {
    switch (d.status) {
      case "queued": {
        // One upload per step, saved at once, so a retry never uploads the same file twice.
        const next = media.find((m) => (m.kind === "video" ? !m.videoId : !m.imageHash));
        if (next) {
          if (next.kind === "video") {
            next.videoId = await uploadVideo(ctx.graph, adAccountId, d.ad_name, next.creative.url);
          } else {
            const bytes = await ctx.download(next.creative.url);
            if (bytes.byteLength > MAX_IMAGE_BYTES) return { status: "error", error: "An image is over Meta's 30 MB limit." };
            next.imageHash = await uploadImage(ctx.graph, adAccountId, d.ad_name, bytes);
            next.ready = true;
          }
          return save({ attempts: 0, error: null, next_check_at: null });
        }
        const videos = media.some((m) => m.kind === "video" && !m.ready);
        return save({ status: videos ? "processing" : "creating", next_check_at: videos ? later(now, VIDEO_POLL_SECONDS) : null });
      }
      case "processing": {
        for (const m of media.filter((x) => x.kind === "video" && !x.ready)) {
          const state = await videoState(ctx.graph, m.videoId!);
          if (state.state === "error") return { status: "error", error: state.message, next_check_at: null };
          if (state.state === "ready") {
            m.ready = true;
            m.thumbnailUrl = state.thumbnail ?? m.creative.thumbnailUrl ?? null;
          }
        }
        if (media.every((m) => m.kind === "image" || m.ready)) return save({ status: "creating", next_check_at: null });
        if (now.getTime() - new Date(d.created_at).getTime() > VIDEO_LIMIT_MINUTES * 60_000) {
          return { status: "error", error: `Meta was still processing a video after ${VIDEO_LIMIT_MINUTES} minutes.`, next_check_at: null };
        }
        return save({ next_check_at: later(now, VIDEO_POLL_SECONDS) });
      }
      case "creating": {
        let creativeId = d.meta_creative_id;
        if (!creativeId) {
          if (spec.format === "single" && media[0]?.kind === "video" && !media[0].thumbnailUrl && !media[0].imageHash) {
            return { status: "error", error: "Meta gave the video no thumbnail; add a cover image to the creative." };
          }
          creativeId = await createCreative(ctx.graph, adAccountId, creativeBody(d.ad_name, spec.format, spec.copy, media, spec.objective));
          return { meta_creative_id: creativeId };
        }
        const adId = await createAd(ctx.graph, adAccountId, adPayload(d.ad_name, d.adset_id, creativeId));
        return { ad_id: adId, status: "draft", next_check_at: null, error: null };
      }
      default:
        return {};
    }
  } catch (error) {
    if (error instanceof UnsafeWriteError) return { status: "error", error: error.message, next_check_at: null };
    const attempts = (d.attempts ?? 0) + 1;
    if (error instanceof GraphError && error.transient && attempts < MAX_ATTEMPTS) {
      return save({ attempts, error: explain(error), next_check_at: later(now, 30 * 2 ** (attempts - 1)) });
    }
    return { status: "error", attempts, error: explain(error), next_check_at: null };
  }
}

/** Drafts the worker should step now: unfinished and due. */
export const due = (drafts: DraftRow[], now = new Date()) =>
  drafts.filter((d) => ["queued", "processing", "creating"].includes(d.status) && (!d.next_check_at || new Date(d.next_check_at) <= now));
