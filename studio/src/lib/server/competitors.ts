import "server-only";
// The product's one competitor list on the server (lib/competitors.ts has the rules). Reads and writes
// run as whoever's client is passed: the signed-in user (row-level security applies), or a worker's.
import type { SupabaseClient } from "@supabase/supabase-js";
import { competitorNames, mergeCompetitors, planCompetitorSync, type Competitor, type CompetitorRow, type CompetitorSource } from "@/lib/competitors";

type Db = { supabase: SupabaseClient };

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

/** The product's list rows (`ad_watchlist`, own Pages included), oldest first. */
export async function competitorRows({ supabase }: Db, productId: string): Promise<CompetitorRow[]> {
  const { data, error } = await supabase.from("ad_watchlist").select("*").eq("product_id", productId)
    .order("created_at", { ascending: true }).order("id", { ascending: true }).returns<CompetitorRow[]>();
  if (error) {
    if (MISSING_TABLE.has(error.code)) return [];
    throw new Error(error.message);
  }
  return data ?? [];
}

/**
 * The product's competitors: its list, one per name, own Pages left out. The product row's
 * `known_competitors` is read too: after the migration it mirrors the list (adds nothing); before it,
 * it's where typed names still live.
 */
export async function competitorsFor(session: Db, productId: string): Promise<Competitor[]> {
  const [rows, product] = await Promise.all([
    competitorRows(session, productId),
    session.supabase.from("products").select("known_competitors").eq("id", productId).maybeSingle<{ known_competitors: string[] | null }>(),
  ]);
  return mergeCompetitors(rows, product.data?.known_competitors ?? []);
}

/** The names and handles a creative must not mention (QA, Formats, the Playground). */
export async function competitorNamesFor(session: Db, productId: string): Promise<string[]> {
  return competitorNames(await competitorsFor(session, productId));
}

export type SyncResult = { ok: true; added: number; removed: number } | { ok: false; error: string };

/**
 * Brings the list in line with `names` (see planCompetitorSync): new names become paused rows from
 * `source`, searched by their name once someone follows them; bare rows left out are removed (unless
 * `removeMissing: false`). The product row's `known_competitors` follows by trigger. `ok: false` when the
 * list can't be written (e.g. before the migration): the caller then keeps writing the column itself.
 */
export async function syncCompetitors(session: Db, productId: string, names: string[], source: CompetitorSource, o: { removeMissing?: boolean; removeOnly?: CompetitorSource } = {}): Promise<SyncResult> {
  let rows: CompetitorRow[];
  try { rows = await competitorRows(session, productId); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const plan = planCompetitorSync(rows, names, o);
  if (plan.add.length) {
    const { error } = await session.supabase.from("ad_watchlist").insert(plan.add.map((name) => ({
      product_id: productId, name, network: "meta", search_terms: name.slice(0, 100), enabled: false, source,
    })));
    if (error) return { ok: false, error: error.message };
  }
  if (plan.remove.length) {
    const { error } = await session.supabase.from("ad_watchlist").delete().in("id", plan.remove);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true, added: plan.add.length, removed: plan.remove.length };
}
