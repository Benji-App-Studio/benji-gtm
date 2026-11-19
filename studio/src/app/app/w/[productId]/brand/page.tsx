import { BrandView } from "@/components/brand/brand-view";
import { brandTab } from "@/components/brand/brand-tabs";

/**
 * One product's Brand page: the brand (imported from a brand guide or written here; every generator reads it),
 * the product profile, its assets and its settings, as tabs (?tab=product|assets|settings).
 */
export default async function BrandPage({ params, searchParams }: PageProps<"/app/w/[productId]/brand">) {
  const { productId } = await params;
  const { tab } = await searchParams;
  return <BrandView key={productId} productId={productId} tab={brandTab(tab)} />;
}
