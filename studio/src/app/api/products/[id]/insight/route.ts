import type { NextRequest } from "next/server";
import type { ProductRow } from "@/lib/db";
import { backupOf, insightChanges, type ProductInsight } from "@/lib/product-insight";
import { isResponse, requireUser } from "@/lib/server/auth";
import { syncCompetitors } from "@/lib/server/competitors";
import { fetchAppStoreReviews, startInsight } from "@/lib/server/insight";
import { dbFailure } from "@/lib/server/errors";
import { getTranslator } from "@/lib/i18n/server";

const COLUMNS = "*";

/**
 * The AI product profile. `start` reads the product's links in the background (the edge function);
 * `preview` lists what Replace would change; `apply` replaces the product profile's typed fields with
 * the profile's, keeping the old values for `undo`; `reviews` fetches the App Store reviews again. It never writes the brand: the profile's brand
 * ideas are suggestions ("Use this", POST /api/products/[id]/brand { action: "use" }).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/products/[id]/insight">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { t } = await getTranslator();
  const { id } = await ctx.params;
  const { action } = await request.json().catch(() => ({}));
  const { data: product } = await session.supabase.from("products").select(COLUMNS).eq("id", id).maybeSingle<ProductRow>();
  if (!product) return Response.json({ error: t("Not found") }, { status: 404 });

  if (action === "start") {
    const result = await startInsight(session, id);
    return Response.json(result.data, { status: result.ok ? 200 : result.status });
  }

  // The App Store's customer reviews again, verbatim, into the profile (the review picker's "Fetch reviews").
  if (action === "reviews") {
    const result = await fetchAppStoreReviews(session, id);
    return Response.json(result.data, { status: result.ok ? 200 : result.status });
  }

  if (action === "preview" || action === "apply") {
    if (!product.insight) return Response.json({ error: t("There's no AI profile yet: read your links first.") }, { status: 400 });
    const patch = insightChanges(product, product.insight as ProductInsight);
    if (action === "preview") return Response.json({ changes: patch.changes });
    if (!patch.changes.length) return Response.json({ error: t("Your profile already matches the AI profile.") }, { status: 400 });
    const backup = backupOf(product, patch);
    // The profile's competitors join the product's one list (nothing is removed); the column follows it.
    const fields: Record<string, unknown> = { ...patch.product };
    if (patch.product.known_competitors && (await syncCompetitors(session, id, (product.insight as ProductInsight).competitors, "profile", { removeMissing: false })).ok) delete fields.known_competitors;
    const { data, error } = await session.supabase.from("products").update({
      ...fields,
      insight_backup: backup,
      insight_applied_at: new Date().toISOString(),
    }).eq("id", id).select(COLUMNS).single<ProductRow>();
    if (error) return dbFailure("insight apply", error, t("Couldn't apply the profile. Try again."), 500, {}, t);
    return Response.json({ product: data, changes: patch.changes });
  }

  if (action === "undo") {
    // Backups from before the brand moved to the Brand page may hold the old brand kit: it comes back too.
    const backup = product.insight_backup as { product?: Record<string, unknown>; brandKit?: unknown } | null;
    if (!backup?.product) return Response.json({ error: t("Nothing to undo.") }, { status: 400 });
    // The list goes back to the names it had: the profile's additions leave it (unless followed since).
    const fields: Record<string, unknown> = { ...backup.product };
    const before = backup.product.known_competitors;
    if (Array.isArray(before) && (await syncCompetitors(session, id, before.filter((n): n is string => typeof n === "string"), "product", { removeOnly: "profile" })).ok) delete fields.known_competitors;
    const { data, error } = await session.supabase.from("products").update({
      ...fields,
      ...(backup.brandKit !== undefined ? { brand_kit: backup.brandKit } : {}),
      insight_backup: null,
      insight_applied_at: null,
    }).eq("id", id).select(COLUMNS).single<ProductRow>();
    if (error) return dbFailure("insight undo", error, t("Couldn't undo it. Try again."), 500, {}, t);
    return Response.json({ product: data });
  }

  return Response.json({ error: t("Unknown action.") }, { status: 400 });
}
