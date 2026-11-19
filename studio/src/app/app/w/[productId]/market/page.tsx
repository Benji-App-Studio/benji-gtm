import { notFound } from "next/navigation";
import { MarketView } from "@/components/market/market-view";
import { UUID } from "@/lib/workspace-schema";

/** Market: competitors' apps on the App Store, the top charts, and the gaps their reviews show. */
export default async function MarketPage({ params }: PageProps<"/app/w/[productId]/market">) {
  const { productId } = await params;
  if (!UUID.test(productId)) notFound();
  return <MarketView productId={productId} />;
}
