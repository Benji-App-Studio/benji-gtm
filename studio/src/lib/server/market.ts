import "server-only";
// The Market page's server side: the tables are read as the signed-in user (row-level security), and
// everything that reaches the App Store, Apify or OpenAI goes through the insight function's `market-*`
// routes (supabase/functions/insight/market.ts).
import { fill, type Translator } from "@/lib/i18n/translate";
import { starCounts, type MarketApp, type MarketDetail, type MarketOverview, type Release, type Review, type Snapshot, type SummaryRow } from "@/lib/market";
import type { Session } from "./auth";
import { callFunction, type FunctionResult } from "./functions";

/** The actions the page can ask for, and the function route each one is. */
export const MARKET_ACTIONS = {
  search: "market-search", suggest: "market-suggest", track: "market-track", untrack: "market-untrack", refresh: "market-refresh",
  charts: "market-charts", summary: "market-summary", "chart-summary": "market-chart-summary",
} as const;
export type MarketAction = keyof typeof MARKET_ACTIONS;

/** How long each may take: the AI and a first read of an app's reviews take longer than a search. */
const TIMEOUTS: Partial<Record<MarketAction, number>> = { track: 90_000, refresh: 90_000, summary: 140_000, "chart-summary": 140_000, suggest: 60_000, charts: 45_000 };

type T = Translator["t"];
/** English when a caller passes no translator. */
const english: T = (text, vars) => fill(text, vars);

export async function marketFunction<R = Record<string, unknown>>(session: Session, action: MarketAction, body: Record<string, unknown>, t: T = english): Promise<FunctionResult<R>> {
  const NOT_DEPLOYED = t("Market isn't deployed to your backend yet. Run the update (docs/UPDATING.md) to add it.");
  const result = await callFunction<R>("insight", session, MARKET_ACTIONS[action], {
    body,
    timeoutMs: TIMEOUTS[action] ?? 30_000,
    messages: {
      unreachable: t("Couldn't reach the backend. Try again in a moment."),
      notDeployed: NOT_DEPLOYED,
      badAnswer: (status) => t("The backend answered {status}. Try again in a moment.", { status: String(status) }),
    },
  });
  // An insight function from before Market answers its own "Not found" for these routes.
  if (result.status === 404 && result.data?.error === "Not found") return { ...result, data: { ...result.data, error: NOT_DEPLOYED } };
  return result;
}

const MISSING = /does not exist|schema cache|relation|PGRST205|42P01/i;
export const isMissingTable = (error: { message?: string; code?: string } | null | undefined) => Boolean(error && (MISSING.test(error.message ?? "") || MISSING.test(error.code ?? "")));
/** Shown under "Market isn't set up in your database yet". */
const notSetUp = (t: T) => t("Run the update (docs/UPDATING.md in your copy) to add its tables. Nothing else changes.");

const APP_COLUMNS = "id, store, store_id, name, developer, icon_url, url, category, price, currency, price_label, has_iap, rating, rating_count, version, released_at, store_updated_at, release_notes, country, competitor_name, chart_rank, chart_label, chart_at, refreshed_at, refresh_message, created_at";

/** The tracked apps, their summaries and the product's competitor names. */
export async function loadMarket(session: Session, productId: string, t: T = english): Promise<MarketOverview> {
  const db = session.supabase;
  const [apps, summaries, watchlist, product] = await Promise.all([
    db.from("market_apps").select(APP_COLUMNS).eq("product_id", productId).order("created_at"),
    db.from("market_summaries").select("app_id, kind, scope, summary, review_count, model, created_at").eq("product_id", productId),
    db.from("ad_watchlist").select("name").eq("product_id", productId).eq("is_own", false),
    db.from("products").select("known_competitors").eq("id", productId).maybeSingle(),
  ]);
  const competitors = [...new Set([...(watchlist.data ?? []).map((r: { name: string }) => r.name), ...((product.data?.known_competitors as string[] | null) ?? [])].map((n) => String(n ?? "").trim()).filter(Boolean))];
  if (isMissingTable(apps.error) || isMissingTable(summaries.error)) return { setup: false, apps: [], summaries: [], competitors, message: notSetUp(t) };
  if (apps.error) throw new Error(apps.error.message);
  return { setup: true, apps: (apps.data ?? []) as MarketApp[], summaries: (summaries.data ?? []) as SummaryRow[], competitors };
}

/** One tracked app: its snapshots, releases, review stars and newest reviews, and its AI summary. */
export async function loadMarketApp(session: Session, productId: string, appId: string, t: T = english): Promise<MarketDetail> {
  const db = session.supabase;
  const empty: MarketDetail = { setup: true, app: null, snapshots: [], releases: [], stars: [0, 0, 0, 0, 0], reviewCount: 0, reviews: [], summary: null };
  const app = await db.from("market_apps").select(APP_COLUMNS).eq("id", appId).eq("product_id", productId).maybeSingle();
  if (isMissingTable(app.error)) return { ...empty, setup: false, message: notSetUp(t) };
  if (app.error) throw new Error(app.error.message);
  if (!app.data) return empty;
  const [snapshots, releases, ratings, reviews, summary] = await Promise.all([
    db.from("market_snapshots").select("day, rating, rating_count, version, rank, chart").eq("app_id", appId).order("day", { ascending: false }).limit(365),
    db.from("market_releases").select("version, released_at, notes, source").eq("app_id", appId).order("released_at", { ascending: false, nullsFirst: false }).limit(60),
    db.from("market_reviews").select("rating").eq("app_id", appId).limit(5000),
    db.from("market_reviews").select("store_review_id, rating, title, body, author, version, reviewed_at, country").eq("app_id", appId).order("reviewed_at", { ascending: false, nullsFirst: false }).limit(30),
    db.from("market_summaries").select("app_id, kind, scope, summary, review_count, model, created_at").eq("product_id", productId).eq("kind", "app").eq("scope", appId).maybeSingle(),
  ]);
  const stars = starCounts(((ratings.data ?? []) as { rating: number }[]).map((r) => r.rating));
  return {
    setup: true,
    app: app.data as MarketApp,
    snapshots: (snapshots.data ?? []) as Snapshot[],
    releases: (releases.data ?? []) as Release[],
    stars,
    reviewCount: stars.reduce((s, n) => s + n, 0),
    reviews: (reviews.data ?? []) as Review[],
    summary: (summary.data as SummaryRow | null) ?? null,
  };
}
