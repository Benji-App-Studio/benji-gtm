// The creative studio's backend: QA with the AI judge (after OpenAI vision reads the text off server-made
// images, core/ocr.ts), the API the local runner (the Higgsfield CLI on the
// owner's Mac) uses to claim jobs and hand back results, and, when HIGGSFIELD_API_KEY is set, a
// server-side runner for the image models Higgsfield's public API offers. Image jobs whose provider is
// "openai" (params.provider, the person's choice; Higgsfield is the default) are made here too, with
// OpenAI's Images API and the same OPENAI_API_KEY OCR uses (core/openai_images.ts), and saved exactly
// like Higgsfield's results; one too slow for the Supabase plan's time limit is handed to OpenAI and
// collected by a later tick (core/openai_jobs.ts).
//
// Routes (all POST unless noted):
//   GET  health              what's connected
//   qa                       { creativeIds }  signed-in owner: (re)run QA
//   copy                     { creativeId, instructions, input }  signed-in owner: A/B ad copy from OpenAI (core/copy.ts)
//   runner/claim             { runnerId, limit, models? }            x-creatives-runner: <secret>
//   runner/heartbeat         { runnerId, jobIds }
//   runner/submitted         { runnerId, jobId, externalId, costCredits? }  the Higgsfield job, saved as soon as it exists
//   runner/upload            { runnerId, jobId, files: [{ name, contentType }] } → signed upload URLs
//   runner/complete          { runnerId, jobId, costCredits?, externalId?, outputs: [...] }
//                            (a product cut-out job's PNG goes on its product image, core/cutout.ts)
//   runner/fail              { runnerId, jobId, error, retryable?, retryAfterSec?, externalId?, providerStatus?, providerReason?, chargedCredits? }
//   runner/catalog           { kind: avatars|hooks|settings, items }
//   tick                     x-radar-worker: <RADAR_WORKER_SECRET> (pg_cron, every 30 s)
import { createClient } from "@supabase/supabase-js";
import { COPY_INPUT_MAX, writeCopy } from "./core/copy.ts";
import { cutoutAssetId, cutoutPatch } from "./core/cutout.ts";
import { driveClient } from "./core/drive.ts";
import { API_MODELS, apiRequestFor, HiggsfieldApiError, higgsfieldApi, isTerminal, outputUrls, referenceUrls } from "./core/hf_api.ts";
import { afterOpenAiFailure, afterPollError, afterRequestEnded, afterRunnerFailure, afterSubmitError, busyBackoff, FINALIZE_SECONDS, jobProvider, priceLimit, shouldSubmit } from "./core/jobs.ts";
import { extensionFor, imageSize, mimeFromUrl, storagePath } from "./core/media.ts";
import { needsLogoRead, needsServerOcr, readImageText, readLogo } from "./core/ocr.ts";
import { awarenessColumns, cleanDrivePath } from "./core/organize.ts";
import { OPENAI_BACKGROUND } from "./core/openai_images.ts";
import { advanceOpenAiJob, collectSetting, imagePlan, type JobStep, type OpenAiJobDeps } from "./core/openai_jobs.ts";
import { adCopyOf, logoPlaced, realProductUsed, runQa } from "./core/qa.ts";
import type { CreativeStyle, KnownCopy, OcrResult, QaContext } from "./core/types.ts";
import { JudgeError } from "../_shared/ai/judge.ts";
import { modelOverrides, resolveModels } from "../_shared/ai/models.ts";
import { createJudge, judgeAvailability } from "../_shared/ai/provider.ts";
import { createAuth, HttpError } from "../_shared/auth.ts";
import { addKeyMessage, createKeys, sameSecret } from "../_shared/keys.ts";
import { resolveLimits } from "../_shared/limits.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const BUCKET = "creatives";
/** A runner's lease on a job: long enough for a 30 s Marketing Studio video to render. */
const LOCAL_LEASE_SECONDS = 30 * 60;
const API_LEASE_SECONDS = 15 * 60;
/** The runner id OpenAI image jobs are claimed under (the API worker's Higgsfield jobs are "edge-api"). */
const OPENAI_RUNNER = "edge-openai";

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

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 400);

// MARK: Keys and callers

/** Every key comes from the shared reader (edge function secret first, then Vault; the worker secret Vault only). */
const secrets = createKeys(db);
const auth = createAuth(db);
/** A plain switch (a concurrency limit): edge function environment only. */
const env = (name: string) => Deno.env.get(name)?.trim() || undefined;

/** The watchdog's secret, from Vault, shared by the creatives tick. */
const radarWorkerSecret = () => secrets.get("RADAR_WORKER_SECRET");

/** The OpenAI key for OCR, ad copy and OpenAI image jobs. */
async function openAiKey() {
  return await secrets.get("OPENAI_API_KEY").catch(() => undefined);
}

/** The install's settings; undefined on an install from before setup existed (no install row). */
const installSettings = async () => (await auth.install())?.settings;

/** What decides which AI answers: the keys and the install's settings (_shared/ai/provider.ts). */
const aiChoice = async () => ({ keys: secrets, settings: await installSettings() });

/** The judge QA asks: OpenAI, or TypeSafe when Settings choose it. A missing key says what to add. */
async function aiJudge() {
  try {
    return await createJudge(await aiChoice());
  } catch (error) {
    if (error instanceof JudgeError && error.kind === "config") throw new Error(`QA checks aren't connected. ${error.message}`);
    throw error;
  }
}

/** The model for each step: an environment variable or stored key, else Settings > Models, else the default. */
const models = async () => resolveModels((await installSettings())?.models, await modelOverrides(secrets));

/** What the Supabase plan allows (_shared/limits.ts); the old numbers on an install with no install row. */
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

async function requireRunner(req: Request) {
  const secret = await secrets.get("CREATIVES_RUNNER_SECRET");
  if (!secret) throw new HttpError(503, "The desktop runner isn't set up yet. Create its secret in Settings > API keys, then give it to the runner.");
  if (!sameSecret(req.headers.get("x-creatives-runner") ?? "", secret)) throw new HttpError(403, "Forbidden");
}

