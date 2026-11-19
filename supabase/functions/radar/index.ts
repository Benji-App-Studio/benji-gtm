// The analysis backend. The studio (Next.js on Vercel) calls this for everything that needs an API key:
// the onboarding intake, competitor discovery and analysis runs. Discovery and runs are resumable
// jobs: the worker advances a job in short slices (starting Apify scrapes in parallel, polling them
// every couple of seconds, decoding with the AI judge, saving the report), holding a lease so only one worker
// touches a job at a time, and hands over to a fresh invocation before the platform's time limit.
// A pg_cron watchdog wakes any job whose worker stopped. Progress goes to the database as it
// happens, and Realtime streams it to the browser. Users only read `runs`; every write to it is made
// here as the service role (runs, deleting a run from history).
import { createClient } from "@supabase/supabase-js";
import { apifyClient, ApifyError, isActive, type Apify } from "./engine/apify.ts";
import { buildReport } from "./engine/build.ts";
import { ACTORS } from "./engine/collectors.ts";
import { attachComments } from "./engine/comments.ts";
import { decoder } from "./engine/decode.ts";
import {
  instagramCandidates, instagramSearchInput, judge, known, merge, openAICandidates, openAIRequest, preselect, shortlist,
  tiktokCandidates, tiktokSearchInput,
} from "./engine/discover.ts";
import { LIBRARY } from "./engine/formats.ts";
import { runIntake } from "./engine/intake.ts";
import { pollSearch, type SearchState } from "./engine/openai_search.ts";
import { RUN_LIMIT_MS, scrapeLimits } from "./engine/run_limits.ts";
import { bioCandidates, bioDeclares, campaignKeeps, INSTAGRAM_SCRAPER, judgeBios, partnerPrograms, profileFrom, profilesInput } from "./engine/partners.ts";
import { assemble, nicheInstagramBest, planCollection, planComments, planNicheDetail, planPartnerDetail, reelsFrom, signalPosts, type ScrapeSpec } from "./engine/project.ts";
import { accountError, type AiProvider, JudgeError } from "../_shared/ai/judge.ts";
import { modelOverrides, resolveModels } from "../_shared/ai/models.ts";
import { createJudge, judgeAvailability } from "../_shared/ai/provider.ts";
import { createAuth, HttpError } from "../_shared/auth.ts";
import { addKeyMessage, createKeys, sameSecret } from "../_shared/keys.ts";
import { resolveLimits, workerLeaseSeconds, workWindowMs } from "../_shared/limits.ts";
import { clean, PLATFORMS, type Candidate, type Decoded, type DiscoveryProject, type PartnerConfig, type Platform, type Profile, type ProjectWorkflow, type Reel } from "./engine/types.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/radar`;

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

/**
 * One worker slice: then the job is handed to a fresh invocation, well inside the platform's time limit
 * (half of it at most: _shared/limits.ts, from the install's Settings).
 */
const SLICE_MS = 75_000;
/** How often a waiting worker checks its Apify runs and OpenAI request. */
const POLL_MS = 2_000;
/** A scrape that can't start (Apify busy) or doesn't finish in these times is given up on. */
const QUEUE_LIMIT_MS = 15 * 60_000;
const NICHE_TOP = 40;
const COMMENTS = { top: 20, perPost: 25 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 400);

/** A failure the user should read as is. */
class UserError extends Error {}

// MARK: Keys and callers

/** Every key comes from the shared reader (edge function secret first, then Vault; the worker secret Vault only). */
const secrets = createKeys(db);
const auth = createAuth(db);

const SECRET_NAMES = ["APIFY_TOKEN", "OPENAI_API_KEY", "RADAR_WORKER_SECRET"] as const;
type Keys = Partial<Record<(typeof SECRET_NAMES)[number], string>>;

/** The keys this function uses, as one object. */
async function keys(): Promise<Keys> {
  const found: Keys = {};
  for (const name of SECRET_NAMES) {
    const value = await secrets.get(name);
    if (value) found[name] = value;
  }
  return found;
}

/** The install's settings; undefined on an install from before setup existed (no install row). */
const installSettings = async () => (await auth.install())?.settings;

/** What decides which AI answers: the keys and the install's settings (_shared/ai/provider.ts). */
const aiChoice = async () => ({ keys: secrets, settings: await installSettings() });

/** The judge for this install: OpenAI, or TypeSafe when Settings choose it. A missing key reads as it is. */
async function aiJudge() {
  try {
    return await createJudge(await aiChoice());
  } catch (error) {
    if (error instanceof JudgeError && error.kind === "config") throw new UserError(error.message);
    throw error;
  }
}

/** Stops with what to add when no AI key is set, before a job is started that would need one. */
async function requireAi() {
  const ai = await judgeAvailability(await aiChoice());
  if (!ai.ok) throw new UserError(ai.message);
}

/** The model for each step: an environment variable or stored key, else Settings > Models, else the default. */
const models = async () => resolveModels((await installSettings())?.models, await modelOverrides(secrets));

/** The plan's limits (Settings, environment overrides): _shared/limits.ts. */
const planLimits = async () => resolveLimits(await auth.install(), (name) => Deno.env.get(name));

// MARK: HTTP

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/** The signed-in caller's user id; 403 unless this install lets them in. */
async function signedInUser(req: Request): Promise<string> {
  return (await auth.member(req)).id;
}

