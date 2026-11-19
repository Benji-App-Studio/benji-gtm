import type { NextRequest } from "next/server";
import type { ProjectRow } from "@/lib/db";
import { ASSET_COLUMNS, type ProductAsset } from "@/lib/product-assets";
import { competitorSuggestions } from "@/lib/competitors";
import type { ProductInsight } from "@/lib/product-insight";
import { withStoredMedia, type MediaStatus } from "@/lib/ad-media";
import type { CatalogItem } from "@/lib/creative-types";
import { PAID_AD_COLUMNS, type LocalRunRow, type PaidAdRow, type PullRow, type ResearchData, type ResearchHealth, type Suggestion, type WatchRow } from "@/lib/research";
import { storedMedia } from "@/lib/server/ad-media";
import { isResponse, requireUser, type Session } from "@/lib/server/auth";
import { refuseWhenFull } from "@/lib/server/storage";
import { brandFor } from "@/lib/server/brand";
import { readNewAds, research } from "@/lib/server/research";
import { loadWorkspace } from "@/lib/server/workspaces";
import { dbFailure } from "@/lib/server/errors";

/** Deleting a workspace's stored media can take a minute. */
export const maxDuration = 150;

/**
 * The workspace's paid-ads research: ads, the watchlist, recent pulls (and the local scraper's runs of the
 * last day, for the safety card), competitors to suggest for the list (lib/competitors.ts), which sources are connected, and the merged brand
 * (lib/server/brand.ts) and presenter avatars the Recreate sheet uses. Each ad's media links are swapped for their stored copies
 * (`paid_ad_media`) where saved, the originals kept as `source_url`; `mediaStatus` counts the saved files.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/research/[productId]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  // `?adsFrom=N`: just the next slice of ads (the page asks for them after the first answer). The workspace check
  // runs alongside the reads (RLS keeps them to the user's rows) and nothing goes out before it passes.
  const adsFrom = Number(request.nextUrl.searchParams.get("adsFrom"));
  if (Number.isInteger(adsFrom) && adsFrom > 0) {
    const [workspace, slice, stored] = await Promise.all([loadWorkspace(productId), adsSlice(session, productId, adsFrom), storedMedia(session, productId)]);
    if (isResponse(workspace)) return workspace;
    if (slice.error) return dbFailure("research ads slice", slice.error, "Couldn't load more ads. Try again.");
    return Response.json({ ads: slice.rows.map((ad) => lean(withStoredMedia(ad, stored))), adsNext: slice.next } satisfies Pick<ResearchData, "ads" | "adsNext">);
  }

  const workspace = await loadWorkspace(productId);
  if (isResponse(workspace)) return workspace;
  const { supabase } = session;
  const dayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const [ads, adsCount, watchlist, pulls, localRuns, imports, avatars, projects, product, health, stored, mediaStatus, assets, merged] = await Promise.all([
    adsSlice(session, productId, 0),
    // How many there are, so the page can ask for every other slice at once instead of one after another.
    supabase.from("paid_ads").select("id", { count: "exact", head: true }).eq("product_id", productId).eq("hidden", false),
    supabase.from("ad_watchlist").select("*").eq("product_id", productId).order("created_at").returns<WatchRow[]>(),
    supabase.from("ad_pulls").select("id, source, status, ads, usd, error, started_at, finished_at").eq("product_id", productId).order("started_at", { ascending: false }).limit(20).returns<PullRow[]>(),
    supabase.from("ad_pulls").select("id, status, started_at, input").eq("product_id", productId).eq("source", "meta_local").gte("started_at", dayAgo).order("started_at", { ascending: false }).limit(60).returns<LocalRunRow[]>(),
    // Every finished scraper import's Page and time: the competitor list's "Updated" per Page.
    supabase.from("ad_pulls").select("started_at, page_id:input->>page_id, scraped_at:input->>scraped_at").eq("product_id", productId).eq("source", "meta_local").eq("status", "done")
      .order("started_at", { ascending: false }).limit(1000).returns<{ started_at: string; page_id: string | null; scraped_at: string | null }[]>(),
    supabase.from("creative_catalog").select("items").eq("kind", "avatars").order("synced_at", { ascending: false }).limit(1).maybeSingle<{ items: CatalogItem[] }>(),
    supabase.from("projects").select("candidates").eq("product_id", productId).eq("type", "competitors").returns<Pick<ProjectRow, "candidates">[]>(),
    supabase.from("products").select("insight").eq("id", productId).maybeSingle<{ insight: ProductInsight | null }>(),
    // Status and media counts are extras: a slow (cold) function doesn't hold the ads up.
    research<ResearchHealth>(session, "health", undefined, 4000),
    storedMedia(session, productId),
    research<MediaStatus>(session, "media-status", { productId }, 4000),
    supabase.from("product_assets").select(ASSET_COLUMNS).eq("product_id", productId).eq("hidden", false).order("created_at", { ascending: false }).limit(120).returns<ProductAsset[]>(),
    // The merged brand (lib/server/brand.ts): Recreate prefills from it and checks against every forbidden claim.
    brandFor(session, productId),
  ]);
  if (ads.error && /paid_ads|relation/.test(ads.error.message)) {
    return Response.json({ error: "Paid-ads research isn't set up in the database yet (migration 20261002300000_paid_ads)." }, { status: 503 });
  }

  // The watchlist is the product's one competitor list; suggestions are names not on it yet (analysis
  // picks, the AI profile's competitors).
  const suggestions: Suggestion[] = competitorSuggestions(watchlist.data ?? [], (projects.data ?? []).flatMap((p) => p.candidates ?? []), product.data?.insight?.competitors ?? []);

  const lastImports: Record<string, string> = {};
  for (const run of imports.data ?? []) {
    const at = run.scraped_at ?? run.started_at;
    if (run.page_id && (!lastImports[run.page_id] || Date.parse(at) > Date.parse(lastImports[run.page_id]))) lastImports[run.page_id] = at;
  }

  const kit = merged.kit;
  const body: ResearchData = {
    workspace: { id: workspace.id, name: workspace.name },
    ads: ads.rows.map((ad) => lean(withStoredMedia(ad, stored))), adsNext: ads.next, adsTotal: adsCount.count ?? null, watchlist: watchlist.data ?? [], pulls: pulls.data ?? [], suggestions,
    localRuns: localRuns.data ?? [], lastImports,
    brand: {
      appName: kit.appName, tagline: kit.tagline ?? null, colors: kit.colors, iconUrl: kit.iconUrl ?? null, screenshots: kit.screenshotUrls.length,
      tone: kit.tone ?? null, forbiddenClaims: merged.forbiddenClaims, appStoreUrl: kit.appStoreUrl ?? null,
      profile: merged.profile,
      system: merged.system,
    },
    avatars: (avatars.data?.items ?? []).slice(0, 200).map((a) => ({ id: a.id, name: a.name, type: a.type ?? null, gender: a.gender ?? null })),
    health: health.ok ? health.data : null,
    mediaStatus: mediaStatus.ok ? mediaStatus.data : null,
    assets: assets.data ?? [],
  };
  return Response.json(body);
}

/**
 * Research actions, passed to the `research` edge function:
 * `plan` (what a pull would do and cost), `pull` (`spend: true` only after the user confirmed the
 * cost), `poll` (finish scrapes), `import` (a Meta Ads MCP answer), `media-status` (creative files saved
 * to storage), `media-clear` (delete them, one advertiser's with `pageId`) and `decode-new` (read the
 * new ads in the background; a pull, an import or a finished scrape asks for it too).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/research/[productId]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  const input = await request.json().catch(() => ({}));
  const action = String(input?.action ?? "");
  if (action === "decode-new") {
    const result = await readNewAds(session, productId);
    return Response.json(result.data, { status: result.ok ? 200 : result.status });
  }
  if (!["plan", "pull", "poll", "import", "media-status", "media-clear"].includes(action)) return Response.json({ error: "Unknown action." }, { status: 400 });
  // `watchIds`: collect (or plan) for these competitors only; every followed one without it.
  const watchIds = Array.isArray(input.watchIds) ? input.watchIds.filter((id: unknown) => typeof id === "string").slice(0, 200) : undefined;
  // Collecting saves ads and their media: refused while storage is full (nothing is paid for at Apify).
  if (action === "pull") {
    const full = await refuseWhenFull(session, "collect");
    if (full) return full;
  }
  const payload = action === "pull" ? { productId, spend: input.spend === true, watchIds }
    : action === "plan" ? { productId, watchIds }
    : action === "import" ? { productId, payload: input.payload, countries: input.countries, watchId: input.watchId }
    : action === "media-clear" ? { productId, pageId: typeof input.pageId === "string" ? input.pageId : undefined }
    : { productId };
  const result = await research(session, action, payload, action === "media-clear" ? 140_000 : undefined);
  // New ads landed (a pull's free sources, an import, or the last scrape finishing): read them.
  const landed = action === "pull" || action === "import" || (action === "poll" && (result.data as { running?: number }).running === 0);
  if (result.ok && landed) await readNewAds(session, productId);
  return Response.json(result.data, { status: result.ok ? 200 : result.status });
}

/**
 * Ads per answer. A Vercel function's response is capped at 4.5 MB and an ad is about 3.5 KB here, so
 * the page gets its first 600 ads with everything else, then asks for the rest 600 at a time
 * (`adsFrom`, several at once using `adsTotal`), showing them as they arrive. 600 also stays under PostgREST's 1,000-row cap.
 */