async function requireWorker(req: Request) {
  const secret = await radarWorkerSecret();
  if (!secret || !sameSecret(req.headers.get("x-radar-worker") ?? "", secret)) throw new HttpError(403, "Forbidden");
}

async function body(req: Request): Promise<Record<string, any>> {
  try { return await req.json(); } catch { return {}; }
}

const uuid = (value: unknown, what: string) => {
  const id = String(value ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, `Which ${what}?`);
  return id;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const parts = new URL(req.url).pathname.replace(/\/+$/, "").split("/");
  const at = parts.lastIndexOf("creatives");
  const route = parts.slice(at + 1).join("/");
  try {
    switch (route) {
      case "health": return json(await health());
      case "qa": return json(await qaRoute(await signedInUser(req), await body(req)));
      case "copy": return json(await copyRoute(await signedInUser(req), await body(req)));
      case "templates": return json(await templatesDone(await signedInUser(req), await body(req)));
      case "drive/export": return json(await driveExport(await signedInUser(req), await body(req)));
      case "runner/claim": await requireRunner(req); return json(await claim(await body(req)));
      case "runner/heartbeat": await requireRunner(req); return json(await heartbeat(await body(req)));
      case "runner/submitted": await requireRunner(req); return json(await submitted(await body(req)));
      case "runner/upload": await requireRunner(req); return json(await uploadUrls(await body(req)));
      case "runner/complete": await requireRunner(req); return json(await complete(await body(req)));
      case "runner/fail": await requireRunner(req); return json(await fail(await body(req)));
      case "runner/catalog": await requireRunner(req); return json(await catalog(await body(req)));
      case "tick": {
        await requireWorker(req);
        EdgeRuntime.waitUntil(tick().catch((error) => console.error("tick", error)));
        return json({ accepted: true }, 202);
      }
      default: return json({ error: "Not found" }, 404);
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error(error);
    return json({ error: `Something went wrong: ${errorText(error)}` }, 500);
  }
});

async function health() {
  const set = await secrets.flags(["HIGGSFIELD_API_KEY", "CREATIVES_RUNNER_SECRET", "GOOGLE_SERVICE_ACCOUNT_JSON", "OPENAI_API_KEY"]);
  const ai = await judgeAvailability(await aiChoice());
  const limits = await planLimits();
  return {
    // `typesafe` is the name the app has always read for "QA checks are on": true with an OpenAI key,
    // or a TypeSafe key when that provider is chosen.
    typesafe: ai.ok, ai: ai.ok, aiProvider: ai.ok ? ai.provider : null,
    higgsfieldApi: set.HIGGSFIELD_API_KEY, runner: set.CREATIVES_RUNNER_SECRET, drive: set.GOOGLE_SERVICE_ACCOUNT_JSON,
    ocr: set.OPENAI_API_KEY,
    // GPT Image 2.5 straight from OpenAI (image jobs whose provider is "openai"): the same key.
    openaiImages: set.OPENAI_API_KEY,
    // The Supabase plan's time limit for one run, and what it means for each OpenAI image quality
    // (core/openai_jobs.ts imagePlan): made in one run, handed over and collected later, or not started.
    wallClockSec: limits.wallClockSec,
    openaiImagePlan: imagePlan(limits, collectSetting(env("OPENAI_IMAGE_COLLECT"))),
  };
}

// MARK: Rows

interface JobRow {
  id: string; user_id: string; product_id: string; batch_id: string | null; format_card_id: string | null;
  kind: CreativeStyle; model: string; prompt: string; params: Record<string, unknown>; aspect: string; variant: number;
  backend: string; status: string; cost_estimate: number; cost_credits: number | null; attempts: number; retries: number; runner_id: string | null; external_id: string | null; created_at: string;
}
interface BatchRow { id: string; settings: Record<string, any>; context: QaContext }

async function batchOf(id: string | null): Promise<BatchRow | null> {
  if (!id) return null;
  const { data } = await db.from("creative_batches").select("id, settings, context").eq("id", id).maybeSingle();
  return data as BatchRow | null;
}

async function runnerJob(runnerId: string, jobId: string): Promise<JobRow> {
  const { data } = await db.from("creative_jobs").select("*").eq("id", jobId).maybeSingle();
  const job = data as JobRow | null;
  if (!job) throw new HttpError(404, "No such job.");
  if (job.status !== "running" || job.runner_id !== runnerId) throw new HttpError(409, "This runner no longer holds the job (it was cancelled or handed to another runner).");
  return job;
}

// MARK: Runner

async function claim(input: Record<string, any>) {
  const runnerId = String(input.runnerId ?? "").slice(0, 80);
  if (!runnerId) throw new HttpError(400, "Name the runner.");
  const limit = Math.max(0, Math.min(8, Number(input.limit) || 1));
  const models = Array.isArray(input.models) ? input.models.map(String) : null;
  const { data, error } = await db.rpc("creatives_claim_jobs", { p_runner: runnerId, p_backend: "local", p_models: models, p_limit: limit, p_seconds: LOCAL_LEASE_SECONDS });
  if (error) throw new Error(error.message);
  const jobs = (data ?? []) as JobRow[];
  const batches = new Map<string, BatchRow | null>();
  for (const job of jobs) if (job.batch_id && !batches.has(job.batch_id)) batches.set(job.batch_id, await batchOf(job.batch_id));
  return {
    leaseSeconds: LOCAL_LEASE_SECONDS,
    jobs: jobs.map((job) => {
      const batch = job.batch_id ? batches.get(job.batch_id) : null;
      return { ...job, brand: batch?.settings?.brand ?? null };
    }),
  };
}

async function heartbeat(input: Record<string, any>) {
  const ids = (Array.isArray(input.jobIds) ? input.jobIds : []).map((id: unknown) => uuid(id, "job"));
  const { data } = await db.rpc("creatives_extend_lease", { p_runner: String(input.runnerId ?? ""), p_jobs: ids, p_seconds: LOCAL_LEASE_SECONDS });
  // Jobs the runner no longer holds (cancelled in the studio) come back so it can stop them.
  const { data: held } = await db.from("creative_jobs").select("id").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).eq("status", "running").eq("runner_id", String(input.runnerId ?? ""));
  const keep = new Set(((held ?? []) as { id: string }[]).map((r) => r.id));
  return { extended: data ?? 0, released: ids.filter((id: string) => !keep.has(id)) };
}

