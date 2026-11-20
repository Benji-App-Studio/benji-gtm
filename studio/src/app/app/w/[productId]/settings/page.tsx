import { AppSettingsView } from "@/components/brand/brand-view";
import { appSettingsTab } from "@/lib/nav-model";

/**
 * One app's settings, as tabs (?tab=): Profile (what the app is and who it's for), Brand (what every
 * creative follows, with its pictures), Connections (Meta, RevenueCat, Superwall…) and Advanced (where its
 * files go, and deleting the app). The Brand page's old ?tab= names still open the right tab.
 */
export default async function AppSettingsPage({ params, searchParams }: PageProps<"/app/w/[productId]/settings">) {
  const { productId } = await params;
  const { tab } = await searchParams;
  return <AppSettingsView key={productId} productId={productId} tab={appSettingsTab(tab)} />;
}
