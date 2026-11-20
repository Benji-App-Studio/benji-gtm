// Launch tracking: one row per ad sent from the dashboard, wherever it runs, with its whole lineage
// (the competitor ad it was made from → the studio creative → the ad on Meta) and its numbers.
// Pure functions over rows the server loads (lib/server/launched-ads.ts), so every join and sum is
// tested without a database (tracking.test.ts).
//
// Which ads: every Launch draft (an ad still on its way to Meta shows its draft status), plus ads on
// Meta that the sync linked to a studio creative or that carry Launch's ad name (made before drafts
// kept the ad id). Ads made elsewhere are Measure's business, not this view's.
//
// Numbers follow Measure: Meta spend, impressions and clicks per ad per day; installs, trials,
// purchases and revenue from the attribution source Measure counts (AppStack when it is the source
// of truth and its dollars can be converted, else Meta). Money stays in the ad account's currency,
// like Ads Manager and Launch's target CAC; AppStack's USD revenue is converted at the sync's rate.
// Verdicts reuse Launch's promote/pause rules (promotion.ts) and Measure's verdict and alerts.
import type { AdMetrics, AdMetricsDay } from "@/lib/ad-metrics";
import { alerts, dayList, isMetaSource, metrics as metricsOf, parseLaunchName, verdict as measureVerdict, type Group, type MeasureData, type Metrics, type Totals } from "../measure";
import { evaluate, stageOf, type Context, type Suggestion, type Thresholds } from "./promotion";
import { pauseRefusal, promoteRefusal } from "./scope";
import type { DraftStatus } from "./types";

// MARK: Inputs (rows as the database returns them)

export interface DraftInput {
  id: string;
  ad_id: string | null;
  creative_ref: string;
  /** The copy of the creative Launch kept when it sent the ad (ApprovedCreative's fields). */
  creative: { thumbnailUrl?: string; url?: string; kind?: string; formatSlug?: string; formatCardId?: string; hookType?: string; title?: string; headline?: string; prompt?: string | null; batchId?: string | null } | null;
  ad_name: string;
  adset_id: string;
  stage: "TEST" | "SCALE";
  status: DraftStatus;
  source: "manual" | "automation" | "promotion";
  promoted_from_ad_id: string | null;
  error: string | null;
  created_at: string;
}

export interface Delivery { configured: string | null; issues: { summary: string; level?: string | null }[]; created: string | null; account?: string | null }

export interface AdInput {
  ad_id: string; name: string; status: string | null; campaign_id: string | null; adset_id: string | null; adset_name: string | null;
  creative_id: string | null; thumbnail_url: string | null; format_id: string | null;
  /** Filled by the sync (migration 20261120300000); absent on an older database. */
  creative_ref?: string | null;
  delivery?: Delivery | null;
}

export interface DayInput { ad_id: string; date: string; spend: number; impressions: number; clicks: number; installs: number; trials: number; purchases: number; purchase_value: number }
export interface AttributedInput { ad_id: string; date: string; media_source: string; installs: number; trials: number; purchases: number; revenue_usd: number }

export interface CreativeInput {
  id: string; url: string; thumbnail_url: string | null; kind: string; prompt: string | null; title: string | null; headline: string | null;
  format_card_id: string | null; format_slug: string | null; hook_type: string | null; batch_id: string | null; created_at: string;
}

/** The competitor ad a batch was made from (Research → Recreate / Make this for your app). */
export interface SourceAd {
  batchId: string;
  /** paid_ads.id, when the ad is still in Research. */
  paidAdId: string | null;
  libraryId: string | null;
  pageName: string;
  thumb: string | null;
  headline: string | null;
  /** Its page in Meta's Ad Library. */
  url: string | null;
}