/**
 * The runner submitted the job to Higgsfield (without waiting): its Higgsfield job id is saved at once,
 * so a dropped wait, a crash or a retry collects that job instead of paying for a new one. One
 * Higgsfield job belongs to one creative job: a runner that found it by looking for an earlier
 * submission (same model, prompt and settings) gets `conflict` when another job already has it (and a
 * 409, like every runner route, when it no longer holds the job).
 */
async function submitted(input: Record<string, any>) {
  const runnerId = String(input.runnerId ?? "");
  const job = await runnerJob(runnerId, uuid(input.jobId, "job"));
  const externalId = String(input.externalId ?? "").trim().slice(0, 200);
  if (!externalId) throw new HttpError(400, "Which Higgsfield job?");
  if (job.external_id && job.external_id !== externalId) return { saved: false, conflict: true, error: `This job already has Higgsfield job ${job.external_id}.` };
  const { data: other } = await db.from("creative_jobs").select("id").eq("external_id", externalId).neq("id", job.id).limit(1);
  if (other?.length) return { saved: false, conflict: true, error: `Higgsfield job ${externalId} belongs to another creative job.` };
  const cost = Number(input.costCredits);
  const { data, error } = await db.from("creative_jobs")
    .update({ external_id: externalId, ...(input.costCredits != null && Number.isFinite(cost) ? { cost_credits: cost } : {}) })
    .eq("id", job.id).eq("status", "running").eq("runner_id", runnerId).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new HttpError(409, "This runner no longer holds the job (it was cancelled or handed to another runner).");
  return { saved: true };
}

async function uploadUrls(input: Record<string, any>) {
  const job = await runnerJob(String(input.runnerId ?? ""), uuid(input.jobId, "job"));
  const files = (Array.isArray(input.files) ? input.files : []).slice(0, 12);
  const out = [];
  for (const file of files) {
    const path = storagePath(job.product_id, job.created_at, job.id, String(file.name ?? "output"));
    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
    if (error || !data) throw new Error(`Couldn't prepare the upload: ${error?.message}`);
    out.push({ name: file.name, path, signedUrl: data.signedUrl, token: data.token });
  }
  return { files: out };
}

interface Output {
  path: string; kind: "video" | "image"; mime: string; width?: number; height?: number; durationSec?: number; sizeBytes?: number;
  sourceUrl?: string; posterPath?: string; ocr?: OcrResult; copy?: KnownCopy;
}

const publicUrl = (path: string) => db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
const STYLE_TITLE: Record<CreativeStyle, string> = { ugc_video: "UGC video", ai_video: "AI video", image: "Image ad", reddit: "Reddit post", tweet: "Tweet" };
const param = (job: JobRow, key: string) => (typeof job.params[key] === "string" ? (job.params[key] as string).slice(0, 255) : null);

/** The ad copy Launch uses, prefilled from the job (the reviewer edits it before approving). */
function adCopy(job: JobRow, copy: KnownCopy = {}) {
  return {
    title: `${STYLE_TITLE[job.kind]} ${job.aspect} v${job.variant}`,
    headline: copy.headline ?? param(job, "headline"),
    primary_text: copy.body ?? param(job, "primary_text"),
    cta: param(job, "cta"),
    hook_type: param(job, "hook_type"),
    format_slug: param(job, "format_slug") ?? job.format_card_id,
  };
}

