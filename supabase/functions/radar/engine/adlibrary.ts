// Competitors' PAID ads: what the Meta Ad Library (official API or an Apify scraper) and TikTok's ad
// libraries return, mapped into one `PaidAd` shape, ranked by how long each ad has been running and
// how many variants of its creative are live (an advertiser that keeps paying for an ad for weeks is
// telling you it works), and mapped into the `Reel` shape so Jev decodes ads like organic posts.
// Plain TypeScript with no runtime APIs, like the rest of the engine.
import type { Format, Reel, Segment } from "./types.ts";

// MARK: Shapes

export type AdNetwork = "meta" | "tiktok" | "google";
/**
 * Where the ad was read from. `meta_mcp` is a manual import of the Meta Ads MCP's `ads_library_search`
 * output; `meta_local` an import of the local Ad Library scraper's file (scripts/meta-ad-library).
 */
export type AdSource = "meta_api" | "meta_apify" | "meta_mcp" | "meta_local" | "tiktok_library" | "tiktok_creative_center" | "tiktok_apify" | "google_apify";
/** Where the ad is shown. TikTok ads are always `tiktok`; Google's are its surfaces (search, YouTube…). */
export type AdPlacement = "facebook" | "instagram" | "audience_network" | "messenger" | "threads" | "whatsapp" | "tiktok"
  | "google_search" | "youtube" | "google_shopping" | "google_maps" | "google_play";
export type AdMediaType = "video" | "image" | "carousel" | "dco" | "text" | "unknown";

export interface AdMedia {
  type: "video" | "image";
  url: string;
  /** Video poster frame. */
  thumb?: string | null;
}

/**
 * What else Meta's Ad Library says about an ad, beyond the creative and dates (all optional; older
 * imports and other sources have none of it).
 */
export interface AdLibraryDetails {
  /** Meta's impressions bucket: "<100" with index 0 is its "Low impression count" badge. */
  impressions?: { text: string; index: number } | null;
  lowImpressions?: boolean;
  /** The account the ad ran from (a creator's, for many partnership ads). */
  postedAs?: { name: string; pageId: string | null; profileUrl: string | null; picture: string | null; categories: string[]; likes: number | null } | null;
  /** Partnership ad (branded content): the other side of the partnership, from the advertiser's view. */
  partner?: { name: string; pageId: string | null; profileUrl: string | null } | null;
  /** Meta's CTA type, e.g. DOWNLOAD, SIGN_UP, LEARN_MORE, INSTALL_MOBILE_APP. */
  ctaType?: string | null;
  /** The domain under the ad (Meta's caption) and the link's own host. */
  landingDomain?: string | null;
  linkHost?: string | null;
  /** The attribution / deep-link tool the link goes through (AppStack, AppsFlyer, Adjust, Branch…). */
  tracking?: string | null;
  /** Shown only to signed-in adults (Meta's LOGGED_OUT gating). */
  ageGated?: boolean;
  /** Meta's "AI info" label: the media was made or edited with AI. */
  aiGenerated?: boolean;
  sensitive?: boolean;
  /** Special ad categories (housing, employment, credit, politics…); UNKNOWN is dropped. */
  categories?: string[];
  /** Google: the Transparency Center's own preview of a text, video or rich ad (it has no file to save). */
  previewUrl?: string | null;
}

/** The attribution or deep-link tool behind a link, from its host. */
export function trackingTool(host: string | null): string | null {
  if (!host) return null;
  const h = host.toLowerCase();
  if (h.endsWith("appstack.link")) return "AppStack";
  if (h.endsWith("onelink.me") || h.includes("appsflyer")) return "AppsFlyer";
  if (h.endsWith("adj.st") || h.endsWith("adjust.com") || h.endsWith("go.link")) return "Adjust";
  if (h.endsWith("app.link") || h.endsWith("branch.io") || h.endsWith("bnc.lt")) return "Branch";
  if (h.endsWith("sng.link") || h.includes("singular")) return "Singular";
  if (h.endsWith("kochava.com")) return "Kochava";
  if (h.endsWith("apps.apple.com") || h.endsWith("itunes.apple.com")) return "App Store";
  if (h.endsWith("play.google.com")) return "Google Play";
  return null;
}

