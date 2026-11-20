import { notFound } from "next/navigation";
import { MarketAppView } from "@/components/market/market-app";
import { UUID } from "@/lib/workspace-schema";

/** One competitor's app: rating trend, releases, review stars and what its users say. */
export default async function AppStoreAppPage({ params }: PageProps<"/app/w/[productId]/research/app-store/[appId]">) {
  const { productId, appId } = await params;
  if (!UUID.test(productId) || !UUID.test(appId)) notFound();
  return <MarketAppView productId={productId} appId={appId} />;
}