async function saveOutputs(job: JobRow, outputs: Output[]) {
  const prefix = `${job.product_id}/`;
  const rows = outputs.filter((o) => typeof o.path === "string" && o.path.startsWith(prefix)).map((o) => ({
    ...adCopy(job, o.copy),
    url: publicUrl(o.path),
    thumbnail_url: o.posterPath?.startsWith(prefix) ? publicUrl(o.posterPath) : null,
    user_id: job.user_id, product_id: job.product_id, job_id: job.id, batch_id: job.batch_id, format_card_id: job.format_card_id,
    kind: o.kind === "video" ? "video" : "image", style: job.kind, aspect: job.aspect,
    width: o.width ?? null, height: o.height ?? null, duration_sec: o.durationSec ?? null,
    storage_path: o.path, poster_path: o.posterPath?.startsWith(prefix) ? o.posterPath : null, mime: String(o.mime ?? "application/octet-stream"),
    size_bytes: o.sizeBytes ?? null, source_url: o.sourceUrl ?? null, model: job.model, prompt: job.prompt,
    copy: { ...(o.copy ?? {}), ...(typeof job.params.hook_text === "string" ? { hook: job.params.hook_text } : {}) },
    ocr: o.ocr ?? null,
    // The batch's awareness level, when it has one (the column is written only then).
    ...awarenessColumns(job.params),
  }));
  if (!rows.length) throw new HttpError(400, "No outputs to save.");
  const { data, error } = await db.from("creatives").insert(rows).select("id");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

async function complete(input: Record<string, any>) {
  const job = await runnerJob(String(input.runnerId ?? ""), uuid(input.jobId, "job"));
  const outputs: Output[] = Array.isArray(input.outputs) ? input.outputs : [];
  const ids = await finalize(job, () => Promise.resolve(outputs), {
    // No charge reported (a job collected after a dropped wait): keep the price recorded at submit.
    cost_credits: input.costCredits != null && Number.isFinite(Number(input.costCredits)) ? Number(input.costCredits) : job.cost_credits ?? null,
    external_id: input.externalId ? String(input.externalId).slice(0, 200) : job.external_id,
  }).catch(async (error) => {
    // Back to the runner that holds it: it may send the result again.
    await db.from("creative_jobs").update({ status: "running", lease_until: new Date(Date.now() + LOCAL_LEASE_SECONDS * 1000).toISOString() }).eq("id", job.id).eq("status", "finalizing");
    throw error;
  });
  if (!ids) throw new HttpError(409, "This result is already being saved (a repeated call).");
  return { creatives: ids };
}

/**
 * Saves a finished job once. The job is taken first with a conditional update (running → finalizing)
 * so a second tick or a repeated call gets null instead of saving the result twice; creatives already
 * saved for the job (a save that died before `done`) are reused, not made again. QA runs afterwards in
 * the background. On error the job stays in finalizing for the caller to put back.
 */
async function finalize(job: JobRow, collect: () => Promise<Output[]>, done: Record<string, unknown> = {}): Promise<string[] | null> {
  const { data: taken } = await db.from("creative_jobs")
    .update({ status: "finalizing", lease_until: new Date(Date.now() + FINALIZE_SECONDS * 1000).toISOString() })
    .eq("id", job.id).eq("status", "running").eq("runner_id", job.runner_id ?? "").select("id");
  if (!taken?.length) return null;
  // A product cut-out isn't a creative: it's stored on its product image, and there's nothing to QA.
  const asset = cutoutAssetId(job);
  if (asset) await saveCutout(job, asset, await collect());
  const { data: made } = asset ? { data: [] } : await db.from("creatives").select("id").eq("job_id", job.id);
  const ids = asset ? [] : made?.length ? (made as { id: string }[]).map((r) => r.id) : await saveOutputs(job, await collect());
  const { error } = await db.from("creative_jobs").update({ status: "done", finished_at: new Date().toISOString(), lease_until: null, error: null, ...done }).eq("id", job.id);
  if (error) throw new Error(error.message);
  EdgeRuntime.waitUntil(qaMany(ids));
  return ids;
}

/** A finished cut-out: its PNG becomes the product image's cutout_url / cutout_path (a deleted image just drops it). */
async function saveCutout(job: JobRow, assetId: string, outputs: Output[]) {
  const patch = cutoutPatch(job.product_id, outputs, publicUrl);
  if (!patch) throw new HttpError(400, "No cut-out image to save.");
  const { error } = await db.from("product_assets").update(patch).eq("id", assetId).eq("product_id", job.product_id);
  if (error) throw new Error(error.message);
}

/**
 * The runner couldn't finish a job (core/jobs.ts afterRunnerFailure): Higgsfield's own failure fails it
 * with Higgsfield's status and reason (not charged unless Higgsfield said so); a busy or dropped one goes
 * back to the queue, keeping its Higgsfield job so the next claim collects it; anything else fails.
 */
async function fail(input: Record<string, any>) {
  const job = await runnerJob(String(input.runnerId ?? ""), uuid(input.jobId, "job"));
  const message = String(input.error ?? "The runner couldn't finish this job.").slice(0, 600);
  const text = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const patch = afterRunnerFailure(job, {
    message, retryable: Boolean(input.retryable), retryAfterSec: Number(input.retryAfterSec) || 60,
    externalId: text(input.externalId, 200), providerStatus: text(input.providerStatus, 40), providerReason: text(input.providerReason, 400),
    chargedCredits: input.chargedCredits != null && Number.isFinite(Number(input.chargedCredits)) ? Number(input.chargedCredits) : null,
  });
  await db.from("creative_jobs").update(patch).eq("id", job.id);
  return { requeued: patch.status === "queued" };
}

/** A busy or rate-limited submit goes back to the queue (core/jobs.ts: each one counts); anything else fails. */
async function requeueOrFail(job: JobRow, message: string, retryable: boolean, retryAfterSec: number) {
  const patch = afterSubmitError(job, message, retryable, retryAfterSec);
  await db.from("creative_jobs").update(patch).eq("id", job.id);
  return { requeued: patch.status === "queued" };
}

/** Looking at or collecting a submitted API job went wrong: look again on a later tick, never submit again. */
async function pollLater(job: JobRow, message: string) {
  await db.from("creative_jobs").update(afterPollError(job, message, API_LEASE_SECONDS)).eq("id", job.id).in("status", ["running", "finalizing"]);
}

async function catalog(input: Record<string, any>) {
  const kind = String(input.kind ?? "");
  if (!["avatars", "hooks", "settings"].includes(kind)) throw new HttpError(400, "Which catalog?");
  // Keep only what the studio shows: ids, names, previews, prompts.
  const items = (Array.isArray(input.items) ? input.items : []).slice(0, 200).map((item: Record<string, unknown>) => ({
    id: String(item.id ?? ""), name: String(item.name ?? "").slice(0, 80), type: item.type ?? null, gender: item.gender ?? null,
    prompt: typeof item.prompt === "string" ? item.prompt.slice(0, 400) : null,
    previewUrl: item.preview_url ?? item.thumbnail_url ?? null, videoUrl: item.video_url ?? null,
  })).filter((item: { id: string }) => item.id);
  await db.from("creative_catalog").upsert({ kind, items, synced_at: new Date().toISOString() });
  return { saved: items.length };
}

// MARK: Templates

/** The studio rendered these posts as the user; mark their jobs done (or failed) and QA them. */
async function templatesDone(user: string, input: Record<string, any>) {
  const ids = (Array.isArray(input.jobIds) ? input.jobIds : []).slice(0, 100).map((id: unknown) => uuid(id, "job"));
  const failures = new Map<string, string>((Array.isArray(input.failures) ? input.failures : []).map((f: { jobId: string; error: string }) => [String(f.jobId), String(f.error ?? "").slice(0, 400)]));
  const { data } = await db.from("creative_jobs").select("id").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).eq("user_id", user).eq("backend", "template").eq("status", "queued");
  const jobs = ((data ?? []) as { id: string }[]).map((r) => r.id);
  const { data: made } = await db.from("creatives").select("id, job_id").in("job_id", jobs.length ? jobs : ["00000000-0000-0000-0000-000000000000"]);
  const byJob = new Map(((made ?? []) as { id: string; job_id: string }[]).map((r) => [r.job_id, r.id]));
  const now = new Date().toISOString();
  for (const id of jobs) {
    const ok = byJob.has(id) && !failures.has(id);
    await db.from("creative_jobs").update(ok
      ? { status: "done", started_at: now, finished_at: now, cost_credits: 0 }
      : { status: "failed", finished_at: now, error: failures.get(id) ?? "The post wasn't rendered." }).eq("id", id);
  }
  const creatives = [...byJob.values()];
  EdgeRuntime.waitUntil(qaMany(creatives));
  return { done: creatives.length, failed: jobs.length - creatives.length };
}

