// The Market routes' pure parts (no network, no database): Apple's iTunes Search and Lookup answers,
// the top-chart RSS feeds, customer-review pages, what a tracked app's snapshot and release history
// are, matching a competitor's name to a search result, Google Play reviews from the Apify actor, and
// the shape OpenAI answers in for a review summary and a category scan. Tested in market_test.ts.
//
// What Apple gives today (checked Nov 2026):
//   search   itunes.apple.com/search?term=&entity=software&country=   up to 200 results, ratings and price
//   lookup   itunes.apple.com/lookup?id=a,b,c&country=                 100 ids per call; also ?bundleId=
//            Neither says whether an app sells in-app purchases.
//   reviews  itunes.apple.com/{cc}/rss/customerreviews/page={n}/id={id}/sortby=mostrecent/json
//            50 most recent reviews per country on page 1; later pages come back empty even though the
//            feed's "last" link says 10, and some apps get no entries at all. Each country is its own set.
//   charts   itunes.apple.com/{cc}/rss/{topfree|toppaid|topgrossing}applications/limit={n}/genre={id}/json
//            up to 200 per chart, by genre and country, rank = order. (The newer rss.marketingtools
//            generator has top free and top paid only, with no genre and no grossing.)
//   Apple asks for about 20 calls a minute; it answers 403 or 429 when there are too many.
import { parseReviewFeed } from "./core.ts";

// MARK: Stores, countries, charts

export type Store = "app_store" | "google_play";
export type ChartKind = "free" | "paid" | "grossing";
export const CHART_KINDS: readonly ChartKind[] = ["free", "paid", "grossing"];
const CHART_FEEDS: Record<ChartKind, string> = { free: "topfreeapplications", paid: "toppaidapplications", grossing: "topgrossingapplications" };

/** A two-letter store country ("us", "gb"); null for anything else. */
export const cleanCountry = (value: unknown): string | null => (typeof value === "string" && /^[a-z]{2}$/i.test(value.trim()) ? value.trim().toLowerCase() : null);
/** An App Store genre id (6000-7999, Games' subgenres included); null for "all apps" or anything else. */
export const cleanGenre = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  return /^(6\d{3}|7\d{3})$/.test(text) ? text : null;
};

/** The countries reviews are read from: the app's own store first, then the big English-speaking ones. */
export const REVIEW_COUNTRIES = ["us", "gb", "ca", "au"] as const;

export const searchUrl = (term: string, country: string, limit = 15) =>
  `https://itunes.apple.com/search?term=${encodeURIComponent(term.slice(0, 100))}&entity=software&country=${country}&limit=${Math.min(50, Math.max(1, limit))}`;
export const lookupUrl = (ids: string[], country: string) => `https://itunes.apple.com/lookup?id=${ids.join(",")}&country=${country}&entity=software`;
export const lookupBundleUrl = (bundleId: string, country: string) => `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}&country=${country}&entity=software`;
export const reviewsPageUrl = (id: string, country: string, page = 1) => `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${id}/sortby=mostrecent/json`;
export const chartUrl = (kind: ChartKind, country: string, genre: string | null, limit = 100) =>
  `https://itunes.apple.com/${country}/rss/${CHART_FEEDS[kind]}/limit=${Math.min(200, Math.max(10, limit))}${genre ? `/genre=${genre}` : ""}/json`;

