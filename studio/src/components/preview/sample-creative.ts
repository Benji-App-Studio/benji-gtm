// Sample answers for the creative and ads pages in the development preview (/preview) and the example
// app: Studio, Remix, Launch, Measure, Home's business card and Settings > Desktop runner. Every number
// comes from the one sample world (sample-world.ts), so the pages agree. Nothing here is real. Which keys
// the sample install has is picked with ?keys= on the preview address:
//   ?keys=none   nothing connected (every page shows its "connect" state)
//   ?keys=some   OpenAI only (the default)
//   ?keys=all    everything connected, the desktop runner included
import { DEFAULT_PLAYGROUND_OPTIONS } from "@/lib/playground-plan";
import type { KeyState } from "@/lib/install/types";
import { m } from "@/lib/i18n/translate";
import { scalingAdvice } from "@/lib/launch/scaling";
import { businessSummary } from "@/lib/business-summary";
import type { AdRow, AppStackRow, MeasureData, MetaDayRow, MixpanelRow, RcRow, SuperwallRow } from "@/lib/measure";
import { sampleLaunchedAds, SAMPLE_THRESHOLDS } from "./sample-launch-ads";
import { ADS, adDay, adName, adSetOf, appDay, bundled, CREATIVES, creativeImage, day, english, OVERVIEW, WORLD, type Tx } from "./sample-world";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const now = () => new Date().toISOString();

export type SampleKeys = "none" | "some" | "all";
/** The example app (components/example) has every key: it says so here instead of in its address. */
let forced: SampleKeys | null = null;
export const forceSampleKeys = (mode: SampleKeys) => { forced = mode; };
export const sampleKeys = (): SampleKeys => {
  if (forced) return forced;
  const asked = new URLSearchParams(location.search).get("keys");
  return asked === "none" || asked === "all" ? asked : "some";
};

/** Sets the sample install's keys for the chosen mode. `key` builds one key's state. */
export function applySampleKeys(keys: Record<string, KeyState>, key: (set: boolean, extra?: Partial<KeyState>) => KeyState, mode: SampleKeys) {
  for (const name of Object.keys(keys)) keys[name] = key(mode === "all");
  if (mode === "some") keys.OPENAI_API_KEY = key(true);
  keys.CREATIVES_RUNNER_SECRET = key(mode === "all", { last4: mode === "all" ? "c41e" : null });
}

/** The connections each sample app has in this mode: everything when all keys are set (or only ?source=<one>), else nothing. */
export function sampleConnections(mode: SampleKeys): Record<string, Record<string, string>> {
  if (mode !== "all") return {};
  const all: Record<string, Record<string, string>> = { meta: { adAccountId: WORLD.adAccountId, pageId: WORLD.pageId }, revenuecat: { projectId: "proj_sample" }, superwall: { applicationId: "9021" }, mixpanel: { projectId: "3141592", region: "us" }, appstack: { appId: "app_sample" }, storage: { driveFolderId: "folder_sample" } };
  const only = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("source");
  return only && all[only] ? { [only]: all[only] } : all;
}

// MARK: Studio

/** The Studio's creatives: the four approved ones Launch sent, and two still waiting for review. */
export function studioCreatives(productId: string, tx: Tx = english) {
  const base = { product_id: productId, format_card_id: null, width: 1080, height: 1350, duration_sec: null, storage_path: "sample", poster_path: null, mime: "image/png", size_bytes: 1, model: "gpt_image_2_5", copy: {}, qa_at: now(), approval_note: null, reviewed_at: null, reviewed_by: null, notes: null, drive_file_id: null, thumbnail_url: null, description: null, copy_variants: [], awareness_level: null, cta: "Download", hook_type: null, approved_at: null, created_at: `${day(-41)}T09:00:00Z`, updated_at: now() };
  const qa = (title: string, warn: boolean) => ({ checks: [{ id: "app", label: "App name", rules: [], verdict: "pass", reason: "" }, { id: "claims", label: "Claims", rules: [], verdict: warn ? "warn" : "pass", reason: warn ? tx(m("Says “in a tap”: make sure the app really plans a trail in one tap.")) : "" }], notes: [], textSeen: [WORLD.name, title] });
  return CREATIVES.map((c, n) => ({
    ...base, id: c.id, job_id: `j${n + 1}`, batch_id: c.batch, kind: "image", style: c.format === "tweet" ? "tweet" : "image", aspect: c.aspect,
    ...(c.aspect === "1:1" ? { width: 1080, height: 1080, model: null } : {}), url: creativeImage(c.id), title: c.title, headline: c.title,
    primary_text: c.approved ? "Pick a trail, see the weather at the top, go." : null, prompt: `A weekend hiker checks Trailmix at a trailhead: ${c.title}.`,
    format_slug: c.format, hook_type: c.hook,
    qa_status: c.id === "c6" ? "pending" : c.id === "c5" ? "warn" : "pass", qa: c.id === "c6" ? null : qa(c.title, c.id === "c5"),
    approval: c.approved ? "approved" : "pending", approved_at: c.approved ? `${day(-41)}T12:00:00Z` : null,
  }));
}

