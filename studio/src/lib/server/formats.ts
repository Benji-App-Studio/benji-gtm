import "server-only";
// The format library on the server: a workspace's reports (and paid ads) → format cards, stored in
// format_cards, plus the app context the recreate prompts are written from. Everything runs as the
// signed-in user (RLS applies).
import { urlKey } from "@/lib/ad-media";
import { profileOf } from "@/lib/product-insight";
import type { ProductRow, ProjectRow } from "@/lib/db";
import { buildFormatCards, paidAdsFromSeeds } from "@/lib/formats/cards";
import type { AppContext, BrandKit, FormatCard, FormatCardRow, PaidAd, PaidAdSeedRow } from "@/lib/formats/types";
import type { Report } from "@/lib/types";
import { storedMediaFor } from "./ad-media";
import { competitorNamesFor } from "./competitors";
import type { Session } from "./auth";
import { brandFor } from "./brand";

/** How many of a workspace's latest finished runs feed the library. */
const RUNS = 12;

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

/** The product a route means: its id, or "primary" for the user's primary product. */
export async function resolveProduct(session: Session, productId: string): Promise<ProductRow | null> {
  const query = session.supabase.from("products").select("*");
  const { data } = productId === "primary"
    ? await query.order("is_primary", { ascending: false }).order("created_at").limit(1).maybeSingle<ProductRow>()
    : await query.eq("id", productId).maybeSingle<ProductRow>();
  return data ?? null;
}

/** The workspace's projects: linked to it, plus unlinked ones (the demo, older projects) for the primary product. */
async function projectsOf(session: Session, product: ProductRow) {
  const filter = product.is_primary ? `product_id.eq.${product.id},product_id.is.null` : `product_id.eq.${product.id}`;
  const { data } = await session.supabase.from("projects").select("id, name, candidates, product_id").or(filter);
  return (data ?? []) as Pick<ProjectRow, "id" | "name" | "candidates" | "product_id">[];
}

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && Boolean(v.trim())) : []);
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** The workspace's brand kit, read defensively (the workspaces package owns its shape). */
function brandKitOf(raw: unknown, product: ProductRow): BrandKit {
  const kit = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    appName: text(kit.appName) ?? product.name,
    tagline: text(kit.tagline), iconUrl: text(kit.iconUrl), tone: text(kit.tone), appStoreUrl: text(kit.appStoreUrl),
    colors: strings(kit.colors), screenshotUrls: strings(kit.screenshotUrls), forbiddenClaims: strings(kit.forbiddenClaims),
  };
}

export async function appContext(session: Session, product: ProductRow): Promise<AppContext> {
  // The merged brand (lib/server/brand.ts): colours, tone and every forbidden claim as the Brand page has
  // them; competitors from the product's one list (lib/server/competitors.ts).
  const [brand, competitors] = await Promise.all([brandFor(session, product.id).catch(() => null), competitorNamesFor(session, product.id)]);
  return {
    productId: product.id,
    name: product.name,
    brandKit: brandKitOf(brand?.kit, product),
    description: product.description,
    audience: product.audience,
    keywords: product.keywords ?? [],
    competitorNames: competitors,
    profile: profileOf(product.insight),
  };
}

async function reportsOf(session: Session, product: ProductRow) {
  const projects = await projectsOf(session, product);
  if (!projects.length) return [];
  const { data: runs } = await session.supabase.from("runs").select("id").in("project_id", projects.map((p) => p.id)).eq("status", "done")
    .order("started_at", { ascending: false }).limit(RUNS);
  if (!runs?.length) return [];
  const { data } = await session.supabase.from("run_reports").select("run_id, report").in("run_id", runs.map((r) => r.id));
  return ((data ?? []) as { run_id: string; report: Report }[]).map((r) => ({ runId: r.run_id, report: r.report }));
}

/** Columns of paid_ads (the research function's table, migration 20261002300000) the library reads. */
const SEED_COLUMNS = "id, network, ad_id, page_name, competitor, body, headline, cta, thumb, snapshot_url, media_type, started_at, stopped_at, last_seen_at, variants, library_seed";

