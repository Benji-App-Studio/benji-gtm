import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { callFunction, relay } from "@/lib/server/functions";

/** Removes a person from this install. Owner only; the backend enforces it. */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/install/members/[userId]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { userId } = await ctx.params;
  return relay(await callFunction<{ ok: true }>("install", session, "members/remove", { body: { userId } }));
}
