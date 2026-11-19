// What to ask each Apify scraper for, and how its items become the same Reel shape. Instagram,
// TikTok and YouTube Shorts are video (TikTok scripts come from its timed subtitles); X and LinkedIn
// posts are text, and the post itself is the script, one sentence per line.
import { clean, type Reel, type Segment } from "./types.ts";

export const ACTORS = {
  instagramReels: "apify~instagram-reel-scraper",
  instagramHashtags: "apify~instagram-hashtag-scraper",
  instagramSearch: "apify~instagram-search-scraper",
  tiktok: "clockworks~tiktok-scraper",
  youtube: "streamers~youtube-shorts-scraper",
  x: "apidojo~tweet-scraper",
  linkedin: "harvestapi~linkedin-company-posts",
} as const;

/** Rough Apify prices per post (Instagram includes its transcript), for estimates. */
export const POST_PRICE = { instagram: 0.0026 + 0.057, tiktok: 0.0017, youtube: 0.0024, x: 0.0004, linkedin: 0.0015 } as const;

// MARK: Inputs

export const instagramReelsInput = (o: { usernames: string[]; limit: number; sinceDays?: number; transcripts: boolean }) => ({
  skipPinnedPosts: false, includeTranscript: o.transcripts, username: o.usernames, resultsLimit: o.limit,
  ...(o.sinceDays ? { onlyPostsNewerThan: `${o.sinceDays} days` } : {}),
});

export const instagramHashtagInput = (keyword: string, limit: number) => ({ hashtags: [keyword], keywordSearch: true, resultsType: "reels", resultsLimit: limit });

export function tiktokInput(o: { profiles?: string[]; searches?: string[]; limit: number; transcripts: boolean; sinceDays?: number }) {
  const input: Record<string, unknown> = {
    ...(o.sinceDays ? { oldestPostDateUnified: `${o.sinceDays} days` } : {}),
    resultsPerPage: o.limit,
    downloadSubtitlesOptions: o.transcripts ? "DOWNLOAD_SUBTITLES" : "NEVER_DOWNLOAD_SUBTITLES",
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
  };
  if (o.profiles?.length) input.profiles = o.profiles.map(clean);
  if (o.searches?.length) { input.searchQueries = o.searches; input.searchSection = "/video"; }
  return input;
}

export const youtubeChannel = (channel: string) => clean(channel).replace(/^https?:\/\/(www\.)?youtube\.com\/@?/, "").split(/[/?]/)[0];
export const youtubeInput = (o: { channels: string[]; limit: number; sinceDays?: number }) => ({
  channels: o.channels.map(youtubeChannel), maxResultsShorts: o.limit, sortChannelShortsBy: "NEWEST",
  ...(o.sinceDays ? { oldestPostDate: `${o.sinceDays} days` } : {}),
});