// MARK: Drive

async function driveExport(user: string, input: Record<string, any>) {
  const raw = await secrets.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new HttpError(501, `Drive export isn't set up. ${addKeyMessage("GOOGLE_SERVICE_ACCOUNT_JSON")} Then share your Drive folder with the service account's email.`);
  const ids = (Array.isArray(input.creativeIds) ? input.creativeIds : []).slice(0, 50).map((id: unknown) => uuid(id, "creative"));
  const { data } = await db.from("creatives").select("id, batch_id, storage_path, mime, title, drive_file_id").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).eq("user_id", user).eq("approval", "approved");
  const drive = driveClient(JSON.parse(raw));
  // Where the studio files each one (studio/src/lib/export-paths.ts): subfolders and a readable name.
  const paths = input.paths && typeof input.paths === "object" ? input.paths as Record<string, unknown> : {};
  const out: { id: string; driveFileId?: string; error?: string }[] = [];
  for (const c of (data ?? []) as { id: string; batch_id: string | null; storage_path: string; mime: string; title: string | null; drive_file_id: string | null }[]) {
    if (c.drive_file_id) { out.push({ id: c.id, driveFileId: c.drive_file_id }); continue; }
    const folder = (await batchOf(c.batch_id))?.settings?.storage?.driveFolderId as string | undefined;
    if (!folder) { out.push({ id: c.id, error: "No Drive folder in the workspace's connections (storage.driveFolderId)." }); continue; }
    try {
      const { data: file, error } = await db.storage.from(BUCKET).download(c.storage_path);
      if (error || !file) throw new Error(error?.message ?? "missing file");
      const path = cleanDrivePath(paths[c.id]);
      const name = path?.name ?? `${c.storage_path.split("/").slice(1).join("_")}`;
      const parent = path?.folders.length ? await drive.folder(folder, path.folders) : folder;
      const id = await drive.upload(parent, name, c.mime, new Uint8Array(await file.arrayBuffer()));
      await db.from("creatives").update({ drive_file_id: id }).eq("id", c.id);
      out.push({ id: c.id, driveFileId: id });
    } catch (error) {
      out.push({ id: c.id, error: errorText(error) });
    }
  }
  return { results: out };
}

// MARK: QA

async function qaRoute(user: string, input: Record<string, any>) {
  const ids = (Array.isArray(input.creativeIds) ? input.creativeIds : [input.creativeId]).filter(Boolean).slice(0, 60).map((id: unknown) => uuid(id, "creative"));
  if (!ids.length) throw new HttpError(400, "Which creatives?");
  const { data } = await db.from("creatives").select("id, kind, style, storage_path, ocr, batch_id").in("id", ids).eq("user_id", user);
  const rows = (data ?? []) as { id: string; kind: string; style: string; storage_path: string | null; ocr: OcrResult | null; batch_id: string | null }[];
  const own = rows.map((r) => r.id);
  if (own.length !== ids.length) throw new HttpError(404, "Some of these creatives don't exist.");
  // One creative answers with its verdict, unless its text must be read or its logo compared first (that can outlast the studio's wait).
  const slow = async (row: typeof rows[number]) => needsServerOcr(row) || needsLogoRead(row, (await batchOf(row.batch_id))?.context?.logoUrl, false);
  if (own.length === 1 && !(await slow(rows[0]))) return { results: [await qaCreative(own[0])] };
  EdgeRuntime.waitUntil(qaMany(own));
  return { queued: own.length };
}

/**
 * A/B ad copy for one creative: the studio sends the instructions and input it built from the brand's
 * rules and the creative (studio/src/lib/creative-copy.ts), this asks OpenAI with the key it holds
 * (core/copy.ts) and returns the raw variants; the studio finishes and saves them.
 */
async function copyRoute(user: string, input: Record<string, any>) {
  const id = uuid(input.creativeId, "creative");
  const { data } = await db.from("creatives").select("id").eq("id", id).eq("user_id", user).maybeSingle();
  if (!data) throw new HttpError(404, "This creative doesn't exist.");
  const instructions = typeof input.instructions === "string" ? input.instructions : "";
  const text = typeof input.input === "string" ? input.input : "";
  if (instructions.length > COPY_INPUT_MAX || text.length > COPY_INPUT_MAX) throw new HttpError(400, "The copy request is too long.");
  try {
    return await writeCopy({ apiKey: await openAiKey(), model: (await models()).copy, instructions, input: text });
  } catch (error) {
    throw new HttpError(502, errorText(error));
  }
}

async function qaMany(ids: string[]) {
  const queue = [...ids];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) await qaCreative(id).catch((error) => console.error("qa", id, error));
  }));
}

interface QaRow {
  id: string; style: CreativeStyle; kind: "video" | "image"; aspect: string | null; prompt: string | null; copy: KnownCopy | null; ocr: OcrResult | null; batch_id: string | null; job_id: string | null;
  product_id: string; storage_path: string | null; mime: string | null;
  headline?: string | null; primary_text?: string | null;
  /** Static generation v2 columns (migration 20261009100000): absent until it's applied, so read defensively. */
  description?: string | null; copy_variants?: unknown;
}

async function qaCreative(id: string) {
  // Every column: the static generation v2 ones (description, copy_variants) exist only once their migration is applied.
  const { data } = await db.from("creatives").select("*").eq("id", id).maybeSingle();
  if (!data) throw new HttpError(404, "No such creative.");
  const creative = data as QaRow;
  const batch = await batchOf(creative.batch_id);
  const context: QaContext = batch?.context?.appName ? batch.context : await fallbackContext(creative.product_id);
  const { data: job } = creative.job_id ? await db.from("creative_jobs").select("params").eq("id", creative.job_id).maybeSingle() : { data: null };
  const params = (job as { params: Record<string, unknown> } | null)?.params ?? null;
  const placed = logoPlaced(params, creative.copy);
  await db.from("creatives").update({ qa_status: "running" }).eq("id", id);
  creative.ocr = await serverReads(creative, context.logoUrl, placed);
  // Written only while still running: if the file or its words changed meanwhile, the review trigger
  // set it back to pending and this verdict is about the old version (the tick runs QA again).
  const settle = (patch: Record<string, unknown>) => db.from("creatives").update({ ...patch, qa_at: new Date().toISOString() }).eq("id", id).eq("qa_status", "running");
  try {
    const report = await runQa({
      style: creative.style, kind: creative.kind, prompt: creative.prompt, copy: creative.copy ?? {}, ocr: creative.ocr,
      ...(creative.aspect ? { aspect: creative.aspect } : {}), logoPlaced: placed, realProduct: realProductUsed(params, creative.copy), adCopy: adCopyOf(creative),
    }, context, await aiJudge());
    await settle({ qa_status: report.verdict, qa: report });
    return { id, verdict: report.verdict };
  } catch (error) {
    await settle({ qa_status: "error", qa: { error: errorText(error), ranAt: new Date().toISOString() } });
    return { id, verdict: "error", error: errorText(error) };
  }
}

