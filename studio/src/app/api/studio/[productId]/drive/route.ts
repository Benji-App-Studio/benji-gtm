import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { creativesBackend } from "@/lib/server/creatives-backend";
import { approvedForExport } from "@/lib/server/export";

/**
 * Copies approved creatives to the workspace's Google Drive folder (see the creatives function's drive
 * notes), filed like the zip: <awareness level or format>/<creative>/ with Launch-style readable names
 * (lib/export-paths.ts). The function creates the subfolders it needs.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/studio/[productId]/drive">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const creativeIds = (Array.isArray(body.creativeIds) ? body.creativeIds : []).filter((id: unknown): id is string => typeof id === "string").slice(0, 50);
  // Where each goes; without a plan (it couldn't be made) the function files them flat, as before.
  const paths = await approvedForExport(session, productId, creativeIds)
    .then((set) => Object.fromEntries(set.files.map((f) => [f.id, f.drive])))
    .catch(() => ({}));
  const result = await creativesBackend(session, "drive/export", { productId, creativeIds, paths });
  return Response.json(result.data, { status: result.ok ? 200 : result.status });
}
