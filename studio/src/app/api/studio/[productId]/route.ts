import type { NextRequest } from "next/server";
import { CREATIVE_COLUMNS, JOB_COLUMNS, type BatchRow, type Catalog, type CatalogItem, type CreativeJobRow, type CreativeRow, type StudioOverview } from "@/lib/creative-types";
import { isResponse, requireUser } from "@/lib/server/auth";
import { batchSourceIds, STUDIO_HIDDEN_CREATIVE_SOURCES, STUDIO_HIDDEN_JOB_SOURCES } from "@/lib/studio-sources";
import { creativesBackend } from "@/lib/server/creatives-backend";
import { ASSET_COLUMNS, CUTOUT_MODEL, type ProductAsset } from "@/lib/product-assets";
import { brandFor } from "@/lib/server/brand";
import { loadWorkspace } from "@/lib/server/workspaces";
import { readImageProvider } from "@/lib/server/image-provider";
import { readOpenAiImagePlan } from "@/lib/image-provider";

/**
 * Batches other features own (lib/studio-sources.ts): the Playground's jobs and template remakes stay out of
 * the Studio's job list; template remakes stay out of its gallery too, while Playground results join it for
 * review. Studio batches have no source.
 */
const JOB_HIDDEN = [...STUDIO_HIDDEN_JOB_SOURCES];
const CREATIVE_HIDDEN = [...STUDIO_HIDDEN_CREATIVE_SOURCES];
const OTHER_SOURCES = [...new Set([...JOB_HIDDEN, ...CREATIVE_HIDDEN])];
const STUDIO_BATCH = `settings->>source.is.null,settings->>source.not.in.(${JOB_HIDDEN.join(",")})`;
/** Jobs and creatives: an anti-join on their batch (left join to a hidden-source batch, kept when there's none). */
const OTHER_BATCH = "other_batch:creative_batches(id)";
const withoutOtherBatch = <T extends { other_batch?: unknown }>(rows: T[] | null): Omit<T, "other_batch">[] =>
  (rows ?? []).map((row) => { const copy = { ...row }; delete copy.other_batch; return copy; });

/** Everything the studio page shows: the workspace, recent batches, jobs, creatives, and pickers. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/studio/[productId]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return Response.json({ error: "This workspace doesn't exist." }, { status: 404 });
  const workspace = await loadWorkspace(productId);
  if (isResponse(workspace)) return workspace;
  const { supabase } = session;
  const [batches, jobs, creatives, catalog, health, brand, assets, hidden, imageProvider] = await Promise.all([
    supabase.from("creative_batches").select("id, format_card_id, brief, settings, cost_estimate, created_at, awareness_level").eq("product_id", productId).or(STUDIO_BATCH).order("created_at", { ascending: false }).limit(20).returns<BatchRow[]>(),
    // Product cut-outs (Product page) are runner jobs too, but not creatives: they stay out of the Studio's list.
    supabase.from("creative_jobs").select(`${JOB_COLUMNS}, ${OTHER_BATCH}`).eq("product_id", productId).neq("model", CUTOUT_MODEL).in("other_batch.settings->>source", JOB_HIDDEN).is("other_batch", null)
      .order("created_at", { ascending: false }).limit(200).returns<(CreativeJobRow & { other_batch?: unknown })[]>(),
    supabase.from("creatives").select(`${CREATIVE_COLUMNS}, ${OTHER_BATCH}`).eq("product_id", productId).in("other_batch.settings->>source", CREATIVE_HIDDEN).is("other_batch", null)
      .order("created_at", { ascending: false }).limit(150).returns<(CreativeRow & { other_batch?: unknown })[]>(),
    supabase.from("creative_catalog").select("kind, items, synced_at").returns<{ kind: keyof Omit<Catalog, "syncedAt">; items: CatalogItem[]; synced_at: string }[]>(),
    creativesBackend<{ typesafe?: boolean; higgsfieldApi?: boolean; runner?: boolean; drive?: boolean; openaiImages?: boolean; wallClockSec?: unknown; openaiImagePlan?: unknown }>(session, "health"),
    brandFor(session, productId),
    supabase.from("product_assets").select(ASSET_COLUMNS).eq("product_id", productId).eq("hidden", false).order("created_at", { ascending: false }).limit(120).returns<ProductAsset[]>(),
    supabase.from("creative_batches").select("id, source:settings->>source").eq("product_id", productId).in("settings->>source", OTHER_SOURCES).order("created_at", { ascending: false }).limit(500).returns<{ id: string; source: string | null }[]>(),
    readImageProvider(session, productId),
  ]);
  const cat: Catalog = { avatars: [], hooks: [], settings: [], syncedAt: null };
  for (const row of catalog.data ?? []) { cat[row.kind] = row.items; cat.syncedAt = row.synced_at; }
  const sources = batchSourceIds(hidden.data ?? []);
  const body: StudioOverview = {
    workspace: {
      id: workspace.id, name: workspace.name, appName: brand.kit.appName, screenshots: brand.kit.screenshotUrls.length,
      appStoreUrl: brand.kit.appStoreUrl ?? null, iconUrl: brand.kit.iconUrl ?? null, driveFolderId: workspace.connections.storage?.driveFolderId ?? null,
      profile: brand.profile,
      brandSystem: brand.system,
      assets: assets.data ?? [],
      imageProvider,
    },
    batches: batches.data ?? [],
    jobs: withoutOtherBatch(jobs.data),
    creatives: withoutOtherBatch(creatives.data),
    hiddenBatchIds: sources.hidden,
    playgroundBatchIds: sources.playground,
    catalog: cat,
    // The plan's time limit and what it means for each OpenAI image quality: null from a backend that doesn't say.
    backend: health.ok ? {
      typesafe: Boolean(health.data.typesafe), higgsfieldApi: Boolean(health.data.higgsfieldApi), runner: Boolean(health.data.runner), drive: Boolean(health.data.drive), openaiImages: Boolean(health.data.openaiImages),
      wallClockSec: typeof health.data.wallClockSec === "number" && Number.isFinite(health.data.wallClockSec) ? health.data.wallClockSec : null,
      openaiImagePlan: readOpenAiImagePlan(health.data.openaiImagePlan, health.data.wallClockSec),
    } : null,
    ...(jobs.error ? { error: "The creative studio's tables aren't in the database yet (migration 20261002500000)." } : {}),
  };
  return Response.json(body);
}
