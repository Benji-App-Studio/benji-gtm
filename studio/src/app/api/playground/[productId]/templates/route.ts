import type { NextRequest } from "next/server";
import { AD_STYLES } from "@/lib/ad-styles";
import { remakeOutcome } from "@/lib/creative-review";
import { CREATIVES_BUCKET } from "@/lib/creatives";
import { isHttpsUrl } from "@/lib/playground-plan";
import { MAX_CUSTOM_TEMPLATES, TEMPLATE_SOURCE, type ProductTemplate } from "@/lib/playground-templates";
import {
  cleanTemplateName, confirmedCreditsOf, filesToRemove, findImported, importedRow, importGroups, importProblem, isUuid, planTemplateRemake, remakeProblem, TEMPLATE_COLUMNS,
  TEMPLATE_NAME_MAX, TEMPLATE_UPLOAD_TYPES, templateFromRow, templateRemakeRequest, templateRemakeSettings, templateUploadProblem, type TemplateRow,
} from "@/lib/playground-templates-plan";
import { isResponse, requireUser, type Session } from "@/lib/server/auth";
import { refuseWhenFull } from "@/lib/server/storage";
import { uploadErrorText } from "@/lib/storage-usage";
import { BatchError, createBatch } from "@/lib/server/creative-batches";
import { research } from "@/lib/server/research";
import { WORKSPACE_BUCKET } from "@/lib/workspace";
import { logCaught, logDbError } from "@/lib/server/errors";

// A product's own Playground template library (contract: lib/playground-templates.ts). Every query is
// scoped to this product, and the product must be the signed-in user's: nothing here is global.
// Starters are Style Library formats added to the library (free). Custom templates are uploaded ads:
// stored in the public `workspace` bucket under <user>/<product>/playground/templates/, read by the
// research function (`template-analyze`, OpenAI vision: a read, not image generation), then, after the
// person confirms the price, remade with GPT Image 2.5 via Higgsfield (default) or via OpenAI, their pick,
// on the creative pipeline (a batch tagged settings.source = "playground-template").
// Ready templates can be imported from the person's other products (`?scope=others` lists them): the copy
// shares the original's files, so a file is only deleted once no template row uses it.

/** The name a custom template has until the analysis names it (the research function's DEFAULT_TEMPLATE_NAME). */
const DEFAULT_NAME = "New template";
/** A read that hasn't finished after this long has died (the edge function's background limit is shorter). */
const ANALYZE_STALE_MS = 6 * 60_000;

type JobRow = { id: string; batch_id: string; status: "queued" | "running" | "finalizing" | "done" | "failed" | "cancelled"; error: string | null };
type CreativeRow = { id: string; batch_id: string; url: string; thumbnail_url: string | null; storage_path: string; poster_path: string | null; created_at: string; qa_status: string; qa: { checks?: { verdict: string; label: string; reason: string }[] } | null };

const notFound = () => Response.json({ error: "This workspace doesn't exist." }, { status: 404 });
const noTemplate = () => Response.json({ error: "This template doesn't exist." }, { status: 404 });
const bad = (error: string, status = 400) => Response.json({ error }, { status });

/** The signed-in user and this product, only if it's theirs. */
async function scope(ctx: RouteContext<"/api/playground/[productId]/templates">): Promise<{ session: Session; productId: string } | Response> {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  if (!isUuid(productId)) return notFound();
  const { data: product } = await session.supabase.from("products").select("id").eq("id", productId).eq("user_id", session.user.id).maybeSingle();
  if (!product) return notFound();
  return { session, productId };
}

async function loadTemplate(session: Session, productId: string, templateId: unknown): Promise<TemplateRow | null> {
  if (!isUuid(templateId)) return null;
  const { data } = await session.supabase.from("product_templates").select(TEMPLATE_COLUMNS).eq("id", templateId).eq("product_id", productId).maybeSingle<TemplateRow>();
  return data ?? null;
}

/** An update scoped to this product and template; the row as it is afterwards. */
async function updateTemplate(session: Session, productId: string, id: string, patch: Partial<TemplateRow>, onlyIf?: { status: string }) {
  let query = session.supabase.from("product_templates").update(patch).eq("id", id).eq("product_id", productId);
  if (onlyIf) query = query.eq("status", onlyIf.status);
  const { data, error } = await query.select(TEMPLATE_COLUMNS).maybeSingle<TemplateRow>();
  return { row: data ?? null, error };
}

