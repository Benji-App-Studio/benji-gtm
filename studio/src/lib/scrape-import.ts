// A scraper file's import, in batches. The research function saves a few hundred ads per request, so a
// file of thousands (some advertisers run 8,000–9,000 ads) goes up one batch after another with a shared
// import id. Per file, not per batch: the first batch adds the watchlist entry, and only the last one,
// which carries every Library ID in the file, marks the Page's missing ads as stopped. No React or
// server code here, so it runs in a test with a fake `send`.
import { LOCAL_MAX_ADS, slimAd, type LocalScrape } from "./research";

/** Ads per request at most. */
export const IMPORT_BATCH_ADS = 400;
/**
 * Bytes of one request's ads at most (UTF-8 JSON, 4 MB). A slimmed ad is ~9 KB, so a batch is usually the
 * full 400 ads, ~3.5 MB or ~0.5 MB gzipped: under Vercel's 4.5 MB body cap even unzipped, far under the
 * route's 10 MB, and a few seconds of the research function's time. Ads with long texts make a batch smaller.
 */
export const IMPORT_BATCH_BYTES = 4_000_000;
/** The pause before a failed batch's one retry. */
export const IMPORT_RETRY_MS = 2_000;

/** The keys the research function reads an ad's Library ID from, in its order (fromMetaLibrary). */
const ID_KEYS = ["adArchiveID", "ad_archive_id", "adArchiveId", "adid", "id"];
const idIn = (from: unknown): string => {
  if (!from || typeof from !== "object") return "";
  const value = ID_KEYS.map((k) => (from as Record<string, unknown>)[k]).find((v) => v != null && v !== "");
  return (typeof value === "string" ? value : typeof value === "number" ? String(value) : "").trim();
};

/** The Library ID the research function saves an ad under: raw's archive id, else the scraper's library_id. */
export function scrapeAdId(ad: Record<string, unknown>): string {
  return idIn(ad.raw) || idIn({ ad_archive_id: ad.library_id });
}

export interface ImportPlan {
  /** The file without its ads: every batch carries it. */
  header: Omit<LocalScrape, "ads">;
  /** The slimmed ads, in the file's order (Meta's impressions order), cut into batches. */
  batches: Record<string, unknown>[][];
  /** Every Library ID among the imported ads, once (the last batch sends them for "stopped"). */
  ids: string[];
  /** Ads that go up, and ads in the file (more when it's over LOCAL_MAX_ADS). */
  ads: number;
  inFile: number;
  truncated: boolean;
}

/** A string's length in UTF-8 bytes, without encoding it. */
function utf8Bytes(text: string): number {
  let bytes = text.length;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) continue;
    // 2 bytes below U+0800, else 3; a surrogate pair (2 units) is 4.
    bytes += code < 0x800 || (code >= 0xd800 && code <= 0xdfff) ? 1 : 2;
  }
  return bytes;
}

