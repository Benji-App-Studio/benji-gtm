import "server-only";
// Measure on the server: reads a workspace's snapshots as the signed-in user (row-level security
// keeps them to the owner) and calls the `metrics` edge function, which holds the API tokens.
import type { Session } from "./auth";
import { callFunction, type FunctionResult } from "./functions";
import { addDays, DEFAULT_SETTINGS, RANGES, type AdRow, type AppStackRow, type CampaignRow, type Health, type MeasureData, type MeasureSettings, type MetaDayRow, type RcRow, type Source, type SyncRow } from "@/lib/measure";
import { getWorkspace } from "@/lib/workspace";

const PAGE = 1000;

export type MetricsResult<T> = FunctionResult<T>;

export function metricsFunction<T = Record<string, unknown>>(session: Session | null, route: string, body?: unknown, timeout = 30_000): Promise<MetricsResult<T>> {
  return callFunction<T>("metrics", session, route, {
    body,
    timeoutMs: timeout,
    messages: {
      notDeployed: "The metrics function isn't deployed yet.",
      badAnswer: (status) => `Measure's backend answered ${status}.`,
      unreachable: "Couldn't reach Measure's backend. Try again in a moment.",
    },
  });
}

/** Every row of a query, a page at a time (PostgREST returns at most 1,000 per request). */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

const num = <T extends object>(row: T, keys: (keyof T)[]) => {
  for (const key of keys) (row as Record<keyof T, unknown>)[key] = Number(row[key]) || 0;
  return row;
};

/** The workspace's numbers for the last `days` days and the period before (for the deltas). */
export async function loadMeasure(session: Session, productId: string, requested: number): Promise<MeasureData> {
  const days = (RANGES as readonly number[]).includes(requested) ? requested : 28;
  const workspace = await getWorkspace(productId);
  const until = new Date().toISOString().slice(0, 10);
  const since = addDays(until, -(days - 1));
  const prevSince = addDays(since, -days);
  const db = session.supabase;

  const [settings, sync, campaigns, ads, meta, revenuecat, appstack, health] = await Promise.all([
    db.from("measure_settings").select("cac_source, ltv_basis, ltv_manual").eq("product_id", productId).maybeSingle(),
    db.from("measure_sync").select("source, status, message, currency, fx_rate, details, synced_at").eq("product_id", productId),
    all<CampaignRow>((a, b) => db.from("meta_campaigns").select("campaign_id, name, objective, status, daily_budget, lifetime_budget, role").eq("product_id", productId).range(a, b)),
    all<AdRow>((a, b) => db.from("meta_ads").select("ad_id, name, status, campaign_id, adset_id, adset_name, creative_id, creative_name, thumbnail_url, format_id").eq("product_id", productId).range(a, b)),
    all<MetaDayRow>((a, b) => db.from("meta_daily").select("ad_id, date, campaign_id, adset_id, spend, impressions, reach, clicks, link_clicks, installs, trials, purchases, purchase_value")
      .eq("product_id", productId).gte("date", prevSince).order("date").range(a, b)),
    all<RcRow>((a, b) => db.from("revenuecat_daily").select("date, chart, measure, segment, value").eq("product_id", productId).gte("date", prevSince).order("date").range(a, b)),
    all<AppStackRow>((a, b) => db.from("appstack_daily").select("date, media_source, campaign_id, adset_id, ad_id, campaign_name, ad_name, installs, trials, purchases, revenue_usd")
      .eq("product_id", productId).gte("date", prevSince).order("date").range(a, b)),
    metricsFunction<Health>(null, "health", undefined, 8_000),
  ]);

  const c = workspace.connections;
  const s = (settings.data ?? {}) as Partial<MeasureSettings>;
  return {
    workspace: { id: workspace.id, name: workspace.name, connected: { meta: Boolean(c.meta?.adAccountId), revenuecat: Boolean(c.revenuecat?.projectId), appstack: Boolean(c.appstack?.appId) } },
    range: { days, since, until, prevSince },
    settings: { ...DEFAULT_SETTINGS, ...s, ltv_manual: s.ltv_manual == null ? null : Number(s.ltv_manual) },
    sync: Object.fromEntries(((sync.data ?? []) as SyncRow[]).map((row) => [row.source, { ...row, fx_rate: row.fx_rate == null ? null : Number(row.fx_rate) }])) as Partial<Record<Source, SyncRow>>,
    health: health.ok ? { meta: Boolean(health.data.meta), revenuecat: Boolean(health.data.revenuecat), appstack: Boolean(health.data.appstack), allowList: Boolean(health.data.allowList) } : null,
    campaigns: campaigns.map((row) => ({ ...row, daily_budget: row.daily_budget == null ? null : Number(row.daily_budget), lifetime_budget: row.lifetime_budget == null ? null : Number(row.lifetime_budget) })),
    ads,
    meta: meta.map((row) => num(row, ["spend", "impressions", "reach", "clicks", "link_clicks", "installs", "trials", "purchases", "purchase_value"])),
    revenuecat: revenuecat.map((row) => num(row, ["value"])),
    appstack: appstack.map((row) => num(row, ["installs", "trials", "purchases", "revenue_usd"])),
  };
}