/** The extra details in one Meta Ad Library result (the scraper's raw JSON or an Apify item). */
export function libraryDetails(raw: RawMetaLibrary, advertiser: { pageId: string | null; pageName: string }): AdLibraryDetails {
  const snap: RawMetaLibrary = pick(raw, "snapshot") ?? {};
  const imp = pick(raw, "impressionsWithIndex", "impressions_with_index");
  const impText = str(imp?.impressions_text ?? imp?.impressionsText);
  const impIndex = Number(imp?.impressions_index ?? imp?.impressionsIndex);
  const impressions = impText && Number.isFinite(impIndex) && impIndex >= 0 ? { text: impText, index: impIndex } : null;

  const posterName = str(pick(snap, "pageName", "page_name"));
  const posterId = str(pick(snap, "pageId", "page_id")) || null;
  const postedAs = posterName ? {
    name: posterName, pageId: posterId,
    profileUrl: str(pick(snap, "pageProfileUri", "page_profile_uri")) || null,
    picture: str(pick(snap, "pageProfilePictureUrl", "page_profile_picture_url")) || null,
    categories: list(pick(snap, "pageCategories", "page_categories")).map(str).filter(Boolean),
    likes: Number.isFinite(Number(pick(snap, "pageLikeCount", "page_like_count"))) ? Number(pick(snap, "pageLikeCount", "page_like_count")) : null,
  } : null;

  // Branded content: the sponsor's Page. The partner is whichever side isn't the advertiser.
  const branded: RawMetaLibrary | null = pick(snap, "brandedContent", "branded_content") ?? null;
  const sponsorName = branded ? str(pick(branded, "pageName", "page_name")) : "";
  const sponsorId = branded ? str(pick(branded, "pageId", "page_id")) || null : null;
  const same = (id: string | null, name: string) => (id && advertiser.pageId ? id === advertiser.pageId : name.toLowerCase() === advertiser.pageName.toLowerCase());
  let partner: AdLibraryDetails["partner"] = null;
  if (branded && sponsorName) {
    partner = !same(sponsorId, sponsorName)
      ? { name: sponsorName, pageId: sponsorId, profileUrl: str(pick(branded, "pageProfileUri", "page_profile_uri")) || null }
      : postedAs && !same(postedAs.pageId, postedAs.name) ? { name: postedAs.name, pageId: postedAs.pageId, profileUrl: postedAs.profileUrl } : null;
  } else if (postedAs && !same(postedAs.pageId, postedAs.name)) {
    partner = { name: postedAs.name, pageId: postedAs.pageId, profileUrl: postedAs.profileUrl };
  }

  const link = str(pick(snap, "linkUrl", "link_url"));
  const linkHost = (() => { try { return link ? new URL(link).hostname.replace(/^www\./, "") : null; } catch { return null; } })();
  const categories = list(pick(raw, "categories")).map(str).filter((c) => c && c !== "UNKNOWN");
  return {
    impressions, lowImpressions: impressions?.index === 0,
    postedAs, partner,
    ctaType: str(pick(snap, "ctaType", "cta_type")) || null,
    landingDomain: str(pick(snap, "caption")).toLowerCase() || null,
    linkHost, tracking: trackingTool(linkHost),
    ageGated: str(pick(raw, "gatedType", "gated_type")) === "LOGGED_OUT",
    aiGenerated: pick(raw, "containsDigitalCreatedMedia", "contains_digital_created_media") === true,
    sensitive: pick(raw, "containsSensitiveContent", "contains_sensitive_content") === true,
    categories,
  };
}

export interface PaidAd {
  /** The library's id: Meta's ad archive id, TikTok's ad id. */
  adId: string;
  network: AdNetwork;
  source: AdSource;
  /** The advertiser as the library names it (Meta: the Page). */
  pageId: string | null;
  pageName: string;
  /** The competitor this ad was pulled for (our watchlist's name), when known. */
  competitor?: string | null;
  startedAt: string | null;
  /** Null while it runs. */
  stoppedAt: string | null;
  active: boolean;
  placements: AdPlacement[];
  mediaType: AdMediaType;
  body: string;
  headline: string;
  description: string;
  cta: string;
  linkUrl: string | null;
  media: AdMedia[];
  thumb: string | null;
  /** Meta: the public Ad Library page for this ad. */
  snapshotUrl: string | null;
  countries: string[];
  languages: string[];
  /** Meta groups ads that share a creative and text ("N ads use this creative and text"). */
  collationId: string | null;
  /** How many live ads use this creative (1 when unknown). */
  variants: number;
  /** Meta Ad Library extras (impressions bucket, partnership, landing, tracking…). */
  library?: AdLibraryDetails | null;
  /** EU reach (DSA) or TikTok's reach bucket, when the source has it. */
  reach: number | null;
  /** Creative Center only: TikTok's own performance hints. */
  metrics?: { ctr?: number | null; likes?: number | null; budget?: string | null } | null;
}

/** Days from the first day shown to today (or the last day shown). */
export function daysRunning(ad: Pick<PaidAd, "startedAt" | "stoppedAt">, now = Date.now()): number | null {
  if (!ad.startedAt) return null;
  const start = Date.parse(ad.startedAt);
  if (Number.isNaN(start)) return null;
  const end = ad.stoppedAt ? Date.parse(ad.stoppedAt) : now;
  return Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
}

// MARK: Helpers

const str = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "").trim();
const first = (...values: unknown[]) => values.map(str).find(Boolean) ?? "";
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : value == null ? [] : [value]);
/** Unix seconds, milliseconds, or an ISO / "YYYY-MM-DD" string → ISO, or null. */
export function isoDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const n = Number(value);
    const ms = n < 1e12 ? n * 1000 : n;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
/** Meta's text fields sometimes carry template tokens like {{product.name}}. */
const tidy = (text: string) => text.replace(/\{\{[^}]+\}\}/g, "").replace(/\s+\n/g, "\n").trim();

const PLACEMENTS: Record<string, AdPlacement> = {
  facebook: "facebook", instagram: "instagram", audience_network: "audience_network", messenger: "messenger",
  threads: "threads", whatsapp: "whatsapp", tiktok: "tiktok",
  // Google Ads Transparency Center's surfaces.
  search: "google_search", google_search: "google_search", youtube: "youtube", shopping: "google_shopping", google_shopping: "google_shopping",
  maps: "google_maps", google_maps: "google_maps", play: "google_play", google_play: "google_play",
};
const placementsOf = (value: unknown): AdPlacement[] =>
  [...new Set(list(value).map((p) => PLACEMENTS[str(p).toLowerCase()]).filter(Boolean))];

function mediaTypeOf(media: AdMedia[], hint: string): AdMediaType {
  const h = hint.toLowerCase();
  if (h.includes("dco") || h.includes("dpa")) return "dco";
  if (h.includes("carousel") || h.includes("multi")) return "carousel";
  if (h.includes("video")) return "video";
  if (h.includes("image") || h.includes("meme")) return "image";
  if (media.some((m) => m.type === "video")) return "video";
  if (media.length > 1) return "carousel";
  if (media.length === 1) return "image";
  return h === "text" || h === "none" ? "text" : "unknown";
}

/**
 * Whether an ad plays as a video, whatever Meta calls its format: Meta says "video", or it has a video
 * and at least as many videos as images (a "carousel" or dynamic ad of videos). `media_type` keeps
 * Meta's format; this is stored as `paid_ads.is_video` when the ad is saved (migration
 * 20261005500000). Twin of isVideoAd in studio/src/lib/recreate.ts; a test keeps them in step
 * (scripts/creative-runner/tests/video-ad.test.ts).
 */
