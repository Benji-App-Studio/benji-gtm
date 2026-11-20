import type { NextRequest } from "next/server";
import { cleanMustAvoid, cleanProductReferences, cleanSourceAd, cleanStyleReferences, DEFAULT_REQUEST, type BatchRequest } from "@/lib/creative-plan";
import { isResponse, requireUser } from "@/lib/server/auth";
import { cleanLogo } from "@/lib/logo-overlay";
import { cleanAwareness } from "@/lib/awareness";
import { BatchError, createBatch } from "@/lib/server/creative-batches";
import { normalizeImageProvider } from "@/lib/image-provider";
import { confirmedCreditsOf } from "@/lib/playground-templates-plan";
import { caughtFailure } from "@/lib/server/errors";
import { getTranslator } from "@/lib/i18n/server";

/** One batch's jobs and creatives (`?id=`), for a sheet that follows what it started (Research's "Make this for <app>"). */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/studio/[productId]/batches">) {
  const { t } = await getTranslator();
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(productId) || !/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: t("This batch doesn't exist.") }, { status: 404 });
  const [jobs, creatives] = await Promise.all([
    session.supabase.from("creative_jobs").select("id, status, error, params, aspect, variant, model, cost_estimate, cost_credits").eq("product_id", productId).eq("batch_id", id).order("created_at"),
    session.supabase.from("creatives").select("id, job_id, url, thumbnail_url, kind, aspect, width, height, qa_status, approval").eq("product_id", productId).eq("batch_id", id).order("created_at"),
  ]);
  if (jobs.error) return Response.json({ error: jobs.error.message }, { status: 500 });
  return Response.json({ jobs: jobs.data ?? [], creatives: creatives.data ?? [] });
}

/** Starts a batch. The body is a BatchRequest plus the credits (and, for OpenAI images, the dollars) the user confirmed. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/studio/[productId]/batches">) {
  const { t } = await getTranslator();
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return Response.json({ error: t("This workspace doesn't exist.") }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const input = (body.request ?? {}) as Partial<BatchRequest>;
  const req: BatchRequest = {
    ...DEFAULT_REQUEST, ...input,
    brief: String(input.brief ?? ""),
    video: { ...DEFAULT_REQUEST.video, ...(input.video ?? {}) },
    image: { ...DEFAULT_REQUEST.image, ...(input.image ?? {}), provider: normalizeImageProvider(input.image?.provider) },
    reddit: Array.isArray(input.reddit) ? input.reddit : [],
    tweets: Array.isArray(input.tweets) ? input.tweets : [],
    mustAvoid: cleanMustAvoid(input.mustAvoid),
    styleReferences: cleanStyleReferences(input.styleReferences),
    productReferences: cleanProductReferences(input.productReferences),
    referencesInBrief: input.referencesInBrief === true,
    brandInBrief: input.brandInBrief === true,
    fromRecreate: input.fromRecreate === true,
    exactRecreate: input.exactRecreate === true,
    logo: cleanLogo(input.logo),
    awarenessLevel: cleanAwareness(input.awarenessLevel),
    sourceAd: cleanSourceAd(input.sourceAd),
  };
  const confirmedCredits = Number.isFinite(body.confirmedCredits) ? Number(body.confirmedCredits) : undefined;
  if (confirmedCredits === undefined) return Response.json({ error: t("Confirm the estimated cost first.") }, { status: 400 });
  try {
    return Response.json(await createBatch(session, productId, req, { confirmedCredits, confirmedUsd: confirmedCreditsOf(body.confirmedUsd), t }));
  } catch (error) {
    if (error instanceof BatchError) return Response.json({ error: error.message, plan: error.plan }, { status: error.status });
    return caughtFailure("start batch", error, t("Couldn't start the batch. Try again."), 500, {}, t);
  }
}