function jobs(productId: string, tx: Tx) {
  const base = { product_id: productId, batch_id: "b1", format_card_id: null, prompt: "", params: {}, variant: 1, cost_estimate: 6, cost_credits: null, attempts: 0, not_before: null, error: null, started_at: null, finished_at: null, created_at: `${day(-41)}T09:00:00Z`, updated_at: now() };
  return [
    ...CREATIVES.filter((c) => c.batch).map((c, n) => ({ ...base, id: `j${CREATIVES.indexOf(c) + 1}`, kind: "image", model: "gpt_image_2_5", aspect: c.aspect, variant: n + 1, backend: "auto", status: "done", cost_credits: 6 })),
    { ...base, id: "j7", kind: "ugc_video", model: "marketing_studio_video", aspect: "9:16", backend: "local", status: "queued", cost_estimate: 40 },
    { ...base, id: "j8", kind: "ai_video", model: "seedance_2_5", aspect: "9:16", backend: "auto", status: "failed", cost_estimate: 30, cost_credits: 0, error: tx(m("Higgsfield stopped the job: its content policy refused the prompt. No credits were charged.")) },
  ];
}

function studio(productId: string, name: string, mode: SampleKeys, tx: Tx) {
  const all = mode === "all";
  const made = studioCreatives(productId, tx);
  return {
    workspace: { id: productId, name, appName: name, screenshots: 3, appStoreUrl: WORLD.appStoreUrl, iconUrl: bundled(WORLD.iconPath), driveFolderId: all ? "folder_sample" : null, profile: null, assets: [], brandSystem: null, imageProvider: "higgsfield" },
    batches: [{ id: "b1", format_card_id: null, brief: "A hiker plans a weekend trail in a minute, then shows the saved route.", settings: {}, cost_estimate: 82, created_at: `${day(-41)}T09:00:00Z` }],
    jobs: jobs(productId, tx), creatives: made,
    catalog: { avatars: [], hooks: [], settings: [], syncedAt: null },
    backend: { typesafe: mode !== "none", higgsfieldApi: all, runner: all, drive: all, openaiImages: mode !== "none" },
    hiddenBatchIds: [], playgroundBatchIds: [],
  };
}

function playground(productId: string, name: string, mode: SampleKeys) {
  const all = mode === "all";
  const request = { mode: "image", prompt: "Put our app screen on the phone and change the headline to “Plan a hike in a minute”.", referenceUrl: null, inputUrls: [], aspect: "4:5", count: 2, options: DEFAULT_PLAYGROUND_OPTIONS };
  const job = { error: null, notBefore: null, costEstimate: 6, costCredits: null, provider: "higgsfield", estUsd: null, costUsd: null };
  return {
    workspace: { id: productId, name, appName: name, tagline: null, forbiddenClaims: [] },
    backend: { runner: all, higgsfieldApi: all, typesafe: mode !== "none", openaiImages: mode !== "none" },
    imageProvider: "higgsfield",
    items: [{
      batchId: "pb1", createdAt: now(), credits: 12, usd: null, request,
      jobs: [{ ...job, id: "pj1", variant: 1, status: "done", backend: "auto", costCredits: 6 }, { ...job, id: "pj2", variant: 2, status: "queued", backend: "auto" }],
      outputs: [{ id: "po1", jobId: "pj1", kind: "image", url: creativeImage("c1"), posterUrl: null, durationSec: null, width: 1080, height: 1350, aspect: "4:5", model: "gpt_image_2_5", createdAt: now(), qaStatus: "pass", approval: "pending" }],
    }],
    productImages: [], researchImages: [],
  };
}

