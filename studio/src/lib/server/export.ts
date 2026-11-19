import "server-only";
// Approved creatives as lib/export-paths.ts files them: each with its variant and carousel card (from
// its job), its awareness level (its own, else its batch's) and what Launch names it by. Shared by the
// "Download approved" zip and the Google Drive copy.
import { cleanAwareness } from "@/lib/awareness";
import { exportPlan, type ExportFile, type ExportItem } from "@/lib/export-paths";
import { readBrandKit } from "@/lib/workspace-schema";
import type { Session } from "./auth";

interface Row {
  id: string; batch_id: string | null; job_id: string | null; aspect: string; kind: "image" | "video"; style: string; mime: string; storage_path: string; url: string;
  awareness_level: number | null; format_slug: string | null; hook_type: string | null; headline: string | null; created_at: string; drive_file_id: string | null;
}

export interface ExportSet { files: (ExportFile & { url: string; storagePath: string; mime: string; driveFileId: string | null })[]; appName: string }

/** The product's approved creatives (all, or these ids), planned for export. */
export async function approvedForExport(session: Session, productId: string, ids?: string[]): Promise<ExportSet> {
  const { supabase } = session;
  let query = supabase.from("creatives")
    .select("id, batch_id, job_id, aspect, kind, style, mime, storage_path, url, awareness_level, format_slug, hook_type, headline, created_at, drive_file_id")
    .eq("product_id", productId).eq("approval", "approved").order("created_at", { ascending: true }).limit(500);
  if (ids) query = query.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const [{ data: rows, error }, { data: product }, { data: launch }] = await Promise.all([
    query.returns<Row[]>(),
    supabase.from("products").select("name, brand_kit").eq("id", productId).maybeSingle<{ name: string; brand_kit: unknown }>(),
    supabase.from("launch_settings").select("app_code").eq("product_id", productId).maybeSingle<{ app_code: string | null }>(),
  ]);
  if (error) throw new Error(error.message);
  const list = rows ?? [];
  const jobIds = [...new Set(list.map((r) => r.job_id).filter((id): id is string => Boolean(id)))];
  const batchIds = [...new Set(list.map((r) => r.batch_id).filter((id): id is string => Boolean(id)))];
  const [{ data: jobs }, { data: batches }] = await Promise.all([
    jobIds.length ? supabase.from("creative_jobs").select("id, variant, params").in("id", jobIds).returns<{ id: string; variant: number; params: Record<string, unknown> }[]>() : Promise.resolve({ data: [] }),
    batchIds.length ? supabase.from("creative_batches").select("id, settings").in("id", batchIds).returns<{ id: string; settings: Record<string, unknown> }[]>() : Promise.resolve({ data: [] }),
  ]);
  const jobOf = new Map((jobs ?? []).map((j) => [j.id, j]));
  const batchOf = new Map((batches ?? []).map((b) => [b.id, b]));
  const items: ExportItem[] = list.map((r) => {
    const job = r.job_id ? jobOf.get(r.job_id) : undefined;
    const carousel = job?.params?.carousel as { set?: number; card?: number } | undefined;
    return {
      id: r.id, batchId: r.batch_id, jobId: r.job_id, variant: carousel?.set ?? job?.variant ?? null, card: carousel?.card ?? null,
      aspect: r.aspect, kind: r.kind, style: r.style, mime: r.mime, storagePath: r.storage_path,
      awarenessLevel: cleanAwareness(r.awareness_level) ?? cleanAwareness(r.batch_id ? batchOf.get(r.batch_id)?.settings?.awarenessLevel : null),
      formatSlug: r.format_slug, hookType: r.hook_type, headline: r.headline, createdAt: r.created_at,
    };
  });
  const appName = readBrandKit(product?.brand_kit, product?.name ?? "App").appName || product?.name || "App";
  const byId = new Map(list.map((r) => [r.id, r]));
  const files = exportPlan(items, { appName, appCode: launch?.app_code }).map((f) => {
    const r = byId.get(f.id)!;
    return { ...f, url: r.url, storagePath: r.storage_path, mime: r.mime, driveFileId: r.drive_file_id };
  });
  return { files, appName };
}