export interface TrackingInput {
  range: { since: string; until: string };
  /** The ad account's currency: every amount below is in it. */
  currency: string;
  /** USD per unit of the account's currency (the sync's rate); 1 for USD, null when unknown. */
  usdPerUnit: number | null;
  /** Who attributes conversions to ads (Measure's truthFor().split). */
  split: "meta" | "appstack";
  /** LTV in USD for Measure's verdict, or null. */
  ltvUsd: number | null;
  thresholds: Thresholds;
  testingAdSetId: string | null;
  scalingAdSetId: string | null;
  adAccountId?: string | null;
  /** This workspace's app code (Launch's names start with it); null when Launch isn't set up. */
  appCode: string | null;
  drafts: DraftInput[];
  ads: AdInput[];
  days: DayInput[];
  attributed: AttributedInput[];
  creatives: CreativeInput[];
  sources: SourceAd[];
}

// MARK: Output

/** Where an ad stands, as one word the page translates. */
export type StatusKey =
  | "queued" | "processing" | "creating" | "failed" | "cancelled" | "not_synced"
  | "running" | "paused" | "adset_paused" | "campaign_paused" | "in_review" | "in_process" | "rejected" | "issues" | "preapproved" | "billing" | "archived" | "deleted" | "unknown";

export type VerdictCode =
  | "promote" | "pause" | "in_scaling" | "not_live" | "paused"
  | "winner" | "on_target" | "above_target" | "learning" | "no_customers" | "converting" | "no_customers_yet" | "no_spend";

export type Tone = "win" | "warn" | "neutral" | "accent";
export type AttentionReason = "draft_failed" | "delivery" | "pause_suggested" | "no_customers" | "above_target";
export type Filter = "all" | "testing" | "scaling" | "attention" | "paused";
export const FILTERS: Filter[] = ["all", "testing", "scaling", "attention", "paused"];

export interface TrackedDay { date: string; spend: number; impressions: number; clicks: number; installs: number; trials: number; purchases: number; revenue: number }

export interface LaunchedAd {
  /** The Meta ad id, or `draft:<id>` for an ad not on Meta yet. */
  key: string;
  adId: string | null;
  draftId: string | null;
  name: string;
  stage: "TEST" | "SCALE" | null;
  source: DraftInput["source"] | "name";
  adSetId: string | null;
  adSetName: string | null;
  campaignId: string | null;
  status: StatusKey;
  /** Meta's effective_status, as Meta wrote it. */
  metaStatus: string | null;
  draftStatus: DraftStatus | null;
  draftError: string | null;
  /** The ad's account as the sync last saw it; null when unknown (older rows). */
  account: string | null;
  /** The draft that carries this ad's id: what the launch function checks before a pause or promote. */
  scopeDraft: { stage: "TEST" | "SCALE"; status: DraftStatus } | null;
  issues: string[];
  paused: boolean;
  thumbnail: string | null;
  createdAt: string | null;
  currency: string;
  m: Metrics;
  /** Zero-filled, one per day of the range, oldest first. */
  days: TrackedDay[];
  verdict: { code: VerdictCode; tone: Tone };
  /** Launch's promote/pause judgement, when the ad is on Meta. */
  suggestion: Suggestion | null;
  attention: AttentionReason[];
  lineage: {
    source: SourceAd | null;
    creative: { id: string; thumbnail: string | null; url: string | null; kind: string | null; title: string | null; prompt: string | null; format: string | null; hook: string | null; createdAt: string | null; deleted: boolean } | null;
    meta: { adId: string; creativeId: string | null; url: string } | null;
    promotedFrom: { adId: string; name: string | null } | null;
  };
}

export interface Tracking {
  range: { since: string; until: string };
  currency: string;
  split: "meta" | "appstack";
  ads: LaunchedAd[];
  counts: Record<Filter, number>;
}

// MARK: Helpers

const num = (v: unknown) => Number(v) || 0;
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function adsManagerUrl(adAccountId: string | null | undefined, adId: string) {
  const act = adAccountId?.replace(/^act_/, "");
  return act ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${act}&selected_ad_ids=${adId}` : `https://adsmanager.facebook.com/adsmanager/manage/ads?selected_ad_ids=${adId}`;
}

export const adLibraryUrl = (libraryId: string | null | undefined) => (libraryId && /^\d{5,25}$/.test(libraryId) ? `https://www.facebook.com/ads/library/?id=${libraryId}` : null);

