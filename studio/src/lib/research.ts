// Research → Ads: competitors' paid ads per workspace. Rows mirror `paid_ads`, `ad_watchlist` and
// `ad_pulls` (migrations 20261002300000_paid_ads and 20261003000000_paid_ads_local); the edge function
// `research` writes them.
import type { MediaStatus } from "./ad-media";
import type { CompetitorSource, CompetitorSuggestion } from "./competitors";

export type AdNetwork = "meta" | "tiktok";
export type AdMediaType = "video" | "image" | "carousel" | "dco" | "text" | "unknown";
export type AdSource = "meta_api" | "meta_apify" | "meta_mcp" | "meta_local" | "tiktok_library" | "tiktok_creative_center" | "tiktok_apify";

export interface AdDecoded {
  format: string;
  formatConfidence: number;
  hookType: string | null;
  roles: { text: string; role: string; confidence: number; visual?: string }[];
  /** Null on reads since ads stopped being asked it (an ad always sells something). */
  mentionsProduct: number | null;
  /** What it was read from: what's said in the video (the scan's transcript) or the ad copy. Older reads lack it. */
  source?: "transcript" | "copy";
}

/** One media of a creative as it was measured when collected (any field can be missing). */
export interface CreativeMedia {
  type: "video" | "image";
  url: string;
  thumbnail_url?: string | null;
  width?: number | null;
  height?: number | null;
  duration_sec?: number | null;
  aspect?: string | null;
  /** Set when `url` is the stored copy (lib/ad-media.ts): the Ad Library link it came from. */
  source_url?: string | null;
  /** Set when `thumbnail_url` is the stored copy: the original poster link. */
  thumbnail_source_url?: string | null;
}

/** The creative as read when the ad was collected (`paid_ads.creative`). */
export interface AdCreative {
  card_count: number | null;
  nearest_placement: string | null;
  media: CreativeMedia[];
}

/** The kinds of shot the video scan tells apart (twin of SHOT_TYPES in supabase/functions/research/index.ts). */
export type ShotType = "talking_head" | "screen_recording" | "product_closeup" | "demo_hands" | "b_roll" | "lifestyle" | "text_card" | "green_screen" | "split_screen" | "animation" | "other";
export const SHOT_LABEL: Record<ShotType, string> = {
  talking_head: "talking head", screen_recording: "screen recording", product_closeup: "product close-up", demo_hands: "hands demo", b_roll: "b-roll",
  lifestyle: "lifestyle shot", text_card: "text card", green_screen: "green screen", split_screen: "split screen", animation: "animation", other: "shot",
};

/**
 * A video ad read as a video (scans from 2026-10-04 on): key frames the browser took from the stored
 * copy, their audio through OpenAI's speech-to-text, and the scan's reading of both.
 */
export interface AdVideoScan {
  duration_sec: number | null;
  /** What happens in the first seconds and the opening line (theirs, to rewrite). */
  hook: { seconds: number; what_happens: string; line: string };
  /** Their shots in order, with estimated timings in seconds. */
  shots: { start: number; end: number; shot_type: ShotType; visual: string; on_screen_text: string; voiceover: string }[];
  /** The kind of presenter and setting (never who they are). */
  presenter: string;
  voiceover_style: string;
  captions_style: string;
  music_sound: string;
  pacing: string;
  /** Their beats in one line. */
  structure: string;
  /** A voiceover for our product in their rhythm and length (AI; check every claim). */
  our_script: string;
  /** Their spoken words with timings (speech-to-text); empty when nobody speaks. */
  transcript?: { start: number; end: number; text: string }[];
  /** Why there's no transcript, when there isn't one. */
  transcript_note?: string | null;
  /** The frames that were read: stored copies (bucket ad-media) and the second each was taken at. */
  frames?: { at: number; url: string }[];
}

/** OpenAI's read of one ad for the Recreate tool (`paid_ads.scan`, the research function's `scan` route). */
export interface AdScan {
  on_image_text: { text: string; role: "headline" | "body" | "cta" | "price" | "legal" | "other" }[];
  flags: {
    kind: "brand" | "logo" | "url" | "handle" | "phone" | "email" | "address" | "price_or_offer" | "claim" | "person_face" | "testimonial" | "other";
    text: string;
    /** voiceover: said in the video; video: seen in one of its frames. */
    where: "image" | "primary_text" | "headline" | "description" | "link" | "voiceover" | "video";
    why: string;
    /** Replacement text for our brand; "" means remove it. */
    suggestion: string;
  }[];
  style: { layout: string; typography: string; colours: string; text_density: string; vibe: string };
  copy_suggestions: { headline: string; primary_text: string; on_image_text: string[]; note: string }[];
  video_note: string | null;
  /** Advice on whether our product can make the same promise (scans from 2026-10-03 on). The user decides. */
  fit?: import("./product-assets").AdFit;
  model?: string;
  /** What was read: an image, a carousel's first card, a video's poster frame, or a video's key frames. */
  image_source?: "image" | "card_1" | "video_poster" | "video_frames";
  /** Video ads: the video read as a video (null or missing for images and older scans). */
  video?: AdVideoScan | null;
  /**
   * Exact recreation (scans from 2026-10-05 on): every element a recreation touches, theirs → ours
   * (AI; editable in the sheet), with `keep` for generic ones that stay as they are.
   */
  swaps?: AdSwap[];
  /** Their type, role by role ("headline: bold serif, sentence case; wordmark: heavy black italic serif"). */
  typography?: string;
}

/** Twin of SWAP_ELEMENTS in supabase/functions/research/index.ts. */
export type SwapElement = "headline" | "subhead" | "body" | "wordmark" | "logo" | "product" | "subject" | "label" | "cta" | "price" | "legal" | "person" | "screen" | "other";
export interface AdSwap { element: SwapElement; theirs: string; ours: string; style: string; keep: boolean }

/**
 * Extra Ad Library details per ad (twin of AdLibraryDetails in supabase/functions/radar/engine/adlibrary.ts):
 * Meta's impressions bucket ("<100" is its "Low impression count" badge), partnership ads, the account it
 * ran from, the landing domain and tracking tool, the CTA type, age gating and AI-made media.
 */
export interface AdLibraryDetails {
  impressions?: { text: string; index: number } | null;
  lowImpressions?: boolean;
  postedAs?: { name: string; pageId: string | null; profileUrl: string | null; picture: string | null; categories: string[]; likes: number | null } | null;
  partner?: { name: string; pageId: string | null; profileUrl: string | null } | null;
  ctaType?: string | null;
  landingDomain?: string | null;
  linkHost?: string | null;
  tracking?: string | null;
  ageGated?: boolean;
  aiGenerated?: boolean;
  sensitive?: boolean;
  categories?: string[];
}

/** Meta's CTA types in words. */
export const CTA_TYPE_LABEL: Record<string, string> = {
  DOWNLOAD: "Download", INSTALL_MOBILE_APP: "Install now", USE_APP: "Use app", SIGN_UP: "Sign up", LEARN_MORE: "Learn more", SHOP_NOW: "Shop now",
  SEE_DETAILS: "See details", GET_OFFER: "Get offer", BOOK_TRAVEL: "Book now", SUBSCRIBE: "Subscribe", ORDER_NOW: "Order now", CONTACT_US: "Contact us",
  APPLY_NOW: "Apply now", GET_QUOTE: "Get quote", WATCH_MORE: "Watch more", VIEW_INSTAGRAM_PROFILE: "View Instagram profile", SEND_MESSAGE: "Send message",
};