// MARK: Launch

function launch(productId: string, name: string) {
  const T = WORLD.testing, S = WORLD.scaling;
  const settings = {
    product_id: productId, app_code: WORLD.appCode, objective: "app_promotion", meta: { adAccountId: WORLD.adAccountId, pageId: WORLD.pageId, appName: name, appStoreUrl: WORLD.appStoreUrl },
    countries: ["US"], testing_campaign_id: T.campaignId, testing_adset_id: T.adSetId, scaling_campaign_id: S.campaignId, scaling_adset_id: S.adSetId, testing_daily_budget: T.dailyBudget, scaling_daily_budget: S.dailyBudget, max_daily_budget: null,
    thresholds: SAMPLE_THRESHOLDS, default_cta: null, scaling_budget: "campaign", optimize_for: "install", automation_enabled: false, automation_max_ads_per_day: 3, automation_max_ads_in_adset: 20,
    automation_last_run_at: null, automation_last_note: null,
  };
  const approved = studioCreatives(productId).filter((c) => c.approval === "approved").map((c) => ({ id: c.id, url: c.url, kind: "image", aspect: c.aspect, headline: c.headline ?? undefined, primaryText: c.primary_text ?? undefined, cta: "Download", title: c.title, aiGenerated: true, productId, style: "image", width: 1080, height: 1350, mime: "image/png", storagePath: "sample" }));
  const testingAds = ADS.filter((a) => a.stage === "TEST");
  // The scaling ad set's days, for the 20 %-every-48-hours advice.
  const scalingMetrics = ADS.filter((a) => a.stage === "SCALE").map((a) => ({
    adId: a.adId, adName: adName(a), adSetId: S.adSetId, campaignId: S.campaignId, status: a.status, currency: "USD",
    days: Array.from({ length: 28 }, (_, k) => k - 27).flatMap((i) => { const d = adDay(a, i); return d ? [{ date: day(i), spend: d.spend, impressions: d.impressions, clicks: d.clicks, installs: d.appstack.installs, trials: d.appstack.trials, purchases: d.appstack.purchases, revenue: d.appstack.revenue }] : []; }),
  }));
  const spend28 = Math.round(ADS.reduce((s, a) => s + Array.from({ length: 28 }, (_, k) => adDay(a, k - 27)?.spend ?? 0).reduce((x, y) => x + y, 0), 0) * 100) / 100;
  return {
    workspace: { id: productId, name, appName: name, appStoreUrl: settings.meta.appStoreUrl },
    settings, defaults: settings, creatives: approved, drafts: [],
    status: { connected: true, version: "v26.0", account: { id: WORLD.adAccountId, name: WORLD.adAccountName, currency: "USD", accountStatus: 1, hasPaymentMethod: true, url: "https://adsmanager.facebook.com" }, testing: { id: T.adSetId, name: T.adSetLaunchName(), status: "ACTIVE", effectiveStatus: "ACTIVE", dailyBudget: T.dailyBudget * 100, lifetimeBudget: null, ads: testingAds.length, url: "https://adsmanager.facebook.com" } },
    suggestions: [], thresholds: SAMPLE_THRESHOLDS, metricsRange: { since: day(-27), until: day(0) },
    scaling: scalingAdvice({ metrics: scalingMetrics, thresholds: SAMPLE_THRESHOLDS, scalingAdSetId: S.adSetId, dailyBudget: S.dailyBudget, maxDailyBudget: null, currency: "USD" }),
    volume: { last7: ADS.filter((a) => a.sent > -7).length, last28: ADS.filter((a) => a.sent > -28).length, spend28 }, mmpConnected: true,
  };
}

// MARK: Measure

