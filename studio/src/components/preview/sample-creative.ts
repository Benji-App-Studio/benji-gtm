// Sample answers for the creative and ads pages in the development preview (/preview): Studio,
// Playground, Launch, Measure and Settings > Desktop runner. Nothing here is real. Which keys the
// sample install has is picked with ?keys= on the preview address:
//   ?keys=none   nothing connected (every page shows its "connect" state)
//   ?keys=some   OpenAI only (the default)
//   ?keys=all    everything connected, the desktop runner included
import { DEFAULT_PLAYGROUND_OPTIONS } from "@/lib/playground-plan";
import type { KeyState } from "@/lib/install/types";
import { DEFAULT_THRESHOLDS } from "@/lib/launch/promotion";
import { scalingAdvice } from "@/lib/launch/scaling";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const now = () => new Date().toISOString();
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

export type SampleKeys = "none" | "some" | "all";
export const sampleKeys = (): SampleKeys => {
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
  const all: Record<string, Record<string, string>> = { meta: { adAccountId: "act_1234567890", pageId: "100200300400" }, revenuecat: { projectId: "proj_sample" }, appstack: { appId: "app_sample" }, storage: { driveFolderId: "folder_sample" } };
  const only = new URLSearchParams(location.search).get("source");
  return only && all[only] ? { [only]: all[only] } : all;
}

/** A flat picture in two token-like greys with a label, so a creative has something to show. */
const picture = (label: string, w = 400, h = 500, tint = "#dfe3ee") => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${tint}"/><circle cx="${w / 2}" cy="${h * 0.42}" r="${w * 0.18}" fill="#aab3c8"/><text x="50%" y="${h * 0.78}" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#4a5168">${label}</text></svg>`)}`;

function creatives(productId: string) {
  const base = { product_id: productId, format_card_id: null, width: 1080, height: 1350, duration_sec: null, storage_path: "sample", poster_path: null, mime: "image/png", size_bytes: 1, model: "gpt_image_2_5", copy: {}, qa_at: now(), approval_note: null, reviewed_at: null, reviewed_by: null, notes: null, drive_file_id: null, thumbnail_url: null, description: null, copy_variants: [], awareness_level: null, cta: "Download", hook_type: null, format_slug: null, approved_at: null, created_at: now(), updated_at: now() };
  const qa = (verdict: "pass" | "warn") => ({ checks: [{ id: "app", label: "App name", rules: [], verdict: "pass", reason: "" }, { id: "claims", label: "Claims", rules: [], verdict, reason: verdict === "warn" ? "Says “in a week”: make sure that isn't a promise." : "" }], notes: [], textSeen: ["Trailmix", "Plan a hike in a minute"] });
  return [
    { ...base, id: "c1", job_id: "j1", batch_id: "b1", kind: "image", style: "image", aspect: "4:5", url: picture("Plan a hike in a minute"), title: "Plan a hike in a minute", headline: "Plan a hike in a minute", primary_text: "Pick a trail, see the weather, go.", prompt: "A hiker checks the app at a trailhead.", qa_status: "pass", qa: qa("pass"), approval: "approved", approved_at: now() },
    { ...base, id: "c2", job_id: "j2", batch_id: "b1", kind: "image", style: "image", aspect: "4:5", url: picture("Your weekend, sorted", 400, 500, "#e6eadf"), title: "Your weekend, sorted", headline: null, primary_text: null, prompt: "A weekend plan on a phone.", qa_status: "warn", qa: qa("warn"), approval: "pending" },
    { ...base, id: "c3", job_id: null, batch_id: "b1", kind: "image", style: "tweet", aspect: "1:1", width: 1080, height: 1080, url: picture("Post-style ad", 400, 400, "#eee6df"), title: "Post-style ad", headline: null, primary_text: null, prompt: null, model: null, qa_status: "pending", qa: null, approval: "pending" },
  ];
}

function jobs(productId: string) {
  const base = { product_id: productId, batch_id: "b1", format_card_id: null, prompt: "", params: {}, variant: 1, cost_estimate: 6, cost_credits: null, attempts: 0, not_before: null, error: null, started_at: null, finished_at: null, created_at: now(), updated_at: now() };
  return [
    { ...base, id: "j1", kind: "image", model: "gpt_image_2_5", aspect: "4:5", backend: "auto", status: "done", cost_credits: 6 },
    { ...base, id: "j2", kind: "image", model: "gpt_image_2_5", aspect: "4:5", variant: 2, backend: "auto", status: "queued" },
    { ...base, id: "j3", kind: "ugc_video", model: "marketing_studio_video", aspect: "9:16", backend: "local", status: "queued", cost_estimate: 40 },
    { ...base, id: "j4", kind: "ai_video", model: "seedance_2_5", aspect: "9:16", backend: "auto", status: "failed", cost_estimate: 30, cost_credits: 0, error: "Higgsfield ended the job: content policy." },
  ];
}

