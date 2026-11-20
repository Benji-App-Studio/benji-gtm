import { LaunchAdsView } from "@/components/launch/ads-view";

/** Launch → Ads: every ad sent from the dashboard and how each one is doing. `?ad=` opens one. */
export default async function LaunchAdsPage({ params, searchParams }: PageProps<"/app/w/[productId]/launch/ads">) {
  const { productId } = await params;
  const { ad } = await searchParams;
  return <LaunchAdsView productId={productId} initialAd={typeof ad === "string" ? ad : null} />;
}
