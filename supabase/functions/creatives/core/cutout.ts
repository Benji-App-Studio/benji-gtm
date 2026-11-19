// Product cut-outs (Product page → "Make cut-out"): Higgsfield's background remover run by the Mac
// runner as a creative job (model `image_background_remover`, params.cutout.asset_id). Its result isn't
// a creative: the transparent PNG is stored on the product image as product_assets.cutout_url and
// cutout_path (a path in the `creatives` bucket), which composed ads composite as "the real product".
// The same rules as studio/src/lib/product-assets.ts (cutoutAssetId), which the edge bundle can't import.

export const CUTOUT_MODEL = "image_background_remover";

/** The product image a job cuts out, or null when it isn't a cut-out job. */
export function cutoutAssetId(job: { model: string; params: Record<string, unknown> | null }): string | null {
  const c = job.params?.cutout as Record<string, unknown> | undefined;
  return job.model === CUTOUT_MODEL && c && typeof c.asset_id === "string" && /^[0-9a-f-]{36}$/i.test(c.asset_id) ? c.asset_id : null;
}

/**
 * The columns a finished cut-out job writes on its product image: the first image output the runner
 * uploaded under the product's own folder. Null when there is none (nothing to store).
 */
export function cutoutPatch(productId: string, outputs: { path?: unknown; kind?: unknown; mime?: unknown }[], publicUrl: (path: string) => string): { cutout_url: string; cutout_path: string } | null {
  const out = outputs.find((o) => typeof o.path === "string" && o.path.startsWith(`${productId}/`) && o.kind !== "video" && (typeof o.mime !== "string" || o.mime.startsWith("image/")));
  if (!out) return null;
  const path = out.path as string;
  return { cutout_url: publicUrl(path), cutout_path: path };
}