const DRAFT_STATUS: Record<DraftStatus, StatusKey> = { queued: "queued", processing: "processing", creating: "creating", draft: "not_synced", error: "failed", cancelled: "cancelled" };
const META_STATUS: Record<string, StatusKey> = {
  ACTIVE: "running", PAUSED: "paused", ADSET_PAUSED: "adset_paused", CAMPAIGN_PAUSED: "campaign_paused", PENDING_REVIEW: "in_review", IN_PROCESS: "in_process",
  DISAPPROVED: "rejected", WITH_ISSUES: "issues", PREAPPROVED: "preapproved", PENDING_BILLING_INFO: "billing", ARCHIVED: "archived", DELETED: "deleted",
};
const PAUSED: StatusKey[] = ["paused", "adset_paused", "campaign_paused", "archived", "deleted", "cancelled"];
const TROUBLE: StatusKey[] = ["rejected", "issues", "billing"];

/** One word for where the ad is: the draft's progress until it is on Meta, then Meta's delivery status. */
export function statusOf(draft: Pick<DraftInput, "status" | "ad_id"> | null, ad: Pick<AdInput, "status"> | null): StatusKey {
  if (ad?.status) return META_STATUS[ad.status] ?? "unknown";
  if (draft) return DRAFT_STATUS[draft.status] ?? "unknown";
  return "unknown";
}

/** Measure's verdict label → a code the page translates. */
const MEASURE_CODE: Record<string, VerdictCode> = {
  "No spend": "no_spend", Converting: "converting", "No customers yet": "no_customers_yet", "No customers": "no_customers",
  Learning: "learning", Winner: "winner", "On target": "on_target", "Above target": "above_target",
};

function emptyDay(date: string): TrackedDay {
  return { date, spend: 0, impressions: 0, clicks: 0, installs: 0, trials: 0, purchases: 0, revenue: 0 };
}

// MARK: The join

