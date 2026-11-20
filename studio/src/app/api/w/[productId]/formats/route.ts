import type { NextRequest } from "next/server";
import { getTranslator } from "@/lib/i18n/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { appContext, listCards, resolveProduct } from "@/lib/server/formats";
import { caughtFailure } from "@/lib/server/errors";

const headers = { "Cache-Control": "no-store" };

/** The workspace's format library: its cards and the app context recreate prompts are written from. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/w/[productId]/formats">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const product = await resolveProduct(session, (await ctx.params).productId);
  const { t } = await getTranslator();
  if (!product) return Response.json({ error: t("This workspace doesn't exist.") }, { status: 404 });
  try {
    const [app, library] = await Promise.all([appContext(session, product), listCards(session, product)]);
    return Response.json({ app, ...library }, { headers });
  } catch (error) {
    return caughtFailure("formats list", error, t("Couldn't load the format library. Try again."), 500, {}, t);
  }
}

/** Rebuilds the library from the workspace's latest reports (cards keep their ids). */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/w/[productId]/formats">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const product = await resolveProduct(session, (await ctx.params).productId);
  const { t } = await getTranslator();
  if (!product) return Response.json({ error: t("This workspace doesn't exist.") }, { status: 404 });
  try {
    const [app, library] = await Promise.all([appContext(session, product), listCards(session, product, { rebuild: true })]);
    return Response.json({ app, ...library }, { headers });
  } catch (error) {
    return caughtFailure("formats rebuild", error, t("Couldn't rebuild the format library. Try again."), 500, {}, t);
  }
}
