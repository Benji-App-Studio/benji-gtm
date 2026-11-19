// Launch: puts approved creatives on Meta as PAUSED drafts in a workspace's testing ad set, copies
// winners (paused) into the scaling ad set, pauses losers, and — when a workspace turns it on —
// queues the newest approved creatives every day. Nothing it creates ever runs until someone
// publishes it in Ads Manager (graph.ts refuses any write that isn't paused).
//
// Uploads are resumable jobs like the radar function's: the worker steps each draft (upload, wait
// for Meta to process videos, create the creative and the paused ad) in ~75 s slices under a lease,
// hands over to a fresh invocation, and a pg_cron watchdog wakes jobs whose worker stopped.
//
// Routes (a signed-in member of the install unless noted, or on an install from before setup existed a
// signed-in user on LAUNCH_ALLOWED_EMAILS; every Meta write also needs the workspace's ad account on
// META_ALLOWED_AD_ACCOUNTS when that list is set):
//   GET  /health                      which keys are set (no values)
//   POST /settings { productId, settings }   validate and save the workspace's Launch settings
//   POST /status   { productId }      the ad account and testing/scaling ad sets, what's missing
//   POST /preview  { productId, items }      names and the exact payloads, nothing sent
//   POST /drafts   { productId, items }      queue paused drafts in the testing ad set; items are
//                                            { creativeId, primaryText?, headline?, description?, cta?, hookType?, aiDisclosure? } and
//                                            the creatives are read from the database (approved, QA passed)
//   POST /setup    { productId, stages, confirm }   plan (or, confirmed, create) paused campaigns + ad sets
//   POST /promote  { productId, adId }       paused copy of a testing ad in the scaling ad set
//   POST /pause    { productId, adId }       pause an ad
//   "Send to Meta" (sheet.ts; reads are read-only, writes need confirm: true and stay paused):
//   POST /campaigns, /adsets, /connections, /search, /estimate, /ad-preview   reads
//   POST /send     { productId, stage, campaign, adSet, ad, confirm }   paused campaign/ad set + ads in any ad set
//   POST /edit     { productId, level, id, changes, confirm }           rename, budget, bid, schedule, pause
//   POST /work, /tick, /daily         worker secret only
import { createClient } from "@supabase/supabase-js";
import { createAuth, HttpError } from "../_shared/auth.ts";
import { addKeyMessage, createKeys, sameSecret } from "../_shared/keys.ts";
import { adAccountRefusal, launchAccess } from "./access.ts";
import { planDaily } from "./automation.ts";
import { due, stepDraft } from "./draft.ts";
import { adsManagerUrl, Graph, GRAPH_VERSION } from "./graph.ts";
import { account, adSet, copyAd, createStructure, destination, explain, missing, pauseAd, previewDraft, campaignPayload, adSetPayload, type StructureInput } from "./meta.ts";
import { mockMeta } from "./mock.ts";
import { adName, appCode, day, nextVersion, parseAdName, slug, withStage, type Stage } from "./naming.ts";
import { automationRefusal, settingsInput } from "./settings.ts";
import { approvedCreatives, creativesByIds, draftCreative } from "./sources.ts";
import { adPreviewRoute, adSetsRoute, campaignsRoute, connectionsRoute, editRoute, estimateRoute, type NewDraft, searchRoute, sendRoute, SheetError, type SheetDeps } from "./sheet.ts";
import { TERMINAL, type CreativeInput, type DraftRow, type LaunchSettingsRow } from "./types.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/launch`;
const SLICE_MS = 75_000;
const LEASE_SECONDS = 120;
const MAX_ITEMS = 20;

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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 400);

class UserError extends Error {}

// MARK: Keys and callers

/** Every key comes from the shared reader (edge function secret first, then Vault; the worker secret Vault only). */
const secrets = createKeys(db);
const auth = createAuth(db);

interface Keys { token?: string; appSecret?: string; worker?: string }