export function trackLaunchedAds(input: TrackingInput): Tracking {
  const { range, currency } = input;
  const usdPerUnit = currency === "USD" ? 1 : input.usdPerUnit;
  // AppStack counts in dollars: without a rate its revenue can't sit next to the account's spend.
  const useAppStack = input.split === "appstack" && usdPerUnit != null && usdPerUnit > 0;
  const truth = useAppStack ? "appstack" : "meta";
  const inRange = (date: string) => date >= range.since && date <= range.until;
  const calendar = dayList(range.since, range.until);

  const adsById = new Map(input.ads.map((a) => [a.ad_id, a]));
  const creatives = new Map(input.creatives.map((c) => [c.id, c]));
  const sources = new Map(input.sources.map((s) => [s.batchId, s]));

  // Drafts by ad: the newest one wins (a re-send of the same ad id doesn't happen, but be safe).
  const drafts = [...input.drafts].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const draftByAd = new Map<string, DraftInput>();
  for (const d of drafts) if (d.ad_id) draftByAd.set(d.ad_id, d);

  // Delivery and attribution per ad, within the range.
  const metaBy = new Map<string, DayInput[]>();
  for (const d of input.days) if (inRange(d.date)) metaBy.set(d.ad_id, [...(metaBy.get(d.ad_id) ?? []), d]);
  const attributedBy = new Map<string, AttributedInput[]>();
  if (useAppStack) for (const r of input.attributed) if (r.ad_id && inRange(r.date) && isMetaSource(r.media_source)) attributedBy.set(r.ad_id, [...(attributedBy.get(r.ad_id) ?? []), r]);

  const launched = new Map<string, "TEST" | "SCALE">();
  for (const [adId, d] of draftByAd) launched.set(adId, d.stage);
  const ctx: Context = {
    testingAdSetId: input.testingAdSetId, scalingAdSetId: input.scalingAdSetId, launched,
    promoted: new Set(drafts.filter((d) => d.source === "promotion" && d.status === "draft" && d.promoted_from_ad_id).map((d) => d.promoted_from_ad_id!)),
  };
  const ltv = input.ltvUsd != null && usdPerUnit ? input.ltvUsd / usdPerUnit : null;

  // Drafts without an ad id, by name (the sync's rule: one name is one ad; two drafts with one name
  // can't be told apart). A Meta ad with that name is that draft's ad, so the two make one row.
  const idlessByName = new Map<string, DraftInput | null>();
  for (const d of drafts) if (!d.ad_id && d.status !== "cancelled") idlessByName.set(d.ad_name, idlessByName.has(d.ad_name) ? null : d);
  const byName = new Map<string, DraftInput>();

  // Ads Launch made without a draft that knows their id: the sync linked them to a creative, an
  // id-less draft has their name, or their name is Launch's with this app's code.
  const rows: { key: string; draft: DraftInput | null; ad: AdInput | null }[] = [];
  const seen = new Set<string>(draftByAd.keys());
  const extra: typeof rows = [];
  for (const ad of input.ads) {
    if (seen.has(ad.ad_id)) continue;
    const named = parseLaunchName(ad.name);
    const draft = idlessByName.get(ad.name) ?? null;
    const ours = Boolean(named && input.appCode && named.app === input.appCode);
    if (!draft && !ad.creative_ref && !ours) continue;
    seen.add(ad.ad_id);
    if (draft) byName.set(draft.id, draft);
    extra.push({ key: ad.ad_id, draft, ad });
    // Sent before drafts kept the ad id: the draft's stage, or the stage in Launch's name.
    const stage = draft?.stage ?? (named?.stage as "TEST" | "SCALE" | undefined);
    if (stage && ad.adset_id !== input.testingAdSetId && ad.adset_id !== input.scalingAdSetId) launched.set(ad.ad_id, stage);
  }
  // Every draft (an ad not on Meta yet keyed by the draft), then those ads.
  for (const d of drafts) {
    if (d.ad_id) {
      if (draftByAd.get(d.ad_id) !== d) continue;
      rows.push({ key: d.ad_id, draft: d, ad: adsById.get(d.ad_id) ?? null });
    } else if (d.status !== "cancelled" && !byName.has(d.id)) {
      rows.push({ key: `draft:${d.id}`, draft: d, ad: null });
    }
  }
  rows.push(...extra);

  const ads = rows.map(({ key, draft, ad }): LaunchedAd => {
    const adId = draft?.ad_id ?? ad?.ad_id ?? null;
    // Days: Meta's delivery and the attributed conversions, summed per date.
    const byDate = new Map<string, TrackedDay>();
    const dayFor = (date: string) => byDate.get(date) ?? (byDate.set(date, emptyDay(date)), byDate.get(date)!);
    const meta = adId ? metaBy.get(adId) ?? [] : [];
    const attributed = adId ? attributedBy.get(adId) ?? [] : [];
    for (const r of meta) {
      const day = dayFor(r.date);
      day.spend += num(r.spend); day.impressions += num(r.impressions); day.clicks += num(r.clicks);
      if (!useAppStack) { day.installs += num(r.installs); day.trials += num(r.trials); day.purchases += num(r.purchases); day.revenue += num(r.purchase_value); }
    }
    for (const r of attributed) {
      const day = dayFor(r.date);
      day.installs += num(r.installs); day.trials += num(r.trials); day.purchases += num(r.purchases); day.revenue += num(r.revenue_usd) / usdPerUnit!;
    }
    const delivered = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    const days = calendar.map((date) => byDate.get(date) ?? emptyDay(date));

    // Measure's formulas, in the account's currency.
    const sum = (pick: (d: TrackedDay) => number) => delivered.reduce((s, d) => s + pick(d), 0);
    const conv = { installs: sum((d) => d.installs), trials: sum((d) => d.trials), purchases: sum((d) => d.purchases), revenue: sum((d) => d.revenue) };
    const zero = { installs: 0, trials: 0, purchases: 0, revenue: 0 };
    const totals: Totals = {
      spend: sum((d) => d.spend), impressions: sum((d) => d.impressions), reach: 0, clicks: sum((d) => d.clicks), linkClicks: 0,
      meta: truth === "meta" ? conv : zero, appstack: truth === "appstack" ? conv : zero,
    };
    const m = metricsOf(totals, truth);

    const judged = ad ? stageOf({ adId: ad.ad_id, adSetId: ad.adset_id ?? "" }, ctx) : "OTHER";
    const stage = draft?.stage ?? (judged !== "OTHER" ? judged : null);
    const status = statusOf(draft, ad);
    const paused = PAUSED.includes(status) || (status === "not_synced");
    const issues = (ad?.delivery?.issues ?? []).map((i) => i.summary).filter(Boolean);

    // Launch's promote/pause rules (by ad set, else by the stage the ad was sent as).
    let suggestion: Suggestion | null = null;
    if (adId && ad) {
      const adMetrics: AdMetrics = {
        adId, adName: ad.name || draft?.ad_name || adId, adSetId: ad.adset_id ?? draft?.adset_id ?? "", campaignId: ad.campaign_id ?? "",
        ...(ad.status ? { status: ad.status } : {}), currency,
        days: delivered.map((d): AdMetricsDay => ({ date: d.date, spend: d.spend, impressions: d.impressions, clicks: d.clicks, installs: d.installs, trials: d.trials, purchases: d.purchases, revenue: d.revenue })),
      };
      suggestion = evaluate(adMetrics, input.thresholds, ctx);
    }
    const role = stage === "TEST" ? "testing" : stage === "SCALE" ? "scaling" : null;
    const mv = measureVerdict(m, ltv, role);
    const verdict: LaunchedAd["verdict"] = !adId ? { code: "not_live", tone: status === "failed" ? "warn" : "neutral" }
      : suggestion?.verdict === "promote" && !paused ? { code: "promote", tone: "win" }
      : suggestion?.verdict === "pause" && !paused ? { code: "pause", tone: "warn" }
      : suggestion?.verdict === "promoted" ? { code: "in_scaling", tone: "accent" }
      : paused && m.spend <= 0 ? { code: "paused", tone: "neutral" }
      : { code: MEASURE_CODE[mv.label] ?? "learning", tone: mv.tone };

    // Lineage: the studio creative (by the draft, else the sync's link), its batch's competitor ad.
    const original = draft?.promoted_from_ad_id ? draftByAd.get(draft.promoted_from_ad_id) : undefined;
    const studioRef = [draft?.creative_ref, original?.creative_ref, ad?.creative_ref].find((r) => r && !r.startsWith("meta:")) ?? null;
    const row = studioRef ? creatives.get(studioRef) : undefined;
    const snapshot = (draft?.creative_ref && !draft.creative_ref.startsWith("meta:") ? draft.creative : null) ?? original?.creative ?? null;
    const creative: LaunchedAd["lineage"]["creative"] = row
      ? { id: row.id, thumbnail: row.thumbnail_url ?? (row.kind === "image" ? row.url : null), url: row.url, kind: row.kind, title: row.title ?? row.headline, prompt: row.prompt, format: row.format_slug ?? row.format_card_id ?? ad?.format_id ?? null, hook: row.hook_type, createdAt: row.created_at, deleted: false }
      : studioRef
      ? { id: studioRef, thumbnail: snapshot?.thumbnailUrl ?? (snapshot?.kind === "image" ? snapshot.url ?? null : null), url: snapshot?.url || null, kind: snapshot?.kind ?? null, title: snapshot?.title ?? snapshot?.headline ?? null, prompt: snapshot?.prompt ?? null, format: snapshot?.formatSlug ?? snapshot?.formatCardId ?? ad?.format_id ?? null, hook: snapshot?.hookType ?? null, createdAt: null, deleted: true }
      : null;
    const batchId = row?.batch_id ?? snapshot?.batchId ?? null;
    const thumbnail = creative?.thumbnail ?? ad?.thumbnail_url ?? null;

    const attention: AttentionReason[] = [];
    if (status === "failed") attention.push("draft_failed");
    if (TROUBLE.includes(status) || (issues.length && !paused)) attention.push("delivery");
    if (verdict.code === "pause") attention.push("pause_suggested");

    return {
      key, adId, draftId: draft?.id ?? null,
      name: ad?.name || draft?.ad_name || key,
      stage, source: draft?.source ?? "name",
      adSetId: ad?.adset_id ?? draft?.adset_id ?? null, adSetName: ad?.adset_name ?? null, campaignId: ad?.campaign_id ?? null,
      status, metaStatus: ad?.status ?? null, draftStatus: draft?.status ?? null, draftError: ad ? null : draft?.error ?? null, issues, paused,
      account: ad?.delivery?.account ?? null, scopeDraft: draft?.ad_id ? { stage: draft.stage, status: draft.status } : null,
      thumbnail, createdAt: ad?.delivery?.created ?? draft?.created_at ?? null, currency, m, days, verdict, suggestion, attention,
      lineage: {
        source: batchId ? sources.get(batchId) ?? null : null,
        creative,
        meta: adId ? { adId, creativeId: ad?.creative_id ?? null, url: adsManagerUrl(input.adAccountId, adId) } : null,
        promotedFrom: draft?.promoted_from_ad_id ? { adId: draft.promoted_from_ad_id, name: adsById.get(draft.promoted_from_ad_id)?.name ?? original?.ad_name ?? null } : null,
      },
    };
  });

  // Measure's alerts on these ads (no customer after a customer's worth of spend; CAC above LTV).
  const fmt = (n: number) => `${Math.round(n)} ${currency}`;
  const asGroups: Group[] = ads.filter((a) => a.adId).map((a) => ({
    key: a.key, name: a.name, sub: "", role: a.stage === "TEST" ? "testing" : a.stage === "SCALE" ? "scaling" : null, level: "ad", thumbnail: a.thumbnail, campaignId: a.campaignId, adIds: [a.adId!],
    totals: { spend: a.m.spend, impressions: a.m.impressions, reach: 0, clicks: a.m.clicks, linkClicks: 0, meta: { installs: a.m.installs, trials: a.m.trials, purchases: a.m.purchases, revenue: a.m.revenue }, appstack: { installs: 0, trials: 0, purchases: 0, revenue: 0 } },
    m: a.m, fallbackName: null,
  }));
  const none = { installs: 0, trials: 0, purchases: 0, revenue: 0 };
  const flagged = alerts({ sync: {} } as MeasureData, asGroups, [], { spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, meta: none, appstack: none }, ltv, fmt);
  for (const alert of flagged) {
    if (alert.tone !== "warn" || !alert.key) continue;
    const ad = ads.find((a) => a.key === alert.key);
    if (!ad || ad.paused) continue;
    const reason: AttentionReason = alert.id.startsWith("nobuy-") ? "no_customers" : "above_target";
    if (!ad.attention.includes(reason)) ad.attention.push(reason);
  }

  const counts = Object.fromEntries(FILTERS.map((f) => [f, ads.filter((a) => matches(a, f)).length])) as Record<Filter, number>;
  return { range, currency, split: truth, ads: ads.sort((a, b) => b.m.spend - a.m.spend || (b.createdAt ?? "").localeCompare(a.createdAt ?? "")), counts };
}

