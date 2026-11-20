// The Market page's shapes and the sums it does on the page: "updated 12 days ago", how often an app
// ships, its rating trend and review stars, and the opportunities across competitors (the complaints and
// requests their reviewers share, merged and ranked). Safe in the browser; tested in market.test.ts.
// The rows are written by the insight function's `market-*` routes (supabase/functions/insight/market.ts).
// Words shown on the page are m()-marked (render them with t(label)); the functions that write words
// take an optional translator (`tr`) and write English without one.
import { m, translator, type Translator } from "./i18n/translate";

/** The two lookups a function that writes words needs (a page's useT() or getTranslator()). */
export type Words = Pick<Translator, "t" | "tn">;
const ENGLISH: Words = translator("en", null);

export type Store = "app_store" | "google_play";
export type ChartKind = "free" | "paid" | "grossing";

export interface MarketApp {
  id: string;
  store: Store;
  store_id: string;
  name: string;
  developer: string | null;
  icon_url: string | null;
  url: string | null;
  category: string | null;
  price: number | null;
  currency: string | null;
  price_label: string | null;
  has_iap: boolean | null;
  rating: number | null;
  rating_count: number | null;
  version: string | null;
  released_at: string | null;
  store_updated_at: string | null;
  release_notes: string | null;
  country: string;
  competitor_name: string | null;
  chart_rank: number | null;
  chart_label: string | null;
  chart_at: string | null;
  refreshed_at: string | null;
  refresh_message: string | null;
  created_at: string;
}

export interface Snapshot { day: string; rating: number | null; rating_count: number | null; version: string | null; rank: number | null; chart: string | null }
export interface Release { version: string; released_at: string | null; notes: string | null; source: "store" | "reviews" }
export interface Review { store_review_id: string; rating: number; title: string | null; body: string; author: string | null; version: string | null; reviewed_at: string | null; country: string | null }

export const SUMMARY_SECTIONS = ["loves", "complaints", "requests", "pricing"] as const;
export type SummarySection = (typeof SUMMARY_SECTIONS)[number];
export const SECTION_LABEL: Record<SummarySection, string> = {
  loves: m("What users love"),
  complaints: m("What they complain about"),
  requests: m("What they ask for"),
  pricing: m("What they say about price"),
};

export interface Quote { reviewId: string; text: string; rating: number | null; version: string | null }
export interface Theme { theme: string; detail: string; count: number; quotes: Quote[] }
export type ReviewSummary = { overview: string } & Record<SummarySection, Theme[]>;
export interface SummaryRow { app_id: string | null; kind: "app" | "category"; scope: string; summary: ReviewSummary | Record<string, unknown>; review_count: number | null; model: string | null; created_at: string }

export interface ChartRow {
  rank: number; storeId: string; name: string; developer: string; iconUrl: string | null; url: string | null; priceLabel: string | null;
  category: string | null; rating: number | null; ratingCount: number | null; releasedAt: string | null; updatedAt: string | null; trackedId: string | null;
}
export interface ChartSummary { overview: string; patterns: { title: string; detail: string; apps: string[] }[]; pricing: string; gaps: string[]; label?: string }

/** A search result or suggestion (an app not necessarily tracked). */
export interface FoundApp {
  store: Store; storeId: string; name: string; developer: string; iconUrl: string | null; url: string | null; category: string | null;
  priceLabel: string | null; rating: number | null; ratingCount: number | null; updatedAt: string | null; trackedId?: string | null;
}

/** What GET /api/w/[productId]/market answers. `setup: false`: the tables aren't in the database yet. */
export interface MarketOverview { setup: boolean; apps: MarketApp[]; summaries: SummaryRow[]; competitors: string[]; message?: string }
export interface MarketDetail { setup: boolean; app: MarketApp | null; snapshots: Snapshot[]; releases: Release[]; stars: number[]; reviewCount: number; reviews: Review[]; summary: SummaryRow | null; message?: string }

// MARK: Charts, categories and countries

export const CHART_KINDS: { value: ChartKind; label: string; why: string }[] = [
  { value: "grossing", label: m("Top grossing"), why: m("Top grossing shows what people pay for: the apps earning the most right now.") },
  { value: "free", label: m("Top free"), why: m("Top free shows what people download: demand, and the hooks that win installs.") },
  { value: "paid", label: m("Top paid"), why: m("Top paid shows what people buy up front, with no free version to try first.") },
];

/** App Store categories (Apple's genre ids). "" is every app. */
export const GENRES: { value: string; label: string }[] = [
  { value: "", label: m("All apps") },
  { value: "6000", label: m("Business") }, { value: "6017", label: m("Education") }, { value: "6016", label: m("Entertainment") }, { value: "6015", label: m("Finance") },
  { value: "6023", label: m("Food & Drink") }, { value: "6014", label: m("Games") }, { value: "6027", label: m("Graphics & Design") }, { value: "6013", label: m("Health & Fitness") },
  { value: "6012", label: m("Lifestyle") }, { value: "6020", label: m("Medical") }, { value: "6011", label: m("Music") }, { value: "6010", label: m("Navigation") },
  { value: "6009", label: m("News") }, { value: "6008", label: m("Photo & Video") }, { value: "6007", label: m("Productivity") }, { value: "6006", label: m("Reference") },
  { value: "6024", label: m("Shopping") }, { value: "6005", label: m("Social Networking") }, { value: "6004", label: m("Sports") }, { value: "6003", label: m("Travel") },
  { value: "6002", label: m("Utilities") }, { value: "6001", label: m("Weather") }, { value: "6026", label: m("Developer Tools") }, { value: "6018", label: m("Books") },
];