/** The system-user token, the app secret and the worker secret, as one object. */
async function keys(): Promise<Keys> {
  return {
    token: await secrets.get("META_SYSTEM_USER_TOKEN"),
    appSecret: await secrets.get("META_APP_SECRET"),
    worker: await secrets.get("LAUNCH_WORKER_SECRET"),
  };
}

const MOCK = Deno.env.get("LAUNCH_META_MOCK") === "1";
const mock = MOCK ? mockMeta({ videoPolls: 1 }) : null;

/** The Graph client, or null when Meta isn't connected (no token and not in mock mode). */
async function graph(): Promise<Graph | null> {
  if (mock) return new Graph("mock-token", mock.fetch);
  const k = await keys();
  return k.token ? new Graph(k.token, fetch, GRAPH_VERSION, k.appSecret) : null;
}

async function requireGraph(): Promise<Graph> {
  const g = await graph();
  if (!g) throw new UserError(`Meta isn't connected. ${addKeyMessage("META_SYSTEM_USER_TOKEN")}`);
  return g;
}

// MARK: HTTP

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/**
 * The signed-in user's id, if they may use Launch (the Meta token is behind it). On an install with an
 * owner, its members may; on one from before setup existed, LAUNCH_ALLOWED_EMAILS decides (access.ts).
 */
async function launcher(req: Request): Promise<string> {
  const caller = await auth.member(req);
  const refusal = launchAccess(caller.role, caller.email, Deno.env.get("LAUNCH_ALLOWED_EMAILS"));
  if (refusal) throw new HttpError(403, refusal);
  return caller.id;
}

/** Whether a workspace's owner may still use Launch (for the daily automation, which runs as no one). */
async function ownerAllowed(userId: string): Promise<string | null> {
  const role = await auth.roleOf(userId);
  if (role !== "legacy") return launchAccess(role, null, undefined);
  const { data, error } = await db.auth.admin.getUserById(userId);
  if (error || !data.user) return "The workspace's owner couldn't be found.";
  return launchAccess(role, data.user.email ?? "", Deno.env.get("LAUNCH_ALLOWED_EMAILS"));
}

async function requireWorker(req: Request) {
  const secret = (await keys()).worker;
  const given = req.headers.get("x-launch-worker") ?? "";
  if (!secret || !sameSecret(given, secret)) throw new HttpError(403, "Forbidden");
}

async function body(req: Request): Promise<Record<string, any>> {
  try { return await req.json(); } catch { return {}; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const route = new URL(req.url).pathname.replace(/\/+$/, "").split("/").pop();
  try {
    switch (route) {
      case "health": {
        const set = await secrets.flags(["META_SYSTEM_USER_TOKEN", "META_APP_SECRET", "LAUNCH_WORKER_SECRET"]);
        return json({ meta: set.META_SYSTEM_USER_TOKEN || MOCK, mock: MOCK, appSecret: set.META_APP_SECRET, worker: set.LAUNCH_WORKER_SECRET, version: GRAPH_VERSION });
      }
      case "settings": { const user = await launcher(req); return json(await saveSettings(user, await body(req))); }
      case "status": { const user = await launcher(req); return json(await status(user, await body(req))); }
      case "preview": { const user = await launcher(req); return json(await preview(user, await body(req))); }
      case "drafts": { const user = await launcher(req); return json(await queueDrafts(user, await body(req))); }
      case "setup": { const user = await launcher(req); return json(await setup(user, await body(req))); }
      case "promote": { const user = await launcher(req); return json(await promote(user, await body(req))); }
      case "pause": { const user = await launcher(req); return json(await pause(user, await body(req))); }
      case "campaigns": case "adsets": case "connections": case "search": case "estimate": case "ad-preview": case "send": case "edit": {
        const user = await launcher(req);
        const input = await body(req);
        const deps = await sheetDeps(user, input.productId);
        const run = { campaigns: campaignsRoute, adsets: adSetsRoute, connections: connectionsRoute, search: searchRoute, estimate: estimateRoute, "ad-preview": adPreviewRoute, send: sendRoute, edit: editRoute }[route];
        return json(await run(deps, input));
      }
      case "work": {
        await requireWorker(req);
        const jobId = String((await body(req)).jobId ?? "");
        EdgeRuntime.waitUntil(advance(jobId));
        return json({ accepted: true }, 202);
      }
      case "tick": {
        await requireWorker(req);
        const { data } = await db.rpc("launch_idle_jobs");
        await Promise.all(((data ?? []) as string[]).map((id) => wake(id)));
        return json({ woken: (data ?? []).length }, 202);
      }
      case "daily": {
        await requireWorker(req);
        return json(await daily());
      }
      default: return json({ error: "Not found" }, 404);
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof SheetError) return json({ error: error.message, ...error.extra }, error.status);
    if (error instanceof UserError) return json({ error: error.message }, 400);
    console.error(error);
    return json({ error: `Something went wrong: ${errorText(error)}` }, 500);
  }
});

