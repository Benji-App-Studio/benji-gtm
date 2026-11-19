// The Higgsfield CLI, as the runner uses it: build `generate create` / `generate cost` arguments from a
// job, submit without waiting and then `generate wait <id>` (a dropped wait never resubmits), parse the
// JSON it prints, find an earlier submission of the same job in `generate list` after a crash, sort
// errors into retry-later and give-up, and set up Marketing Studio products (from the App Store page or
// the brand kit's screenshots). `exec` is injectable, so dry runs and tests use fixtures and never
// touch Higgsfield.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jobCost } from "../../studio/src/lib/creative-plan.ts";
import { CUTOUT_CREDITS, CUTOUT_MODEL } from "../../studio/src/lib/product-assets.ts";
import type { RunnerJob } from "./types.ts";

/** `--name value` pairs back into params (for the fixture's price list). */
export function argParams(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length - 1; i++) if (args[i].startsWith("--")) out[args[i].slice(2)] = args[i + 1];
  return out;
}

export interface ExecResult { code: number; stdout: string; stderr: string }
export type Exec = (args: string[], o?: { timeoutMs?: number }) => Promise<ExecResult>;

/** Runs the real CLI. */
export function cliExec(bin = process.env.HIGGSFIELD_BIN || "higgsfield"): Exec {
  return (args, o = {}) => new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HIGGSFIELD_NO_UPDATE_CHECK: "1", NO_COLOR: "1" } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = o.timeoutMs ? setTimeout(() => child.kill("SIGTERM"), o.timeoutMs) : null;
    child.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
    child.on("error", (error) => { if (timer) clearTimeout(timer); resolve({ code: 127, stdout, stderr: String(error) }); });
  });
}

/** What the fixture CLI does: prices × costFactor, a failing create, how a job ends, what `generate list` holds. */
export interface FixtureOptions {
  costFactor?: number;
  /** `generate create` fails with this text (nothing is created). */
  failWith?: string;
  /** What the finished job(s) report charging. */
  charged?: number;
  /** `generate create` fails with this text, but the job was created anyway (a 503 after the submit got through). */
  createdButFailWith?: string;
  /** `generate wait` drops with this text (the job keeps running). */
  waitFailWith?: string;
  /** Higgsfield ends the job with this status and reason instead of a result. */
  endWith?: { status: string; reason?: string; credits?: number };
  /** `generate get` reports this status (default: how the job ends). */
  getStatus?: string;
  /** Jobs `generate list` shows besides the ones created through this fixture. */
  listJobs?: Record<string, unknown>[];
  /** `generate list` fails with this text. */
  listFailWith?: string;
}

/**
 * A stand-in for the CLI that answers from fixtures: costs from the studio's price list (× costFactor),
 * `create` with a queued job (or, with `--wait`, the finished one), `wait` / `get` with the finished job
 * pointing at a fixture file, `list` with the jobs it created, catalogs and product ids. Nothing leaves the Mac.
 */
