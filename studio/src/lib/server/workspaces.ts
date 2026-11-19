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
async function countOf(supabase: SupabaseClient, table: string, productId: string, filter?: [string, string]): Promise<number | null> {
  let query = supabase.from(table).select("*", { head: true, count: "exact" }).eq("product_id", productId);
  if (filter) query = query.eq(filter[0], filter[1]);
  const { count, error } = await query;
  return error ? null : count ?? 0;
}

/** What each module has to work with for a product (Home's next step). Runs as the signed-in user. */
export async function workspaceCounts(session: Session, productId: string): Promise<WorkspaceCounts> {
  const db = session.supabase;
  const [watchlist, paidAds, formatCards, creatives, approvedCreatives, metaAds] = await Promise.all([
    countOf(db, "ad_watchlist", productId),
    countOf(db, "paid_ads", productId),
    countOf(db, "format_cards", productId),
    countOf(db, "creatives", productId),
    countOf(db, "creatives", productId, ["approval", "approved"]),
    countOf(db, "meta_ads", productId),
  ]);
  return { watchlist, paidAds, formatCards, creatives, approvedCreatives, metaAds };
}
