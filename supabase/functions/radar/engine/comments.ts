// The comments pass: for a run's most-viewed posts, more comments than the post scrapers return
// (Instagram gives ~10 with the post, TikTok and YouTube none). Jev reads them for buying intent and
// sorts them into audience themes.
import type { Platform, Reel } from "./types.ts";

export const COMMENT_ACTORS: Partial<Record<Platform, string>> = {
  instagram: "apify~instagram-comment-scraper",
  tiktok: "clockworks~tiktok-comments-scraper",
  youtube: "streamers~youtube-comments-scraper",
};

/** Apify prices per comment, for estimates. */
export const COMMENT_PRICE: Partial<Record<Platform, number>> = { instagram: 0.0019, tiktok: 0.005, youtube: 0.0009 };

/** A post's identity from any of its URLs: the Instagram shortcode, TikTok video id or YouTube id. */
export function postKey(url: string | undefined): string | null {
  if (!url) return null;
  return url.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)?.[1]
    ?? url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/)?.[1]
    ?? url.match(/(?:youtube\.com\/(?:shorts\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{6,})/)?.[1]
    ?? null;
}

export const commentsInput = (platform: Platform, urls: string[], perPost: number) =>
  platform === "instagram" ? { directUrls: urls, resultsLimit: perPost }
    : platform === "tiktok" ? { postURLs: urls, commentsPerPost: perPost, maxRepliesPerComment: 0 }
    : { startUrls: urls.map((url) => ({ url })), maxComments: perPost, commentsSortBy: "0" };

/** The `top` most-viewed posts on each channel that has a comment scraper. */
export function pickForComments(reels: Reel[], top: number): { platform: Platform; reels: Reel[] }[] {
  return (Object.keys(COMMENT_ACTORS) as Platform[]).flatMap((platform) => {
    const picked = reels.filter((r) => r.platform === platform).sort((a, b) => b.views - a.views).slice(0, top);
    return picked.length ? [{ platform, reels: picked }] : [];
  });
}

/** Adds the scraped comments to the posts they belong to. Returns how many posts got some. */
export function attachComments(picked: Reel[], items: any[], perPost: number): number {
  const byKey = new Map(picked.flatMap((reel) => {
    const key = postKey(reel.url) ?? reel.id.replace(/^(tt|yt)_/, "");
    return key ? [[key, reel] as const] : [];
  }));
  const found = new Map<Reel, string[]>();
  for (const item of items) {
    const text = String(item.text ?? item.comment ?? item.content ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = postKey(item.postUrl ?? item.inputUrl ?? item.videoWebUrl ?? item.submittedVideoUrl ?? item.pageUrl ?? item.url)
      ?? (item.videoId ? String(item.videoId) : item.awemeId ? String(item.awemeId) : null);
    const reel = key ? byKey.get(key) : picked.length === 1 ? picked[0] : undefined;
    if (reel) found.set(reel, [...(found.get(reel) ?? []), text.slice(0, 300)]);
  }
  for (const [reel, texts] of found) reel.topComments = [...new Set([...(reel.topComments ?? []), ...texts])].slice(0, perPost);
  return found.size;
}