/** Measure's numbers for the last `days` days (and the `days` before them). `only` leaves a single source connected (?source=meta|revenuecat|appstack|superwall|mixpanel). */
export function measureData(productId: string, name: string, days: number, only: string | null): MeasureData {
  const has = (s: string) => !only || only === s;
  const since = day(-days + 1), until = day(0), prevSince = day(-2 * days + 1);
  const ads: AdRow[] = ADS.map((ad) => {
    const set = adSetOf(ad);
    const creative = CREATIVES.find((c) => c.id === ad.creative);
    return { ad_id: ad.adId, name: adName(ad), status: ad.status, campaign_id: set.campaignId, adset_id: set.adSetId, adset_name: set.adSetName, creative_id: `mc_${ad.creative}`, creative_name: creative?.title ?? "Before and after, old cut", thumbnail_url: creativeImage(ad.creative), format_id: ad.format, launched: true, launch_thumbnail: creativeImage(ad.creative) };
  });
  const meta: MetaDayRow[] = [], appstack: AppStackRow[] = [], revenuecat: RcRow[] = [], mixpanel: MixpanelRow[] = [], superwall: SuperwallRow[] = [];
  const rc = (date: string, chart: string, measure: string, segment: string, value: number) => revenuecat.push({ date, chart, measure, segment, value });
  for (let i = -2 * days + 1; i <= 0; i++) {
    const date = day(i);
    for (const ad of ADS) {
      const d = adDay(ad, i);
      if (!d) continue;
      const set = adSetOf(ad);
      if (has("meta")) meta.push({ ad_id: ad.adId, date, campaign_id: set.campaignId, adset_id: set.adSetId, spend: d.spend, impressions: d.impressions, reach: d.reach, clicks: d.clicks, link_clicks: d.linkClicks, installs: d.meta.installs, trials: d.meta.trials, purchases: d.meta.purchases, purchase_value: d.meta.value });
      if (has("appstack")) appstack.push({ date, media_source: "meta", campaign_id: set.campaignId, adset_id: set.adSetId, ad_id: ad.adId, campaign_name: null, ad_name: adName(ad), installs: d.appstack.installs, trials: d.appstack.trials, purchases: d.appstack.purchases, revenue_usd: d.appstack.revenue });
    }
    const a = appDay(i);
    const wave = 1 + 0.15 * Math.sin(i / 3);
    if (has("revenuecat")) {
      rc(date, "trials_new", "Trials", "", a.trials);
      rc(date, "actives_new", "Total", "Yearly", a.yearly); rc(date, "actives_new", "Total", "Monthly", a.monthly);
      rc(date, "revenue", "Revenue", "", a.revenue);
      rc(date, "proceeds", "Proceeds", "Yearly", Math.round(a.yearly * WORLD.proceeds.yearly * 100) / 100); rc(date, "proceeds", "Proceeds", "Monthly", Math.round((a.monthly + a.renewals) * WORLD.proceeds.monthly * 100) / 100);
      rc(date, "customers_new", "New customers", "", a.installs);
      rc(date, "trial_conversion_rate", "Trial starts", "", a.trials); rc(date, "trial_conversion_rate", "Conversions", "", Math.round(a.trials * 0.4));
      rc(date, "mrr", "MRR", "", a.mrr);
      rc(date, "churn", "Churned Actives", "Monthly", ((i % 4) + 4) % 4 === 0 ? 1 : 0); rc(date, "churn", "Actives", "Monthly", 62);
      rc(date, "new_sub_revenue", "Revenue (net of taxes)", "Yearly", Math.round(a.yearly * WORLD.net.yearly * 100) / 100); rc(date, "new_sub_revenue", "Transactions", "Yearly", a.yearly);
      rc(date, "new_sub_revenue", "Revenue (net of taxes)", "Monthly", Math.round(a.monthly * WORLD.net.monthly * 100) / 100); rc(date, "new_sub_revenue", "Transactions", "Monthly", a.monthly);
      rc(date, "refunds", "Refunded revenue", "", a.refund); rc(date, "refund_rate", "Refunds", "", a.refund ? 1 : 0); rc(date, "refund_rate", "Transactions", "", a.newPaid + a.renewals);
      // Cohorts at least 30 days old carry their conversion windows and realized LTV.
      if (i <= -30) {
        for (const [window, rate] of [[3, 4.1], [7, 5.2], [14, 6.0], [30, 6.6]]) {
          rc(date, `paying_conversion_${window}`, "New customers", "0", a.installs); rc(date, `paying_conversion_${window}`, "Conversion %", "1", rate);
        }
        if (a.newPaid) { rc(date, "ltv_paying", "Paying customers", "0", a.newPaid); rc(date, "ltv_paying", "Day 7", "1", WORLD.ltvDay7); rc(date, "ltv_paying", "Day 30", "2", WORLD.ltvDay30); }
      }
    }
    if (has("mixpanel")) {
      mixpanel.push({ date, metric: "funnel_install", segment: "", value: a.installs }, { date, metric: "funnel_signup", segment: "", value: Math.round(a.installs * 0.62) }, { date, metric: "funnel_paywall", segment: "", value: Math.round(a.installs * 0.55) },
        { date, metric: "funnel_trial", segment: "", value: a.trials }, { date, metric: "funnel_purchase", segment: "", value: a.newPaid }, { date, metric: "active", segment: "", value: Math.round(820 + 40 * wave) },
        { date, metric: "retention_size", segment: "", value: a.installs }, { date, metric: "ttc_seconds", segment: "", value: 86_400 * (2.5 + wave) }, { date, metric: "ttc_conversions", segment: "", value: a.newPaid });
      for (let d = 0; d <= Math.min(30, -i); d++) mixpanel.push({ date, metric: "retention", segment: `D${d}`, value: Math.round(a.installs * (d === 0 ? 1 : 0.18 + 0.32 * Math.exp(-d / 4))) });
    }
    if (has("superwall")) {
      // Every new customer and trial went through a paywall: most at the end of onboarding.
      const discount = a.newPaid > 1 && i % 2 === 0 ? 1 : 0, settings = a.newPaid - discount > 1 && i % 4 === 0 ? 1 : 0;
      superwall.push({ date, paywall: "annual_first", placement: "onboarding_end", opens: Math.round(a.installs * 0.55), conversions: a.newPaid - discount - settings, trials: a.trials - 1, starts: a.trials + 4, revenue_usd: 0, refunds_usd: 0 },
        { date, paywall: "discount_50", placement: "app_open", opens: Math.round(a.installs * 0.22), conversions: discount, trials: 0, starts: 3, revenue_usd: 0, refunds_usd: 0 },
        { date, paywall: "annual_first", placement: "settings", opens: Math.round(a.installs * 0.06), conversions: settings, trials: 1, starts: 2, revenue_usd: 0, refunds_usd: 0 },
        { date, paywall: "", placement: "", opens: 0, conversions: 0, trials: 0, starts: 0, revenue_usd: a.revenue, refunds_usd: a.refund });
    }
  }
  const row = (source: string, details = {}) => ({ source, status: "ok" as const, message: null, currency: "USD", fx_rate: null, details, synced_at: now() });
  return {
    workspace: { id: productId, name, connected: { meta: has("meta"), revenuecat: has("revenuecat"), appstack: has("appstack"), mixpanel: has("mixpanel"), superwall: has("superwall") } },
    range: { days, since, until, prevSince },
    settings: { cac_source: "auto", ltv_basis: "first_purchase", ltv_manual: null, scenario: null },
    sync: { ...(has("meta") ? { meta: row("meta", { account: { name: WORLD.adAccountName, currency: "USD" } }) } : {}), ...(has("revenuecat") ? { revenuecat: row("revenuecat", { overview: { active_subscriptions: { value: OVERVIEW.activeSubscriptions, unit: "", period: "", name: "" }, active_trials: { value: OVERVIEW.activeTrials, unit: "", period: "", name: "" }, mrr: { value: OVERVIEW.mrr(), unit: "$", period: "", name: "" } } }) } : {}), ...(has("appstack") ? { appstack: row("appstack") } : {}),
      ...(has("mixpanel") ? { mixpanel: row("mixpanel", { events: { install: "$ae_first_open", signup: "Sign Up", paywall: "Paywall Viewed", trial: "Trial Started", purchase: "Purchase", active: "$ae_session" }, missing: [] }) } : {}),
      ...(has("superwall") ? { superwall: row("superwall", { app: { name: "Trailmix iOS", platform: "ios" } }) } : {}) } as MeasureData["sync"],
    health: { meta: has("meta"), revenuecat: has("revenuecat"), appstack: has("appstack"), mixpanel: has("mixpanel"), superwall: has("superwall"), allowList: true },
    campaigns: has("meta") ? [
      { campaign_id: WORLD.testing.campaignId, name: WORLD.testing.campaignName(), objective: "OUTCOME_APP_PROMOTION", status: "ACTIVE", daily_budget: WORLD.testing.dailyBudget, lifetime_budget: null, role: "testing" as const },
      { campaign_id: WORLD.scaling.campaignId, name: WORLD.scaling.campaignName(), objective: "OUTCOME_APP_PROMOTION", status: "ACTIVE", daily_budget: WORLD.scaling.dailyBudget, lifetime_budget: null, role: "scaling" as const },
    ] : [],
    ads: has("meta") ? ads : [], meta, revenuecat, appstack, mixpanel, superwall,
  };
}

