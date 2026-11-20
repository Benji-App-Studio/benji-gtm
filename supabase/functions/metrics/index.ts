// Measure's backend: pulls a workspace's paid-growth numbers from Meta (Insights), RevenueCat
// (charts) and AppStack (attributed events) into the snapshot tables. The studio calls /sync
// when someone presses "Sync now"; a pg_cron job can call /sync-all on a schedule (see the
// 20261002200000_measure migration). Every source is optional: one that isn't configured is
// recorded as not connected and the others still sync. /verify is the workspace page's connection
// check: one or two read calls against the source, with the same tokens.
//
// Keys (Settings > API keys, or edge function secrets, through _shared/keys.ts): META_SYSTEM_USER_TOKEN,
// META_APP_SECRET, REVENUECAT_API_KEY (or REVENUECAT_API_KEY_<PROJECT> per app), APPSTACK_API_KEY (or APPSTACK_API_KEY_<APP> per app), and for the operating
// dashboard MIXPANEL_SERVICE_ACCOUNT and SUPERWALL_API_KEY (Mixpanel and Superwall live in sources.ts). The keys
// belong to the install, so only its owner and members can sync with them, and the scheduled sync
// only pulls their workspaces. On an install from before setup existed (no owner) the optional
// MEASURE_ALLOWED_EMAILS list decides instead, and connection checks also accept LAUNCH_ALLOWED_EMAILS.
import { createClient } from "@supabase/supabase-js";
import { HttpError, type Member } from "../_shared/auth.ts";
import { addKeyMessage, perAppKeyName, sameSecret } from "../_shared/keys.ts";
import { createTenancy, type Tenant } from "../_shared/tenant.ts";
import { allowedOwners, isAllowed, mayMeasure, nextPage, SYNC_PAGE } from "./access.ts";
import { AppStackError, checkAppStack, pullAppStack } from "./appstack.ts";
import { type Db as LineageDb, saveAds } from "./lineage.ts";
import { checkMeta, MetaError, pullMeta } from "./meta.ts";
import { checkRevenueCat, pullRevenueCat, RevenueCatError } from "./revenuecat.ts";
import { cooledDown, hasOperatingSource, isOperatingError, isOperatingSource, MIXPANEL_KEY, type OperatingConnections, pickSources, type SourceIO, SUPERWALL_KEY, syncMixpanel, syncSuperwall, verifyOperating } from "./sources.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    return keys.default ?? Object.values(keys)[0];
  } catch {
    throw new Error("No service key in the environment.");
  }
}

const db = createClient(SUPABASE_URL, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });

/** A first sync looks back this far; later ones re-read the recent past, where attribution still moves. */
const FIRST_DAYS = 90;
const RECENT_DAYS = 30;
const CHUNK = 500;

/**
 * Whose keys: the install's (install and legacy mode) or each workspace owner's own (accounts mode,
 * _shared/tenant.ts). The worker secret is always the platform's.
 */
const tenancy = createTenancy(db);
/** A plain setting (an allow-list): edge function environment only. */
const env = (name: string) => Deno.env.get(name)?.trim() || undefined;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 400);
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

// MARK: HTTP

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/**
 * The install's ad and revenue data sits behind shared keys: its owner and members may pull it. On an
 * install with no owner, the people on MEASURE_ALLOWED_EMAILS (everyone signed in when it is unset).
 */
const allowed = (caller: Member) => mayMeasure(caller.role, caller.email, env("MEASURE_ALLOWED_EMAILS"));

/** The pg_cron job authenticates with the worker secret the radar function's watchdog already uses. */
async function requireWorker(req: Request) {
  const secret = await tenancy.platform().get("RADAR_WORKER_SECRET");
  const given = req.headers.get("x-radar-worker") ?? "";
  if (!secret || !sameSecret(given, secret)) throw new HttpError(403, "Forbidden");
}

