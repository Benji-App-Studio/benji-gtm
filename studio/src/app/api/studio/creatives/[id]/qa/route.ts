import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { creativesBackend } from "@/lib/server/creatives-backend";

/** Runs QA on a creative again (after an error, or once the workspace's rules changed). */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/studio/creatives/[id]/qa">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const result = await creativesBackend(session, "qa", { creativeIds: [id] });
  return Response.json(result.data, { status: result.ok ? 200 : result.status });
}