export function fixtureExec(fixtures: string, o: FixtureOptions = {}): Exec & { calls: string[][] } {
  const calls: string[][] = [];
  const output = JSON.parse(readFileSync(join(fixtures, "create-output.json"), "utf8"));
  const catalog = JSON.parse(readFileSync(join(fixtures, "catalog.json"), "utf8"));
  const ok = (value: unknown): ExecResult => ({ code: 0, stdout: JSON.stringify(value), stderr: "" });
  const isVideo = (model: string) => model === "marketing_studio_video" || model === "seedance_2_5";
  // The jobs "created" so far: id → model and the params it was sent with.
  const created = new Map<string, { model: string; params: Record<string, unknown>; createdAt: string }>();
  let next = 101;
  const finished = (id: string): Record<string, unknown> => {
    const made = created.get(id);
    const video = made ? isVideo(made.model) : id.endsWith("2");
    const base = (video ? output.video : output.image)[0] as Record<string, unknown>;
    const job = { ...base, id, ...(made ? { job_type: made.model, params: made.params, created_at: made.createdAt } : {}) };
    if (o.endWith) return { ...job, status: o.endWith.status, result_url: null, min_result_url: null, ...(o.endWith.reason ? { error: o.endWith.reason } : {}), ...(o.endWith.credits !== undefined ? { credits: o.endWith.credits } : {}) };
    return o.charged === undefined ? job : { ...job, credits: o.charged };
  };
  const exec = (async (args: string[]) => {
    calls.push(args);
    const [a, b, c] = args;
    if (o.failWith && a === "generate" && b === "create") return { code: 1, stdout: "", stderr: o.failWith };
    if (a === "generate" && b === "cost") return ok({ credits: (c === CUTOUT_MODEL ? CUTOUT_CREDITS : jobCost(c, argParams(args))) * (o.costFactor ?? 1) });
    if (a === "generate" && b === "create") {
      if (args.includes("--wait")) {
        // The old way (create and wait in one call): the finished jobs.
        const jobs = (isVideo(c) ? output.video : output.image) as Record<string, unknown>[];
        return ok(o.charged === undefined ? jobs : jobs.map((j) => ({ ...j, credits: o.charged })));
      }
      const id = `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
      created.set(id, { model: c, params: { ...argParams(args), prompt: args[args.indexOf("--prompt") + 1] }, createdAt: new Date().toISOString() });
      if (o.createdButFailWith) return { code: 1, stdout: "", stderr: o.createdButFailWith };
      return ok([{ id, job_type: c, status: "queued", result_url: null, min_result_url: null, created_at: created.get(id)!.createdAt, params: created.get(id)!.params }]);
    }
    if (a === "generate" && b === "wait") {
      if (o.waitFailWith) return { code: 1, stdout: "", stderr: o.waitFailWith };
      const job = finished(c);
      return o.endWith ? { code: 1, stdout: JSON.stringify(job), stderr: `Job ${c} ended with status "${o.endWith.status}"` } : ok(job);
    }
    if (a === "generate" && b === "get") {
      const job = finished(c);
      return ok(o.getStatus ? { ...job, status: o.getStatus, ...(o.getStatus === "completed" ? {} : { result_url: null }) } : job);
    }
    if (a === "generate" && b === "list") {
      if (o.listFailWith) return { code: 1, stdout: "", stderr: o.listFailWith };
      const mine = [...created.entries()].map(([id, j]) => ({ id, job_type: j.model, status: "in_progress", created_at: j.createdAt, params: j.params, result_url: null }));
      return ok([...mine.reverse(), ...(o.listJobs ?? [])]);
    }
    if (a === "marketing-studio" && c === "list") return ok(catalog[b]);
    if (a === "marketing-studio" && (c === "fetch" || c === "create")) return ok({ id: `fixture-${b}-id`, status: "completed" });
    if (a === "upload") return ok({ id: "fixture-upload-id", url: "https://cdn.example.com/fixture/upload.png" });
    if (a === "account") return ok({ plan: "fixture", credits: 1000 });
    return { code: 1, stdout: "", stderr: `fixture: no answer for ${args.join(" ")}` };
  }) as Exec & { calls: string[][] };
  exec.calls = calls;
  return exec;
}

// MARK: Arguments

/** Marketing Studio product references for a video job (resolved by `ensureProduct`). */
export interface ProductRefs { productIds?: string[]; webProductIds?: string[] }

/** JSON-array params go through files (`--avatars @file.json`), as the CLI asks. */
export interface Args { args: string[]; files: { path: string; content: string }[] }

/** Reference images a Seedance job sends at most (the model takes 30; the plan sends up to 4 + 3 + 4). */
export const SEEDANCE_REFERENCES = 11;

export function createArgs(job: RunnerJob, refs: ProductRefs, workdir: string, imagePaths: string[] = []): Args {
  const p = job.params;
  const files: Args["files"] = [];
  const jsonParam = (name: string, value: unknown) => {
    const path = join(workdir, `${name}.json`);
    files.push({ path, content: JSON.stringify(value) });
    return [`--${name}`, `@${path}`];
  };
  const str = (v: unknown, fallback: string) => (v === undefined || v === null || v === "" ? fallback : String(v));
  if (job.model === "marketing_studio_video") {
    const args = [
      "marketing_studio_video", "--prompt", job.prompt,
      "--mode", str(p.mode, "ugc"), "--duration", str(p.duration, "15"), "--resolution", str(p.resolution, "720p"),
      "--aspect_ratio", str(p.aspect_ratio, job.aspect), "--generate_audio", String(p.generate_audio !== false),
    ];
    if (Array.isArray(p.avatars) && p.avatars.length) args.push(...jsonParam("avatars", p.avatars));
    if (refs.productIds?.length) args.push(...jsonParam("product_ids", refs.productIds));
    if (refs.webProductIds?.length) args.push(...jsonParam("web_product_ids", refs.webProductIds), "--specific_mode", "web_product", "--web_product_type", "mobile");
    if (typeof p.hook_id === "string") args.push("--hook_id", p.hook_id);
    if (typeof p.setting_id === "string") args.push("--setting_id", p.setting_id);
    return { args, files };
  }
  if (job.model === "gpt_image_2_5") {
    const args = ["gpt_image_2_5", "--prompt", job.prompt, "--aspect_ratio", str(p.aspect_ratio, job.aspect), "--resolution", str(p.resolution, "2k"), "--quality", str(p.quality, "medium"), "--variant", str(p.variant, "flare")];
    for (const path of imagePaths.slice(0, 4)) args.push("--image", path);
    return { args, files };
  }
  if (job.model === "marketing_studio_image") {
    const args = ["marketing_studio_image", "--prompt", job.prompt, "--aspect_ratio", str(p.aspect_ratio, job.aspect), "--resolution", str(p.resolution, "2k")];
    for (const path of imagePaths.slice(0, 4)) args.push("--image", path);
    return { args, files };
  }
  if (job.model === "seedance_2_5") {
    // Text-to-video, or omni_reference with the reference images (a recreated ad's key frames first,
    // then our images, then the screenshots: the order the prompt numbers them). No 4:5 here: 3:4.
    // A Playground start frame (`start_frame`) is the first image: sent as --start-image, so the clip opens on it.
    const aspect = str(p.aspect_ratio, job.aspect);
    const start = typeof p.start_frame === "string" && imagePaths.length ? imagePaths[0] : null;
    const args = [
      "seedance_2_5", "--prompt", job.prompt, "--mode", imagePaths.length ? "omni_reference" : "t2v",
      "--duration", str(p.duration, "10"), "--resolution", str(p.resolution, "720p"),
      "--aspect_ratio", aspect === "4:5" ? "3:4" : aspect, "--generate_audio", String(p.generate_audio !== false), "--bitrate_mode", "high",
    ];
    if (start) args.push("--start-image", start);
    for (const path of imagePaths.slice(start ? 1 : 0, SEEDANCE_REFERENCES)) args.push("--image-references", path);
    return { args, files };
  }
  if (job.model === CUTOUT_MODEL) {
    // Product cut-outs (Product page → "Make cut-out"): exactly one image in, a transparent PNG out.
    if (!imagePaths.length) throw new Error("A cut-out needs its product image.");
    return { args: [CUTOUT_MODEL, "--image", imagePaths[0]], files };
  }
  throw new Error(`The runner can't make ${job.model}.`);
}

export const costCommand = (a: Args) => ["generate", "cost", ...a.args, "--json"];
/** Submits only (no `--wait`): the job id comes back at once, to be saved before waiting. */
export const createCommand = (a: Args) => ["generate", "create", ...a.args, "--json"];
/** Waits for one submitted job; when it drops, the job keeps running and is collected later, never resubmitted. */
export const waitCommand = (id: string, timeout = "30m") => ["generate", "wait", id, "--timeout", timeout, "--quiet", "--json"];
export const getCommand = (id: string) => ["generate", "get", id, "--json"];
const VIDEO_MODELS = ["marketing_studio_video", "seedance_2_5"];
/** Recent jobs of the model's kind (image or video), newest first. */
export const listCommand = (model: string, size = 50) => ["generate", "list", VIDEO_MODELS.includes(model) ? "--video" : "--image", "--size", String(size), "--json"];

// MARK: Output

export interface CreatedJob {
  id: string; status: string; resultUrl: string | null; minResultUrl: string | null;
  /** What the job cost, when the CLI's output says (`credits`, `cost` or `credits_used`); null otherwise. */
  credits: number | null;
  /** Why Higgsfield ended it, when it says. */
  reason: string | null;
  jobType: string | null;
  /** When it was created (ms), when the output says. */
  createdAt: number | null;
  /** What it was made with (the prompt, the ratio, the length…), as Higgsfield echoes it back. */
  params: Record<string, unknown>;
}

function parseJob(j: Record<string, unknown>): CreatedJob {
  const params = j.params && typeof j.params === "object" ? j.params as Record<string, unknown> : {};
  const text = (...vs: unknown[]) => vs.find((v): v is string => typeof v === "string" && v.trim() !== "") ?? null;
  const created = Date.parse(String(j.created_at ?? j.createdAt ?? ""));
  return {
    id: String(j.id ?? j.job_id ?? ""), status: String(j.status ?? ""),
    resultUrl: typeof j.result_url === "string" ? j.result_url : null,
    minResultUrl: typeof j.min_result_url === "string" ? j.min_result_url : null,
    credits: creditsOf(j),
    reason: text(j.error, j.error_message, j.failure_reason, j.reason, j.message, (j.error as { message?: unknown } | null)?.message),
    jobType: text(j.job_type, j.type, j.model),
    createdAt: Number.isFinite(created) ? created : null,
    params: { ...params, ...(typeof j.prompt === "string" && params.prompt === undefined ? { prompt: j.prompt } : {}) },
  };
}

/** The job objects `generate create|wait|get|list --json` print (an array; sometimes one object or a page of `jobs`/`items`). */
export function parseCreateOutput(stdout: string): CreatedJob[] {
  const start = stdout.search(/[[{]/);
  if (start < 0) throw new Error(`Higgsfield printed no JSON: ${stdout.slice(0, 200)}`);
  const parsed = JSON.parse(stdout.slice(start));
  const list = (Array.isArray(parsed) ? parsed : parsed.jobs ?? parsed.items ?? parsed.data ?? [parsed]) as Record<string, unknown>[];
  return list.filter((j) => j && typeof j === "object").map(parseJob);
}

/** Jobs Higgsfield ended without a result (failed, nsfw, canceled): its word that the job is over. */
export const isEnded = (status: string) => ["failed", "nsfw", "canceled", "cancelled"].includes(status.toLowerCase());
export const isCompleted = (job: CreatedJob) => job.status.toLowerCase() === "completed" && Boolean(job.resultUrl);

// MARK: Earlier submissions

/** Media flags (local paths become new uploads each time, so they can't be compared) and @file params. */
const MEDIA_FLAGS = new Set(["image", "image-references", "start-image", "end-image", "video", "video-references", "audio", "audio-references"]);

/** A create's comparable settings: `--name value` pairs, without media or @file params. */
export function scalarParams(a: Args): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 1; i < a.args.length - 1; i++) {
    const flag = a.args[i];
    if (!flag.startsWith("--")) continue;
    const name = flag.slice(2), value = a.args[i + 1];
    i++;
    if (MEDIA_FLAGS.has(name) || value.startsWith("@")) continue;
    out[name] = value;
  }
  return out;
}

/** How far back an earlier submission is looked for after a crash (the spec's 30 minutes). */
export const LOOKBACK_MS = 30 * 60_000;

/**
 * Jobs in `generate list` that are this create submitted before (a crash or a dropped submit between
 * Higgsfield taking it and the runner saving its id): the same model, the same prompt, the same settings
 * (each setting Higgsfield echoes back must match), made in the last 30 minutes (or since `since`), and
 * not ended without a result. Newest first. A job without a creation time is never taken: it can't be
 * shown to be recent.
 */
export function earlierSubmissions(listed: CreatedJob[], a: Args, o: { now?: number; since?: number } = {}): CreatedJob[] {
  const now = o.now ?? Date.now();
  // A minute's slack for clocks (ours and Higgsfield's), never past the 30 minutes.
  const since = Math.max(o.since === undefined ? 0 : o.since - 60_000, now - LOOKBACK_MS);
  const model = a.args[0];
  const ours = scalarParams(a);
  const norm = (v: unknown) => String(v).trim().toLowerCase();
  return listed
    .filter((j) => j.id && (!j.jobType || j.jobType === model) && !isEnded(j.status))
    .filter((j) => j.createdAt !== null && j.createdAt >= since && j.createdAt <= now + 60_000)
    .filter((j) => typeof j.params.prompt === "string" && j.params.prompt.trim() === String(ours.prompt ?? "").trim())
    .filter((j) => Object.entries(ours).every(([k, v]) => k === "prompt" || j.params[k] === undefined || j.params[k] === null || norm(j.params[k]) === norm(v)))
    .sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0));
}

/**
 * A failed `generate create` that may still have created the job (a 5xx, a timeout, a dropped
 * connection: the submit may have got through before the answer was lost). Refusals Higgsfield answered
 * outright (login, rate limit, concurrency, moderation, credits, invalid settings) created nothing.
 */
export function submitMayHaveGoneThrough(text: string): boolean {
  if (/session expired|not authenticated|stored credentials|rate_limit|rate limit|HTTP 4\d\d|concurrent requests|too many requests|nsfw|ip_detected|not enough credits|insufficient credits|invalid|validation|unknown (flag|param)|ENOTFOUND/i.test(text)) return false;
  return true;
}

function creditsOf(j: Record<string, unknown>): number | null {
  for (const key of ["credits", "cost", "credits_used", "credits_spent"]) {
    const v = j[key];
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/** The charge the CLI reported for a finished create (summed over its jobs), or null when any job doesn't say. */
export function chargedCredits(jobs: CreatedJob[]): number | null {
  if (!jobs.length || jobs.some((j) => j.credits === null)) return null;
  return Math.round(jobs.reduce((n, j) => n + (j.credits ?? 0), 0) * 100) / 100;
}

export function parseCredits(stdout: string): number | null {
  try {
    const value = JSON.parse(stdout.slice(Math.max(0, stdout.search(/[[{]/))));
    const credits = Number(value.credits ?? value.cost ?? value.total);
    return Number.isFinite(credits) ? credits : null;
  } catch {
    return null;
  }
}

// MARK: Errors

export interface Classified { retryable: boolean; retryAfterSec: number; auth: boolean; message: string }

/** Which failures are worth another go later (busy, rate-limited, timeouts, anti-bot) and which aren't. */
export function classify(text: string): Classified {
  const message = text.replace(/\s+/g, " ").trim().slice(0, 500) || "The Higgsfield CLI failed without a message.";
  if (/session expired|not authenticated|stored credentials are for/i.test(text)) return { retryable: true, retryAfterSec: 600, auth: true, message: `Higgsfield login expired on the runner's Mac: run \`higgsfield auth login\`. (${message})` };
  if (/rate_limit_reached|rate limit|HTTP 429|concurrent requests|too many requests/i.test(text)) return { retryable: true, retryAfterSec: 90, auth: false, message };
  if (/captcha|datadome|HTTP 50[234]|\b50[23]\b|bad gateway|service unavailable|timeout after|timed out|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(text)) return { retryable: true, retryAfterSec: 120, auth: false, message };
  if (/nsfw|ip_detected/i.test(text)) return { retryable: false, retryAfterSec: 0, auth: false, message: `Higgsfield's moderation rejected it; rephrase the brief. (${message})` };
  if (/not enough credits|insufficient credits|balance/i.test(text)) return { retryable: true, retryAfterSec: 1800, auth: false, message: `Out of Higgsfield credits. (${message})` };
  return { retryable: false, retryAfterSec: 0, auth: false, message };
}

/** Parses JSON a CLI command printed, or throws with its error text. */
export async function runJson<T>(exec: Exec, args: string[], timeoutMs = 120_000): Promise<T> {
  const { code, stdout, stderr } = await exec(args, { timeoutMs });
  if (code !== 0) throw new Error(stderr || stdout || `higgsfield ${args[0]} exited with ${code}`);
  const start = stdout.search(/[[{]/);
  if (start < 0) throw new Error(`higgsfield ${args.slice(0, 3).join(" ")} printed no JSON`);
  return JSON.parse(stdout.slice(start)) as T;
}
