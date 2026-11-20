import type { NextRequest } from "next/server";
import { CREATIVES_BUCKET } from "@/lib/creatives";
import { PLAYGROUND_SOURCE, type PlaygroundRequest } from "@/lib/playground";
import {
  ACTIVE_JOB_STATUSES, normalizePlaygroundOptions, normalizePlaygroundRequest, planPlayground, playgroundBatchRequest, playgroundFromSettings, playgroundRequestProblem, resolveStyleAssets,
  type PlaygroundItem, type PlaygroundJob, type PlaygroundOptions, type PlaygroundOutput, type PlaygroundOverview,
} from "@/lib/playground-plan";
import type { ProductAsset } from "@/lib/product-assets";
import { isResponse, requireUser, type Session } from "@/lib/server/auth";
import { refuseWhenFull } from "@/lib/server/storage";
import { brandFor } from "@/lib/server/brand";
import { BatchError, createBatch } from "@/lib/server/creative-batches";
import { creativesBackend } from "@/lib/server/creatives-backend";
import { getWorkspace, WORKSPACE_BUCKET } from "@/lib/workspace";
import { providerOfJob, readOpenAiImagePlan } from "@/lib/image-provider";
import { readImageProvider } from "@/lib/server/image-provider";
import { confirmedCreditsOf } from "@/lib/playground-templates-plan";
import { caughtFailure, dbFailure } from "@/lib/server/errors";
import { getTranslator } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translate";

// The Playground's API. Generations (images, and Seedance videos in video mode) run on the creative
// pipeline (creative_batches tagged settings.source = "playground"); outputs land in the `creatives`
// bucket like every other creative.
// Uploads (references and the person's images) go to the public `workspace` bucket under
// <user>/<product>/playground/inputs/, because Higgsfield fetches them by https link.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPLOAD_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const HISTORY = 40;

type BatchRow = { id: string; settings: Record<string, unknown>; cost_estimate: number; created_at: string };
type JobRow = {
  id: string; batch_id: string; variant: number; status: PlaygroundJob["status"]; error: string | null; backend: PlaygroundJob["backend"]; not_before: string | null; cost_estimate: number; cost_credits: number | null;
  provider: string | null; est_usd: string | number | null; cost_usd: string | number | null;
};
const usdOf = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
type CreativeRow = { id: string; batch_id: string; job_id: string | null; kind: "image" | "video"; url: string; thumbnail_url: string | null; duration_sec: number | null; width: number | null; height: number | null; aspect: string; model: string | null; created_at: string; qa_status: string; approval: string };

const notFound = (t: Translator["t"]) => Response.json({ error: t("This workspace doesn't exist.") }, { status: 404 });