export const xHandle = (handle: string) => clean(handle).replace(/^https?:\/\/(x|twitter)\.com\//, "").split(/[/?]/)[0];
export function xInput(o: { handles: string[]; limit: number; sinceDays: number }) {
  const since = new Date(Date.now() - o.sinceDays * 86_400_000).toISOString().slice(0, 10);
  // The actor needs at least 50 items per query; extra results are dropped in xReels.
  return { twitterHandles: o.handles.map(xHandle), maxItems: Math.max(50, o.limit * o.handles.length), sort: "Latest", start: since };
}

export function linkedinInput(o: { companies: string[]; limit: number; sinceDays: number }) {
  const targetUrls = o.companies.map((company) => company.startsWith("http") ? company : `https://www.linkedin.com/company/${clean(company)}/`);
  const postedLimit = o.sinceDays <= 1 ? "24h" : o.sinceDays <= 7 ? "week" : o.sinceDays <= 31 ? "month" : undefined;
  return { targetUrls, maxPosts: o.limit, ...(postedLimit ? { postedLimit } : {}) };
}

// MARK: Instagram

/** One raw item from Apify's Instagram scrapers; fields vary a little between actors. */
export interface RawInstagram {
  id?: string; shortCode?: string; url?: string; type?: string; productType?: string;
  ownerUsername?: string; caption?: string; hashtags?: string[];
  videoViewCount?: number; videoPlayCount?: number; igPlayCount?: number;
  likesCount?: number; commentsCount?: number; videoDuration?: number;
  timestamp?: string; displayUrl?: string; paidPartnership?: boolean;
  transcript?: unknown;
  latestComments?: { text?: string }[];
  coauthorProducers?: { username?: string }[];
  taggedUsers?: ({ username?: string } | string)[];
  mentions?: string[];
}

const handlesOf = (list: unknown): string[] => Array.isArray(list)
  ? [...new Set(list.map((entry: any) => String(typeof entry === "string" ? entry : entry?.username ?? "").replace(/^@/, "").toLowerCase()).filter(Boolean))]
  : [];

const isVideo = (raw: RawInstagram) => raw.type === "Video" || raw.productType === "clips" || raw.videoDuration != null;

/** Apify returns a transcript as text or as timed segments; both become segments here. */
export function segments(transcript: unknown): Segment[] {
  if (Array.isArray(transcript)) {
    return transcript
      .map((part: any) => ({ text: String(part.text ?? part.transcript ?? "").trim(), start: Number(part.start ?? part.startTime ?? part.offset) }))
      .filter((part) => part.text)
      .map((part) => (Number.isFinite(part.start) ? part : { text: part.text }));
  }
  if (typeof transcript === "string" && transcript.trim()) {
    return transcript.replace(/\s+/g, " ").match(/[^.!?]+[.!?]*/g)?.map((text) => ({ text: text.trim() })).filter((part) => part.text) ?? [];
  }
  return [];
}

/** An Instagram item as a post. Only videos unless `allowImages` (partnership signals count any post). */
export function instagramReel(raw: RawInstagram, source: string, allowImages = false): Reel | null {
  const id = raw.shortCode ?? raw.id;
  if (!id || (!allowImages && !isVideo(raw))) return null;
  return {
    id,
    platform: "instagram",
    url: raw.url ?? `https://www.instagram.com/reel/${id}/`,
    owner: raw.ownerUsername ?? "unknown",
    // The reel scrapers don't return follower counts or saves; shares need a paid Apify plan.
    followers: null,
    shares: null,
    saves: null,
    caption: raw.caption ?? "",
    hashtags: raw.hashtags ?? [],
    views: raw.videoPlayCount ?? raw.igPlayCount ?? raw.videoViewCount ?? 0,
    likes: Math.max(0, raw.likesCount ?? 0),
    comments: Math.max(0, raw.commentsCount ?? 0),
    durationSec: raw.videoDuration ?? null,
    postedAt: raw.timestamp ?? null,
    thumb: raw.displayUrl ?? null,
    paidPartnership: Boolean(raw.paidPartnership),
    source,
    transcript: segments(raw.transcript),
    topComments: (raw.latestComments ?? []).map((comment) => comment.text?.trim() ?? "").filter(Boolean).slice(0, 10),
    coauthors: handlesOf(raw.coauthorProducers),
    taggedUsers: handlesOf(raw.taggedUsers),
    mentions: handlesOf(raw.mentions),
  };
}

/** Keeps the first copy of each reel, preferring one that already has a transcript. */
export function dedupe(reels: Reel[]): Reel[] {
  const byId = new Map<string, Reel>();
  for (const reel of reels) {
    const seen = byId.get(reel.id);
    if (!seen || (!seen.transcript.length && reel.transcript.length)) byId.set(reel.id, reel);
  }
  return [...byId.values()];
}

// MARK: TikTok

/** WebVTT cues become segments with start times; consecutive repeats are merged. */
export function parseVTT(text: string): Segment[] {
  const out: Segment[] = [];
  for (const block of text.replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.split("\n");
    const timing = lines.findIndex((line) => line.includes("-->"));
    if (timing < 0) continue;
    const parts = lines[timing].split("-->")[0].trim().split(":").map(Number);
    const start = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    const cue = lines.slice(timing + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (cue && out.at(-1)?.text !== cue) out.push({ text: cue, start: Math.round(start * 10) / 10 });
  }
  return out;
}

/** A TikTok video's subtitles (English when there are several), or none. */
export async function tiktokScript(item: any): Promise<Segment[]> {
  const links: any[] = item.videoMeta?.subtitleLinks ?? item.subtitleLinks ?? [];
  const pick = links.find((link) => /^en/i.test(link.language ?? "")) ?? links[0];
  const url = pick?.downloadLink ?? pick?.tiktokLink;
  if (!url) return [];
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return response.ok ? parseVTT(await response.text()) : [];
  } catch {
    return [];
  }
}

/** TikTok items as reels, fetching subtitles when asked (a few at a time). */
export async function tiktokReels(items: any[], o: { transcripts: boolean; source: (item: any) => string }): Promise<Reel[]> {
  const usable = items.filter((item) => item.id && (item.webVideoUrl || item.authorMeta?.name));
  const scripts: Segment[][] = new Array(usable.length).fill([]);
  if (o.transcripts) {
    let next = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      for (let i = next++; i < usable.length; i = next++) scripts[i] = await tiktokScript(usable[i]);
    }));
  }
  return usable.map((item, i): Reel => ({
    id: `tt_${item.id}`,
    platform: "tiktok",
    url: item.webVideoUrl ?? `https://www.tiktok.com/@${item.authorMeta?.name}/video/${item.id}`,
    owner: item.authorMeta?.name ?? "unknown",
    followers: item.authorMeta?.fans ?? null,
    caption: item.text ?? "",
    hashtags: (item.hashtags ?? []).map((tag: any) => (typeof tag === "string" ? tag : tag.name)).filter(Boolean),
    views: item.playCount ?? 0,
    likes: item.diggCount ?? 0,
    comments: item.commentCount ?? 0,
    shares: item.shareCount ?? null,
    saves: item.collectCount ?? null,
    durationSec: item.videoMeta?.duration ?? null,
    postedAt: item.createTimeISO ?? null,
    thumb: item.videoMeta?.coverUrl ?? item.covers?.default ?? null,
    paidPartnership: Boolean(item.isAd ?? item.isSponsored),
    source: o.source(item),
    transcript: scripts[i],
  }));
}

