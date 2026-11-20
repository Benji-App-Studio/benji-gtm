import "server-only";
// Starting a batch: plan the jobs, freeze what QA checks against, queue the AI jobs for the runner,
// and render the Reddit- and tweet-style posts straight away (they're free and need no runner).
import type { MergedBrand } from "@/lib/brand";
import { productsIn, type BrandSystem } from "@/lib/brand-system";
import { competitorNames, CREATIVES_BUCKET } from "@/lib/creatives";
import { brandRules } from "@/lib/brand-rules";
import { cleanAwareness } from "@/lib/awareness";
import { cleanMustAvoid, planBatch, qaContext, qaV2Context, requestFromJob, type BatchRequest, type CreativeJobInput, type Plan, type PlanWords, type PostCopy } from "@/lib/creative-plan";
import type { ProductProfile } from "@/lib/product-insight";
import { PLAYGROUND_SOURCE } from "@/lib/playground";
import { planPlayground } from "@/lib/playground-plan";
import { TEMPLATE_SOURCE } from "@/lib/playground-templates";
import { planTemplateRemake } from "@/lib/playground-templates-plan";
import { getWorkspace, type Workspace } from "@/lib/workspace";
import type { Session } from "./auth";
import { brandFor } from "./brand";
import { renderPost } from "./creative-render";
import { creativesBackend } from "./creatives-backend";
import { fmtUsd } from "@/lib/image-provider";
import { refuseWhenFull } from "./storage";
import { fill } from "@/lib/i18n/translate";

export interface BatchStarted { batchId: string; jobIds: string[]; credits: number; usd?: number; rendered: number; warnings: string[] }

export class BatchError extends Error {
  constructor(message: string, readonly status = 400, readonly plan?: Plan) { super(message); }
}

const storagePath = (productId: string, createdAt: string, jobId: string, file: string) =>
  `${productId}/${createdAt.slice(0, 10)}/${jobId}/${file.replace(/[^A-Za-z0-9._-]+/g, "-")}`;

/**
 * The plan for a request against a workspace (what the confirm dialog shows). Playground batches and
 * template remakes have their own planners and prompts; every planner takes the brand's rules from
 * lib/brand-rules.ts and returns them as Plan.qa, which createBatch freezes as the QA context.
 */
/** `t` words a Studio plan's warnings and errors in the request's language (English without it). */
export function planFor(request: BatchRequest, workspace: Workspace, profile: ProductProfile | null = null, system: BrandSystem | null = null, t?: PlanWords): Plan {
  if (request.source === PLAYGROUND_SOURCE && request.playground) return planPlayground(request.playground, request.playground.options, { ...workspace.brandKit, system }, t);
  if (request.source === TEMPLATE_SOURCE && request.template) return planTemplateRemake(request.template);
  return planBatch(request, { ...workspace.brandKit, profile, system }, t);
}

/** The brand rules QA checks a batch against: the plan's (what its prompts said), else worked out the same way. */
export function qaRulesFor(plan: Plan, request: BatchRequest, merged: Pick<MergedBrand, "kit" | "system" | "profile">) {
  return plan.qa ?? brandRules({ appName: merged.kit.appName, forbiddenClaims: merged.kit.forbiddenClaims, system: merged.system, profile: merged.profile }, { ...request, neutral: request.source === TEMPLATE_SOURCE }).qa;
}

/**
 * A brief that names one of the brand system's products, with no images picked: that product's own
 * pictures become the references (the look block tells the model to show it exactly as they do).
 */
async function withNamedProductImages(session: Session, productId: string, request: BatchRequest, system: BrandSystem | null): Promise<BatchRequest> {
  if (!system || request.useBrandSystem === false || request.brandInBrief || request.productReferences?.length || request.source) return request;
  const named = productsIn(system, request.brief).filter((p) => p.assetIds.length);
  if (!named.length) return request;
  const ids = named.flatMap((p) => p.assetIds.slice(0, 2)).slice(0, 3);
  const { data } = await session.supabase.from("product_assets").select("id, url, label, kind").eq("product_id", productId).in("id", ids).returns<{ id: string; url: string; label: string | null; kind: string }[]>();
  const refs = ids.map((id) => (data ?? []).find((a) => a.id === id)).filter((a): a is { id: string; url: string; label: string | null; kind: string } => Boolean(a))
    .map((a) => ({ url: a.url, label: a.label || named.find((p) => p.assetIds.includes(a.id))?.name || "our product", kind: a.kind }));
  return refs.length ? { ...request, productReferences: refs } : request;
}