const publicCreativeUrl = (session: Session, path: string | null) => (path ? session.supabase.storage.from(CREATIVES_BUCKET).getPublicUrl(path).data.publicUrl : null);

/** The names of the products these templates were imported from (only the person's own), for importedFrom. */
async function importNames(session: Session, rows: TemplateRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.imported_from_product_id).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map();
  const { data } = await session.supabase.from("products").select("id, name").eq("user_id", session.user.id).in("id", ids).returns<{ id: string; name: string }[]>();
  return new Map((data ?? []).map((p) => [p.id, p.name]));
}

/** Rows as the contract's templates, with the names of the products imported ones came from. */
async function named(session: Session, rows: TemplateRow[]): Promise<ProductTemplate[]> {
  const names = await importNames(session, rows);
  return rows.map((r) => templateFromRow(r, names));
}

/**
 * This product's templates, newest first. Remakes that finished or failed (and reads that died) are settled first.
 * `?scope=others`: instead, the ready templates of the person's other products, for the import picker.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/playground/[productId]/templates">) {
  const scoped = await scope(ctx);
  if (isResponse(scoped)) return scoped;
  const { session, productId } = scoped;
  if (request.nextUrl.searchParams.get("scope") === "others") return others(session, productId);
  const { supabase } = session;
  const { data, error } = await supabase.from("product_templates").select(TEMPLATE_COLUMNS).eq("product_id", productId).order("created_at", { ascending: false }).limit(200).returns<TemplateRow[]>();
  if (error) return Response.json({ templates: [], error: "The template library isn't in the database yet (migrations 20261003800000 and 20261005800000)." });
  let rows = data ?? [];
  // A library that has never had anything starts with every starter style (the ready-made formats), so
  // a new product isn't empty; removing them later is the person's choice and they don't come back.
  if (!rows.length) {
    await supabase.from("product_templates").insert(AD_STYLES.map((style) => ({
      product_id: productId, kind: "starter", starter_id: style.id, name: style.name.slice(0, TEMPLATE_NAME_MAX), status: "ready",
      template_url: style.referenceImage, thumb_url: style.thumbImage,
    })));
    rows = (await supabase.from("product_templates").select(TEMPLATE_COLUMNS).eq("product_id", productId).order("created_at", { ascending: false }).limit(200).returns<TemplateRow[]>()).data ?? [];
  }

  // Remakes: the batch's job and creative say where each one is. A remake QA failed never becomes the
  // template; while QA is still checking it, it keeps generating (lib/creative-review.ts remakeOutcome).
  const generating = rows.filter((r) => r.status === "generating");
  const batchIds = generating.map((r) => r.batch_id).filter((id): id is string => Boolean(id));
  const [jobs, creatives] = batchIds.length
    ? await Promise.all([
      supabase.from("creative_jobs").select("id, batch_id, status, error").eq("product_id", productId).in("batch_id", batchIds).returns<JobRow[]>(),
      supabase.from("creatives").select("id, batch_id, url, thumbnail_url, storage_path, poster_path, created_at, qa_status, qa").eq("product_id", productId).in("batch_id", batchIds)
        .order("created_at", { ascending: true }).returns<CreativeRow[]>(),
    ])
    : [{ data: [] as JobRow[] }, { data: [] as CreativeRow[] }];
  const settled = new Map<string, TemplateRow>();
  for (const row of generating) {
    let patch: Partial<TemplateRow> | null = null;
    if (!row.batch_id) {
      patch = { status: "failed", error: "The remake was removed. Make it again." };
    } else {
      const outcome = remakeOutcome((creatives.data ?? []).filter((c) => c.batch_id === row.batch_id));
      const made = outcome && "use" in outcome ? (creatives.data ?? []).find((c) => c.id === outcome.use) : undefined;
      const batchJobs = (jobs.data ?? []).filter((j) => j.batch_id === row.batch_id);
      if (outcome && "failed" in outcome) {
        patch = { status: "failed", error: outcome.failed };
      } else if (made) {
        patch = {
          status: "ready", error: null, template_url: made.url, template_path: made.storage_path,
          thumb_url: (isHttpsUrl(made.thumbnail_url) ? made.thumbnail_url : null) ?? publicCreativeUrl(session, made.poster_path) ?? made.url,
        };
      } else if (!outcome && (!batchJobs.length || batchJobs.every((j) => j.status === "failed" || j.status === "cancelled" || j.status === "done"))) {
        const failed = batchJobs.find((j) => j.error);
        patch = { status: "failed", error: (failed?.error ?? (batchJobs.some((j) => j.status === "cancelled") ? "The remake was cancelled." : "The remake made nothing. Try again.")).slice(0, 400) };
      }
    }
    if (patch) {
      const { row: updated } = await updateTemplate(session, productId, row.id, patch, { status: "generating" });
      if (updated) settled.set(row.id, updated);
    }
  }
  const stale = rows.filter((r) => r.status === "analyzing" && Date.now() - Date.parse(r.updated_at) > ANALYZE_STALE_MS);
  for (const row of stale) {
    const { row: updated } = await updateTemplate(session, productId, row.id, { status: "failed", error: "Reading the image didn't finish. Try again." }, { status: "analyzing" });
    if (updated) settled.set(row.id, updated);
  }

  const templates = await named(session, rows.map((r) => settled.get(r.id) ?? r));
  return Response.json({ templates });
}

/** The person's other products and their ready templates (each marked when this product already has it). */
async function others(session: Session, productId: string) {
  const { supabase } = session;
  // All the person's products (this one too, so a copy that came from here is named); importGroups skips this one.
  const { data: products, error } = await supabase.from("products").select("id, name").eq("user_id", session.user.id)
    .order("is_primary", { ascending: false }).order("created_at").returns<{ id: string; name: string }[]>();
  if (error) return Response.json({ groups: [], error: "Couldn't load your other products." }, { status: 500 });
  const otherIds = (products ?? []).filter((p) => p.id !== productId).map((p) => p.id);
  if (!otherIds.length) return Response.json({ groups: [] });
  const [theirs, ours] = await Promise.all([
    supabase.from("product_templates").select(TEMPLATE_COLUMNS).eq("user_id", session.user.id).in("product_id", otherIds).eq("status", "ready")
      .order("created_at", { ascending: false }).limit(500).returns<TemplateRow[]>(),
    supabase.from("product_templates").select(TEMPLATE_COLUMNS).eq("product_id", productId).limit(200).returns<TemplateRow[]>(),
  ]);
  if (theirs.error || ours.error) return Response.json({ groups: [], error: "Couldn't load the templates of your other products." }, { status: 500 });
  const groups = importGroups(products ?? [], theirs.data ?? [], productId, ours.data ?? []);
  return Response.json({ groups });
}