async function body(req: Request): Promise<Record<string, unknown>> {
  try { return await req.json(); } catch { return {}; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const route = new URL(req.url).pathname.replace(/\/+$/, "").split("/").pop();
  try {
    switch (route) {
      case "health": {
        const tenant = await tenancy.healthTenant(req);
        return json(tenant ? await health(tenant) : { ok: true, mode: "accounts" });
      }
      case "sync": {
        const user = await tenancy.member(req);
        if (!allowed(user)) throw new HttpError(403, "Measure reads the team's ad and revenue accounts, so it's limited to the people in MEASURE_ALLOWED_EMAILS (Supabase → Edge Functions → Secrets).");
        await tenancy.rate(user.tenant, "metrics.sync");
        const input = await body(req);
        return json(await syncProduct(user.tenant, user.id, String(input.productId ?? ""), Number(input.days) || undefined, pickSources(input.sources)));
      }
      case "verify": {
        const user = await tenancy.member(req);
        // Only an install with no owner reads the email lists (a member of an owned install is always allowed).
        if (!allowed(user) && !(user.role === "legacy" && isAllowed(user.email, env("LAUNCH_ALLOWED_EMAILS")))) {
          throw new HttpError(403, "Checking a connection uses the team's tokens, so it's limited to the people in MEASURE_ALLOWED_EMAILS or LAUNCH_ALLOWED_EMAILS (Supabase → Edge Functions → Secrets).");
        }
        await tenancy.rate(user.tenant, "metrics.verify");
        return json(await verify(user.tenant, user.id, await body(req)));
      }
      case "sync-all": {
        await requireWorker(req);
        return json(await syncAll());
      }
      default: return json({ error: "Not found" }, 404);
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error(error);
    return json({ error: `Something went wrong: ${errorText(error)}` }, 500);
  }
});

/** Which sources have a key set (never the values). */
async function health(tenant: Tenant) {
  const set = await tenant.keys.flags(["META_SYSTEM_USER_TOKEN", "REVENUECAT_API_KEY", "APPSTACK_API_KEY", MIXPANEL_KEY, SUPERWALL_KEY]);
  return {
    meta: set.META_SYSTEM_USER_TOKEN,
    revenuecat: set.REVENUECAT_API_KEY || (await tenant.keys.withPrefix("REVENUECAT_API_KEY_")).length > 0,
    appstack: set.APPSTACK_API_KEY || (await tenant.keys.withPrefix("APPSTACK_API_KEY_")).length > 0,
    mixpanel: set[MIXPANEL_KEY], superwall: set[SUPERWALL_KEY],
    // Who may sync is settled: accounts mode and an install with an owner go by who is let in, an older one by the email list.
    allowList: tenant.mode === "accounts" || Boolean(env("MEASURE_ALLOWED_EMAILS")) || Boolean((await tenancy.auth.install().catch(() => null))?.ownerUserId),
  };
}

// MARK: Sync

/** The workspace contract's connections (stored on the product by the workspaces feature). */
interface Connections extends OperatingConnections {
  meta?: { adAccountId?: string };
  revenuecat?: { projectId?: string };
  appstack?: { appId?: string };
}

type Source = "meta" | "revenuecat" | "appstack" | "mixpanel" | "superwall";
interface SourceResult { status: "ok" | "error" | "not_connected"; message: string }

/**
 * Every connected workspace whose owner may sync: the install's owner and members, or on an install
 * with no owner the people on MEASURE_ALLOWED_EMAILS (all of them when the list is unset).
 */
async function syncAll() {
  const list = env("MEASURE_ALLOWED_EMAILS");
  const { data, error } = await db.from("products").select("id, user_id, connections");
  if (error) return { synced: 0, error: error.message };
  const rows = ((data ?? []) as { id: string; user_id: string; connections?: Connections }[]).filter((row) => {
    const c = row.connections ?? {};
    return Boolean(c.meta?.adAccountId || c.revenuecat?.projectId || c.appstack?.appId || hasOperatingSource(c));
  });
  if (await tenancy.mode() !== "accounts") {
    // Install and legacy mode: exactly as before (every allowed workspace in one run, the one key reader).
    const owners = await allowedOwners(rows.map((r) => r.user_id), async (id) => {
      const { data: found, error: lookup } = await db.auth.admin.getUserById(id);
      return lookup ? null : found.user?.email ?? null;
    }, list, (id) => tenancy.auth.roleOf(id));
    let synced = 0;
    for (const row of rows) {
      if (!owners.has(row.user_id)) continue;
      await syncProduct(await tenancy.for(row.user_id), row.user_id, row.id).catch((e) => console.error(`measure sync ${row.id}: ${errorText(e)}`));
      synced++;
    }
    return { synced, skipped: rows.length - synced };
  }
  // Accounts mode: every active account's own workspaces, each with that account's keys, a page per run.
  const owners = await tenancy.activeUsers(rows.map((r) => r.user_id));
  const eligible = rows.filter((row) => owners.has(row.user_id));
  // A page per run, the workspaces synced longest ago first, so successive runs move through all of them.
  const { data: synced_ } = eligible.length
    ? await db.from("measure_sync").select("product_id, synced_at").in("product_id", eligible.map((r) => r.id))
    : { data: [] };
  const page = nextPage(eligible, (synced_ ?? []) as { product_id: string; synced_at: string | null }[], SYNC_PAGE);
  let synced = 0;
  for (const row of page) {
    await syncProduct(await tenancy.for(row.user_id), row.user_id, row.id).catch((e) => console.error(`measure sync ${row.id}: ${errorText(e)}`));
    synced++;
  }
  return { synced, skipped: rows.length - eligible.length, waiting: eligible.length - page.length };
}

// MARK: Connection checks

interface Verified { ok: boolean; message: string; pending?: boolean }

/** "Meta isn't connected: add your Meta system user token in Settings > API keys." (the studio trims the lead). */
const notConnected = (provider: string, name: string) => `${provider} isn't connected: ${addKeyMessage(name).replace(/^Add/, "add")}`;

/** AppStack keys are per app: a workspace's own key (APPSTACK_API_KEY_<APP>) wins over the default. */
async function appStackKey(tenant: Tenant, appId: string | undefined) {
  // Read through the tenant's reader: in accounts mode only that account's own per-app keys exist here.
  const perApp = appId?.trim() ? await tenant.keys.get(perAppKeyName("APPSTACK_API_KEY", appId)) : undefined;
  return perApp ?? await tenant.keys.get("APPSTACK_API_KEY");
}

/**
 * A RevenueCat v2 secret key reads one project, so an app's own key (REVENUECAT_API_KEY_<PROJECT>) wins over
 * the account's default REVENUECAT_API_KEY; two apps in two RevenueCat projects each keep their own.
 */
async function revenueCatKey(keys: Tenant["keys"], projectId: string | undefined) {
  const perProject = projectId?.trim() ? await keys.get(perAppKeyName("REVENUECAT_API_KEY", projectId)) : undefined;
  return perProject ?? await keys.get("REVENUECAT_API_KEY");
}

/**
 * Checks one of the workspace's connections with real read calls. A missing key is `pending` (the IDs
 * may be right; nothing can be checked yet), so the studio records nothing. Never returns a token.
 */
async function verify(tenant: Tenant, user: string, input: Record<string, unknown>): Promise<Verified> {
  const secrets = tenant.keys;
  const productId = String(input.productId ?? "");
  if (!/^[0-9a-f-]{36}$/.test(productId)) throw new HttpError(400, "Which workspace?");
  const connection = String(input.connection ?? "");
  if (!["meta", "revenuecat", "appstack"].includes(connection) && !isOperatingSource(connection)) throw new HttpError(400, "Choose a connection to check.");
  const { data: product } = await db.from("products").select("*").eq("id", productId).eq("user_id", user).maybeSingle();
  if (!product) throw new HttpError(404, "This workspace doesn't exist.");
  const c = ((product as { connections?: Connections & { meta?: { pageId?: string } } }).connections ?? {});
  const notSet = (name: string, provider: string): Verified => ({ ok: false, pending: true, message: `${provider} can't be checked yet. ${addKeyMessage(name)} The IDs are saved.` });
  try {
    if (isOperatingSource(connection)) return await verifyOperating(connection, c, operatingKey(secrets), notSet);
    if (connection === "meta") {
      const token = await secrets.get("META_SYSTEM_USER_TOKEN");
      if (!token) return notSet("META_SYSTEM_USER_TOKEN", "Meta");
      const account = c.meta?.adAccountId?.trim();
      if (!account) return { ok: false, message: "Add the ad account ID first." };
      let message = await checkMeta(token, account, c.meta?.pageId, await secrets.get("META_APP_SECRET"));
      // The platform's list applies to the platform's token only (launch/index.ts adAccountList).
      const platformToken = tenant.mode !== "accounts" || await secrets.source("META_SYSTEM_USER_TOKEN") === "platform";
      const launchable = ((platformToken ? env("META_ALLOWED_AD_ACCOUNTS") : undefined) ?? "").split(/[\s,]+/).map((a) => a.trim().replace(/^act_/, "")).filter(Boolean);
      if (launchable.length && !launchable.includes(account.replace(/^act_/, ""))) message += " Launch can't write to it until it's on META_ALLOWED_AD_ACCOUNTS.";
      return { ok: true, message };
    }
    if (connection === "revenuecat") {
      const project = c.revenuecat?.projectId?.trim();
      const key = await revenueCatKey(secrets, project);
      if (!key) return notSet("REVENUECAT_API_KEY", "RevenueCat");
      if (!project) return { ok: false, message: "Add the RevenueCat project ID first." };
      return { ok: true, message: await checkRevenueCat(key, project) };
    }
    const appId = c.appstack?.appId?.trim();
    const key = await appStackKey(tenant, appId);
    if (!key) return notSet("APPSTACK_API_KEY", "AppStack");
    if (!appId) return { ok: false, message: "Add the AppStack app ID (bundle id) first." };
    return { ok: true, message: await checkAppStack(key, appId) };
  } catch (error) {
    const known = error instanceof MetaError || error instanceof RevenueCatError || error instanceof AppStackError || isOperatingError(error);
    if (!known) console.error(error);
    return { ok: false, message: known ? (error as Error).message : `The check failed: ${errorText(error)}` };
  }
}

/** One source's card syncs only that source; a repeat within a minute returns the last result instead of asking again. */
async function syncProduct(tenant: Tenant, user: string, productId: string, days?: number, only?: Source[]) {
  if (!/^[0-9a-f-]{36}$/.test(productId)) throw new HttpError(400, "Which workspace?");
  // select("*") so this works before and after the workspaces feature adds `connections`.
  const { data: product } = await db.from("products").select("*").eq("id", productId).eq("user_id", user).maybeSingle();
  if (!product) throw new HttpError(404, "This workspace doesn't exist.");
  const connections = ((product as { connections?: Connections }).connections ?? {}) as Connections;
  // Pulls stop asking for optional data before the edge function's wall clock runs out.
  const ctx: Ctx = { productId, user, days, deadline: Date.now() + SYNC_BUDGET_MS, keys: tenant.keys, tenant };
  const { data: last } = only ? await db.from("measure_sync").select("source, status, message, synced_at").eq("product_id", productId) : { data: null };
  const want = (source: Source, work: () => Promise<SourceResult & { extra?: Record<string, unknown> }>) => {
    if (only && !only.includes(source)) return Promise.resolve(undefined);
    const recent = only ? cooledDown(last ?? [], source, Date.now()) : null;
    return recent ? Promise.resolve(recent) : run(ctx, source, work);
  };
  const [meta, revenuecat, appstack, mixpanel, superwall] = await Promise.all([
    want("meta", () => syncMeta(ctx, connections)),
    want("revenuecat", () => syncRevenueCat(ctx, connections)),
    want("appstack", () => syncAppStack(ctx, connections)),
    want("mixpanel", () => syncMixpanel(io(ctx), connections)),
    want("superwall", () => syncSuperwall(io(ctx), connections)),
  ]);
  return { meta, revenuecat, appstack, mixpanel, superwall, syncedAt: new Date().toISOString() };
}

interface Ctx { productId: string; user: string; days?: number; deadline?: number; tenant: Tenant; keys: Tenant["keys"] }

/** The time a sync may spend pulling (the edge function's wall clock is 150 s; the studio waits 145 s). */
const SYNC_BUDGET_MS = 110_000;

/**
 * The one place the operating dashboard's sources (Mixpanel, Superwall) read their keys: the account's own
 * reader (accounts mode: never the platform's unless staff; install and legacy: the one install-wide reader).
 */
const operatingKey = (keys: Tenant["keys"]) => (name: string) => keys.get(name);

/** What the operating dashboard's sources (sources.ts) need from here. */
const io = (ctx: Ctx): SourceIO => ({ key: operatingKey(ctx.keys), window: (table) => lookback(ctx, table), save: upsert, notConnected, owner: { product_id: ctx.productId, user_id: ctx.user }, deadline: ctx.deadline });

/** Runs one source's sync and records how it went; a failure never stops the other sources. */
async function run(ctx: Ctx, source: Source, work: () => Promise<SourceResult & { extra?: Record<string, unknown> }>): Promise<SourceResult> {
  let result: SourceResult & { extra?: Record<string, unknown> };
  try {
    result = await work();
  } catch (error) {
    const known = error instanceof MetaError || error instanceof RevenueCatError || error instanceof AppStackError || isOperatingError(error);
    if (!known) console.error(error);
    result = { status: "error", message: known ? (error as Error).message : `Sync failed: ${errorText(error)}` };
  }
  const row: Record<string, unknown> = { product_id: ctx.productId, user_id: ctx.user, source, status: result.status, message: result.message, synced_at: new Date().toISOString(), ...result.extra };
  await db.from("measure_sync").upsert(row, { onConflict: "product_id,source" });
  return { status: result.status, message: result.message };
}

/** How far back to read: the caller's choice, or a long first look then the recent past. */
async function lookback(ctx: Ctx, table: string): Promise<{ since: Date; until: Date }> {
  let days = ctx.days ? Math.min(Math.max(ctx.days, 1), FIRST_DAYS) : RECENT_DAYS;
  if (!ctx.days) {
    const { count } = await db.from(table).select("product_id", { count: "exact", head: true }).eq("product_id", ctx.productId);
    if (!count) days = FIRST_DAYS;
  }
  return { since: daysAgo(days), until: new Date() };
}

async function upsert(table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw new Error(`Saving ${table}: ${error.message}`);
  }
}

