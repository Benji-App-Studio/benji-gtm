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
  /** What a pull without a token fails with (default NO_APIFY_MESSAGE). */
  noTokenMessage?: string;
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
      await deps.settle(row.id, { status: "error", error: deps.noTokenMessage ?? NO_APIFY_MESSAGE, finished_at: finished });
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

/**
 * Accounts mode: a pull was started with one kind of token (ad_pulls.key_source) and that token is no
 * longer there (the account removed its key, or a staff account lost staff), so it fails instead of
 * being polled with someone else's.
 */
export const KEY_GONE_MESSAGE = "The Apify token this scrape was started with is no longer saved, so the result can't be collected. Pull again to start a new one.";

/** Running pulls the watchdog reads in one run, and how many of one account's it follows in that run. */
export const PULLS_PER_TICK = 200;
export const PULLS_PER_USER = 10;

export type PullKeySource = "account" | "platform" | null;
export interface KeyedPull extends RunningPull { user_id: string; product_id: string; key_source?: PullKeySource }

/** One account's pulls that are polled with the same kind of token, by workspace (product). */
export interface PullGroup<T> { userId: string; keySource: PullKeySource; products: Map<string, T[]> }

/**
 * Groups running pulls by account, then by the kind of token they were started with, then by
 * workspace, in the order given (oldest first), taking at most `perUser` of one account's pulls so one
 * busy account never holds up the others. The rest wait for the next run.
 */
export function groupPulls<T extends KeyedPull>(rows: T[], perUser = PULLS_PER_USER): PullGroup<T>[] {
  const groups = new Map<string, PullGroup<T>>();
  const taken = new Map<string, number>();
  for (const row of rows) {
    const count = taken.get(row.user_id) ?? 0;
    if (count >= perUser) continue;
    taken.set(row.user_id, count + 1);
    const source: PullKeySource = row.key_source === "account" || row.key_source === "platform" ? row.key_source : null;
    const id = `${row.user_id}|${source ?? ""}`;
    let group = groups.get(id);
    if (!group) { group = { userId: row.user_id, keySource: source, products: new Map() }; groups.set(id, group); }
    group.products.set(row.product_id, [...(group.products.get(row.product_id) ?? []), row]);
  }
  return [...groups.values()];
}
