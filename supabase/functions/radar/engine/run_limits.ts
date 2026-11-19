// The limits each radar scrape is started with (apify.ts RunLimits): a timeout a little past the time
// the worker gives up on it (so Apify ends the run even if the worker is gone), and a charge cap from
// the same per-post prices as the estimate shown before a run (collectors.ts POST_PRICE, the studio's
// lib/server/analysis.ts), for the most posts the scrape's input asks for. Pure: the tests load it.
import { chargeCap, type RunLimits } from "./apify.ts";
import { POST_PRICE } from "./collectors.ts";
import type { Platform } from "./types.ts";

/** The worker stops waiting for a running scrape after this long (radar/index.ts aborts it then). */
export const RUN_LIMIT_MS = 25 * 60_000;
/** Apify's own timeout: the worker's limit plus five minutes. */
export const SCRAPE_TIMEOUT_SECS = RUN_LIMIT_MS / 1000 + 5 * 60;
/** No scrape is capped below this (Apify's start fees and small runs fit well under it). */
export const SCRAPE_CHARGE_FLOOR_USD = 0.5;
/** Posts assumed when an input names no count. */
const DEFAULT_ITEMS = 100;

const PER_TARGET = ["resultsLimit", "resultsPerPage", "maxResultsShorts", "maxPosts", "commentsPerPost", "maxComments", "searchLimit"] as const;
const TARGET_LISTS = ["username", "usernames", "profiles", "searchQueries", "hashtags", "channels", "targetUrls", "directUrls", "postURLs", "startUrls", "twitterHandles"] as const;

/** The most items a scrape's input asks for: a per-target count times its targets, or `maxItems`. */
export function scrapeItems(input: unknown): number {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const per = PER_TARGET.map((k) => Number(o[k])).find((n) => Number.isFinite(n) && n > 0);
  const targets = TARGET_LISTS.reduce((n, k) => n + (Array.isArray(o[k]) ? (o[k] as unknown[]).length : 0), 0);
  const max = Number(o.maxItems);
  if (per) return per * Math.max(1, targets);
  if (Number.isFinite(max) && max > 0) return max;
  return DEFAULT_ITEMS;
}

/** The limits to start a scrape with. The price per post is its platform's, or the dearest when unknown. */
export function scrapeLimits(task: { input: unknown; platform?: Platform | null }): RunLimits {
  const prices = Object.values(POST_PRICE);
  const price = task.platform && task.platform in POST_PRICE ? POST_PRICE[task.platform] : Math.max(...prices);
  return { timeoutSecs: SCRAPE_TIMEOUT_SECS, maxTotalChargeUsd: chargeCap(scrapeItems(task.input) * price, SCRAPE_CHARGE_FLOOR_USD) };
}
