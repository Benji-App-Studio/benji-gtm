import type { NextRequest } from "next/server";
import { cleanMustAvoid, cleanProductReferences, cleanStyleReferences, DEFAULT_REQUEST, type BatchRequest } from "@/lib/creative-plan";
import { isResponse, requireUser } from "@/lib/server/auth";
import { cleanLogo } from "@/lib/logo-overlay";
import { cleanAwareness } from "@/lib/awareness";
import { BatchError, createBatch } from "@/lib/server/creative-batches";
import { normalizeImageProvider } from "@/lib/image-provider";
import { confirmedCreditsOf } from "@/lib/playground-templates-plan";

/** Starts a batch. The body is a BatchRequest plus the credits (and, for OpenAI images, the dollars) the user confirmed. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/studio/[productId]/batches">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return Response.json({ error: "This workspace doesn't exist." }, { status: 404 });
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
  };
  const confirmedCredits = Number.isFinite(body.confirmedCredits) ? Number(body.confirmedCredits) : undefined;
  if (confirmedCredits === undefined) return Response.json({ error: "Confirm the estimated cost first." }, { status: 400 });
  try {
    return Response.json(await createBatch(session, productId, req, { confirmedCredits, confirmedUsd: confirmedCreditsOf(body.confirmedUsd) }));
  } catch (error) {
    if (error instanceof BatchError) return Response.json({ error: error.message, plan: error.plan }, { status: error.status });
    return Response.json({ error: `Couldn't start the batch: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }
}
