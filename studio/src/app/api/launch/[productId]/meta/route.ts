import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { launch } from "@/lib/server/launch";
import { relay } from "@/lib/server/radar";

/** The "Send to Meta" sheet's calls to the launch function (supabase/functions/launch/sheet.ts). */
const ROUTES = new Set(["campaigns", "adsets", "connections", "search", "estimate", "ad-preview", "send", "edit"]);

/**
 * Relays { route, ...body } to the launch function as the signed-in user. The function checks
 * LAUNCH_ALLOWED_EMAILS and the workspace's ad account on every call; /send and /edit only write to
 * Meta with confirm: true, and everything they create stays paused.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/launch/[productId]/meta">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const route = String(body?.route ?? "");
  if (!ROUTES.has(route)) return Response.json({ error: "Unknown request." }, { status: 400 });
  const { route: _route, ...rest } = body as Record<string, unknown>;
  void _route;
  return relay(await launch(session, route, { ...rest, productId }, route === "send" ? 90_000 : 30_000));
}
