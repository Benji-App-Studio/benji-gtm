// The operating dashboard's sources (Mixpanel and Superwall): their sync and connection check, kept
// apart from index.ts so it only wires them in. Each takes the few things it needs from index.ts
// (a key reader, the lookback window, a saver, the time budget) as `io`, so the logic stays here and
// is testable.
import { checkMixpanel, MixpanelError, pullMixpanel, type MixpanelConnection } from "./mixpanel.ts";
import { checkSuperwall, pullSuperwall, SuperwallError, type SuperwallConnection } from "./superwall.ts";

export { MixpanelError, SuperwallError };

export interface SourceIO {
  key(name: string): Promise<string | undefined>;
  /** How far back to read for this table: a long first look, then the recent past. */
  window(table: string): Promise<{ since: Date; until: Date }>;
  save(table: string, rows: Record<string, unknown>[], onConflict: string): Promise<void>;
  /** "Mixpanel isn't connected: add … in Settings > API keys." */
  notConnected(provider: string, keyName: string): string;
  owner: { product_id: string; user_id: string };
  /** Epoch ms after which optional queries are skipped (the edge function's wall clock). */
  deadline?: number;
}

export interface OperatingConnections {
  mixpanel?: MixpanelConnection; superwall?: SuperwallConnection;
  /** Read only to tell Superwall's revenue apart: an app that connects RevenueCat counts its RevenueCat rows. */
  revenuecat?: { projectId?: string };
}

type Result = { status: "ok" | "not_connected"; message: string; extra?: Record<string, unknown> };
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export const MIXPANEL_KEY = "MIXPANEL_SERVICE_ACCOUNT";
export const SUPERWALL_KEY = "SUPERWALL_API_KEY";
export const OPERATING_SOURCES = ["mixpanel", "superwall"] as const;
export const isOperatingSource = (value: string): value is (typeof OPERATING_SOURCES)[number] => (OPERATING_SOURCES as readonly string[]).includes(value);
export const isOperatingError = (error: unknown) => error instanceof MixpanelError || error instanceof SuperwallError;
/** Whether a product has an operating source to sync (for the scheduled sync's filter). */
export const hasOperatingSource = (c: OperatingConnections) => Boolean(c.mixpanel?.projectId || c.superwall?.applicationId);

const ALL_SOURCES = ["meta", "revenuecat", "appstack", "mixpanel", "superwall"] as const;
type AnySource = (typeof ALL_SOURCES)[number];

/** The sources a sync request names (a connection card names its own), or undefined for all of them. */
export function pickSources(raw: unknown): AnySource[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const picked = ALL_SOURCES.filter((s) => raw.includes(s));
  return picked.length ? picked : undefined;
}

/** A repeat sync of one source within this long returns the last result instead of asking the provider again. */
export const COOLDOWN_MS = 60_000;

/** The last result of `source`, when it synced fine less than COOLDOWN_MS ago (so a second click costs nothing). */
export function cooledDown(rows: { source: string; status: string; message: string | null; synced_at: string }[], source: string, now: number) {
  const row = rows.find((r) => r.source === source);
  if (!row || row.status !== "ok" || now - Date.parse(row.synced_at) >= COOLDOWN_MS) return null;
  return { status: "ok" as const, message: `${row.message ?? ""} (synced a moment ago)`.trim() };
}

export async function syncMixpanel(io: SourceIO, c: OperatingConnections): Promise<Result> {
  const key = await io.key(MIXPANEL_KEY);
  if (!key) return { status: "not_connected", message: io.notConnected("Mixpanel", MIXPANEL_KEY) };
  if (!c.mixpanel?.projectId) return { status: "not_connected", message: "Mixpanel isn't connected: add the project ID to this app's connections." };
  const { since, until } = await io.window("mixpanel_daily");
  const pull = await pullMixpanel(key, c.mixpanel, isoDay(since), isoDay(until), fetch, io.deadline);
  await io.save("mixpanel_daily", pull.rows.map((r) => ({ ...io.owner, ...r })), "product_id,date,metric,segment");
  const installs = pull.rows.filter((r) => r.metric === "funnel_install").reduce((s, r) => s + r.value, 0);
  const missing = pull.missing.length ? ` No one did ${pull.missing.map((e) => `"${e}"`).join(", ")}: check those event names.` : "";
  const skipped = pull.skipped.length ? ` Skipped for time (the next sync tries again): ${pull.skipped.join(", ")}.` : "";
  return {
    status: "ok",
    message: `${installs} installs and ${pull.rows.length} daily values since ${isoDay(since)}.${missing}${skipped}`,
    extra: { details: { since: isoDay(since), events: pull.events, missing: pull.missing, skipped: pull.skipped } },
  };
}

export async function syncSuperwall(io: SourceIO, c: OperatingConnections): Promise<Result> {
  const key = await io.key(SUPERWALL_KEY);
  if (!key) return { status: "not_connected", message: io.notConnected("Superwall", SUPERWALL_KEY) };
  if (!c.superwall?.applicationId) return { status: "not_connected", message: "Superwall isn't connected: add the application ID to this app's connections." };
  const { since } = await io.window("superwall_daily");
  const pull = await pullSuperwall(key, c.superwall, isoDay(since), fetch, io.deadline, Boolean(c.revenuecat?.projectId?.trim()));
  await io.save("superwall_daily", pull.days.map((d) => ({ ...io.owner, ...d })), "product_id,date,paywall,placement");
  const opens = pull.days.reduce((s, d) => s + d.opens, 0);
  const conversions = pull.days.reduce((s, d) => s + d.conversions, 0);
  const skipped = pull.skipped.length ? ` Skipped for time (the next sync tries again): ${pull.skipped.join(", ")}.` : "";
  return {
    status: "ok",
    message: `${pull.app.name || "Superwall"}: ${opens} paywall views and ${conversions} paid purchases since ${isoDay(since)}.${skipped}`,
    extra: { currency: "USD", details: { since: isoDay(since), app: pull.app, skipped: pull.skipped, revenueFrom: pull.revenueFrom } },
  };
}

/** The connection check for Mixpanel or Superwall. A missing key is `pending` (nothing can be checked yet). */
export async function verifyOperating(source: (typeof OPERATING_SOURCES)[number], c: OperatingConnections, key: (name: string) => Promise<string | undefined>, notSet: (name: string, provider: string) => { ok: boolean; pending?: boolean; message: string }): Promise<{ ok: boolean; pending?: boolean; message: string }> {
  if (source === "mixpanel") {
    const value = await key(MIXPANEL_KEY);
    if (!value) return notSet(MIXPANEL_KEY, "Mixpanel");
    if (!c.mixpanel?.projectId) return { ok: false, message: "Add the Mixpanel project ID first." };
    return { ok: true, message: await checkMixpanel(value, c.mixpanel) };
  }
  const value = await key(SUPERWALL_KEY);
  if (!value) return notSet(SUPERWALL_KEY, "Superwall");
  if (!c.superwall?.applicationId) return { ok: false, message: "Add the Superwall application ID first." };
  return { ok: true, message: await checkSuperwall(value, c.superwall) };
}
