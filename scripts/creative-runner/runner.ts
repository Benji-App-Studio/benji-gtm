// The creative runner: runs the studio's Higgsfield jobs with the Higgsfield CLI logged in on this Mac.
// It claims queued jobs from the `creatives` edge function, checks each job's live price (free),
// submits it (`generate create --json`, no wait) and saves the Higgsfield job id at once, then waits
// with `generate wait <id>`, downloads the result, takes a poster frame and reads the on-screen text
// (macOS Vision), uploads to Supabase Storage through signed URLs and reports back; the backend then
// runs QA. At most 4 jobs run at once (Higgsfield's pro-plan concurrency); busy and rate-limit answers
// go back to the queue for later.
//
// Never pay twice: a job that comes back with a Higgsfield job id is only collected; a dropped wait
// goes back to the queue keeping the id; and a job claimed again without one (a crash between submit
// and save) is first looked for in `generate list` (same model, prompt and settings, last 30 minutes).
// Credits held for a submit are given back to the session budget only when Higgsfield confirms the job
// ended without a charge (or that nothing was created).
//
//   npx tsx scripts/creative-runner/runner.ts --dry-run --offline /tmp/creative-dry-run --once   # nothing leaves the Mac
//   npx tsx scripts/creative-runner/runner.ts --dry-run --once      # real queue, fixture media (no Higgsfield calls)
//   npx tsx scripts/creative-runner/runner.ts                       # real generations (spends Higgsfield credits)
// (in the source repository, `npm run creative-runner --` is the same command)
//
// Settings come from the environment or ~/.config/creative-runner/runner.env:
//   CREATIVES_FUNCTION_URL   your project's creatives function: https://<project ref>.supabase.co/functions/v1/creatives
//                            (required unless --offline)
//   CREATIVES_RUNNER_SECRET  the secret from the app's Settings > Desktop runner page (required unless --offline)
//   SUPABASE_PUBLISHABLE_KEY optional, sent as `apikey`
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { priceLimit } from "../../supabase/functions/creatives/core/jobs.ts";
import { type Args, chargedCredits, classify, cliExec, costCommand, createArgs, createCommand, type CreatedJob, earlierSubmissions, type Exec, fixtureExec, getCommand, isCompleted, isEnded, listCommand, parseCreateOutput, parseCredits, type ProductRefs, runJson, SEEDANCE_REFERENCES, submitMayHaveGoneThrough, waitCommand } from "./higgsfield.ts";
import { CACHE, download, EARLIER_CACHE, FIXTURES, imageDimensions, mimeOf, ocr, poster, probe, sampleFrames } from "./media.ts";
import { folderQueue, remoteQueue } from "./queue.ts";
import type { Output, Queue, RunnerJob } from "./types.ts";
import { CUTOUT_MODEL, cutoutAssetId } from "../../studio/src/lib/product-assets.ts";

/** What this runner makes: the studio's models, and product cut-outs (Higgsfield's background remover, CLI only). */
export const MODELS = ["marketing_studio_video", "gpt_image_2_5", "marketing_studio_image", "seedance_2_5", CUTOUT_MODEL];
/**
 * A job whose live price is above priceLimit(estimate) is refused: 1.5× the estimate the user confirmed
 * or 2 credits more, whichever is higher (PRICE_TOLERANCE in supabase/functions/creatives/core/jobs.ts,
 * the same rule the API worker uses).
 */
export { PRICE_TOLERANCE } from "../../supabase/functions/creatives/core/jobs.ts";