export function isVideoAd(mediaType: string | null | undefined, media: readonly ({ type?: string | null } | null | undefined)[] | null | undefined): boolean {
  if (mediaType === "video") return true;
  const list = media ?? [];
  const videos = list.filter((m) => m?.type === "video").length;
  const images = list.filter((m) => m?.type === "image").length;
  return videos > 0 && videos >= images;
}

// MARK: Meta Ad Library API (Graph `ads_archive`)

export const META_GRAPH_VERSION = "v26.0";

/**
 * Fields the official API returns. Commercial ads come back only for ads delivered to the EU (DSA,
 * since Aug 2023) or the UK (since July 2025), on a rolling year; for any other country only
 * political/issue ads. It never returns image or video URLs, nor Meta's "N ads use this creative"
 * grouping: the creative is only viewable through `ad_snapshot_url`, which embeds the caller's token
 * (so it's never stored). `eu_total_reach` and `beneficiary_payers` are EU-only.
 */
export const META_AD_FIELDS = [
  "id", "page_id", "page_name", "ad_creation_time", "ad_delivery_start_time", "ad_delivery_stop_time",
  "ad_creative_bodies", "ad_creative_link_titles", "ad_creative_link_descriptions", "ad_creative_link_captions",
  "ad_snapshot_url", "publisher_platforms", "languages", "eu_total_reach", "total_reach_by_location", "beneficiary_payers",
];

/** EU and EEA countries, plus the UK, where the API returns commercial ads (DSA transparency). */
export const META_API_COMMERCIAL_COUNTRIES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "GB",
];

export interface MetaQuery {
  /** Up to 10 Page ids per request. */
  pageIds?: string[];
  searchTerms?: string;
  countries: string[];
  activeOnly?: boolean;
  limit?: number;
  after?: string;
}

/** The request URL (without the token, which the caller adds as `access_token`). */
export function metaAdLibraryUrl(q: MetaQuery): string {
  const params = new URLSearchParams({
    ad_type: "ALL",
    ad_reached_countries: JSON.stringify(q.countries.map((c) => c.toUpperCase())),
    ad_active_status: q.activeOnly === false ? "ALL" : "ACTIVE",
    fields: META_AD_FIELDS.join(","),
    limit: String(Math.min(500, q.limit ?? 200)),
  });
  if (q.pageIds?.length) params.set("search_page_ids", JSON.stringify(q.pageIds.slice(0, 10)));
  if (q.searchTerms) params.set("search_terms", q.searchTerms.slice(0, 100));
  if (q.after) params.set("after", q.after);
  return `https://graph.facebook.com/${META_GRAPH_VERSION}/ads_archive?${params}`;
}

export interface RawMetaApi {
  id?: string; page_id?: string | number; page_name?: string;
  ad_creation_time?: string | number; ad_delivery_start_time?: string | number; ad_delivery_stop_time?: string | number;
  ad_creative_bodies?: string[]; ad_creative_link_titles?: string[]; ad_creative_link_descriptions?: string[]; ad_creative_link_captions?: string[];
  /** The Meta Ads MCP returns these singular forms. */
  ad_creative_link_title?: string; ad_creative_body?: string;
  ad_snapshot_url?: string; publisher_platforms?: string[]; languages?: string[]; eu_total_reach?: number;
  target_locations?: { name?: string; type?: string; excluded?: boolean }[];
}

/** One `ads_archive` item (or a Meta Ads MCP `ads_library_search` item) → PaidAd. */
export function fromMetaApi(raw: RawMetaApi, o: { source?: AdSource; countries?: string[] } = {}): PaidAd | null {
  const adId = str(raw.id);
  if (!adId) return null;
  const stoppedAt = isoDate(raw.ad_delivery_stop_time);
  const bodies = list(raw.ad_creative_bodies ?? raw.ad_creative_body).map(str).filter(Boolean);
  const titles = list(raw.ad_creative_link_titles ?? raw.ad_creative_link_title).map(str).filter(Boolean);
  return {
    adId, network: "meta", source: o.source ?? "meta_api",
    pageId: str(raw.page_id) || null, pageName: str(raw.page_name) || "Unknown advertiser",
    startedAt: isoDate(raw.ad_delivery_start_time) ?? isoDate(raw.ad_creation_time), stoppedAt,
    active: !stoppedAt || Date.parse(stoppedAt) > Date.now(),
    placements: placementsOf(raw.publisher_platforms),
    // The API has no media: variants of a dynamic ad show up as several bodies/titles.
    mediaType: bodies.length > 1 || titles.length > 1 ? "dco" : "unknown",
    body: tidy(bodies[0] ?? ""), headline: tidy(titles[0] ?? ""),
    description: tidy(first(...list(raw.ad_creative_link_descriptions))), cta: "",
    linkUrl: first(...list(raw.ad_creative_link_captions)) || null,
    // The API's ad_snapshot_url carries the access token: link the public Ad Library page instead.
    media: [], thumb: null, snapshotUrl: `https://www.facebook.com/ads/library/?id=${adId}`,
    countries: o.countries ?? [], languages: list(raw.languages).map(str).filter(Boolean),
    collationId: null, variants: Math.max(1, bodies.length, titles.length),
    reach: typeof raw.eu_total_reach === "number" ? raw.eu_total_reach : null,
  };
}

/** The Meta Ads MCP wraps its answer as `{ results: "<json>" }`; accepts that, the inner object or a plain list. */
export function fromMetaMcp(payload: unknown, countries: string[] = []): PaidAd[] {
  let value: unknown = payload;
  if (value && typeof value === "object" && typeof (value as { results?: unknown }).results === "string") {
    try { value = JSON.parse((value as { results: string }).results); } catch { return []; }
  }
  const ads = Array.isArray(value) ? value : list((value as { ads?: unknown })?.ads ?? (value as { data?: unknown })?.data);
  return ads.flatMap((raw) => {
    const ad = fromMetaApi(raw as RawMetaApi, { source: "meta_mcp", countries });
    return ad ? [ad] : [];
  });
}