// MARK: Settings

const UUID = /^[0-9a-f-]{36}$/;

async function settingsFor(user: string, productId: unknown): Promise<LaunchSettingsRow> {
  const id = String(productId ?? "");
  if (!UUID.test(id)) throw new HttpError(400, "Which workspace?");
  const { data } = await db.from("launch_settings").select("*").eq("product_id", id).eq("user_id", user).maybeSingle();
  if (!data) throw new UserError("Save this workspace's Launch settings first.");
  const s = data as LaunchSettingsRow;
  s.meta ??= {};
  const refusal = adAccountRefusal(s.meta.adAccountId, Deno.env.get("META_ALLOWED_AD_ACCOUNTS"), false);
  if (refusal) throw new UserError(refusal);
  return s;
}

/** Every Meta write goes through here first: the ad account must be on META_ALLOWED_AD_ACCOUNTS (an empty list refuses). */
function requireWritable(settings: LaunchSettingsRow) {
  const refusal = adAccountRefusal(settings.meta?.adAccountId, Deno.env.get("META_ALLOWED_AD_ACCOUNTS"), true);
  if (refusal) throw new UserError(refusal);
}

/** Validates and saves a workspace's settings (users can only read launch_settings). */
async function saveSettings(user: string, input: Record<string, any>) {
  const id = String(input.productId ?? "");
  if (!UUID.test(id)) throw new HttpError(400, "Which workspace?");
  const { data: product } = await db.from("products").select("id").eq("id", id).eq("user_id", user).maybeSingle();
  if (!product) throw new HttpError(404, "This workspace doesn't exist.");
  const raw = input.settings && typeof input.settings === "object" ? input.settings as Record<string, unknown> : {};
  const patch = settingsInput(raw);
  if (typeof patch === "string") throw new UserError(patch);
  const { data: current } = await db.from("launch_settings").select("user_id, max_daily_budget, testing_adset_id").eq("product_id", id).maybeSingle();
  if (current && current.user_id !== user) throw new HttpError(404, "This workspace doesn't exist.");
  const automation = automationRefusal(patch, current);
  if (automation) throw new UserError(automation);
  if (patch.meta?.adAccountId) {
    const refusal = adAccountRefusal(patch.meta.adAccountId, Deno.env.get("META_ALLOWED_AD_ACCOUNTS"), false);
    if (refusal) throw new UserError(refusal);
  }
  const { data, error } = await db.from("launch_settings").upsert({ ...patch, product_id: id, user_id: user }, { onConflict: "product_id" }).select("*").single();
  if (error) throw new Error(`Couldn't save the settings: ${error.message}`);
  return data;
}

const codeFor = (s: LaunchSettingsRow) => appCode(s.meta.appName ?? "App", s.app_code);

// MARK: Status

