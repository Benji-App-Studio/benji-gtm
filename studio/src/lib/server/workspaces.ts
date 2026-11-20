import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session } from "@/lib/server/auth";
import { getWorkspace, getWorkspaceRow, WorkspaceNotFoundError, type Workspace, type WorkspaceRow } from "@/lib/workspace";
import type { WorkspaceCounts } from "@/lib/workspace-schema";

/** The workspace row, or the response to return instead (404 when it isn't the user's). */
export async function loadRow(session: Session, id: string): Promise<WorkspaceRow | Response> {
  try {
    return await getWorkspaceRow(id, session.supabase);
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}

/** The workspace, or the response to return instead (404 when it doesn't exist or isn't the user's). */
export async function loadWorkspace(productId: string, client?: SupabaseClient): Promise<Workspace | Response> {
  try {
    return await getWorkspace(productId, client);
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}

/** How many rows of `table` the product has; null when the table can't be read (its migration hasn't run). */
async function countOf(supabase: SupabaseClient, table: string, productId: string, filter?: [string, string], notNull?: string): Promise<number | null> {
  let query = supabase.from(table).select("*", { head: true, count: "exact" }).eq("product_id", productId);
  if (filter) query = query.eq(filter[0], filter[1]);
  if (notNull) query = query.not(notNull, "is", null);
  const { count, error } = await query;
  return error ? null : count ?? 0;
}

/** What each module has to work with for a product (Home's next step). Runs as the signed-in user. */
export async function workspaceCounts(session: Session, productId: string): Promise<WorkspaceCounts> {
  const db = session.supabase;
  const [watchlist, paidAds, formatCards, creatives, approvedCreatives, metaAds, launchedAds, resultRows] = await Promise.all([
    countOf(db, "ad_watchlist", productId),
    countOf(db, "paid_ads", productId),
    countOf(db, "format_cards", productId),
    countOf(db, "creatives", productId),
    countOf(db, "creatives", productId, ["approval", "approved"]),
    countOf(db, "meta_ads", productId),
    // The getting-started guide: a draft that reached Meta, and any measure source that synced.
    countOf(db, "launch_drafts", productId, undefined, "ad_id"),
    resultRowsOf(db, productId),
  ]);
  return { watchlist, paidAds, formatCards, creatives, approvedCreatives, metaAds, launchedAds, resultRows };
}

/**
 * Days of real results for the guide's last step: rows with data from RevenueCat, Superwall, Mixpanel or
 * AppStack, or spend on an ad launched from the dashboard. A synced source with no data counts nothing.
 * null when none of the tables can be read.
 */
async function resultRowsOf(db: SupabaseClient, productId: string): Promise<number | null> {
  const count = async (table: string, column: string): Promise<number | null> => {
    const { count: n, error } = await db.from(table).select("*", { head: true, count: "exact" }).eq("product_id", productId).gt(column, 0).limit(1);
    return error ? null : n ?? 0;
  };
  const { data: drafts } = await db.from("launch_drafts").select("ad_id").eq("product_id", productId).not("ad_id", "is", null).limit(500);
  const adIds = (drafts ?? []).map((d: { ad_id: string | null }) => d.ad_id).filter((id): id is string => Boolean(id));
  const spend = adIds.length
    ? await db.from("meta_daily").select("*", { head: true, count: "exact" }).eq("product_id", productId).in("ad_id", adIds).gt("spend", 0).then(({ count: n, error }) => (error ? null : n ?? 0))
    : 0;
  const parts = await Promise.all([count("revenuecat_daily", "value"), count("superwall_daily", "opens"), count("mixpanel_daily", "value"), count("appstack_daily", "installs"), Promise.resolve(spend)]);
  return parts.every((n) => n === null) ? null : parts.reduce<number>((sum, n) => sum + (n ?? 0), 0);
}
