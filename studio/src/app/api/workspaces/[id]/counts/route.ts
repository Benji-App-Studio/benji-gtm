import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { loadRow, workspaceCounts } from "@/lib/server/workspaces";

/** What each module has to work with for this product (Home works out the next step from it). */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/workspaces/[id]/counts">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const row = await loadRow(session, (await ctx.params).id);
  if (isResponse(row)) return row;
  return Response.json({ counts: await workspaceCounts(session, row.id) });
}