// MARK: Meta Ad Library via Apify (the fallback for US/IN/non-EU commercial ads)

/**
 * Apify actors that read the public Ad Library web pages (every active commercial ad in any country,
 * with media, start date, platforms and Meta's collation count). Both bill per ad and need no
 * Facebook login; neither is run without the user confirming the cost. Ids, input fields and prices
 * checked on the Apify Store on 19 November 2026 (both actors updated that week).
 */
export const META_APIFY_ACTORS = {
  /** Default (the community actor): $0.75 per 1,000 ads. Input `urls` (Ad Library search or Page URLs) + `count`; raw snake_case output. */
  curious: "curious_coder~facebook-ads-library-scraper",
  /** Apify's own: $5.80 per 1,000 on the free plan ($3.40 on Business). Input `startUrls` + `resultsLimit` per URL; camelCase output. */
  official: "apify~facebook-ads-scraper",
} as const;

/** Price per ad by actor (USD, Apify free plan), for the confirm dialog. */
export const META_APIFY_PRICE_PER_AD: Record<keyof typeof META_APIFY_ACTORS, number> = { curious: 0.00075, official: 0.0058 };

/** An Ad Library web URL for one Page or one keyword search, which the scrapers take as input. */
export function adLibraryUrl(o: { pageId?: string; searchTerms?: string; country?: string; activeOnly?: boolean; mediaType?: "all" | "video" | "image" }): string {
  const params = new URLSearchParams({
    active_status: o.activeOnly === false ? "all" : "active",
    ad_type: "all",
    country: (o.country ?? "ALL").toUpperCase(),
    media_type: o.mediaType ?? "all",
  });
  if (o.pageId) { params.set("search_type", "page"); params.set("view_all_page_id", o.pageId); }
  else { params.set("search_type", "keyword_unordered"); params.set("q", o.searchTerms ?? ""); }
  return `https://www.facebook.com/ads/library/?${params}`;
}

export function metaApifyInput(o: { urls: string[]; limitPerUrl: number; actor?: keyof typeof META_APIFY_ACTORS }) {
  const actor = o.actor ?? "curious";
  return actor === "official"
    // `resultsLimit` is per URL on Apify's actor (its input schema: "Results limit per URL").
    ? { startUrls: o.urls.map((url) => ({ url })), resultsLimit: o.limitPerUrl, activeStatus: "active" }
    : { urls: o.urls.map((url) => ({ url })), count: o.limitPerUrl * o.urls.length, limitPerSource: o.limitPerUrl, scrapeAdDetails: false, "scrapePageAds.activeStatus": "active" };
}

/** The Ad Library's own JSON, as the scrapers pass it on (camelCase or snake_case depending on the actor). */
export type RawMetaLibrary = Record<string, any>;

const pick = (raw: RawMetaLibrary, ...keys: string[]) => keys.map((k) => raw?.[k]).find((v) => v != null && v !== "");

/**
 * One scraped Ad Library item → PaidAd. Tolerates both actors' field spellings, and the local
 * scraper's `raw` (Meta's own `collated_results` item) with `source: "meta_local"`.
 */
export function fromMetaLibrary(raw: RawMetaLibrary, o: { source?: AdSource; competitor?: string | null; countries?: string[] } = {}): PaidAd | null {
  const adId = str(pick(raw, "adArchiveID", "ad_archive_id", "adArchiveId", "adid", "id"));
  // Some actors give `total_active_time` (seconds) instead of a start date.
  const activeSeconds = Number(pick(raw, "totalActiveTime", "total_active_time"));
  if (!adId) return null;
  const snap: RawMetaLibrary = pick(raw, "snapshot") ?? {};
  const cards: RawMetaLibrary[] = list(pick(snap, "cards")) as RawMetaLibrary[];
  const media: AdMedia[] = [];
  const addVideo = (v: RawMetaLibrary) => {
    const url = str(pick(v, "videoHdUrl", "video_hd_url", "videoSdUrl", "video_sd_url"));
    if (url) media.push({ type: "video", url, thumb: str(pick(v, "videoPreviewImageUrl", "video_preview_image_url")) || null });
  };
  const addImage = (i: RawMetaLibrary) => {
    const url = str(pick(i, "originalImageUrl", "original_image_url", "resizedImageUrl", "resized_image_url"));
    if (url) media.push({ type: "image", url });
  };
  list(pick(snap, "videos")).forEach((v) => addVideo(v as RawMetaLibrary));
  list(pick(snap, "images")).forEach((i) => addImage(i as RawMetaLibrary));
  cards.forEach((card) => { addVideo(card); addImage(card); });

  const bodyField = pick(snap, "body");
  const body = tidy(typeof bodyField === "string" ? bodyField : str(bodyField?.text ?? bodyField?.markup?.__html)) || tidy(first(cards[0]?.body));
  const stoppedAt = raw.isActive === true || raw.is_active === true ? null : isoDate(pick(raw, "endDate", "end_date"));
  const format = str(pick(snap, "displayFormat", "display_format"));
  const collation = Number(pick(raw, "collationCount", "collation_count") ?? 1);
  const pageId = str(pick(raw, "pageID", "page_id", "pageId")) || str(pick(snap, "pageId", "page_id")) || null;
  const pageName = first(pick(raw, "pageName", "page_name"), pick(snap, "pageName", "page_name")) || "Unknown advertiser";
  return {
    adId, network: "meta", source: o.source ?? "meta_apify",
    pageId,
    pageName,
    competitor: o.competitor ?? null,
    startedAt: isoDate(pick(raw, "startDate", "start_date", "startDateFormatted", "start_date_formatted"))
      ?? (activeSeconds > 0 ? new Date(Date.now() - activeSeconds * 1000).toISOString() : null),
    stoppedAt,
    active: Boolean(pick(raw, "isActive", "is_active") ?? !stoppedAt),
    placements: placementsOf(pick(raw, "publisherPlatform", "publisher_platform", "publisherPlatforms", "publisher_platforms")),
    mediaType: mediaTypeOf(media, cards.length > 1 ? "carousel" : format),
    body,
    headline: tidy(first(pick(snap, "title"), cards[0]?.title)),
    description: tidy(first(pick(snap, "linkDescription", "link_description"), cards[0]?.linkDescription, cards[0]?.link_description)),
    cta: first(pick(snap, "ctaText", "cta_text"), cards[0]?.ctaText, cards[0]?.cta_text),
    linkUrl: first(pick(snap, "linkUrl", "link_url"), cards[0]?.linkUrl, cards[0]?.link_url) || null,
    media,
    thumb: media.find((m) => m.type === "image")?.url ?? media.find((m) => m.thumb)?.thumb ?? null,
    snapshotUrl: `https://www.facebook.com/ads/library/?id=${adId}`,
    countries: o.countries ?? list(pick(raw, "reachedCountries", "targeted_or_reached_countries")).map(str).filter(Boolean),
    languages: [],
    collationId: str(pick(raw, "collationID", "collation_id", "collationId")) || null,
    variants: Number.isFinite(collation) && collation > 0 ? collation : 1,
    reach: Number(pick(raw, "reachEstimate", "reach_estimate")) || null,
    library: libraryDetails(raw, { pageId, pageName }),
  };
}

