import type { Metadata } from "next";
import { m } from "@/lib/i18n/translate";
import { appPageMetadata } from "@/lib/server/page-title";

/** Launch and its ads: the tab reads "Launch · <app> · Benji GTM" (lib/server/page-title.ts). */
export async function generateMetadata({ params }: LayoutProps<"/app/w/[productId]/launch">): Promise<Metadata> {
  return appPageMetadata((await params).productId, m("Launch"));
}

export default function Layout({ children }: LayoutProps<"/app/w/[productId]/launch">) {
  return children;
}
