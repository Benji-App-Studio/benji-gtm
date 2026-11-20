import "server-only";
// Launch's Ads view on the server: loads every ad Launch sent and the rows its lineage needs (drafts,
// Meta's ads and daily numbers, AppStack's attribution, the studio creatives and the competitor ads
// their batches were made from), as the signed-in user, so row-level security keeps it to the
// install's members. The join itself is lib/launch/tracking.ts. Reads only: nothing here calls Meta.
import type { SupabaseClient } from "@supabase/supabase-js";
import { appCode } from "@/lib/launch/naming";
import { thresholds as thresholdsFrom, type Thresholds } from "@/lib/launch/promotion";
import { adLibraryUrl, trackLaunchedAds, type AdInput, type AttributedInput, type CreativeInput, type DayInput, type DraftInput, type SourceAd, type Tracking } from "@/lib/launch/tracking";
import { addDays, DEFAULT_SETTINGS, economics, RANGES, revenuecat, truthFor, type MeasureData, type MeasureSettings, type RcRow, type SyncRow } from "@/lib/measure";
import type { Session } from "./auth";

const PAGE = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LaunchedAdsData extends Tracking {
  days: number;
  thresholds: Thresholds;
  adAccountId: string | null;
  testingAdSetId: string | null;
  scalingAdSetId: string | null;
  /** When Meta last synced (Measure's sync), or null before the first one. */
  syncedAt: string | null;
}

type Page = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

/** Every row of a query, a page at a time (PostgREST answers at most 1,000 per request). */
async function all<T>(page: (from: number, to: number) => Page): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

