// Meta Marketing API: the ad account's campaigns, ads (with their creative) and Insights per ad per
// day. Reads only, with a system user's token (ads_read), so nothing here can change a campaign.
//
// Conversions come from the `actions` array. Meta reports the same event under several action
// types (an install is `omni_app_install` and `mobile_app_install`), so each kind takes the first
// type present from a priority list instead of adding them up. iOS app campaigns report through
// SKAdNetwork / Aggregated Event Measurement: those results arrive 24–72 h late, are modelled, and
// can't always be split below the campaign, so recent days and ad-level iOS numbers run low.
//
// The recommended setup sends conversions through AppStack instead: AppStack forwards its
// attributed events to a Meta dataset over the Conversions API, with an install arriving as a Lead.
// Those show up as website (pixel) actions, so the lists below include them after the app events.

export const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION")?.trim() || "v25.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Action types per conversion kind, most complete first (the first one present is used). */
export const ACTION_TYPES = {
  installs: ["omni_app_install", "mobile_app_install", "app_install", "lead", "offsite_conversion.fb_pixel_lead"],
  trials: ["start_trial_total", "start_trial_mobile_app", "start_trial_website", "app_custom_event.fb_mobile_start_trial"],
  purchases: [
    "omni_purchase", "app_custom_event.fb_mobile_purchase", "offsite_conversion.fb_pixel_purchase", "purchase",
    "subscribe_total", "subscribe_mobile_app", "subscribe_website",
  ],
} as const;

/** Currencies Meta stores without minor units (budgets come back in the currency's smallest unit). */
const NO_MINOR_UNITS = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);

export class MetaError extends Error {
  constructor(message: string, readonly code?: number) { super(message); }
}

interface Action { action_type: string; value: string }
interface Paged<T> { data: T[]; paging?: { next?: string } }

/** HMAC-SHA256 of the token keyed by the Meta app's secret (hex), or null when no secret is set. */
async function appSecretProof(token: string, secret: string | undefined): Promise<string | null> {
  if (!secret) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Graph errors in words the team can act on (the token never appears in them). */
function explain(status: number, error: { message?: string; code?: number; error_subcode?: number } | undefined): MetaError {
  const code = error?.code;
  if (code === 190) return new MetaError("Meta rejected the token (expired or revoked). Generate a new system user token and save it in Settings > API keys.", code);
  if (code === 10 || code === 200 || code === 294 || (code && code >= 200 && code < 300)) {
    return new MetaError("The system user can't read this ad account. In Business Settings, assign the ad account to the system user and give the token ads_read.", code);
  }
  if (code === 17 || code === 4 || code === 32 || code === 613 || code === 80000 || code === 80004) return new MetaError("Meta's rate limit was hit. Try the sync again in a few minutes.", code);
  if (code === 100) return new MetaError(`Meta didn't accept the request: ${error?.message ?? "invalid parameter"}. Check the ad account id.`, code);
  return new MetaError(`Meta answered ${status}: ${error?.message ?? "unknown error"}`, code);
}

function client(token: string, appSecret?: string) {
  const proof = appSecretProof(token, appSecret);
  async function get<T>(pathOrUrl: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH}/${pathOrUrl}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const p = await proof;
    if (p && !url.searchParams.has("appsecret_proof")) url.searchParams.set("appsecret_proof", p);
    // The token goes in the header, so paging URLs and logs never carry it.
    url.searchParams.delete("access_token");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) throw explain(response.status, body.error);
    return body as T;
  }
  async function all<T>(path: string, params: Record<string, string>, max = 50): Promise<T[]> {
    const out: T[] = [];
    let page = await get<Paged<T>>(path, params);
    for (let i = 0; ; i++) {
      out.push(...(page.data ?? []));
      if (!page.paging?.next || i >= max) break;
      page = await get<Paged<T>>(page.paging.next);
    }
    return out;
  }
  return { get, all };
}

