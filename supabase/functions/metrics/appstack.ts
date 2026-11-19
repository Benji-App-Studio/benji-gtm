// AppStack (the MMP) Export API: every attributed event since a time, which this sums per ad per
// day. AppStack keys are scoped to one app. Docs: https://docs.appstack.tech/api/export
//
// Event names are `appstack_<event>` from the SDK (install is logged on its own) and `rc_<event>`
// from the RevenueCat integration. An app that sends both would count a purchase twice, so when any
// rc_ purchase event is present the SDK's purchase events are left out (and the same for revenue).

const EXPORT_URL = "https://api.appstack.tech/api/v1/export";
const PAGE = 10_000;
const MAX_PAGES = 20;

export class AppStackError extends Error {}

interface ExportEvent {
  event_name: string | null; event_time: string | null; media_source: string | null;
  campaign_id: string | null; campaign_name: string | null; adset_id: string | null; ad_id: string | null; ad_name: string | null;
  app_id: string | null; install_type: string | null; revenue_usd: number | null;
}

export interface AppStackDay {
  date: string; media_source: string; campaign_id: string; adset_id: string; ad_id: string;
  campaign_name: string | null; ad_name: string | null; installs: number; trials: number; purchases: number; revenue_usd: number;
}

const RC_PURCHASE = new Set(["rc_initial_purchase", "rc_trial_converted"]);
const SDK_PURCHASE = new Set(["purchase", "subscribe"]);
const TRIAL = new Set(["start_trial", "rc_trial_started", "rc_trial_intro_started"]);

const kind = (raw: string) => raw.toLowerCase().replace(/^appstack_/, "");

export async function pullAppStack(key: string, since: Date, appId?: string): Promise<AppStackDay[]> {
  const events: ExportEvent[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(EXPORT_URL);
    url.searchParams.set("timestamp", String(Math.floor(since.getTime() / 1000)));
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", String(PAGE));
    url.searchParams.set("offset", String(page * PAGE));
    const response = await fetch(url, { headers: { Authorization: key, Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
    const body = await response.json().catch(() => null) as { data?: ExportEvent[]; detail?: string } | null;
    if (response.status === 401) throw new AppStackError("AppStack rejected the key. Copy the app's API key from AppStack's app settings into APPSTACK_API_KEY.");
    if (!response.ok) throw new AppStackError(`AppStack answered ${response.status}: ${body?.detail ?? "unknown error"}`);
    const data = body?.data ?? [];
    events.push(...data);
    if (data.length < PAGE) break;
  }

  const mine = appId ? events.filter((e) => !e.app_id || e.app_id === appId) : events;
  const rcPurchases = mine.some((e) => e.event_name && RC_PURCHASE.has(kind(e.event_name)));
  const counts = new Map<string, AppStackDay>();
  for (const e of mine) {
    if (!e.event_time) continue;
    // Install rows carry install_type and may have no event name.
    const name = e.event_name ? kind(e.event_name) : e.install_type ? "install" : "";
    if (!name) continue;
    const row: AppStackDay = {
      date: e.event_time.slice(0, 10), media_source: (e.media_source ?? "").toLowerCase(),
      campaign_id: e.campaign_id ?? "", adset_id: e.adset_id ?? "", ad_id: e.ad_id ?? "",
      campaign_name: e.campaign_name, ad_name: e.ad_name, installs: 0, trials: 0, purchases: 0, revenue_usd: 0,
    };
    const id = [row.date, row.media_source, row.campaign_id, row.adset_id, row.ad_id].join("|");
    const day = counts.get(id) ?? row;
    counts.set(id, day);
    const purchase = rcPurchases ? RC_PURCHASE.has(name) : SDK_PURCHASE.has(name);
    if (name === "install" || name.endsWith("_install")) day.installs++;
    else if (TRIAL.has(name)) day.trials++;
    else if (purchase) day.purchases++;
    // Renewals and other paid events add revenue but aren't new customers.
    const counted = rcPurchases ? name.startsWith("rc_") : !name.startsWith("rc_");
    if (counted && e.revenue_usd) day.revenue_usd += Number(e.revenue_usd) || 0;
  }
  return [...counts.values()].map((d) => ({ ...d, revenue_usd: Math.round(d.revenue_usd * 100) / 100 }));
}

/** The connection check: one small read of the Export API for the last day. Throws an AppStackError otherwise. */
export async function checkAppStack(key: string, appId: string): Promise<string> {
  const url = new URL(EXPORT_URL);
  url.searchParams.set("timestamp", String(Math.floor(Date.now() / 1000) - 86_400));
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: { Authorization: key, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => null) as { detail?: string } | null;
  if (response.status === 401 || response.status === 403) throw new AppStackError("AppStack rejected the key. Copy the app's API key from AppStack's app settings into APPSTACK_API_KEY (or APPSTACK_API_KEY_<APP>).");
  if (!response.ok) throw new AppStackError(`AppStack answered ${response.status}: ${body?.detail ?? "unknown error"}`);
  return `AppStack's export for ${appId.trim()} is readable.`;
}
