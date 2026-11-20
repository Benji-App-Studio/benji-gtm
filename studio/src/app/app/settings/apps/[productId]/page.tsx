import { redirectLegacy } from "@/lib/server/legacy-page";

/** Old address: an app's connections are on its own App settings page now (Connections tab). */
export default async function LegacyAppSettings({ params, searchParams }: PageProps<"/app/settings/apps/[productId]">) {
  const { productId } = await params;
  redirectLegacy(`/app/settings/apps/${productId}`, await searchParams);
}