/**
 * `add-starter` (JSON): a Style Library format into this product's library; idempotent.
 * `upload` (multipart, `file`): an ad image, stored and sent to be read (status "analyzing").
 * `analyze` (JSON): reads a custom template again (after a failed read).
 * `plan-remake` (JSON): what a remake costs via `provider` (Higgsfield credits or OpenAI dollars; free, nothing is queued).
 * `remake` (JSON): queues the remake via `provider`, only at the price the person confirmed (`confirmedCredits`, `confirmedUsd`).
 * `import` (JSON): copies a ready template of another of the person's products into this one (free, idempotent).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/playground/[productId]/templates">) {
  const scoped = await scope(ctx);
  if (isResponse(scoped)) return scoped;
  const { session, productId } = scoped;

  if ((request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return bad("Couldn't read the upload.");
    if ((form.get("action") ?? "upload") !== "upload") return bad("Unknown action.");
    return upload(session, productId, form.get("file"));
  }

  const body = await request.json().catch(() => ({}));
  switch (body?.action) {
    case "add-starter": return addStarter(session, productId, body.starterId);
    case "upload": return bad("Send the image as multipart/form-data with a `file` field.");
    case "analyze": return analyze(session, productId, body.templateId);
    case "plan-remake": return planRemake(session, productId, body.templateId, body.provider);
    case "remake": return remake(session, productId, body.templateId, body.confirmedCredits, body.provider, body.confirmedUsd);
    case "import": return importTemplate(session, productId, body.templateId);
    default: return bad("Unknown action.");
  }
}

async function addStarter(session: Session, productId: string, starterId: unknown) {
  const style = typeof starterId === "string" ? AD_STYLES.find((s) => s.id === starterId) : undefined;
  if (!style) return bad("That style isn't in the Style Library.");
  const existing = async () => (await session.supabase.from("product_templates").select(TEMPLATE_COLUMNS).eq("product_id", productId).eq("starter_id", style.id).maybeSingle<TemplateRow>()).data;
  const found = await existing();
  if (found) return Response.json({ template: templateFromRow(found) });
  const { data, error } = await session.supabase.from("product_templates").insert({
    product_id: productId, kind: "starter", starter_id: style.id, name: style.name.slice(0, TEMPLATE_NAME_MAX), status: "ready",
    template_url: style.referenceImage, thumb_url: style.thumbImage,
  }).select(TEMPLATE_COLUMNS).single<TemplateRow>();
  if (error) {
    // Added at the same moment from another tab: the unique (product, starter) index kept one.
    const again = error.code === "23505" ? await existing() : null;
    if (again) return Response.json({ template: templateFromRow(again) });
    return bad(logDbError("template add starter", error, "Couldn't add it. Try again."), 500);
  }
  return Response.json({ template: templateFromRow(data) });
}

/**
 * A ready template of another of the person's products, into this one. A starter is added as usual. A
 * custom template becomes a new ready row here that points at the same files (its image is brand-neutral
 * already): nothing is generated and no credits are spent. Importing the same one again returns the copy.
 */
