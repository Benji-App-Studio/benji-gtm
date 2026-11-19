import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { loadMarketApp } from "@/lib/server/market";
import { caughtFailure } from "@/lib/server/errors";

const UUID = /^[0-9a-f-]{36}$/;

/** One tracked app: snapshots, releases, review stars, newest reviews and its AI summary. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/w/[productId]/market/[appId]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId, appId } = await ctx.params;
  if (!UUID.test(productId) || !UUID.test(appId)) return Response.json({ error: "Which app?" }, { status: 400 });
  try {
    const detail = await loadMarketApp(session, productId, appId);
    if (detail.setup && !detail.app) return Response.json({ error: "That app isn't tracked any more." }, { status: 404 });
    return Response.json(detail);
  } catch (error) {
    return caughtFailure("market app load", error, "Couldn't load this app. Try again.");
  }
}