function studio(productId: string, name: string, mode: SampleKeys) {
  const all = mode === "all";
  return {
    workspace: { id: productId, name, appName: name, screenshots: 3, appStoreUrl: null, iconUrl: null, driveFolderId: all ? "folder_sample" : null, profile: null, assets: [], brandSystem: null, imageProvider: "higgsfield" },
    batches: [{ id: "b1", format_card_id: null, brief: "A hiker plans a weekend trail in a minute, then shows the saved route.", settings: {}, cost_estimate: 82, created_at: now() }],
    jobs: jobs(productId), creatives: creatives(productId),
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
      outputs: [{ id: "po1", jobId: "pj1", kind: "image", url: picture("Plan a hike in a minute"), posterUrl: null, durationSec: null, width: 1080, height: 1350, aspect: "4:5", model: "gpt_image_2_5", createdAt: now(), qaStatus: "pass", approval: "pending" }],
    }],
    productImages: [], researchImages: [],
  };
}

function launch(productId: string, name: string) {
  const settings = {
    product_id: productId, app_code: "TRAIL", objective: "app_promotion", meta: { adAccountId: "act_1234567890", pageId: "100200300400", appName: name, appStoreUrl: "https://apps.apple.com/app/id0000000000" },
    countries: ["US"], testing_campaign_id: "cmp_1", testing_adset_id: "set_1", scaling_campaign_id: null, scaling_adset_id: null, testing_daily_budget: 30, scaling_daily_budget: null, max_daily_budget: null,
    thresholds: { ...DEFAULT_THRESHOLDS }, default_cta: null, scaling_budget: "campaign", optimize_for: "install", automation_enabled: false, automation_max_ads_per_day: 3, automation_max_ads_in_adset: 20,
    automation_last_run_at: null, automation_last_note: null,
  };
  const approved = creatives(productId).filter((c) => c.approval === "approved").map((c) => ({ id: c.id, url: c.url, kind: "image", aspect: c.aspect, headline: c.headline ?? undefined, primaryText: c.primary_text ?? undefined, cta: "Download", title: c.title, aiGenerated: true, productId, style: "image", width: 1080, height: 1350, mime: "image/png", storagePath: "sample" }));
  return {
    workspace: { id: productId, name, appName: name, appStoreUrl: settings.meta.appStoreUrl },
    settings, defaults: settings, creatives: approved, drafts: [],
    status: { connected: true, version: "v26.0", account: { id: "act_1234567890", name: "Trailmix Ads", currency: "USD", accountStatus: 1, hasPaymentMethod: true, url: "https://adsmanager.facebook.com" }, testing: { id: "set_1", name: "TRAIL | TEST | adset | us-broad | 2026-11-01", status: "PAUSED", effectiveStatus: "PAUSED", dailyBudget: 3000, lifetimeBudget: null, ads: 2, url: "https://adsmanager.facebook.com" } },
    suggestions: [], thresholds: { ...DEFAULT_THRESHOLDS }, metricsRange: { since: day(-28), until: day(0) },
    scaling: scalingAdvice({ metrics: [], thresholds: { ...DEFAULT_THRESHOLDS }, scalingAdSetId: null, dailyBudget: null, maxDailyBudget: null, currency: "USD" }),
    volume: { last7: 0, last28: 0, spend28: 0 }, mmpConnected: false,
  };
}