/** The workspace's playground history (newest first), its pickers and whether the backends are on. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/playground/[productId]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { t } = await getTranslator();
  const { productId } = await ctx.params;
  if (!UUID.test(productId)) return notFound(t);
  const [workspace, brand] = await Promise.all([getWorkspace(productId, session.supabase).catch(() => null), brandFor(session, productId).catch(() => null)]);
  if (!workspace || !brand) return notFound(t);
  const { supabase } = session;

  const [batches, assets, research, health, imageProvider] = await Promise.all([
    supabase.from("creative_batches").select("id, settings, cost_estimate, created_at").eq("product_id", productId).eq("settings->>source", PLAYGROUND_SOURCE)
      .order("created_at", { ascending: false }).limit(HISTORY).returns<BatchRow[]>(),
    supabase.from("product_assets").select("url, label, kind").eq("product_id", productId).eq("hidden", false).order("created_at", { ascending: false }).limit(120)
      .returns<Pick<ProductAsset, "url" | "label" | "kind">[]>(),
    researchImages(session, productId),
    creativesBackend<{ runner?: boolean; higgsfieldApi?: boolean; typesafe?: boolean; openaiImages?: boolean; wallClockSec?: unknown; openaiImagePlan?: unknown }>(session, "health"),
    readImageProvider(session, productId),
  ]);
  const ids = (batches.data ?? []).map((b) => b.id);
  const [jobs, creatives] = ids.length
    ? await Promise.all([
      supabase.from("creative_jobs").select("id, batch_id, variant, status, error, backend, not_before, cost_estimate, cost_credits, provider:params->>provider, est_usd:params->>est_usd, cost_usd:params->>cost_usd").in("batch_id", ids).returns<JobRow[]>(),
      supabase.from("creatives").select("id, batch_id, job_id, kind, url, thumbnail_url, duration_sec, width, height, aspect, model, created_at, qa_status, approval").in("batch_id", ids).returns<CreativeRow[]>(),
    ])
    : [{ data: [] as JobRow[] }, { data: [] as CreativeRow[] }];

  const items: PlaygroundItem[] = [];
  for (const batch of batches.data ?? []) {
    const request = playgroundFromSettings(batch.settings);
    if (!request) continue;
    items.push({
      batchId: batch.id, createdAt: batch.created_at, credits: Number(batch.cost_estimate), usd: usdOf(batch.settings.usdEstimate), request,
      jobs: (jobs.data ?? []).filter((j) => j.batch_id === batch.id).sort((a, b) => a.variant - b.variant).map((j) => ({
        id: j.id, variant: j.variant, status: j.status, error: j.error, backend: j.backend, notBefore: j.not_before,
        costEstimate: Number(j.cost_estimate), costCredits: j.cost_credits == null ? null : Number(j.cost_credits),
        provider: providerOfJob({ provider: j.provider }), estUsd: usdOf(j.est_usd), costUsd: usdOf(j.cost_usd),
      })),
      outputs: (creatives.data ?? []).filter((c) => c.batch_id === batch.id).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).map((c): PlaygroundOutput => ({
        id: c.id, jobId: c.job_id, kind: c.kind === "video" ? "video" : "image", url: c.url, posterUrl: c.thumbnail_url, durationSec: c.duration_sec == null ? null : Number(c.duration_sec), width: c.width, height: c.height, aspect: c.aspect, model: c.model, createdAt: c.created_at, qaStatus: c.qa_status, approval: c.approval,
      })),
    });
  }

  const body: PlaygroundOverview = {
    workspace: { id: workspace.id, name: workspace.name, appName: brand.kit.appName, tagline: brand.kit.tagline ?? null, forbiddenClaims: brand.forbiddenClaims },
    // The plan's time limit and what it means for each OpenAI image quality: null from a backend that doesn't say.
    backend: health.ok ? {
      runner: Boolean(health.data.runner), higgsfieldApi: Boolean(health.data.higgsfieldApi), typesafe: Boolean(health.data.typesafe), openaiImages: Boolean(health.data.openaiImages),
      wallClockSec: typeof health.data.wallClockSec === "number" && Number.isFinite(health.data.wallClockSec) ? health.data.wallClockSec : null,
      openaiImagePlan: readOpenAiImagePlan(health.data.openaiImagePlan, health.data.wallClockSec),
    } : null,
    imageProvider,
    items,
    productImages: (assets.data ?? []).map((a) => ({ url: a.url, label: a.label, kind: a.kind })),
    researchImages: research,
    ...(batches.error ? { error: t("The creative studio's tables aren't in the database yet (migration 20261002500000).") } : {}),
  };
  return Response.json(body);
}

/** Stored copies of competitors' image ads (Research), newest first, with the advertiser's name. */
async function researchImages(session: Session, productId: string): Promise<PlaygroundOverview["researchImages"]> {
  const { data, error } = await session.supabase.from("paid_ad_media").select("public_url, page_id").eq("product_id", productId).eq("status", "done").eq("kind", "image")
    .not("public_url", "is", null).order("updated_at", { ascending: false }).limit(60).returns<{ public_url: string; page_id: string | null }[]>();
  if (error || !data?.length) return [];
  const pageIds = [...new Set(data.map((m) => m.page_id).filter((p): p is string => Boolean(p)))];
  const names = new Map<string, string>();
  if (pageIds.length) {
    const { data: pages } = await session.supabase.from("paid_ads").select("page_id, page_name").eq("product_id", productId).in("page_id", pageIds.slice(0, 100)).limit(500)
      .returns<{ page_id: string; page_name: string }[]>();
    for (const p of pages ?? []) if (!names.has(p.page_id)) names.set(p.page_id, p.page_name);
  }
  return data.filter((m) => /^https:\/\//.test(m.public_url)).map((m) => ({ url: m.public_url, label: null, page: m.page_id ? names.get(m.page_id) ?? null : null }));
}

/**
 * `ticket`: a one-time upload link for one image in <user>/<product>/playground/inputs/ (the browser
 * uploads straight to Storage, as the Product page does).
 * `plan`: the cost (Higgsfield credits, or OpenAI dollars) and warnings for a request (free; nothing is queued).
 * `start`: queues the batch, only at the price the person confirmed (`confirmedCredits`, and `confirmedUsd`
 * when it runs via OpenAI).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/playground/[productId]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { t } = await getTranslator();
  const { productId } = await ctx.params;
  if (!UUID.test(productId)) return notFound(t);
  const { data: product } = await session.supabase.from("products").select("id").eq("id", productId).maybeSingle();
  if (!product) return notFound(t);
  const body = await request.json().catch(() => ({}));

  if (body.action === "ticket") {
    const ext = UPLOAD_TYPES[body.contentType];
    if (!ext) return Response.json({ error: t("Use a PNG, JPEG or WebP image.") }, { status: 400 });
    const full = await refuseWhenFull(session, "upload", { fileBytes: Number(body.size) || 0 });
    if (full) return full;
    const path = `${session.user.id}/${productId}/playground/inputs/${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const bucket = session.supabase.storage.from(WORKSPACE_BUCKET);
    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error) return Response.json({ error: t("Couldn't start the upload: {message}", { message: error.message }) }, { status: 500 });
    return Response.json({ bucket: WORKSPACE_BUCKET, path: data.path, token: data.token, url: bucket.getPublicUrl(data.path).data.publicUrl });
  }

  if (body.action !== "plan" && body.action !== "start") return Response.json({ error: t("Unknown action.") }, { status: 400 });
  // Style Library examples are this site's own files: links on the public origin, then the usual checks.
  const raw = resolveStyleAssets(body.request);
  const problem = playgroundRequestProblem(raw);
  if (problem) return Response.json({ error: t(problem) }, { status: 400 });
  const req: PlaygroundRequest = normalizePlaygroundRequest(raw);
  const options: PlaygroundOptions = normalizePlaygroundOptions(body.options);

  if (body.action === "plan") {
    // The same merged brand the batch is made from (lib/server/brand.ts), so the preview prompt matches.
    const brand = await brandFor(session, productId).catch(() => null);
    if (!brand) return notFound(t);
    const plan = planPlayground(req, options, { ...brand.kit, system: brand.system }, t);
    return Response.json({
      credits: plan.credits, usd: plan.usd ?? 0, provider: req.mode === "video" ? "higgsfield" : options.provider, openaiModel: (plan.jobs[0]?.params.openai as { model?: string } | undefined)?.model ?? null,
      jobs: plan.jobs.length, backend: plan.jobs[0]?.backend ?? "auto", warnings: plan.warnings, errors: plan.errors, prompt: plan.jobs[0]?.prompt ?? "",
    });
  }

  // Never spend without the price the person saw and confirmed.
  const confirmedCredits = Number.isFinite(body.confirmedCredits) ? Number(body.confirmedCredits) : undefined;
  if (confirmedCredits === undefined) return Response.json({ error: t("Confirm the estimated cost first.") }, { status: 400 });
  try {
    const started = await createBatch(session, productId, playgroundBatchRequest(req, options), { confirmedCredits, confirmedUsd: confirmedCreditsOf(body.confirmedUsd), t });
    return Response.json({ batchId: started.batchId, jobIds: started.jobIds, credits: started.credits, usd: started.usd ?? 0, warnings: started.warnings });
  } catch (error) {
    if (error instanceof BatchError) return Response.json({ error: error.message, credits: error.plan?.credits }, { status: error.status });
    return caughtFailure("playground start", error, t("Couldn't start. Try again."), 500, {}, t);
  }
}

/**
 * Deletes a result (`creativeId`): its row and its file(s) in the `creatives` bucket. When nothing of its
 * generation is left (no other results, nothing queued or running), the generation goes too. `batchId`
 * removes a generation that made nothing (failed or cancelled).
 */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/playground/[productId]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { t } = await getTranslator();
  const { productId } = await ctx.params;
  if (!UUID.test(productId)) return notFound(t);
  const body = await request.json().catch(() => ({}));
  const { supabase } = session;

  let batchId: string | null = null;
  if (typeof body.creativeId === "string" && UUID.test(body.creativeId)) {
    const { data: creative } = await supabase.from("creatives").select("id, batch_id, storage_path, poster_path").eq("id", body.creativeId).eq("product_id", productId)
      .maybeSingle<{ id: string; batch_id: string | null; storage_path: string; poster_path: string | null }>();
    if (!creative) return Response.json({ error: t("This result doesn't exist.") }, { status: 404 });
    if (!creative.batch_id || !(await isPlaygroundBatch(session, productId, creative.batch_id))) return Response.json({ error: t("Only Remix results can be deleted here.") }, { status: 400 });
    const { error } = await supabase.from("creatives").delete().eq("id", creative.id);
    if (error) return dbFailure("playground delete result", error, t("Couldn't delete the result. Try again."), 400, {}, t);
    const files = [creative.storage_path, creative.poster_path].filter((p): p is string => Boolean(p) && p!.startsWith(`${productId}/`) && !p!.includes(".."));
    if (files.length) await supabase.storage.from(CREATIVES_BUCKET).remove(files);
    batchId = creative.batch_id;
  } else if (typeof body.batchId === "string" && UUID.test(body.batchId)) {
    if (!(await isPlaygroundBatch(session, productId, body.batchId))) return Response.json({ error: t("This generation doesn't exist.") }, { status: 404 });
    batchId = body.batchId;
  } else {
    return Response.json({ error: t("Which result?") }, { status: 400 });
  }

  // The generation itself, once it holds nothing more (its jobs go with it).
  const [{ count: left }, { count: active }] = await Promise.all([
    supabase.from("creatives").select("id", { count: "exact", head: true }).eq("batch_id", batchId!),
    supabase.from("creative_jobs").select("id", { count: "exact", head: true }).eq("batch_id", batchId!).in("status", [...ACTIVE_JOB_STATUSES]),
  ]);
  if (!left && !active) await supabase.from("creative_batches").delete().eq("id", batchId!);
  else if (typeof body.batchId === "string") return Response.json({ error: active ? t("It's still being made: cancel its queued jobs first.") : t("Delete its results first.") }, { status: 409 });
  return Response.json({ deleted: true, batchRemoved: !left && !active });
}

async function isPlaygroundBatch(session: Session, productId: string, batchId: string) {
  const { data } = await session.supabase.from("creative_batches").select("id").eq("id", batchId).eq("product_id", productId).eq("settings->>source", PLAYGROUND_SOURCE).maybeSingle();
  return Boolean(data);
}
