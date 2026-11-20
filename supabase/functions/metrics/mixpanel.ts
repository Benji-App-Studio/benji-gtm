// Mixpanel Query API (read-only): the app's own funnel, retention and active users, from the events
// the team maps on the connection card (install, sign-up, paywall view, trial start, purchase, and the
// event that means "active"). Docs: docs/connectors/mixpanel.md.
//
// Auth is a service account (HTTP Basic, "username:secret" stored as MIXPANEL_SERVICE_ACCOUNT) with
// project_id on every query. The host follows the project's data residency (US, EU or India). The
// Query API allows 60 queries an hour and 5 at once per project, so a sync makes at most eight
// queries, one after another.
//
// Rows are generic: { date, metric, segment, value }.
//   funnel_<step>   unique users who did the step's event that day (segment '')
//   active          unique users who did the "active" event that day
//   retention       users of the cohort (date = cohort day) active again on day N (segment 'D<N>')
//   retention_size  the cohort's size (segment '')
//   ttc_seconds     mean seconds from the funnel's first step to its last, for that day's converters
//   ttc_conversions how many converted that day (the weight for averaging ttc_seconds)

export class MixpanelError extends Error {}

export type MixpanelRegion = "us" | "eu" | "in";
export type FunnelStep = "install" | "signup" | "paywall" | "trial" | "purchase";
export const FUNNEL_STEPS: FunnelStep[] = ["install", "signup", "paywall", "trial", "purchase"];

/** What the app's connection card stores (IDs and event names, never the secret). */
export interface MixpanelConnection {
  projectId?: string; region?: string; funnelId?: string;
  /** Optional: a data view's workspace_id, for projects that use Data Views (sent on every query when set). */
  workspaceId?: string;
  installEvent?: string; signupEvent?: string; paywallEvent?: string; trialEvent?: string; purchaseEvent?: string; activeEvent?: string;
}

/**
 * The defaults when an event isn't mapped: Mixpanel's legacy mobile auto-events ($ae_first_open,
 * $ae_session), then common names. Mixpanel's current SDKs leave automatic events off
 * (trackAutomaticEvents defaults to false), so most projects need their own names mapped on the card;
 * when a default finds nothing, the check lists the project's most common events to pick from.
 */
export const DEFAULT_EVENTS: Record<FunnelStep | "active", string> = {
  install: "$ae_first_open",
  signup: "Sign Up",
  paywall: "Paywall Viewed",
  trial: "Trial Started",
  purchase: "Purchase",
  active: "$ae_session",
};

export interface MixpanelRow { date: string; metric: string; segment: string; value: number }

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const HOSTS: Record<MixpanelRegion, string> = { us: "https://mixpanel.com", eu: "https://eu.mixpanel.com", in: "https://in.mixpanel.com" };
/** Retention looks this many days past each cohort day (D0 to D30). */
export const RETENTION_DAYS = 30;

export const regionOf = (value: string | undefined): MixpanelRegion => (value === "eu" || value === "in" ? value : "us");
export function eventsOf(c: MixpanelConnection): Record<FunnelStep | "active", string> {
  const pick = (v: string | undefined, step: FunnelStep | "active") => v?.trim() || DEFAULT_EVENTS[step];
  return { install: pick(c.installEvent, "install"), signup: pick(c.signupEvent, "signup"), paywall: pick(c.paywallEvent, "paywall"), trial: pick(c.trialEvent, "trial"), purchase: pick(c.purchaseEvent, "purchase"), active: pick(c.activeEvent, "active") };
}

/** "username:secret" → the Basic header. Throws a MixpanelError when the value isn't in that form. */
export function basicAuth(credential: string): string {
  const value = credential.trim();
  const at = value.indexOf(":");
  if (at < 1 || at === value.length - 1) throw new MixpanelError("The Mixpanel key should be the service account's username and secret as username:secret.");
  return `Basic ${btoa(value)}`;
}