async function requireWorker(req: Request) {
  const secret = await secrets.get("RADAR_WORKER_SECRET");
  const given = req.headers.get("x-radar-worker") ?? "";
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
      case "health": return json(await health());
      case "intake": return json(await intake(await signedInUser(req), await body(req)));
      case "discover": return json(await discover(await signedInUser(req), String((await body(req)).projectId ?? "")));
      case "analyze": return json(await analyze(await signedInUser(req), String((await body(req)).projectId ?? "")));
      case "cancel": return json(await cancel(await signedInUser(req), String((await body(req)).projectId ?? "")));
      case "delete-run": return json(await deleteRun(await signedInUser(req), String((await body(req)).runId ?? "")));
      case "work": {
        await requireWorker(req);
        const jobId = String((await body(req)).jobId ?? "");
        EdgeRuntime.waitUntil(advance(jobId));
        return json({ accepted: true }, 202);
      }
      case "tick": {
        await requireWorker(req);
        const { data } = await db.rpc("radar_idle_jobs");
        await Promise.all(((data ?? []) as string[]).map((id) => wake(id)));
        return json({ woken: (data ?? []).length }, 202);
      }
      default: return json({ error: "Not found" }, 404);
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    const message = readable(error);
    if (message) return json({ error: message }, 400);
    console.error(error);
    return json({ error: `Something went wrong: ${errorText(error)}` }, 500);
  }
});

/**
 * An error the person should read as it is: ours, Apify's, or the AI's when its key is missing or
 * refused ("OpenAI refused the key: … Check Settings > API keys."). Null for anything else.
 */
function readable(error: unknown): string | null {
  if (error instanceof UserError || error instanceof ApifyError) return error.message;
  if (error instanceof JudgeError && error.kind === "config") return error.message;
  return accountError(error)?.message ?? null;
}

async function health() {
  const set = await secrets.flags(["APIFY_TOKEN", "OPENAI_API_KEY", "RADAR_WORKER_SECRET"]);
  const ai = await judgeAvailability(await aiChoice());
  // `typesafe` is the name the app has always read for "the AI that checks competitors and reads posts
  // is connected": true with an OpenAI key, or a TypeSafe key when that provider is chosen.
  return { typesafe: ai.ok, apify: set.APIFY_TOKEN, openai: set.OPENAI_API_KEY, worker: set.RADAR_WORKER_SECRET, ai: ai.ok, aiProvider: ai.ok ? ai.provider : null };
}

// MARK: Intake

async function intake(_user: string, input: Record<string, any>) {
  const name = String(input.name ?? "").trim().slice(0, 120);
  const description = String(input.description ?? "").trim().slice(0, 2000);
  if (!name || description.length < 10) throw new UserError("Add the product's name and a sentence about it.");
  return runIntake(await aiJudge(), {
    name, description,
    website: input.website ? String(input.website).slice(0, 300) : undefined,
    kind: input.kind ? String(input.kind).slice(0, 40) : undefined,
  });
}

// MARK: Starting work

interface ProjectRow {
  id: string; user_id: string; product_id: string | null; type: "competitors" | "account" | "campaign"; name: string; description: string;
  settings: { platforms: Platform[]; sinceDays: number; limitPerAccount: number; keywords?: string[]; includeNiche?: boolean; readComments?: boolean; audience?: string; brand?: string; mentions?: string[]; category?: string; answers?: Record<string, string>; website?: string; partners?: boolean; brandInstagram?: string };
  candidates: Candidate[]; status: string; demo: boolean;
}

async function ownProject(user: string, projectId: string): Promise<ProjectRow> {
  if (!/^[0-9a-f-]{36}$/.test(projectId)) throw new HttpError(400, "Which project?");
  const { data } = await db.from("projects").select("*").eq("id", projectId).eq("user_id", user).maybeSingle();
  if (!data) throw new HttpError(404, "This project doesn't exist.");
  return data as ProjectRow;
}

async function activity(project: { id: string; user_id: string }, message: string, level: "info" | "warn" | "error" | "done" = "info", runId: string | null = null) {
  await db.from("activity").insert({ user_id: project.user_id, project_id: project.id, run_id: runId, level, message: message.slice(0, 500) });
}

/** Stops whatever is running for a project (a newer request replaces it, or the user pressed Stop). */
async function stopJobs(projectId: string, reason: string) {
  const { data } = await db.from("jobs").update({ status: "cancelled", lease_until: null }).eq("project_id", projectId).eq("status", "running").select("kind, run_id, state");
  const apifyToken = (await keys()).APIFY_TOKEN;
  const apify = apifyToken ? apifyClient(apifyToken) : null;
  for (const job of data ?? []) {
    for (const task of ((job.state as { tasks?: Task[] }).tasks ?? [])) if (apify && task.status === "running" && task.runId) await apify.abort(task.runId);
    if (job.run_id) await db.from("runs").update({ status: "error", phase: "error", message: reason, finished_at: new Date().toISOString() }).eq("id", job.run_id).eq("status", "running");
  }
  return (data ?? []) as { kind: string; run_id: string | null }[];
}

