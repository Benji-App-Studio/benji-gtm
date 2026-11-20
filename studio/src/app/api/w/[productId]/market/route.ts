import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { loadMarket, MARKET_ACTIONS, marketFunction, type MarketAction } from "@/lib/server/market";
import { caughtFailure } from "@/lib/server/errors";
import { getTranslator } from "@/lib/i18n/server";

const UUID = /^[0-9a-f-]{36}$/;

// A first read of an app's reviews, or an AI summary, can take a while.
export const maxDuration = 150;

/** The Market page: the tracked apps, their AI summaries and the product's competitor names. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/w/[productId]/market">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  const { t } = await getTranslator();
  if (!UUID.test(productId)) return Response.json({ error: t("Which app?") }, { status: 400 });
  try {
    return Response.json(await loadMarket(session, productId, t));
  } catch (error) {
    return caughtFailure("market load", error, t("Couldn't load Market. Try again."), 500, {}, t);
  }
}

/**
 * `{ action, ...fields }`: search, suggest, track, untrack, refresh, charts, summary or chart-summary.
 * Relayed to the insight function's market route, which checks the product is the caller's.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/w/[productId]/market">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  const { t } = await getTranslator();
  if (!UUID.test(productId)) return Response.json({ error: t("Which app?") }, { status: 400 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "") as MarketAction;
  if (!(action in MARKET_ACTIONS)) return Response.json({ error: t("Unknown action.") }, { status: 400 });
  const fields: Record<string, unknown> = { ...body, productId };
  delete fields.action;
  const result = await marketFunction(session, action, fields, t);
  return Response.json(result.data, { status: result.ok ? 200 : result.status });
}
