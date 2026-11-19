import "server-only";
// Reading creatives on the server. `listApprovedCreatives` is the hand-off to Launch:
// only creatives that passed QA (or warned, with a reviewer's note) and that a person approved.
// Launch's edge worker reads the same rows: public.creatives where status = 'approved', newest
// approved_at first, with url, kind, aspect, duration_sec, format_card_id, headline, primary_text,
// cta, hook_type, format_slug, thumbnail_url and title.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { competitorNamesFor } from "@/lib/server/competitors";
import { isAiGenerated } from "./creative-copy";
import { CREATIVE_COLUMNS, type CreativeRow, type QaReport } from "./creative-types";

export const CREATIVES_BUCKET = "creatives";

/**
 * An approved creative, in the shape Launch reads: id, url, kind, aspect, durationSec, formatCardId,
 * headline, primaryText, cta, plus hookType, formatSlug, thumbnailUrl, approvedAt and title. The
 * fields after those are the studio's own.
 */
export interface ApprovedCreative {
  id: string;
  url: string;
  kind: "video" | "image";
  aspect: string;
  durationSec?: number;
  formatCardId?: string;
  headline?: string;
  primaryText?: string;
  cta?: string;
  hookType?: string;
  formatSlug?: string;
  /** A poster frame; always set for videos (images use themselves). */
  thumbnailUrl?: string;
  approvedAt?: string;
  title?: string;
  /** Meta's link description (disclaimers), from the creative's copy. */
  description?: string;
  /** Made by a model (AI people, a generated scene): Launch declares it made with AI by default. */
  aiGenerated: boolean;
  productId: string;
  style: CreativeRow["style"];
  width: number | null;
  height: number | null;
  mime: string;
  storagePath: string;
  batchId: string | null;
  jobId: string | null;
  model: string | null;
  prompt: string | null;
  qa: { status: "pass" | "warn"; violations: NonNullable<QaReport["violations"]>; needsHuman: string[]; notes: string[]; ranAt: string | null };
  approval: { note: string | null; reviewedBy: string | null };
}

const opt = (value: string | null | undefined) => value ?? undefined;

export function toApproved(c: CreativeRow): ApprovedCreative {
  return {
    id: c.id, url: c.url, kind: c.kind, aspect: c.aspect,
    durationSec: c.duration_sec == null ? undefined : Number(c.duration_sec),
    formatCardId: opt(c.format_card_id), headline: opt(c.headline), primaryText: opt(c.primary_text), cta: opt(c.cta),
    hookType: opt(c.hook_type), formatSlug: opt(c.format_slug ?? c.format_card_id),
    thumbnailUrl: opt(c.thumbnail_url ?? (c.kind === "image" ? c.url : null)),
    approvedAt: opt(c.approved_at ?? c.reviewed_at), title: opt(c.title), description: opt(c.description), aiGenerated: isAiGenerated(c),
    productId: c.product_id, style: c.style, width: c.width, height: c.height, mime: c.mime, storagePath: c.storage_path,
    batchId: c.batch_id, jobId: c.job_id, model: c.model, prompt: c.prompt,
    qa: { status: c.qa_status as "pass" | "warn", violations: c.qa?.violations ?? [], needsHuman: c.qa?.needsHuman ?? [], notes: c.qa?.notes ?? [], ranAt: c.qa_at },
    approval: { note: c.approval_note, reviewedBy: c.reviewed_by },
  };
}

/**
 * The creatives a person approved for a product, newest approval first. Acts as the signed-in user
 * (row-level security applies) unless a client is passed (e.g. a service-role client in a worker).
 */
export async function listApprovedCreatives(productId: string, o: { supabase?: SupabaseClient; limit?: number } = {}): Promise<ApprovedCreative[]> {
  const supabase = o.supabase ?? (await createClient());
  const { data, error } = await supabase.from("creatives").select(CREATIVE_COLUMNS)
    .eq("product_id", productId).eq("approval", "approved").in("qa_status", ["pass", "warn"])
    .order("approved_at", { ascending: false }).limit(o.limit ?? 200).returns<CreativeRow[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map(toApproved);
}

/** The product's competitors, for QA: its one competitor list (lib/server/competitors.ts), names and handles. */
export async function competitorNames(supabase: SupabaseClient, productId: string): Promise<string[]> {
  return competitorNamesFor({ supabase }, productId);
}