export interface RunnerOptions {
  queue: Queue;
  exec: Exec;
  runnerId: string;
  concurrency: number;
  workdir: string;
  ocr: boolean;
  maxCredits: number;
  log: (message: string) => void;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov" };

// MARK: Products

const productCacheFile = () => join(CACHE, "products.json");
function productCache(): Record<string, string> {
  try { return JSON.parse(readFileSync(productCacheFile(), "utf8")); } catch { return {}; }
}
function remember(key: string, id: string) {
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(productCacheFile(), JSON.stringify({ ...productCache(), [key]: id }, null, 1));
}

/** The Marketing Studio product for a video job: from the App Store page, or from the brand kit's screenshots (cached per source). */
export async function ensureProduct(job: RunnerJob, exec: Exec, workdir: string): Promise<ProductRefs> {
  const brand = job.brand;
  const source = job.params.product;
  if (!brand || source === "none" || job.model !== "marketing_studio_video") return {};
  if (source === "app_store" && brand.appStoreUrl) {
    const key = `${job.product_id}:app_store:${brand.appStoreUrl}`;
    const cached = productCache()[key];
    if (cached) return { webProductIds: [cached] };
    const made = await runJson<{ id: string }>(exec, ["marketing-studio", "webproducts", "fetch", "--url", brand.appStoreUrl, "--wait", "--json"], 180_000);
    remember(key, made.id);
    return { webProductIds: [made.id] };
  }
  const shots = (brand.screenshotUrls ?? []).filter((u) => /^https:\/\//.test(u)).slice(0, 6);
  if (source === "screenshots" && shots.length) {
    const key = `${job.product_id}:screenshots:${createHash("sha1").update(shots.join("|")).digest("hex").slice(0, 12)}`;
    const cached = productCache()[key];
    if (cached) return { productIds: [cached] };
    const uploads: string[] = [];
    for (const [i, url] of shots.entries()) {
      const file = join(workdir, `screenshot-${i}.png`);
      await download(url, file);
      uploads.push((await runJson<{ id: string }>(exec, ["upload", "create", file, "--json"])).id);
    }
    const made = await runJson<{ id: string }>(exec, ["marketing-studio", "products", "create", "--title", brand.appName, ...(brand.tagline ? ["--description", brand.tagline] : []), ...uploads.flatMap((id) => ["--image", id]), "--json"]);
    remember(key, made.id);
    return { productIds: [made.id] };
  }
  return {};
}

/**
 * Reference image links for image models, in the order the prompt numbers them: a recreated competitor
 * ad's own image(s), our logo (right after them, so it stays inside the CLI's 4 images), the user's
 * picked product images, then the brand screenshots. createArgs sends the first 4.
 */
export function referenceUrls(job: Pick<RunnerJob, "params" | "brand">): string[] {
  const https = (list: unknown) => (Array.isArray(list) ? list : []).filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u));
  // `image_refs` (the Playground): the exact list, in order. Playground jobs with more than the CLI's 4 go to the API instead.
  const exact = https(job.params.image_refs);
  if (exact.length) return exact;
  const logo = https([job.params.logo_ref]);
  const style = https(job.params.style_refs).slice(0, logo.length ? 3 : 4);
  const ours = https(job.params.product_refs).slice(0, 3);
  const shots = job.params.use_screenshots ? https(job.brand?.screenshotUrls).slice(0, 4) : [];
  return [...style, ...logo, ...ours, ...shots];
}

/** The reference images as local files (only the ones the CLI takes are downloaded: 4 for images, more for Seedance). */
async function screenshotFiles(job: RunnerJob, workdir: string): Promise<string[]> {
  const files = [];
  const limit = job.model === "seedance_2_5" ? SEEDANCE_REFERENCES : job.model === "marketing_studio_video" ? 0 : job.model === CUTOUT_MODEL ? 1 : 4;
  for (const [i, url] of referenceUrls(job).slice(0, limit).entries()) {
    const file = join(workdir, `reference-${i}.png`);
    await download(url, file);
    files.push(file);
  }
  return files;
}

// MARK: One job

export class RunnerStop extends Error {}

const idsOf = (externalId: string | null | undefined) => String(externalId ?? "").split(",").map((id) => id.trim()).filter(Boolean);
const jobsIn = (stdout: string): CreatedJob[] => { try { return parseCreateOutput(stdout); } catch { return []; } };
const oneLine = (text: string, n = 300) => text.replace(/\s+/g, " ").trim().slice(0, n);

/** `generate list` couldn't be read, so an earlier submission can't be ruled out: nothing is submitted. */
class LookupFailed extends Error {}

/**
 * An earlier submission of this job at Higgsfield (core of crash recovery): the newest recent job with the
 * same model, prompt and settings that no other creative job has, saved as this job's. Null when there's none.
 */