export function matches(ad: LaunchedAd, filter: Filter): boolean {
  switch (filter) {
    case "all": return true;
    case "testing": return Boolean(ad.adId) && ad.stage === "TEST" && !ad.paused;
    case "scaling": return Boolean(ad.adId) && ad.stage === "SCALE" && !ad.paused;
    case "attention": return ad.attention.length > 0;
    case "paused": return ad.paused;
  }
}

// MARK: Actions

/**
 * The writes the ad's detail offers: exactly what the launch function accepts (scope.ts is its
 * byte-for-byte copy), and nothing for an ad that's already paused or already copied to scaling.
 */
export function allowedActions(ad: LaunchedAd, s: { testingAdSetId: string | null; scalingAdSetId: string | null; adAccountId: string | null }) {
  if (!ad.adId) return { pause: false, promote: false };
  const scopeAd = { adset_id: ad.adSetId ?? "", account_id: ad.account ?? undefined };
  const settings = { testing_adset_id: s.testingAdSetId, scaling_adset_id: s.scalingAdSetId, adAccountId: s.adAccountId };
  return {
    pause: !ad.paused && pauseRefusal(scopeAd, settings, ad.scopeDraft) === null,
    promote: ad.verdict.code !== "in_scaling" && promoteRefusal(scopeAd, settings, ad.scopeDraft) === null,
  };
}

