import type { NextRequest } from "next/server";
import type { ProjectRow } from "@/lib/db";
import { isResponse, requireUser } from "@/lib/server/auth";
import { radar, relay } from "@/lib/server/radar";

/** Runs competitor discovery again (e.g. after changing keywords). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/projects/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const { data: row } = await session.supabase.from("projects").select("*").eq("id", id).maybeSingle<ProjectRow>();
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  if (row.demo || row.type !== "competitors") return Response.json({ error: "Only competitor projects search for competitors." }, { status: 400 });
  if (row.status === "analyzing" || row.status === "discovering") return Response.json({ error: "Wait for the current step to finish, or stop it first." }, { status: 409 });
  const body = await request.json().catch(() => ({}));
  if (Array.isArray(body.keywords)) {
    const settings = { ...row.settings, keywords: body.keywords.map((k: unknown) => String(k).trim()).filter(Boolean).slice(0, 8) };
    await session.supabase.from("projects").update({ settings }).eq("id", id);
  }
  return relay(await radar(session, "discover", { projectId: id }));
}