export interface PaidAdRow {
  id: string;
  product_id: string;
  watch_id: string | null;
  /** Our own ad (imported as "Our ads"), not a competitor's. */
  is_own?: boolean;
  /** What else the Ad Library says (impressions bucket, partnership, landing, tracking…); null on older imports. */
  library?: AdLibraryDetails | null;
  network: AdNetwork;
  source: AdSource;
  ad_id: string;
  page_id: string | null;
  page_name: string;
  competitor: string | null;
  started_at: string | null;
  stopped_at: string | null;
  active: boolean;
  placements: string[];
  media_type: AdMediaType;
  /**
   * Plays as a video, whatever Meta calls its format (a carousel or dynamic ad of videos is a video),
   * worked out when the ad is saved (migration 20261005500000; see isVideoAd in lib/recreate.ts).
   * Missing on rows read before that migration.
   */
  is_video?: boolean;
  body: string;
  headline: string;
  description: string;
  cta: string;
  link_url: string | null;
  /** `url` / `thumb` are the stored copies when saved (lib/ad-media.ts), the originals then in `source_url` / `thumb_source_url`. */
  media: { type: "video" | "image"; url: string; thumb?: string | null; source_url?: string | null; thumb_source_url?: string | null }[];
  thumb: string | null;
  thumb_source_url?: string | null;
  snapshot_url: string | null;
  countries: string[];
  variants: number;
  /** Collected files only: position under Meta's "total impressions" sort in that collection (1 = most). */
  impressions_rank: number | null;
  creative: AdCreative | null;
  creative_key: string | null;
  metrics: { ctr?: number | null; likes?: number | null; budget?: string | null } | null;
  decoded: AdDecoded | null;
  decoded_at: string | null;
  sent_to_library_at: string | null;
  scan?: AdScan | null;
  scanned_at?: string | null;
  /** When an import last found the ad's copy, link or media changed (earlier versions: AdVersion). Null: unchanged since first seen. */
  creative_changed_at?: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export const PAID_AD_COLUMNS = "id, product_id, watch_id, is_own, library, network, source, ad_id, page_id, page_name, competitor, started_at, stopped_at, active, placements, media_type, is_video, body, headline, description, cta, link_url, media, thumb, snapshot_url, countries, variants, impressions_rank, creative, creative_key, metrics, decoded, decoded_at, sent_to_library_at, scan, scanned_at, creative_changed_at, first_seen_at, last_seen_at";

/** What an edit changed: the copy's parts, the link, or the media files. */
export type AdChange = "body" | "headline" | "description" | "cta" | "link" | "media";

export const AD_CHANGE_LABEL: Record<AdChange, string> = { body: "Primary text", headline: "Headline", description: "Description", cta: "Button", link: "Link", media: "Media" };

/**
 * An earlier version of an edited ad (`paid_ad_versions`, migration 20261003700000_paid_ad_versions): the
 * copy, link and media it had until an import found it changed. `changed` is what the next version
 * changed. Media links are swapped for stored copies where saved, like the ads' (`source_url` the original).
 */
export interface AdVersion {
  id: string;
  paid_ad_id: string;
  changed: AdChange[];
  body: string;
  headline: string;
  description: string;
  cta: string;
  link_url: string | null;
  media: PaidAdRow["media"];
  thumb: string | null;
  seen_from: string | null;
  seen_until: string | null;
  replaced_at: string;
}

export const AD_VERSION_COLUMNS = "id, paid_ad_id, changed, body, headline, description, cta, link_url, media, thumb, seen_from, seen_until, replaced_at";

/** Edited after the read (decode) or the AI scan: which of them describe an earlier version. */
export function staleReads(ad: Pick<PaidAdRow, "creative_changed_at" | "decoded_at" | "scanned_at">): { decode: boolean; scan: boolean } {
  const changed = ad.creative_changed_at ? Date.parse(ad.creative_changed_at) : NaN;
  if (Number.isNaN(changed)) return { decode: false, scan: false };
  const before = (at: string | null | undefined) => Boolean(at) && Date.parse(at as string) < changed;
  return { decode: before(ad.decoded_at), scan: before(ad.scanned_at) };
}

export interface WatchRow {
  id: string;
  product_id: string;
  name: string;
  network: AdNetwork;
  page_id: string | null;
  page_url: string | null;
  search_terms: string | null;
  tiktok_advertiser_id: string | null;
  countries: string[];
  candidate_id: string | null;
  enabled: boolean;
  created_at: string;
  /** Our own Page: its ads are ours (Research → Our ads). */
  is_own?: boolean;
  /** Where the entry came from (lib/competitors.ts); absent before migration 20261005700000. */
  source?: CompetitorSource;
  website?: string | null;
  handles?: Record<string, string>;
}

export interface PullRow {
  id: string;
  source: AdSource;
  status: "running" | "done" | "error";
  ads: number;
  usd: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

/** A competitor not on the list yet (an analysis pick or the AI profile's), offered for it. */
export type Suggestion = CompetitorSuggestion;

export interface ResearchHealth { metaApi: boolean; apify: boolean; jev: boolean; openai?: boolean; tiktok: "off" | "library" | "creative_center"; tiktokLibrary: boolean; mediaWorker?: boolean }

/** The brand kit, as the Recreate sheet uses it (lib/workspace-schema.ts BrandKit, screenshots counted). */
export interface ResearchBrand {
  appName: string;
  tagline: string | null;
  colors: string[];
  iconUrl: string | null;
  screenshots: number;
  tone: string | null;
  forbiddenClaims: string[];
  appStoreUrl: string | null;
  /** The AI product profile (Product page), when there is one: Recreate's prompt and copy use it. */
  profile?: import("./product-insight").ProductProfile | null;
  /** The brand system (Brand page), when there is one: Recreate's prompt takes our look, banned words and offers from it. */
  system?: import("./brand-system").BrandSystem | null;
}

/** A Studio presenter avatar (creative_catalog), offered for recreated videos. */
export interface ResearchAvatar { id: string; name: string; type?: string | null; gender?: string | null }

/** A file import in the last day (`ad_pulls` with source meta_local), with what its file said about the run. */
export interface LocalRunRow {
  id: string;
  status: PullRow["status"];
  started_at: string;
  input: {
    page_id?: string | null;
    page_name?: string | null;
    scraped_at?: string | null;
    complete?: boolean;
    stopped_reason?: string | null;
    run_safety?: RunSafety | null;
  } | null;
}

export interface ResearchData {
  workspace: { id: string; name: string };
  ads: PaidAdRow[];
  /** More ads to load (`?adsFrom=<adsNext>`): the answer carries the first slice only, null when it's all. */
  adsNext?: number | null;
  /** All the workspace's (visible) ads, so the page can ask for the remaining slices in parallel. */
  adsTotal?: number | null;
  watchlist: WatchRow[];
  pulls: PullRow[];
  /** File imports of the last 24 hours, newest first (for the collection safety card). */
  localRuns?: LocalRunRow[];
  /** Each Facebook Page's newest file import (Page id → when it was collected), for the competitor list's "Updated". */
  lastImports?: Record<string, string>;
  brand?: ResearchBrand;
  avatars?: ResearchAvatar[];
  suggestions: Suggestion[];
  health: ResearchHealth | null;
  /** Creative files saved to storage (null when the research function couldn't say). */
  mediaStatus?: MediaStatus | null;
  /** Our product images (Product page), for Recreate's "Your images". */
  assets?: import("./product-assets").ProductAsset[];
  error?: string;
}

/**
 * A competitor's page in the Meta Ad Library, to open in a new tab and collect with the extension: its
 * Page's active ads when the Page id is known, otherwise a keyword search for its name. Always every
 * country, so the collected file has all the Page's ads (the competitor's countries only steer pulls).
 */
export function adLibraryLink(w: Pick<WatchRow, "name" | "page_id" | "search_terms">): { url: string; exact: boolean } {
  const query = new URLSearchParams({ active_status: "active", ad_type: "all", country: "ALL", is_targeted_country: "false", media_type: "all" });
  if (w.page_id) {
    query.set("search_type", "page");
    query.set("view_all_page_id", w.page_id);
  } else {
    query.set("q", w.search_terms || w.name);
    query.set("search_type", "keyword_unordered");
  }
  return { url: `https://www.facebook.com/ads/library/?${query}`, exact: Boolean(w.page_id) };
}

/** How fresh a competitor's ads are: up to date for a week, due in the second, out of date after. */
export const FRESH_DAYS = 7;
export const STALE_DAYS = 14;
export type Freshness = "fresh" | "due" | "stale" | "never";
export function freshness(updatedAt: string | null | undefined, now = Date.now()): Freshness {
  const at = updatedAt ? Date.parse(updatedAt) : NaN;
  if (Number.isNaN(at)) return "never";
  const days = (now - at) / 86_400_000;
  return days <= FRESH_DAYS ? "fresh" : days <= STALE_DAYS ? "due" : "stale";
}

/** An ad running at least this long is very likely profitable for the advertiser. */
export const LONG_RUNNING_DAYS = 21;

export function daysRunning(ad: Pick<PaidAdRow, "started_at" | "stopped_at">, now = Date.now()): number | null {
  if (!ad.started_at) return null;
  const start = Date.parse(ad.started_at);
  const end = ad.stopped_at ? Date.parse(ad.stopped_at) : now;
  return Number.isNaN(start) ? null : Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
}

// MARK: Rank against age

/**
 * Meta's impressions rank (the position under its "total impressions" sort when collected, 1 = most) gets
 * better the longer an ad runs, whether it works or not: an advertiser that never pauses anything has
 * old ads at the top. So an ad is judged against the rank its age predicts: expected rank ≈ a − b·ln(days+1).
 * The default (184.6 − 40.3·ln(days+1)) was fitted on 64 ads of one advertiser and is only a starting
 * point; an account with at least RANK_FIT_MIN ranked ads gets its own curve (least squares on ln(days+1)).
 */
export interface RankFit { a: number; b: number; n: number; fitted: boolean }
export const DEFAULT_RANK_FIT: RankFit = { a: 184.6, b: 40.3, n: 0, fitted: false };
/** Ranked ads an account needs before its own curve replaces the default. */
export const RANK_FIT_MIN = 15;
/** "Outperforms its age by N" from this many places better than expected (and the own ads' Top filter). */
export const OUTPERFORM_MIN = 10;

/** The impressions rank an ad of this age usually has (never better than 1). */
export function expectedRank(days: number, fit: Pick<RankFit, "a" | "b"> = DEFAULT_RANK_FIT): number {
  return Math.max(1, Math.round((fit.a - fit.b * Math.log(Math.max(0, days) + 1)) * 10) / 10);
}

/** The curve for one account's ranked ads: fitted with RANK_FIT_MIN or more (and ages that differ), else the default. */
export function fitRankCurve(points: { days: number; rank: number }[]): RankFit {
  const ok = points.filter((p) => Number.isFinite(p.days) && p.days >= 0 && Number.isFinite(p.rank) && p.rank >= 1);
  if (ok.length < RANK_FIT_MIN) return { ...DEFAULT_RANK_FIT, n: ok.length };
  const xs = ok.map((p) => Math.log(p.days + 1));
  const mx = xs.reduce((s, x) => s + x, 0) / ok.length;
  const my = ok.reduce((s, p) => s + p.rank, 0) / ok.length;
  let sxx = 0, sxy = 0;
  ok.forEach((p, i) => { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (p.rank - my); });
  if (sxx < 1e-9) return { ...DEFAULT_RANK_FIT, n: ok.length };
  const slope = sxy / sxx;
  const round = (v: number) => Math.round(v * 10) / 10;
  return { a: round(my - slope * mx), b: round(-slope), n: ok.length, fitted: true };
}

type RankedPick = Pick<PaidAdRow, "started_at" | "stopped_at" | "impressions_rank"> & Partial<Pick<PaidAdRow, "page_id" | "page_name" | "last_seen_at">>;

/** The account an ad's rank compares within (one scrape is one Page). */
export const rankAccount = (ad: Partial<Pick<PaidAdRow, "page_id" | "page_name">>) => ad.page_id || ad.page_name || "";

/** How old the ad was when it was ranked: at its last import (the rank's scrape), else today. */
export function rankAge(ad: RankedPick, now = Date.now()): number | null {
  const seen = ad.last_seen_at ? Date.parse(ad.last_seen_at) : NaN;
  return daysRunning(ad, Number.isNaN(seen) ? now : Math.min(seen, now));
}

/** One curve per account (rankAccount): its own when it has enough ranked ads, else the default. */
export function rankFits(ads: RankedPick[], now = Date.now()): Map<string, RankFit> {
  const points = new Map<string, { days: number; rank: number }[]>();
  for (const ad of ads) {
    const days = rankAge(ad, now);
    if (ad.impressions_rank == null || days == null) continue;
    const key = rankAccount(ad);
    points.set(key, [...(points.get(key) ?? []), { days, rank: ad.impressions_rank }]);
  }
  return new Map([...points].map(([key, list]) => [key, fitRankCurve(list)]));
}

export const fitFor = (fits: Map<string, RankFit> | null | undefined, ad: Partial<Pick<PaidAdRow, "page_id" | "page_name">>) => fits?.get(rankAccount(ad)) ?? DEFAULT_RANK_FIT;

/** Places better than its age predicts (positive: it outperforms its age); null without a rank or a start date. */
export function outperformsBy(ad: RankedPick, fit: Pick<RankFit, "a" | "b"> = DEFAULT_RANK_FIT, now = Date.now()): number | null {
  const days = rankAge(ad, now);
  if (ad.impressions_rank == null || days == null) return null;
  return Math.round(expectedRank(days, fit) - ad.impressions_rank);
}

export interface RankedAdRow extends PaidAdRow { days: number | null; groupSize: number; score: number }

/** Long-running ads first, boosted by how many live ads share the creative (the advertiser is scaling it). */
export function rankAds(ads: PaidAdRow[], now = Date.now()): RankedAdRow[] {
  const groups = new Map<string, number>();
  for (const ad of ads) if (ad.active && ad.creative_key) groups.set(ad.creative_key, (groups.get(ad.creative_key) ?? 0) + 1);
  return ads.map((ad) => {
    const days = daysRunning(ad, now);
    const groupSize = Math.max(ad.variants, ad.creative_key ? groups.get(ad.creative_key) ?? 1 : 1);
    const base = days ?? (ad.metrics?.ctr ? ad.metrics.ctr * 100 : 1);
    // Meta's "Low impression count" (under 100): not a winner however long it has run.
    const reach = ad.library?.lowImpressions ? 0.25 : 1;
    return { ...ad, days, groupSize, score: Math.round(base * (1 + Math.log2(groupSize)) * (ad.active ? 1 : 0.5) * reach * 10) / 10 };
  }).sort((a, b) => b.score - a.score);
}

export const MEDIA_LABEL: Record<AdMediaType, string> = {
  video: "Video", image: "Image", carousel: "Carousel", dco: "Dynamic", text: "Text", unknown: "Unknown",
};

export const PLACEMENT_LABEL: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", audience_network: "Audience Network", messenger: "Messenger", threads: "Threads", whatsapp: "WhatsApp", tiktok: "TikTok",
};

export const SOURCE_LABEL: Record<AdSource, string> = {
  meta_api: "Meta Ad Library API", meta_apify: "Automatic collection", meta_mcp: "Meta Ads import", meta_local: "Ad Library extension",
  tiktok_library: "TikTok Ad Library", tiktok_creative_center: "TikTok Top Ads", tiktok_apify: "TikTok collection",
};

export const NETWORK_LABEL: Record<AdNetwork, string> = { meta: "Meta", tiktok: "TikTok" };

/** Ad formats the reader can pick on top of the organic library (mirrors AD_FORMATS in the engine). */
export const AD_FORMAT_LABEL: Record<string, string> = {
  hook_demo: "Hook + demo", static_benefit: "Static benefit image", reddit_style: "Reddit-style post", tweet_style: "Tweet-style screenshot",
  ai_ugc: "AI / actor UGC", before_after: "Before / after", us_vs_them: "Us vs them", quiz_funnel: "Quiz / result reveal",
  testimonial_review: "Reviews / social proof", green_screen: "Green screen", founder_story: "Founder / expert to camera",
  storytime: "Storytime", how_to_steps: "How-to steps", proof_then_method: "I did X, here's how", listicle: "Listicle", myth_vs_reality: "Myth vs reality",
  news_update: "News / update", explainer: "Explainer", expert_answers: "Expert answers", hack_or_secret: "Hack / secret", comparison: "This vs that",
  pov_skit: "POV skit", day_in_life: "Day in the life", reaction: "Reaction", silent_text: "Silent text", product_demo: "Product demo",
  ugc_testimonial: "UGC testimonial", challenge_or_test: "I tested it", behind_the_scenes: "Behind the scenes", motivational: "Motivation", no_clear_format: "No clear format",
};

// MARK: Files from the Ad Library extension

export const LOCAL_SCHEMA = "radar.meta-ad-library/v1";
/**
 * Ads one import saves at most, a sanity limit (the biggest advertisers run ~9,000): a bigger file imports
 * its first ones (Meta's impressions order) and marks nothing as stopped. Big files go up in batches
 * (lib/scrape-import.ts).
 */
export const LOCAL_MAX_ADS = 20_000;

/** How a collection run went against its safety limits (the file's `run_safety`). */
export interface RunSafety {
  runs_today: number;
  minutes_since_previous_run: number | null;
  /** Other runs open on the machine when this one started (0 = it ran alone). */
  concurrent_runs: number;
  /** Overrides used: --yes, --concurrent, --force-today, --max-pages N. */
  overrides: string[];
  warnings: string[];
}

/** A collected ads file, as far as the studio reads it. */
export interface LocalScrape {
  schema: string;
  scraped_at?: string;
  input_url?: string;
  complete?: boolean;
  stopped_reason?: string | null;
  pages_loaded?: number;
  advertiser?: { page_id?: string; page_name?: string; page_url?: string; ad_library_url?: string; page_like_count?: number };
  summary?: { total_ads?: number; active_ads?: number; meta_reported_total?: number; creative_types?: Partial<Record<"video" | "image" | "carousel" | "dco" | "other", number>> };
  ads: Record<string, unknown>[];
  run_safety?: RunSafety;
}

/** What the confirm dialog shows before an import. Counts from the ads themselves when the summary is missing. */
export function summarizeScrape(file: LocalScrape) {
  const ads = Array.isArray(file.ads) ? file.ads : [];
  const types = { video: 0, image: 0, carousel: 0, dco: 0, other: 0 };
  for (const ad of ads) {
    const kind = String(ad.creative_type ?? "").toLowerCase() as keyof typeof types;
    types[kind in types ? kind : "other"]++;
  }
  return {
    pageName: file.advertiser?.page_name || "Unknown advertiser",
    pageId: file.advertiser?.page_id ?? null,
    ads: ads.length,
    active: file.summary?.active_ads ?? ads.filter((ad) => /^active$/i.test(String(ad.status ?? ""))).length,
    types: { ...types, ...file.summary?.creative_types },
    scrapedAt: file.scraped_at ?? null,
    complete: file.complete === true,
    stoppedReason: file.stopped_reason ?? null,
  };
}

// The raw Ad Library fields the research function reads (fromMetaLibrary); everything else is dropped
// before upload, which keeps each ad small (~9 KB instead of ~11 KB+, ~1.3 KB gzipped).
const RAW_KEYS = [
  "ad_archive_id", "adArchiveID", "adArchiveId", "adid", "id", "total_active_time", "totalActiveTime", "is_active", "isActive",
  "start_date", "startDate", "end_date", "endDate", "collation_id", "collationID", "collationId", "collation_count", "collationCount",
  "page_id", "pageID", "pageId", "page_name", "pageName", "publisher_platform", "publisherPlatform", "publisher_platforms", "publisherPlatforms",
  "targeted_or_reached_countries", "reachedCountries", "reach_estimate", "reachEstimate",
  "impressions_with_index", "impressionsWithIndex", "gated_type", "gatedType", "contains_digital_created_media", "containsDigitalCreatedMedia",
  "contains_sensitive_content", "containsSensitiveContent", "categories",
];
const SNAPSHOT_KEYS = [
  "display_format", "displayFormat", "title", "link_description", "linkDescription", "cta_text", "ctaText", "link_url", "linkUrl", "page_id", "pageId", "page_name", "pageName",
  "branded_content", "brandedContent", "page_profile_uri", "pageProfileUri", "page_profile_picture_url", "pageProfilePictureUrl", "page_categories", "pageCategories",
  "page_like_count", "pageLikeCount", "caption", "cta_type", "ctaType",
];
const MEDIA_KEYS = [
  "video_hd_url", "videoHdUrl", "video_sd_url", "videoSdUrl", "video_preview_image_url", "videoPreviewImageUrl",
  "original_image_url", "originalImageUrl", "resized_image_url", "resizedImageUrl",
  "body", "title", "link_description", "linkDescription", "cta_text", "ctaText", "link_url", "linkUrl",
];
type Obj = Record<string, unknown>;
const keep = (from: unknown, keys: string[]): Obj => {
  const out: Obj = {};
  if (from && typeof from === "object") for (const k of keys) if ((from as Obj)[k] != null) out[k] = (from as Obj)[k];
  return out;
};
const keepList = (value: unknown) => (Array.isArray(value) ? value.slice(0, 30).map((item) => keep(item, MEDIA_KEYS)) : undefined);

/** One ad without what the import doesn't read: raw is cut to the fields above. */
export function slimAd(ad: Record<string, unknown>): Record<string, unknown> {
  const raw = ad.raw as Obj | undefined;
  if (!raw || typeof raw !== "object") return ad;
  const snap = raw.snapshot as Obj | undefined;
  const body = snap?.body;
  return {
    ...ad,
    raw: {
      ...keep(raw, RAW_KEYS),
      snapshot: snap ? {
        ...keep(snap, SNAPSHOT_KEYS),
        body: typeof body === "string" ? body : { text: (body as Obj | undefined)?.text ?? "" },
        videos: keepList(snap.videos), images: keepList(snap.images), cards: keepList(snap.cards),
      } : undefined,
    },
  };
}

/** The file without what the import doesn't read (every ad slimmed), at most LOCAL_MAX_ADS ads. */
export function slimScrape(file: LocalScrape): LocalScrape {
  return { ...file, ads: file.ads.slice(0, LOCAL_MAX_ADS).map(slimAd) };
}

// MARK: Sizes

const RATIOS: [string, number][] = [["9:16", 9 / 16], ["2:3", 2 / 3], ["3:4", 3 / 4], ["4:5", 4 / 5], ["1:1", 1], ["4:3", 4 / 3], ["16:9", 16 / 9], ["1.91:1", 1.91]];

/** "9:16" when the size is within 2% of a common ratio, else "0.82:1". */
export function aspectLabel(width: number, height: number): string {
  const r = width / height;
  const near = RATIOS.find(([, value]) => Math.abs(Math.log(r / value)) < 0.02);
  return near ? near[0] : `${r.toFixed(2)}:1`;
}

/** "1080 × 1920 · 9:16 · 15 s" (each part only when known). */
export function sizeLine(m: { width?: number | null; height?: number | null; duration?: number | null; aspect?: string | null }): string {
  const parts: string[] = [];
  if (m.width && m.height) parts.push(`${m.width} × ${m.height}`, m.aspect || aspectLabel(m.width, m.height));
  else if (m.aspect) parts.push(m.aspect);
  if (m.duration) parts.push(`${m.duration < 10 ? Math.round(m.duration * 10) / 10 : Math.round(m.duration)} s`);
  return parts.join(" · ");
}

// MARK: Collection safety

/** After a block the extension refuses to run for this long. */
export const SCRAPE_COOLDOWN_MS = 6 * 3_600_000;
/** The extension asks to confirm a run that starts sooner than this after the previous one. */
export const SCRAPE_GAP_MINUTES = 30;
/** More runs than this in a day get a warning (the extension asks to confirm past 20). */
export const SCRAPE_DAILY_WARN = 10;
export const SCRAPE_RULE = "The extension collects one competitor at a time, at least 30 minutes apart, and stops for 6 hours if Meta shows a block sign. It runs in its own small window: keep part of it visible while you work elsewhere.";
const PARALLEL_WHY = "Parallel or back-to-back sessions from one connection are a common reason Meta blocks it for hours.";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isBlocked = (reason: string | null | undefined) => /^blocked/i.test(reason ?? "");

/** When the cooldown ends: 6 hours after the run started (the block came during it, so this is the earliest). */
export function cooldownUntil(scrapedAt: string | null | undefined): Date | null {
  const start = scrapedAt ? Date.parse(scrapedAt) : NaN;
  return Number.isNaN(start) ? null : new Date(start + SCRAPE_COOLDOWN_MS);
}

/** What the import dialog says about the file's run: one summary line, other warnings, and whether Meta blocked it. */
export function runSafetySummary(file: Pick<LocalScrape, "run_safety" | "stopped_reason" | "scraped_at">) {
  const s = file.run_safety;
  const parts: string[] = [];
  if (s?.concurrent_runs) parts.push(`ran while ${s.concurrent_runs} other scrape${s.concurrent_runs === 1 ? " was" : "s were"} open`);
  if (s?.minutes_since_previous_run != null && s.minutes_since_previous_run < SCRAPE_GAP_MINUTES) parts.push(`started ${s.minutes_since_previous_run} min after the previous run`);
  if (s && s.runs_today > SCRAPE_DAILY_WARN) parts.push(`run ${s.runs_today} today`);
  if (s?.overrides.length) parts.push(`overrides used: ${s.overrides.join(", ")}`);
  // The file's own warnings repeat the first three; keep only the others (a challenge, say).
  const other = (s?.warnings ?? []).filter((w) => !/^(Ran while|Started \d+ min after|Run \d+ today)/i.test(w));
  const blocked = isBlocked(file.stopped_reason);
  return { line: parts.length ? `This run: ${parts.join(" · ")}` : null, other, blocked, until: blocked ? cooldownUntil(file.scraped_at) : null };
}

export interface ScrapeWarning {
  kind: "blocked" | "back_to_back" | "overlap" | "many";
  title: string;
  why: string;
  todo: string;
}

/**
 * The Research page's collection safety card: warnings from the extension's runs of the last 24 hours
 * (one import per run; a file imported twice counts once). `newestId` is the newest import behind a
 * warning, so a dismissed card comes back only when a newer run warns.
 */
export function scrapeWarnings(runs: LocalRunRow[], now = Date.now(), formatTime: (d: Date) => string = (d) => d.toLocaleString()): { warnings: ScrapeWarning[]; newestId: string | null } {
  const seen = new Set<string>();
  const list = runs
    .map((r) => ({ ...r, at: Date.parse(r.input?.scraped_at ?? r.started_at) }))
    .filter((r) => !Number.isNaN(r.at) && now - r.at <= 24 * 3_600_000 && r.at <= now + 60_000)
    .filter((r) => {
      const key = `${r.input?.page_id ?? r.input?.page_name ?? ""}|${r.input?.scraped_at ?? r.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.at - a.at);
  const warnings: ScrapeWarning[] = [];
  const behind = new Set<string>();

  const blocked = list.filter((r) => isBlocked(r.input?.stopped_reason) && now - r.at < SCRAPE_COOLDOWN_MS);
  if (blocked.length) {
    const until = new Date(Math.max(...blocked.map((r) => r.at)) + SCRAPE_COOLDOWN_MS);
    const page = blocked[0].input?.page_name;
    warnings.push({
      kind: "blocked",
      title: `Meta blocked a run${page ? ` (${page})` : ""} in the last 6 hours. Cooldown until ${formatTime(until)}.`,
      why: "The extension stopped and started a 6-hour cooldown. Visiting the Ad Library again from the same connection before it ends can stretch the block.",
      todo: `Don't collect again before ${formatTime(until)}; the extension refuses until then. After that, one run at a time, at least 30 min apart.`,
    });
    blocked.forEach((r) => behind.add(r.id));
  }