async function discover(user: string, projectId: string) {
  const row = await ownProject(user, projectId);
  if (row.type !== "competitors") throw new UserError("Only competitor projects search for competitors.");
  const k = await keys();
  await requireAi();
  const { data: product } = row.product_id ? await db.from("products").select("*").eq("id", row.product_id).maybeSingle() : { data: null };
  const knownList: string[] = product?.known_competitors ?? [];
  if (!k.APIFY_TOKEN && !k.OPENAI_API_KEY && !knownList.length) {
    throw new UserError("Finding competitors needs Apify or OpenAI. Add your Apify token or your OpenAI key in Settings > API keys, or add competitors you know to your product.");
  }
  await stopJobs(row.id, "Replaced by a new search.");
  const answers: Record<string, string> = {
    ...(row.settings.answers ?? {}),
    ...(product ? {
      audience: product.audience ?? "", price: product.price_tier ?? "", salesChannel: product.sales_channel ?? "", region: product.region ?? "",
      stage: product.stage ?? "", knownCompetitors: knownList.join(", "), ...product.answers,
    } : {}),
  };
  const project: DiscoveryProject = {
    name: row.name, description: row.description, website: row.settings.website ?? product?.website ?? undefined,
    category: row.settings.category ?? product?.category ?? "other", answers, keywords: (row.settings.keywords ?? []).slice(0, 8), platforms: row.settings.platforms,
  };
  const state: DiscoverState = { stage: "search", project, tasks: [], apifyUsd: 0, jevTokens: 0 };
  const { data: job, error } = await db.from("jobs").insert({ user_id: user, project_id: row.id, kind: "discover", state }).select("id").single();
  if (error || !job) throw new Error(error?.message ?? "Couldn't start the search.");
  await db.from("projects").update({ status: "discovering", message: "Finding competitors…" }).eq("id", row.id);
  await activity(row, "Looking for your competitors");
  EdgeRuntime.waitUntil(wake(job.id));
  return { jobId: job.id };
}

async function analyze(user: string, projectId: string) {
  const row = await ownProject(user, projectId);
  if (row.demo) throw new UserError("The demo can't be run again.");
  const k = await keys();
  await requireAi();
  if (!k.APIFY_TOKEN) throw new UserError(`Apify isn't connected. ${addKeyMessage("APIFY_TOKEN")}`);
  const s = row.settings;
  const chosen = row.candidates.filter((c) => c.selected);
  const niche = row.type === "competitors" && Boolean(s.keywords?.length) && (Boolean(s.includeNiche) || !chosen.length);
  const competitors = chosen.map((c) => ({ name: c.name, ...c.handles }));
  const usable = competitors.filter((c) => s.platforms.some((p) => (c as Record<string, unknown>)[p]));
  // Partnership detection: a campaign's brand, or every chosen competitor with an Instagram handle.
  const partners: PartnerConfig | undefined = !s.partners ? undefined
    : row.type === "campaign" ? (s.brandInstagram ? { brands: [{ name: s.brand ?? row.name, instagram: clean(s.brandInstagram) }], tagged: 60, ownPosts: 30, bios: 40, detail: 20 } : undefined)
    : row.type === "competitors" ? { brands: usable.filter((c) => c.instagram).map((c) => ({ name: c.name, instagram: clean(c.instagram!) })), tagged: 30, ownPosts: 0, bios: 40, detail: 10 }
    : undefined;
  const findsCreators = Boolean(partners?.brands.length);
  if (!usable.length && !niche && !(row.type === "campaign" && findsCreators)) {
    throw new UserError(competitors.length ? "None of the chosen accounts has a handle on the selected channels." : row.type === "campaign" ? "Add a creator, or turn on “Find the brand's creators” with the brand's Instagram handle." : "Pick at least one account to analyse.");
  }
  await stopJobs(row.id, "Replaced by a newer run.");
  const workflow: ProjectWorkflow = {
    mode: "project", title: row.name, product: row.name, productDescription: row.description, platforms: s.platforms, transcripts: true,
    competitors: usable, sinceDays: s.sinceDays, limitPerAccount: s.limitPerAccount,
    accountNoun: row.type === "campaign" ? "creator" : row.type === "account" ? "account" : "competitor",
    ...(row.type === "campaign" ? { brand: s.brand, mentions: s.mentions } : {}),
    ...(niche ? { keywords: s.keywords, nicheTop: NICHE_TOP, audience: s.audience } : {}),
    ...(s.readComments !== false ? { comments: COMMENTS } : {}),
    ...(findsCreators ? { partners } : {}),
  };
  const { data: run, error } = await db.from("runs").insert({
    project_id: row.id, user_id: user, status: "running", phase: "collecting", message: "Starting…", settings: s,
    competitors: usable.map((c) => ({ name: c.name })), progress: { stage: "collect", steps: [] },
  }).select().single();
  if (error || !run) throw new Error(error?.message ?? "Couldn't start the run.");
  const state: RunState = { stage: "collect", workflow, tasks: [], apifyUsd: 0, jevTokens: 0, startedAt: new Date().toISOString(), skipped: [] };
  const { data: job, error: jobError } = await db.from("jobs").insert({ user_id: user, project_id: row.id, run_id: run.id, kind: "run", state }).select("id").single();
  if (jobError || !job) throw new Error(jobError?.message ?? "Couldn't start the run.");
  await db.from("projects").update({ status: "analyzing", message: "Collecting posts…" }).eq("id", row.id);
  await activity(row, `Run started: ${usable.length ? `${usable.length} ${row.type === "campaign" ? "creators" : "accounts"}` : "your niche"}${niche && usable.length ? " and your niche" : ""} on ${s.platforms.length} channel${s.platforms.length === 1 ? "" : "s"}`, "info", run.id);
  EdgeRuntime.waitUntil(wake(job.id));
  return { run };
}

