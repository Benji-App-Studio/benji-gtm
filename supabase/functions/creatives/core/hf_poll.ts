// One look at a submitted Higgsfield API job (the API worker's poll, creatives/index.ts higgsfieldTick).
// Plain TypeScript with its effects passed in, so hf_poll_test.ts runs it against fakes.
//
// A job still queued or in progress is given a fresh lease, unless it has run past its limit
// (core/jobs.ts HIGGSFIELD_MAX_SECONDS): then it is cancelled at Higgsfield, failed with a plain message,
// recorded as not charged, and never polled again. A finished one is collected; one Higgsfield ended
// without a result fails; a failed look is tried again later (and, out of retries, fails).
import { type ApiResult, isTerminal, outputUrls } from "./hf_api.ts";
import { afterOverdue, afterRequestEnded, higgsfieldOverdue, type JobPatch } from "./jobs.ts";

export interface PollJob {
  id: string; kind: string; model: string; external_id: string | null; started_at?: string | null;
}

export interface PollDeps {
  status(requestId: string): Promise<ApiResult>;
  cancel(requestId: string, cancelUrl?: string | null): Promise<boolean>;
  /** Writes a patch to the job while it is still running (a no-op once it was cancelled or finished elsewhere). */
  update(patch: JobPatch): Promise<void>;
  /** Saves the finished job's files (it guards against saving twice). */
  collect(urls: string[]): Promise<void>;
  /** A failed look: try again on a later tick (afterPollError). */
  pollLater(message: string): Promise<void>;
  leaseSeconds: number;
  now?: () => number;
}

export type PollOutcome = "skipped" | "waiting" | "overdue" | "ended" | "collected" | "retry";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 400);

export async function pollHiggsfieldJob(job: PollJob, deps: PollDeps): Promise<PollOutcome> {
  if (!job.external_id) return "skipped";
  const now = deps.now?.() ?? Date.now();
  let result: ApiResult;
  try {
    result = await deps.status(job.external_id);
  } catch (error) {
    // Even an unreadable status can't keep a job alive past its limit.
    if (higgsfieldOverdue(job, now)) return await stop(job, null, deps, now);
    await deps.pollLater(errorText(error));
    return "retry";
  }
  if (!isTerminal(result.status)) {
    if (higgsfieldOverdue(job, now)) return await stop(job, result.cancel_url ?? null, deps, now);
    await deps.update({ lease_until: new Date(now + deps.leaseSeconds * 1000).toISOString() });
    return "waiting";
  }
  if (result.status !== "completed") {
    await deps.update(afterRequestEnded(result.status, result.error, now));
    return "ended";
  }
  try {
    await deps.collect(outputUrls(result));
    return "collected";
  } catch (error) {
    await deps.pollLater(errorText(error));
    return "retry";
  }
}

async function stop(job: PollJob, cancelUrl: string | null, deps: PollDeps, now: number): Promise<PollOutcome> {
  const cancelled = await deps.cancel(job.external_id!, cancelUrl);
  await deps.update(afterOverdue(job, cancelled, now));
  return "overdue";
}