export async function createBatch(session: Session, productId: string, requestIn: BatchRequest, o: { confirmedCredits?: number; confirmedUsd?: number; t?: PlanWords } = {}): Promise<BatchStarted> {
  const { supabase } = session;
  // The request's language for what the person reads (the route's translator; English without one).
  const t: PlanWords = o.t ?? ((text, vars) => fill(text, vars));
  const { data: product } = await supabase.from("products").select("id, name, description, category_label").eq("id", productId).maybeSingle<{ id: string; name: string; description: string; category_label: string | null }>();
  if (!product) throw new BatchError(t("This workspace doesn't exist."), 404);
  // Storage full: nothing is queued or paid for, since the results couldn't be saved.
  const full = await refuseWhenFull(session, "generate");
  if (full) throw new BatchError(((await full.json()) as { error: string }).error, 507);
  const [found, merged] = await Promise.all([getWorkspace(productId), brandFor(session, productId)]);
  // The merged brand (lib/server/brand.ts): the kit's basics, colours, tone and every forbidden claim.
  const workspace: Workspace = { ...found, brandKit: merged.kit };
  const brand = merged.kit;
  const { profile, system } = merged;
  const request = await withNamedProductImages(session, productId, requestIn, system);
  // The plan that's saved and queued is worded in English (its warnings are stored with the batch); the
  // person reads the same plan in their language (identical jobs and prices: only the words differ).
  const plan = planFor(request, workspace, profile, system);
  const said = o.t ? planFor(request, workspace, profile, system, t) : plan;
  if (said.errors.length) throw new BatchError(said.errors[0], 400, said);
  // The price shown in the confirm dialog is the price charged: refuse if it moved.
  if (o.confirmedCredits !== undefined && plan.credits > o.confirmedCredits + 0.01) {
    throw new BatchError(t("The estimate changed to {credits} credits; check it and confirm again.", { credits: plan.credits }), 409, said);
  }
  // OpenAI jobs are priced in dollars: those were confirmed too (a batch with any must say what it confirmed).
  if (plan.usd && (o.confirmedUsd === undefined || plan.usd > o.confirmedUsd + 0.0005)) {
    throw new BatchError(o.confirmedUsd === undefined ? t("Confirm the estimated OpenAI cost first.") : t("The OpenAI estimate changed to {usd}; check it and confirm again.", { usd: fmtUsd(plan.usd) }), 409, said);
  }

  // QA checks exactly the brand rules the prompts were built with (every source: Studio, Playground, Recreate, remakes),
  // plus what static generation v2 checks: the intended on-image words, verified facts, wording rules, the
  // people in our reference images, the real logo and the placement. Every asset column is read ("*"):
  // consent and possible_minor arrive with their migration.
  const { data: assets } = await supabase.from("product_assets").select("*").eq("product_id", productId).limit(500);
  const context = {
    ...qaContext({ appName: brand.appName, description: product.description, category: product.category_label, competitors: await competitorNames(supabase, productId), rules: qaRulesFor(plan, request, merged) }),
    ...qaV2Context({ request, system, assets: assets ?? [], iconUrl: brand.iconUrl }),
  };
  // The awareness level (lib/awareness.ts): on the batch and each creative it makes (written only when set).
  const awareness = cleanAwareness(request.awarenessLevel);
  const level = awareness ? { awareness_level: awareness } : {};
  const { data: batch, error } = await supabase.from("creative_batches").insert({
    product_id: productId, format_card_id: request.formatCardId ?? null, brief: request.brief.slice(0, 5000), cost_estimate: plan.credits, context, ...level,
    settings: {
      kinds: request.kinds, variants: request.variants, aspects: request.aspects, placements: request.placements ?? [], format: request.format ?? "single", cards: request.cards, video: request.video, aiVideo: request.aiVideo ?? null, image: request.image,
      brand: { appName: brand.appName, appStoreUrl: brand.appStoreUrl ?? null, screenshotUrls: brand.screenshotUrls, iconUrl: brand.iconUrl ?? null, tagline: brand.tagline ?? null },
      storage: { driveFolderId: workspace.connections.storage?.driveFolderId ?? null },
      warnings: plan.warnings,
      ...(plan.usd ? { usdEstimate: plan.usd } : {}),
      ...(request.mustAvoid?.length ? { mustAvoid: cleanMustAvoid(request.mustAvoid) } : {}),
      ...(request.styleReferences?.length ? { styleReferences: request.styleReferences } : {}),
      ...(request.productReferences?.length ? { productReferences: request.productReferences } : {}),
      profileUsed: Boolean(profile && request.useProfile !== false),
      brandSystemUsed: Boolean(system && (request.brandInBrief || request.useBrandSystem !== false) && request.source !== TEMPLATE_SOURCE),
      ...(request.brandInBrief ? { brandInBrief: true } : {}),
      ...(request.source ? { source: request.source } : {}),
      ...(request.playground ? { playground: request.playground } : {}),
      ...(request.template ? { template: request.template } : {}),
      ...(awareness ? { awarenessLevel: awareness } : {}),
      // The competitor ad it was made from: Launch traces each ad back to it (lib/launch/tracking.ts).
      ...(request.sourceAd ? { sourceAd: request.sourceAd } : {}),
    },
  }).select("id, created_at").single<{ id: string; created_at: string }>();
  if (error || !batch) throw new BatchError(error?.message ?? t("Couldn't start the batch."), 500);

  const { data: jobs, error: jobError } = await supabase.from("creative_jobs").insert(plan.jobs.map((job) => ({
    product_id: productId, batch_id: batch.id, format_card_id: request.formatCardId ?? null, kind: job.kind, model: job.model,
    prompt: job.prompt, params: job.params, aspect: job.aspect, variant: job.variant, backend: job.backend, cost_estimate: job.costEstimate,
  }))).select("id, kind, aspect, variant, params, created_at, backend").returns<{ id: string; kind: string; aspect: string; variant: number; params: Record<string, unknown>; created_at: string; backend: string }[]>();
  if (jobError || !jobs) {
    await supabase.from("creative_batches").delete().eq("id", batch.id);
    throw new BatchError(jobError?.message ?? t("Couldn't queue the jobs."), 500);
  }

  // Posts: render, store, record; then the backend marks their jobs done and runs QA.
  const templates = jobs.filter((j) => j.backend === "template");
  const failures: { jobId: string; error: string }[] = [];
  let rendered = 0;
  for (const job of templates) {
    try {
      const kind = job.kind as "reddit" | "tweet";
      const copy = job.params.copy as PostCopy;
      const out = await renderPost(kind, job.aspect as "9:16" | "4:5" | "1:1", copy, { appName: brand.appName, iconUrl: brand.iconUrl, colors: brand.colors, tagline: brand.tagline }, job.params.community as string | undefined);
      const path = storagePath(productId, job.created_at, job.id, `${kind}-${job.aspect.replace(":", "x")}-v${job.variant}.png`);
      const { error: uploadError } = await supabase.storage.from(CREATIVES_BUCKET).upload(path, out.bytes, { contentType: "image/png", upsert: true });
      if (uploadError) throw new Error(uploadError.message);
      const { error: rowError } = await supabase.from("creatives").insert({
        product_id: productId, job_id: job.id, batch_id: batch.id, format_card_id: request.formatCardId ?? null, kind: "image", style: kind,
        aspect: job.aspect, width: out.width, height: out.height, storage_path: path, mime: "image/png", size_bytes: out.bytes.length,
        url: supabase.storage.from(CREATIVES_BUCKET).getPublicUrl(path).data.publicUrl,
        title: `${kind === "reddit" ? "Reddit post" : "Tweet"} ${job.aspect} v${job.variant}`, headline: copy.title ?? null, primary_text: copy.body,
        format_slug: request.formatCardId ?? null,
        model: `template:${kind}`, prompt: [copy.title, copy.body].filter(Boolean).join("\n\n"),
        copy: { headline: copy.title, body: copy.body, author: brand.appName, community: job.params.community, minTextFrac: out.minTextFrac, contrast: out.contrast, truncated: out.truncated, ...(out.warnings.length ? { warnings: out.warnings } : {}) },
        ...level,
      });
      if (rowError) throw new Error(rowError.message);
      rendered++;
    } catch (e) {
      failures.push({ jobId: job.id, error: `Couldn't render the post: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400) });
    }
  }
  // The backend marks the posts' jobs done (or failed) and runs QA. If it doesn't answer, the jobs stay
  // queued until the queue expires them (30 min for posts, creatives_requeue_stale) and the batch says so.
  const warnings = [...said.warnings];
  if (templates.length) {
    const done = await creativesBackend<{ done?: number; failed?: number }>(session, "templates", { jobIds: templates.map((j) => j.id), failures });
    if (!done.ok) warnings.push(t("The posts were rendered, but the creatives backend didn't confirm them ({reason}), so they aren't checked yet. If they stay queued, start the batch again.", { reason: done.data.error ?? `HTTP ${done.status}` }));
  }

  return { batchId: batch.id, jobIds: jobs.map((j) => j.id), credits: plan.credits, ...(plan.usd ? { usd: plan.usd } : {}), rendered, warnings };
}

/** queueCreativeJob for server code (route handlers, server actions): same as the browser version. */
export function queueCreativeJobOnServer(session: Session, input: CreativeJobInput, o: { confirmedCredits?: number; confirmedUsd?: number } = {}) {
  return createBatch(session, input.productId, requestFromJob(input), o);
}
