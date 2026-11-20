// Superwall (read-only): paywall views, paid purchases and trials per paywall and placement, and revenue
// per day, from Superwall's REST API. Docs: docs/connectors/superwall.md.
//
// Superwall's webhooks only carry subscription lifecycle events (no paywall views), so this reads its
// query API instead: SQL over the project's analytics tables (ClickHouse), with an organization API
// key that has the data:read and projects:read scopes and access to all projects (SUPERWALL_API_KEY):
// data:read for the query, projects:read to list projects (api.superwall.com/openapi.json). The app's
// connection card stores only the Superwall application ID; the organization is found from it.
//
//   POST https://api.superwall.com/v2/organizations/{org}/query   (SQL in the body, FORMAT JSONEachRow)
//   GET  https://api.superwall.com/v2/projects                    (projects with their applications)

export class SuperwallError extends Error {}

export interface SuperwallConnection { applicationId?: string }

/** One day of one paywall at one placement. Revenue sits on the day's ('', '') row (it isn't per paywall). */
export interface SuperwallDay { date: string; paywall: string; placement: string; opens: number; conversions: number; trials: number; starts: number; revenue_usd: number; refunds_usd: number }

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const BASE = "https://api.superwall.com";
/**
 * The SDK events this reads, by Superwall's names (superwall.com/docs/ios/guides/3rd-party-analytics/tracking-analytics):
 *   paywall_open                  a paywall opened                                  → views
 *   subscription_start            a subscription bought without an introductory offer → paid purchases
 *   nonRecurringProduct_purchase  a non-recurring product bought                    → paid purchases
 *   freeTrial_start               a subscription bought with an introductory offer  → trials
 *   transaction_start             checkout started                                  → starts
 * transaction_complete ("any product is purchased") also fires for trials with an intro offer, so it
 * isn't counted as a purchase.
 */
export const PAID_EVENTS = ["subscription_start", "nonRecurringProduct_purchase"] as const;
export const TRIAL_EVENT = "freeTrial_start";
const EVENTS = ["paywall_open", "transaction_start", ...PAID_EVENTS, TRIAL_EVENT] as const;

/** Superwall's v2 error body: { message, code, type, required_scope } (openapi.json); older answers used `error`. */
interface ErrorBody { message?: unknown; error?: unknown; required_scope?: unknown }

function explain(status: number, body: unknown): SuperwallError {
  const b = typeof body === "object" && body ? body as ErrorBody : {};
  const detail = (b.message != null ? String(b.message) : b.error != null ? String(b.error) : typeof body === "string" ? body : "").slice(0, 160);
  const scope = typeof b.required_scope === "string" && /^[a-z]+:[a-z]+$/.test(b.required_scope) ? b.required_scope : null;
  if (status === 401) return new SuperwallError("Superwall rejected the key. Create an organization API key (Settings > API Keys) and update SUPERWALL_API_KEY.");
  if (status === 403 && scope === "projects:read") return new SuperwallError("The Superwall key can't list projects. Give it the projects:read scope too (it needs data:read and projects:read, with access to all projects).");
  if (status === 403) return new SuperwallError("The Superwall key can't read analytics. Give it the data:read and projects:read scopes and access to all projects.");
  if (status === 404) return new SuperwallError("Superwall doesn't know this application in the key's organization. Check the application ID on the connection card.");
  if (status === 429) return new SuperwallError("Superwall's rate limit was hit. Try again in a few minutes.");
  return new SuperwallError(`Superwall answered ${status}${detail ? `: ${detail}` : ""}.`);
}

