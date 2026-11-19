import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { radar, relay } from "@/lib/server/radar";

/** Stops the project's competitor search or run (and its Apify scrapes). */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/projects/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  return relay(await radar(session, "cancel", { projectId: id }));
}
