import type { NextRequest } from "next/server";
import { RUN_SUMMARY_COLUMNS, toProject, type ProjectRow, type RunSummary } from "@/lib/db";
import { estimate } from "@/lib/server/analysis";
import { isResponse, requireUser } from "@/lib/server/auth";
import { PLATFORMS, type Candidate, type Platform } from "@/lib/types";
import { dbFailure } from "@/lib/server/errors";

/** A project and its run history (newest first). Live changes arrive over Realtime. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/projects/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const { data } = await session.supabase.from("projects").select("*").eq("id", id).maybeSingle<ProjectRow>();
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });
  const row = data;
  const { data: runs } = await session.supabase.from("runs").select(RUN_SUMMARY_COLUMNS).eq("project_id", id).order("started_at", { ascending: false }).returns<RunSummary[]>();
  return Response.json({ project: toProject(row), runs: runs ?? [], estimate: estimate(row) });
}

const cleanHandle = (value: unknown) => String(value ?? "").trim().replace(/^@/, "").slice(0, 200);

/** The user's choices: which accounts, their handles, channels, time frame, depth, keywords, niche. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/projects/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const { data: row } = await session.supabase.from("projects").select("*").eq("id", id).maybeSingle<ProjectRow>();
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  if (row.status === "analyzing" || row.status === "discovering") return Response.json({ error: "Wait for the current step to finish." }, { status: 409 });
  const body = await request.json().catch(() => ({}));
  let candidates = row.candidates;
  const settings = { ...row.settings };
  if (Array.isArray(body.candidates)) {
    type Update = { id: string; selected?: boolean; handles?: Partial<Record<Platform, string>> };
    const updates = new Map<string, Update>((body.candidates as Update[]).map((c) => [String(c.id), c]));
    candidates = candidates.map((c) => {
      const update = updates.get(c.id);
      if (!update) return c;
      const handles = { ...c.handles };
      for (const platform of PLATFORMS) {
        if (update.handles && platform in update.handles) {
          const value = cleanHandle(update.handles[platform]);
          if (value) handles[platform] = value; else delete handles[platform];
        }
      }
      return { ...c, selected: Boolean(update.selected ?? c.selected), handles };
    });
  }
  if (body.add?.name) {
    const handles: Partial<Record<Platform, string>> = {};
    for (const platform of PLATFORMS) if (body.add.handles?.[platform]) handles[platform] = cleanHandle(body.add.handles[platform]);
    const added: Candidate = {
      id: `you-${Date.now().toString(36)}`, name: String(body.add.name).slice(0, 80), handles, bio: "", followers: null, verified: false, website: null,
      kind: "direct_competitor", kindConfidence: 1, similarity: 4, source: "you", foundBy: ["you"], selected: true,
    };
    candidates = [added, ...candidates];
  }
  if (Array.isArray(body.platforms)) {
    const platforms = body.platforms.filter((p: string) => PLATFORMS.includes(p as Platform));
    if (platforms.length) settings.platforms = platforms;
  }
  if ([7, 14, 30, 60, 90, 180, 365].includes(body.sinceDays)) settings.sinceDays = body.sinceDays;
  if (Number.isFinite(body.limitPerAccount)) settings.limitPerAccount = Math.min(60, Math.max(5, body.limitPerAccount));
  if (typeof body.includeNiche === "boolean") settings.includeNiche = body.includeNiche;
  if (typeof body.readComments === "boolean") settings.readComments = body.readComments;
  if (typeof body.partners === "boolean") settings.partners = body.partners;
  if (typeof body.brandInstagram === "string") settings.brandInstagram = body.brandInstagram.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").split(/[/?]/)[0].slice(0, 60) || undefined;
  if (Array.isArray(body.keywords)) settings.keywords = body.keywords.map((k: unknown) => String(k).trim()).filter(Boolean).slice(0, 8);
  const { data: saved, error } = await session.supabase.from("projects").update({ candidates, settings }).eq("id", id).select().single<ProjectRow>();
  if (error || !saved) return dbFailure("project save", error, "Couldn't save. Try again.");
  return Response.json({ project: toProject(saved), estimate: estimate(saved) });
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/projects/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const { data: runs } = await session.supabase.from("runs").select("id").eq("project_id", id);
  // Thumbnails live under <user>/<run>/ in storage; remove them with the project.
  for (const run of runs ?? []) {
    const { data: files } = await session.supabase.storage.from("thumbs").list(`${session.user.id}/${run.id}`, { limit: 1000 });
    if (files?.length) await session.supabase.storage.from("thumbs").remove(files.map((f) => `${session.user.id}/${run.id}/${f.name}`));
  }
  await session.supabase.from("projects").delete().eq("id", id);
  return Response.json({ deleted: true });
}
