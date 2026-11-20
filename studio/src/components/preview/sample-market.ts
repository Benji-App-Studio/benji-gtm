// Sample answers for Research › App stores (GET /api/w/[productId]/market and /market/[appId]) in the
// preview and the example app: the sample world's three competitor apps (sample-world.ts), their
// ratings, releases, reviews and what an AI summary of the reviews would say. Nothing here is real. The
// store's own words (category, chart) come in the reader's language through `tx`, as a local store would show them.
import type { MarketApp, MarketDetail, MarketOverview, Release, Review, ReviewSummary, Snapshot, SummaryRow } from "@/lib/market";
import { COMPETITORS, english, WORLD_TEXT, type Tx } from "./sample-world";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const icon = (letter: string, fill: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="26" fill="${fill}"/><text x="60" y="78" font-family="sans-serif" font-size="56" font-weight="700" text-anchor="middle" fill="#ffffff">${letter}</text></svg>`)}`;

export const MARKET_APPS = {
  peak: "a1111111-1111-4111-8111-111111111111",
  ridge: "a2222222-2222-4222-8222-222222222222",
  summit: "a3333333-3333-4333-8333-333333333333",
};
const IDS = [MARKET_APPS.peak, MARKET_APPS.ridge, MARKET_APPS.summit];

const NOTES = "Offline maps for whole regions and a new trail-difficulty filter.";

function apps(tx: Tx): MarketApp[] {
  return COMPETITORS.map((c, n) => ({
    id: IDS[n], store: "app_store", store_id: c.storeId, name: c.store, developer: c.developer, icon_url: icon(c.name[0], c.fill), url: `https://apps.apple.com/app/id${c.storeId}`, category: tx(WORLD_TEXT.category),
    price: 0, currency: "USD", price_label: "Free", has_iap: true, rating: c.rating, rating_count: c.ratings, version: "4.2.0", released_at: daysAgo(900), store_updated_at: daysAgo(6),
    release_notes: NOTES, country: "us", competitor_name: c.name, chart_rank: c.rank, chart_label: c.rank ? tx(WORLD_TEXT.chart) : null,
    chart_at: c.rank ? daysAgo(1) : null, refreshed_at: daysAgo(1), refresh_message: null, created_at: daysAgo(40),
  }));
}

const quote = (reviewId: string, text: string, rating: number) => ({ reviewId, text, rating, version: "4.2.0" });
function summary(appId: string, overview: string, loves: string[], complaints: string[], requests: string[], pricing: string[]): SummaryRow {
  const themes = (list: string[], rating: number) => list.map((theme, i) => ({ theme, detail: `${theme}: mentioned again and again in recent reviews.`, count: 40 - i * 9, quotes: [quote(`${appId}-${rating}-${i}`, `${theme}. That's why I keep using it.`, rating)] }));
  const body: ReviewSummary = { overview, loves: themes(loves, 5), complaints: themes(complaints, 2), requests: themes(requests, 4), pricing: themes(pricing, 3) };
  return { app_id: appId, kind: "app", scope: "app", summary: body, review_count: 300, model: "sample", created_at: daysAgo(2) };
}

const SUMMARIES: SummaryRow[] = [
  summary(MARKET_APPS.peak, "Loved for its trail maps and reviews from other hikers; the price of the yearly plan and battery drain are the main complaints.",
    ["Huge trail library", "Reviews from real hikers"], ["Drains the battery", "Yearly plan feels pricey"], ["Weather at the summit", "Plan a whole weekend"], ["Too expensive for a few hikes a year"]),
  summary(MARKET_APPS.ridge, "Offline GPS wins praise; the app is hard to learn and people want simpler route planning.",
    ["Works with no signal", "Accurate tracking"], ["Hard to learn", "Cluttered map"], ["Simpler route planning", "Drive time to the trailhead"], ["Fair price for the offline maps"]),
  summary(MARKET_APPS.summit, "A small, loyal following of peak baggers; reviewers ask for maps and better sync.",
    ["Summit badges"], ["No maps", "Sync loses hikes"], ["Trail maps", "Apple Watch app"], ["Good value"]),
];

function snapshots(base: number, chart: string): Snapshot[] {
  return Array.from({ length: 30 }, (_, i) => ({ day: daysAgo(29 - i).slice(0, 10), rating: Math.round((base - 0.1 + i * 0.004) * 100) / 100, rating_count: 1000 + i * 12, version: i > 20 ? "4.2.0" : "4.1.3", rank: 40 - Math.round(i / 2), chart }));
}
const releases: Release[] = [
  { version: "4.2.0", released_at: daysAgo(6), notes: NOTES, source: "store" },
  { version: "4.1.3", released_at: daysAgo(20), notes: "Bug fixes.", source: "store" },
  { version: "4.1.0", released_at: daysAgo(35), notes: "Save a trail for later and get a reminder on Friday.", source: "store" },
];
const reviews: Review[] = [
  { store_review_id: "r1", rating: 5, title: "My go-to on the trail", body: "Found three new trails near me in a week. The maps are great.", author: "hiker_jen", version: "4.2.0", reviewed_at: daysAgo(2), country: "us" },
  { store_review_id: "r2", rating: 2, title: "Battery", body: "Love the maps but it drains my battery by lunchtime.", author: "mark_t", version: "4.2.0", reviewed_at: daysAgo(4), country: "us" },
  { store_review_id: "r3", rating: 4, title: "Want the weather", body: "Great app. Please show the weather at the top, not just the town.", author: "sam.r", version: "4.1.3", reviewed_at: daysAgo(9), country: "us" },
];

/** Research › App stores' requests, answered from the sample; null for anything else. */
export function marketAnswer(path: string, method: string, tx: Tx = english): Response | null {
  const list = apps(tx);
  const overview = path.match(/^\/api\/w\/([^/]+)\/market$/);
  if (overview && method === "GET") {
    const body: MarketOverview = { setup: true, apps: list, summaries: SUMMARIES, competitors: COMPETITORS.map((c) => c.name) };
    return json(body);
  }
  const one = path.match(/^\/api\/w\/([^/]+)\/market\/([^/]+)$/);
  if (one && method === "GET") {
    const found = list.find((a) => a.id === one[2]) ?? null;
    const body: MarketDetail = {
      setup: true, app: found, snapshots: found ? snapshots(found.rating ?? 4, tx(WORLD_TEXT.chart)) : [], releases: found ? releases : [], stars: [12, 9, 20, 61, 198], reviewCount: 300,
      reviews: found ? reviews : [], summary: SUMMARIES.find((s) => s.app_id === found?.id) ?? null,
    };
    return json(body, found ? 200 : 404);
  }
  return null;
}

