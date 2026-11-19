import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { loadRow } from "@/lib/server/workspaces";
import { toWorkspaceView, WORKSPACE_BUCKET, WORKSPACE_COLUMNS, type WorkspaceRow } from "@/lib/workspace";
import { cleanConnections, readConnections } from "@/lib/workspace-schema";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/workspaces/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const row = await loadRow(session, (await ctx.params).id);
  return isResponse(row) ? row : Response.json(toWorkspaceView(row));
}

/**
 * Saves a workspace's connections: `connections` replaces each section it names (meta, revenuecat, …).
 * The brand (kit and system) is saved by the Brand page only: PUT /api/products/[id]/brand.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/workspaces/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const row = await loadRow(session, (await ctx.params).id);
  if (isResponse(row)) return row;
  const body = await request.json().catch(() => ({}));
  if (body.brandKit !== undefined) return Response.json({ error: "The brand is edited on the Brand page now (PUT /api/products/<id>/brand)." }, { status: 400 });

  const connections = cleanConnections(body.connections);
  if (typeof connections === "string") return Response.json({ error: connections }, { status: 400 });
  const prefix = connections.storage?.supabasePrefix;
  if (prefix && !prefix.startsWith(`${WORKSPACE_BUCKET}/${session.user.id}/`)) {
    return Response.json({ error: `The storage folder has to be inside ${WORKSPACE_BUCKET}/${session.user.id}/, where you can write.` }, { status: 400 });
  }

  const nextConnections: Record<string, unknown> = { ...readConnections(row.connections), ...connections };
  for (const [key, section] of Object.entries(nextConnections)) if (!Object.keys(section as object).length) delete nextConnections[key];
  const { data, error } = await session.supabase.from("products").update({ connections: nextConnections })
    .eq("id", row.id).select(WORKSPACE_COLUMNS).single<WorkspaceRow>();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json(toWorkspaceView(data));
}
