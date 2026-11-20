import { redirectLegacy } from "@/lib/server/legacy-page";

/** Old address: one competitor's app is under Research › App Store now. */
export default async function LegacyMarketApp({ params, searchParams }: PageProps<"/app/w/[productId]/market/[appId]">) {
  const { productId, appId } = await params;
  redirectLegacy(`/app/w/${productId}/market/${appId}`, await searchParams);
}