/** Slims the file's ads and cuts them into batches of at most `ads` ads and `bytes` of JSON. */
export function planImport(file: LocalScrape, limits: { ads?: number; bytes?: number; max?: number } = {}): ImportPlan {
  const { ads: perBatch = IMPORT_BATCH_ADS, bytes: maxBytes = IMPORT_BATCH_BYTES, max = LOCAL_MAX_ADS } = limits;
  const { ads: all, ...header } = file;
  const list = (Array.isArray(all) ? all : []).filter((ad) => ad && typeof ad === "object");
  const kept = list.slice(0, max);
  const batches: Record<string, unknown>[][] = [];
  const ids = new Set<string>();
  let current: Record<string, unknown>[] = [];
  let bytes = 0;
  for (const ad of kept) {
    const slim = slimAd(ad);
    const size = utf8Bytes(JSON.stringify(slim)) + 1;
    if (current.length && (current.length >= perBatch || bytes + size > maxBytes)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(slim);
    bytes += size;
    const id = scrapeAdId(ad);
    if (id) ids.add(id);
  }
  if (current.length) batches.push(current);
  return { header, batches, ids: [...ids], ads: kept.length, inFile: list.length, truncated: list.length > kept.length };
}

/** What the research function answers for one batch (see importLocal there). */
export interface BatchAnswer {
  ads?: number; created?: number; updated?: number; retired?: number; watchId?: string | null; watchCreated?: boolean; truncated?: boolean;
  mediaQueued?: number; mediaStored?: number; mediaError?: string;
  /** Ads of this batch whose copy, link or media changed since they were last imported (their earlier version is kept). */
  edited?: number;
  /** When the import began (the first batch's answer), sent back with the later batches. */
  since?: string | null;
  batch?: { id?: string; index: number; count?: number; last: boolean };
  error?: string;
}

export interface ImportTotals {
  ads: number; created: number; updated: number; retired: number; watchCreated: boolean; mediaQueued: number; mediaStored: number; mediaError?: string;
  /** Ads whose copy, link or media changed since the last import. */
  edited: number;
}

export type ImportOutcome = { totals: ImportTotals; watchId: string | null; batches: number } & (
  | { ok: true }
  /** `failed` is the batch (0-based) that failed twice; the ones before it are saved. */
  | { ok: false; error: string; failed: number }
);

/** The JSON body of batch `index`: the header (incomplete except on the last batch), its ads and the batch facts. */
export function batchBody(plan: ImportPlan, index: number, o: {
  importId: string; watchId?: string | null; createWatch: boolean; own: boolean; since: string | null; saved: number; attempt: number;
  /** The import pop-up's storage check (files it won't store now). */
  holdId?: string | null;
}): string {
  const count = plan.batches.length;
  const last = index === count - 1;
  return JSON.stringify({
    // Not complete before the last batch: a research function too old to know batches then marks nothing as stopped.
    file: { ...plan.header, complete: last ? plan.header.complete : false, ads: plan.batches[index] },
    watchId: o.watchId ?? undefined,
    createWatch: index === 0 && o.createWatch,
    own: o.own,
    holdId: o.holdId ?? undefined,
    batch: {
      id: o.importId, index, count, since: o.since, saved: o.saved, truncated: plan.truncated, attempt: o.attempt,
      ...(last ? { ids: plan.ids } : {}),
    },
  });
}

/**
 * Sends the batches one after another. A failed batch is retried once; when it fails again the import
 * stops there (the batches before it stay saved: saving is an upsert, so importing the file again is safe).
 */
export async function runImport(plan: ImportPlan, o: {
  importId: string; watchId?: string | null; createWatch: boolean; own: boolean;
  /** The import pop-up's storage check, sent with every batch. */
  holdId?: string | null;
  send: (json: string) => Promise<BatchAnswer>;
  onProgress?: (sent: number, total: number) => void;
  retryMs?: number;
  wait?: (ms: number) => Promise<void>;
}): Promise<ImportOutcome> {
  const wait = o.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const totals: ImportTotals = { ads: 0, created: 0, updated: 0, retired: 0, watchCreated: false, mediaQueued: 0, mediaStored: 0, edited: 0 };
  const count = plan.batches.length;
  let watchId = o.watchId ?? null;
  let since: string | null = null;
  let sent = 0;
  for (let index = 0; index < count; index++) {
    o.onProgress?.(sent, plan.ads);
    let answer: BatchAnswer = {};
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt > 1) await wait(o.retryMs ?? IMPORT_RETRY_MS);
      const json = batchBody(plan, index, { importId: o.importId, watchId, createWatch: o.createWatch, own: o.own, since, saved: totals.ads, attempt, holdId: o.holdId });
      answer = await o.send(json).catch(() => ({ error: "Couldn't reach the server." }));
      if (!answer.error) break;
    }
    const part = count > 1 ? `Part ${index + 1} of ${count}` : "The import";
    if (answer.error) {
      const before = sent ? ` The ${sent.toLocaleString("en-US")} ads before it are saved; import the file again to finish.` : "";
      return { ok: false, error: `${part} failed twice: ${answer.error}${before} No ads were marked as stopped.`, failed: index, totals, watchId, batches: count };
    }
    // A research function that doesn't know batches would treat each one as the whole file: stop after the first.
    if (count > 1 && (!answer.batch || answer.batch.index !== index || !answer.since)) {
      return {
        ok: false, failed: index, totals, watchId, batches: count,
        error: `The research function is out of date: it can't take a file in parts yet. The first ${sent + plan.batches[index].length} ads are saved; deploy the research function and import the file again.`,
      };
    }
    since ??= answer.since ?? null;
    watchId = answer.watchId ?? watchId;
    totals.ads += answer.ads ?? 0;
    totals.created += answer.created ?? 0;
    totals.updated += answer.updated ?? 0;
    totals.retired += answer.retired ?? 0;
    totals.watchCreated ||= answer.watchCreated === true;
    totals.mediaQueued += answer.mediaQueued ?? 0;
    totals.mediaStored += answer.mediaStored ?? 0;
    totals.edited += answer.edited ?? 0;
    if (answer.mediaError) totals.mediaError ??= answer.mediaError;
    sent += plan.batches[index].length;
  }
  o.onProgress?.(sent, plan.ads);
  return { ok: true, totals, watchId, batches: count };
}