async function importTemplate(session: Session, productId: string, templateId: unknown) {
  if (!isUuid(templateId)) return noTemplate();
  const { supabase } = session;
  // Any product of the person's: the row must be theirs, and its product too.
  const { data: source } = await supabase.from("product_templates").select(TEMPLATE_COLUMNS).eq("id", templateId).eq("user_id", session.user.id).maybeSingle<TemplateRow>();
  if (!source) return noTemplate();
  const { data: from } = await supabase.from("products").select("id, name").eq("id", source.product_id).eq("user_id", session.user.id).maybeSingle<{ id: string; name: string }>();
  if (!from) return noTemplate();
  const problem = importProblem(source, productId);
  if (problem) return bad(problem, 409);
  if (source.kind === "starter") return addStarter(session, productId, source.starter_id);

  const { data: current } = await supabase.from("product_templates").select(TEMPLATE_COLUMNS).eq("product_id", productId).limit(200).returns<TemplateRow[]>();
  const existing = findImported(source, current ?? []);
  if (existing) return Response.json({ template: (await named(session, [existing]))[0] });
  if ((current ?? []).filter((r) => r.kind === "custom").length >= MAX_CUSTOM_TEMPLATES) return bad(`This product already has ${MAX_CUSTOM_TEMPLATES} of your own templates. Delete one first.`, 409);

  const { data, error } = await supabase.from("product_templates").insert(importedRow(source, productId)).select(TEMPLATE_COLUMNS).single<TemplateRow>();
  if (error || !data) return bad(logDbError("template import", error, "Couldn't import it. Try again."), 500);
  return Response.json({ template: templateFromRow(data, new Map([[from.id, from.name]])) });
}

async function upload(session: Session, productId: string, file: FormDataEntryValue | null) {
  if (!file || typeof file === "string") return bad("Choose an image to upload.");
  const problem = templateUploadProblem(file);
  if (problem) return bad(problem);
  const { supabase } = session;
  const { count } = await supabase.from("product_templates").select("id", { count: "exact", head: true }).eq("product_id", productId).eq("kind", "custom");
  if ((count ?? 0) >= MAX_CUSTOM_TEMPLATES) return bad(`This product already has ${MAX_CUSTOM_TEMPLATES} uploaded templates. Delete one first.`, 409);

  const full = await refuseWhenFull(session, "upload", { fileBytes: file.size });
  if (full) return full;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = templateUploadProblem({ type: file.type, size: bytes.byteLength }, bytes.subarray(0, 16));
  if (sniffed) return bad(sniffed);
  const type = file.type;
  const path = `${session.user.id}/${productId}/playground/templates/${crypto.randomUUID()}.${TEMPLATE_UPLOAD_TYPES[type]}`;
  const bucket = supabase.storage.from(WORKSPACE_BUCKET);
  const { error: uploadError } = await bucket.upload(path, bytes, { contentType: type, upsert: false });
  if (uploadError) return bad(uploadErrorText(uploadError), 500);
  const sourceUrl = bucket.getPublicUrl(path).data.publicUrl;

  const { data: row, error } = await supabase.from("product_templates").insert({
    product_id: productId, kind: "custom", name: DEFAULT_NAME, status: "analyzing", source_url: sourceUrl, source_path: path,
  }).select(TEMPLATE_COLUMNS).single<TemplateRow>();
  if (error || !row) {
    await bucket.remove([path]);
    return bad(logDbError("template upload row", error, "Couldn't add it. Try again."), 500);
  }
  return Response.json({ template: templateFromRow(await startAnalysis(session, productId, row)) });
}

