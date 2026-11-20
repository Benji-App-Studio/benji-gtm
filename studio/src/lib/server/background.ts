import "server-only";
// What's running in the background for the signed-in user, for the floating indicator on every page:
// ad media being saved to storage, Studio batches, Launch uploads to Meta, competitor analyses and paid ad
// pulls. Read with the user's session (RLS), counts only; nothing here starts or changes work.
import type { SupabaseClient } from "@supabase/supabase-js";
import { CUTOUT_MODEL } from "@/lib/product-assets";
import { INSIGHT_STALE_MS } from "@/lib/product-insight";

type Supabase = SupabaseClient;

export interface BackgroundTask {
  id: string;
  kind: "media" | "creatives" | "launch" | "analysis" | "pull" | "insight";
  label: string;
  productName: string | null;
  /** Finished units and the total, or null when the task has no countable steps. */
  done: number | null;
  total: number | null;
  detail: string | null;
  href: string | null;
}

const count = async (query: PromiseLike<{ count: number | null; error: unknown }>) => {
  const { count: n, error } = await query;
  return error ? 0 : n ?? 0;
};

export async function getBackgroundTasks(supabase: Supabase): Promise<BackgroundTask[]> {
  const { data: products } = await supabase.from("products").select("id, name, insight_status, insight_message, insight_started_at");
  const nameOf = (id: string | null | undefined) => (products ?? []).find((p) => p.id === id)?.name ?? null;
  const tasks: BackgroundTask[] = [];

  const [media, jobs, drafts, projects, pulls] = await Promise.all([
    supabase.from("paid_ad_media").select("product_id").in("status", ["queued", "downloading"]).limit(2000),
    supabase.from("creative_jobs").select("batch_id, product_id, model").in("status", ["queued", "running"]).limit(500),
    supabase.from("launch_drafts").select("job_id, product_id").in("status", ["queued", "processing", "creating"]).limit(500),
    supabase.from("projects").select("id, product_id, name, status, message").in("status", ["discovering", "analyzing"]),
    supabase.from("ad_pulls").select("id, product_id, source, started_at").eq("status", "running"),
  ]);

  // Ad media being saved to storage, per product.
  for (const productId of new Set((media.data ?? []).map((r) => r.product_id as string))) {
    const [done, failed, total] = await Promise.all([
      count(supabase.from("paid_ad_media").select("id", { count: "exact", head: true }).eq("product_id", productId).eq("status", "done")),
      count(supabase.from("paid_ad_media").select("id", { count: "exact", head: true }).eq("product_id", productId).eq("status", "failed")),
      count(supabase.from("paid_ad_media").select("id", { count: "exact", head: true }).eq("product_id", productId)),
    ]);
    tasks.push({
      id: `media:${productId}`, kind: "media", label: "Saving ad media to storage", productName: nameOf(productId),
      done: done + failed, total, detail: failed ? `${failed} couldn't be saved` : null, href: `/app/w/${productId}/research`,
    });
  }

  // Studio batches with jobs still queued or running.
  const batches = [...new Set((jobs.data ?? []).map((r) => r.batch_id as string | null).filter((b): b is string => Boolean(b)))];
  if (batches.length) {
    const { data: all } = await supabase.from("creative_jobs").select("batch_id, product_id, status").in("batch_id", batches);
    for (const batch of batches) {
      const rows = (all ?? []).filter((r) => r.batch_id === batch);
      const finished = rows.filter((r) => ["done", "failed", "cancelled"].includes(r.status as string)).length;
      const productId = rows[0]?.product_id as string | undefined;
      tasks.push({
        id: `creatives:${batch}`, kind: "creatives", label: "Making creatives", productName: nameOf(productId),
        done: finished, total: rows.length, detail: null, href: productId ? `/app/w/${productId}/studio` : null,
      });
    }
  }
  const loose = (jobs.data ?? []).filter((r) => !r.batch_id && r.model !== CUTOUT_MODEL);
  if (loose.length) {
    tasks.push({ id: "creatives:single", kind: "creatives", label: "Making creatives", productName: nameOf(loose[0].product_id as string), done: null, total: null, detail: `${loose.length} waiting or running`, href: null });
  }
  // Product cut-outs (Product page → "Make cut-out"), made by the desktop runner.
  const cutouts = (jobs.data ?? []).filter((r) => r.model === CUTOUT_MODEL);
  if (cutouts.length) {
    const productId = cutouts[0].product_id as string;
    tasks.push({ id: "creatives:cutouts", kind: "creatives", label: "Making product cut-outs", productName: nameOf(productId), done: null, total: null, detail: `${cutouts.length} waiting for, or running on, the desktop runner`, href: `/app/w/${productId}/settings` });
  }

  // Launch uploads to Meta (paused drafts).
  const launchJobs = [...new Set((drafts.data ?? []).map((r) => r.job_id as string | null).filter((j): j is string => Boolean(j)))];
  if (launchJobs.length) {
    const { data: all } = await supabase.from("launch_drafts").select("job_id, product_id, status").in("job_id", launchJobs);
    for (const job of launchJobs) {
      const rows = (all ?? []).filter((r) => r.job_id === job);
      const finished = rows.filter((r) => ["draft", "error", "cancelled"].includes(r.status as string)).length;
      const productId = rows[0]?.product_id as string | undefined;
      tasks.push({
        id: `launch:${job}`, kind: "launch", label: "Uploading paused drafts to Meta", productName: nameOf(productId),
        done: finished, total: rows.length, detail: null, href: productId ? `/app/w/${productId}/launch` : null,
      });
    }
  }

  // Analyses: no exact count, so they show as running with their status message.
  for (const p of projects.data ?? []) {
    tasks.push({
      id: `analysis:${p.id}`, kind: "analysis", label: p.status === "discovering" ? `Finding competitors: ${p.name}` : `Analyzing: ${p.name}`,
      productName: nameOf(p.product_id as string), done: null, total: null, detail: (p.message as string | null) ?? null, href: `/app/p/${p.id}`,
    });
  }

  // The AI reading a product's links (lib/product-insight.ts); a run silent for too long is dead.
  for (const p of products ?? []) {
    if (p.insight_status !== "running" || !p.insight_started_at || Date.now() - Date.parse(p.insight_started_at) > INSIGHT_STALE_MS) continue;
    tasks.push({
      id: `insight:${p.id}`, kind: "insight", label: "AI reading your product's links", productName: p.name as string,
      done: null, total: null, detail: (p.insight_message as string | null) ?? null, href: `/app/w/${p.id}/settings`,
    });
  }

  // Paid ad pulls still running in the cloud.
  for (const pull of pulls.data ?? []) {
    tasks.push({
      id: `pull:${pull.id}`, kind: "pull", label: "Pulling competitors' ads", productName: nameOf(pull.product_id as string),
      done: null, total: null, detail: null, href: `/app/w/${pull.product_id}/research`,
    });
  }
  return tasks;
}