  // Back to back: two runs' start times under 30 min apart, or a run that says so itself.
  let gap: number | null = null;
  for (let i = 0; i < list.length; i++) {
    const own = list[i].input?.run_safety?.minutes_since_previous_run;
    const next = list[i + 1];
    const between = next ? Math.round((list[i].at - next.at) / 60_000) : null;
    for (const m of [own, between]) {
      if (m != null && m < SCRAPE_GAP_MINUTES) {
        gap = gap == null ? m : Math.min(gap, m);
        behind.add(list[i].id);
      }
    }
  }
  if (gap != null) {
    warnings.push({
      kind: "back_to_back",
      title: `Runs started less than 30 min apart (${gap} min at the closest).`,
      why: PARALLEL_WHY,
      todo: "Leave at least 30 min between runs. The extension asks you to confirm a sooner one; keep that for when you really need it.",
    });
  }

  const overlapping = list.filter((r) => (r.input?.run_safety?.concurrent_runs ?? 0) > 0);
  if (overlapping.length) {
    warnings.push({
      kind: "overlap",
      title: `${overlapping.length === 1 ? "A run" : `${overlapping.length} runs`} overlapped another one on the same machine.`,
      why: PARALLEL_WHY,
      todo: "Collect one competitor at a time: wait for the open run to finish before starting the next.",
    });
    overlapping.forEach((r) => behind.add(r.id));
  }