// MARK: TikTok

/**
 * TikTok's Commercial Content API (the Ad Library behind library.tiktok.com): every ad shown in the
 * EU/EEA, the UK and Switzerland (from Oct 2022), queried with a client-credentials token. Access is
 * by application and TikTok describes it as a research tool, so approval for a marketing tool is uncertain.
 */
export const TIKTOK_LIBRARY = {
  token: "https://open.tiktokapis.com/v2/oauth/token/",
  adQuery: "https://open.tiktokapis.com/v2/research/adlib/ad/query/",
  adDetail: "https://open.tiktokapis.com/v2/research/adlib/ad/detail/",
  advertiserQuery: "https://open.tiktokapis.com/v2/research/adlib/advertiser/query/",
  fields: "ad.id,ad.first_shown_date,ad.last_shown_date,ad.status,ad.videos,ad.image_urls,ad.reach,advertiser.business_id,advertiser.business_name,advertiser.paid_for_by",
} as const;

export const tiktokTokenBody = (clientKey: string, clientSecret: string) =>
  new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, grant_type: "client_credentials" });

/** Body for an ad query: by advertiser ids or a search term, in one EU country, over a date range. */
export function tiktokLibraryQuery(o: { advertiserIds?: string[]; searchTerm?: string; country?: string; sinceDays?: number; max?: number; searchId?: string }) {
  const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
  return {
    filters: {
      ad_published_date_range: { min: day(o.sinceDays ?? 90), max: day(0) },
      country_code: (o.country ?? "ALL").toUpperCase(),
      ...(o.advertiserIds?.length ? { advertiser_business_ids: o.advertiserIds.map(Number) } : {}),
    },
    ...(o.searchTerm ? { search_term: o.searchTerm.slice(0, 50) } : {}),
    max_count: Math.min(50, o.max ?? 50),
    ...(o.searchId ? { search_id: o.searchId } : {}),
  };
}

export function fromTikTokLibrary(raw: Record<string, any>, competitor?: string | null): PaidAd | null {
  const ad = raw.ad ?? raw;
  const advertiser = raw.advertiser ?? {};
  const adId = str(ad.id);
  if (!adId) return null;
  const media: AdMedia[] = [
    ...list(ad.videos).map((v: any) => ({ type: "video" as const, url: str(v?.url), thumb: str(v?.cover_image_url) || null })),
    ...list(ad.image_urls).map((url) => ({ type: "image" as const, url: str(url) })),
  ].filter((m) => m.url);
  const last = isoDate(ad.last_shown_date);
  const active = str(ad.status).toLowerCase() === "active" || (last ? Date.now() - Date.parse(last) < 2 * 86_400_000 : false);
  return {
    adId, network: "tiktok", source: "tiktok_library",
    pageId: str(advertiser.business_id) || null, pageName: str(advertiser.business_name) || "Unknown advertiser", competitor: competitor ?? null,
    startedAt: isoDate(ad.first_shown_date), stoppedAt: active ? null : last, active,
    placements: ["tiktok"], mediaType: mediaTypeOf(media, ""),
    body: "", headline: "", description: "", cta: "", linkUrl: null,
    media, thumb: media.find((m) => m.thumb)?.thumb ?? media.find((m) => m.type === "image")?.url ?? null,
    snapshotUrl: `https://library.tiktok.com/ads/detail/?ad_id=${adId}`,
    countries: [], languages: [], collationId: null, variants: 1,
    reach: Number(ad.reach?.unique_users_seen ?? ad.reach) || null,
  };
}

/**
 * Apify actors for TikTok (no TikTok login needed), checked on the Apify Store on 19 November 2026.
 * Creative Center "Top Ads" covers 24 markets including the US but ranks by performance, by industry
 * and keyword, never by brand, and has no dates. A brand's own ads are only listed in TikTok's Ad
 * Library, which holds ads shown in the EU/EEA, the UK and Switzerland; US-only ads aren't visible anywhere.
 */
export const TIKTOK_APIFY_ACTORS = {
  /** $1 per 1,000 + $0.005 per run (+$2/1,000 with details). Input countryCode (24 markets), period "7"/"30"/"180" (text), keyword, maxItems. Video links expire in 1–2 days. */
  topAds: "azzouzana~tiktok-creative-center-top-ads-scraper",
  /** $3 per 1,000. TikTok's Ad Library (Europe): advertiser name (`search`) or business id (`adv_biz_ids`), region, status. */
  library: "s-r~tiktok-ads-library",
} as const;

