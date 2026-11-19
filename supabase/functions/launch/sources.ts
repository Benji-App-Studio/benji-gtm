// Where Launch finds creatives: always in public.creatives, never from a URL a caller sends. A creative
// may launch only when a person approved it and its QA passed (or warned, with the reviewer's note):
// approval = 'approved' and qa_status in ('pass', 'warn'), the same rule as listApprovedCreatives in
// the studio (studio/src/lib/creatives.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreativeInput } from "./types.ts";

export const LAUNCHABLE_QA = ["pass", "warn"] as const;
const COLUMNS = "id, url, kind, style, model, job_id, aspect, duration_sec, format_card_id, format_slug, hook_type, headline, primary_text, description, cta, thumbnail_url, approved_at";

/** Made by a model (AI people, generated scenes): images and videos from a job, not rendered posts (studio lib/creative-copy.ts isAiGenerated). */
export const aiGenerated = (row: Record<string, unknown>) => ["image", "ugc_video", "ai_video"].includes(String(row.style ?? "")) && Boolean(row.model || row.job_id);

/** A creatives row in the shape Launch sends to Meta, or null when it has no usable file. */
export function toCreativeInput(row: Record<string, unknown>): CreativeInput | null {
  const url = row.url as string | undefined;
  const kind = row.kind === "image" ? "image" : row.kind === "video" ? "video" : null;
  if (!url || !kind) return null;
  return {
    id: String(row.id),
    url,
    kind,
    aspect: (row.aspect as string | null) ?? undefined,
    durationSec: row.duration_sec != null ? Number(row.duration_sec) : undefined,
    formatCardId: (row.format_card_id as string | null) ?? undefined,
    formatSlug: (row.format_slug as string | null) ?? undefined,
    hookType: (row.hook_type as string | null) ?? undefined,
    headline: (row.headline as string | null) ?? undefined,
    primaryText: (row.primary_text as string | null) ?? undefined,
    cta: (row.cta as string | null) ?? undefined,
    description: (row.description as string | null) ?? undefined,
    aiGenerated: aiGenerated(row),
    thumbnailUrl: (row.thumbnail_url as string | null) ?? undefined,
    approvedAt: (row.approved_at as string | null) ?? undefined,
  };
}

/** The workspace's newest launchable creatives (the daily automation's pool). */
export async function approvedCreatives(db: SupabaseClient, productId: string, userId: string, limit = 50): Promise<CreativeInput[]> {
  const { data, error } = await db
    .from("creatives")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("product_id", productId)
    .eq("approval", "approved")
    .in("qa_status", [...LAUNCHABLE_QA])
    .order("approved_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).flatMap((row) => toCreativeInput(row) ?? []);
}

/** The launchable creatives among `ids`, by id; an id that isn't the user's, the workspace's, approved and QA-passed is absent. */
export async function creativesByIds(db: SupabaseClient, o: { userId: string; productId: string; ids: string[] }): Promise<Map<string, CreativeInput>> {
  const ids = [...new Set(o.ids)];
  if (!ids.length) return new Map();
  const { data, error } = await db
    .from("creatives")
    .select(COLUMNS)
    .eq("user_id", o.userId)
    .eq("product_id", o.productId)
    .eq("approval", "approved")
    .in("qa_status", [...LAUNCHABLE_QA])
    .in("id", ids);
  if (error) throw new Error(`Couldn't read the creatives: ${error.message}`);
  const found = new Map<string, CreativeInput>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const creative = toCreativeInput(row);
    if (creative) found.set(creative.id, creative);
  }
  return found;
}

/**
 * What a testing draft keeps on its copy of the creative (the queue and the daily automation): the
 * description and the AI declaration, the person's or, by default, the creative's own (a model-made
 * creative is declared made with AI). The worker sends both (meta.ts creativePayload).
 */
export function draftCreative(i: { creative: CreativeInput; description?: string; aiDisclosure?: "OPT_IN" | "OPT_OUT" }): CreativeInput {
  const { description: _stored, ...creative } = i.creative;
  const description = (i.description ?? i.creative.description ?? "").trim().slice(0, 255);
  return { ...creative, ...(description ? { description } : {}), aiDisclosure: i.aiDisclosure ?? (i.creative.aiGenerated ? "OPT_IN" : "OPT_OUT") };
}