/** Lookup takes at most this many ids per call. */
export const LOOKUP_BATCH = 100;
export const chunks = <T>(items: T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

// MARK: What the person typed

export type FindInput =
  | { kind: "app_store"; id: string; country: string | null }
  | { kind: "google_play"; pkg: string }
  | { kind: "bundle"; bundleId: string }
  | { kind: "term"; term: string };

/** An App Store link or id, a Google Play link, a bundle id, or words to search for. Null when empty. */
export function parseFindInput(raw: unknown): FindInput | null {
  const text = typeof raw === "string" ? raw.trim().slice(0, 300) : "";
  if (!text) return null;
  if (/^https?:\/\//i.test(text) || /^(apps|itunes)\.apple\.com\//i.test(text) || /^play\.google\.com\//i.test(text)) {
    let url: URL;
    try { url = new URL(/^https?:/i.test(text) ? text : `https://${text}`); } catch { return { kind: "term", term: text }; }
    const host = url.hostname.toLowerCase();
    if (host === "apps.apple.com" || host === "itunes.apple.com") {
      const id = url.pathname.match(/\/id(\d{5,15})(?:\/|$)/)?.[1] ?? url.searchParams.get("id")?.match(/^\d{5,15}$/)?.[0];
      if (id) return { kind: "app_store", id, country: cleanCountry(url.pathname.match(/^\/([a-z]{2})\//i)?.[1]) };
    }
    if (host === "play.google.com") {
      const pkg = url.searchParams.get("id")?.match(/^[A-Za-z0-9._]{3,150}$/)?.[0];
      if (pkg) return { kind: "google_play", pkg };
    }
    return { kind: "term", term: text };
  }
  if (/^(id)?\d{6,15}$/i.test(text)) return { kind: "app_store", id: text.replace(/^id/i, ""), country: null };
  // com.company.app: a bundle id (iOS) or package (Android); words with dots in them stay words.
  if (/^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+){2,}$/i.test(text) && !/\s/.test(text)) return { kind: "bundle", bundleId: text };
  return { kind: "term", term: text };
}

// MARK: An app, from Lookup or Search

export interface StoreApp {
  store: Store;
  storeId: string;
  bundleId: string | null;
  name: string;
  developer: string;
  developerId: string | null;
  iconUrl: string | null;
  url: string | null;
  category: string | null;
  categoryId: string | null;
  price: number | null;
  currency: string | null;
  priceLabel: string | null;
  /** Unknown from Apple's API (it never says); null until something tells. */
  hasIap: boolean | null;
  rating: number | null;
  ratingCount: number | null;
  version: string | null;
  releasedAt: string | null;
  updatedAt: string | null;
  releaseNotes: string | null;
  description: string | null;
}

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const https = (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s]+$/.test(v) ? v : null);
const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** One Lookup or Search result; null when it isn't an app. */
export function appFromLookup(r: Record<string, any> | null | undefined): StoreApp | null {
  if (!r || typeof r !== "object") return null;
  if (r.wrapperType && r.wrapperType !== "software") return null;
  const id = r.trackId != null ? String(r.trackId) : "";
  if (!/^\d{5,15}$/.test(id) || !text(r.trackName, 1)) return null;
  const rating = num(r.averageUserRating);
  const count = num(r.userRatingCount);
  const price = num(r.price);
  return {
    store: "app_store",
    storeId: id,
    bundleId: text(r.bundleId, 200),
    name: text(r.trackName, 200)!,
    developer: text(r.artistName, 200) ?? text(r.sellerName, 200) ?? "",
    developerId: r.artistId != null ? String(r.artistId) : null,
    iconUrl: https(r.artworkUrl512) ?? https(r.artworkUrl100) ?? https(r.artworkUrl60),
    url: https(r.trackViewUrl)?.split("?")[0] ?? null,
    category: text(r.primaryGenreName, 80),
    categoryId: r.primaryGenreId != null ? String(r.primaryGenreId) : null,
    price,
    currency: text(r.currency, 8),
    priceLabel: text(r.formattedPrice, 40) ?? (price === 0 ? "Free" : null),
    hasIap: null,
    rating: rating == null ? null : Math.round(rating * 100) / 100,
    ratingCount: count == null ? null : Math.round(count),
    version: text(r.version, 40),
    releasedAt: iso(r.releaseDate),
    updatedAt: iso(r.currentVersionReleaseDate),
    releaseNotes: text(r.releaseNotes, 4000),
    description: text(r.description, 3000),
  };
}

/** Every app in a Lookup or Search answer. */
export function parseLookup(json: unknown): StoreApp[] {
  const results = (json as { results?: unknown } | null)?.results;
  const seen = new Set<string>();
  return (Array.isArray(results) ? results : []).map(appFromLookup).filter((a): a is StoreApp => {
    if (!a || seen.has(a.storeId)) return false;
    seen.add(a.storeId);
    return true;
  });
}

// MARK: Top charts

export interface ChartEntry {
  rank: number;
  storeId: string;
  bundleId: string | null;
  name: string;
  developer: string;
  iconUrl: string | null;
  url: string | null;
  price: number | null;
  currency: string | null;
  priceLabel: string | null;
  category: string | null;
  categoryId: string | null;
  releasedAt: string | null;
}

const label = (v: unknown): string => (typeof v === "string" ? v : v && typeof v === "object" && "label" in v ? label((v as { label: unknown }).label) : "");

/** A top-chart feed: one entry per app, ranked in the feed's order. */
export function parseChart(json: unknown): ChartEntry[] {
  const feed = (json as { feed?: { entry?: unknown } } | null)?.feed;
  const entries = Array.isArray(feed?.entry) ? feed!.entry as Record<string, any>[] : feed?.entry ? [feed.entry as Record<string, any>] : [];
  const out: ChartEntry[] = [];
  for (const e of entries) {
    const id = String(e?.id?.attributes?.["im:id"] ?? "");
    const name = label(e?.["im:name"]).trim();
    if (!/^\d{5,15}$/.test(id) || !name || out.some((x) => x.storeId === id)) continue;
    const images = (Array.isArray(e?.["im:image"]) ? e["im:image"] : []) as { label?: string; attributes?: { height?: string } }[];
    const icon = images.map((i) => ({ url: https(i?.label), h: Number(i?.attributes?.height) || 0 })).filter((i) => i.url).sort((a, b) => b.h - a.h)[0]?.url ?? null;
    const links = Array.isArray(e?.link) ? e.link : e?.link ? [e.link] : [];
    const page = links.map((l: any) => l?.attributes).find((a: any) => a?.rel === "alternate")?.href;
    const amount = num(e?.["im:price"]?.attributes?.amount);
    out.push({
      rank: out.length + 1,
      storeId: id,
      bundleId: text(e?.id?.attributes?.["im:bundleId"], 200),
      name: name.slice(0, 200),
      developer: label(e?.["im:artist"]).trim().slice(0, 200),
      iconUrl: icon ? icon.replace(/\/\d+x\d+bb\.(png|jpg)$/, "/200x200bb.$1") : null,
      url: https(page)?.split("?")[0] ?? null,
      price: amount,
      currency: text(e?.["im:price"]?.attributes?.currency, 8),
      priceLabel: amount === 0 ? "Free" : text(label(e?.["im:price"]), 40),
      category: text(e?.category?.attributes?.label, 80),
      categoryId: text(e?.category?.attributes?.["im:id"], 8),
      releasedAt: iso(label(e?.["im:releaseDate"])),
    });
  }
  return out;
}

/** A chart row with the app's rating from Lookup (charts carry none). */
export interface ChartRow extends ChartEntry { rating: number | null; ratingCount: number | null; updatedAt: string | null }

export function withRatings(entries: ChartEntry[], apps: StoreApp[]): ChartRow[] {
  const byId = new Map(apps.map((a) => [a.storeId, a]));
  return entries.map((e) => {
    const app = byId.get(e.storeId);
    return { ...e, rating: app?.rating ?? null, ratingCount: app?.ratingCount ?? null, updatedAt: app?.updatedAt ?? null, priceLabel: e.priceLabel ?? app?.priceLabel ?? null };
  });
}

// MARK: Reviews

export interface MarketReview {
  storeReviewId: string;
  rating: number;
  title: string;
  body: string;
  author: string;
  version: string | null;
  reviewedAt: string | null;
  country: string;
}

/** One page of Apple's customer-review feed, for one country. */
export function parseReviewPage(json: unknown, country: string): MarketReview[] {
  return parseReviewFeed(json).map((r) => ({
    storeReviewId: r.id, rating: r.rating, title: r.title, body: r.body, author: r.author,
    version: r.version ?? null, reviewedAt: r.date || null, country,
  }));
}

/** Reviews from several pages and countries: each review once (its first sighting wins), newest first. */
export function mergeReviews(lists: MarketReview[][], max = 1000): MarketReview[] {
  const seen = new Set<string>();
  const out: MarketReview[] = [];
  for (const list of lists) for (const r of list) {
    if (seen.has(r.storeReviewId)) continue;
    seen.add(r.storeReviewId);
    out.push(r);
  }
  return out.sort((a, b) => (Date.parse(b.reviewedAt ?? "") || 0) - (Date.parse(a.reviewedAt ?? "") || 0)).slice(0, max);
}

/** Whether to ask for the next page: the page was full (Apple serves 50), and pages are left. */
export const wantNextPage = (got: number, page: number, maxPages = 10) => got >= 50 && page < maxPages;

/** Google Play reviews from the Apify actor (neatrat/google-play-store-reviews-scraper), as stored. */
export function playReviews(items: unknown): MarketReview[] {
  const out: MarketReview[] = [];
  for (const item of Array.isArray(items) ? items as Record<string, any>[] : []) {
    const id = text(item?.reviewId, 100);
    const body = typeof item?.body === "string" ? item.body.trim() : "";
    const rating = Math.round(Number(item?.rating));
    if (!id || !body || !(rating >= 1 && rating <= 5)) continue;
    const when = Number.isFinite(item?.timestamp) && item.timestamp > 0 ? new Date(item.timestamp * (item.timestamp < 1e12 ? 1000 : 1)).toISOString() : iso(item?.date);
    out.push({ storeReviewId: id, rating, title: "", body: body.slice(0, 4000), author: text(item?.reviewer, 120) ?? "", version: text(item?.appVersion, 40), reviewedAt: when, country: text(item?.language, 8) ?? "" });
  }
  return mergeReviews([out]);
}

export const PLAY_ACTOR = "neatrat~google-play-store-reviews-scraper";
/** The actor's input: the newest reviews only, capped, so one refresh costs a few cents at most. */
export const playActorInput = (pkg: string, max = 150) => ({ appIdOrUrl: pkg, sortBy: "newest", maxReviews: max, reviewsPerPage: 100, pagesToScrape: Math.ceil(max / 100), deviceType: "mobile" });

// MARK: Snapshots and releases

export interface Snapshot { day: string; rating: number | null; ratingCount: number | null; version: string | null }

/** Today's snapshot of an app (one per app per day; a later refresh that day replaces it). */
export const snapshotOf = (app: Pick<StoreApp, "rating" | "ratingCount" | "version">, now: Date): Snapshot =>
  ({ day: now.toISOString().slice(0, 10), rating: app.rating, ratingCount: app.ratingCount, version: app.version });

export interface Release { version: string; releasedAt: string | null; notes: string | null; source: "store" | "reviews" }

/**
 * The releases a refresh can see: the current version from the store (its date and notes), and every
 * older version named in reviews, dated by the first review written on it (it shipped on or before
 * that day). The store's own entry wins over one seen in reviews.
 */
export function releasesFrom(app: Pick<StoreApp, "version" | "updatedAt" | "releaseNotes">, reviews: Pick<MarketReview, "version" | "reviewedAt">[]): Release[] {
  const firstSeen = new Map<string, string>();
  for (const r of reviews) {
    if (!r.version || !r.reviewedAt) continue;
    const before = firstSeen.get(r.version);
    if (!before || r.reviewedAt < before) firstSeen.set(r.version, r.reviewedAt);
  }
  const out: Release[] = [];
  if (app.version) out.push({ version: app.version, releasedAt: app.updatedAt, notes: app.releaseNotes, source: "store" });
  for (const [version, at] of firstSeen) if (version !== app.version) out.push({ version, releasedAt: at, notes: null, source: "reviews" });
  return out.sort((a, b) => (b.releasedAt ?? "").localeCompare(a.releasedAt ?? ""));
}

// MARK: A competitor's app

/** "Calm: Sleep & Meditation" → "calm sleep meditation". */
export const nameKey = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The search result that is the competitor's own app, or null when none clearly is: the name starts with
 * the competitor's name ("Calm" → "Calm: Sleep & Meditation"), or the developer is the competitor.
 * Among several, the one with the most ratings.
 */
export function bestMatch<T extends Pick<StoreApp, "name" | "developer" | "ratingCount">>(competitor: string, candidates: T[]): T | null {
  const key = nameKey(competitor);
  if (!key) return null;
  const words = key.split(" ");
  const scored = candidates.map((c) => {
    const name = nameKey(c.name);
    const dev = nameKey(c.developer);
    let score = 0;
    if (name === key) score = 4;
    else if (name.startsWith(`${key} `)) score = 3;
    else if (dev === key || dev.startsWith(`${key} `)) score = 2.5;
    else if (words.length > 1 && words.every((w) => name.split(" ").includes(w))) score = 2;
    return { c, score };
  }).filter((s) => s.score >= 2);
  scored.sort((a, b) => b.score - a.score || (b.c.ratingCount ?? 0) - (a.c.ratingCount ?? 0));
  return scored[0]?.c ?? null;
}

// MARK: OpenAI: what users say about an app

const str = { type: "string" };
const strs = { type: "array", items: str };
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const theme = obj({ theme: str, detail: str, count: { type: "integer" }, quotes: { type: "array", items: obj({ review_id: str, text: str }) } });

export const SUMMARY_SECTIONS = ["loves", "complaints", "requests", "pricing"] as const;
export type SummarySection = (typeof SUMMARY_SECTIONS)[number];

export const REVIEW_SUMMARY_SCHEMA = obj({
  overview: str,
  loves: { type: "array", items: theme },
  complaints: { type: "array", items: theme },
  requests: { type: "array", items: theme },
  pricing: { type: "array", items: theme },
});

export const REVIEW_SUMMARY_SYSTEM = `You read an app's App Store or Google Play reviews for someone who wants to build a better app in the same market.
You get the app's name and its reviews, each with an id, stars, version, date and text.

Group what reviewers say into themes:
- loves: what users love and would miss.
- complaints: what frustrates them: bugs, missing basics, design, support, ads.
- requests: features or changes they ask for.
- pricing: what they say about price, subscriptions, paywalls, trials, refunds and value for money.

For every theme:
- theme: 2 to 6 plain words ("Crashes after the update", "Streak reminders").
- detail: one sentence on what reviewers mean, in plain English.
- count: how many of the given reviews say it. Count honestly; never more than the reviews given.
- quotes: 1 to 3 short excerpts copied WORD FOR WORD from the review text (no edits, no ellipses inside), each with that review's id. Never invent or reword a quote.

Order themes by count, most first; at most 6 per section. A section with nothing to say is an empty list.
overview: two sentences: what this app is loved for and its biggest weakness, as a builder would want to know.
Use only what the reviews say. No marketing words.`;

export interface Quote { reviewId: string; text: string; rating: number | null; version: string | null }
export interface Theme { theme: string; detail: string; count: number; quotes: Quote[] }
export type ReviewSummary = { overview: string } & Record<SummarySection, Theme[]>;

const squash = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * OpenAI's answer, kept only where it holds: each quote must be found word for word in the review it
 * names (else it's dropped), a theme with no quote left is dropped, counts are clamped to the reviews
 * read, and themes are sorted by count.
 */
export function cleanSummary(raw: Record<string, any> | null | undefined, reviews: { id: string; title: string; body: string; rating: number; version: string | null }[]): ReviewSummary {
  const byId = new Map(reviews.map((r) => [r.id, r]));
  const total = reviews.length;
  const section = (value: unknown): Theme[] => (Array.isArray(value) ? value : []).map((t: any) => {
    const used = new Set<string>();
    const quotes: Quote[] = (Array.isArray(t?.quotes) ? t.quotes : []).flatMap((q: any) => {
      const review = byId.get(String(q?.review_id ?? ""));
      const quote = typeof q?.text === "string" ? q.text.trim().replace(/^["“]|["”]$/g, "").trim() : "";
      if (!review || quote.length < 3 || used.has(review.id)) return [];
      if (!squash(`${review.title} ${review.body}`).includes(squash(quote))) return [];
      used.add(review.id);
      return [{ reviewId: review.id, text: quote.slice(0, 300), rating: review.rating, version: review.version }];
    }).slice(0, 3);
    const count = Math.max(quotes.length, Math.min(total, Math.round(Number(t?.count) || 0)));
    return { theme: clip(t?.theme, 60), detail: clip(t?.detail, 240), count, quotes };
  }).filter((t) => t.theme && t.quotes.length).sort((a, b) => b.count - a.count).slice(0, 6);
  return {
    overview: clip(raw?.overview, 500),
    loves: section(raw?.loves), complaints: section(raw?.complaints), requests: section(raw?.requests), pricing: section(raw?.pricing),
  };
}

/** The review text OpenAI reads: the newest first, each clipped, until `maxChars`. */
export function reviewPrompt(app: { name: string; store: Store }, reviews: { id: string; rating: number; title: string; body: string; version: string | null; reviewedAt: string | null }[], maxChars = 60_000): { text: string; used: number } {
  const lines: string[] = [`APP: ${app.name} (${app.store === "google_play" ? "Google Play" : "App Store"})`, `REVIEWS (${reviews.length}):`];
  let room = maxChars;
  let used = 0;
  for (const r of reviews) {
    const line = `[${r.id}] ${r.rating}★${r.version ? ` v${r.version}` : ""}${r.reviewedAt ? ` ${r.reviewedAt.slice(0, 10)}` : ""}${r.title ? ` "${r.title.slice(0, 120)}"` : ""}: ${r.body.replace(/\s+/g, " ").slice(0, 700)}`;
    if (line.length > room) break;
    room -= line.length;
    lines.push(line);
    used++;
  }
  lines[1] = `REVIEWS (${used}):`;
  return { text: lines.join("\n"), used };
}

// MARK: OpenAI: what wins in a category

export const CHART_SUMMARY_SCHEMA = obj({
  overview: str,
  patterns: { type: "array", items: obj({ title: str, detail: str, apps: strs }) },
  pricing: str,
  gaps: strs,
});

export const CHART_SUMMARY_SYSTEM = `You read an App Store top chart for someone choosing what app to build.
You get the chart (free, paid or grossing), its category and country, and each app's rank, name, developer, price, rating, rating count, release date and the start of its description.

- overview: two or three sentences: what kind of app wins in this chart and why people pay for or download them.
- patterns: 3 to 5 things the top apps have in common (an approach, a feature, a business model, a kind of user). Each with a short title, one sentence, and the names of 2 to 5 apps that show it, written exactly as in the chart.
- pricing: one or two sentences on how these apps charge (free with subscription, one-off price, ads), from the prices and descriptions given.
- gaps: 2 to 4 openings a new app could take: users or needs the top apps seem to serve badly, or old leaders with many ratings that have not been updated in a long time.
Use only what the chart shows. Never invent revenue, download numbers or features. Plain English, no hype.`;

export interface ChartSummary { overview: string; patterns: { title: string; detail: string; apps: string[] }[]; pricing: string; gaps: string[] }

export function cleanChartSummary(raw: Record<string, any> | null | undefined, names: string[]): ChartSummary {
  const known = new Map(names.map((n) => [nameKey(n), n]));
  return {
    overview: clip(raw?.overview, 600),
    patterns: (Array.isArray(raw?.patterns) ? raw.patterns : []).map((p: any) => ({
      title: clip(p?.title, 80), detail: clip(p?.detail, 300),
      apps: [...new Set((Array.isArray(p?.apps) ? p.apps : []).map((a: unknown) => known.get(nameKey(String(a ?? "")))).filter((a: string | undefined): a is string => Boolean(a)))].slice(0, 5) as string[],
    })).filter((p: { title: string }) => p.title).slice(0, 5),
    pricing: clip(raw?.pricing, 400),
    gaps: (Array.isArray(raw?.gaps) ? raw.gaps : []).map((g: unknown) => clip(g, 240)).filter(Boolean).slice(0, 4),
  };
}

export function chartPrompt(meta: { kind: ChartKind; genreName: string; country: string }, rows: ChartRow[], descriptions: Map<string, string>): string {
  const kind = { free: "Top free", paid: "Top paid", grossing: "Top grossing" }[meta.kind];
  return [
    `CHART: ${kind} · ${meta.genreName} · ${meta.country.toUpperCase()}`,
    ...rows.map((r) => `#${r.rank} ${r.name} — ${r.developer} · ${r.priceLabel ?? "?"} · ${r.rating != null ? `${r.rating.toFixed(1)}★ from ${r.ratingCount ?? 0}` : "no rating"}${r.releasedAt ? ` · released ${r.releasedAt.slice(0, 10)}` : ""}${r.updatedAt ? ` · updated ${r.updatedAt.slice(0, 10)}` : ""}${descriptions.get(r.storeId) ? `\n   ${descriptions.get(r.storeId)!.replace(/\s+/g, " ").slice(0, 240)}` : ""}`),
  ].join("\n");
}