async function adoptEarlier(job: RunnerJob, args: Args, o: RunnerOptions, say: (m: string) => void, since?: number): Promise<string | null> {
  const listed = await o.exec(listCommand(job.model), { timeoutMs: 120_000 });
  let candidates: CreatedJob[];
  try {
    if (listed.code !== 0) throw new Error(oneLine(listed.stderr || listed.stdout) || `exit ${listed.code}`);
    candidates = earlierSubmissions(parseCreateOutput(listed.stdout), args, { since });
  } catch (error) {
    throw new LookupFailed(`Couldn't read Higgsfield's recent jobs to check for an earlier submission (${error instanceof Error ? error.message : error}); not submitting until it can check.`);
  }
  for (const candidate of candidates) {
    const saved = await o.queue.submitted(o.runnerId, job.id, candidate.id, null);
    if (saved.saved) {
      say(`found an earlier submission, Higgsfield job ${candidate.id} (${candidate.status || "status unknown"}): collecting it instead of submitting again`);
      return candidate.id;
    }
    if (!saved.conflict) throw new Error(saved.error);
  }
  return null;
}

/** Saves a fresh submit's job id; a few tries, then it goes along with the result instead (and a crash is covered by adoptEarlier). */
async function saveSubmitted(job: RunnerJob, externalId: string, credits: number, o: RunnerOptions, say: (m: string) => void) {
  for (let attempt = 1; ; attempt++) {
    try {
      const saved = await o.queue.submitted(o.runnerId, job.id, externalId, credits);
      if (!saved.saved) say(`couldn't save Higgsfield job ${externalId}: ${saved.error}`);
      return;
    } catch (error) {
      if (attempt >= 3) { say(`couldn't save Higgsfield job ${externalId} (${error instanceof Error ? error.message : error}); it goes with the result`); return; }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

type Collected = { done: CreatedJob } | { ended: CreatedJob } | { pending: string; status: string | null };

/**
 * Waits for one submitted job. Its outcome: finished with a result; ended by Higgsfield without one
 * (failed, nsfw, canceled: its own word); or still pending (the wait dropped or timed out, or the
 * status couldn't be read), to be collected on a later claim.
 */
async function collect(id: string, o: RunnerOptions): Promise<Collected> {
  const waited = await o.exec(waitCommand(id), { timeoutMs: 35 * 60_000 });
  const seen = jobsIn(waited.stdout).find((j) => j.id === id || !j.id) ?? null;
  if (seen && isCompleted(seen)) return { done: { ...seen, id } };
  if (seen && isEnded(seen.status)) return { ended: { ...seen, id } };
  // The wait didn't say how it ended: ask for the job itself.
  const got = await o.exec(getCommand(id), { timeoutMs: 120_000 });
  const job = got.code === 0 ? jobsIn(got.stdout).find((j) => j.id === id || !j.id) ?? null : null;
  if (job && isCompleted(job)) return { done: { ...job, id } };
  if (job && isEnded(job.status)) return { ended: { ...job, id } };
  const why = oneLine(`${waited.stderr}\n${waited.code === 0 ? "" : waited.stdout}`) || (seen ? `status ${seen.status}` : `the wait exited with ${waited.code}`);
  return { pending: why, status: job?.status || seen?.status || null };
}

/** Runs one job end to end and reports back. Returns the credits it spent this session. */
export async function processJob(job: RunnerJob, o: RunnerOptions, budget: { spent: number }): Promise<number> {
  const dir = join(o.workdir, job.id);
  mkdirSync(dir, { recursive: true });
  const say = (m: string) => o.log(`[${job.id.slice(0, 8)} ${job.kind} ${job.aspect} v${job.variant}] ${m}`);
  // An image the person chose to make via OpenAI is never made here with Higgsfield instead (the claim
  // leaves those out; this holds even if one slips through).
  if (job.params?.provider === "openai") {
    await o.queue.fail(o.runnerId, job.id, "This image is set to be made via OpenAI, not Higgsfield: the desktop runner doesn't make it. Retry it from the Studio or the Playground.", false, 0);
    say("refused: provider is OpenAI");
    rmSync(dir, { recursive: true, force: true });
    return 0;
  }
  /** Credits this session holds for a job it submitted: given back only when Higgsfield confirms no charge. */
  let held = 0;
  let quoted = 0;
  let externalIds = idsOf(job.external_id);
  const giveBack = () => { budget.spent -= held; held = 0; };
  try {
    if (externalIds.length) {
      say(`collecting Higgsfield job ${externalIds.join(", ")} (submitted before: never submitted again)`);
    } else {
      const refs = await ensureProduct(job, o.exec, dir);
      const args = createArgs(job, refs, dir, await screenshotFiles(job, dir));
      for (const f of args.files) writeFileSync(f.path, f.content);

      // Claimed before without a saved id (the runner died between submit and save): look first.
      const earlier = job.attempts > 1 ? await adoptEarlier(job, args, o, say) : null;
      if (earlier) {
        externalIds = [earlier];
      } else {
        // The live price (free). Refuse if it jumped above what the user confirmed, or past the budget.
        const quote = await o.exec(costCommand(args), { timeoutMs: 120_000 });
        const credits = quote.code === 0 ? parseCredits(quote.stdout) : null;
        if (credits === null) throw new Error(`Couldn't get the price: ${(quote.stderr || quote.stdout).slice(0, 300)}`);
        if (credits > priceLimit(Number(job.cost_estimate))) {
          await o.queue.fail(o.runnerId, job.id, `The live price is ${credits} credits, above the ${job.cost_estimate} estimated when the batch was confirmed. Start the batch again to accept the new price.`, false, 0);
          say(`refused: price ${credits} > estimate ${job.cost_estimate}`);
          return 0;
        }
        if (budget.spent + credits > o.maxCredits) {
          await o.queue.fail(o.runnerId, job.id, `Paused: this runner's credit budget (${o.maxCredits}) would be exceeded. It goes back to the queue.`, true, 900);
          say(`budget: ${budget.spent} + ${credits} > ${o.maxCredits}; requeued`);
          throw new RunnerStop("budget reached");
        }

        say(`submitting (${credits} credits)…`);
        budget.spent += credits;
        held = quoted = credits;
        const submittedAt = Date.now();
        const created = await o.exec(createCommand(args), { timeoutMs: 10 * 60_000 });
        const ids = created.code === 0 ? jobsIn(created.stdout).map((j) => j.id).filter(Boolean) : [];
        if (ids.length) {
          await saveSubmitted(job, ids.join(","), credits, o, say);
          externalIds = ids;
        } else {
          const text = created.code === 0 ? `Higgsfield took the job but printed no job id: ${created.stdout.slice(0, 200)}` : `${created.stderr}\n${created.stdout}`;
          // A refusal Higgsfield answered outright created nothing; anything else may have got through: look before giving up.
          const found = created.code !== 0 && !submitMayHaveGoneThrough(text) ? null : await adoptEarlier(job, args, o, say, submittedAt);
          if (!found) {
            giveBack(); // Higgsfield refused it, or its list shows no such job: nothing was created or charged.
            const c = classify(text);
            await o.queue.fail(o.runnerId, job.id, c.message, c.retryable, c.retryAfterSec);
            say(`${c.retryable ? "requeued" : "failed"}: ${c.message.slice(0, 160)}`);
            if (c.auth) throw new RunnerStop(c.message);
            return 0;
          }
          externalIds = [found];
        }
      }
    }

    // Wait for each submitted job. A dropped wait leaves it running at Higgsfield, collected on a later claim.
    const finished: CreatedJob[] = [];
    for (const id of externalIds) {
      say(`waiting for Higgsfield job ${id}…`);
      const outcome = await collect(id, o);
      if ("ended" in outcome) {
        const { status, reason, credits: charged } = outcome.ended;
        // Higgsfield's own word: not charged (unless it says it charged). A job only collected here was paid for in an earlier run.
        if (held) { if (charged !== null && charged > 0) { budget.spent += charged - held; held = charged; } else giveBack(); }
        const message = `Higgsfield ended job ${id} with status "${status}"${reason ? `: ${reason}` : ""}.${charged !== null && charged > 0 ? ` It charged ${charged} credits.` : " Not charged."}`;
        await o.queue.fail(o.runnerId, job.id, message, false, 0, { externalId: externalIds.join(","), providerStatus: status, providerReason: reason ?? message, chargedCredits: charged });
        say(`failed at Higgsfield (${status}${reason ? `: ${reason.slice(0, 120)}` : ""})`);
        return held;
      }
      if ("pending" in outcome) {
        const c = classify(outcome.pending);
        const message = `Higgsfield job ${id} isn't finished or couldn't be read${outcome.status ? ` (status ${outcome.status})` : ""}: ${outcome.pending}. The runner collects it later and never submits it again.`;
        await o.queue.fail(o.runnerId, job.id, message, true, Math.max(60, c.retryAfterSec), { externalId: externalIds.join(","), providerStatus: outcome.status });
        say(`requeued, still at Higgsfield: ${outcome.pending.slice(0, 160)}`);
        if (c.auth) throw new RunnerStop(c.message);
        return held;
      }
      finished.push(outcome.done);
    }
    const results = finished.filter((r) => r.resultUrl);
    if (!results.length) throw new Error(`Higgsfield finished without a result: ${externalIds.join(", ")}`);
    // The real charge: what the CLI reports for the finished job(s) when it says, else the quote (when
    // this session submitted it); for a job collected after a dropped wait, the server keeps its quote.
    const charged = chargedCredits(finished) ?? (held || null);
    if (held && charged !== null) { budget.spent += charged - held; held = charged; }

    // Download, inspect, read text, upload.
    // A product cut-out isn't a creative: no text to read; the creatives function stores it on the product image.
    const cutout = cutoutAssetId(job);
    const outputs: Output[] = [];
    const files: { name: string; file: string; mime: string }[] = [];
    for (const [i, result] of results.entries()) {
      const tmp = join(dir, `result-${i}`);
      await download(result.resultUrl!, tmp);
      const mime = mimeOf(tmp);
      const name = cutout ? `cutout-${cutout.slice(0, 8)}${i ? `-${i}` : ""}.${EXT[mime] ?? "png"}` : `${job.kind}-${job.aspect.replace(":", "x")}-v${job.variant}${i ? `-${i}` : ""}.${EXT[mime] ?? "bin"}`;
      files.push({ name, file: tmp, mime });
      if (mime.startsWith("video/")) {
        const meta = await probe(tmp);
        const posterName = name.replace(/\.\w+$/, "-poster.jpg");
        const posterFile = await poster(tmp, join(dir, posterName), Math.min(1, (meta.durationSec ?? 2) / 2));
        files.push({ name: posterName, file: posterFile, mime: "image/jpeg" });
        const frames = o.ocr ? await sampleFrames(tmp, join(dir, `frames-${i}`), meta.durationSec ?? 4) : [];
        outputs.push({ path: name, kind: "video", mime, ...meta, sizeBytes: statSync(tmp).size, sourceUrl: result.resultUrl!, posterPath: posterName, ...(o.ocr ? { ocr: await ocr(frames) } : {}) });
      } else {
        outputs.push({ path: name, kind: "image", mime, ...imageDimensions(tmp), sizeBytes: statSync(tmp).size, sourceUrl: result.resultUrl!, ...(o.ocr && !cutout ? { ocr: await ocr([{ file: tmp }]) } : {}) });
      }
    }
    const targets = await o.queue.uploadTargets(o.runnerId, job.id, files.map((f) => ({ name: f.name, contentType: f.mime })));
    const pathOf = new Map(targets.map((t) => [t.name, t.path]));
    for (const f of files) {
      const target = targets.find((t) => t.name === f.name);
      if (!target) throw new Error(`No upload slot for ${f.name}.`);
      await o.queue.put(target, new Uint8Array(readFileSync(f.file)), f.mime);
    }
    await o.queue.complete(o.runnerId, job.id, {
      costCredits: charged, externalId: externalIds.join(",") || results[0].id || null,
      outputs: outputs.map((out) => ({ ...out, path: pathOf.get(out.path) ?? out.path, ...(out.posterPath ? { posterPath: pathOf.get(out.posterPath) ?? out.posterPath } : {}) })),
    });
    say(`done: ${outputs.length} file(s), ${charged ?? "the quoted"} credits${quoted && charged !== quoted ? ` (quoted ${quoted})` : ""}`);
    return held;
  } catch (error) {
    if (error instanceof RunnerStop) throw error;
    const text = error instanceof Error ? error.message : String(error);
    const c = error instanceof LookupFailed ? { retryable: true, retryAfterSec: 120, auth: false, message: text } : classify(text);
    // Anything after the submit keeps the Higgsfield job on the job: its retry collects it.
    await o.queue.fail(o.runnerId, job.id, c.message, c.retryable, c.retryAfterSec, externalIds.length ? { externalId: externalIds.join(",") } : undefined).catch((e) => say(`couldn't report the failure: ${e}`));
    say(`${c.retryable ? "requeued" : "failed"}: ${c.message.slice(0, 160)}`);
    if (c.auth) throw new RunnerStop(c.message);
    return held;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// MARK: Catalog

/** Sends Marketing Studio's avatars, hooks and settings to the studio's pickers. */
export async function syncCatalog(o: RunnerOptions) {
  for (const kind of ["avatars", "hooks", "settings"] as const) {
    try {
      const data = await runJson<unknown>(o.exec, ["marketing-studio", kind, "list", "--json"]);
      const items = Array.isArray(data) ? data : ((data as { items?: unknown[] }).items ?? []);
      await o.queue.catalog(kind, items);
      o.log(`catalog: ${items.length} ${kind}`);
    } catch (error) {
      o.log(`catalog: couldn't sync ${kind}: ${error instanceof Error ? error.message.slice(0, 160) : error}`);
    }
  }
}

// MARK: Loop

export async function runLoop(o: RunnerOptions, loop: { once: boolean; pollSeconds: number; models?: string[] }) {
  const active = new Map<string, Promise<unknown>>();
  const budget = { spent: 0 };
  let stopping: string | null = null;
  let lastBeat = Date.now();
  await syncCatalog(o);
  for (;;) {
    const free = o.concurrency - active.size;
    if (!stopping && free > 0) {
      let jobs: RunnerJob[] = [];
      try { jobs = await o.queue.claim(o.runnerId, free, loop.models ?? MODELS); } catch (error) { o.log(`claim failed: ${error instanceof Error ? error.message : error}`); }
      for (const job of jobs) {
        const task = processJob(job, o, budget)
          .catch((error) => { if (error instanceof RunnerStop) stopping = error.message; else o.log(`job ${job.id}: ${error}`); })
          .finally(() => active.delete(job.id));
        active.set(job.id, task);
      }
      if (loop.once && !jobs.length && !active.size) break;
    }
    if (Date.now() - lastBeat > 60_000 && active.size) {
      lastBeat = Date.now();
      await o.queue.heartbeat(o.runnerId, [...active.keys()]).then((r) => r.released.forEach((id) => o.log(`job ${id} was cancelled or reassigned; its result will be dropped`))).catch(() => undefined);
    }
    if ((stopping || loop.once) && !active.size) break;
    await Promise.race([new Promise((r) => setTimeout(r, loop.pollSeconds * 1000)), ...active.values()]);
  }
  if (stopping) o.log(`stopped: ${stopping}`);
  o.log(`spent ${budget.spent} credits this session`);
  return budget.spent;
}

/** The settings file, and where it was kept before (still read when the current one doesn't exist). */
export const SETTINGS_FILE = join(homedir(), ".config", "creative-runner", "runner.env");
const EARLIER_SETTINGS_FILE = join(homedir(), ".config", "radar", "creative-runner.env");
const SETTINGS_HINT = "~/.config/creative-runner/runner.env";

function loadEnvFile() {
  const file = [SETTINGS_FILE, EARLIER_SETTINGS_FILE].find((candidate) => existsSync(candidate));
  if (!file) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

/**
 * Copies the cache from where it was kept before, once (only while the current folder doesn't exist),
 * so Marketing Studio products made earlier aren't made again. The earlier folder is left as it is.
 */
function adoptEarlierCache() {
  if (existsSync(CACHE) || !existsSync(EARLIER_CACHE)) return;
  try { cpSync(EARLIER_CACHE, CACHE, { recursive: true }); } catch { /* it gets rebuilt */ }
}

/**
 * The creatives function's address from the settings: there is no default, so the runner never talks
 * to a project nobody chose. Throws with what to set when it's missing or isn't an http(s) address.
 */
export function functionUrl(value: string | undefined): string {
  const url = (value ?? "").trim().replace(/\/+$/, "");
  const where = `Set CREATIVES_FUNCTION_URL to your project's creatives function, https://<project ref>.supabase.co/functions/v1/creatives, in the environment or ${SETTINGS_HINT} (or use --offline <dir> for a dry run with no network).`;
  if (!url) throw new Error(where);
  if (!/^https?:\/\/[^\s/]+\/\S+$/.test(url)) throw new Error(`CREATIVES_FUNCTION_URL isn't a function address: "${url}". ${where}`);
  return url;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      offline: { type: "string" },
      once: { type: "boolean", default: false },
      concurrency: { type: "string", default: "4" },
      poll: { type: "string", default: "15" },
      "max-credits": { type: "string", default: "300" },
      "no-ocr": { type: "boolean", default: false },
      models: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(`The desktop runner: makes the jobs that need the Higgsfield app on this Mac (creator-style videos, cut-outs).

Usage (from the app's folder)
  npm run creative-runner                       real jobs (spends Higgsfield credits)
  npm run creative-runner -- --dry-run --once   real queue, sample media, no Higgsfield calls
  npm run creative-runner -- --dry-run --offline <folder> --once   nothing leaves this Mac

Options
  --once                 Do what is queued now, then stop.
  --dry-run              Use sample media instead of generating.
  --offline <folder>     Use a local sample queue; needs no address or secret.
  --concurrency <n>      Jobs at once (default 4).
  --poll <seconds>       How often to look for new jobs (default 15).
  --max-credits <n>      Stop after spending this many Higgsfield credits (default 300).
  --models <a,b>         Only take jobs for these models.
  --no-ocr               Skip reading on-screen text.

It needs two settings, from the environment or ~/.config/creative-runner/runner.env:
  CREATIVES_FUNCTION_URL    https://<your project>.supabase.co/functions/v1/creatives
  CREATIVES_RUNNER_SECRET   from the app: Settings > Desktop runner`);
    return;
  }
  loadEnvFile();
  adoptEarlierCache();
  const dry = values["dry-run"] || Boolean(values.offline);
  let queue: Queue;
  if (values.offline) {
    queue = folderQueue(values.offline);
  } else {
    const secret = process.env.CREATIVES_RUNNER_SECRET;
    if (!secret) throw new Error(`Set CREATIVES_RUNNER_SECRET to the secret from the app's Settings > Desktop runner page, in the environment or ${SETTINGS_HINT} (or use --offline <dir> for a dry run with no network).`);
    queue = remoteQueue(functionUrl(process.env.CREATIVES_FUNCTION_URL), secret, process.env.SUPABASE_PUBLISHABLE_KEY);
  }
  const options: RunnerOptions = {
    queue, exec: dry ? fixtureExec(FIXTURES) : cliExec(), runnerId: `${hostname().split(".")[0]}-${process.pid}${dry ? "-dry" : ""}`,
    concurrency: Math.max(1, Math.min(4, Number(values.concurrency) || 4)), workdir: join(tmpdir(), "creative-runner"),
    ocr: !values["no-ocr"], maxCredits: Number(values["max-credits"]) || 300, log: (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`),
  };
  options.log(`${dry ? "DRY RUN (fixture media, no Higgsfield calls)" : "LIVE (spends Higgsfield credits)"} · queue ${queue.label} · up to ${options.concurrency} at once · budget ${options.maxCredits} credits`);
  await runLoop(options, { once: values.once, pollSeconds: Math.max(3, Number(values.poll) || 15), models: values.models?.split(",") });
}

if (process.argv[1] && /runner\.ts$/.test(process.argv[1])) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
