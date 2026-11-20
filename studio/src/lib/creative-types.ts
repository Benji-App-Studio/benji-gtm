// Creative studio rows as the pages use them (safe to import in the browser).
import type { AwarenessLevel } from "./awareness";
import type { Aspect, CreativeKind } from "./creative-plan";

/** finalizing: finished, its result being saved (a few seconds). */
export type JobStatus = "queued" | "running" | "finalizing" | "done" | "failed" | "cancelled";
export type QaStatus = "pending" | "running" | "pass" | "warn" | "fail" | "error";
export type Approval = "pending" | "approved" | "rejected";

export interface CreativeJobRow {
  id: string;
  product_id: string;
  batch_id: string | null;
  format_card_id: string | null;
  kind: CreativeKind;
  model: string;
  prompt: string;
  params: Record<string, unknown>;
  aspect: Aspect;
  variant: number;
  backend: "auto" | "local" | "api" | "template";
  status: JobStatus;
  cost_estimate: number;
  cost_credits: number | null;
  attempts: number;
  /** The provider's job or request id once submitted: a retry collects it instead of paying again. */
  external_id?: string | null;
  not_before: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}
export const JOB_COLUMNS = "id, product_id, batch_id, format_card_id, kind, model, prompt, params, aspect, variant, backend, status, cost_estimate, cost_credits, attempts, external_id, not_before, error, started_at, finished_at, created_at, updated_at";

export interface QaCheck { id: string; label: string; verdict: "pass" | "warn" | "fail" | "skipped"; reason: string; rules: string[]; probability?: number; evidence?: string }
export interface QaReport {
  verdict?: "pass" | "warn" | "fail";
  checks?: QaCheck[];
  violations?: { id: string; where: string; text: string; fix?: string }[];
  needsHuman?: string[];
  notes?: string[];
  textSeen?: string[];
  error?: string;
  ranAt?: string;
  /** Set when the file or its words changed after QA: it runs again. */
  rerun?: boolean;
}

/** Who an ad's copy sounds like: A, the creator (lowercase, short, first person); B, the brand. */
export type CopyVoice = "creator" | "brand";
/** One A/B version of a creative's ad copy (creatives.copy_variants, lib/creative-copy.ts). */
export interface CopyVariant {
  /** "A", "B", … */
  label: string;
  voice: CopyVoice;
  primary_text: string;
  headline: string;
  description: string;
}

/** Awareness levels (1 Unaware … 5 Most aware) on batches and creatives. */
export type { AwarenessLevel } from "./awareness";

export interface CreativeRow {
  id: string;
  product_id: string;
  job_id: string | null;
  batch_id: string | null;
  format_card_id: string | null;
  kind: "video" | "image";
  style: CreativeKind;
  aspect: string;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  storage_path: string;
  poster_path: string | null;
  mime: string;
  size_bytes: number | null;
  model: string | null;
  prompt: string | null;
  copy: Record<string, unknown>;
  qa_status: QaStatus;
  qa: QaReport | null;
  qa_at: string | null;
  approval: Approval;
  approval_note: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  notes: string | null;
  drive_file_id: string | null;
  /** Public https address in the `creatives` bucket, and a poster frame (every video has one). */
  url: string;
  thumbnail_url: string | null;
  /** Ad copy for Launch, prefilled and edited at review. */
  title: string | null;
  headline: string | null;
  primary_text: string | null;
  /** Meta's link description, where the disclaimers go ("Results vary.", "AI-generated imagery."). */
  description: string | null;
  /** A/B copy (A creator voice, B brand voice); the chosen one is also in headline, primary_text and description. */
  copy_variants: CopyVariant[];
  awareness_level: AwarenessLevel | null;
  cta: string | null;
  hook_type: string | null;
  format_slug: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}
export const CREATIVE_COLUMNS = "id, product_id, job_id, batch_id, format_card_id, kind, style, aspect, width, height, duration_sec, storage_path, poster_path, mime, size_bytes, model, prompt, copy, qa_status, qa, qa_at, approval, approval_note, reviewed_at, reviewed_by, notes, drive_file_id, url, thumbnail_url, title, headline, primary_text, description, copy_variants, awareness_level, cta, hook_type, format_slug, approved_at, created_at, updated_at";

export type CreativeView = CreativeRow;

/** CTA wordings Launch maps to Meta's call-to-action types. */
export const CTA_SUGGESTIONS = ["Download", "Install now", "Learn more", "Sign up", "Subscribe"];

export interface BatchRow { id: string; format_card_id: string | null; brief: string; settings: Record<string, unknown>; cost_estimate: number; created_at: string; awareness_level?: AwarenessLevel | null }

export interface CatalogItem { id: string; name: string; type?: string | null; gender?: string | null; prompt?: string | null; previewUrl?: string | null; videoUrl?: string | null }
export interface Catalog { avatars: CatalogItem[]; hooks: CatalogItem[]; settings: CatalogItem[]; syncedAt: string | null }

export interface StudioOverview {
  workspace: { id: string; name: string; appName: string; screenshots: number; appStoreUrl: string | null; iconUrl: string | null; driveFolderId: string | null; profile?: import("./product-insight").ProductProfile | null; assets?: import("./product-assets").ProductAsset[]; brandSystem?: import("./brand-system").BrandSystem | null; imageProvider?: import("./image-provider").ImageProvider };
  batches: BatchRow[];
  jobs: CreativeJobRow[];
  creatives: CreativeView[];
  catalog: Catalog;
  /** What the creatives backend's health check says. `wallClockSec` and `openaiImagePlan` are null on an older backend. */
  backend: { typesafe: boolean; higgsfieldApi: boolean; runner: boolean; drive: boolean; openaiImages?: boolean; wallClockSec?: number | null; openaiImagePlan?: import("./image-provider").OpenAiImagePlan | null } | null;
  /** Template remakes' batches: their realtime jobs and creatives stay out of the Studio (lib/studio-sources.ts). */
  hiddenBatchIds?: string[];
  /** The Playground's batches: their jobs stay on the Playground; their creatives are reviewed here, badged "Remix". */
  playgroundBatchIds?: string[];
  error?: string;
}