/** The markets the Top Ads actor offers (its input schema's `countryCode` list). */
export const TIKTOK_TOP_ADS_COUNTRIES = ["US", "CA", "MX", "BR", "GB", "DE", "FR", "IT", "ES", "NL", "PL", "SE", "TR", "SA", "AE", "AU", "JP", "KR", "ID", "TH", "VN", "MY", "PH", "SG"];

export const tiktokTopAdsInput = (o: { country?: string; periodDays?: 7 | 30 | 180; keyword?: string; max?: number }) => {
  const country = (o.country ?? "US").toUpperCase();
  return {
    countryCode: TIKTOK_TOP_ADS_COUNTRIES.includes(country) ? country : "US",
    // The actor's schema takes the period as text ("7", "30" or "180"); a number fails its input check.
    period: String(o.periodDays ?? 30), ...(o.keyword ? { keyword: o.keyword } : {}), maxItems: o.max ?? 100,
  };
};

/** One Creative Center "Top Ads" item → PaidAd. There's no start date, so these rank by TikTok's own CTR/likes instead. */
export function fromTikTokTopAd(raw: Record<string, any>): PaidAd | null {
  const adId = str(raw.id ?? raw.material_id ?? raw.ad_id ?? raw.adId);
  if (!adId) return null;
  const video = raw.video_info ?? raw.videoInfo ?? {};
  const url = str(video.video_url?.["720p"] ?? video.video_url?.["540p"] ?? Object.values(video.video_url ?? {})[0] ?? raw.videoUrl ?? raw.video_url);
  const thumb = str(video.cover ?? raw.cover ?? raw.coverUrl) || null;
  return {
    adId, network: "tiktok", source: "tiktok_creative_center",
    pageId: null, pageName: str(raw.brand_name ?? raw.brandName) || "Unknown advertiser",
    startedAt: null, stoppedAt: null, active: true, placements: ["tiktok"],
    mediaType: url ? "video" : "unknown",
    body: tidy(str(raw.ad_title ?? raw.title)), headline: "", description: "", cta: str(raw.cta ?? ""),
    linkUrl: str(raw.landing_page ?? raw.landingPage) || null,
    media: url ? [{ type: "video", url, thumb }] : [], thumb,
    snapshotUrl: `https://ads.tiktok.com/business/creativecenter/topads/${adId}/pc/en`,
    countries: list(raw.country_code).map(str).filter(Boolean), languages: [], collationId: null, variants: 1, reach: null,
    metrics: { ctr: Number(raw.ctr) || null, likes: Number(raw.like) || null, budget: str(raw.cost) || null },
  };
}

/** Days since a date at which an ad still counts as running (the libraries refresh their dates daily, some later). */
const RUNNING_WITHIN_DAYS = 3;
const shownRecently = (iso: string | null, now = Date.now()) => Boolean(iso) && now - Date.parse(iso as string) < RUNNING_WITHIN_DAYS * 86_400_000;
const httpsOn = (value: unknown, host: RegExp): string | null => {
  const url = str(value);
  try { return url && new URL(url).protocol === "https:" && host.test(new URL(url).hostname) ? url : null; } catch { return null; }
};

/**
 * One ad from TikTok's Ad Library read through Apify (`s-r~tiktok-ads-library`): ads shown in Europe,
 * by advertiser name or business id. Count, link-only and summary rows are skipped.
 */
export function fromTikTokEuAd(raw: Record<string, any>, competitor?: string | null): PaidAd | null {
  if (raw.result_type && raw.result_type !== "ad") return null;
  const adId = str(raw.ad_id ?? raw.id);
  if (!adId || !/^\d{5,30}$/.test(adId)) return null;
  const media: AdMedia[] = [
    ...list(raw.videos).map((v: any) => ({ type: "video" as const, url: str(v?.video_url ?? v?.url), thumb: str(v?.cover_image ?? v?.cover_image_url) || null })),
    ...list(raw.image_urls).map((url) => ({ type: "image" as const, url: str(url) })),
  ].filter((m) => m.url);
  const last = isoDate(raw.last_shown);
  const active = shownRecently(last);
  return {
    adId, network: "tiktok", source: "tiktok_apify",
    pageId: str(raw.adv_biz_id ?? raw.advertiser_id ?? raw.business_id) || null, pageName: str(raw.advertiser_name) || "Unknown advertiser", competitor: competitor ?? null,
    startedAt: isoDate(raw.first_shown), stoppedAt: active ? null : last, active,
    placements: ["tiktok"], mediaType: mediaTypeOf(media, str(raw.ad_type)),
    body: tidy(str(raw.ad_text)), headline: "", description: "", cta: "", linkUrl: null,
    media, thumb: media.find((m) => m.thumb)?.thumb ?? media.find((m) => m.type === "image")?.url ?? null,
    snapshotUrl: httpsOn(raw.deeplink, /(^|\.)tiktok\.com$/) ?? `https://library.tiktok.com/ads/detail/?ad_id=${adId}`,
    countries: str(raw.region) && str(raw.region) !== "all" ? [str(raw.region).toUpperCase()] : [], languages: [], collationId: null, variants: 1,
    reach: null,
  };
}

/** Input for the TikTok Ad Library actor: one advertiser, by business id when known, else by name; one European country or all. */
export function tiktokEuInput(o: { businessId?: string | null; name?: string | null; country?: string | null; max?: number }) {
  return {
    // The business id narrows the search on its own only when the name box is empty.
    ...(o.businessId ? { adv_biz_ids: o.businessId } : { search: (o.name ?? "").slice(0, 100), query_type: "1" }),
    region: o.country ? o.country.toUpperCase() : "all",
    ad_status: "active", sort: "last_shown_date,desc", limit: Math.min(500, o.max ?? 100),
  };
}