/** Rows by id, 200 ids per request; an error leaves the lineage incomplete rather than the page broken. */
async function byIds<T>(ids: string[], query: (chunk: string[]) => Page): Promise<T[]> {
  const out: T[] = [];
  const list = [...new Set(ids.filter((id) => UUID.test(id)))];
  for (let i = 0; i < list.length; i += 200) {
    const { data, error } = await query(list.slice(i, i + 200));
    if (error) return out;
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

const AD_COLUMNS = "ad_id, name, status, campaign_id, adset_id, adset_name, creative_id, thumbnail_url, format_id";
const DRAFT_COLUMNS = "id, ad_id, creative_ref, creative, ad_name, adset_id, stage, status, source, promoted_from_ad_id, error, created_at";

/** meta_ads with the sync's lineage columns, or without them on a database from before they existed. */
async function metaAds(db: SupabaseClient, productId: string): Promise<AdInput[]> {
  try {
    return await all<AdInput>((a, b) => db.from("meta_ads").select(`${AD_COLUMNS}, creative_ref, delivery`).eq("product_id", productId).order("ad_id").range(a, b));
  } catch {
    return all<AdInput>((a, b) => db.from("meta_ads").select(AD_COLUMNS).eq("product_id", productId).order("ad_id").range(a, b));
  }
}

const num = <T extends object>(row: T, keys: (keyof T)[]) => {
  for (const key of keys) (row as Record<keyof T, unknown>)[key] = Number(row[key]) || 0;
  return row;
};

export async function loadLaunchedAds(session: Session, productId: string, requested: number): Promise<LaunchedAdsData> {
  const days = (RANGES as readonly number[]).includes(requested) ? requested : 28;
  const until = new Date().toISOString().slice(0, 10);
  const since = addDays(until, -(days - 1));
  const db = session.supabase;

  const [settingsRow, drafts, ads, metaDays, attributed, measureSettings, sync, rcRows] = await Promise.all([
    db.from("launch_settings").select("testing_adset_id, scaling_adset_id, thresholds, meta, app_code").eq("product_id", productId).maybeSingle(),
    // Every page in a stable order: each sort ends on the table's unique key.
    all<DraftInput>((a, b) => db.from("launch_drafts").select(DRAFT_COLUMNS).eq("product_id", productId).order("created_at").order("id").range(a, b)),
    metaAds(db, productId),
    all<DayInput>((a, b) => db.from("meta_daily").select("ad_id, date, spend, impressions, clicks, installs, trials, purchases, purchase_value").eq("product_id", productId).gte("date", since).lte("date", until).order("date").order("ad_id").range(a, b)),
    all<AttributedInput>((a, b) => db.from("appstack_daily").select("ad_id, date, media_source, installs, trials, purchases, revenue_usd").eq("product_id", productId).gte("date", since).lte("date", until)
      .order("date").order("media_source").order("campaign_id").order("adset_id").order("ad_id").range(a, b)),
    db.from("measure_settings").select("cac_source, ltv_basis, ltv_manual").eq("product_id", productId).maybeSingle(),
    db.from("measure_sync").select("source, status, message, currency, fx_rate, details, synced_at").eq("product_id", productId),
    all<RcRow>((a, b) => db.from("revenuecat_daily").select("date, chart, measure, segment, value").eq("product_id", productId).in("chart", ["proceeds", "actives_new"]).gte("date", since).lte("date", until)
      .order("date").order("chart").order("measure").order("segment").range(a, b)).catch(() => [] as RcRow[]),
  ]);

  // Measure's choices: who attributes conversions, the account's currency and rate, and LTV.
  const syncBy = Object.fromEntries(((sync.data ?? []) as SyncRow[]).map((s) => [s.source, { ...s, fx_rate: s.fx_rate == null ? null : Number(s.fx_rate) }]));
  const ms = (measureSettings.data ?? {}) as Partial<MeasureSettings>;
  const msettings: MeasureSettings = { ...DEFAULT_SETTINGS, ...ms, ltv_manual: ms.ltv_manual == null ? null : Number(ms.ltv_manual) };
  const measure = { settings: msettings, sync: syncBy } as unknown as MeasureData;
  const { split } = truthFor(measure);
  const rc = revenuecat(measure, rcRows.map((r) => num(r, ["value"])));
  const ltvUsd = economics(msettings, rc, null).ltv;
  const meta = syncBy.meta as SyncRow | undefined;

  // The studio creatives the drafts and the sync point at, and the competitor ads their batches came from.
  const refs = [...drafts.map((d) => d.creative_ref), ...ads.map((a) => a.creative_ref ?? "")];
  const creatives = await byIds<CreativeInput>(refs, (ids) => db.from("creatives").select("id, url, thumbnail_url, kind, prompt, title, headline, format_card_id, format_slug, hook_type, batch_id, created_at").in("id", ids));
  const batchIds = [...creatives.map((c) => c.batch_id ?? ""), ...drafts.map((d) => d.creative?.batchId ?? "")];
  const batches = await byIds<{ id: string; settings: { sourceAd?: { adId?: string; libraryId?: string; pageName?: string } } | null }>(batchIds, (ids) => db.from("creative_batches").select("id, settings").in("id", ids));
  const refsOf = batches.flatMap((b) => (b.settings?.sourceAd ? [{ batchId: b.id, ...b.settings.sourceAd }] : []));
  const paid = await byIds<{ id: string; ad_id: string; page_name: string; competitor: string | null; thumb: string | null; headline: string | null }>(refsOf.map((r) => r.adId ?? ""), (ids) => db.from("paid_ads").select("id, ad_id, page_name, competitor, thumb, headline").in("id", ids));
  const paidById = new Map(paid.map((p) => [p.id, p]));
  const sources: SourceAd[] = refsOf.map((r) => {
    const p = r.adId ? paidById.get(r.adId) : undefined;
    const libraryId = p?.ad_id ?? r.libraryId ?? null;
    return { batchId: r.batchId, paidAdId: p?.id ?? null, libraryId, pageName: p?.competitor ?? p?.page_name ?? r.pageName ?? "", thumb: p?.thumb ?? null, headline: p?.headline || null, url: adLibraryUrl(libraryId) };
  });

  const settings = settingsRow.data as { testing_adset_id: string | null; scaling_adset_id: string | null; thresholds: Partial<Thresholds> | null; meta: { adAccountId?: string; appName?: string } | null; app_code: string | null } | null;
  const t = thresholdsFrom(settings?.thresholds);
  const tracking = trackLaunchedAds({
    range: { since, until }, currency: meta?.currency ?? "USD", usdPerUnit: meta?.fx_rate ?? null, split, ltvUsd, thresholds: t,
    testingAdSetId: settings?.testing_adset_id ?? null, scalingAdSetId: settings?.scaling_adset_id ?? null, adAccountId: settings?.meta?.adAccountId ?? null,
    // The launch function's codeFor(): Launch's names for this workspace start with it.
    appCode: settings ? appCode(settings.meta?.appName ?? "App", settings.app_code) : null,
    drafts, ads,
    days: metaDays.map((d) => num(d, ["spend", "impressions", "clicks", "installs", "trials", "purchases", "purchase_value"])),
    attributed: attributed.map((d) => num(d, ["installs", "trials", "purchases", "revenue_usd"])),
    creatives, sources,
  });
  return {
    ...tracking, days, thresholds: t, adAccountId: settings?.meta?.adAccountId ?? null,
    testingAdSetId: settings?.testing_adset_id ?? null, scalingAdSetId: settings?.scaling_adset_id ?? null, syncedAt: meta?.synced_at ?? null,
  };
}

/** Every ad Launch sent and the stage it was sent as (the Launch page's suggestions judge them all). */
export async function launchedStages(db: SupabaseClient, productId: string): Promise<Map<string, "TEST" | "SCALE">> {
  const rows = await all<{ ad_id: string; stage: "TEST" | "SCALE" }>((a, b) => db.from("launch_drafts").select("ad_id, stage")
    .eq("product_id", productId).not("ad_id", "is", null).not("status", "in", "(error,cancelled)").order("id").range(a, b)).catch(() => []);
  return new Map(rows.map((d) => [d.ad_id, d.stage]));
}

/** Measure's ads with Launch's lineage picture and a `launched` flag (the row links to the ad's detail). */
export function withLaunched<T extends { ad_id: string }>(ads: T[], thumbs: Record<string, string | null>): (T & { launched?: boolean; launch_thumbnail?: string | null })[] {
  return ads.map((a) => (a.ad_id in thumbs ? { ...a, launched: true, launch_thumbnail: thumbs[a.ad_id] } : a));
}

/**
 * Measure's link to the lineage: for each ad Launch sent, the studio creative's picture (a video's
 * poster) and that it can open in Launch's Ads view. Empty when anything is missing: Measure never
 * fails over it.
 */
export async function launchedThumbnails(db: SupabaseClient, productId: string): Promise<Record<string, string | null>> {
  try {
    const drafts = await all<Pick<DraftInput, "ad_id" | "creative_ref" | "creative">>((a, b) => db.from("launch_drafts").select("ad_id, creative_ref, creative")
      .eq("product_id", productId).not("ad_id", "is", null).order("id").range(a, b));
    const creatives = await byIds<{ id: string; url: string; kind: string; thumbnail_url: string | null }>(drafts.map((d) => d.creative_ref), (ids) => db.from("creatives").select("id, url, kind, thumbnail_url").in("id", ids));
    const byId = new Map(creatives.map((c) => [c.id, c.thumbnail_url ?? (c.kind === "image" ? c.url : null)]));
    const out: Record<string, string | null> = {};
    for (const d of drafts) {
      const snap = d.creative;
      out[d.ad_id!] = byId.get(d.creative_ref) ?? snap?.thumbnailUrl ?? (snap?.kind === "image" ? snap.url ?? null : null);
    }
    return out;
  } catch {
    return {};
  }
}
