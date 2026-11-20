import { redirectLegacy } from "@/lib/server/legacy-page";

/** Old address: Market is Research › App Store now. */
export default async function LegacyMarket({ params, searchParams }: PageProps<"/app/w/[productId]/market">) {
  const { productId } = await params;
  redirectLegacy(`/app/w/${productId}/market`, await searchParams);
}