const ADS_SLICE = 600;

/**
 * One slice of the workspace's ads in a stable order (newest start date first, then id, so no ad falls between
 * two slices and the newest arrive first); `next` is where the following slice starts, or null after the last.
 */
async function adsSlice(session: Session, productId: string, from: number): Promise<{ rows: PaidAdRow[]; next: number | null; error: { message: string } | null }> {
  // One extra row says whether another slice follows.
  // Hidden ads (the ad's DELETE) stay out of the list.
  const query = (columns: string) => session.supabase.from("paid_ads").select(columns).eq("product_id", productId).eq("hidden", false)
    .order("started_at", { ascending: false, nullsFirst: false }).order("id", { ascending: false })
    .range(from, from + ADS_SLICE).returns<PaidAdRow[]>();
  let { data, error } = await query(PAID_AD_COLUMNS);
  // A database from before the reliability update has no decode_error yet: list the ads without it (the update banner asks for the update).
  if (error && /decode_error/.test(error.message ?? "")) ({ data, error } = await query(PAID_AD_COLUMNS.replace(", decode_error", "")));
  if (error) return { rows: [], next: null, error };
  const rows = data ?? [];
  return rows.length > ADS_SLICE ? { rows: rows.slice(0, ADS_SLICE), next: from + ADS_SLICE, error: null } : { rows, next: null, error: null };
}

