// The two queues: the `creatives` edge function (real runs, and dry runs that still write to the
// database), and a local folder (offline dry runs: nothing leaves the Mac).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Output, Queue, RunnerJob, SubmittedResult, UploadTarget } from "./types.ts";

export function remoteQueue(functionUrl: string, secret: string, apiKey?: string): Queue {
  const call = async <T>(route: string, body: unknown): Promise<T> => {
    const response = await fetch(`${functionUrl.replace(/\/+$/, "")}/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-creatives-runner": secret, ...(apiKey ? { apikey: apiKey } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${route}: ${data.error ?? response.status}`);
    return data as T;
  };
  return {
    label: functionUrl,
    claim: async (runnerId, limit, models) => (await call<{ jobs: RunnerJob[] }>("runner/claim", { runnerId, limit, models })).jobs,
    heartbeat: (runnerId, jobIds) => call("runner/heartbeat", { runnerId, jobIds }),
    submitted: async (runnerId, jobId, externalId, costCredits): Promise<SubmittedResult> => {
      const r = await call<{ saved: boolean; conflict?: boolean; error?: string }>("runner/submitted", { runnerId, jobId, externalId, costCredits });
      return r.saved ? { saved: true } : { saved: false, conflict: Boolean(r.conflict), error: r.error ?? "Not saved." };
    },
    uploadTargets: async (runnerId, jobId, files) => (await call<{ files: UploadTarget[] }>("runner/upload", { runnerId, jobId, files })).files,
    put: async (target, bytes, contentType) => {
      const response = await fetch(target.signedUrl, { method: "PUT", headers: { "Content-Type": contentType, "x-upsert": "true" }, body: new Blob([bytes.slice().buffer as ArrayBuffer]), signal: AbortSignal.timeout(300_000) });
      if (!response.ok) throw new Error(`Upload of ${target.name} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
    },
    complete: async (runnerId, jobId, result) => { await call("runner/complete", { runnerId, jobId, ...result }); },
    fail: async (runnerId, jobId, error, retryable, retryAfterSec, detail = {}) => { await call("runner/fail", { runnerId, jobId, error, retryable, retryAfterSec, ...detail }); },
    catalog: async (kind, items) => { await call("runner/catalog", { kind, items }); },
  };
}

/** A sample queue for offline dry runs: one image job and one UGC video job for a sample app. */
export function sampleJobs(): RunnerJob[] {
  const brand = { appName: "Acme", appStoreUrl: null, screenshotUrls: [], iconUrl: null };
  const base = { product_id: "00000000-0000-4000-8000-0000000000aa", batch_id: null, format_card_id: "sample-card", attempts: 0, created_at: "2026-10-02T12:00:00Z", brand };
  return [
    { ...base, id: "00000000-0000-4000-8000-0000000000b1", kind: "image", model: "gpt_image_2_5", prompt: "A calm, bright ad: Acme keeps one habit going every day.", params: { aspect_ratio: "4:5", resolution: "2k", quality: "medium", variant: "flare" }, aspect: "4:5", variant: 1, cost_estimate: 1 },
    { ...base, id: "00000000-0000-4000-8000-0000000000b2", kind: "ugc_video", model: "marketing_studio_video", prompt: "A presenter shows how Acme keeps a daily habit going.", params: { mode: "ugc", duration: 15, resolution: "720p", aspect_ratio: "9:16", generate_audio: true, product: "none", hook_text: "One habit a day, kept for you" }, aspect: "9:16", variant: 1, cost_estimate: 75 },
  ];
}

/**
 * <dir>/jobs.json is the queue (written with sample jobs when missing); files land in <dir>/storage,
 * and every submit, completion or failure is appended to <dir>/results.json. A Higgsfield job id is
 * saved to its job in jobs.json, once (another job with the same id is a conflict, as on the server).
 */
export function folderQueue(dir: string): Queue {
  mkdirSync(dir, { recursive: true });
  const jobsFile = join(dir, "jobs.json");
  const resultsFile = join(dir, "results.json");
  if (!existsSync(jobsFile)) writeFileSync(jobsFile, JSON.stringify(sampleJobs(), null, 1));
  const claimed = new Set<string>();
  const record = (entry: unknown) => {
    const list = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, "utf8")) : [];
    list.push(entry);
    writeFileSync(resultsFile, JSON.stringify(list, null, 1));
  };
  return {
    label: dir,
    claim: async (_runner, limit, models) => {
      const jobs = (JSON.parse(readFileSync(jobsFile, "utf8")) as RunnerJob[]).filter((j) => !claimed.has(j.id) && (!models || models.includes(j.model))).slice(0, limit);
      jobs.forEach((j) => claimed.add(j.id));
      return jobs;
    },
    heartbeat: async () => ({ released: [] }),
    submitted: async (_runner, jobId, externalId, costCredits): Promise<SubmittedResult> => {
      const jobs = JSON.parse(readFileSync(jobsFile, "utf8")) as RunnerJob[];
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return { saved: false, conflict: false, error: "No such job." };
      if (jobs.some((j) => j.id !== jobId && j.external_id === externalId)) return { saved: false, conflict: true, error: `Higgsfield job ${externalId} belongs to another creative job.` };
      if (job.external_id && job.external_id !== externalId) return { saved: false, conflict: true, error: `This job already has Higgsfield job ${job.external_id}.` };
      job.external_id = externalId;
      writeFileSync(jobsFile, JSON.stringify(jobs, null, 1));
      record({ jobId, status: "submitted", externalId, costCredits });
      return { saved: true };
    },
    uploadTargets: async (_runner, jobId, files) => {
      const job = (JSON.parse(readFileSync(jobsFile, "utf8")) as RunnerJob[]).find((j) => j.id === jobId)!;
      return files.map((f) => {
        const path = `${job.product_id}/${job.created_at.slice(0, 10)}/${jobId}/${f.name}`;
        return { name: f.name, path, signedUrl: `file://${join(dir, "storage", path)}` };
      });
    },
    put: async (target, bytes) => {
      const file = target.signedUrl.replace(/^file:\/\//, "");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    },
    complete: async (_runner, jobId, result) => record({ jobId, status: "done", ...result, outputs: result.outputs.map((o: Output) => ({ ...o, ocr: o.ocr ? { ...o.ocr, lines: o.ocr.lines.slice(0, 12) } : undefined })) }),
    fail: async (_runner, jobId, error, retryable, retryAfterSec, detail = {}) => record({ jobId, status: retryable ? "requeued" : "failed", error, retryAfterSec, ...detail }),
    catalog: async (kind, items) => { writeFileSync(join(dir, `catalog-${kind}.json`), JSON.stringify(items, null, 1)); },
  };
}