/**
 * Server reads before QA, with OpenAI vision: the image's text (images the server made, or any whose
 * text no OCR read) and, when the batch has a real logo we didn't place, a comparison of any logo on it
 * with the real one. Kept on the creative only while the file is still the one read. Never throws: a
 * failure is recorded in `ocr.error` (QA treats the text as unread) or `ocr.logo.error` (not compared).
 */
async function serverReads(creative: QaRow, logoUrl: string | undefined, placed: boolean): Promise<OcrResult | null> {
  const text = needsServerOcr(creative);
  const logo = needsLogoRead(creative, logoUrl, placed);
  if (!text && !logo) return creative.ocr;
  const path = creative.storage_path!;
  let ocr: OcrResult = creative.ocr ?? { engine: "none", frames: 0, lines: [] };
  try {
    const { data: file, error } = await db.storage.from(BUCKET).download(path);
    if (error || !file) throw new Error(`Couldn't load the image: ${error?.message ?? "missing file"}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = (creative.mime && creative.mime.startsWith("image/") ? creative.mime : file.type || mimeFromUrl(path)).split(";")[0];
    const apiKey = await openAiKey();
    const model = (await models()).vision;
    // A fresh read keeps a logo comparison that is still good for this file.
    if (text) ocr = { ...await readImageText({ apiKey, model, bytes, mime: type, source: path }), ...(!logo && ocr.logo ? { logo: ocr.logo } : {}) };
    if (logo) ocr = { ...ocr, logo: await readLogo({ apiKey, model, bytes, mime: type, source: path, logoUrl: logoUrl! }) };
  } catch (error) {
    if (text) ocr = { engine: "none", frames: 0, lines: [], error: `OCR failed: ${errorText(error)}`, source: path };
    if (logo) ocr = { ...ocr, logo: { visible: false, matches: "unsure", logoUrl: logoUrl!, source: path, error: `Logo check failed: ${errorText(error)}` } };
  }
  await db.from("creatives").update({ ocr }).eq("id", creative.id).eq("storage_path", path);
  return ocr;
}

/** For creatives without a batch: the product's name and known competitors. */
async function fallbackContext(productId: string): Promise<QaContext> {
  const { data } = await db.from("products").select("name, description, known_competitors").eq("id", productId).maybeSingle();
  const product = data as { name: string; description: string; known_competitors: string[] } | null;
  return { appName: product?.name ?? "the app", competitors: product?.known_competitors ?? [], policy: "general", forbiddenClaims: [], description: product?.description };
}

// MARK: Server-side runner (Higgsfield public API)

async function tick() {
  // Everything below shares this run's time limit, so OpenAI's image jobs count from here.
  const startedAt = Date.now();
  const rerun = await rerunQa();
  // OpenAI's image jobs run alongside (their requests take a minute or two each), never in Higgsfield's place.
  const [openai, higgsfield] = await Promise.all([
    openAiTick(startedAt).catch((error) => { console.error("openai tick", error); return { error: errorText(error) }; }),
    higgsfieldTick(),
  ]);
  return { ...higgsfield, openai, rerun };
}

/** A missing RPC (its migration isn't applied yet): PostgREST's "function not found". */
const missingFunction = (error: { code?: string; message?: string } | null) => Boolean(error && (error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "")));

/**
 * Queued Higgsfield API jobs, oldest first. Claimed with the provider filter
 * (20261005900000_image_provider.sql); before that migration, with the old claim, and any OpenAI job
 * it took is put straight back for the OpenAI worker (never made by Higgsfield).
 */
async function claimHiggsfieldJobs(limit: number): Promise<JobRow[]> {
  const args = { p_runner: "edge-api", p_backend: "api", p_models: [...API_MODELS], p_limit: limit, p_seconds: API_LEASE_SECONDS };
  const scoped = await db.rpc("creatives_claim_jobs", { ...args, p_provider: "higgsfield" });
  if (!scoped.error) return (scoped.data ?? []) as JobRow[];
  if (!missingFunction(scoped.error)) throw new Error(scoped.error.message);
  const { data, error } = await db.rpc("creatives_claim_jobs", args);
  if (error) throw new Error(error.message);
  const jobs = (data ?? []) as JobRow[];
  for (const job of jobs.filter((j) => jobProvider(j.params) === "openai")) {
    await db.from("creative_jobs").update({ status: "queued", runner_id: null, lease_until: null, attempts: Math.max(0, job.attempts - 1) }).eq("id", job.id).eq("status", "running");
  }
  return jobs.filter((j) => jobProvider(j.params) === "higgsfield");
}

async function higgsfieldTick() {
  const key = await secrets.get("HIGGSFIELD_API_KEY");
  if (!key) return { api: false };
  const api = higgsfieldApi(key);
  const limit = Number(env("HIGGSFIELD_API_CONCURRENCY")) || 4;

  const { data: running } = await db.from("creative_jobs").select("*").eq("status", "running").eq("backend", "api");
  // OpenAI's jobs are running too, but there's nothing of theirs to poll at Higgsfield.
  const active = ((running ?? []) as JobRow[]).filter((j) => jobProvider(j.params) === "higgsfield");
  for (const job of active) {
    if (!job.external_id) continue;
    let result: Awaited<ReturnType<typeof api.status>>;
    try {
      result = await api.status(job.external_id);
    } catch (error) {
      await pollLater(job, errorText(error));
      continue;
    }
    if (!isTerminal(result.status)) {
      await db.from("creative_jobs").update({ lease_until: new Date(Date.now() + API_LEASE_SECONDS * 1000).toISOString() }).eq("id", job.id).eq("status", "running");
      continue;
    }
    if (result.status !== "completed") {
      await db.from("creative_jobs").update(afterRequestEnded(result.status, result.error)).eq("id", job.id);
      continue;
    }
    // A second tick that sees the same finished job gets null here and leaves it alone.
    await finalize(job, () => collectOutputs(job, outputUrls(result))).catch((error) => pollLater(job, errorText(error)));
  }

  const free = Math.max(0, limit - active.filter((j) => j.external_id).length);
  if (!free) return { api: true, polled: active.length, submitted: 0 };
  const claimed = await claimHiggsfieldJobs(free);
  let submitted = 0;
  for (const job of claimed) {
    // Already submitted (its lease ran out while ticks stopped): poll it on the next tick, never pay twice.
    if (!shouldSubmit(job)) continue;
    const batch = await batchOf(job.batch_id);
    // In the order the prompt describes: the competitor's image (Recreate), our logo, our own picked images, then our screens.
    // `image_refs` (the Playground) is that list already, exact and in order: the reference, then the person's images.
    const refs = referenceUrls(job.params, batch?.settings?.brand?.screenshotUrls);
    const request = apiRequestFor(job.model, job.prompt, { ...job.params, aspect_ratio: job.params.aspect_ratio ?? job.aspect }, refs);
    if (!request) { await requeueOrFail(job, "Only the local runner can run this model.", false, 0); continue; }
    try {
      // Higgsfield's free estimate first: a job that costs much more than the batch's confirmed
      // estimate fails here instead of spending (core/jobs.ts PRICE_TOLERANCE: the runner's rule too).
      const estimate = Number((await api.estimate(request)).credits);
      const allowed = priceLimit(job.cost_estimate);
      if (Number.isFinite(estimate) && job.cost_estimate > 0 && estimate > allowed) {
        await requeueOrFail(job, `Higgsfield's API quotes ${estimate} credits for this job; the batch was confirmed at ${job.cost_estimate}. Not submitted. Make it again to confirm the new price.`, false, 0);
        continue;
      }
      const result = await api.submit(request, job.id);
      // The charge as Higgsfield quoted it (the API reports no other); afterRequestEnded clears it to 0
      // when the request ends without a result.
      await db.from("creative_jobs").update({ external_id: result.request_id, ...(Number.isFinite(estimate) ? { cost_credits: estimate } : {}) }).eq("id", job.id);
      submitted++;
    } catch (error) {
      // Only a submit (or estimate) error puts a job back in the queue, and only when Higgsfield was busy:
      // 429, a concurrency refusal, or a 502 / 503. Each one waits longer (busyBackoff); the resubmit
      // carries the same Idempotency-Key, so a 503'd request that did get through isn't made twice.
      const busy = error instanceof HiggsfieldApiError && error.busy;
      const message = busy ? `Higgsfield's API is busy (${(error as HiggsfieldApiError).status}); trying again later. ${errorText(error)}` : errorText(error);
      await requeueOrFail(job, message, busy, busy ? busyBackoff(job.retries) : 0);
    }
  }
  return { api: true, polled: active.length, submitted };
}