/** Measure's numbers for the last `days` days. `only` leaves a single source connected (?source=meta|revenuecat|appstack). */
function measure(productId: string, name: string, days: number, only: string | null) {
  const has = (s: string) => !only || only === s;
  const since = day(-days + 1), until = day(0), prevSince = day(-2 * days + 1);
  const ads = [
    { ad_id: "ad1", name: "TRAIL | TEST | ugc-talking-head | pain-point | v01 | 2026-11-01", campaign_id: "cmp_1", adset_id: "set_1", adset_name: "US broad", creative_id: "cr1", creative_name: "Plan a hike in a minute", thumbnail_url: picture("Ad 1", 120, 120), format_id: null, status: "ACTIVE" },
    { ad_id: "ad2", name: "TRAIL | TEST | static-benefit | curiosity | v01 | 2026-11-01", campaign_id: "cmp_1", adset_id: "set_1", adset_name: "US broad", creative_id: "cr2", creative_name: "Your weekend, sorted", thumbnail_url: picture("Ad 2", 120, 120, "#e6eadf"), format_id: null, status: "ACTIVE" },
    { ad_id: "ad3", name: "TRAIL | SCALE | ugc-talking-head | pain-point | v02 | 2026-11-08", campaign_id: "cmp_2", adset_id: "set_2", adset_name: "US winners", creative_id: "cr3", creative_name: "Trail in a tap", thumbnail_url: picture("Ad 3", 120, 120, "#eee6df"), format_id: null, status: "ACTIVE" },
  ];
  const meta: Record<string, unknown>[] = [], appstack: Record<string, unknown>[] = [], revenuecat: Record<string, unknown>[] = [];
  for (let i = -2 * days + 1; i <= 0; i++) {
    const date = day(i), wave = 1 + 0.25 * Math.sin(i / 3);
    ads.forEach((ad, n) => {
      const spend = Math.round((18 + n * 9) * wave * 100) / 100, installs = Math.round((6 + n * 3) * wave);
      if (has("meta")) meta.push({ ad_id: ad.ad_id, date, campaign_id: ad.campaign_id, adset_id: ad.adset_id, spend, impressions: Math.round(spend * 95), reach: Math.round(spend * 80), clicks: Math.round(spend * 2.1), link_clicks: Math.round(spend * 1.6), installs, trials: Math.round(installs * 0.4), purchases: i % 3 === 0 ? 1 : 0, purchase_value: i % 3 === 0 ? 39.99 : 0 });
      if (has("appstack")) appstack.push({ date, media_source: "meta", campaign_id: ad.campaign_id, adset_id: ad.adset_id, ad_id: ad.ad_id, campaign_name: null, ad_name: ad.name, installs: Math.round(installs * 1.2), trials: Math.round(installs * 0.5), purchases: i % 2 === 0 ? 1 : 0, revenue_usd: i % 2 === 0 ? 39.99 : 0 });
    });
    if (has("revenuecat")) {
      revenuecat.push({ date, chart: "trials_new", measure: "Trials", segment: "", value: 5 }, { date, chart: "actives_new", measure: "Total", segment: "Yearly", value: 1 }, { date, chart: "actives_new", measure: "Total", segment: "Monthly", value: 1 },
        { date, chart: "revenue", measure: "Revenue", segment: "", value: 52 }, { date, chart: "proceeds", measure: "Proceeds", segment: "Yearly", value: 30 }, { date, chart: "proceeds", measure: "Proceeds", segment: "Monthly", value: 8 },
        { date, chart: "customers_new", measure: "New customers", segment: "", value: 14 }, { date, chart: "trial_conversion_rate", measure: "Trial starts", segment: "", value: 5 }, { date, chart: "trial_conversion_rate", measure: "Conversions", segment: "", value: 2 });
    }
  }
  const row = (source: string, details = {}) => ({ source, status: "ok", message: null, currency: "USD", fx_rate: null, details, synced_at: now() });
  return {
    workspace: { id: productId, name, connected: { meta: has("meta"), revenuecat: has("revenuecat"), appstack: has("appstack") } },
    range: { days, since, until, prevSince },
    settings: { cac_source: "auto", ltv_basis: "first_purchase", ltv_manual: null },
    sync: { ...(has("meta") ? { meta: row("meta", { account: { name: "Trailmix Ads", currency: "USD" } }) } : {}), ...(has("revenuecat") ? { revenuecat: row("revenuecat", { overview: { active_subscriptions: { value: 212, unit: "", period: "", name: "" }, active_trials: { value: 31, unit: "", period: "", name: "" }, mrr: { value: 1480, unit: "$", period: "", name: "" } } }) } : {}), ...(has("appstack") ? { appstack: row("appstack") } : {}) },
    health: { meta: has("meta"), revenuecat: has("revenuecat"), appstack: has("appstack"), allowList: true },
    campaigns: has("meta") ? [{ campaign_id: "cmp_1", name: "TRAIL | TEST | campaign | app-promotion | 2026-11-01", objective: "OUTCOME_APP_PROMOTION", status: "ACTIVE", daily_budget: 60, lifetime_budget: null, role: "testing" }, { campaign_id: "cmp_2", name: "TRAIL | SCALE | campaign | app-promotion | 2026-11-08", objective: "OUTCOME_APP_PROMOTION", status: "ACTIVE", daily_budget: 40, lifetime_budget: null, role: "scaling" }] : [],
    ads: has("meta") ? ads : [], meta, revenuecat, appstack,
  };
}

/**
 * The creative and ads pages' requests, answered from the sample; null for anything else. `connections`
 * is what the sample workspace of each app reports, so a key mode can also leave an app unconnected.
 */
export function creativeAnswer(path: string, url: URL, method: string, names: Record<string, string>): Response | null {
  const mode = sampleKeys();
  const name = (id: string) => names[id] ?? "App";
  if (path === "/api/background") return json({ tasks: [] });
  let m = path.match(/^\/api\/studio\/([^/]+)$/);
  if (m && method === "GET") return json(studio(m[1], name(m[1]), mode));
  m = path.match(/^\/api\/playground\/([^/]+)$/);
  if (m && method === "GET") return json(playground(m[1], name(m[1]), mode));
  m = path.match(/^\/api\/playground\/([^/]+)\/templates$/);
  if (m && method === "GET") return json({ templates: [] });
  m = path.match(/^\/api\/launch\/([^/]+)(\/drafts)?$/);
  if (m && method === "GET") return json(m[2] ? [] : launch(m[1], name(m[1])));
  m = path.match(/^\/api\/w\/([^/]+)\/measure$/);
  if (m && method === "GET") return json(measure(m[1], name(m[1]), Number(url.searchParams.get("days")) || 28, new URLSearchParams(location.search).get("source")));
  m = path.match(/^\/api\/w\/([^/]+)\/app$/);
  if (m) return json({ error: "The preview has no product context." }, 404);
  return null;
}
