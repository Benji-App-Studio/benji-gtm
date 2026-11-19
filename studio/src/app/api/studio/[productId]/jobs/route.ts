import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { BatchError, queueCreativeJobOnServer } from "@/lib/server/creative-batches";

/** queueCreativeJob from the browser: one format-card job becomes one batch. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/studio/[productId]/jobs">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return Response.json({ error: "This workspace doesn't exist." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.model !== "string" || typeof body.prompt !== "string") return Response.json({ error: "A job needs a model and a prompt." }, { status: 400 });
  try {
    const started = await queueCreativeJobOnServer(session, {
      productId, formatCardId: typeof body.formatCardId === "string" ? body.formatCardId.slice(0, 200) : null,
      model: body.model, prompt: body.prompt, params: body.params && typeof body.params === "object" ? body.params : {},
    }, { confirmedCredits: Number.isFinite(body.confirmedCredits) ? Number(body.confirmedCredits) : undefined });
    return Response.json(started);
  } catch (error) {
    if (error instanceof BatchError) return Response.json({ error: error.message, plan: error.plan }, { status: error.status });
    return Response.json({ error: `Couldn't queue the job: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }
}
