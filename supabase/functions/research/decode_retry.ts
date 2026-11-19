// How often reading an ad (decode) is tried, and what a failure leaves on the ad (paid_ads.decode_attempts,
// decode_error, decode_retry_at: migration 20261119180000). Pure: decode_retry_test.ts loads it.
//
// A claim counts as a try (so an ad that stopped the worker counts too). A failed try waits before the
// next: 15 minutes, then an hour; after DECODE_MAX_ATTEMPTS tries the ad is left unread with its last
// error, and the page says "Couldn't read this ad: …" (the person's "Read again" still works). A refused
// AI key is not the ad's fault: the try is given back, and the run stops.

export const DECODE_MAX_ATTEMPTS = 3;
/** The wait after the 1st and 2nd failed try. */
export const DECODE_BACKOFF_MS = [15 * 60_000, 60 * 60_000] as const;

/** Whether an ad may be tried again by the background reader. */
export const mayRetry = (attempts: number | null | undefined) => (Number(attempts) || 0) < DECODE_MAX_ATTEMPTS;

/** What a claim writes: the claim time and one more try. */
export function claimPatch(attempts: number | null | undefined, now = Date.now()) {
  return { decoded_at: new Date(now).toISOString(), decode_attempts: (Number(attempts) || 0) + 1 };
}

/**
 * What a failed try writes. `attempts` is the count after the claim. Out of tries, no retry time is
 * set: the ad is no longer claimed by the background reader at all (mayRetry).
 */
export function failurePatch(attempts: number, message: string, now = Date.now()) {
  const wait = attempts < DECODE_MAX_ATTEMPTS ? DECODE_BACKOFF_MS[Math.min(attempts, DECODE_BACKOFF_MS.length) - 1] ?? DECODE_BACKOFF_MS.at(-1)! : null;
  return {
    decode_error: message.replace(/\s+/g, " ").trim().slice(0, 300) || "The AI couldn't read it.",
    decode_retry_at: wait === null ? null : new Date(now + wait).toISOString(),
  };
}

/** A refused key: the try is given back, the ad keeps the message until the key works, and it waits a while. */
export function refusedKeyPatch(attempts: number, message: string, now = Date.now()) {
  return { decode_attempts: Math.max(0, attempts - 1), decode_error: message.slice(0, 300), decode_retry_at: new Date(now + DECODE_BACKOFF_MS[0]).toISOString() };
}

/** A successful read clears the failure record. */
export const successPatch = () => ({ decode_error: null, decode_retry_at: null, decode_attempts: 0 });

/** The sentence the page shows for an ad that is out of tries. */
export const couldNotRead = (error: string | null | undefined) => `Couldn't read this ad: ${error || "the AI failed on it."}`;

export interface DecodeRow { id: string; decode_attempts?: number | null }

export interface LaneDeps<R extends DecodeRow> {
  lanes: number;
  /** How long the run keeps claiming ads. */
  runMs: number;
  /** Claims the next ad (claimPatch written), or null when none is free. */
  claim(): Promise<R | null>;
  /** Reads one ad and saves it (successPatch with it). */
  read(row: R): Promise<void>;
  /** Writes a failure's patch to the ad. */
  record(row: R, patch: Record<string, unknown>): Promise<void>;
  /** Whether an error means the AI key itself is refused (_shared/ai/judge.ts accountError). */
  refused(error: unknown): string | null;
  now?: () => number;
  /** The pause after a failed try, so a rate limit isn't hit harder. */
  pause?: () => Promise<void>;
}

/**
 * The lanes of one background run: each claims an ad and reads it until the run's time is up. A failed
 * read is recorded (failurePatch); a refused key stops every lane (refusedKeyPatch) and is answered, so
 * the run ends instead of burning every ad's tries on a dead key. Answers whether ads may be left.
 */
export async function drainLanes<R extends DecodeRow>(deps: LaneDeps<R>): Promise<{ left: boolean; refused: string | null }> {
  const now = deps.now ?? Date.now;
  const started = now();
  let left = true;
  let refused: string | null = null;
  const lane = async () => {
    while (!refused && now() - started < deps.runMs) {
      const row = await deps.claim();
      if (!row) { left = false; return; }
      const attempts = Number(row.decode_attempts) || 0;
      try {
        await deps.read(row);
      } catch (error) {
        const key = deps.refused(error);
        if (key) {
          refused ??= key;
          await deps.record(row, refusedKeyPatch(attempts, key, now()));
          return;
        }
        await deps.record(row, failurePatch(attempts, error instanceof Error ? error.message : String(error), now()));
        await (deps.pause?.() ?? new Promise((resolve) => setTimeout(resolve, 2000)));
      }
    }
  };
  await Promise.all(Array.from({ length: deps.lanes }, lane));
  return { left: left && !refused, refused };
}
