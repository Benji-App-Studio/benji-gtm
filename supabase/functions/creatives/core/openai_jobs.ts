// One OpenAI image job, one step at a time, so no run of the function has to outlast the Supabase
// plan's time limit and a request OpenAI accepted is never lost or sent twice.
//
// A fresh job is either awaited (one request to the Images API, as always, when its expected time
// fits what is left of this run with a margin) or handed over (a background request, whose id is kept
// on the job as `external_id`; a later tick collects the image, the way the Higgsfield API path
// collects its jobs). A job that already carries a request is only ever collected, never sent again.
// When OpenAI won't take the hand-over, or handing over is switched off, a job that doesn't fit is not
// started: it fails with DOES_NOT_FIT, and nothing is spent.
//
// Plain TypeScript: the database, storage and network are passed in (OpenAiJobDeps), so the tests run
// whole ticks against fakes.
import { type InstallLimits, withinWallClock } from "../../_shared/limits.ts";
import { afterOpenAiFailure, afterPollError, type JobPatch, type JobState } from "./jobs.ts";
import {
  cancelOpenAiBackground, collectOpenAiBackground, expectedSeconds, generateOpenAiImage, INTERRUPTED_MESSAGE, OPENAI_BACKGROUND, OPENAI_IMAGE_MODELS, OPENAI_QUALITIES,
  OPENAI_WAIT_MS, openAiBackgroundRequest, type OpenAiImageParams, openAiImageParams, openAiImageRequest, type OpenAiQuality, openAiSize, submitOpenAiBackground,
} from "./openai_images.ts";

/** Stored on a job that would run past the plan's time limit and can't be handed over. */
export const DOES_NOT_FIT = "This quality takes longer than your Supabase plan allows in one run. Use a lower quality, or upgrade the Supabase plan.";

/** An expected time is trusted only with this much room on top: the estimate is OpenAI's rule of thumb, not a promise. */
export const WAIT_MARGIN = 1.25;
/** A background request still not finished after this long is stopped (OpenAI documents minutes, not hours). */
export const BACKGROUND_GIVE_UP_MS = 30 * 60_000;
/** Time allowed for loading reference images before a request is sent, when planning ahead (the health answer). */
const REFERENCES_MS = 10_000;

/**
 * When a job is handed over to be collected later:
 *   "slow"   only when its expected time doesn't fit one run (the default);
 *   "always" every job, on any plan;
 *   "never"  no job: one that doesn't fit is refused with DOES_NOT_FIT.
 * (OPENAI_IMAGE_COLLECT on the creatives function.)
 */
export type CollectSetting = "slow" | "always" | "never";
export const collectSetting = (value: unknown): CollectSetting => (value === "always" || value === "never" ? value : "slow");

export type ImageMode = "wait" | "collect" | "refuse";

/**
 * How a request expected to take `expectedSec` is run when `usedMs` of this invocation has gone by.
 * A plan with room for the longest wait (OPENAI_WAIT_MS, 280 s: a 400 s wall clock) awaits every job,
 * exactly as before. On a shorter one a job is awaited only when its expected time, with WAIT_MARGIN,
 * fits what is left; `timeoutMs` is how long that wait may last.
 */
export function imageMode(o: { expectedSec: number; limits: Pick<InstallLimits, "wallClockSec">; usedMs: number; collect: CollectSetting }): { mode: ImageMode; timeoutMs: number } {
  const room = withinWallClock(o.limits, OPENAI_WAIT_MS, o.usedMs);
  if (o.collect === "always") return { mode: "collect", timeoutMs: room };
  if (room >= OPENAI_WAIT_MS) return { mode: "wait", timeoutMs: OPENAI_WAIT_MS };
  if (o.expectedSec * 1000 * WAIT_MARGIN <= room) return { mode: "wait", timeoutMs: room };
  return { mode: o.collect === "never" ? "refuse" : "collect", timeoutMs: room };
}

export interface ImagePlan {
  /** The plan's time limit for one run of a function, in seconds. */
  wallClockSec: number;
  /** The longest an image request is awaited inside one run. */
  oneRunSec: number;
  collect: CollectSetting;
  /**
   * For each resolution's largest (square) image and each quality: the expected seconds, and how it is
   * made: "wait" (in one run), "collect" (handed to OpenAI and collected by a later run: a minute or
   * more longer) or "refuse" (not started on this plan).
   */
  qualities: Record<string, Record<OpenAiQuality, { seconds: number; mode: ImageMode }>>;
  /** The qualities made in one run at every resolution: the ones that need no warning. */
  fits: OpenAiQuality[];
}

