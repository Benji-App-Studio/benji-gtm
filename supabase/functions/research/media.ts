// Competitors' creative files kept in storage (bucket `ad-media`, table `paid_ad_media`): the pure
// helpers, with no runtime APIs beyond Web Crypto, so Node tests can import them
// (scripts/creative-runner/tests/ad-media.test.ts). The studio has a twin of `urlKey` in
// studio/src/lib/ad-media.ts; keep them in step.

export const MEDIA_BUCKET = "ad-media";
/** The bucket's file size limit; bigger files are rejected before upload. */
export const MEDIA_MAX_BYTES = 300 * 1024 * 1024;
/** Files saved per ad at most (a DCO ad can have a dozen cards, each with a poster). */
export const MEDIA_PER_AD = 40;
export const MEDIA_EXPIRED = "The link expired before it was saved: scrape this advertiser again and import";

export type MediaKind = "video" | "image" | "poster";
export interface MediaFile { url: string; kind: MediaKind }

/**
 * A file's identity: its link without the query string (Meta's signature and expiry live there).
 * Meta's CDN serves one file from many edge hosts (scontent.fhyd2-2.fna.fbcdn.net, …-3…), so every
 * fbcdn.net host counts as one. Null for anything that isn't an https link.
 */
export function urlKey(url: unknown): string | null {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  const key = `${host === "fbcdn.net" || host.endsWith(".fbcdn.net") ? "fbcdn.net" : host}${parsed.pathname}`;
  return key.length >= 8 && key.length <= 2000 ? key : null;
}

/**
 * Whether a media link may be saved, downloaded or read: https on Meta's or Instagram's CDN
 * (fbcdn.net, cdninstagram.com), Facebook's ad image endpoint (facebook.com/ads/image), TikTok's
 * CDNs (tiktokcdn.com, tiktokcdn-us.com, tiktokcdn-eu.com…) and TikTok's Ad Library video links
 * (library.tiktok.com/api/v1/cdn/…), Google's ad image archive (tpc.googlesyndication.com/archive/…),
 * or our own storage's public files
 * (`storageHost`, the project's host). Anything else (another site, an internal address, a link with
 * a user name or an odd port) is refused, so an imported file can't make the worker fetch it.
 */
