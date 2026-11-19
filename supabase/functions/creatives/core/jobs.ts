// What happens to a creative job after something goes wrong (plain TypeScript, no runtime APIs, so the
// tests load it). `retries` only grows: each busy hand-back and each failed look at a submitted job
// adds one, and at MAX_RETRIES the job fails instead of looping. A job that was submitted (it has an
// external id) is never submitted again, because a second submit would pay again: the API worker polls
// it, and the desktop runner, when it gets such a job back from the queue, only collects it.

/** Busy hand-backs and failed looks at a submitted job, in all. */
export const MAX_RETRIES = 6;
/** A finished job's save (running → finalizing → done) may take this long before it's collected again. */
export const FINALIZE_SECONDS = 5 * 60;

/**
 * How far above the confirmed estimate a job's live price may be before it is refused instead of run:
 * 1.5× the estimate or 2 credits more, whichever is higher (the + 2 keeps 0.5- and 1-credit images
 * from being refused over a rounding step). One rule for both backends: the desktop runner (the CLI's
 * `generate cost` quote, scripts/creative-runner/runner.ts imports this file) and the API worker
 * (Higgsfield's /estimate). The estimates come from the Studio's one price table (lib/creative-plan.ts jobCost).
 */
export const PRICE_TOLERANCE = { factor: 1.5, extraCredits: 2 } as const;

/** The highest live price a job confirmed at `estimate` credits may run at (PRICE_TOLERANCE). */
export function priceLimit(estimate: number, tolerance: { factor: number; extraCredits: number } = PRICE_TOLERANCE): number {
  const e = Math.max(0, Number(estimate) || 0);
  return Math.max(e * tolerance.factor, e + tolerance.extraCredits);
}

export interface JobState { retries: number; external_id: string | null }
export type JobPatch = Record<string, unknown>;

/**
 * A submit (or a local run) that didn't go through: a busy or rate-limited one goes back to the queue
 * after `retryAfterSec` (15 s to 15 min); anything else, or a busy one out of retries, fails.
 */
export function afterSubmitError(job: JobState, message: string, retryable: boolean, retryAfterSec: number, now = Date.now()): JobPatch {
  if (retryable && job.retries < MAX_RETRIES) {
    return {
      status: "queued", runner_id: null, lease_until: null, retries: job.retries + 1, error: message.slice(0, 600),
      not_before: new Date(now + Math.min(900, Math.max(15, retryAfterSec)) * 1000).toISOString(),
    };
  }
  return failed(retryable ? `${message} (gave up after ${MAX_RETRIES} retries)` : message, now);
}

/**
 * Looking at (or collecting) a submitted job went wrong: it stays running with its request, to be
 * looked at again on a later tick; out of retries, it fails (keeping the request, so a person's retry
 * collects the result instead of paying for a new one).
 */
export function afterPollError(job: JobState, message: string, leaseSeconds: number, now = Date.now()): JobPatch {
  if (job.retries >= MAX_RETRIES) return failed(`${message} (gave up after ${MAX_RETRIES} tries to collect the result)`, now);
  return { status: "running", retries: job.retries + 1, error: message.slice(0, 600), lease_until: new Date(now + leaseSeconds * 1000).toISOString() };
}

/**
 * Higgsfield ended the request without a result: the job fails and drops the dead request, so a retry
 * submits afresh. Nothing was charged for it, so the estimate recorded at submit is cleared to 0.
 */
export function afterRequestEnded(status: string, error: string | null | undefined, now = Date.now()): JobPatch {
  const message = status === "nsfw" ? `Higgsfield's moderation rejected it (nsfw${error ? `: ${error}` : ""}). Rephrase the brief.` : `Higgsfield: ${status}${error ? `: ${error}` : ""}`;
  return { ...failed(message, now), external_id: null, cost_credits: 0 };
}

/** A claimed job that was already submitted is polled, never submitted again. */
export const shouldSubmit = (job: JobState) => !job.external_id;

/**
 * How long a busy job waits before it goes back to Higgsfield: 60 s, doubling with each retry it has
 * already had (60, 120, 240, 480 s), at most 15 min.
 */
export function busyBackoff(retries: number, base = 60): number {
  return Math.min(900, base * 2 ** Math.max(0, Math.floor(Number(retries) || 0)));
}

/** The statuses with which Higgsfield ends a job without a result (the CLI's and the API's). */
const ENDED = ["failed", "nsfw", "canceled", "cancelled"];
/** Higgsfield itself ended the job without a result: its own word that the job is over. */
export const providerEnded = (status: string | null | undefined) => ENDED.includes(String(status ?? "").toLowerCase());

/** What the desktop runner reports when a job didn't finish (runner/fail). */
export interface RunnerFailure {
  message: string; retryable: boolean; retryAfterSec: number;
  /** The Higgsfield job(s) it submitted or collected, when it knows them. */
  externalId?: string | null;
  /** Higgsfield's own status for that job, when the runner read it (failed, nsfw, canceled, in_progress…). */
  providerStatus?: string | null;
  /** Higgsfield's reason, as it gave it. */
  providerReason?: string | null;
  /** What Higgsfield reported charging for the ended job, when it said. */
  chargedCredits?: number | null;
}

/**
 * The desktop runner's failure report. When Higgsfield itself ended the job (failed, nsfw, canceled), the job
 * fails with Higgsfield's status and reason, and drops the dead request so a retry submits afresh; it's
 * recorded as not charged (0) unless Higgsfield reported a charge. Otherwise a retryable failure goes
 * back to the queue keeping its submitted request (the runner's next claim collects it, never submits it
 * again; a request the runner names is saved when the job had none), and anything else fails, keeping
 * the request too, so a person's retry collects the result instead of paying for a new one.
 */
export function afterRunnerFailure(job: JobState, report: RunnerFailure, now = Date.now()): JobPatch {
  if (providerEnded(report.providerStatus)) {
    const charged = Number(report.chargedCredits);
    const ended = afterRequestEnded(String(report.providerStatus).toLowerCase(), report.providerReason || report.message, now);
    return { ...ended, cost_credits: report.chargedCredits != null && Number.isFinite(charged) && charged > 0 ? charged : 0 };
  }
  const patch = afterSubmitError(job, report.message, report.retryable, report.retryAfterSec, now);
  const named = String(report.externalId ?? "").trim().slice(0, 200);
  return !job.external_id && named ? { ...patch, external_id: named } : patch;
}

function failed(message: string, now: number): JobPatch {
  return { status: "failed", lease_until: null, finished_at: new Date(now).toISOString(), error: message.slice(0, 600) };
}

// MARK: Providers

/** Who makes an image job: Higgsfield (the default, and every job planned before there was a choice) or OpenAI. */
export type ImageProvider = "higgsfield" | "openai";
export const jobProvider = (params: Record<string, unknown> | null | undefined): ImageProvider => (params?.provider === "openai" ? "openai" : "higgsfield");

/**
 * An OpenAI request that didn't make an image. A safety block or any other refusal fails the job and
 * drops its request marker, so a person's retry sends it afresh; a rate limit or overload (nothing ran)
 * goes back to the queue for OpenAI again. Never onto Higgsfield: switching is the person's choice.
 */
export function afterOpenAiFailure(job: JobState, outcome: { retryable: boolean; message: string }, now = Date.now()): JobPatch {
  if (outcome.retryable) return { ...afterSubmitError(job, outcome.message, true, 60, now), external_id: null };
  return { ...failed(outcome.message, now), external_id: null, cost_credits: 0 };
}
