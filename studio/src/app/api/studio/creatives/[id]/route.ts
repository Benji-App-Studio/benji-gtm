import type { NextRequest } from "next/server";
import { approvalProblem } from "@/lib/creative-review";
import { isResponse, requireUser } from "@/lib/server/auth";
import { dbFailure } from "@/lib/server/errors";

interface Row { id: string; job_id: string | null; qa_status: string; qa: { needsHuman?: string[] } | null; kind: string; thumbnail_url: string | null; copy: Record<string, unknown> | null }

/**
 * A person's review of a creative: approve or reject with a note, edit notes and the ad copy Launch
 * uses (title, headline, primary text, description, CTA). Approving needs a passing QA, or a warning plus a note saying why it's fine, and a poster
 * frame for videos (the database enforces all three); a note for anything QA left to a person; and,
 * for composed ads and placed logos, the text set and the logo in place (lib/creative-review.ts).
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/studio/creatives/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const { data: creative } = await session.supabase.from("creatives").select("id, job_id, qa_status, qa, kind, thumbnail_url, copy").eq("id", id).maybeSingle<Row>();
  if (!creative) return Response.json({ error: "This creative doesn't exist." }, { status: 404 });
  const update: Record<string, unknown> = {};
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : undefined;
  if (body.approval !== undefined) {
    if (!["approved", "rejected", "pending"].includes(body.approval)) return Response.json({ error: "Approve, reject or reset." }, { status: 400 });
    if (body.approval === "approved") {
      const { data: job } = creative.job_id
        ? await session.supabase.from("creative_jobs").select("params").eq("id", creative.job_id).maybeSingle<{ params: Record<string, unknown> }>()
        : { data: null };
      const problem = approvalProblem(creative, job?.params, note);
      if (problem) return Response.json({ error: problem.error }, { status: problem.status });
    }
    if (body.approval === "rejected" && !note) return Response.json({ error: "Add a note saying why, so the next batch can avoid it." }, { status: 400 });
    update.approval = body.approval;
    update.approval_note = note ?? null;
  }
  if (typeof body.notes === "string") update.notes = body.notes.slice(0, 4000);
  // The ad copy Launch uses (picking a copy variant sets headline, primary text and description together).
  const limits = { title: 200, headline: 255, primary_text: 2200, description: 1000, cta: 40, hook_type: 60, format_slug: 120 } as const;
  for (const [key, max] of Object.entries(limits)) {
    if (typeof body[key] === "string") update[key] = body[key].trim().slice(0, max) || null;
  }
  if (!Object.keys(update).length) return Response.json({ error: "Nothing to change." }, { status: 400 });
  const { data, error } = await session.supabase.from("creatives").update(update).eq("id", id).select("id, approval, approval_note, reviewed_at, notes, title, headline, primary_text, description, cta, qa_status").single();
  if (error) return dbFailure("creative update", error, "Couldn't save the change. Try again.", 400);
  return Response.json(data);
}