// MARK: Server-side runner (OpenAI Images API)

/**
 * Image jobs whose provider is "openai" (core/openai_jobs.ts). First the requests already handed to
 * OpenAI are collected; then up to OPENAI_IMAGE_CONCURRENCY (3) queued jobs are taken, and each is
 * either awaited in this run or handed over to be collected by a later one, whichever fits the plan's
 * time limit. A job that carries a request is never sent again. Without a key they fail at once with
 * what to do, instead of waiting in the queue.
 */
async function openAiTick(startedAt = Date.now()) {
  const key = await openAiKey();
  const limit = Number(env("OPENAI_IMAGE_CONCURRENCY")) || 3;
  const steps: JobStep[] = [];
  if (key) {
    // Requests waiting at OpenAI: look at each, save the ones that are ready.
    const { data: waiting } = await db.from("creative_jobs").select("*").eq("status", "running").eq("backend", "api").eq("runner_id", OPENAI_RUNNER)
      .eq("params->>provider", "openai").like("external_id", `${OPENAI_BACKGROUND}%`).order("created_at").limit(20);
    for (const job of (waiting ?? []) as OpenAiJobRow[]) steps.push(await advanceOpenAiJob(job, await openAiJobDeps(job, key, startedAt)));
  }
  const { count } = await db.from("creative_jobs").select("id", { count: "exact", head: true })
    .eq("status", "running").eq("backend", "api").eq("params->>provider", "openai").gt("lease_until", new Date().toISOString());
  const free = key ? Math.max(0, limit - (count ?? 0)) : 20;
  const jobs = await claimOpenAiJobs(free);
  if (!key) {
    for (const job of jobs) await settleOpenAi(job, afterOpenAiFailure(job, { retryable: false, message: `OpenAI isn't connected. ${addKeyMessage("OPENAI_API_KEY")} Then retry, or try with Higgsfield instead.` }));
    return { claimed: jobs.length, failed: jobs.length };
  }
  steps.push(...await Promise.all(jobs.map(async (job) => advanceOpenAiJob(job, await openAiJobDeps(job, key, startedAt)))));
  const count_ = (step: JobStep) => steps.filter((s) => s === step).length;
  return { claimed: jobs.length, made: count_("made"), submitted: count_("submitted"), waiting: count_("pending"), failed: count_("failed") };
}

type OpenAiJobRow = JobRow & { started_at: string | null };