// MARK: YouTube Shorts

/** "0:45" / "1:02:03" / seconds → seconds. */
function seconds(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value) return null;
  return value.split(":").map(Number).reduce((total, part) => total * 60 + part, 0) || null;
}

export const youtubeReels = (items: any[], source: (item: any) => string): Reel[] => items.filter((item) => item.id).map((item): Reel => ({
  id: `yt_${item.id}`,
  platform: "youtube",
  url: item.url ?? `https://www.youtube.com/shorts/${item.id}`,
  owner: item.channelUsername ?? item.channelName ?? "unknown",
  followers: item.numberOfSubscribers ?? null,
  caption: [item.title, item.text].filter(Boolean).join("\n"),
  hashtags: item.hashtags ?? [],
  views: item.viewCount ?? 0,
  likes: item.likes ?? 0,
  comments: item.commentsCount ?? 0,
  shares: null,
  saves: null,
  durationSec: seconds(item.duration),
  postedAt: item.date ?? null,
  thumb: item.thumbnailUrl ?? null,
  paidPartnership: false,
  source: source(item),
  transcript: [],
}));

// MARK: Text channels

function sentences(text: string): Segment[] {
  return text.replace(/\s+/g, " ").match(/[^.!?\n]+[.!?]*/g)?.map((part) => ({ text: part.trim() })).filter((part) => part.text.length > 1).slice(0, 30) ?? [];
}

export function xReels(items: any[], o: { limit: number; source: (item: any) => string }): Reel[] {
  const reels = items.filter((item) => item.id && item.text && !item.isRetweet && !item.retweeted_status).map((item): Reel => ({
    id: `x_${item.id}`,
    platform: "x",
    url: item.url ?? item.twitterUrl ?? `https://x.com/i/status/${item.id}`,
    owner: item.author?.userName ?? "unknown",
    followers: item.author?.followers ?? null,
    caption: item.text,
    hashtags: (item.entities?.hashtags ?? []).map((tag: any) => tag.text ?? tag).filter(Boolean),
    views: item.viewCount ?? 0,
    likes: item.likeCount ?? 0,
    comments: item.replyCount ?? 0,
    shares: (item.retweetCount ?? 0) + (item.quoteCount ?? 0),
    saves: item.bookmarkCount ?? null,
    durationSec: null,
    postedAt: item.createdAt ? new Date(item.createdAt).toISOString() : null,
    thumb: item.extendedEntities?.media?.[0]?.media_url_https ?? null,
    paidPartnership: false,
    source: o.source(item),
    transcript: sentences(item.text),
  }));
  // Keep each account's most recent posts up to the limit.
  const perOwner = new Map<string, number>();
  return reels.filter((reel) => (perOwner.set(reel.owner, (perOwner.get(reel.owner) ?? 0) + 1).get(reel.owner) ?? 0) <= o.limit);
}

export const linkedinReels = (items: any[], source: (item: any) => string): Reel[] => items.filter((item) => item.id && (item.content || item.text)).map((item): Reel => {
  const text: string = item.content ?? item.text;
  const engagement = item.engagement ?? {};
  const reactions = engagement.likes ?? engagement.reactions ?? item.numLikes ?? 0;
  return {
    id: `li_${item.id}`,
    platform: "linkedin",
    url: item.linkedinUrl ?? item.url ?? "",
    owner: item.author?.publicIdentifier ?? item.author?.universalName ?? item.author?.name ?? "unknown",
    followers: item.author?.followersCount ?? item.author?.followerCount ?? null,
    caption: text,
    hashtags: [],
    // LinkedIn doesn't show view counts publicly, so reach is estimated from engagement: about
    // 1 reaction per 100 impressions. Comparisons stay within LinkedIn, so the scale washes out.
    views: Math.max(1, Math.round((reactions + 3 * (engagement.comments ?? 0)) * 100)),
    likes: reactions,
    comments: engagement.comments ?? item.numComments ?? 0,
    shares: engagement.shares ?? item.numShares ?? null,
    saves: null,
    durationSec: null,
    postedAt: item.postedAt?.date ?? item.postedAt?.timestamp ?? (typeof item.postedAt === "string" ? item.postedAt : null),
    thumb: item.postImages?.[0]?.url ?? item.images?.[0] ?? null,
    paidPartnership: false,
    source: source(item),
    transcript: sentences(text),
  };
});

/** A campaign keeps posts that name the brand or are marked as paid partnerships. */
export function mentioning(reels: Reel[], mentions: string[]): Reel[] {
  const words = mentions.map((word) => word.toLowerCase());
  return reels.filter((reel) => reel.paidPartnership || words.some((word) => `${reel.caption} ${reel.transcript.map((s) => s.text).join(" ")}`.toLowerCase().includes(word)));
}
