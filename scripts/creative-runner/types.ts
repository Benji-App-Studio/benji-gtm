// What the runner gets from the queue and hands back (mirrors the creatives edge function's runner API).
import type { CreativeStyle, KnownCopy, OcrResult } from "../../supabase/functions/creatives/core/types.ts";

export interface RunnerBrand { appName: string; appStoreUrl?: string | null; screenshotUrls?: string[]; iconUrl?: string | null; tagline?: string | null }

export interface RunnerJob {
  id: string;
  product_id: string;
  batch_id: string | null;
  format_card_id: string | null;
  kind: CreativeStyle;
  model: string;
  prompt: string;
  params: Record<string, unknown>;
  aspect: string;
  variant: number;
  cost_estimate: number;
  attempts: number;
  /** The Higgsfield job(s) already submitted for it (comma-separated): collected, never submitted again. */
  external_id?: string | null;
  created_at: string;
  brand: RunnerBrand | null;
}

export interface Output {
  path: string;
  kind: "video" | "image";
  mime: string;
  width?: number;
  height?: number;
  durationSec?: number;
  sizeBytes?: number;
  sourceUrl?: string;
  posterPath?: string;
  ocr?: OcrResult;
  copy?: KnownCopy;
}

export interface UploadTarget { name: string; path: string; signedUrl: string }

/** What the runner knows about a failure at Higgsfield (runner/fail; core/jobs.ts afterRunnerFailure). */
export interface FailDetail {
  /** The Higgsfield job(s) it submitted or collected. */
  externalId?: string | null;
  /** Higgsfield's own status for it, when read (failed, nsfw, canceled, in_progress…). */
  providerStatus?: string | null;
  providerReason?: string | null;
  /** What Higgsfield reported charging for the ended job, when it said. */
  chargedCredits?: number | null;
}

/** Saving a submitted job's id: `conflict` when another creative job already has that Higgsfield job. */
export type SubmittedResult = { saved: true } | { saved: false; conflict: boolean; error: string };

/** The queue the runner works from: the creatives edge function, or a folder for offline dry runs. */
export interface Queue {
  label: string;
  claim(runnerId: string, limit: number, models?: string[]): Promise<RunnerJob[]>;
  heartbeat(runnerId: string, jobIds: string[]): Promise<{ released: string[] }>;
  /** Saves the Higgsfield job id (and the quoted price) the moment the job is submitted. */
  submitted(runnerId: string, jobId: string, externalId: string, costCredits: number | null): Promise<SubmittedResult>;
  uploadTargets(runnerId: string, jobId: string, files: { name: string; contentType: string }[]): Promise<UploadTarget[]>;
  put(target: UploadTarget, bytes: Uint8Array, contentType: string): Promise<void>;
  complete(runnerId: string, jobId: string, result: { costCredits: number | null; externalId: string | null; outputs: Output[] }): Promise<void>;
  fail(runnerId: string, jobId: string, error: string, retryable: boolean, retryAfterSec: number, detail?: FailDetail): Promise<void>;
  catalog(kind: "avatars" | "hooks" | "settings", items: unknown[]): Promise<void>;
}
