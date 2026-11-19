// What this install's Supabase plan allows, and the numbers the functions derive from it.
//
// `install.settings.limits` holds three numbers the owner can change in Settings:
//   wallClockSec    how long one function invocation may run (150 on Supabase's free plan, 400 on paid)
//   uploadLimitMb   the largest file storage accepts (50 on the free plan)
//   storageQuotaGb  how much storage the plan includes (1 on the free plan)
// An install that has been through setup starts from the free plan's numbers (DEFAULT_LIMITS). An
// install with NO install row (from before setup existed) keeps the numbers the code always used
// (LEGACY_LIMITS), so nothing about it changes. An environment variable wins over both.
// Pure: no database, no environment, no imports.

export interface InstallLimits { wallClockSec: number; uploadLimitMb: number; storageQuotaGb: number }

/** An install with an install row and nothing set: Supabase's free plan. */
export const DEFAULT_LIMITS: InstallLimits = { wallClockSec: 150, uploadLimitMb: 50, storageQuotaGb: 1 };
/** No install row: the paid-plan numbers the functions were written with. */
export const LEGACY_LIMITS: InstallLimits = { wallClockSec: 400, uploadLimitMb: 300, storageQuotaGb: 100 };

/** The environment variables that override a limit. The two RESEARCH_ ones are older than the settings. */
export const LIMIT_ENV = {
  wallClockSec: "FUNCTION_WALL_CLOCK_SEC",
  uploadLimitMb: "RESEARCH_MEDIA_UPLOAD_LIMIT_MB",
  storageQuotaGb: "RESEARCH_STORAGE_QUOTA_GB",
} as const;

export type LimitEnv = ((name: string) => string | undefined) | Record<string, string | undefined | null>;

const FIELDS = ["wallClockSec", "uploadLimitMb", "storageQuotaGb"] as const;
const positive = (value: unknown): number | undefined => {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * The limits in force. `install` is the install row (`auth.install()`), null or undefined when there
 * is none. For each limit: the environment variable, else the row's setting, else the default for an
 * install with a row; with no row, the environment variable or the legacy number.
 */
export function resolveLimits(install: { settings?: unknown } | null | undefined, env: LimitEnv = {}): InstallLimits {
  const read = (name: string) => positive(typeof env === "function" ? env(name) : env[name]);
  const settings = install?.settings;
  const stored = (settings && typeof settings === "object" ? (settings as Record<string, unknown>).limits : undefined);
  const set = (stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {}) as Record<string, unknown>;
  const base = install ? DEFAULT_LIMITS : LEGACY_LIMITS;
  const out = { ...base };
  for (const field of FIELDS) out[field] = read(LIMIT_ENV[field]) ?? (install ? positive(set[field]) : undefined) ?? base[field];
  return out;
}

/** The shortest wall clock the timings are worked out for: below this nothing useful fits in a run. */
export const MIN_WALL_CLOCK_SEC = 60;

/**
 * A media worker's clock, as shares of the wall clock (at 400 s these are the numbers it always had:
 * 50 s, 300 s, 60 s and 420 s).
 *   claimMs       it takes new files for the first eighth of its run;
 *   streamMs      a video's whole download and upload gets three quarters, so a file claimed at the
 *                 last moment still ends an eighth before the platform stops the function;
 *   fetchMs       an image's whole download: a minute, or the video's time when that is shorter;
 *   leaseSeconds  a claim holds a little longer than the wall clock: by then its worker is gone for
 *                 certain, so no other worker takes a file that is still uploading.
 */
export function mediaTimings(limits: Pick<InstallLimits, "wallClockSec">): { claimMs: number; streamMs: number; fetchMs: number; leaseSeconds: number } {
  const wall = Math.max(MIN_WALL_CLOCK_SEC, limits.wallClockSec);
  const streamMs = Math.round(wall * 750);
  return { claimMs: Math.round(wall * 125), streamMs, fetchMs: Math.min(60_000, streamMs), leaseSeconds: Math.ceil(wall * 1.05) };
}

/** The reserve kept after a long request, to write down how it ended before the function is stopped. */
export const WALL_CLOCK_RESERVE_MS = 20_000;

/**
 * How long one request may take: what it wants, cut so it ends `reserveMs` before the wall clock.
 * `usedMs` is how much of the invocation has gone by already.
 */
export function withinWallClock(limits: Pick<InstallLimits, "wallClockSec">, wantedMs: number, usedMs = 0, reserveMs = WALL_CLOCK_RESERVE_MS): number {
  const room = Math.max(MIN_WALL_CLOCK_SEC, limits.wallClockSec) * 1000 - reserveMs - Math.max(0, usedMs);
  return Math.max(5_000, Math.min(wantedMs, room));
}

/** How long a worker keeps starting new pieces of work: what it always did, or half the wall clock when that is shorter. */
export const workWindowMs = (limits: Pick<InstallLimits, "wallClockSec">, wantedMs: number) => Math.min(wantedMs, Math.max(MIN_WALL_CLOCK_SEC, limits.wallClockSec) * 500);

/** The largest file stored: the plan's upload limit, never more than the bucket's own (`bucketMaxBytes`). */
export const uploadMaxBytes = (limits: Pick<InstallLimits, "uploadLimitMb">, bucketMaxBytes = Infinity) => Math.min(limits.uploadLimitMb * 1024 * 1024, bucketMaxBytes);

/** The plan's storage in bytes (decimal gigabytes, as Supabase counts them). */
export const storageQuotaBytes = (limits: Pick<InstallLimits, "storageQuotaGb">) => limits.storageQuotaGb * 1e9;

const megabytes = (bytes: number) => { const mb = bytes / (1024 * 1024); return Number.isInteger(mb) ? String(mb) : mb.toFixed(1); };

/** The note stored on a file that is over the upload limit: it is left out, with the reason, and not tried again. */
export const tooBigNote = (maxBytes: number) => `Over the ${megabytes(maxBytes)} MB upload limit: not stored (the ad and its poster are).`;