export const COUNTRIES: { value: string; label: string }[] = [
  { value: "us", label: m("United States") }, { value: "gb", label: m("United Kingdom") }, { value: "ca", label: m("Canada") }, { value: "au", label: m("Australia") },
  { value: "de", label: m("Germany") }, { value: "fr", label: m("France") }, { value: "es", label: m("Spain") }, { value: "it", label: m("Italy") },
  { value: "nl", label: m("Netherlands") }, { value: "se", label: m("Sweden") }, { value: "br", label: m("Brazil") }, { value: "mx", label: m("Mexico") },
  { value: "in", label: m("India") }, { value: "jp", label: m("Japan") }, { value: "kr", label: m("South Korea") },
];

// MARK: Words for numbers and dates

const DAY = 86_400_000;

/** "today", "yesterday", "12 days ago", "3 months ago", "2 years ago"; "" when there's no date. */
export function ago(iso: string | null | undefined, now = Date.now(), tr: Words = ENGLISH): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return "";
  const days = Math.floor((now - at) / DAY);
  if (days <= 0) return tr.t("today");
  if (days === 1) return tr.t("yesterday");
  if (days < 45) return tr.tn(days, "{n} day ago", "{n} days ago");
  const months = Math.round(days / 30.4);
  if (months < 18) return tr.tn(months, "{n} month ago", "{n} months ago");
  const years = Math.round(days / 365);
  return tr.tn(years, "{n} year ago", "{n} years ago");
}

/** 149029 → "149K", 12375828 → "12.4M", 920 → "920". */
export function compact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}

/** "4.8 (149K)"; "No ratings yet" when there are none. */
export const ratingText = (rating: number | null | undefined, count: number | null | undefined, tr: Words = ENGLISH) =>
  rating == null || !count ? tr.t("No ratings yet") : `${rating.toFixed(1)} (${compact(count)})`;

/** "Free", "$4.99", "Free · in-app purchases"; "" when the price isn't known. */
export function priceText(app: Pick<MarketApp, "price_label" | "price" | "has_iap">, tr: Words = ENGLISH): string {
  // The store's own label is English ("Free", "$4.99"); "Free" is the one word worth saying in the page's language.
  const base = (app.price_label === "Free" ? tr.t("Free") : app.price_label) ?? (app.price === 0 ? tr.t("Free") : app.price != null ? String(app.price) : "");
  return app.has_iap ? tr.t("{price} · in-app purchases", { price: base || tr.t("Free") }) : base;
}

// MARK: How often an app ships

export interface Cadence { releases: number; medianDays: number | null; lastAt: string | null; label: string }

/**
 * How often the app ships, from the releases seen (dated ones only): the median gap between them in
 * words. One release: when it shipped. None: nothing known yet.
 */
export function cadence(releases: Pick<Release, "released_at">[], now = Date.now(), tr: Words = ENGLISH): Cadence {
  const dates = [...new Set(releases.map((r) => r.released_at).filter((d): d is string => Boolean(d && Number.isFinite(Date.parse(d)))))]
    .map((d) => Date.parse(d)).sort((a, b) => b - a);
  const lastAt = dates.length ? new Date(dates[0]).toISOString() : null;
  if (dates.length < 2) {
    return { releases: dates.length, medianDays: null, lastAt, label: dates.length ? tr.t("One release seen so far, {ago}.", { ago: ago(lastAt, now, tr) }) : tr.t("No releases seen yet.") };
  }
  const gaps = dates.slice(1).map((d, i) => (dates[i] - d) / DAY).sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  const last = ago(lastAt, now, tr);
  const weeks = Math.round(median / 7);
  const months = Math.round(median / 30.4);
  const label = median < 1.5 ? tr.t("Ships about every day, last {ago}.", { ago: last })
    : median < 10 ? tr.t("Ships about every {n} days, last {ago}.", { n: Math.round(median), ago: last })
    : median < 60 ? tr.tn(weeks, "Ships about every week, last {ago}.", "Ships about every {n} weeks, last {ago}.", { ago: last })
    : tr.tn(months, "Ships about every month, last {ago}.", "Ships about every {n} months, last {ago}.", { ago: last });
  return { releases: dates.length, medianDays: Math.round(median * 10) / 10, lastAt, label };
}

// MARK: Ratings and stars

/** The rating over time: one point per day with a rating, oldest first. */
export function ratingTrend(snapshots: Snapshot[]): { day: string; rating: number; count: number | null }[] {
  return snapshots.filter((s) => s.rating != null).map((s) => ({ day: s.day, rating: Number(s.rating), count: s.rating_count })).sort((a, b) => a.day.localeCompare(b.day));
}

