import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { launch } from "@/lib/server/launch";
import { relay } from "@/lib/server/radar";

/**
 * Launch's other Meta writes, each confirmed on the page first and each leaving things paused:
 *   { action: "promote", adId, reason }   paused copy of a testing ad in the scaling ad set
 *   { action: "pause", adId }             pause an ad
 *   { action: "setup", stages, confirm }  plan (or create) the paused testing / scaling campaigns
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/launch/[productId]/actions">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  switch (body.action) {
    case "promote": return relay(await launch(session, "promote", { productId, adId: String(body.adId ?? ""), reason: body.reason }));
    case "pause": return relay(await launch(session, "pause", { productId, adId: String(body.adId ?? "") }));
    case "setup": return relay(await launch(session, "setup", { productId, stages: body.stages, confirm: body.confirm === true }));
    default: return Response.json({ error: "Unknown action." }, { status: 400 });
  }
}
