import { getTranslator } from "@/lib/i18n/server";
import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { appContext, resolveProduct } from "@/lib/server/formats";

/** What recreate prompts know about the app ("primary" = the user's primary product). */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/w/[productId]/app">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const product = await resolveProduct(session, (await ctx.params).productId);
  if (!product) return Response.json({ error: (await getTranslator()).t("Add your product first.") }, { status: 404 });
  return Response.json({ app: await appContext(session, product) });
}