// MARK: Meta

/** What one unit of `currency` is worth in USD today (ECB rates via Frankfurter; no key needed). */
async function usdRate(currency: string): Promise<number | null> {
  if (currency === "USD") return 1;
  for (const url of [`https://api.frankfurter.dev/v1/latest?base=${currency}&symbols=USD`, `https://api.frankfurter.app/latest?from=${currency}&to=USD`]) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const rate = Number((await response.json())?.rates?.USD);
      if (response.ok && rate > 0) return rate;
    } catch { /* try the next address */ }
  }
  return null;
}

async function syncMeta(ctx: Ctx, connections: Connections) {
  const token = await ctx.keys.get("META_SYSTEM_USER_TOKEN");
  const account = connections.meta?.adAccountId?.trim();
  if (!token) return { status: "not_connected" as const, message: notConnected("Meta", "META_SYSTEM_USER_TOKEN") };
  if (!account) return { status: "not_connected" as const, message: "Meta isn't connected: add the ad account id to this workspace's connections." };
  const { since, until } = await lookback(ctx, "meta_daily");
  const pull = await pullMeta(token, account, isoDay(since), isoDay(until), await ctx.keys.get("META_APP_SECRET"));
  const owner = { product_id: ctx.productId, user_id: ctx.user };
  const now = new Date().toISOString();

  // Campaign roles are the team's call: keep the ones already set, guess the rest from the name.
  const { data: existing } = await db.from("meta_campaigns").select("campaign_id, role").eq("product_id", ctx.productId);
  const roles = new Map(((existing ?? []) as { campaign_id: string; role: string | null }[]).map((c) => [c.campaign_id, c.role]));
  const guess = (name: string) => (/scal|winner|evergreen/i.test(name) ? "scaling" : /test|cbo test|abo|sandbox/i.test(name) ? "testing" : null);
  await upsert("meta_campaigns", pull.campaigns.map((c) => ({ ...owner, ...c, role: roles.get(c.campaign_id) ?? guess(c.name), updated_at: now })), "product_id,campaign_id");
  // format_id and creative_ref come from Launch's drafts (lineage.ts), filling gaps only.
  await saveAds(db as unknown as LineageDb, owner, pull.ads, now);
  await upsert("meta_daily", pull.days.map((d) => ({ ...owner, ...d })), "product_id,ad_id,date");

  const rate = await usdRate(pull.account.currency);
  const spend = pull.days.reduce((sum, d) => sum + d.spend, 0);
  return {
    status: "ok" as const,
    message: pull.days.length
      ? `${pull.account.name}: ${pull.ads.length} ads, ${pull.days.length} ad-days since ${isoDay(since)} (${spend.toFixed(2)} ${pull.account.currency} spent).`
      : `${pull.account.name}: no delivery since ${isoDay(since)}.`,
    extra: {
      currency: pull.account.currency,
      // Keep the last good rate when today's lookup fails.
      ...(rate ? { fx_rate: rate } : {}),
      details: { account: pull.account, campaigns: pull.campaigns.length, ads: pull.ads.length, since: isoDay(since), fxDate: rate ? isoDay(new Date()) : null },
    },
  };
}