// MARK: Sorting and export

export type SortKey = "spend" | "impressions" | "ctr" | "installs" | "cpi" | "trials" | "purchases" | "cac" | "roas" | "created" | "name";

/** Highest first for counts and money, lowest first for costs; missing values always last. */
export function sortAds(ads: LaunchedAd[], key: SortKey, descending = true): LaunchedAd[] {
  const value = (a: LaunchedAd): number | string | null => key === "name" ? a.name.toLowerCase() : key === "created" ? a.createdAt ?? null
    : key === "spend" ? a.m.spend : key === "impressions" ? a.m.impressions : key === "ctr" ? a.m.ctr : key === "installs" ? a.m.installs : key === "cpi" ? a.m.cpi
    : key === "trials" ? a.m.trials : key === "purchases" ? a.m.purchases : key === "cac" ? a.m.cac : a.m.roas;
  return [...ads].sort((a, b) => {
    const x = value(a), y = value(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    const order = x < y ? -1 : x > y ? 1 : 0;
    return descending ? -order : order;
  });
}

/** Totals over a set of rows (the filtered table's footer). */
export function summarize(ads: LaunchedAd[]) {
  const s = ads.reduce((t, a) => ({ spend: t.spend + a.m.spend, impressions: t.impressions + a.m.impressions, clicks: t.clicks + a.m.clicks, installs: t.installs + a.m.installs, trials: t.trials + a.m.trials, purchases: t.purchases + a.m.purchases, revenue: t.revenue + a.m.revenue }),
    { spend: 0, impressions: 0, clicks: 0, installs: 0, trials: 0, purchases: 0, revenue: 0 });
  return { ...s, ctr: ratio(s.clicks, s.impressions), cpi: ratio(s.spend, s.installs), cac: ratio(s.spend, s.purchases), roas: ratio(s.revenue, s.spend) };
}

/**
 * One CSV cell. Text that a spreadsheet would read as a formula (=, +, -, @, tab, carriage return
 * first) gets a leading apostrophe: ad names come from Ads Manager, where anyone can type them.
 */
export const cell = (v: unknown) => {
  let s = v == null ? "" : typeof v === "number" ? String(Math.round(v * 10000) / 10000) : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The table as CSV, one row per ad, with its lineage ids so a spreadsheet can join it back. */
export function toCsv(ads: LaunchedAd[], currency: string): string {
  const c = currency.toLowerCase();
  const header = ["ad_id", "name", "stage", "status", "meta_status", "verdict", `spend_${c}`, "impressions", "clicks", "ctr", "installs", `cpi_${c}`, "trials", "purchases", `cac_${c}`, `revenue_${c}`, "roas", "ad_set_id", "creative_id", "competitor_ad", "created"];
  const lines = ads.map((a) => [
    a.adId ?? "", a.name, a.stage ?? "", a.status, a.metaStatus ?? "", a.verdict.code, a.m.spend, a.m.impressions, a.m.clicks, a.m.ctr, a.m.installs, a.m.cpi,
    a.m.trials, a.m.purchases, a.m.cac, a.m.revenue, a.m.roas, a.adSetId ?? "", a.lineage.creative?.id ?? "", a.lineage.source?.libraryId || a.lineage.source?.pageName || "", a.createdAt ?? "",
  ].map(cell).join(","));
  // A byte-order mark first, so Excel reads the file as UTF-8 (names in Chinese, Japanese, Korean).
  return `﻿${[header.join(","), ...lines].join("\n")}`;
}

/** Spend against installs and purchases per day, and CAC over a running 7-day window (the detail chart). */
export function cacTrend(days: TrackedDay[], window = 7): { date: string; cac: number | null }[] {
  return days.map((d, i) => {
    const slice = days.slice(Math.max(0, i - window + 1), i + 1);
    const spend = slice.reduce((s, x) => s + x.spend, 0);
    const purchases = slice.reduce((s, x) => s + x.purchases, 0);
    return { date: d.date, cac: ratio(spend, purchases) };
  });
}