/** What a sync of every source says, worked out from the same rows (the last 90 days), in the metrics function's English (Measure translates it: sync-words.ts). */
function syncMessages(productId: string, name: string) {
  const data = measureData(productId, name, 45, null);
  const n = (v: number) => v.toLocaleString("en-US");
  const installs = data.mixpanel.filter((r) => r.metric === "funnel_install").reduce((s, r) => s + r.value, 0);
  const opens = data.superwall.reduce((s, r) => s + r.opens, 0), paid = data.superwall.reduce((s, r) => s + r.conversions, 0);
  const since = day(-89);
  return {
    revenuecat: { status: "ok", message: `${n(data.revenuecat.length)} daily values since ${since}.` },
    superwall: { status: "ok", message: `Trailmix iOS: ${n(opens)} paywall views and ${n(paid)} paid purchases since ${since}.` },
    mixpanel: { status: "ok", message: `${n(installs)} installs and ${n(data.mixpanel.length)} daily values since ${since}.` },
    appstack: { status: "ok", message: `${n(data.appstack.reduce((s, r) => s + r.installs, 0))} installs and ${n(data.appstack.reduce((s, r) => s + r.purchases, 0))} purchases attributed since ${since}.` },
  };
}

/**
 * The creative and ads pages' requests, answered from the sample; null for anything else. `tx` puts the
 * sample's own words (an error, a check's note) in the reader's language (the example passes its translator).
 */