// MARK: RevenueCat

async function syncRevenueCat(ctx: Ctx, connections: Connections) {
  const project = connections.revenuecat?.projectId?.trim();
  const key = await revenueCatKey(ctx.keys, project);
  if (!key) return { status: "not_connected" as const, message: notConnected("RevenueCat", "REVENUECAT_API_KEY") };
  if (!project) return { status: "not_connected" as const, message: "RevenueCat isn't connected: add the project id to this workspace's connections." };
  const { since, until } = await lookback(ctx, "revenuecat_daily");
  const pull = await pullRevenueCat(key, project, isoDay(since), isoDay(until), { deadline: ctx.deadline });
  await upsert("revenuecat_daily", pull.values.map((v) => ({ product_id: ctx.productId, user_id: ctx.user, ...v })), "product_id,date,chart,measure,segment");
  return {
    status: "ok" as const,
    message: `${pull.values.length} daily values since ${isoDay(since)}.${pull.skipped?.length ? ` Skipped (refused, rate-limited or out of time; the next sync tries again): ${pull.skipped.join(", ")}.` : ""}`,
    extra: { currency: "USD", details: { overview: pull.overview, since: isoDay(since), skipped: pull.skipped ?? [] } },
  };
}

// MARK: AppStack

async function syncAppStack(ctx: Ctx, connections: Connections) {
  const appId = connections.appstack?.appId?.trim();
  const key = await appStackKey(ctx.tenant, appId);
  if (!key) return { status: "not_connected" as const, message: notConnected("AppStack", "APPSTACK_API_KEY") };
  if (!appId) return { status: "not_connected" as const, message: "AppStack isn't connected: add the app id (bundle id) to this workspace's connections." };
  const { since } = await lookback(ctx, "appstack_daily");
  const sinceDay = new Date(`${isoDay(since)}T00:00:00Z`);
  const days = await pullAppStack(key, sinceDay, appId);
  // The window is recounted from scratch, so replace it rather than add to it.
  const { error } = await db.from("appstack_daily").delete().eq("product_id", ctx.productId).gte("date", isoDay(sinceDay));
  if (error) throw new Error(`Clearing appstack_daily: ${error.message}`);
  await upsert("appstack_daily", days.map((d) => ({ product_id: ctx.productId, user_id: ctx.user, ...d })), "product_id,date,media_source,campaign_id,adset_id,ad_id");
  const installs = days.reduce((sum, d) => sum + d.installs, 0);
  return { status: "ok" as const, message: `${installs} installs and ${days.reduce((s, d) => s + d.purchases, 0)} purchases attributed since ${isoDay(sinceDay)}.`, extra: { details: { since: isoDay(sinceDay) } } };
}