/** What this plan does with each image quality, for the app to show before a person spends. */
export function imagePlan(limits: Pick<InstallLimits, "wallClockSec">, collect: CollectSetting = "slow"): ImagePlan {
  const qualities: ImagePlan["qualities"] = {};
  for (const resolution of ["1k", "2k", "4k"]) {
    const { size } = openAiSize("1:1", resolution);
    qualities[resolution] = Object.fromEntries(OPENAI_QUALITIES.map((quality) => {
      const seconds = expectedSeconds(size, quality);
      return [quality, { seconds, mode: imageMode({ expectedSec: seconds, limits, usedMs: REFERENCES_MS, collect }).mode }];
    })) as Record<OpenAiQuality, { seconds: number; mode: ImageMode }>;
  }
  return {
    wallClockSec: limits.wallClockSec,
    oneRunSec: Math.round(withinWallClock(limits, OPENAI_WAIT_MS, REFERENCES_MS) / 1000),
    collect, qualities,
    fits: OPENAI_QUALITIES.filter((quality) => Object.values(qualities).every((byQuality) => byQuality[quality].mode === "wait")),
  };
}

export interface ImageJob extends JobState {
  id: string;
  prompt: string;
  params: Record<string, unknown>;
  aspect: string;
  /** When the job was first taken; a background request is given up on BACKGROUND_GIVE_UP_MS after it. */
  started_at?: string | null;
}

export interface ReferenceImage { bytes: Uint8Array; mime: string; name: string }

/** What a finished job records: the request it came from, what it cost when OpenAI said, and the settings used. */
export type ImageDone = { external_id: string; cost_credits: number; params: Record<string, unknown> };

export interface OpenAiJobDeps {
  apiKey: string;
  fetchImpl?: typeof fetch;
  limits: Pick<InstallLimits, "wallClockSec">;
  collect: CollectSetting;
  /** Milliseconds since this run of the function began. */
  usedMs(): number;
  now?(): number;
  /** The text model that carries a background request, and the image models Settings choose. */
  textModel: string;
  imageModels: { image: string; imageEdit: string };
  /** How long a job waiting at OpenAI stays this worker's before the queue takes it back. */
  leaseSeconds: number;
  /** The job's reference images, in the prompt's order. Throws (with what to tell the person) when one can't be loaded. */
  references(): Promise<ReferenceImage[]>;
  /** Writes to the job while this worker still holds it. False when it was cancelled or taken by another. */
  hold(patch: JobPatch): Promise<boolean>;
  /** Writes to the job after a save that failed part-way (it may be held or half-saved). */
  release(patch: JobPatch): Promise<void>;
  /** True when the job's image is already saved (a worker stopped right after saving). */
  alreadySaved(): Promise<boolean>;
  /** Saves the images as the job's result and marks it done. False when another run is already saving it. Throws when storing fails. */
  save(images: Uint8Array[], done: ImageDone | null): Promise<boolean>;
}

/** What one step did: the image was saved; the request is at OpenAI; nothing more to do for now; the job ended or went back to the queue. */
export type JobStep = "made" | "submitted" | "pending" | "failed" | "requeued" | "gone";

/** The job's settings, with the image models Settings > Models choose in place of the two defaults. */
export function jobImageParams(job: Pick<ImageJob, "params" | "aspect">, imageModels: { image: string; imageEdit: string }): OpenAiImageParams {
  const params = openAiImageParams(job.params, job.aspect);
  if (params.model === OPENAI_IMAGE_MODELS.flare) params.model = imageModels.image;
  else if (params.model === OPENAI_IMAGE_MODELS.sunburst) params.model = imageModels.imageEdit;
  return params;
}

const record = (job: ImageJob, params: OpenAiImageParams, costUsd: number | null, via: "images" | "responses") =>
  ({ ...job.params, cost_usd: costUsd, openai: { ...(job.params.openai as Record<string, unknown> ?? {}), ...params, via } });

/** Takes an OpenAI image job one step further. Never throws. */
export async function advanceOpenAiJob(job: ImageJob, deps: OpenAiJobDeps): Promise<JobStep> {
  try {
    if (job.external_id?.startsWith(OPENAI_BACKGROUND)) return await collect(job, job.external_id.slice(OPENAI_BACKGROUND.length), deps);
    // Taken again after an awaited request was cut off (the worker stopped mid-call): its result is gone,
    // and sending it again could pay twice, so it fails and waits for a person's retry...
    if (job.external_id) {
      // ...unless its image was already saved (the worker stopped right after that): then it's simply finished.
      if (await deps.alreadySaved()) return (await deps.save([], null).catch(() => false)) ? "made" : "pending";
      return (await deps.hold(afterOpenAiFailure(job, { retryable: false, message: INTERRUPTED_MESSAGE }))) ? "failed" : "gone";
    }
    return await start(job, deps);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 400);
    // Nothing is at OpenAI for a fresh job that threw before its request; a job with a request keeps it.
    if (job.external_id?.startsWith(OPENAI_BACKGROUND)) { await deps.release(afterPollError(job, message, deps.leaseSeconds)).catch(() => {}); return "pending"; }
    await deps.hold(afterOpenAiFailure(job, { retryable: false, message })).catch(() => false);
    return "failed";
  }
}