/** How the rating moved between the first and last snapshot ("+0.1 since Nov 2"), or null with fewer than two. */
export function ratingChange(snapshots: Snapshot[]): { delta: number; since: string } | null {
  const points = ratingTrend(snapshots);
  if (points.length < 2) return null;
  return { delta: Math.round((points[points.length - 1].rating - points[0].rating) * 100) / 100, since: points[0].day };
}

/** Reviews per star, 1 to 5 (index 0 is one star). */
export function starCounts(ratings: number[]): number[] {
  const out = [0, 0, 0, 0, 0];
  for (const r of ratings) if (r >= 1 && r <= 5) out[Math.round(r) - 1]++;
  return out;
}

/** The average of the reviews read (for a Google Play app, which has no store rating here). */
export const averageOf = (stars: number[]) => {
  const total = stars.reduce((s, n) => s + n, 0);
  return total ? Math.round((stars.reduce((s, n, i) => s + n * (i + 1), 0) / total) * 10) / 10 : null;
};

// MARK: Opportunities

export interface Opportunity {
  kind: "complaints" | "requests" | "pricing";
  theme: string;
  detail: string;
  /** Reviews that say it, across every app. */
  count: number;
  apps: { id: string; name: string; count: number }[];
  quotes: (Quote & { appName: string })[];
}

const STOP = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "too", "no", "not", "is", "are", "it", "its", "app", "apps", "after", "when"]);
/** The words a theme is about: lower case, no small words, a plural s dropped. */
const words = (theme: string) => new Set(theme.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)).map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)));
const similar = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size) >= 0.5 && shared >= 1;
};

/**
 * What competitors' reviewers keep asking for or complaining about: every app's complaints, requests
 * and price themes, merged when they are about the same thing (same section, most of the words in
 * common), ranked by how many apps share them, then by reviews. The gaps a new app could fill.
 */
export function opportunities(summaries: { appId: string; appName: string; summary: Partial<ReviewSummary> }[], limit = 12): Opportunity[] {
  const groups: (Opportunity & { key: Set<string> })[] = [];
  for (const { appId, appName, summary } of summaries) {
    for (const kind of ["complaints", "requests", "pricing"] as const) {
      for (const t of summary[kind] ?? []) {
        if (!t?.theme) continue;
        const key = words(t.theme);
        const group = groups.find((g) => g.kind === kind && similar(g.key, key));
        const quotes = (t.quotes ?? []).map((q) => ({ ...q, appName }));
        if (!group) {
          groups.push({ kind, theme: t.theme, detail: t.detail, count: t.count, apps: [{ id: appId, name: appName, count: t.count }], quotes, key });
          continue;
        }
        group.count += t.count;
        const app = group.apps.find((a) => a.id === appId);
        if (app) app.count += t.count; else group.apps.push({ id: appId, name: appName, count: t.count });
        group.quotes.push(...quotes);
        for (const w of key) group.key.add(w);
      }
    }
  }
  return groups
    .sort((a, b) => b.apps.length - a.apps.length || b.count - a.count)
    .slice(0, limit)
    .map((g) => ({ kind: g.kind, theme: g.theme, detail: g.detail, count: g.count, apps: [...g.apps].sort((a, b) => b.count - a.count), quotes: spread(g.quotes, 3) }));
}

/** Up to `max` quotes, one per app first, so one app's reviewers don't speak for all. */
function spread<T extends { appName: string }>(quotes: T[], max: number): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const q of quotes) if (!seen.has(q.appName) && out.length < max) { out.push(q); seen.add(q.appName); }
  for (const q of quotes) if (!out.includes(q) && out.length < max) out.push(q);
  return out;
}

/** The app summaries of an overview, ready for `opportunities`. */
export function appSummaries(overview: Pick<MarketOverview, "apps" | "summaries">): { appId: string; appName: string; summary: Partial<ReviewSummary> }[] {
  const names = new Map(overview.apps.map((a) => [a.id, a.name]));
  return overview.summaries.filter((s) => s.kind === "app" && s.app_id && names.has(s.app_id))
    .map((s) => ({ appId: s.app_id!, appName: names.get(s.app_id!)!, summary: s.summary as Partial<ReviewSummary> }));
}

/** "Calm: Sleep & Meditation" and "calm" are one competitor. */
export const competitorKey = (name: string) => name.trim().replace(/^@+/, "").replace(/\s+/g, " ").toLowerCase();

/** The competitors on the product's list with no tracked app yet (by the name it was tracked for, or the app's own name). */
export function untrackedCompetitors(competitors: string[], apps: Pick<MarketApp, "competitor_name" | "name">[]): string[] {
  const covered = new Set(apps.flatMap((a) => [a.competitor_name ?? "", a.name]).map(competitorKey).filter(Boolean));
  const seen = new Set<string>();
  return competitors.filter((c) => {
    const key = competitorKey(c);
    if (!key || covered.has(key) || seen.has(key) || [...covered].some((k) => k.startsWith(`${key} `) || k.startsWith(`${key}:`))) return false;
    seen.add(key);
    return true;
  });
}
