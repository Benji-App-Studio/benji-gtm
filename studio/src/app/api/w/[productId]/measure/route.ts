import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { loadMeasure } from "@/lib/server/measure";
import { WorkspaceNotFoundError } from "@/lib/workspace";
import { caughtFailure, dbFailure } from "@/lib/server/errors";

const UUID = /^[0-9a-f-]{36}$/;
const MISSING_TABLES = /does not exist|schema cache|relation/i;

/** A workspace's Measure numbers for the last ?days= days (7, 14, 28 or 90) and the period before. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/w/[productId]/measure">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  if (!UUID.test(productId)) return Response.json({ error: "Which workspace?" }, { status: 400 });
  try {
    return Response.json(await loadMeasure(session, productId, Number(request.nextUrl.searchParams.get("days")) || 28));
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    const message = error instanceof Error ? error.message : String(error);
    if (MISSING_TABLES.test(message)) return Response.json({ error: "Measure's tables aren't in the database yet. Open /setup and press Apply the update." }, { status: 503 });
    return caughtFailure("measure load", error, "Couldn't load Measure. Try again.");
  }
}

/**
 * Changes the team makes on the page: the source of truth for CAC, the LTV basis, a campaign's role
 * (testing or scaling) or the format an ad's creative belongs to.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/w/[productId]/measure">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  if (!UUID.test(productId)) return Response.json({ error: "Which workspace?" }, { status: 400 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const db = session.supabase;

  if (body.settings && typeof body.settings === "object") {
    const s = body.settings as Record<string, unknown>;
    const row: Record<string, unknown> = { product_id: productId, user_id: session.user.id };
    if ("cac_source" in s) {
      if (!["auto", "meta", "appstack", "revenuecat"].includes(String(s.cac_source))) return Response.json({ error: "Pick AppStack, Meta or RevenueCat." }, { status: 400 });
      row.cac_source = s.cac_source;
    }
    if ("ltv_basis" in s) {
      if (!["first_purchase", "manual"].includes(String(s.ltv_basis))) return Response.json({ error: "Pick how LTV is worked out." }, { status: 400 });
      row.ltv_basis = s.ltv_basis;
    }
    if ("ltv_manual" in s) {
      const value = s.ltv_manual == null || s.ltv_manual === "" ? null : Number(s.ltv_manual);
      if (value != null && !(value >= 0 && value < 1e8)) return Response.json({ error: "LTV must be a positive amount." }, { status: 400 });
      row.ltv_manual = value;
    }
    const { error } = await db.from("measure_settings").upsert(row, { onConflict: "product_id" });
    if (error) return dbFailure("measure settings", error, "Couldn't save the setting. Try again.");
  }

  if (body.campaign && typeof body.campaign === "object") {
    const c = body.campaign as { id?: unknown; role?: unknown };
    const role = c.role === "testing" || c.role === "scaling" ? c.role : null;
    const { error } = await db.from("meta_campaigns").update({ role }).eq("product_id", productId).eq("campaign_id", String(c.id ?? ""));
    if (error) return dbFailure("measure campaign role", error, "Couldn't save the campaign's role. Try again.");
  }

  if (body.ad && typeof body.ad === "object") {
    const a = body.ad as { id?: unknown; formatId?: unknown };
    const formatId = typeof a.formatId === "string" && a.formatId.trim() ? a.formatId.trim().slice(0, 80) : null;
    const { error } = await db.from("meta_ads").update({ format_id: formatId }).eq("product_id", productId).eq("ad_id", String(a.id ?? ""));
    if (error) return dbFailure("measure ad format", error, "Couldn't save the ad's format. Try again.");
  }

  return Response.json({ saved: true });
}