  const most = Math.max(list.length, ...list.map((r) => r.input?.run_safety?.runs_today ?? 0));
  if (most > SCRAPE_DAILY_WARN) {
    warnings.push({
      kind: "many",
      title: `${plural(most, "run")} in a day.`,
      why: "Frequent visits to the Ad Library from one connection can get it challenged, and a challenge means a 6-hour cooldown.",
      todo: "Collect each advertiser once a day at most and spread runs out. Past 20 runs in a day the extension asks you to confirm.",
    });
    list.forEach((r) => behind.add(r.id));
  }

  const newest = list.find((r) => behind.has(r.id));
  return { warnings, newestId: newest?.id ?? null };
}

// MARK: The ads list: quick filters, groups, summary, and the view in the URL

/** "Long runners" on the quick filters: still live and started at least this long ago. */
export const LONG_RUNNER_DAYS = 30;
export const NEW_DAYS = 7;
export const MANY_VARIANTS = 3;
export const TOP_IMPRESSIONS = 25;

/** A stopped ad that ran under this many days was most likely a test that lost. */
export const LOST_TEST_DAYS = 21;
/** "Recently stopped": stopped within this many days (an import marks ads that left the Ad Library as stopped). */
export const RECENT_STOP_DAYS = 14;

export type QuickFilter = "long" | "new" | "variants" | "top" | "partnership" | "no_low" | "stopped" | "lost_test" | "fatigued";
export const QUICK_FILTERS: { id: QuickFilter; label: string; title: string }[] = [
  { id: "long", label: `Long runners (${LONG_RUNNER_DAYS}+ days)`, title: "Still live and started 30+ days ago: an advertiser that keeps paying for an ad is telling you it works" },
  { id: "new", label: "New this week", title: "Started in the last 7 days" },
  { id: "variants", label: `Many variants (${MANY_VARIANTS}+)`, title: "Meta shows 3 or more ads using this creative" },
  { id: "top", label: `Top ${TOP_IMPRESSIONS} by Meta's impressions order`, title: "In the first 25 under Meta's \"total impressions\" sort when the advertiser's ads were collected" },
  { id: "partnership", label: "Partnership ads", title: "Run with a creator or another Page (Meta's branded content): who they pay to post for them" },
  { id: "no_low", label: "Hide low impressions", title: "Leave out ads Meta marks \"Low impression count\" (under 100 impressions)" },
  { id: "stopped", label: "Recently stopped", title: `Stopped in the last ${RECENT_STOP_DAYS} days: gone from the Ad Library since an earlier import` },
  { id: "lost_test", label: `Stopped within ${LOST_TEST_DAYS} days`, title: `Stopped after running under ${LOST_TEST_DAYS} days: most likely a test that lost` },
  { id: "fatigued", label: `Stopped after ${LONG_RUNNER_DAYS}+ days`, title: `Ran ${LONG_RUNNER_DAYS}+ days, then stopped: a former winner that wore out` },
];
/** The quick filters that only match stopped ads (turning one on turns "Active only" off). */
export const STOPPED_FILTERS: QuickFilter[] = ["stopped", "lost_test", "fatigued"];
/** Our own ads' "Top": nothing gets paused there, so age alone puts old ads first; the rank is judged against age instead. */
export const OWN_TOP_FILTER = {
  label: "Top: beats its age",
  title: `Meta's impressions rank at least ${OUTPERFORM_MIN} places better than an ad of its age usually gets (expected rank ≈ 184.6 − 40.3·ln(days+1), fitted to the account once it has ${RANK_FIT_MIN}+ ranked ads)`,
};
export const SIGNALS_NOTE = "Meta doesn't share spend or conversions for these ads outside the EU; long runs, many variants and Meta's impressions order are the best signals of what's working.";