export function allowedMediaUrl(url: unknown, storageHost?: string | null): boolean {
  if (typeof url !== "string" || url.length > 4000 || !/^https:\/\//i.test(url)) return false;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) return false;
  const host = parsed.hostname.toLowerCase();
  const under = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (under("fbcdn.net") || under("cdninstagram.com")) return true;
  if ((host === "facebook.com" || host === "www.facebook.com") && /^\/ads\/image\/?$/.test(parsed.pathname)) return true;
  if (/^([a-z0-9-]+\.)*tiktokcdn(-[a-z0-9]+)?\.com$/.test(host)) return true;
  if (host === "library.tiktok.com" && parsed.pathname.startsWith("/api/v1/cdn/")) return true;
  if (host === "tpc.googlesyndication.com" && parsed.pathname.startsWith("/archive/")) return true;
  const own = storageHost?.toLowerCase();
  return Boolean(own) && host === own && parsed.pathname.startsWith("/storage/v1/object/public/");
}

/** Hex SHA-256 of a string. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/heic": "heic",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-m4v": "m4v", "video/3gpp": "3gp",
};
const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif", heic: "image/heic",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v", "3gp": "video/3gpp",
};

const pathExt = (url: string) => {
  try { return new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? ""; } catch { return ""; }
};

/**
 * The file's type from the response's Content-Type, else from the link's extension, else from what the
 * file should be. Null when it isn't an image or a video (an error page, say).
 */
export function mediaMime(contentType: string | null | undefined, url: string, kind: MediaKind): string | null {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (/^(image|video)\/[a-z0-9.+-]+$/.test(type)) return type;
  if (type && type !== "application/octet-stream" && type !== "binary/octet-stream") return null;
  return EXT_MIME[pathExt(url)] ?? (kind === "video" ? "video/mp4" : "image/jpeg");
}

export function extensionFor(mime: string, url = ""): string {
  return MIME_EXT[mime] ?? (EXT_MIME[pathExt(url)] ? pathExt(url) : mime.startsWith("video/") ? "mp4" : "jpg");
}

/** `<product id>/<page id or "page">/<first 24 hex of sha256(url_key)>.<ext>`. */
export function mediaPath(productId: string, pageId: string | null | undefined, hash: string, ext: string): string {
  const page = pageId && /^[0-9]{3,30}$/.test(pageId) ? pageId : "page";
  return `${productId}/${page}/${hash.slice(0, 24)}.${ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin"}`;
}

/** Download outcome → what happens to the row: an expired link fails for good; anything else is retried. */
export function failureFor(status: number | null): { retry: boolean; error: string } {
  if (status === 403 || status === 404 || status === 410) return { retry: false, error: MEDIA_EXPIRED };
  return { retry: true, error: status ? `The download answered ${status}.` : "The download didn't finish." };
}

/** Retries wait a minute per attempt so far. */
export const retryDelaySeconds = (attempts: number) => 60 * Math.max(1, attempts);

type Obj = Record<string, any>;
const https = (value: unknown) => (typeof value === "string" && /^https:\/\//i.test(value) ? value : null);
const firstUrl = (from: Obj | null | undefined, ...keys: string[]) => {
  for (const key of keys) {
    const url = https(from?.[key]);
    if (url) return url;
  }
  return null;
};

/**
 * Every file an imported ad shows: the scraper's measured media (`creative.media`: each url, and each
 * video's thumbnail_url as a poster), the saved ad's media and thumb, and the Ad Library snapshot's
 * cards, videos and images (the link the studio would pick: HD before SD, original before resized).
 * One entry per file (by `urlKey`), media before posters, at most MEDIA_PER_AD.
 */
export function mediaFiles(o: {
  creative?: { media?: unknown } | null;
  raw?: Obj | null;
  media?: { type?: string; url?: string; thumb?: string | null }[] | null;
  thumb?: string | null;
}): MediaFile[] {
  const files: MediaFile[] = [];
  const seen = new Set<string>();
  const add = (url: string | null, kind: MediaKind) => {
    const key = url ? urlKey(url) : null;
    if (!url || !key || seen.has(key)) return;
    seen.add(key);
    files.push({ url, kind });
  };
  const posters: string[] = [];
  const creative: Obj[] = Array.isArray(o.creative?.media) ? (o.creative!.media as Obj[]) : [];
  for (const m of creative) {
    if (!m || typeof m !== "object") continue;
    add(https(m.url), m.type === "video" ? "video" : "image");
    const poster = https(m.thumbnail_url);
    if (poster) posters.push(poster);
  }
  for (const m of o.media ?? []) {
    if (!m || typeof m !== "object") continue;
    add(https(m.url), m.type === "video" ? "video" : "image");
    const poster = https(m.thumb);
    if (poster) posters.push(poster);
  }
  const snap: Obj | null = o.raw && typeof o.raw.snapshot === "object" ? o.raw.snapshot : null;
  const list = (value: unknown): Obj[] => (Array.isArray(value) ? value.filter((x) => x && typeof x === "object") : []);
  const video = (v: Obj) => {
    const url = firstUrl(v, "video_hd_url", "videoHdUrl", "video_sd_url", "videoSdUrl");
    if (url) add(url, "video");
    const poster = firstUrl(v, "video_preview_image_url", "videoPreviewImageUrl");
    if (poster) posters.push(poster);
    return Boolean(url);
  };
  const image = (i: Obj) => add(firstUrl(i, "original_image_url", "originalImageUrl", "resized_image_url", "resizedImageUrl"), "image");
  for (const card of list(snap?.cards)) if (!video(card)) image(card);
  list(snap?.videos).forEach(video);
  list(snap?.images).forEach(image);
  // The ad's thumb is one of its images or a video's poster frame.
  const thumb = https(o.thumb);
  if (thumb) posters.push(thumb);
  for (const poster of posters) add(poster, "poster");
  return files.slice(0, MEDIA_PER_AD);
}

/** Accounts mode: files one (non-staff) account may have waiting to be saved at once. */
export const MEDIA_QUEUE_PER_USER = 2000;
/** The note on a file left out because the account already has MEDIA_QUEUE_PER_USER files waiting. */
export const MEDIA_QUEUE_FULL = "Too many of your files were already waiting to be saved: this one wasn't queued. Import the same file again once the others are stored.";

/**
 * Which new files fit under an account's waiting-files cap: the first ones in order, up to what is left
 * of `cap` after the `waiting` it has already; the rest are left out (`over`). No cap: all of them.
 */
export function splitByQueueCap<T>(files: T[], waiting: number, cap: number | null): { take: T[]; over: T[] } {
  if (cap === null) return { take: files, over: [] };
  const left = Math.max(0, cap - Math.max(0, waiting));
  return { take: files.slice(0, left), over: files.slice(left) };
}
