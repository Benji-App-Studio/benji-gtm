import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { radar } from "@/lib/server/radar";

/** Starts a new run: collects and decodes posts (spends Apify credit; the page confirms first). Past runs stay in history. */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/projects/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const { data: row } = await session.supabase.from("projects").select("id, status, demo").eq("id", id).maybeSingle();
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  if (row.demo) return Response.json({ error: "The demo project can't collect new posts." }, { status: 400 });
  if (row.status === "analyzing" || row.status === "discovering") return Response.json({ error: "Wait for the current step to finish, or stop it first." }, { status: 409 });
  const result = await radar<{ run?: { id: string } }>(session, "analyze", { projectId: id });
  if (!result.ok) return Response.json(result.data, { status: result.status });
  return Response.json({ started: true, runId: result.data.run?.id });
}
