import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";

/** The project's recent activity (searches and runs), oldest first; new lines arrive over Realtime. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/projects/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const { data } = await session.supabase.from("activity").select("id, run_id, level, message, created_at").eq("project_id", id).order("id", { ascending: false }).limit(150);
  return Response.json({ activity: (data ?? []).reverse() });
}
