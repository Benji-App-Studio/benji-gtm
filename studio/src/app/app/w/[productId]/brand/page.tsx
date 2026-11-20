import { redirectLegacy } from "@/lib/server/legacy-page";

/** Old address: the Brand page and its tabs are App settings now (?tab=product → Profile, ?tab=settings → Connections). */
export default async function LegacyBrand({ params, searchParams }: PageProps<"/app/w/[productId]/brand">) {
  const { productId } = await params;
  redirectLegacy(`/app/w/${productId}/brand`, await searchParams);
}