async function status(user: string, input: Record<string, any>) {
  const settings = await settingsFor(user, input.productId);
  const g = await graph();
  const result: Record<string, unknown> = { connected: Boolean(g), mock: MOCK, version: GRAPH_VERSION, missing: missing(settings, "TEST") };
  if (!g || !settings.meta.adAccountId) return result;
  try {
    const a = await account(g, settings.meta.adAccountId);
    result.account = { ...a, url: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${settings.meta.adAccountId.replace(/^act_/, "")}` };
    const issues: string[] = [];
    if (!a.hasPaymentMethod) issues.push("The ad account has no payment method: drafts can be created, but nothing can be published until one is added.");
    if (a.accountStatus !== 1) issues.push(`The ad account isn't active (status ${a.accountStatus}).`);
    const writes = adAccountRefusal(settings.meta.adAccountId, Deno.env.get("META_ALLOWED_AD_ACCOUNTS"), true);
    if (writes) issues.push(writes);
    for (const [key, id] of [["testing", settings.testing_adset_id], ["scaling", settings.scaling_adset_id]] as const) {
      if (!id) continue;
      try { result[key] = { ...(await adSet(g, id)), url: adsManagerUrl(settings.meta.adAccountId, "adsets", [id]) }; }
      catch (error) { issues.push(`Couldn't read the ${key} ad set: ${explain(error)}`); }
    }
    result.issues = issues;
  } catch (error) {
    result.error = explain(error);
  }
  return result;
}

// MARK: Drafts

interface ItemInput { creative: CreativeInput; primaryText?: string; headline?: string; description?: string; cta?: string; hookType?: string; aiDisclosure?: "OPT_IN" | "OPT_OUT" }

/** Only https files from Supabase Storage (or hosts in LAUNCH_MEDIA_HOSTS) are uploaded. */
function mediaAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const hosts = [new URL(SUPABASE_URL).host, ...(Deno.env.get("LAUNCH_MEDIA_HOSTS") ?? "").split(",").map((h) => h.trim()).filter(Boolean)];
    return hosts.some((h) => u.host === h || u.host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * The picked creatives, read from the database by id: only the user's own, in this workspace, approved
 * and QA passed (or warned). The caller sends ids and edited copy, never a file address.
 */
async function itemsFor(settings: LaunchSettingsRow, raw: unknown): Promise<ItemInput[]> {
  if (!Array.isArray(raw) || !raw.length) throw new UserError("Pick at least one creative.");
  if (raw.length > MAX_ITEMS) throw new UserError(`At most ${MAX_ITEMS} creatives at a time.`);
  const picks = raw.map((r: any) => ({ id: String(r?.creativeId ?? r?.creative?.id ?? "").trim(), r: r ?? {} }));
  if (picks.some((p) => !UUID.test(p.id))) throw new UserError("A creative is missing its id.");
  const found = await creativesByIds(db, { userId: settings.user_id, productId: settings.product_id, ids: picks.map((p) => p.id) });
  return picks.map(({ id, r }) => {
    const stored = found.get(id);
    if (!stored) throw new UserError("One of the creatives isn't approved with a passing QA (or no longer exists).");
    if (!mediaAllowed(stored.url)) throw new UserError("Creatives must be files in this project's storage (https).");
    const creative: CreativeInput = { ...stored, thumbnailUrl: stored.thumbnailUrl && mediaAllowed(stored.thumbnailUrl) ? stored.thumbnailUrl : undefined };
    return {
      creative,
      primaryText: (r.primaryText ?? creative.primaryText ?? "").toString().trim().slice(0, 2000),
      headline: (r.headline ?? creative.headline ?? "").toString().trim().slice(0, 255),
      description: (r.description ?? creative.description ?? "").toString().trim().slice(0, 255),
      cta: (r.cta ?? creative.cta ?? "").toString().trim().slice(0, 40),
      aiDisclosure: r.aiDisclosure === "OPT_IN" || r.aiDisclosure === "OPT_OUT" ? r.aiDisclosure : undefined,
      hookType: r.hookType ? String(r.hookType).slice(0, 60) : creative.hookType,
    };
  });
}

/** Names every item with the convention, versions counted against the workspace's earlier drafts. */
async function nameItems(settings: LaunchSettingsRow, items: ItemInput[], stage: Stage) {
  const { data } = await db.from("launch_drafts").select("ad_name").eq("product_id", settings.product_id).neq("status", "cancelled");
  const used = ((data ?? []) as { ad_name: string }[]).map((r) => r.ad_name);
  const app = codeFor(settings);
  const date = day();
  return items.map((item) => {
    const format = item.creative.formatSlug ?? item.creative.formatCardId ?? "unformatted";
    const hook = item.hookType ?? "hook";
    const version = nextVersion(used, app, format, hook);
    const name = adName({ app, stage, format, hook, version, date });
    used.push(name);
    return { ...item, name };
  });
}

async function preview(user: string, input: Record<string, any>) {
  const settings = await settingsFor(user, input.productId);
  const items = await nameItems(settings, await itemsFor(settings, input.items), "TEST");
  const link = destination(settings);
  return {
    missing: missing(settings, "TEST"),
    drafts: items.map((i) => ({
      creativeId: i.creative.id,
      name: i.name,
      payloads: previewDraft(settings, { ad_name: i.name, primary_text: i.primaryText ?? "", headline: i.headline ?? "", cta: i.cta ?? "", link, adset_id: settings.testing_adset_id ?? "", creative: draftCreative(i) }),
    })),
  };
}

async function queueDrafts(user: string, input: Record<string, any>, source: DraftRow["source"] = "manual") {
  const settings = await settingsFor(user, input.productId);
  requireWritable(settings);
  await requireGraph();
  const gaps = missing(settings, "TEST");
  if (gaps.length) throw new UserError(gaps.join(" "));
  const items = await nameItems(settings, await itemsFor(settings, input.items), "TEST");
  for (const i of items) if (!i.primaryText || !i.headline) throw new UserError(`Add primary text and a headline for ${i.name}.`);
  return createJob(settings, items, source);
}

async function createJob(settings: LaunchSettingsRow, items: (ItemInput & { name: string })[], source: DraftRow["source"]) {
  const { data: job, error } = await db.from("launch_jobs").insert({ user_id: settings.user_id, product_id: settings.product_id }).select("id").single();
  if (error || !job) throw new Error(`Couldn't start the upload: ${error?.message}`);
  const link = destination(settings);
  const rows = items.map((i) => ({
    user_id: settings.user_id, product_id: settings.product_id, job_id: job.id, source, stage: "TEST",
    creative_ref: i.creative.id, creative: draftCreative(i), ad_name: i.name,
    primary_text: i.primaryText ?? "", headline: i.headline ?? "", cta: i.cta ?? "", link,
    adset_id: settings.testing_adset_id, status: "queued",
  }));
  const { data: drafts, error: draftError } = await db.from("launch_drafts").insert(rows).select("*");
  if (draftError) {
    await db.from("launch_jobs").update({ status: "error", error: draftError.message }).eq("id", job.id);
    throw new Error(`Couldn't save the drafts: ${draftError.message}`);
  }
  EdgeRuntime.waitUntil(wake(job.id));
  return { jobId: job.id, drafts };
}

// MARK: Send to Meta (sheet.ts)

/** What the sheet's routes need: the workspace's settings (read access checked), the database and the queue. */
async function sheetDeps(user: string, productId: unknown): Promise<SheetDeps> {
  const settings = await settingsFor(user, productId);
  const graph = await requireGraph();
  return {
    graph, settings, mediaAllowed,
    allowWrite: () => requireWritable(settings),
    creatives: async (ids) => {
      if (ids.some((id) => !UUID.test(id))) throw new UserError("A creative is missing its id.");
      return creativesByIds(db, { userId: settings.user_id, productId: settings.product_id, ids });
    },
    usedNames: async () => {
      const { data } = await db.from("launch_drafts").select("ad_name").eq("product_id", settings.product_id).neq("status", "cancelled");
      return ((data ?? []) as { ad_name: string }[]).map((r) => r.ad_name);
    },
    queue: (drafts) => queueSheetDrafts(settings, drafts),
  };
}

/** Saves the sheet's drafts (each with its ad set and spec) as one job and wakes the worker. */
async function queueSheetDrafts(settings: LaunchSettingsRow, drafts: NewDraft[]) {
  const { data: job, error } = await db.from("launch_jobs").insert({ user_id: settings.user_id, product_id: settings.product_id }).select("id").single();
  if (error || !job) throw new Error(`Couldn't start the upload: ${error?.message}`);
  const rows = drafts.map((d) => ({
    user_id: settings.user_id, product_id: settings.product_id, job_id: job.id, source: "manual", stage: d.stage,
    creative_ref: d.creative.id, creative: d.creative, ad_name: d.ad_name, primary_text: d.primary_text, headline: d.headline,
    cta: d.cta, link: d.link, adset_id: d.adset_id, status: "queued", spec: d.spec,
  }));
  const { data, error: draftError } = await db.from("launch_drafts").insert(rows).select("id, ad_name, status, adset_id, creative_ref");
  if (draftError) {
    await db.from("launch_jobs").update({ status: "error", error: draftError.message }).eq("id", job.id);
    throw new Error(`Couldn't save the drafts: ${draftError.message}. (Has migration 20261005910000_launch_drafts_spec.sql been applied?)`);
  }
  EdgeRuntime.waitUntil(wake(job.id));
  return { jobId: job.id as string, drafts: data ?? [] };
}

// MARK: Worker

async function wake(jobId: string) {
  const secret = (await keys()).worker;
  if (!secret) return advance(jobId);
  try {
    await fetch(`${FUNCTION_URL}/work`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-launch-worker": secret },
      body: JSON.stringify({ jobId }), signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // The watchdog picks the job up.
  }
}

async function download(url: string): Promise<Uint8Array> {
  if (!mediaAllowed(url)) throw new Error("That file isn't in this project's storage.");
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Couldn't download the creative (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

async function advance(jobId: string) {
  if (!UUID.test(jobId)) return;
  const { data } = await db.rpc("launch_claim_job", { p_job: jobId, p_seconds: LEASE_SECONDS });
  const job = (data as { id: string; user_id: string; product_id: string; wakes: number }[] | null)?.[0];
  if (!job) return;
  const deadline = Date.now() + SLICE_MS;
  try {
    if (job.wakes > 200) throw new UserError("The upload took too long and was stopped.");
    const g = await requireGraph();
    const { data: s } = await db.from("launch_settings").select("*").eq("product_id", job.product_id).eq("user_id", job.user_id).single();
    const settings = s as LaunchSettingsRow;
    if (!settings) throw new UserError("This workspace's Launch settings are gone.");
    settings.meta ??= {};
    requireWritable(settings);
    for (;;) {
      const { data: rows } = await db.from("launch_drafts").select("*").eq("job_id", job.id).not("status", "in", `(${TERMINAL.join(",")})`);
      const open = (rows ?? []) as DraftRow[];
      if (!open.length) {
        await db.from("launch_jobs").update({ status: "done", lease_until: null }).eq("id", job.id);
        return;
      }
      for (const draft of due(open)) {
        const patch = await stepDraft(draft, { graph: g, settings, download });
        if (Object.keys(patch).length) await db.from("launch_drafts").update(patch).eq("id", draft.id).eq("status", draft.status);
        if (Date.now() > deadline) break;
      }
      const { data: alive } = await db.from("launch_jobs").update({ lease_until: inSeconds(LEASE_SECONDS) }).eq("id", job.id).eq("status", "running").select("id");
      if (!alive?.length) return;
      if (Date.now() > deadline) {
        await db.from("launch_jobs").update({ lease_until: null }).eq("id", job.id).eq("status", "running");
        await wake(job.id);
        return;
      }
      await sleep(3_000);
    }
  } catch (error) {
    const message = error instanceof UserError ? error.message : `Something went wrong: ${errorText(error)}`;
    console.error(job.id, error);
    await db.from("launch_jobs").update({ status: "error", error: message, lease_until: null }).eq("id", job.id);
    await db.from("launch_drafts").update({ status: "error", error: message }).eq("job_id", job.id).in("status", ["queued", "processing", "creating"]);
  }
}

// MARK: Setup (paused campaigns and ad sets)

async function setup(user: string, input: Record<string, any>) {
  const settings = await settingsFor(user, input.productId);
  const stages = (Array.isArray(input.stages) ? input.stages : ["TEST", "SCALE"]).filter((s: string) => s === "TEST" || s === "SCALE") as Stage[];
  const gaps = missing(settings, "TEST").filter((m) => !m.includes("ad set"));
  if (gaps.length) throw new UserError(gaps.join(" "));
  const g = await requireGraph();
  const currency = (await account(g, settings.meta.adAccountId!)).currency;
  const cap = settings.max_daily_budget;
  const plans = stages.map((stage) => {
    const dailyBudget = Number(stage === "TEST" ? settings.testing_daily_budget : settings.scaling_daily_budget);
    if (!dailyBudget || dailyBudget <= 0) throw new UserError(`Set the ${stage === "TEST" ? "testing" : "scaling"} daily budget first.`);
    if (cap != null && dailyBudget > cap) throw new UserError(`The ${stage === "TEST" ? "testing" : "scaling"} budget is over the ${cap} ${currency} guardrail.`);
    const s: StructureInput = { settings, stage, app: codeFor(settings), date: day(), currency, dailyBudget };
    return { stage, input: s, campaign: campaignPayload(s), adSet: adSetPayload(s, "<campaign id>") };
  });
  if (input.confirm !== true) return { plan: plans.map(({ stage, campaign, adSet }) => ({ stage, campaign, adSet })), currency };
  requireWritable(settings);
  const created: Record<string, { campaignId: string; adSetId: string; url: string }> = {};
  for (const p of plans) {
    const ids = await createStructure(g, p.input);
    created[p.stage] = { ...ids, url: adsManagerUrl(settings.meta.adAccountId!, "campaigns", [ids.campaignId]) };
    const patch = p.stage === "TEST"
      ? { testing_campaign_id: ids.campaignId, testing_adset_id: ids.adSetId }
      : { scaling_campaign_id: ids.campaignId, scaling_adset_id: ids.adSetId };
    await db.from("launch_settings").update(patch).eq("product_id", settings.product_id).eq("user_id", user);
  }
  return { created };
}

// MARK: Promote and pause

async function adInfo(g: Graph, adId: string) {
  if (!/^\d{5,25}$/.test(adId)) throw new HttpError(400, "Which ad?");
  return g.get<{ id: string; name: string; adset_id: string; account_id: string; status: string }>(adId, { fields: "id,name,adset_id,account_id,status" });
}

async function promote(user: string, input: Record<string, any>) {
  const settings = await settingsFor(user, input.productId);
  if (!settings.scaling_adset_id) throw new UserError("Choose (or create) the scaling ad set first.");
  requireWritable(settings);
  const g = await requireGraph();
  const ad = await adInfo(g, String(input.adId ?? ""));
  if (ad.adset_id !== settings.testing_adset_id) throw new UserError("Only ads in the testing ad set can be promoted.");
  const name = parseAdName(ad.name) ? withStage(ad.name, "SCALE") : `${codeFor(settings)} | SCALE | ${slug(ad.name)}`;
  const { data: existing } = await db.from("launch_drafts").select("ad_id").eq("product_id", settings.product_id).eq("promoted_from_ad_id", ad.id).eq("status", "draft").maybeSingle();
  if (existing?.ad_id) return { adId: existing.ad_id, already: true, url: adsManagerUrl(settings.meta.adAccountId!, "ads", [existing.ad_id]) };
  const copyId = await copyAd(g, ad.id, settings.scaling_adset_id, name);
  const { data: original } = await db.from("launch_drafts").select("*").eq("product_id", settings.product_id).eq("ad_id", ad.id).maybeSingle();
  await db.from("launch_drafts").insert({
    user_id: user, product_id: settings.product_id, source: "promotion", stage: "SCALE",
    creative_ref: original?.creative_ref ?? `meta:${ad.id}`, creative: original?.creative ?? { id: `meta:${ad.id}`, url: "", kind: "video" },
    ad_name: name, primary_text: original?.primary_text ?? "", headline: original?.headline ?? "", cta: original?.cta ?? "", link: original?.link ?? destination(settings),
    adset_id: settings.scaling_adset_id, status: "draft", ad_id: copyId, meta_creative_id: original?.meta_creative_id ?? null, promoted_from_ad_id: ad.id,
    reason: input.reason ? String(input.reason).slice(0, 1000) : null,
  });
  return { adId: copyId, name, url: adsManagerUrl(settings.meta.adAccountId!, "ads", [copyId]) };
}

async function pause(user: string, input: Record<string, any>) {
  const settings = await settingsFor(user, input.productId);
  requireWritable(settings);
  const g = await requireGraph();
  const ad = await adInfo(g, String(input.adId ?? ""));
  if (![settings.testing_adset_id, settings.scaling_adset_id].includes(ad.adset_id)) throw new UserError("Launch only pauses ads in this workspace's testing or scaling ad set.");
  await pauseAd(g, ad.id);
  return { paused: ad.id, url: adsManagerUrl(settings.meta.adAccountId!, "ads", [ad.id]) };
}

// MARK: Daily automation

async function daily() {
  const { data } = await db.from("launch_settings").select("*").eq("automation_enabled", true);
  const results: { productId: string; queued: number; notes: string[] }[] = [];
  const g = await graph();
  for (const settings of (data ?? []) as LaunchSettingsRow[]) {
    settings.meta ??= {};
    let notes: string[] = [];
    let queued = 0;
    try {
      if (!g) throw new UserError("Meta isn't connected.");
      const owner = await ownerAllowed(settings.user_id);
      if (owner) throw new UserError(owner);
      requireWritable(settings);
      const since = `${day()}T00:00:00Z`;
      const [{ data: drafts }, { count }] = await Promise.all([
        db.from("launch_drafts").select("creative_ref").eq("product_id", settings.product_id).not("status", "in", "(error,cancelled)"),
        db.from("launch_drafts").select("id", { count: "exact", head: true }).eq("product_id", settings.product_id).eq("source", "automation").gte("created_at", since),
      ]);
      const [creatives, currency, testing] = await Promise.all([
        approvedCreatives(db, settings.product_id, settings.user_id),
        settings.meta.adAccountId ? account(g, settings.meta.adAccountId).then((a) => a.currency) : Promise.resolve("USD"),
        settings.testing_adset_id ? adSet(g, settings.testing_adset_id).catch(() => null) : Promise.resolve(null),
      ]);
      const plan = planDaily({
        settings, creatives: creatives.filter((c) => mediaAllowed(c.url)),
        launched: new Set(((drafts ?? []) as { creative_ref: string }[]).map((d) => d.creative_ref)),
        queuedToday: count ?? 0, testingAdSet: testing, currency,
      });
      notes = plan.notes;
      const items = plan.picks
        .map((c) => ({ creative: c, primaryText: (c.primaryText ?? "").slice(0, 2000), headline: (c.headline ?? "").slice(0, 255), description: c.description, cta: c.cta ?? settings.default_cta ?? "", hookType: c.hookType }))
        .filter((i) => {
          if (i.primaryText && i.headline) return true;
          notes.push(`Skipped ${i.creative.id}: no primary text or headline.`);
          return false;
        });
      if (items.length) {
        await createJob(settings, await nameItems(settings, items, "TEST"), "automation");
        queued = items.length;
      }
    } catch (error) {
      notes = [error instanceof UserError ? error.message : explain(error)];
    }
    await db.from("launch_settings").update({ automation_last_run_at: new Date().toISOString(), automation_last_note: [`Queued ${queued}.`, ...notes].join(" ").slice(0, 1000) }).eq("product_id", settings.product_id);
    results.push({ productId: settings.product_id, queued, notes });
  }
  return { ran: results.length, connected: Boolean(g), results };
}
