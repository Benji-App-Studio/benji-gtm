// Apify pulls the app stops following (research/index.ts poll and pollAll). Plain TypeScript with its
// effects passed in, so pulls_test.ts runs it against fakes.
//
// - Without an Apify token a running pull can never finish here: it fails at once with what to add,
//   instead of sitting "running" until the give-up time.
// - A pull still running after PULL_GIVE_UP_MS is given up on, and its run is aborted at Apify so it
//   stops charging (each run also starts with Apify's own timeout, plan.ts APIFY_RUN_TIMEOUT_SECS).
import { addKeyMessage } from "../_shared/keys.ts";
import { APIFY_RUN_TIMEOUT_SECS } from "./plan.ts";

/** A pull still running this long is given up on: Apify's own timeout plus an hour of slack. */
export const PULL_GIVE_UP_MS = (APIFY_RUN_TIMEOUT_SECS + 3600) * 1000;

export const NO_APIFY_MESSAGE = `Apify isn't connected, so this scrape can't be collected. ${addKeyMessage("APIFY_TOKEN")}`;
export const gaveUpMessage = (aborted: boolean) =>
  `The scrape didn't finish within ${Math.round(PULL_GIVE_UP_MS / 3_600_000)} hours, so it was ${aborted ? "stopped at Apify" : "given up on (Apify didn't confirm the stop; check console.apify.com)"}.`;

export interface RunningPull { id: string; apify_run_id: string | null; started_at: string | null }

export interface GiveUpDeps {
  /** Whether an Apify token is saved. */
  hasToken: boolean;
  /** Aborts a run at Apify; true when Apify accepted it. Only called with a token. */
  abort(runId: string): Promise<boolean>;
  /** Writes a pull's end (only while it is still running). */
  settle(id: string, patch: Record<string, unknown>): Promise<void>;
  now?: () => number;
}

/** Ends the pulls that can't or won't finish; returns the ones still worth following. */
export async function giveUpPulls<T extends RunningPull>(rows: T[], deps: GiveUpDeps): Promise<T[]> {
  const now = deps.now?.() ?? Date.now();
  const finished = new Date(now).toISOString();
  const keep: T[] = [];
  for (const row of rows) {
    if (!deps.hasToken) {
      await deps.settle(row.id, { status: "error", error: NO_APIFY_MESSAGE, finished_at: finished });
      continue;
    }
    const since = Date.parse(row.started_at ?? "");
    if (Number.isFinite(since) && now - since > PULL_GIVE_UP_MS) {
      const aborted = row.apify_run_id ? await deps.abort(row.apify_run_id) : false;
      await deps.settle(row.id, { status: "error", error: gaveUpMessage(aborted), finished_at: finished });
      continue;
    }
    keep.push(row);
  }
  return keep;
}
