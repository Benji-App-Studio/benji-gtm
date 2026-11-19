import type { NextRequest } from "next/server";
import { canCutOut, CUTOUT_CREDITS, CUTOUT_MODEL, cutoutParams, type ProductAsset } from "@/lib/product-assets";
import { isResponse, requireUser, type Session } from "@/lib/server/auth";

type Asset = Pick<ProductAsset, "id" | "product_id" | "url" | "kind" | "cutout_url" | "cutout_path">;
interface CutoutJob { id: string; status: string; error: string | null; created_at: string }

const ACTIVE = ["queued", "running", "finalizing"];
const isId = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

/** The newest cut-out job for one asset (its status and error), or null. */
async function latestJob(supabase: Session["supabase"], productId: string, assetId: string) {
  const { data } = await supabase.from("creative_jobs").select("id, status, error, created_at")
    .eq("product_id", productId).eq("model", CUTOUT_MODEL).eq("params->cutout->>asset_id", assetId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle<CutoutJob>();
  return data ?? null;
}

async function loadAsset(supabase: Session["supabase"], productId: string, assetId: string) {
  const { data } = await supabase.from("product_assets").select("id, product_id, url, kind, cutout_url, cutout_path").eq("id", assetId).eq("product_id", productId).maybeSingle<Asset>();
  return data ?? null;
}

/** Where a product image's cut-out stands: the cut-out (once made) and the newest job for it. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/products/[id]/assets/[assetId]/cutout">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id, assetId } = await ctx.params;
  if (!isId(id) || !isId(assetId)) return Response.json({ error: "Not found" }, { status: 404 });
  const asset = await loadAsset(session.supabase, id, assetId);
  if (!asset) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ cutout_url: asset.cutout_url ?? null, cutout_path: asset.cutout_path ?? null, job: await latestJob(session.supabase, id, assetId) });
}

/**
 * "Make cut-out" on a product or packaging image: queues Higgsfield's background remover
 * (`image_background_remover`) for the desktop runner, which runs it with the CLI; the creatives function
 * then stores the transparent PNG as the image's `cutout_url` / `cutout_path` (Higgsfield's public API
 * has no background remover, so it's never made there). One at a time per image: asking again while
 * one is queued or running returns that job. Making it again replaces the old cut-out when it lands.
 */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/products/[id]/assets/[assetId]/cutout">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id, assetId } = await ctx.params;
  if (!isId(id) || !isId(assetId)) return Response.json({ error: "Not found" }, { status: 404 });
  const { supabase } = session;
  const asset = await loadAsset(supabase, id, assetId);
  if (!asset) return Response.json({ error: "Not found" }, { status: 404 });
  if (!canCutOut(asset)) return Response.json({ error: "Cut-outs are made of product and packaging images. Set its kind to Product or Packaging first." }, { status: 400 });
  if (!/^https:\/\//i.test(asset.url)) return Response.json({ error: "This image has no public link to send to Higgsfield." }, { status: 400 });
  const running = await latestJob(supabase, id, assetId);
  if (running && ACTIVE.includes(running.status)) return Response.json({ job: running, already: true });
  const { data: job, error } = await supabase.from("creative_jobs").insert({
    product_id: id, batch_id: null, format_card_id: null, kind: "image", model: CUTOUT_MODEL, prompt: "",
    params: cutoutParams(asset), aspect: "1:1", variant: 1, backend: "local", cost_estimate: CUTOUT_CREDITS,
  }).select("id, status, error, created_at").single<CutoutJob>();
  if (error || !job) return Response.json({ error: `Couldn't queue the cut-out: ${error?.message ?? "no job"}` }, { status: 500 });
  return Response.json({ job });
}