async function start(job: ImageJob, deps: OpenAiJobDeps): Promise<JobStep> {
  const fail = async (outcome: { retryable: boolean; message: string }): Promise<JobStep> => {
    const patch = afterOpenAiFailure(job, outcome);
    return (await deps.hold(patch)) ? (patch.status === "queued" ? "requeued" : "failed") : "gone";
  };
  const params = jobImageParams(job, deps.imageModels);
  // The reference images, as files, in the order the prompt numbers them. One that can't be loaded ends the job before anything is sent.
  const images = await deps.references();
  const plan = imageMode({ expectedSec: expectedSeconds(params.size, params.quality), limits: deps.limits, usedMs: deps.usedMs(), collect: deps.collect });
  // Not started: nothing was sent, nothing is charged, and the message says what to change.
  if (plan.mode === "refuse") return fail({ retryable: false, message: DOES_NOT_FIT });

  // Marked as sent before the call: if this worker dies mid-request, the job is never sent again on its own.
  const marker = `openai:${crypto.randomUUID()}`;
  if (!(await deps.hold({ external_id: marker }))) return "gone";

  if (plan.mode === "wait") {
    const outcome = await generateOpenAiImage(deps.apiKey, openAiImageRequest(job.prompt, params, images), { fetchImpl: deps.fetchImpl, timeoutMs: plan.timeoutMs });
    if (!outcome.ok) return fail(outcome);
    try {
      const saved = await deps.save(outcome.images, { cost_credits: 0, external_id: (outcome.requestId ?? marker).slice(0, 200), params: record(job, params, outcome.costUsd, "images") });
      return saved ? "made" : "pending";
    } catch (error) {
      // The image exists only in this run's memory: it can't be collected again.
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      await deps.release({ ...afterOpenAiFailure(job, { retryable: false, message: `OpenAI made the image but it couldn't be saved (${message}). Retry to make it again.` }), params: { ...job.params, cost_usd: outcome.costUsd } });
      return "failed";
    }
  }

  const submitted = await submitOpenAiBackground(deps.apiKey, openAiBackgroundRequest(deps.textModel, job.prompt, params, images), { fetchImpl: deps.fetchImpl, timeoutMs: Math.min(60_000, plan.timeoutMs) });
  if (!submitted.ok) {
    // OpenAI won't take the hand-over (nothing started): this job can't be made on this plan at this quality.
    if (submitted.unsupported) return fail({ retryable: false, message: `${DOES_NOT_FIT} (OpenAI didn't accept handing it over: ${submitted.message})` });
    return fail(submitted);
  }
  // From here the job carries its request: every later look only collects it.
  const lease = new Date((deps.now?.() ?? Date.now()) + deps.leaseSeconds * 1000).toISOString();
  if (await deps.hold({ external_id: `${OPENAI_BACKGROUND}${submitted.id}`.slice(0, 200), lease_until: lease, error: null, params: record(job, params, null, "responses") })) return "submitted";
  // Cancelled or taken away while it was being handed over: nobody will collect it, so stop it.
  await cancelOpenAiBackground(deps.apiKey, submitted.id, { fetchImpl: deps.fetchImpl });
  return "gone";
}

async function collect(job: ImageJob, id: string, deps: OpenAiJobDeps): Promise<JobStep> {
  const now = deps.now?.() ?? Date.now();
  const answer = await collectOpenAiBackground(deps.apiKey, id, { fetchImpl: deps.fetchImpl, timeoutMs: withinWallClock(deps.limits, 60_000, deps.usedMs()) });
  if (answer.state === "pending") {
    const since = Date.parse(job.started_at ?? "");
    if (Number.isFinite(since) && now - since > BACKGROUND_GIVE_UP_MS) {
      await cancelOpenAiBackground(deps.apiKey, id, { fetchImpl: deps.fetchImpl });
      return (await deps.hold(afterOpenAiFailure(job, { retryable: false, message: "OpenAI hadn't finished the image after 30 minutes, so the request was stopped. Retry to make it again." }))) ? "failed" : "gone";
    }
    return (await deps.hold({ lease_until: new Date(now + deps.leaseSeconds * 1000).toISOString() })) ? "pending" : "gone";
  }
  if (answer.state === "error") {
    // The request is still OpenAI's: look again on a later tick, never send it again.
    const patch = afterPollError(job, answer.message, deps.leaseSeconds, now);
    return (await deps.hold(patch)) ? (patch.status === "failed" ? "failed" : "pending") : "gone";
  }
  if (answer.state === "failed") return (await deps.hold(afterOpenAiFailure(job, { retryable: false, message: answer.message }))) ? "failed" : "gone";
  try {
    const saved = await deps.save(answer.images, { cost_credits: 0, external_id: answer.requestId.slice(0, 200), params: job.params });
    return saved ? "made" : "pending";
  } catch (error) {
    // OpenAI still has the image: it is collected again on a later tick.
    await deps.release(afterPollError(job, `The image is ready but couldn't be saved (${(error instanceof Error ? error.message : String(error)).slice(0, 200)}); trying again.`, deps.leaseSeconds, now));
    return "pending";
  }
}
