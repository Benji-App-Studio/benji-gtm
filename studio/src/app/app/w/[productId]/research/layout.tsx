import type { Metadata } from "next";
import { m } from "@/lib/i18n/translate";
import { appPageMetadata } from "@/lib/server/page-title";

/** Research and its tabs (Ads, App Store, Social posts): the tab reads "Research · <app> · Benji GTM" (lib/server/page-title.ts). */
export async function generateMetadata({ params }: LayoutProps<"/app/w/[productId]/research">): Promise<Metadata> {
  return appPageMetadata((await params).productId, m("Research"));
}

export default function Layout({ children }: LayoutProps<"/app/w/[productId]/research">) {
  return children;
}