function explain(status: number, body: { error?: string; request?: string } | null): MixpanelError {
  const detail = body?.error ? ` (${String(body.error).slice(0, 160)})` : "";
  if (status === 401) return new MixpanelError("Mixpanel rejected the service account. Check the username and secret (Organization settings > Service accounts) and update MIXPANEL_SERVICE_ACCOUNT.");
  if (status === 403) return new MixpanelError("The Mixpanel service account can't read this project. Add the project to it (Organization settings > Service accounts > the account > Projects).");
  if (status === 404) return new MixpanelError("Mixpanel doesn't know this project here. Check the project ID and the data residency (US, EU or India) on the connection card.");
  if (status === 429) return new MixpanelError("Mixpanel's rate limit was hit (60 queries an hour per project). Try again later.");
  if (status === 400) return new MixpanelError(`Mixpanel refused the query${detail}. Check the project ID, the data residency and the event names.`);
  return new MixpanelError(`Mixpanel answered ${status}${detail}.`);
}

async function query<T>(fetchImpl: Fetch, credential: string, region: MixpanelRegion, path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${HOSTS[region]}/api/query/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetchImpl(url, { headers: { Authorization: basicAuth(credential), Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw explain(response.status, body);
  return body as T;
}

// MARK: Parsers (pure, tested against recorded shapes)

interface Segmentation { data?: { series?: string[]; values?: Record<string, Record<string, number>> } }

/** Segmentation (unit=day) → one row per day for `metric`. Every event in `values` is summed (there is one). */
export function parseSegmentation(json: Segmentation, metric: string): MixpanelRow[] {
  const days = new Map<string, number>();
  for (const series of Object.values(json.data?.values ?? {})) {
    for (const [date, value] of Object.entries(series ?? {})) {
      if (!/^\d{4}-\d{2}-\d{2}/.test(date)) continue;
      days.set(date.slice(0, 10), (days.get(date.slice(0, 10)) ?? 0) + (Number(value) || 0));
    }
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, metric, segment: "", value }));
}

type Retention = Record<string, { counts?: number[]; first?: number }>;

/** Birth retention (unit=day) → the cohort's size and, for each day after, how many came back. */
export function parseRetention(json: Retention): MixpanelRow[] {
  const out: MixpanelRow[] = [];
  for (const [date, cohort] of Object.entries(json ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(date) || !cohort || typeof cohort !== "object") continue;
    const day = date.slice(0, 10);
    out.push({ date: day, metric: "retention_size", segment: "", value: Number(cohort.first) || 0 });
    (cohort.counts ?? []).forEach((n, i) => out.push({ date: day, metric: "retention", segment: `D${i}`, value: Number(n) || 0 }));
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

interface FunnelStepJson { count?: number; avg_time?: number | null; avg_time_from_start?: number | null }
interface Funnel { meta?: { dates?: string[] }; data?: Record<string, { steps?: FunnelStepJson[] } | undefined> }

/**
 * A saved funnel, per day: its first step's count, its last step's count (converters) and their mean
 * time from the first step (Mixpanel reports seconds). Days with no converters carry no time.
 */
export function parseFunnel(json: Funnel): MixpanelRow[] {
  const out: MixpanelRow[] = [];
  for (const [date, day] of Object.entries(json.data ?? {})) {
    const steps = day?.steps ?? [];
    if (!/^\d{4}-\d{2}-\d{2}/.test(date) || steps.length < 2) continue;
    const d = date.slice(0, 10);
    const last = steps[steps.length - 1];
    const converted = Number(last.count) || 0;
    out.push({ date: d, metric: "funnel_start", segment: "", value: Number(steps[0].count) || 0 });
    out.push({ date: d, metric: "ttc_conversions", segment: "", value: converted });
    const seconds = Number(last.avg_time_from_start ?? last.avg_time);
    if (converted > 0 && Number.isFinite(seconds) && seconds >= 0) out.push({ date: d, metric: "ttc_seconds", segment: "", value: seconds });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// MARK: Pull and check

/** `workspace_id` when the card names a data view (digits only), else nothing: every query takes it. */
export const workspaceOf = (c: MixpanelConnection): { workspace_id?: string } => {
  const id = (c.workspaceId ?? "").trim();
  return /^\d{1,20}$/.test(id) ? { workspace_id: id } : {};
};

/**
 * The project's most common event names over the last 31 days (Query API GET /events/names, "Top
 * Events"), for suggesting what to map when an event finds nothing. Best effort: [] on any failure.
 */
export async function topEventNames(fetchImpl: Fetch, credential: string, c: MixpanelConnection, limit = 8): Promise<string[]> {
  try {
    const names = await query<unknown>(fetchImpl, credential, regionOf(c.region), "events/names", { project_id: (c.projectId ?? "").trim(), ...workspaceOf(c), type: "general", limit: String(limit) });
    return Array.isArray(names) ? names.filter((n): n is string => typeof n === "string" && n.trim() !== "").slice(0, limit) : [];
  } catch {
    return [];
  }
}

export interface MixpanelPull { rows: MixpanelRow[]; events: Record<FunnelStep | "active", string>; missing: string[]; skipped: string[] }

/**
 * The funnel's daily uniques are always asked; retention and the saved funnel are skipped (and listed)
 * when less than 15 s of the `deadline` (epoch ms) is left, so a slow day keeps a partial success.
 */
export async function pullMixpanel(credential: string, c: MixpanelConnection, since: string, until: string, fetchImpl: Fetch = fetch, deadline?: number): Promise<MixpanelPull> {
  const projectId = (c.projectId ?? "").trim();
  if (!/^\d{1,20}$/.test(projectId)) throw new MixpanelError("Add the Mixpanel project ID (numbers only) on the connection card.");
  const region = regionOf(c.region);
  const events = eventsOf(c);
  const base = { project_id: projectId, ...workspaceOf(c), from_date: since, to_date: until };
  const rows: MixpanelRow[] = [];
  const missing: string[] = [];
  const skipped: string[] = [];
  const late = () => deadline != null && Date.now() > deadline - 15_000;
  // Unique users per day for each step and for "active", one query at a time (5 at once at most).
  for (const step of [...FUNNEL_STEPS, "active"] as const) {
    const json = await query<Segmentation>(fetchImpl, credential, region, "segmentation", { ...base, event: events[step], unit: "day", type: "unique" });
    const days = parseSegmentation(json, step === "active" ? "active" : `funnel_${step}`);
    if (!days.some((d) => d.value > 0)) missing.push(events[step]);
    rows.push(...days);
  }
  // Day-N retention of the people who installed each day, counting the "active" event as a return.
  if (late()) skipped.push("retention");
  else rows.push(...parseRetention(await query<Retention>(fetchImpl, credential, region, "retention", {
    ...base, retention_type: "birth", born_event: events.install, event: events.active, unit: "day", interval_count: String(RETENTION_DAYS + 1),
  })));
  // Time to convert needs a saved funnel (the API can't build one from events).
  const funnelId = (c.funnelId ?? "").trim();
  if (/^\d{1,20}$/.test(funnelId)) {
    if (late()) skipped.push("saved funnel");
    else rows.push(...parseFunnel(await query<Funnel>(fetchImpl, credential, region, "funnels", { ...base, funnel_id: funnelId, unit: "day" })));
  }
  return { rows, events, missing, skipped };
}

/** The connection check: one segmentation query for the install event over the last week. */
export async function checkMixpanel(credential: string, c: MixpanelConnection, fetchImpl: Fetch = fetch): Promise<string> {
  const projectId = (c.projectId ?? "").trim();
  if (!/^\d{1,20}$/.test(projectId)) throw new MixpanelError("Add the Mixpanel project ID (numbers only) first.");
  const region = regionOf(c.region);
  const events = eventsOf(c);
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  const json = await query<Segmentation>(fetchImpl, credential, region, "segmentation", { project_id: projectId, ...workspaceOf(c), event: events.install, from_date: since, to_date: until, unit: "day", type: "unique" });
  const installs = parseSegmentation(json, "funnel_install").reduce((s, r) => s + r.value, 0);
  if (installs > 0) return `Mixpanel project ${projectId} is readable: ${installs} people did "${events.install}" in the last 7 days.`;
  // Nobody did the install event (Mixpanel's automatic events are off by default now): show what the project does send.
  const names = await topEventNames(fetchImpl, credential, c);
  return names.length
    ? `Mixpanel project ${projectId} is readable, but nobody did "${events.install}" in the last 7 days. Its most common events: ${names.join(", ")}. Set the install event (and the others) under Event names.`
    : `Mixpanel project ${projectId} is readable, but nobody did "${events.install}" in the last 7 days. Check the install event's name on the card.`;
}