async function cancel(user: string, projectId: string) {
  const row = await ownProject(user, projectId);
  const running = await stopJobs(row.id, "Stopped.");
  const { count } = await db.from("runs").select("id", { count: "exact", head: true }).eq("project_id", row.id).eq("status", "done");
  const discovering = running.some((job) => job.kind === "discover");
  const status = count ? "ready" : "review";
  await db.from("projects").update({ status, message: discovering ? "Search stopped. Add competitors yourself or search again." : null }).eq("id", row.id);
  await activity(row, "Stopped", "warn");
  return { status };
}

// MARK: Runs the studio asks for (users only read `runs`; every write is here, as the service role)

/** Removes one of the user's runs from history (not while it runs); its report and jobs go with it. */
async function deleteRun(user: string, runId: string) {
  if (!/^[0-9a-f-]{36}$/.test(runId)) throw new HttpError(400, "Which run?");
  const { data: run } = await db.from("runs").select("id, status").eq("id", runId).eq("user_id", user).maybeSingle();
  if (!run) throw new HttpError(404, "Not found");
  if (run.status === "running") throw new HttpError(409, "This run is still going. Stop it first.");
  const { error } = await db.from("runs").delete().eq("id", run.id).eq("user_id", user);
  if (error) throw new Error(error.message);
  return { deleted: true };
}

// MARK: Worker

interface Task {
  key: string; actor: string; input: unknown; label: string; platform?: Platform; account?: string; keyword?: string; postIds?: string[];
  status: "pending" | "running" | "done" | "failed";
  runId?: string; usd: number; error?: string; count?: number; queuedAt: string; startedAt?: string;
}

interface RunState {
  stage: "collect" | "expand" | "comments" | "decode" | "finish";
  workflow: ProjectWorkflow; tasks: Task[]; apifyUsd: number; jevTokens: number; startedAt: string;
  collectedAt?: string; total?: number; decoded?: number; skipped: string[]; decodeError?: string;
}

interface DiscoverState {
  stage: "search" | "judge";
  project: DiscoveryProject; tasks: Task[]; apifyUsd: number; jevTokens: number;
  openai?: SearchState;
}

interface JobRow { id: string; user_id: string; project_id: string; run_id: string | null; kind: "discover" | "run"; state: RunState | DiscoverState; wakes: number; crashes: number }

const toTask = (spec: Omit<ScrapeSpec, "platform"> & { platform?: Platform; postIds?: string[] }): Task =>
  ({ ...spec, status: "pending", usd: 0, queuedAt: new Date().toISOString() });