/**
 * Paid ads someone sent to the library from Research → Ads (`sent_to_library_at` set). Before the
 * research migration is applied there are none.
 */
async function paidAdsOf(session: Session, product: ProductRow): Promise<PaidAd[]> {
  const { data, error } = await session.supabase.from("paid_ads").select(SEED_COLUMNS).eq("product_id", product.id).not("sent_to_library_at", "is", null).limit(300);
  if (error) {
    if (MISSING_TABLE.has(error.code)) return [];
    throw new Error(error.message);
  }
  // Thumbs from the Ad Library expire: the stored copy when there is one.
  const rows = (data ?? []) as PaidAdSeedRow[];
  const stored = await storedMediaFor(session, product.id, rows.flatMap((r) => [r.thumb, r.library_seed?.thumb]));
  const copy = (url: string | null | undefined) => {
    const key = urlKey(url);
    return (key && stored.get(key)) || url || null;
  };
  return paidAdsFromSeeds(rows.map((r) => ({ ...r, thumb: copy(r.thumb), library_seed: r.library_seed && { ...r.library_seed, thumb: copy(r.library_seed.thumb) } })));
}

const toRow = (card: FormatCard, productId: string, userId: string) => ({
  user_id: userId, product_id: productId, key: card.key, source: card.source, medium: card.medium, platform: card.platform,
  platforms: card.platforms, format_type: card.formatType, format_name: card.formatName, family: card.family, hook_type: card.hookType,
  structure: card.structure, examples_count: card.examples.length, best_score: card.evidence.bestScore, rank: card.rank, card,
});

type StoredRow = { id: string; product_id: string; card: FormatCard; updated_at: string };
const fromRow = (row: StoredRow): FormatCardRow => ({ ...row.card, id: row.id, productId: row.product_id, persisted: true, updatedAt: row.updated_at });
const unsaved = (card: FormatCard, productId: string): FormatCardRow => ({ ...card, id: `unsaved:${card.key}`, productId, persisted: false, updatedAt: null });

/** Cards built fresh from the workspace's reports and paid ads (not stored). */
export async function computeCards(session: Session, product: ProductRow) {
  const [reports, paidAds] = await Promise.all([reportsOf(session, product), paidAdsOf(session, product)]);
  return { cards: buildFormatCards({ reports, paidAds }), runs: reports.length };
}

/**
 * The workspace's cards. Stored cards when the table exists (building them the first time); when the
 * migration isn't applied yet, cards computed on the fly so the library still works (unsaved, no ids
 * for Measure or Launch).
 */
export async function listCards(session: Session, product: ProductRow, o: { rebuild?: boolean } = {}): Promise<{ cards: FormatCardRow[]; stored: boolean; runs: number | null }> {
  const read = () => session.supabase.from("format_cards").select("id, product_id, card, updated_at").eq("product_id", product.id).eq("archived", false).order("rank", { ascending: false });
  const first = await read();
  if (first.error && MISSING_TABLE.has(first.error.code)) {
    const { cards, runs } = await computeCards(session, product);
    return { cards: cards.map((c) => unsaved(c, product.id)), stored: false, runs };
  }
  if (first.error) throw new Error(first.error.message);
  if (first.data.length && !o.rebuild) return { cards: (first.data as StoredRow[]).map(fromRow), stored: true, runs: null };

  const { cards, runs } = await computeCards(session, product);
  if (cards.length) {
    const { error } = await session.supabase.from("format_cards").upsert(cards.map((c) => toRow(c, product.id, session.user.id)), { onConflict: "product_id,key" });
    if (error) throw new Error(error.message);
  }
  // Paid-ad cards the rebuild no longer makes (e.g. the old card that folded several sent ads together).
  const keys = new Set(cards.map((c) => c.key));
  const stale = ((first.data ?? []) as StoredRow[]).filter((r) => r.card.source === "paid" && !keys.has(r.card.key)).map((r) => r.id);
  if (stale.length) await session.supabase.from("format_cards").update({ archived: true }).in("id", stale);
  const saved = await read();
  if (saved.error) throw new Error(saved.error.message);
  return { cards: (saved.data as StoredRow[]).map(fromRow), stored: true, runs };
}