/**
 * Whether an ad passes a quick filter. "Top" for our own ads means it beats its age curve by
 * OUTPERFORM_MIN or more (`fits`: rankFits of the list); for competitors' it's the first 25 by impressions.
 */
export function passes(ad: Pick<PaidAdRow, "active" | "started_at" | "variants" | "impressions_rank" | "library"> & Partial<Pick<PaidAdRow, "is_own" | "stopped_at" | "last_seen_at" | "page_id" | "page_name">>, filter: QuickFilter, now = Date.now(), fits?: Map<string, RankFit> | null): boolean {
  if (filter === "top" && ad.is_own) return (outperformsBy({ stopped_at: null, ...ad }, fitFor(fits, ad), now) ?? -Infinity) >= OUTPERFORM_MIN;
  if (filter === "partnership") return Boolean(ad.library?.partner);
  if (filter === "no_low") return !ad.library?.lowImpressions;
  if (filter === "stopped" || filter === "lost_test" || filter === "fatigued") {
    if (ad.active || !ad.stopped_at) return false;
    if (filter === "stopped") return (now - Date.parse(ad.stopped_at)) / 86_400_000 <= RECENT_STOP_DAYS;
    const ran = daysRunning({ started_at: ad.started_at, stopped_at: ad.stopped_at }, now);
    return ran != null && (filter === "lost_test" ? ran < LOST_TEST_DAYS : ran >= LONG_RUNNER_DAYS);
  }
  const started = ad.started_at ? Date.parse(ad.started_at) : NaN;
  const age = Number.isNaN(started) ? null : (now - started) / 86_400_000;
  if (filter === "long") return ad.active && age != null && age >= LONG_RUNNER_DAYS;
  if (filter === "new") return age != null && age <= NEW_DAYS;
  if (filter === "variants") return ad.variants >= MANY_VARIANTS;
  return ad.impressions_rank != null && ad.impressions_rank <= TOP_IMPRESSIONS;
}