/** Queued OpenAI jobs, oldest first, each taken with a conditional update (queued → running) so two ticks never take one. */
async function claimOpenAiJobs(limit: number): Promise<OpenAiJobRow[]> {
  if (limit <= 0) return [];
  const now = new Date();
  const { data } = await db.from("creative_jobs").select("*").eq("status", "queued").eq("backend", "api").eq("params->>provider", "openai")
    .or(`not_before.is.null,not_before.lte.${now.toISOString()}`).order("created_at").limit(Math.min(limit, 20));
  const taken: OpenAiJobRow[] = [];
  for (const job of (data ?? []) as OpenAiJobRow[]) {
    const { data: row } = await db.from("creative_jobs").update({
      status: "running", runner_id: OPENAI_RUNNER, attempts: job.attempts + 1, error: null,
      lease_until: new Date(now.getTime() + API_LEASE_SECONDS * 1000).toISOString(), started_at: job.started_at ?? now.toISOString(),
    }).eq("id", job.id).eq("status", "queued").select("*");
    if (row?.length) taken.push(row[0] as OpenAiJobRow);
  }
  return taken;
}

/** Writes a job's outcome while this worker still holds it (a cancelled or retaken job is left alone). */
const settleOpenAi = (job: JobRow, patch: Record<string, unknown>) =>
  db.from("creative_jobs").update(patch).eq("id", job.id).eq("status", "running").eq("runner_id", OPENAI_RUNNER);

/** What core/openai_jobs.ts needs to take one job a step further: this install's plan, models, storage and queue. */
async function openAiJobDeps(job: OpenAiJobRow, key: string, startedAt: number): Promise<OpenAiJobDeps> {
  const use = await models();
  return {
    apiKey: key,
    limits: await planLimits(),
    collect: collectSetting(env("OPENAI_IMAGE_COLLECT")),
    usedMs: () => Date.now() - startedAt,
    textModel: use.text,
    imageModels: { image: use.image, imageEdit: use.imageEdit },
    leaseSeconds: API_LEASE_SECONDS,
    // The reference images, as files, in the order the prompt numbers them (the Higgsfield API's order).
    async references() {
      const batch = await batchOf(job.batch_id);
      const urls = referenceUrls(job.params, batch?.settings?.brand?.screenshotUrls);
      const images: { bytes: Uint8Array; mime: string; name: string }[] = [];
      for (const [i, url] of urls.entries()) {
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
        if (!response?.ok) throw new Error(`Couldn't load reference image ${i + 1} (${response?.status ?? "no answer"}); nothing was sent to OpenAI.`);
        const mime = (response.headers.get("content-type")?.split(";")[0] || mimeFromUrl(url)).toLowerCase();
        const type = ["image/png", "image/jpeg", "image/webp"].includes(mime) ? mime : "image/png";
        images.push({ bytes: new Uint8Array(await response.arrayBuffer()), mime: type, name: `reference-${i + 1}.${extensionFor(type)}` });
      }
      return images;
    },
    async hold(patch: Record<string, unknown>) {
      const { data } = await settleOpenAi(job, patch).select("id");
      return Boolean(data?.length);
    },
    async release(patch: Record<string, unknown>) {
      await db.from("creative_jobs").update(patch).eq("id", job.id).in("status", ["running", "finalizing"]);
    },
    async alreadySaved() {
      const { data } = await db.from("creatives").select("id").eq("job_id", job.id).limit(1);
      return Boolean(data?.length);
    },
    async save(images: Uint8Array[], done: Record<string, unknown> | null) {
      const ids = await finalize({ ...job, runner_id: OPENAI_RUNNER }, () => (images.length ? storeOpenAiImages(job, images) : Promise.resolve([])), done ?? {});
      return ids !== null;
    },
  };
}

/** OpenAI's images into the creatives bucket, named as the API worker names Higgsfield's. QA reads their text afterwards (serverOcr). */
async function storeOpenAiImages(job: JobRow, images: Uint8Array[]): Promise<Output[]> {
  const outputs: Output[] = [];
  for (const [i, bytes] of images.entries()) {
    const path = storagePath(job.product_id, job.created_at, job.id, `${job.kind}-${job.aspect.replace(":", "x")}-v${job.variant}${i ? `-${i}` : ""}.png`);
    const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: "image/png", upsert: true });
    if (error) throw new Error(`Couldn't store the result: ${error.message}`);
    outputs.push({ path, kind: "image", mime: "image/png", sizeBytes: bytes.length, ...(imageSize(bytes) ?? {}) });
  }
  return outputs;
}

/** Downloads a finished API job's files into the creatives bucket. */
async function collectOutputs(job: JobRow, urls: string[]): Promise<Output[]> {
  const outputs: Output[] = [];
  for (const [i, url] of urls.entries()) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Couldn't download the result (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mime = response.headers.get("content-type")?.split(";")[0] || mimeFromUrl(url);
    const path = storagePath(job.product_id, job.created_at, job.id, `${job.kind}-${job.aspect.replace(":", "x")}-v${job.variant}${i ? `-${i}` : ""}.${extensionFor(mime)}`);
    const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
    if (error) throw new Error(`Couldn't store the result: ${error.message}`);
    const size = mime.startsWith("image/") ? imageSize(bytes) : null;
    const durationSec = mime.startsWith("video/") && Number(job.params.duration) ? Number(job.params.duration) : undefined;
    // Images: QA reads their text first (serverOcr). Videos: the server has no frames to read (the
    // local runner samples them with ffmpeg), so their on-screen text stays unread.
    const video = mime.startsWith("video/");
    const ocr: OcrResult | undefined = video ? { engine: "none", frames: 0, lines: [], error: "Server-made videos aren't read: the server has no frames to read (the local runner reads video frames)." } : undefined;
    outputs.push({ path, kind: video ? "video" : "image", mime, sizeBytes: bytes.length, sourceUrl: url, durationSec, ...(size ?? {}), ocr });
  }
  return outputs;
}

/**
 * Creatives whose file or words changed after QA (the creatives_review_stamp trigger marks them
 * `qa.rerun` and pending): QA runs again for those the studio didn't already re-run within a minute.
 */
async function rerunQa() {
  const { data } = await db.from("creatives").select("id").eq("qa_status", "pending").eq("qa->>rerun", "true")
    .lt("updated_at", new Date(Date.now() - 60_000).toISOString()).order("updated_at").limit(20);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length) EdgeRuntime.waitUntil(qaMany(ids));
  return ids.length;
}
