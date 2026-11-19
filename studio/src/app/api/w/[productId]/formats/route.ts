import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { appContext, listCards, resolveProduct } from "@/lib/server/formats";

const headers = { "Cache-Control": "no-store" };

/** The workspace's format library: its cards and the app context recreate prompts are written from. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/w/[productId]/formats">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const product = await resolveProduct(session, (await ctx.params).productId);
  if (!product) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const [app, library] = await Promise.all([appContext(session, product), listCards(session, product)]);
    return Response.json({ app, ...library }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

/** Rebuilds the library from the workspace's latest reports (cards keep their ids). */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/w/[productId]/formats">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const product = await resolveProduct(session, (await ctx.params).productId);
  if (!product) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const [app, library] = await Promise.all([appContext(session, product), listCards(session, product, { rebuild: true })]);
    return Response.json({ app, ...library }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
