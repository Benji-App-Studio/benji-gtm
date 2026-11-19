// Saving a paid ad over the one we already have, and reading a saved ad: the pure helpers, with no
// runtime APIs, so Deno tests (rows_test.ts) and Node tests (scripts/creative-runner/tests/video-ad.test.ts)
// can import them.
//
// Sources differ in what they carry. The local scraper (and the Chrome extension, which writes the same
// file) has every media file, Meta's measured creative and the format; Apify's scrape has the media; the
// Ad Library API and the Meta Ads MCP have copy only. So a re-pull from a poorer source must not wipe
// what a richer one saved: `mergeAdRow` never replaces a filled field with an empty one, and while the
// stored ad came from a richer source it keeps that source, its media, thumb, collation, creative and
// format. Copy (text, link) still comes from the newest pull, so a real edit is seen.
import { isVideoAd, type PaidAd } from "../radar/engine/adlibrary.ts";
import { allowedMediaUrl } from "./media.ts";

/** How much a source knows about an ad: local scraper / extension > Apify > the official API > the MCP. */
export const SOURCE_RANK: Record<string, number> = {
  meta_local: 4,
  meta_apify: 3, tiktok_creative_center: 3, tiktok_apify: 3,
  meta_api: 2, tiktok_library: 2,
  meta_mcp: 1,
};
const rank = (source: unknown) => SOURCE_RANK[String(source)] ?? 0;

/** The stored columns `mergeAdRow` reads. */
export const MERGE_COLUMNS = "source, media_type, media, thumb, collation_id, creative, page_id, page_name, body, headline, description, cta, link_url, snapshot_url, started_at, countries, placements, languages, reach, metrics, library, watch_id";

/** Fields a pull fills in when it has them and otherwise leaves as they were. */
const FILL_KEYS = [
  "body", "headline", "description", "cta", "link_url", "snapshot_url", "page_id", "started_at",
  "countries", "placements", "languages", "reach", "metrics", "library", "watch_id",
] as const;

type Row = Record<string, any>;
const filled = (value: unknown) => value != null && value !== "" && !(Array.isArray(value) && value.length === 0);
const knownType = (value: unknown) => typeof value === "string" && value !== "" && value !== "unknown";

/** The media a saved ad shows: the scraper's measured list when there is one, else the ad's own. */
export function videoMediaOf(row: Row | null | undefined): { type?: string | null; url?: string | null }[] {
  const measured = row?.creative?.media;
  if (Array.isArray(measured) && measured.length) return measured;
  return Array.isArray(row?.media) ? row!.media : [];
}

/**
 * The row to upsert: the incoming one, with what it lacks taken from the stored one (see the top of the
 * file), and `is_video` worked out from the result. `stored` is null for a new ad.
 */
export function mergeAdRow<T extends Row>(stored: Row | null | undefined, incoming: T): T & Row & { is_video: boolean } {
  const out: Row = { ...incoming };
  if (stored) {
    const richer = rank(stored.source) > rank(incoming.source);
    out.source = richer ? stored.source : incoming.source;
    for (const key of ["media", "thumb", "collation_id"]) {
      if (!(key in incoming) && !filled(stored[key])) continue;
      out[key] = richer && filled(stored[key]) ? stored[key] : filled(incoming[key]) ? incoming[key] : (stored[key] ?? incoming[key] ?? null);
    }
    // Only the local scraper measures the creative; other sources don't send the column at all.
    if ("creative" in incoming || stored.creative != null) {
      out.creative = richer && stored.creative != null ? stored.creative : incoming.creative ?? stored.creative ?? null;
    }
    out.media_type = richer && knownType(stored.media_type) ? stored.media_type
      : knownType(incoming.media_type) ? incoming.media_type
      : stored.media_type ?? incoming.media_type;
    for (const key of FILL_KEYS) {
      if (key in incoming && !filled(incoming[key]) && filled(stored[key])) out[key] = stored[key];
    }
    if (incoming.page_name === "Unknown advertiser" && filled(stored.page_name)) out.page_name = stored.page_name;
  }
  out.is_video = isVideoAd(out.media_type, videoMediaOf(out));
  return out as T & Row & { is_video: boolean };
}

/**
 * The ad with only media links we accept (Meta's, Instagram's and TikTok's CDNs, or our own storage;
 * see allowedMediaUrl): any other media entry is dropped, any other poster or thumb cleared.
 */
export function cleanAdMedia(ad: PaidAd, storageHost?: string | null): PaidAd {
  const ok = (url: unknown) => allowedMediaUrl(url, storageHost);
  return {
    ...ad,
    media: (ad.media ?? []).filter((m) => ok(m?.url)).map((m) => (m.thumb && !ok(m.thumb) ? { ...m, thumb: null } : m)),
    thumb: ad.thumb && ok(ad.thumb) ? ad.thumb : null,
  };
}

/**
 * The ad's video file, when it plays as a video (`is_video`, or for an older row the same rule:
 * isVideoAd in engine/adlibrary.ts, twin of isVideoAd in studio/src/lib/recreate.ts). Its first video.
 */
export function scanVideo(row: Row): string | null {
  const media = videoMediaOf(row);
  const video = typeof row.is_video === "boolean" ? row.is_video : isVideoAd(row.media_type, media);
  if (!video) return null;
  const url = media.find((m) => m?.type === "video")?.url;
  return typeof url === "string" && /^https:\/\//.test(url) ? url.slice(0, 2000) : null;
}

/** What the AI scan heard in a video ad, as the decoder's script lines (none when silent or not scanned). */
export function scanTranscript(scan: any): { text: string; start?: number }[] {
  const lines: any[] = Array.isArray(scan?.video?.transcript) ? scan.video.transcript : [];
  return lines.flatMap((x) => {
    const text = String(x?.text ?? "").trim();
    const start = Number(x?.start);
    return text ? [Number.isFinite(start) ? { text, start } : { text }] : [];
  });
}