/** True for a signed Meta CDN link (fbcdn, cdninstagram) whose `oe` expiry (hex Unix seconds) has passed. */
function expiredLink(url: unknown, now = Date.now() / 1000): boolean {
  if (typeof url !== "string") return false;
  const oe = /[?&]oe=([0-9a-f]{6,10})(?:&|$)/i.exec(url)?.[1];
  return Boolean(oe) && parseInt(oe as string, 16) < now;
}

/**
 * The ad without the original Ad Library links of files we have a stored copy of: those signed links
 * are long (about a third of the response) and expire anyway; the stored copy is what the page shows.
 * For ~1,100 ads with their files stored the answer is still about 4 MB before compression: mostly the
 * stored links, the copy and the Ad Library details.
 */
function lean<T extends PaidAdRow>(ad: T): T {
  const drop = <M extends Record<string, unknown>>(m: M): M => {
    const out: Record<string, unknown> = { ...m };
    if (out.source_url && out.url !== out.source_url) delete out.source_url;
    if (out.thumbnail_source_url) delete out.thumbnail_source_url;
    if (out.thumb_source_url) delete out.thumb_source_url;
    return out as M;
  };
  const out = { ...ad } as T & { thumb_source_url?: string | null };
  // The decode's per-format probabilities are a tenth of the list and nothing on the page reads them.
  if (ad.decoded && "formatProbabilities" in ad.decoded) {
    const { formatProbabilities: _unused, ...decoded } = ad.decoded as typeof ad.decoded & { formatProbabilities?: unknown };
    void _unused; out.decoded = decoded as T["decoded"];
  }
  if (out.thumb_source_url) delete out.thumb_source_url;
  // The page reads the scraper's measured list when there is one (mediaOf, sourceFromAd), so the ad's
  // own list of the same files would only double the links.
  out.media = ad.creative?.media?.length ? [] : (ad.media ?? []).map((m) => drop(m as unknown as Record<string, unknown>)) as unknown as T["media"];
  if (ad.creative?.media) out.creative = { ...ad.creative, media: ad.creative.media.map((m) => drop(m as unknown as Record<string, unknown>)) as unknown as NonNullable<T["creative"]>["media"] };
  // The account's picture is a signed link of its own (a tenth of the response): gone once it expired.
  const posted = ad.library?.postedAs;
  if (posted?.picture && expiredLink(posted.picture)) out.library = { ...ad.library, postedAs: { ...posted, picture: null } };
  return out;
}