// MARK: Google Ads Transparency Center (through Apify)

/**
 * Google's ad library: search, YouTube, Shopping, Maps and Play ads by advertiser, in every country
 * Google serves (dates for the last 12 months). Read through `scrapesage~google-ads-transparency-scraper`
 * (checked on the Apify Store on 19 November 2026: $2 per 1,000 ads, $2 per 1,000 for the text of text ads).
 */
export const GOOGLE_APIFY_ACTOR = "scrapesage~google-ads-transparency-scraper";

/** One advertiser's ads: by advertiser id (AR…), else every ad pointing at a website, else a name search (its best match). */
export function googleAdsInput(o: { advertiserId?: string | null; domain?: string | null; name?: string | null; country?: string | null; max?: number }) {
  const target = o.advertiserId ? { advertiserIds: [o.advertiserId] } : o.domain ? { domains: [o.domain] } : { queries: [(o.name ?? "").slice(0, 100)], maxAdvertisersPerQuery: 1 };
  return {
    ...target, resultType: "ads", region: o.country ? o.country.toUpperCase() : "ANYWHERE", adFormat: "ALL",
    maxAdsPerSearch: Math.min(1000, o.max ?? 100), includeAdText: true, includeDetails: false,
  };
}

const GOOGLE_FORMAT: Record<string, AdMediaType> = { TEXT: "text", IMAGE: "image", VIDEO: "video" };

/** One Google Ads Transparency Center ad → PaidAd. */
export function fromGoogleAd(raw: Record<string, any>, competitor?: string | null): PaidAd | null {
  const adId = str(raw.creativeId ?? raw.creative_id);
  if (!/^CR\d{5,40}$/.test(adId)) return null;
  const advertiserId = str(raw.advertiserId ?? raw.advertiser_id);
  const format = str(raw.format).toUpperCase();
  const image = httpsOn(raw.imageUrl ?? raw.image_url, /(^|\.)googlesyndication\.com$|(^|\.)googleusercontent\.com$|(^|\.)ytimg\.com$/);
  const media: AdMedia[] = image ? [{ type: "image", url: image }] : [];
  const last = isoDate(raw.lastShown ?? raw.last_shown);
  const active = shownRecently(last);
  const domain = str(raw.domain ?? raw.target_domain).toLowerCase().replace(/^www\./, "");
  const region = str(raw.region).toUpperCase();
  const text = list(raw.adTextLines).map(str).filter(Boolean);
  const variations = Number(raw.variationCount);
  return {
    adId, network: "google", source: "google_apify",
    pageId: /^AR\d{5,40}$/.test(advertiserId) ? advertiserId : null, pageName: str(raw.advertiserName ?? raw.advertiser_name) || "Unknown advertiser",
    competitor: competitor ?? null,
    startedAt: isoDate(raw.firstShown ?? raw.first_shown), stoppedAt: active ? null : last, active,
    placements: placementsOf(raw.platforms), mediaType: GOOGLE_FORMAT[format] ?? (image ? "image" : "unknown"),
    body: tidy(str(raw.adDescription) || (raw.adHeadline ? "" : text.slice(1).join("\n"))),
    headline: tidy(str(raw.adHeadline) || (raw.adDescription ? "" : text[0] ?? "")),
    description: str(raw.adDisplayUrl), cta: "",
    linkUrl: /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? `https://${domain}` : null,
    media, thumb: image,
    snapshotUrl: httpsOn(raw.adUrl, /^adstransparency\.google\.com$/)
      ?? (advertiserId ? `https://adstransparency.google.com/advertiser/${advertiserId}/creative/${adId}` : null),
    countries: /^[A-Z]{2}$/.test(region) ? [region] : [], languages: [], collationId: null,
    variants: Number.isFinite(variations) && variations > 1 ? variations : 1,
    reach: Number(raw.impressionsMin) || null,
    library: {
      landingDomain: domain || null, linkHost: domain || null, tracking: null,
      previewUrl: httpsOn(raw.previewUrl, /(^|\.)google\.com$|(^|\.)googleusercontent\.com$|(^|\.)googlesyndication\.com$/),
    },
  };
}

// MARK: Ranking: long-running ads and creatives with many live variants

/** An ad running at least this long is a "long runner": it's very likely profitable. */
export const LONG_RUNNING_DAYS = 21;

const norm = (text: string) => text.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 160);

/** Ads that are the same creative: Meta's collation id when there is one, else the same advertiser, text and first media. */
export function creativeKey(ad: PaidAd): string {
  if (ad.collationId) return `c:${ad.collationId}`;
  const media = ad.media[0]?.url.split("?")[0].split("/").pop() ?? "";
  return `t:${ad.network}:${(ad.pageId ?? ad.pageName).toLowerCase()}:${norm(ad.body)}|${norm(ad.headline)}|${media}`;
}

export interface RankedAd extends PaidAd {
  daysRunning: number | null;
  /** Live ads in this creative group (collated by Meta or matched by text). */
  groupSize: number;
  creativeKey: string;
  longRunning: boolean;
  score: number;
}

/**
 * Scores each ad: days running, boosted by how many live variants share its creative (an advertiser
 * duplicating an ad across ad sets is scaling it). Ads without dates (Creative Center) fall back to CTR.
 */
export function rankAds(ads: PaidAd[], now = Date.now()): RankedAd[] {
  const groups = new Map<string, number>();
  for (const ad of ads) {
    const key = creativeKey(ad);
    groups.set(key, (groups.get(key) ?? 0) + (ad.active ? 1 : 0));
  }
  return ads.map((ad) => {
    const key = creativeKey(ad);
    const days = daysRunning(ad, now);
    const groupSize = Math.max(ad.variants, groups.get(key) ?? 1);
    const base = days ?? (ad.metrics?.ctr ? ad.metrics.ctr * 100 : 1);
    return {
      ...ad, daysRunning: days, groupSize, creativeKey: key,
      longRunning: (days ?? 0) >= LONG_RUNNING_DAYS,
      score: Math.round(base * (1 + Math.log2(groupSize)) * (ad.active ? 1 : 0.5) * 10) / 10,
    };
  }).sort((a, b) => b.score - a.score);
}

