import type { NextRequest } from "next/server";
import { DRAFT_COLUMNS } from "@/lib/launch/types";
import { isResponse, requireUser } from "@/lib/server/auth";
import { launch } from "@/lib/server/launch";
import { relay } from "@/lib/server/radar";

/** The workspace's drafts, newest first (the page polls this while uploads run). */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/launch/[productId]/drafts">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  const { data } = await session.supabase.from("launch_drafts").select(DRAFT_COLUMNS).eq("product_id", productId).order("created_at", { ascending: false }).limit(100);
  return Response.json(data ?? []);
}

/**
 * Previews ({ preview: true }) or queues paused drafts for approved creatives. The page sends the
 * creative ids and the edited copy; the launch function reads the creatives themselves (the user's,
 * this workspace's, approved and QA passed), so no file address ever comes from the browser.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/launch/[productId]/drafts">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const picks = Array.isArray(body.items) ? (body.items as { creativeId?: unknown; primaryText?: unknown; headline?: unknown; description?: unknown; cta?: unknown; aiDisclosure?: unknown }[]) : [];
  if (!picks.length) return Response.json({ error: "Pick at least one creative." }, { status: 400 });
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  const items = picks.map((pick) => ({
    creativeId: String(pick?.creativeId ?? ""), primaryText: text(pick?.primaryText), headline: text(pick?.headline), description: text(pick?.description), cta: text(pick?.cta),
    aiDisclosure: pick?.aiDisclosure === "OPT_IN" || pick?.aiDisclosure === "OPT_OUT" ? pick.aiDisclosure : undefined,
  }));
  return relay(await launch(session, body.preview === true ? "preview" : "drafts", { productId, items }));
}
