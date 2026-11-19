import "server-only";
// The per-ad numbers Launch's promotion rules read (the contract Launch defined in this file),
// served from Measure's snapshots: Meta Insights per ad and day, with installs, trials, purchases
// and revenue from the attribution source Measure counts (AppStack when connected, else Meta).
// Everything is in the ad account's currency, as the contract asks. Reads as the signed-in user, so
// row-level security keeps it to the workspace's owner.
import { truthFor, DEFAULT_SETTINGS, isMetaSource, type MeasureData, type MeasureSettings, type SyncRow } from "@/lib/measure";
import { createClient } from "@/lib/supabase/server";

export interface AdMetricsDay {
  /** YYYY-MM-DD in the ad account's time zone. */
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  installs: number;
  trials: number;
  purchases: number;
  /** Revenue attributed to the ad that day (RevenueCat proceeds, ad account currency). */
  revenue: number;
}

export interface AdMetrics {
  adId: string;
  adName: string;
  adSetId: string;
  campaignId: string;
  /** Meta's effective_status (ACTIVE, PAUSED, …). */
  status?: string;
  /** The ad account's currency; spend and revenue are in it. */
  currency: string;
  /** One row per day with delivery, oldest first; totals are their sums. */
  days: AdMetricsDay[];
}

const PAGE = 1000;

export async function getAdMetrics(productId: string, range: { since: string; until: string }): Promise<AdMetrics[]> {
  const db = await createClient();
  const [settings, sync, ads] = await Promise.all([
    db.from("measure_settings").select("cac_source, ltv_basis, ltv_manual").eq("product_id", productId).maybeSingle(),
    db.from("measure_sync").select("source, status, message, currency, fx_rate, details, synced_at").eq("product_id", productId),
    db.from("meta_ads").select("ad_id, name, status, campaign_id, adset_id").eq("product_id", productId),
  ]);
  if (sync.error || ads.error) return [];
  const syncBy = Object.fromEntries(((sync.data ?? []) as SyncRow[]).map((s) => [s.source, s]));
  const meta = syncBy.meta as SyncRow | undefined;
  if (meta?.status !== "ok" && !(ads.data ?? []).length) return [];
  const currency = meta?.currency ?? "USD";
  // AppStack reports USD; the contract wants the ad account's currency.
  const usdPerUnit = currency === "USD" ? 1 : Number(meta?.fx_rate) || null;
  const { split } = truthFor({ settings: { ...DEFAULT_SETTINGS, ...((settings.data ?? {}) as Partial<MeasureSettings>) }, sync: syncBy } as MeasureData);
  const useAppStack = split === "appstack" && usdPerUnit != null;

  const rows = async <T,>(table: string, columns: string) => {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from(table).select(columns).eq("product_id", productId).gte("date", range.since).lte("date", range.until).order("date").range(from, from + PAGE - 1);
      if (error) return out;
      out.push(...((data ?? []) as T[]));
      if (!data || data.length < PAGE) return out;
    }
  };
  type MetaDay = { ad_id: string; date: string; spend: number; impressions: number; clicks: number; installs: number; trials: number; purchases: number; purchase_value: number };
  type AsDay = { ad_id: string; date: string; media_source: string; installs: number; trials: number; purchases: number; revenue_usd: number };
  const [metaDays, asDays] = await Promise.all([
    rows<MetaDay>("meta_daily", "ad_id, date, spend, impressions, clicks, installs, trials, purchases, purchase_value"),
    useAppStack ? rows<AsDay>("appstack_daily", "ad_id, date, media_source, installs, trials, purchases, revenue_usd") : Promise.resolve([] as AsDay[]),
  ]);
  const attributed = new Map<string, AsDay[]>();
  for (const r of asDays) {
    if (!r.ad_id || !isMetaSource(r.media_source)) continue;
    const key = `${r.ad_id}|${r.date}`;
    attributed.set(key, [...(attributed.get(key) ?? []), r]);
  }

  const byAd = new Map<string, AdMetricsDay[]>();
  for (const d of metaDays) {
    const as = attributed.get(`${d.ad_id}|${d.date}`) ?? [];
    const sum = (pick: (r: AsDay) => number) => as.reduce((s, r) => s + (Number(pick(r)) || 0), 0);
    const day: AdMetricsDay = {
      date: d.date, spend: Number(d.spend) || 0, impressions: Number(d.impressions) || 0, clicks: Number(d.clicks) || 0,
      installs: useAppStack ? sum((r) => r.installs) : Number(d.installs) || 0,
      trials: useAppStack ? sum((r) => r.trials) : Number(d.trials) || 0,
      purchases: useAppStack ? sum((r) => r.purchases) : Number(d.purchases) || 0,
      revenue: useAppStack ? Math.round((sum((r) => r.revenue_usd) / usdPerUnit!) * 100) / 100 : Number(d.purchase_value) || 0,
    };
    byAd.set(d.ad_id, [...(byAd.get(d.ad_id) ?? []), day]);
  }

  const info = new Map(((ads.data ?? []) as { ad_id: string; name: string; status: string | null; campaign_id: string | null; adset_id: string | null }[]).map((a) => [a.ad_id, a]));
  return [...byAd.entries()].map(([adId, days]) => {
    const ad = info.get(adId);
    return {
      adId, adName: ad?.name ?? adId, adSetId: ad?.adset_id ?? "", campaignId: ad?.campaign_id ?? "",
      ...(ad?.status ? { status: ad.status } : {}), currency, days: days.sort((a, b) => a.date.localeCompare(b.date)),
    };
  });
}