async function request(fetchImpl: Fetch, key: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetchImpl(`${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${key.trim()}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* plain text */ }
    throw explain(response.status, body);
  }
  return response;
}

// MARK: Parsers (pure, tested against recorded shapes)

/** ClickHouse's JSONEachRow: one JSON object per line. Blank and broken lines are skipped. */
export function parseJsonEachRow(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (row && typeof row === "object" && !Array.isArray(row)) out.push(row as Record<string, unknown>);
    } catch { /* skip */ }
  }
  return out;
}

interface ProjectList { data?: { organization_id?: number | string; name?: string; applications?: { id?: string | number; name?: string; platform?: string }[] }[]; has_more?: boolean }

/** Finds the application in the key's projects: its organization (needed by the query API), name and platform. */
export function findApplication(list: ProjectList, applicationId: string): { organizationId: string; name: string; platform: string; project: string } | null {
  for (const project of list.data ?? []) {
    for (const app of project.applications ?? []) {
      if (String(app.id) === applicationId && project.organization_id != null) {
        return { organizationId: String(project.organization_id), name: app.name ?? project.name ?? "", platform: app.platform ?? "", project: project.name ?? "" };
      }
    }
  }
  return null;
}

const num = (value: unknown) => (typeof value === "number" ? value : Number(value)) || 0;
const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 200) : value == null ? "" : String(value).slice(0, 200));

/**
 * The event counts (day, paywall, placement, name, events) and revenue (day, revenue, refunds) rows →
 * one SuperwallDay per day, paywall and placement. Revenue goes on the day's ('', '') row.
 */
export function toSuperwallDays(events: Record<string, unknown>[], revenue: Record<string, unknown>[]): SuperwallDay[] {
  const days = new Map<string, SuperwallDay>();
  const at = (date: string, paywall: string, placement: string) => {
    const id = `${date}|${paywall}|${placement}`;
    const found = days.get(id) ?? { date, paywall, placement, opens: 0, conversions: 0, trials: 0, starts: 0, revenue_usd: 0, refunds_usd: 0 };
    days.set(id, found);
    return found;
  };
  for (const row of events) {
    const date = text(row.day).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const day = at(date, text(row.paywall), text(row.placement));
    const n = num(row.events);
    const name = String(row.name ?? "");
    if (name === "paywall_open") day.opens += n;
    else if ((PAID_EVENTS as readonly string[]).includes(name)) day.conversions += n;
    else if (name === TRIAL_EVENT) day.trials += n;
    else if (name === "transaction_start") day.starts += n;
  }
  for (const row of revenue) {
    const date = text(row.day).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const day = at(date, "", "");
    day.revenue_usd += num(row.revenue);
    day.refunds_usd += Math.abs(num(row.refunds));
  }
  return [...days.values()]
    .map((d) => ({ ...d, revenue_usd: Math.round(d.revenue_usd * 100) / 100, refunds_usd: Math.round(d.refunds_usd * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.paywall.localeCompare(b.paywall) || a.placement.localeCompare(b.placement));
}

// MARK: Queries

/** Event counts per day, paywall and placement for the app (production only). Values are bound as parameters. */
export const EVENTS_SQL = `SELECT toDate(ts) AS day,
  coalesce(nullIf(JSONExtractString(props, '$paywall_identifier'), ''), JSONExtractString(props, 'paywall_identifier')) AS paywall,
  coalesce(nullIf(JSONExtractString(props, '$presented_by_event_name'), ''), JSONExtractString(props, 'presented_by_event_name')) AS placement,
  name, count() AS events
FROM sw.events_rep
WHERE applicationId = {app:UInt64} AND isSandbox = 0 AND ts >= {since:DateTime}
  AND name IN (${EVENTS.map((e) => `'${e}'`).join(", ")})
GROUP BY day, paywall, placement, name
FORMAT JSONEachRow`;

/**
 * Revenue per day (refunds are negative prices), counted like Superwall's dashboard ("Count revenue like
 * the dashboard", superwall.com/docs/dashboard/guides/query-clickhouse). An app can get the same purchase
 * from its store and from RevenueCat, and its revenue provider decides which rows count:
 *   store       app_store_connect, google_play, stripe
 *   RevenueCat  revenue_cat, stripe
 * Rows with source 'sdk' always count; RevenueCat's copies of Stripe purchases never do. The provider
 * isn't in the API, so each day comes back three ways (store, RevenueCat, all) with how many store and
 * RevenueCat rows there were, and pickRevenue chooses: only one kind of row → all of them; both → one
 * provider's, never both, so a purchase isn't counted twice.
 */
export const REVENUE_SQL = `SELECT toDate(ts) AS day,
  sumIf(price, integration IN ('app_store_connect', 'google_play', 'stripe') OR source = 'sdk') AS revenue_store,
  sumIf(price, (integration IN ('app_store_connect', 'google_play', 'stripe') OR source = 'sdk') AND price < 0) AS refunds_store,
  sumIf(price, integration IN ('revenue_cat', 'stripe') OR source = 'sdk') AS revenue_rc,
  sumIf(price, (integration IN ('revenue_cat', 'stripe') OR source = 'sdk') AND price < 0) AS refunds_rc,
  sum(price) AS revenue, sumIf(price, price < 0) AS refunds,
  countIf(integration = 'revenue_cat') AS rc_rows,
  countIf(integration IN ('app_store_connect', 'google_play')) AS store_rows
FROM open_revenue.attributed_events_by_ts_rep FINAL
WHERE applicationId = {app:UInt64} AND isSandbox = 0 AND ts >= {since:DateTime}
  AND NOT (coalesce(integration, '') = 'revenue_cat' AND store = 'STRIPE')
GROUP BY day
FORMAT JSONEachRow`;

export type RevenueProvider = "store" | "revenuecat" | "all";

/**
 * Which rows of REVENUE_SQL count. Store and RevenueCat rows both present: the same purchases arrive
 * twice, so one provider is used, RevenueCat when this app also connects RevenueCat here, else the store.
 * Otherwise every row counts (that is what each provider's filter keeps when only its rows exist).
 */
export function revenueProvider(rows: Record<string, unknown>[], prefersRevenueCat: boolean): RevenueProvider {
  const rc = rows.reduce((n, r) => n + num(r.rc_rows), 0);
  const store = rows.reduce((n, r) => n + num(r.store_rows), 0);
  if (rc > 0 && store > 0) return prefersRevenueCat ? "revenuecat" : "store";
  return "all";
}

/** The day's revenue and refunds for the chosen provider, in the { day, revenue, refunds } shape toSuperwallDays reads. */
export function pickRevenue(rows: Record<string, unknown>[], provider: RevenueProvider): Record<string, unknown>[] {
  const suffix = provider === "store" ? "_store" : provider === "revenuecat" ? "_rc" : "";
  return rows.map((r) => ({ day: r.day, revenue: r[`revenue${suffix}`] ?? r.revenue, refunds: r[`refunds${suffix}`] ?? r.refunds }));
}

async function runQuery(fetchImpl: Fetch, key: string, organizationId: string, sql: string, params: Record<string, string>): Promise<Record<string, unknown>[]> {
  const search = new URLSearchParams(Object.entries(params).map(([k, v]) => [`param_${k}`, v]));
  const response = await request(fetchImpl, key, `/v2/organizations/${encodeURIComponent(organizationId)}/query?${search}`, { method: "POST", body: sql, headers: { "Content-Type": "text/plain" } });
  return parseJsonEachRow(await response.text());
}

async function locate(fetchImpl: Fetch, key: string, applicationId: string) {
  if (!/^\d{1,20}$/.test(applicationId)) throw new SuperwallError("Add the Superwall application ID (numbers only) on the connection card.");
  // A handful of pages is plenty for any organization; the list is in pages of up to 100.
  let after = "";
  for (let page = 0; page < 10; page++) {
    const response = await request(fetchImpl, key, `/v2/projects?limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ""}`, { headers: { Accept: "application/json" } });
    const list = await response.json() as ProjectList & { data?: { id?: string }[] };
    const found = findApplication(list, applicationId);
    if (found) return found;
    const last = list.data?.[list.data.length - 1]?.id;
    if (!list.has_more || !last) break;
    after = String(last);
  }
  throw new SuperwallError(`Superwall has no application ${applicationId} in this key's organization. Check the ID (Settings > Keys in the app's dashboard) and that the key has access to all projects.`);
}

const stamp = (day: string) => `${day} 00:00:00`;

/**
 * Events always; revenue is skipped (and listed) when less than 20 s of the `deadline` (epoch ms) is left.
 * `prefersRevenueCat`: this app also connects RevenueCat here (decides revenue when both providers send rows).
 */
export async function pullSuperwall(key: string, c: SuperwallConnection, since: string, fetchImpl: Fetch = fetch, deadline?: number, prefersRevenueCat = false): Promise<{ days: SuperwallDay[]; app: { name: string; platform: string }; skipped: string[]; revenueFrom?: RevenueProvider }> {
  const applicationId = (c.applicationId ?? "").trim();
  const app = await locate(fetchImpl, key, applicationId);
  const params = { app: applicationId, since: stamp(since) };
  const events = await runQuery(fetchImpl, key, app.organizationId, EVENTS_SQL, params);
  const late = deadline != null && Date.now() > deadline - 20_000;
  const revenue = late ? [] : await runQuery(fetchImpl, key, app.organizationId, REVENUE_SQL, params);
  const provider = revenueProvider(revenue, prefersRevenueCat);
  return { days: toSuperwallDays(events, pickRevenue(revenue, provider)), app: { name: app.name, platform: app.platform }, skipped: late ? ["revenue"] : [], revenueFrom: late ? undefined : provider };
}

/** The connection check: find the application, then one tiny query (proves the data:read scope). */
export async function checkSuperwall(key: string, c: SuperwallConnection, fetchImpl: Fetch = fetch): Promise<string> {
  const applicationId = (c.applicationId ?? "").trim();
  const app = await locate(fetchImpl, key, applicationId);
  const rows = await runQuery(fetchImpl, key, app.organizationId,
    "SELECT count() AS events FROM sw.events_rep WHERE applicationId = {app:UInt64} AND isSandbox = 0 AND name = 'paywall_open' AND ts >= now() - INTERVAL 7 DAY FORMAT JSONEachRow",
    { app: applicationId });
  const opens = num(rows[0]?.events);
  return `Superwall ${app.name || `application ${applicationId}`}${app.platform ? ` (${app.platform})` : ""} is readable: ${opens} paywall views in the last 7 days.`;
}
