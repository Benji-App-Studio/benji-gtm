import type { NextRequest } from "next/server";
import type { RunRow } from "@/lib/db";
import { isResponse, requireUser } from "@/lib/server/auth";
import { radar } from "@/lib/server/radar";

/** One run with its full report (every run keeps its own, so history never changes). */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/runs/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const { data: run } = await session.supabase.from("runs").select("*").eq("id", id).maybeSingle<RunRow>();
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  const { data: saved } = run.status === "done" ? await session.supabase.from("run_reports").select("report").eq("run_id", id).maybeSingle() : { data: null };
  return Response.json({ ...run, report: saved?.report ?? null }, { headers: { "Cache-Control": "no-store" } });
}

/** Removes a run from history, with its thumbnails. The radar function deletes the row (users only read `runs`). */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/runs/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const { data: run } = await session.supabase.from("runs").select("id, status").eq("id", id).maybeSingle();
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  if (run.status === "running") return Response.json({ error: "This run is still going. Stop it first." }, { status: 409 });
  const deleted = await radar(session, "delete-run", { runId: id });
  if (!deleted.ok) return Response.json({ error: deleted.data.error ?? "Couldn't delete the run." }, { status: deleted.status });
  const folder = `${session.user.id}/${id}`;
  const { data: files } = await session.supabase.storage.from("thumbs").list(folder, { limit: 1000 });
  if (files?.length) await session.supabase.storage.from("thumbs").remove(files.map((f) => `${folder}/${f.name}`));
  return Response.json({ deleted: true });
}