/** Asks the research function to read a template (it answers at once and reads in the background). */
async function startAnalysis(session: Session, productId: string, row: TemplateRow): Promise<TemplateRow> {
  const started = await research<{ status?: string; error?: string }>(session, "template-analyze", { productId, templateId: row.id }, 20_000);
  if (started.ok) return (await loadTemplate(session, productId, row.id)) ?? row;
  const message = String(started.data?.error ?? "Couldn't start reading the image.").slice(0, 400);
  const { row: failed } = await updateTemplate(session, productId, row.id, { status: "failed", error: message }, { status: "analyzing" });
  return failed ?? (await loadTemplate(session, productId, row.id)) ?? row;
}

async function analyze(session: Session, productId: string, templateId: unknown) {
  const row = await loadTemplate(session, productId, templateId);
  if (!row) return noTemplate();
  if (row.kind !== "custom" || !isHttpsUrl(row.source_url)) return bad("Only an uploaded ad can be read.");
  if (row.status === "generating" || row.status === "ready" || row.status === "analyzing") return bad(row.status === "analyzing" ? "It's already being read." : "It's already being made or made.", 409);
  const { row: claimed } = await updateTemplate(session, productId, row.id, { status: "analyzing", error: null }, { status: row.status });
  if (!claimed) return bad("It changed meanwhile; reload and try again.", 409);
  return Response.json({ template: templateFromRow(await startAnalysis(session, productId, claimed)) });
}

async function planRemake(session: Session, productId: string, templateId: unknown, provider: unknown) {
  const row = await loadTemplate(session, productId, templateId);
  if (!row) return noTemplate();
  const template = templateFromRow(row);
  const problem = remakeProblem(template);
  if (problem) return bad(problem, 409);
  const settings = templateRemakeSettings(template, provider);
  const plan = planTemplateRemake(settings);
  return Response.json({ credits: plan.credits, usd: plan.usd ?? 0, provider: settings.provider, warnings: plan.warnings, errors: plan.errors, jobs: plan.jobs.length, backend: plan.jobs[0]?.backend ?? "auto", prompt: plan.jobs[0]?.prompt ?? "" });
}

async function remake(session: Session, productId: string, templateId: unknown, confirmed: unknown, provider: unknown, confirmedUsd: unknown) {
  // Never spend without the price the person saw and confirmed.
  const confirmedCredits = confirmedCreditsOf(confirmed);
  if (confirmedCredits === undefined) return bad("Confirm the estimated cost first.");
  const row = await loadTemplate(session, productId, templateId);
  if (!row) return noTemplate();
  const template = templateFromRow(row);
  const problem = remakeProblem(template);
  if (problem) return bad(problem, 409);

  // Claim it first, so two clicks can't start two paid remakes.
  const { row: claimed } = await updateTemplate(session, productId, row.id, { status: "generating", error: null }, { status: row.status });
  if (!claimed) return bad("It changed meanwhile; reload and try again.", 409);
  const revert = (error: string | null) => updateTemplate(session, productId, row.id, { status: row.status, error }, { status: "generating" });
  try {
    const started = await createBatch(session, productId, templateRemakeRequest(templateRemakeSettings(template, provider)), { confirmedCredits, confirmedUsd: confirmedCreditsOf(confirmedUsd) });
    const { row: linked } = await updateTemplate(session, productId, row.id, { batch_id: started.batchId, status: "generating", error: null });
    // An earlier remake that failed made nothing worth keeping: its batch goes.
    if (row.batch_id && row.batch_id !== started.batchId) await removeRemake(session, productId, row.batch_id);
    return Response.json({ template: templateFromRow(linked ?? { ...claimed, batch_id: started.batchId }), credits: started.credits, warnings: started.warnings });
  } catch (error) {
    await revert(row.error);
    if (error instanceof BatchError) return Response.json({ error: error.message, credits: error.plan?.credits }, { status: error.status });
    return bad(logCaught("template remake", error, "Couldn't start. Try again."), 500);
  }
}