/** Asks a fresh invocation to advance a job (or, without a worker secret, advances it here). */
async function wake(jobId: string) {
  const secret = (await keys()).RADAR_WORKER_SECRET;
  if (!secret) return advance(jobId);
  try {
    await fetch(`${FUNCTION_URL}/work`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-radar-worker": secret },
      body: JSON.stringify({ jobId }), signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // The watchdog will pick the job up within seconds.
  }
}

class Job {
  readonly id: string;
  readonly deadline: number;
  cancelled = false;
  /** The worker's lease: the whole wall clock plus a margin (_shared/limits.ts workerLeaseSeconds), never shorter than a slow step. */
  constructor(readonly row: JobRow, slice = SLICE_MS, readonly leaseSeconds = 180) { this.id = row.id; this.deadline = Date.now() + slice; }
  get state() { return this.row.state; }
  get project() { return { id: this.row.project_id, user_id: this.row.user_id }; }

  /** Saves the state and renews the lease. False once the job was cancelled or replaced. */
  async save(): Promise<boolean> {
    const { data } = await db.from("jobs").update({ state: this.state, lease_until: inSeconds(this.leaseSeconds) }).eq("id", this.id).eq("status", "running").select("id");
    if (!data?.length) this.cancelled = true;
    return !this.cancelled;
  }
  async release() { await db.from("jobs").update({ state: this.state, lease_until: null }).eq("id", this.id).eq("status", "running"); }
  async log(message: string, level: "info" | "warn" | "error" | "done" = "info") { await activity(this.project, message, level, this.row.run_id); }
  async put(name: string, data: unknown) {
    const { error } = await db.from("job_data").upsert({ job_id: this.id, name, data });
    if (error) throw new Error(`Couldn't save ${name}: ${error.message}`);
  }
  async get<T>(name: string): Promise<T | null> {
    const { data } = await db.from("job_data").select("data").eq("job_id", this.id).eq("name", name).maybeSingle();
    return (data?.data as T) ?? null;
  }
  async outputs<T>(prefix: string): Promise<Record<string, T>> {
    const { data } = await db.from("job_data").select("name, data").eq("job_id", this.id).like("name", `${prefix}%`);
    return Object.fromEntries((data ?? []).map((row) => [row.name.slice(prefix.length), row.data as T]));
  }
  async finish() {
    await db.from("jobs").update({ status: "done", state: this.state, lease_until: null }).eq("id", this.id);
    await db.from("job_data").delete().eq("job_id", this.id);
  }
}

async function advance(jobId: string) {
  if (!/^[0-9a-f-]{36}$/.test(jobId)) return;
  const limits = await planLimits();
  const lease = workerLeaseSeconds(limits);
  const { data } = await db.rpc("radar_claim_job", { p_job: jobId, p_seconds: lease });
  const row = (data as JobRow[] | null)?.[0];
  if (!row) return;
  const job = new Job(row, workWindowMs(limits, SLICE_MS), lease);
  try {
    // A worker that died three times in a row on the same step, or a job that never ends, stops here.
    if (row.crashes >= 3) throw new UserError("This step kept stopping the worker, so the run was stopped. Try fewer accounts or a shorter time frame.");
    if (row.wakes > 150) throw new UserError("This run took too long and was stopped. Try again.");
    for (;;) {
      const outcome = row.kind === "run" ? await stepRun(job) : await stepDiscover(job);
      if (outcome === "done" || job.cancelled) return;
      if (!(await job.save())) return;
      if (Date.now() > job.deadline) {
        await job.release();
        await wake(job.id);
        return;
      }
      if (outcome === "wait") await sleep(POLL_MS);
    }
  } catch (error) {
    await failJob(job, error);
  }
}

async function failJob(job: Job, error: unknown) {
  const message = readable(error) ?? `Something went wrong: ${errorText(error)}`;
  console.error(job.id, error);
  const { data } = await db.from("jobs").update({ status: "error", error: message, lease_until: null, state: job.state }).eq("id", job.id).eq("status", "running").select("id");
  if (!data?.length) return; // Cancelled meanwhile: nothing to report.
  const apifyToken = (await keys()).APIFY_TOKEN;
  if (apifyToken) for (const task of job.state.tasks) if (task.status === "running" && task.runId) await apifyClient(apifyToken).abort(task.runId);
  if (job.row.run_id) {
    await db.from("runs").update({ status: "error", phase: "error", message, finished_at: new Date().toISOString() }).eq("id", job.row.run_id);
  }
  await db.from("projects").update({ status: "error", message }).eq("id", job.row.project_id);
  await job.log(message, "error");
}

/**
 * Moves every unfinished scrape along: starts pending ones (waiting while Apify is busy), checks
 * running ones, and stores the results of finished ones. True when none is left unfinished.
 */
async function pump(job: Job, apify: Apify | null, store: (task: Task, items: any[]) => Promise<number>, onChange: () => Promise<void>): Promise<boolean> {
  const state = job.state;
  const open = state.tasks.filter((t) => t.status === "pending" || t.status === "running");
  if (!open.length) return true;
  let changed = false;
  const failTask = async (task: Task, reason: string) => {
    task.status = "failed";
    task.error = reason;
    changed = true;
    await job.log(`${task.label}: ${reason}`, "warn");
  };
  await Promise.all(open.map(async (task) => {
    if (!apify) return failTask(task, `Apify isn't connected. ${addKeyMessage("APIFY_TOKEN")}`);
    try {
      if (task.status === "pending") {
        if (Date.now() - Date.parse(task.queuedAt) > QUEUE_LIMIT_MS) return failTask(task, "Apify stayed busy for 15 minutes.");
        // With a timeout and a charge cap, so a run nobody watches any more still ends (engine/run_limits.ts).
        const run = await apify.start(task.actor, task.input, scrapeLimits(task));
        Object.assign(task, { status: "running", runId: run.id, startedAt: new Date().toISOString() });
        changed = true;
        return;
      }
      const run = await apify.get(task.runId!);
      if (isActive(run.status)) {
        if (Date.now() - Date.parse(task.startedAt!) > RUN_LIMIT_MS) {
          await apify.abort(run.id);
          return failTask(task, "took longer than 25 minutes, so it was stopped.");
        }
        return;
      }
      task.usd = Number(run.usageTotalUsd ?? 0);
      state.apifyUsd = state.tasks.reduce((sum, t) => sum + (t.usd ?? 0), 0);
      if (run.status !== "SUCCEEDED") return failTask(task, `the scrape ${run.status.toLowerCase().replace(/-/g, " ")}${run.statusMessage ? ` (${run.statusMessage.slice(0, 160)})` : ""}.`);
      const items = await apify.items(run.defaultDatasetId);
      task.count = await store(task, items);
      task.status = "done";
      changed = true;
    } catch (error) {
      // Busy or a network blip: try again on the next poll. Anything else fails this scrape only.
      if (error instanceof ApifyError && error.retryable) return;
      await failTask(task, errorText(error));
    }
  }));
  if (changed) await onChange();
  return state.tasks.every((t) => t.status === "done" || t.status === "failed");
}

// MARK: Analysis runs

const PLATFORM_NAME: Record<Platform, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", x: "X", linkedin: "LinkedIn" };

async function publishRun(job: Job, message: string, phase = "collecting") {
  const s = job.state as RunState;
  const steps = s.tasks.map((t) => ({ key: t.key, label: t.label, status: t.status, count: t.count ?? null, error: t.error ?? null }));
  await db.from("runs").update({
    phase, message, apify_usd: s.apifyUsd, jev_tokens: s.jevTokens,
    progress: { stage: s.stage, steps, total: s.total ?? null, decoded: s.decoded ?? 0, apifyUsd: s.apifyUsd },
  }).eq("id", job.row.run_id!);
  await db.from("projects").update({ message }).eq("id", job.row.project_id);
}

function collectingMessage(s: RunState) {
  const scrapes = s.tasks.filter((t) => !t.key.startsWith("comments"));
  const done = scrapes.filter((t) => t.status === "done" || t.status === "failed").length;
  return `Collecting posts · ${done} of ${scrapes.length} scrapes done`;
}

async function stepRun(job: Job): Promise<"continue" | "wait" | "done"> {
  const s = job.state as RunState;
  const w = s.workflow;
  const token = (await keys()).APIFY_TOKEN;
  const apify = token ? apifyClient(token) : null;
  const storeScrape = async (task: Task, items: any[]) => {
    if (task.key === "bios") {
      const profiles = items.flatMap((item) => profileFrom(item) ?? []);
      await job.put("profiles", profiles);
      return profiles.length;
    }
    if (task.key.startsWith("comments:")) {
      // Only what matching a comment to its post needs.
      const slim = items.map((i) => ({ text: i.text ?? i.comment ?? i.content, postUrl: i.postUrl, inputUrl: i.inputUrl, videoWebUrl: i.videoWebUrl, submittedVideoUrl: i.submittedVideoUrl, pageUrl: i.pageUrl, url: i.url, videoId: i.videoId, awemeId: i.awemeId }));
      await job.put(`out:${task.key}`, slim);
      return slim.length;
    }
    const reels = await reelsFrom(task, items, w);
    await job.put(`out:${task.key}`, reels);
    if (!task.key.endsWith("detail")) await job.log(`${task.label}: ${reels.length} post${reels.length === 1 ? "" : "s"}`);
    return reels.length;
  };

  switch (s.stage) {
    case "collect": {
      if (!s.tasks.length) {
        s.tasks = planCollection(w).map(toTask);
        if (!s.tasks.length) throw new UserError("Nothing to collect: none of the accounts has a handle on the selected channels.");
        await publishRun(job, collectingMessage(s));
      }
      if (!(await pump(job, apify, storeScrape, () => publishRun(job, collectingMessage(s))))) return "wait";
      const failed = s.tasks.filter((t) => t.status === "failed");
      if (failed.length === s.tasks.length) throw new UserError(failed[0].error?.replace(/^the scrape /, "The scrape ") ?? "Every scrape failed.");
      const outputs = await job.outputs<Reel[]>("out:");
      const best = nicheInstagramBest(w, outputs);
      await job.put("niche-ig-best", best);
      const detail = planNicheDetail(w, best);
      if (detail) s.tasks.push(toTask(detail));
      if (w.partners) {
        // Partner videos get transcripts; the creators found (and a campaign's own creators) get their bios read.
        const partnerDetail = planPartnerDetail(w, outputs);
        if (partnerDetail) s.tasks.push(toTask(partnerDetail));
        const typed = w.brand ? w.competitors.flatMap((c) => (c.instagram ? [c.instagram] : [])) : [];
        const candidates = bioCandidates(signalPosts(outputs), w.partners.brands, typed, w.partners.bios);
        if (candidates.length) s.tasks.push(toTask({ key: "bios", platform: "instagram", actor: INSTAGRAM_SCRAPER, input: profilesInput(candidates), label: `Partners · reading ${candidates.length} creator bio${candidates.length === 1 ? "" : "s"}` }));
      }
      s.stage = "expand";
      const extra = s.tasks.filter((t) => t.status === "pending");
      if (extra.length) await publishRun(job, w.partners ? "Reading creators' bios and transcribing the best posts" : `Transcribing the top ${best.length} niche posts on Instagram`);
      return "continue";
    }
    case "expand": {
      if (!(await pump(job, apify, storeScrape, () => publishRun(job, collectingMessage(s))))) return "wait";
      const outputs = await job.outputs<Reel[]>("out:");
      let reels = assemble(w, outputs, (await job.get<Reel[]>("niche-ig-best")) ?? []);
      if (w.partners) {
        const profiles = (await job.get<Profile[]>("profiles")) ?? [];
        const bioJudge = profiles.length ? await aiJudge() : null;
        const verdicts = bioJudge ? await judgeBios(bioJudge, profiles, w.partners.brands) : {};
        await job.put("bio-verdicts", verdicts);
        // What a verdict means depends on the provider that gave it; the report is built in a later slice.
        await job.put("bio-provider", bioJudge?.provider ?? null);
        const declared = new Set(Object.entries(verdicts).filter(([, p]) => bioDeclares(p, bioJudge?.provider)).map(([key]) => key.split("|")[1]));
        if (profiles.length) await job.log(`Read ${profiles.length} creator bio${profiles.length === 1 ? "" : "s"}: ${declared.size} declare${declared.size === 1 ? "s" : ""} a tie to the brand`);
        // A campaign keeps posts linked to the brand, labelled paid, naming it, or from a creator whose bio declares the tie.
        if (w.brand) reels = reels.filter((reel) => campaignKeeps(reel, w.partners!.brands, w.mentions ?? [], declared));
      }
      if (!reels.length) {
        throw new UserError(`No posts from the last ${w.sinceDays} days turned up${w.mentions?.length ? " that mention the brand" : ""}. Try a longer time frame or other accounts.`);
      }
      s.collectedAt = new Date().toISOString();
      s.total = reels.length;
      await job.put("reels", reels);
      const counts = PLATFORMS.map((p) => [p, reels.filter((r) => r.platform === p).length] as const).filter(([, n]) => n).map(([p, n]) => `${PLATFORM_NAME[p]} ${n}`).join(", ");
      await job.log(`Collected ${reels.length} posts (${counts})`);
      const comments = planComments(w, reels);
      s.tasks.push(...comments.map(toTask));
      s.stage = comments.length ? "comments" : "decode";
      await publishRun(job, comments.length ? "Reading more comments on the top posts" : `The AI is decoding ${reels.length} posts`, comments.length ? "collecting" : "decoding");
      return "continue";
    }
    case "comments": {
      if (!(await pump(job, apify, storeScrape, () => publishRun(job, "Reading more comments on the top posts")))) return "wait";
      const reels = (await job.get<Reel[]>("reels")) ?? [];
      let withComments = 0;
      for (const task of s.tasks.filter((t) => t.key.startsWith("comments:") && t.status === "done")) {
        const items = (await job.get<any[]>(`out:${task.key}`)) ?? [];
        const ids = new Set(task.postIds ?? []);
        withComments += attachComments(reels.filter((r) => ids.has(r.id)), items, w.comments?.perPost ?? COMMENTS.perPost);
      }
      await job.put("reels", reels);
      if (withComments) await job.log(`Comments added to ${withComments} top posts`);
      s.stage = "decode";
      await publishRun(job, `The AI is decoding ${reels.length} posts`, "decoding");
      return "continue";
    }
    case "decode": {
      const reels = (await job.get<Reel[]>("reels")) ?? [];
      const done = new Map(((await job.get<Decoded[]>("decoded")) ?? []).map((d) => [d.id, d]));
      const skipped = new Set(s.skipped);
      const queue = reels.filter((r) => !done.has(r.id) && !skipped.has(r.id));
      if (queue.length) {
        const { decodeAll } = decoder(await aiJudge(), w, LIBRARY);
        let lastPublish = 0, lastSave = Date.now();
        const result = await decodeAll(queue, {
          concurrency: 8,
          shouldStop: () => job.cancelled || Date.now() > job.deadline + 45_000,
          onDecoded: async (d) => {
            done.set(d.id, d);
            s.decoded = done.size;
            s.jevTokens += d.inputTokens;
            if (Date.now() - lastPublish > 600) {
              lastPublish = Date.now();
              await publishRun(job, `The AI is decoding · ${done.size} of ${reels.length} posts`, "decoding");
            }
            if (Date.now() - lastSave > 10_000) {
              lastSave = Date.now();
              await job.put("decoded", [...done.values()]);
              await job.save();
            }
          },
          onFailed: (reel, error) => {
            s.skipped.push(reel.id);
            s.decodeError ??= errorText(error);
          },
        });
        await job.put("decoded", [...done.values()]);
        if (result.failed) await job.log(`The AI couldn't decode ${result.failed} post${result.failed === 1 ? "" : "s"}; they're kept without a breakdown.`, "warn");
        if (reels.some((r) => !done.has(r.id) && !s.skipped.includes(r.id))) return "continue";
      }
      if (!done.size) throw new UserError(`The AI couldn't decode any posts${s.decodeError ? `: ${s.decodeError}` : "."}`);
      await job.log(`The AI decoded ${done.size} posts`);
      s.stage = "finish";
      await publishRun(job, "Saving the report", "saving");
      return "continue";
    }
    case "finish": {
      const reels = (await job.get<Reel[]>("reels")) ?? [];
      const decoded = (await job.get<Decoded[]>("decoded")) ?? [];
      await saveThumbs(job, reels);
      const now = new Date().toISOString();
      const partners = w.partners
        ? partnerPrograms(signalPosts(await job.outputs<Reel[]>("out:")), w.partners.brands, (await job.get<Profile[]>("profiles")) ?? [], (await job.get<Record<string, number>>("bio-verdicts")) ?? {}, (await job.get<AiProvider>("bio-provider")) ?? undefined)
        : undefined;
      if (partners) for (const program of partners) await job.log(`Partners of ${program.brand}: ${program.creators.length} creators, ${program.creators.filter((c) => c.strength === "confirmed").length} confirmed`);
      const report = buildReport({
        slug: job.row.run_id!, workflow: w, reels, decoded, formats: LIBRARY, partners,
        status: { phase: "done", total: reels.length, decoded: decoded.length, jevInputTokens: s.jevTokens, apifyUsd: s.apifyUsd, startedAt: s.startedAt, updatedAt: now, collectedAt: s.collectedAt },
      });
      const { error } = await db.from("run_reports").upsert({ run_id: job.row.run_id, user_id: job.row.user_id, report });
      if (error) throw new Error(`Couldn't save the report: ${error.message}`);
      await db.from("runs").update({
        status: "done", phase: "done", message: null, posts: reels.length, apify_usd: s.apifyUsd, jev_tokens: s.jevTokens, finished_at: now,
        progress: { stage: "done", steps: s.tasks.map((t) => ({ key: t.key, label: t.label, status: t.status, count: t.count ?? null, error: t.error ?? null })), total: reels.length, decoded: decoded.length, apifyUsd: s.apifyUsd },
      }).eq("id", job.row.run_id!);
      await db.from("projects").update({ status: "ready", message: null }).eq("id", job.row.project_id);
      await job.log(`Report ready: ${decoded.length} posts decoded · Apify $${s.apifyUsd.toFixed(2)}`, "done");
      await job.finish();
      return "done";
    }
  }
}

/** Instagram and TikTok image links expire within days, so thumbnails are copied into Storage. */
async function saveThumbs(job: Job, reels: Reel[]) {
  const todo = reels.filter((r) => r.thumb?.startsWith("http") && !r.thumb.includes("/storage/v1/object/public/thumbs/"));
  let next = 0;
  await Promise.all(Array.from({ length: 10 }, async () => {
    for (let i = next++; i < todo.length; i = next++) {
      const reel = todo[i];
      try {
        const response = await fetch(reel.thumb!, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(String(response.status));
        const type = response.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
        const contentType = ["image/jpeg", "image/png", "image/webp"].includes(type) ? type : "image/jpeg";
        const path = `${job.row.user_id}/${job.row.run_id}/${reel.id.replace(/[^A-Za-z0-9_-]/g, "_")}.${contentType.split("/")[1].replace("jpeg", "jpg")}`;
        const { error } = await db.storage.from("thumbs").upload(path, new Uint8Array(await response.arrayBuffer()), { contentType, upsert: true });
        if (error) throw error;
        reel.thumb = db.storage.from("thumbs").getPublicUrl(path).data.publicUrl;
      } catch {
        reel.thumb = null;
      }
    }
  }));
}

// MARK: Competitor discovery

async function stepDiscover(job: Job): Promise<"continue" | "wait" | "done"> {
  const s = job.state as DiscoverState;
  const k = await keys();
  const say = async (message: string) => { await db.from("projects").update({ message }).eq("id", job.row.project_id); };
  switch (s.stage) {
    case "search": {
      if (!s.tasks.length && !s.openai) {
        const kw = s.project.keywords;
        if (kw.length && s.project.platforms.includes("instagram")) s.tasks.push(toTask({ key: "search-ig", actor: ACTORS.instagramSearch, input: instagramSearchInput(kw), label: "Instagram profiles" }));
        if (kw.length && s.project.platforms.includes("tiktok")) s.tasks.push(toTask({ key: "search-tt", actor: ACTORS.tiktok, input: tiktokSearchInput(kw), label: "TikTok profiles" }));
        if (!k.APIFY_TOKEN) s.tasks = [];
        if (k.OPENAI_API_KEY) s.openai = { status: "pending", startedAt: new Date().toISOString() };
        const sources = [k.OPENAI_API_KEY && "asking OpenAI", s.tasks.length && "searching Instagram and TikTok"].filter(Boolean).join(" and ");
        await say(sources ? `Finding competitors: ${sources}…` : "Checking the competitors you know…");
      }
      const openaiDone = await pollOpenAI(job, s, k);
      const apify = k.APIFY_TOKEN ? apifyClient(k.APIFY_TOKEN) : null;
      const searchDone = await pump(job, apify, async (task, items) => {
        const found = task.key === "search-ig" ? instagramCandidates(items) : tiktokCandidates(items);
        await job.put(`out:${task.key}`, found);
        await job.log(`${task.label}: ${found.length} accounts`);
        return found.length;
      }, async () => {});
      if (!openaiDone || !searchDone) return "wait";
      const outputs = await job.outputs<Candidate[]>("out:");
      const found = [...known(s.project.answers.knownCompetitors), ...Object.values(outputs).flat()];
      const failures = [...s.tasks.filter((t) => t.status === "failed").map((t) => t.error ?? ""), ...(s.openai?.status === "failed" ? [s.openai.error ?? ""] : [])];
      if (!found.length && failures.length) throw new UserError(failures[0] || "The competitor search failed.");
      const list = shortlist(merge(found));
      await job.put("candidates", list);
      s.stage = "judge";
      await say(`The AI is judging ${list.length} account${list.length === 1 ? "" : "s"}…`);
      return "continue";
    }
    case "judge": {
      const list = (await job.get<Candidate[]>("candidates")) ?? [];
      let last = 0;
      const candidateJudge = await aiJudge();
      s.jevTokens += await judge(candidateJudge, s.project, list, (done, total) => {
        if (Date.now() - last < 600) return;
        last = Date.now();
        void say(`The AI is judging · ${done} of ${total} accounts`);
      });
      const { ordered, brands } = preselect(list, candidateJudge.provider);
      const fromAI = list.filter((c) => c.source === "ai").length;
      const message = brands.length
        ? `Found ${brands.length} brand${brands.length === 1 ? "" : "s"}${fromAI ? ` (${fromAI} named by OpenAI)` : ""}${s.apifyUsd ? ` · Apify $${s.apifyUsd.toFixed(2)}` : ""}`
        : "No clear competitors found. You can analyse the top content in your niche instead.";
      const { error } = await db.from("projects").update({ candidates: ordered, status: "review", message }).eq("id", job.row.project_id);
      if (error) throw new Error(error.message);
      await job.log(message, "done");
      await job.finish();
      return "done";
    }
  }
}

/**
 * OpenAI with web search names competitors; it runs in the background and is polled (engine/openai_search.ts:
 * sent at most once, a lost answer fails plainly instead of paying again). True when settled.
 */
function pollOpenAI(job: Job, s: DiscoverState, k: Keys): Promise<boolean> {
  return pollSearch(s.openai, {
    apiKey: k.OPENAI_API_KEY ?? "",
    body: async () => openAIRequest(s.project, (await models()).text, true),
    markSent: () => job.save(),
    store: async (data) => {
      const found = openAICandidates(data);
      await job.put("out:openai", found);
      await job.log(`OpenAI named ${found.length} competitor${found.length === 1 ? "" : "s"}`);
    },
    log: (message) => job.log(message, "warn"),
  });
}
