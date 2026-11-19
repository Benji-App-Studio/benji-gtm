// Research → Ads: competitors' creative files kept in storage (`paid_ad_media`, bucket `ad-media`; the
// research function's `media-tick` worker copies them from the Ad Library's expiring links). The ads
// list swaps each media link for its stored copy, keeping the original as `source_url`. `urlKey` is a
// twin of the one in supabase/functions/research/media.ts; keep them in step.

/**
 * A file's identity: its link without the query string (Meta's signature and expiry live there), with
 * every fbcdn.net edge host counted as one. Null for anything that isn't an https link.
 */
export function urlKey(url: unknown): string | null {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  const key = `${host === "fbcdn.net" || host.endsWith(".fbcdn.net") ? "fbcdn.net" : host}${parsed.pathname}`;
  return key.length >= 8 && key.length <= 2000 ? key : null;
}

/** Stored copies by `urlKey` of their source link. */
export type StoredMedia = ReadonlyMap<string, string>;

type Swap = { url: string; source: string | null };
const swap = (url: string | null | undefined, stored: StoredMedia): Swap | null => {
  if (!url) return null;
  const key = urlKey(url);
  const copy = key ? stored.get(key) : undefined;
  return copy ? { url: copy, source: url } : { url, source: null };
};

interface AdMediaFields {
  media: { type: "video" | "image"; url: string; thumb?: string | null; source_url?: string | null; thumb_source_url?: string | null }[];
  thumb: string | null;
  thumb_source_url?: string | null;
  creative: { card_count: number | null; nearest_placement: string | null; media: { url: string; thumbnail_url?: string | null; source_url?: string | null; thumbnail_source_url?: string | null }[] } | null;
}

/**
 * The ad with each media link, poster and thumb swapped for its stored copy when there is one; the
 * original stays as `source_url` / `thumb_source_url` / `thumbnail_source_url`.
 */
export function withStoredMedia<T extends AdMediaFields>(ad: T, stored: StoredMedia): T {
  if (!stored.size) return ad;
  const thumb = swap(ad.thumb, stored);
  return {
    ...ad,
    thumb: thumb?.url ?? ad.thumb,
    ...(thumb?.source ? { thumb_source_url: thumb.source } : {}),
    media: (ad.media ?? []).map((m) => {
      const url = swap(m.url, stored), poster = swap(m.thumb, stored);
      return { ...m, url: url?.url ?? m.url, ...(url?.source ? { source_url: url.source } : {}), ...(poster ? { thumb: poster.url } : {}), ...(poster?.source ? { thumb_source_url: poster.source } : {}) };
    }),
    creative: ad.creative && {
      ...ad.creative,
      media: (ad.creative.media ?? []).map((m) => {
        const url = swap(m.url, stored), poster = swap(m.thumbnail_url, stored);
        return { ...m, url: url?.url ?? m.url, ...(url?.source ? { source_url: url.source } : {}), ...(poster ? { thumbnail_url: poster.url } : {}), ...(poster?.source ? { thumbnail_source_url: poster.source } : {}) };
      }),
    },
  };
}

// MARK: Status

export interface MediaCounts { queued: number; downloading: number; done: number; failed: number; bytes: number }
/** The research function's `media-status`: files by status and bytes stored, in all and per advertiser Page. */
export interface MediaStatus extends MediaCounts {
  files: number;
  pages: (MediaCounts & { pageId: string | null })[];
}

export const MEDIA_EXPIRED_HINT = "Either their link expired before they were saved (scrape the advertiser again and import), or they're videos over the storage upload limit, which aren't stored (their ads and posters are).";

/** "4.5 GB", "640 MB", "12 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

const n = (value: number) => value.toLocaleString("en-US");

/** The Research page's "Stored media" line. */
export function storedMediaLine(s: Pick<MediaStatus, "queued" | "downloading" | "done" | "failed" | "bytes" | "files">): { working: boolean; line: string } {
  const working = s.queued + s.downloading > 0;
  const failed = s.failed ? ` · ${n(s.failed)} failed` : "";
  if (working) return { working, line: `Saving creatives to storage: ${n(s.done)} of ${n(s.files)} file${s.files === 1 ? "" : "s"} (${formatBytes(s.bytes)})${failed}` };
  if (s.done) return { working, line: `${n(s.done)} file${s.done === 1 ? "" : "s"} stored (${formatBytes(s.bytes)}) — kept until you delete them${failed}` };
  return { working, line: s.failed ? `No creatives stored${failed}` : "No creatives stored yet" };
}

/** The files an import of the scraper's file would store, once each: each ad's media and video posters. */
export function scrapeMediaFiles(ads: { creative?: unknown }[]): { url: string; kind: "video" | "image" | "poster" }[] {
  const out = new Map<string, { url: string; kind: "video" | "image" | "poster" }>();
  for (const ad of ads) {
    const media = (ad.creative as { media?: unknown } | undefined)?.media;
    if (!Array.isArray(media)) continue;
    for (const m of media as { type?: unknown; url?: unknown; thumbnail_url?: unknown }[]) {
      const pairs: [unknown, "video" | "image" | "poster"][] = [[m?.url, m?.type === "video" ? "video" : "image"], [m?.thumbnail_url, "poster"]];
      for (const [url, kind] of pairs) {
        const key = urlKey(url);
        if (key && typeof url === "string" && !out.has(key)) out.set(key, { url, kind });
      }
    }
  }
  return [...out.values()];
}

/** What the import pop-up's storage check found (research function `media-preview`). */
export interface MediaPreview {
  files: number; stored: number;
  new: { files: number; bytes: number; unknown: number };
  tooBig: { files: number; videos: number; bytes: number; limitBytes: number };
  fit: { files: number; bytes: number };
  left: { files: number; videos: number; bytes: number };
  storage: { usedBytes: number; quotaBytes: number; roomBytes: number };
}

/** About how many files an import of the scraper's file will save: its ads' media and video posters, once each. */
export function scrapeMediaCount(ads: { creative?: unknown }[]): number {
  const keys = new Set<string>();
  for (const ad of ads) {
    const media = (ad.creative as { media?: unknown } | undefined)?.media;
    if (!Array.isArray(media)) continue;
    for (const m of media as { url?: unknown; thumbnail_url?: unknown }[]) {
      for (const url of [m?.url, m?.thumbnail_url]) {
        const key = urlKey(url);
        if (key) keys.add(key);
      }
    }
  }
  return keys.size;
}