const first = (list: Action[] | undefined, types: readonly string[]) => {
  for (const type of types) {
    const hit = list?.find((a) => a.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
};

export interface MetaAccount { id: string; name: string; currency: string; timezone: string }
export interface MetaCampaign { campaign_id: string; name: string; objective: string | null; status: string | null; daily_budget: number | null; lifetime_budget: number | null }
export interface MetaAd { ad_id: string; name: string; status: string | null; campaign_id: string | null; adset_id: string | null; adset_name: string | null; creative_id: string | null; creative_name: string | null; thumbnail_url: string | null }
export interface MetaDay {
  ad_id: string; date: string; campaign_id: string | null; adset_id: string | null;
  spend: number; impressions: number; reach: number; clicks: number; link_clicks: number;
  installs: number; trials: number; purchases: number; purchase_value: number;
  actions: Action[]; action_values: Action[];
}
export interface MetaPull { account: MetaAccount; campaigns: MetaCampaign[]; ads: MetaAd[]; days: MetaDay[] }

/** Everything the dashboard needs from one ad account between two dates (inclusive). */
export async function pullMeta(token: string, adAccountId: string, since: string, until: string, appSecret?: string): Promise<MetaPull> {
  const act = `act_${adAccountId.replace(/^act_/, "").trim()}`;
  const graph = client(token, appSecret);
  const info = await graph.get<{ id: string; name?: string; currency?: string; timezone_name?: string }>(act, { fields: "name,currency,timezone_name" });
  const currency = info.currency ?? "USD";
  const minor = NO_MINOR_UNITS.has(currency) ? 1 : 100;
  const budget = (value?: string) => (value ? Number(value) / minor : null);

  const [campaigns, ads, insights] = await Promise.all([
    graph.all<{ id: string; name?: string; objective?: string; effective_status?: string; daily_budget?: string; lifetime_budget?: string }>(
      `${act}/campaigns`, { fields: "id,name,objective,effective_status,daily_budget,lifetime_budget", limit: "200" },
    ),
    graph.all<{ id: string; name?: string; effective_status?: string; campaign_id?: string; adset?: { id: string; name?: string }; creative?: { id: string; name?: string; thumbnail_url?: string } }>(
      `${act}/ads`, { fields: "id,name,effective_status,campaign_id,adset{id,name},creative{id,name,thumbnail_url}", limit: "200" },
    ),
    graph.all<Record<string, unknown> & { ad_id: string; date_start: string; actions?: Action[]; action_values?: Action[]; inline_link_clicks?: string }>(
      `${act}/insights`, {
        level: "ad",
        time_increment: "1",
        time_range: JSON.stringify({ since, until }),
        // The attribution setting each ad set optimises with, so totals match Ads Manager.
        use_unified_attribution_setting: "true",
        fields: "ad_id,campaign_id,adset_id,spend,impressions,reach,clicks,inline_link_clicks,actions,action_values",
        limit: "500",
      }, 200,
    ),
  ]);

  return {
    account: { id: act.slice(4), name: info.name ?? act, currency, timezone: info.timezone_name ?? "UTC" },
    campaigns: campaigns.map((c) => ({
      campaign_id: c.id, name: c.name ?? "", objective: c.objective ?? null, status: c.effective_status ?? null,
      daily_budget: budget(c.daily_budget), lifetime_budget: budget(c.lifetime_budget),
    })),
    ads: ads.map((a) => ({
      ad_id: a.id, name: a.name ?? "", status: a.effective_status ?? null, campaign_id: a.campaign_id ?? null,
      adset_id: a.adset?.id ?? null, adset_name: a.adset?.name ?? null,
      creative_id: a.creative?.id ?? null, creative_name: a.creative?.name ?? null, thumbnail_url: a.creative?.thumbnail_url ?? null,
    })),
    days: insights.map((row) => ({
      ad_id: row.ad_id, date: row.date_start, campaign_id: (row.campaign_id as string) ?? null, adset_id: (row.adset_id as string) ?? null,
      spend: Number(row.spend) || 0, impressions: Number(row.impressions) || 0, reach: Number(row.reach) || 0,
      clicks: Number(row.clicks) || 0, link_clicks: Number(row.inline_link_clicks) || 0,
      installs: first(row.actions, ACTION_TYPES.installs),
      trials: first(row.actions, ACTION_TYPES.trials),
      purchases: first(row.actions, ACTION_TYPES.purchases),
      purchase_value: first(row.action_values, ACTION_TYPES.purchases),
      actions: row.actions ?? [], action_values: row.action_values ?? [],
    })),
  };
}

/**
 * The connection check: the system user's token can read the ad account and, when one is set, the
 * Page. Two read calls; returns a sentence for the workspace page, throws a MetaError otherwise.
 */
export async function checkMeta(token: string, adAccountId: string, pageId?: string, appSecret?: string): Promise<string> {
  const act = `act_${adAccountId.replace(/^act_/, "").trim()}`;
  const graph = client(token, appSecret);
  const info = await graph.get<{ name?: string; currency?: string; account_status?: number }>(act, { fields: "name,currency,account_status" });
  const parts = [`Ad account "${info.name ?? act}" (${info.currency ?? "?"}) is readable.`];
  if (info.account_status != null && info.account_status !== 1) parts.push(`It isn't active (status ${info.account_status}).`);
  if (pageId?.trim()) {
    try {
      const page = await graph.get<{ name?: string }>(pageId.trim(), { fields: "id,name" });
      parts.push(`Page "${page.name ?? pageId}" is readable.`);
    } catch (error) {
      const detail = error instanceof MetaError && error.code === 190 ? error.message : "check the Page id and that the Page is assigned to the system user in Business Settings.";
      throw new MetaError(`The ad account is readable, but the Page (${pageId.trim()}) isn't: ${detail}`, error instanceof MetaError ? error.code : undefined);
    }
  } else {
    parts.push("No Page id is set, so the Page wasn't checked.");
  }
  return parts.join(" ");
}
