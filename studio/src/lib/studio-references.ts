// The reference images a Studio batch can pick (the new batch form): the product's own images, plus any
// picked in Recreate that aren't among them. Plain TypeScript (the browser and the Node tests).
//
// A tile's `label` is DATA: it goes into the request's productReferences, is saved with the batch and is
// written into the image prompt (lib/creative-plan.ts ourImagesLine), so it stays in English. The form
// translates it for display only.
import type { ProductReference } from "./creative-plan";
import { ASSET_KIND_LABEL, type AssetKind, type ProductAsset } from "./product-assets";

export interface ReferenceTile { key: string; url: string; label: string; kindLabel: string; kind: string }

const kindLabel = (kind: string) => ASSET_KIND_LABEL[kind as AssetKind] ?? kind.replace("_", " ");

/** The tiles in English: Recreate's extra picks first, then the product's visible images. */
export function referenceTiles(assets: Pick<ProductAsset, "url" | "label" | "kind" | "hidden">[], picks: ProductReference[]): ReferenceTile[] {
  const own = assets.filter((a) => !a.hidden).map((a) => ({ key: a.url, url: a.url, label: a.label ?? ASSET_KIND_LABEL[a.kind], kindLabel: ASSET_KIND_LABEL[a.kind], kind: a.kind }));
  const extra = picks.filter((r) => !own.some((tile) => tile.key === r.url)).map((r) => ({ key: r.url, url: r.url, label: r.label || kindLabel(r.kind), kindLabel: kindLabel(r.kind), kind: r.kind || "other" }));
  return [...extra, ...own];
}

/** The picked tiles as the request's productReferences (English labels), at most `max`. */
export function pickReferences(keys: string[], tiles: ReferenceTile[], max: number): ProductReference[] {
  return keys.map((k) => tiles.find((tile) => tile.key === k)).filter((tile): tile is ReferenceTile => Boolean(tile))
    .map((tile) => ({ url: tile.url, label: tile.label, kind: tile.kind }))
    .slice(0, max);
}