// MARK: Decoding with Jev

/** Ad formats Jev picks from on top of the organic library, so paid creatives sort into what marketers test. */
export const AD_FORMATS: Format[] = [
  { id: "hook_demo", name: "hook + app/product demo", description: "A scroll-stopping hook line or clip, then a screen recording or close-up showing the product doing the thing." },
  { id: "static_benefit", name: "static image: benefit headline", description: "A single image with a big headline about the outcome, a product shot or app screen, and a short CTA." },
  { id: "reddit_style", name: "Reddit-style post", description: "Designed to look like a Reddit thread or comment: a confession or question, upvotes, replies that recommend the product." },
  { id: "tweet_style", name: "tweet-style screenshot", description: "Designed to look like a tweet or social post screenshot: a short punchy opinion or story, often with a reply naming the product." },
  { id: "ai_ugc", name: "AI / actor UGC", description: "A presenter (real creator, actor or AI avatar) talks to camera in a casual UGC style about a problem and the product as the fix." },
  { id: "before_after", name: "before / after", description: "Shows the state before and after using the product (skin, a tracker screen, a bill), the transformation is the message." },
  { id: "us_vs_them", name: "us vs them comparison", description: "A comparison table or split screen: the product versus the old way or a named/unnamed alternative, with ticks and crosses." },
  { id: "quiz_funnel", name: "quiz / result reveal", description: "Invites the viewer to take a quiz, scan or test ('what's your skin age?', 'how many days do you have left?') and teases the result." },
  { id: "testimonial_review", name: "reviews / social proof", description: "Star ratings, review quotes, press logos or user counts carry the ad." },
  { id: "green_screen", name: "green screen over proof", description: "A creator in front of a screenshot, article, app result or headline, explaining it." },
  { id: "founder_story", name: "founder / expert to camera", description: "The founder, a doctor or an expert speaks to camera about why the product exists or the science behind it." },
];

/** Splits ad copy into script-like sentences: the copy is the script for text and image ads. */
function sentencesOf(text: string): Segment[] {
  return text.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"“])/).map((t) => t.trim()).filter((t) => t.length > 1).slice(0, 30).map((t) => ({ text: t }));
}

/**
 * A paid ad in the `Reel` shape the decoder and the report read. The copy (headline, body, CTA)
 * becomes the script; a video's spoken words can be added as `transcript` when a transcription is available.
 */
export function adToReel(ad: PaidAd & { daysRunning?: number | null }, transcript?: Segment[]): Reel {
  const lines = [ad.headline, ad.body, ad.description, ad.cta ? `CTA: ${ad.cta}` : ""].filter(Boolean).join("\n");
  return {
    id: `ad:${ad.network}:${ad.adId}`,
    // The Reel union has no Facebook: Meta ads read as Instagram (both are Meta video/image feeds).
    platform: ad.network === "tiktok" ? "tiktok" : ad.network === "google" && ad.mediaType === "video" ? "youtube" : "instagram",
    url: ad.snapshotUrl ?? "",
    owner: ad.pageName,
    account: ad.competitor ?? ad.pageName,
    followers: null, shares: null, saves: null,
    caption: lines.slice(0, 1500),
    hashtags: [...lines.matchAll(/#(\w+)/g)].map((m) => m[1].toLowerCase()),
    // Ads have no public view counts; days running is the strength signal, kept in `source`.
    views: 0, likes: ad.metrics?.likes ?? 0, comments: 0,
    durationSec: null,
    postedAt: ad.startedAt,
    thumb: ad.thumb,
    paidPartnership: true,
    source: `paid:${ad.source}${ad.daysRunning ? `:${ad.daysRunning}d` : ""}`,
    transcript: transcript?.length ? transcript : sentencesOf([ad.headline, ad.body].filter(Boolean).join("\n")),
  };
}

/**
 * What "send to format library" hands over: everything the format cards need about a proven paid
 * creative, without the raw ad. The formats package owns the cards; this is the contract.
 */
export interface FormatSeed {
  kind: "paid_ad";
  adId: string;
  network: AdNetwork;
  competitor: string;
  format: string | null;
  hookType: string | null;
  hook: string | null;
  structure: { role: string; text: string; visual?: string }[];
  mediaType: AdMediaType;
  daysRunning: number | null;
  variants: number;
  placements: AdPlacement[];
  cta: string;
  snapshotUrl: string | null;
  thumb: string | null;
}

export function formatSeed(ad: RankedAd | (PaidAd & { daysRunning: number | null; groupSize?: number }), decoded?: { format?: string; hookType?: string | null; roles?: { role: string; text: string; visual?: string }[] } | null): FormatSeed {
  const roles = decoded?.roles ?? [];
  return {
    kind: "paid_ad", adId: ad.adId, network: ad.network, competitor: ad.competitor ?? ad.pageName,
    format: decoded?.format ?? null, hookType: decoded?.hookType ?? null,
    hook: roles.find((r) => r.role === "hook")?.text ?? (ad.headline || ad.body.split("\n")[0] || null),
    structure: roles.map((r) => ({ role: r.role, text: r.text, ...(r.visual ? { visual: r.visual } : {}) })),
    mediaType: ad.mediaType, daysRunning: ad.daysRunning, variants: "groupSize" in ad && ad.groupSize ? ad.groupSize : ad.variants,
    placements: ad.placements, cta: ad.cta, snapshotUrl: ad.snapshotUrl, thumb: ad.thumb,
  };
}