export function creativeAnswer(path: string, url: URL, method: string, names: Record<string, string>, tx: Tx = english): Response | null {
  const mode = sampleKeys();
  const name = (id: string) => names[id] ?? "App";
  const source = () => new URLSearchParams(location.search).get("source");
  if (path === "/api/background") return json({ tasks: [] });
  let match = path.match(/^\/api\/studio\/([^/]+)$/);
  if (match && method === "GET") return json(studio(match[1], name(match[1]), mode, tx));
  match = path.match(/^\/api\/playground\/([^/]+)$/);
  if (match && method === "GET") return json(playground(match[1], name(match[1]), mode));
  match = path.match(/^\/api\/playground\/([^/]+)\/templates$/);
  if (match && method === "GET") return json({ templates: [] });
  match = path.match(/^\/api\/launch\/([^/]+)\/ads$/);
  if (match && method === "GET") return json(sampleLaunchedAds(Number(url.searchParams.get("days")) || 28, tx));
  match = path.match(/^\/api\/launch\/([^/]+)(\/drafts)?$/);
  if (match && method === "GET") return json(match[2] ? [] : launch(match[1], name(match[1])));
  match = path.match(/^\/api\/w\/([^/]+)\/measure$/);
  if (match && method === "GET") return json(measureData(match[1], name(match[1]), Number(url.searchParams.get("days")) || 28, source()));
  if (match && method === "PATCH") return json({ saved: true });
  match = path.match(/^\/api\/w\/([^/]+)\/business$/);
  if (match && method === "GET") {
    if (mode !== "all") return json(businessSummary({ ...measureData(match[1], name(match[1]), 28, "none"), workspace: { id: match[1], name: name(match[1]), connected: { meta: false, revenuecat: false, appstack: false, mixpanel: false, superwall: false } } }));
    return json(businessSummary(measureData(match[1], name(match[1]), 28, source())));
  }
  match = path.match(/^\/api\/w\/([^/]+)\/measure\/sync$/);
  if (match) return json(syncMessages(match[1], name(match[1])));
  match = path.match(/^\/api\/w\/([^/]+)\/app$/);
  if (match) return json({ error: "The preview has no product context." }, 404);
  return null;
}