export type TypeGroup = "video" | "image" | "carousel" | "dco" | "other";
export const TYPE_GROUPS: { id: TypeGroup; label: string }[] = [
  { id: "video", label: "Video" }, { id: "image", label: "Image" }, { id: "carousel", label: "Carousel" }, { id: "dco", label: "Dynamic (DCO)" }, { id: "other", label: "Other" },
];
/** The creative-type group an ad is listed under: a carousel or dynamic ad of videos (`is_video`) under Video. */
export const typeGroup = (type: AdMediaType, isVideo?: boolean | null): TypeGroup =>
  (isVideo ? "video" : type === "video" || type === "image" || type === "carousel" || type === "dco" ? type : "other");

/** The strip above the list: totals, by creative type, median days running, share of long runners. */
export function summarizeAds(ads: Pick<PaidAdRow, "active" | "started_at" | "stopped_at" | "variants" | "impressions_rank" | "media_type" | "is_video">[], now = Date.now()) {
  const days = ads.map((ad) => daysRunning(ad, now)).filter((d): d is number => d != null).sort((a, b) => a - b);
  const mid = Math.floor(days.length / 2);
  const median = days.length ? (days.length % 2 ? days[mid] : Math.round((days[mid - 1] + days[mid]) / 2)) : null;
  const byType = Object.fromEntries(TYPE_GROUPS.map((g) => [g.id, 0])) as Record<TypeGroup, number>;
  for (const ad of ads) byType[typeGroup(ad.media_type, ad.is_video)]++;
  const long = ads.filter((ad) => passes(ad, "long", now)).length;
  return { total: ads.length, active: ads.filter((ad) => ad.active).length, byType, medianDays: median, longShare: ads.length ? long / ads.length : 0 };
}

// MARK: Launched (new ads by calendar day)

/** The "Launched" filter: one calendar day ("0" today, "1" yesterday … "6"), or a window ("le2" the last 3 days, "le6" under 7 days). */
export type LaunchWindow = "" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "le2" | "le6";
export const LAUNCH_WINDOWS: { id: Exclude<LaunchWindow, "">; label: string }[] = [
  { id: "0", label: "Today" }, { id: "1", label: "Yesterday" },
  { id: "2", label: "2 days ago" }, { id: "3", label: "3 days ago" }, { id: "4", label: "4 days ago" }, { id: "5", label: "5 days ago" }, { id: "6", label: "6 days ago" },
  { id: "le2", label: "Last 3 days" }, { id: "le6", label: "Under 7 days" },
];
const LAUNCH_IDS = LAUNCH_WINDOWS.map((w) => w.id);

/**
 * Calendar days since an ad's launch: 0 = launched today, 1 = yesterday. The Ad Library's start date is a day
 * (stored as midnight Pacific, e.g. 07:00Z), so the launch day is the date part of `started_at`; today is the
 * viewer's local date.
 */