/** Renames a template. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/playground/[productId]/templates">) {
  const scoped = await scope(ctx);
  if (isResponse(scoped)) return scoped;
  const { session, productId } = scoped;
  const body = await request.json().catch(() => ({}));
  const cleaned = cleanTemplateName(body?.name);
  if ("error" in cleaned) return bad(cleaned.error);
  const { name } = cleaned;
  const row = await loadTemplate(session, productId, body?.templateId);
  if (!row) return noTemplate();
  const { row: updated, error } = await updateTemplate(session, productId, row.id, { name });
  if (error || !updated) return bad(logDbError("template rename", error, "Couldn't rename it. Try again."), 500);
  return Response.json({ template: (await named(session, [updated]))[0] });
}

/**
 * Removes a remake: its creative(s) (rows and files in the `creatives` bucket) and its batch, as the
 * Playground's DELETE does. Only a remake batch of this product. Queued jobs are cancelled first; a
 * running one makes it refuse (returns false). `keepFiles`: the rows go but the files stay, because a
 * copy of the template in another product still shows them.
 */
async function removeRemake(session: Session, productId: string, batchId: string, keepFiles = false): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { supabase } = session;
  const { data: batch } = await supabase.from("creative_batches").select("id").eq("id", batchId).eq("product_id", productId).eq("settings->>source", TEMPLATE_SOURCE).maybeSingle();
  if (!batch) return { ok: true };
  await supabase.from("creative_jobs").update({ status: "cancelled" }).eq("batch_id", batch.id).eq("product_id", productId).eq("status", "queued");
  const { count: running } = await supabase.from("creative_jobs").select("id", { count: "exact", head: true }).eq("batch_id", batch.id).in("status", ["running", "finalizing"]);
  if (running) return { ok: false, error: "It's being made right now; delete it once it's done.", status: 409 };
  const { data: made } = await supabase.from("creatives").select("id, storage_path, poster_path").eq("batch_id", batch.id).eq("product_id", productId)
    .returns<{ id: string; storage_path: string; poster_path: string | null }[]>();
  if (made?.length) {
    const { error } = await supabase.from("creatives").delete().in("id", made.map((c) => c.id));
    if (error) return { ok: false, error: logDbError("template delete remake", error, "Couldn't delete the remake. Try again."), status: 500 };
    const files = made.flatMap((c) => [c.storage_path, c.poster_path]).filter((p): p is string => Boolean(p) && p!.startsWith(`${productId}/`) && !p!.includes(".."));
    if (files.length && !keepFiles) await supabase.storage.from(CREATIVES_BUCKET).remove(files);
  }
  await supabase.from("creative_batches").delete().eq("id", batch.id).eq("product_id", productId);
  return { ok: true };
}

/**
 * Deletes a template: its row, its uploaded original (workspace bucket) and, for a remake, the remake's
 * creative and batch (removeRemake). Refused while the remake's job is running. Files another template
 * row still points at (a copy imported into another product, or the original a copy came from) stay.
 */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/playground/[productId]/templates">) {
  const scoped = await scope(ctx);
  if (isResponse(scoped)) return scoped;
  const { session, productId } = scoped;
  const { supabase } = session;
  const body = await request.json().catch(() => ({}));
  const row = await loadTemplate(session, productId, body?.templateId);
  if (!row) return noTemplate();

  // Who else uses its files: any of the person's template rows with the same upload or remade image.
  type Paths = Pick<TemplateRow, "id" | "source_path" | "template_path">;
  const paths = [row.source_path, row.template_path].filter((p): p is string => Boolean(p));
  const using = (column: "source_path" | "template_path") =>
    supabase.from("product_templates").select("id, source_path, template_path").eq("user_id", session.user.id).neq("id", row.id).in(column, paths).returns<Paths[]>();
  const sharing = paths.length ? await Promise.all([using("source_path"), using("template_path")]) : [];
  // Unsure who uses them: keep the files rather than break another product's template.
  const remove = sharing.some((r) => r.error) ? { source: false, template: false } : filesToRemove(row, sharing.flatMap((r) => r.data ?? []));

  if (row.batch_id) {
    // A remake that never became the template (failed) has no copies: its files always go.
    const removed = await removeRemake(session, productId, row.batch_id, Boolean(row.template_path) && !remove.template);
    if (!removed.ok) return bad(removed.error, removed.status);
  }

  const { error } = await supabase.from("product_templates").delete().eq("id", row.id).eq("product_id", productId);
  if (error) return bad(logDbError("template delete", error, "Couldn't delete it. Try again."), 500);
  const ownFolder = `${session.user.id}/${productId}/playground/templates/`;
  if (remove.source && row.source_path && row.source_path.startsWith(ownFolder) && !row.source_path.includes("..")) await supabase.storage.from(WORKSPACE_BUCKET).remove([row.source_path]);
  return Response.json({ ok: true });
}