export function launchDaysAgo(ad: Pick<PaidAdRow, "started_at">, now = Date.now()): number | null {
  const m = ad.started_at?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const today = new Date(now);
  const diff = (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86_400_000;
  return Math.max(0, Math.round(diff));
}

/** Whether an ad's launch day falls in a "Launched" window ("" lets every ad through). */
export function inLaunchWindow(ad: Pick<PaidAdRow, "started_at">, window: LaunchWindow, now = Date.now()): boolean {
  if (!window) return true;
  const ago = launchDaysAgo(ad, now);
  if (ago == null) return false;
  if (window === "le2") return ago <= 2;
  if (window === "le6") return ago <= 6;
  return ago === Number(window);
}

export type AdSort = "score" | "impressions" | "days" | "variants" | "newest";
/** The fit filter: the AI scan's fit level, "unchecked" for ads without one, "" for all. */
export type AdFitFilter = "" | "fits" | "partly" | "doesnt_fit" | "unchecked";
export interface AdView {
  competitor: string;
  network: string;
  placement: string;
  media: string;
  minDays: number;
  /** Ads launched on a calendar day or in a recent window (see LAUNCH_WINDOWS); "" for any. */
  launched: LaunchWindow;
  quick: QuickFilter[];
  activeOnly: boolean;
  /** One card per creative (Meta's collation), or every ad. */
  grouped: boolean;
  /** Sections by creative type. */
  byType: boolean;
  sort: AdSort;
  /** Whether the AI scan found the ad fits what we sell (advice only). */
  fit: AdFitFilter;
  /** Whose ads: competitors' (default) or ours. */
  side: "competitors" | "ours";
  /** The decoder's format (AD_FORMAT_LABEL key) and hook type (HOOK_LABEL key); "" for any. */
  format: string;
  hook: string;
}
export const DEFAULT_VIEW: AdView = { competitor: "", network: "", placement: "", media: "", minDays: 0, launched: "", quick: [], activeOnly: true, grouped: true, byType: false, sort: "score", fit: "", side: "competitors", format: "", hook: "" };
/** Whether an ad's decoded format and hook match the view's (empty matches any). */
export const matchesRead = (ad: Pick<PaidAdRow, "decoded">, view: Pick<AdView, "format" | "hook">) =>
  (!view.format || ad.decoded?.format === view.format) && (!view.hook || ad.decoded?.hookType === view.hook);
const SORTS: AdSort[] = ["score", "impressions", "days", "variants", "newest"];
const FIT_FILTERS: AdFitFilter[] = ["fits", "partly", "doesnt_fit", "unchecked"];
const QUICK_IDS = QUICK_FILTERS.map((q) => q.id);

/**
 * One-click views over the ads: each sets the filters, sort and "Active only" together (the competitor and
 * the side stay as picked).
 */
export interface AdPreset { id: string; label: string; title: string; view: Partial<AdView>; /** Only on this side ("ours" or "competitors"). */ side?: AdView["side"] }
/** "Due for a refresh": our live ads running this long, likely wearing out. */
export const REFRESH_DAYS = 45;
export const AD_PRESETS: AdPreset[] = [
  { id: "winners", label: "Proven winners", title: `Live and running ${LONG_RUNNER_DAYS}+ days, strongest first: what they keep paying for`, view: { quick: ["long"], sort: "score" } },
  { id: "scaling", label: "Being scaled", title: `Live creatives with ${MANY_VARIANTS}+ copies running: what they're putting more money behind`, view: { quick: ["variants"], sort: "variants" } },
  { id: "early", label: "New and already scaled", title: `Launched this week and already ${MANY_VARIANTS}+ copies: an early bet worth watching`, view: { quick: ["new", "variants"], sort: "variants" } },
  { id: "fresh", label: "Launched this week", title: "Their newest tests, newest first", view: { launched: "le6", sort: "newest" } },
  { id: "statics", label: "Winning statics", title: `Image ads live ${LONG_RUNNER_DAYS}+ days`, view: { media: "image", quick: ["long"], sort: "score" } },
  { id: "videos", label: "Winning videos", title: `Video ads live ${LONG_RUNNER_DAYS}+ days`, view: { media: "video", quick: ["long"], sort: "score" } },
  { id: "creators", label: "Creator ads that last", title: `Partnership ads (run with a creator's or another Page) live ${LONG_RUNNER_DAYS}+ days`, view: { quick: ["partnership", "long"], sort: "score" } },
  { id: "fatigued", label: "Worn-out winners", title: `Ran ${LONG_RUNNER_DAYS}+ days, then stopped: what worked until it didn't, and angles they may come back to`, view: { quick: ["fatigued"], activeOnly: false, sort: "days" } },
  { id: "lost", label: "Lost tests", title: `Stopped within ${LOST_TEST_DAYS} days: what didn't work for them`, view: { quick: ["lost_test"], activeOnly: false, sort: "newest" } },
  { id: "refresh", label: "Due for a refresh", title: `Our ads live ${REFRESH_DAYS}+ days, oldest first: likely wearing out, so make the next version before they stop`, view: { minDays: REFRESH_DAYS, sort: "days" }, side: "ours" },
];
/** The presets offered on a side. */
export const presetsFor = (side: AdView["side"]) => AD_PRESETS.filter((p) => !p.side || p.side === side);
/** A preset applied to the current view: everything reset but the side and the competitor. */
export const applyPreset = (view: AdView, preset: AdPreset): AdView => ({ ...DEFAULT_VIEW, side: view.side, competitor: view.competitor, ...preset.view });
/** The preset the view is exactly (its side and competitor aside), if any. */
export function presetOf(view: AdView): string | null {
  const key = (v: AdView) => viewToQuery({ ...v, side: "competitors", competitor: "", quick: [...v.quick].sort() }).toString();
  const current = key(view);
  return presetsFor(view.side).find((p) => key(applyPreset(view, p)) === current)?.id ?? null;
}

// MARK: Insights (who's testing, scaling and stopping; what lasts)

type InsightAd = Pick<PaidAdRow, "active" | "started_at" | "stopped_at" | "variants" | "media_type" | "is_video" | "competitor" | "page_name" | "page_id" | "decoded" | "first_seen_at">;
/**
 * "Kept": of the ads first seen here at least this many days ago, the share still running. The app only ever
 * sees ads that were live at an import, so judging by launch date would count almost every old ad as lasting;
 * judging from when it was first seen here is fair to every ad.
 */
export const KEPT_AFTER_DAYS = 14;
/** Whether an ad was first seen here long enough ago to say if it was kept. */
const keptKnown = (ad: Pick<PaidAdRow, "first_seen_at">, now: number) => Boolean(ad.first_seen_at) && (now - Date.parse(ad.first_seen_at)) / 86_400_000 >= KEPT_AFTER_DAYS;
const WEEK = 7 * 86_400_000;
export const INSIGHT_WEEKS = 8;

export interface CompetitorStats {
  name: string;
  pageId: string | null;
  live: number;
  /** Launched in the last 14 days (live or not). */
  launched: number;
  /** Stopped in the last 14 days. */
  stopped: number;
  /** Of its ads first seen here KEPT_AFTER_DAYS+ days ago, the share still running (null with under 10 such ads). */
  keptRate: number | null;
  /** Live ads running 30+ days. */
  longRunners: number;
  /** Live ads with 3+ copies. */
  scaled: number;
  /** Share of live ads that are video. */
  videoShare: number | null;
  /** Ads launched per week, oldest first (the last INSIGHT_WEEKS weeks, this week last). */
  weekly: number[];
}

/** Per competitor: how fast it tests, how much it keeps, what it scales. Sorted by live ads. */
export function competitorStats(ads: InsightAd[], now = Date.now()): CompetitorStats[] {
  const groups = new Map<string, InsightAd[]>();
  for (const ad of ads) {
    const name = ad.competitor ?? ad.page_name;
    const list = groups.get(name);
    if (list) list.push(ad);
    else groups.set(name, [ad]);
  }
  return [...groups.entries()].map(([name, list]) => {
    const live = list.filter((ad) => ad.active);
    const ageOf = (ad: InsightAd) => (ad.started_at ? (now - Date.parse(ad.started_at)) / 86_400_000 : null);
    const old = list.filter((ad) => keptKnown(ad, now));
    const weekly = Array.from({ length: INSIGHT_WEEKS }, () => 0);
    for (const ad of list) {
      const age = ad.started_at ? now - Date.parse(ad.started_at) : NaN;
      const week = Math.floor(age / WEEK);
      if (week >= 0 && week < INSIGHT_WEEKS) weekly[INSIGHT_WEEKS - 1 - week]++;
    }
    return {
      name, pageId: list.find((ad) => ad.page_id)?.page_id ?? null,
      live: live.length,
      launched: list.filter((ad) => { const age = ageOf(ad); return age != null && age <= 14; }).length,
      stopped: list.filter((ad) => !ad.active && ad.stopped_at && (now - Date.parse(ad.stopped_at)) / 86_400_000 <= 14).length,
      keptRate: old.length >= 10 ? old.filter((ad) => ad.active).length / old.length : null,
      longRunners: live.filter((ad) => (ageOf(ad) ?? 0) >= LONG_RUNNER_DAYS).length,
      scaled: live.filter((ad) => ad.variants >= MANY_VARIANTS).length,
      videoShare: live.length ? live.filter((ad) => ad.media_type === "video" || Boolean(ad.is_video)).length / live.length : null,
      weekly,
    };
  }).sort((a, b) => b.live - a.live || a.name.localeCompare(b.name));
}

/** One side's numbers for "How we compare" (all its Pages together). */
export interface SideStats { live: number; launched: number; keptRate: number | null; longShare: number | null; videoShare: number | null; medianDays: number | null }
export function sideStats(ads: InsightAd[], now = Date.now()): SideStats {
  const [all] = competitorStats(ads.map((ad) => ({ ...ad, competitor: "all", page_name: "all" })), now);
  const live = ads.filter((ad) => ad.active).map((ad) => daysRunning(ad, now)).filter((d): d is number => d != null).sort((a, b) => a - b);
  return {
    live: all?.live ?? 0, launched: all?.launched ?? 0, keptRate: all?.keptRate ?? null,
    longShare: all?.live ? all.longRunners / all.live : null, videoShare: all?.videoShare ?? null,
    medianDays: live.length ? live[Math.floor(live.length / 2)] : null,
  };
}
const median = (values: (number | null)[]) => {
  const list = values.filter((v): v is number => v != null).sort((a, b) => a - b);
  return list.length ? (list.length % 2 ? list[(list.length - 1) / 2] : (list[list.length / 2 - 1] + list[list.length / 2]) / 2) : null;
};
/** The typical competitor: each number is the median across competitors (each competitor counts once). */
export function typicalCompetitor(ads: InsightAd[], now = Date.now()): SideStats {
  const names = [...new Set(ads.map((ad) => ad.competitor ?? ad.page_name))];
  const each = names.map((name) => sideStats(ads.filter((ad) => (ad.competitor ?? ad.page_name) === name), now));
  return {
    live: median(each.map((s) => s.live)) ?? 0, launched: median(each.map((s) => s.launched)) ?? 0, keptRate: median(each.map((s) => s.keptRate)),
    longShare: median(each.map((s) => s.longShare)), videoShare: median(each.map((s) => s.videoShare)), medianDays: median(each.map((s) => s.medianDays)),
  };
}

/**
 * Formats (or hooks) competitors keep running that we barely use: their kept share is at least their
 * average, they have `min`+ ads seen long enough ago to tell, and we run `maxOurs` or fewer of it live. Best first.
 */
export function readGaps(theirs: InsightAd[], ours: InsightAd[], by: "format" | "hook", now = Date.now(), min = 10, maxOurs = 2) {
  const rows = lastingBy(theirs, now, min)[by];
  const known = rows.reduce((sum, r) => sum + r.ads, 0);
  const average = known ? rows.reduce((sum, r) => sum + r.lasted, 0) / known : 0;
  const keyOf = (ad: InsightAd) => (by === "format" ? ad.decoded?.format : ad.decoded?.hookType);
  return rows
    .filter((r) => r.rate >= average)
    .map((r) => ({ ...r, ours: ours.filter((ad) => ad.active && keyOf(ad) === r.key).length, theirLive: theirs.filter((ad) => ad.active && keyOf(ad) === r.key).length }))
    .filter((r) => r.ours <= maxOurs);
}

export interface LastingRow { key: string; ads: number; lasted: number; rate: number }
/**
 * What lasts: of the ads first seen here KEPT_AFTER_DAYS+ days ago, the share still running ("kept"), by the
 * decoder's format, its hook type and the creative type. Groups with fewer than `min` such ads are left out.
 */
export function lastingBy(ads: InsightAd[], now = Date.now(), min = 10): { format: LastingRow[]; hook: LastingRow[]; type: LastingRow[] } {
  const known = ads.filter((ad) => keptKnown(ad, now));
  const lasted = (ad: InsightAd) => ad.active;
  const group = (keyOf: (ad: InsightAd) => string | null | undefined) => {
    const map = new Map<string, { ads: number; lasted: number }>();
    for (const ad of known) {
      const key = keyOf(ad);
      if (!key) continue;
      const row = map.get(key) ?? { ads: 0, lasted: 0 };
      row.ads++;
      if (lasted(ad)) row.lasted++;
      map.set(key, row);
    }
    return [...map.entries()].filter(([, r]) => r.ads >= min).map(([key, r]) => ({ key, ...r, rate: r.lasted / r.ads })).sort((a, b) => b.rate - a.rate || b.ads - a.ads);
  };
  return {
    format: group((ad) => (ad.decoded?.format && ad.decoded.format !== "no_clear_format" ? ad.decoded.format : null)),
    hook: group((ad) => ad.decoded?.hookType),
    type: group((ad) => typeGroup(ad.media_type, ad.is_video)),
  };
}

/** The list's view from the page's query (?adv=&net=&plat=&type=&days=&new=le6&f=long,new&active=0&every=1&group=type&sort=days&fit=partly&fmt=&hook=). */
export function viewFromQuery(query: string | URLSearchParams): AdView {
  const p = typeof query === "string" ? new URLSearchParams(query) : query;
  const days = Number(p.get("days"));
  const sort = p.get("sort") as AdSort;
  const fit = p.get("fit") as AdFitFilter;
  const launched = p.get("new") as LaunchWindow;
  return {
    competitor: p.get("adv")?.slice(0, 120) ?? "", network: p.get("net")?.slice(0, 20) ?? "", placement: p.get("plat")?.slice(0, 40) ?? "", media: p.get("type")?.slice(0, 20) ?? "",
    minDays: Number.isFinite(days) && days > 0 ? Math.min(365, Math.round(days)) : 0,
    launched: LAUNCH_IDS.includes(launched as Exclude<LaunchWindow, "">) ? launched : "",
    quick: (p.get("f") ?? "").split(",").filter((f): f is QuickFilter => QUICK_IDS.includes(f as QuickFilter)),
    activeOnly: p.get("active") !== "0",
    grouped: p.get("every") !== "1",
    byType: p.get("group") === "type",
    sort: SORTS.includes(sort) ? sort : "score",
    fit: FIT_FILTERS.includes(fit) ? fit : "",
    side: p.get("side") === "ours" ? "ours" : "competitors",
    format: p.get("fmt")?.slice(0, 40) ?? "",
    hook: p.get("hook")?.slice(0, 40) ?? "",
  };
}

/** The view as query params, leaving out what's at its default. */
export function viewToQuery(view: AdView, base: string | URLSearchParams = ""): URLSearchParams {
  const p = new URLSearchParams(base);
  const set = (key: string, value: string | null) => (value ? p.set(key, value) : p.delete(key));
  set("adv", view.competitor); set("net", view.network); set("plat", view.placement); set("type", view.media);
  set("days", view.minDays ? String(view.minDays) : null);
  set("new", view.launched || null);
  set("f", view.quick.length ? [...new Set(view.quick)].join(",") : null);
  set("active", view.activeOnly ? null : "0");
  set("every", view.grouped ? null : "1");
  set("group", view.byType ? "type" : null);
  set("sort", view.sort === "score" ? null : view.sort);
  set("fit", view.fit || null);
  set("side", view.side === "ours" ? "ours" : null);
  set("fmt", view.format || null);
  set("hook", view.hook || null);
  return p;
}
