import type { Metadata } from "next";
import { m } from "@/lib/i18n/translate";
import { appPageMetadata } from "@/lib/server/page-title";

/** The app's settings: the tab reads "App settings · <app> · Benji GTM" (lib/server/page-title.ts). */
export async function generateMetadata({ params }: LayoutProps<"/app/w/[productId]/settings">): Promise<Metadata> {
  return appPageMetadata((await params).productId, m("App settings"));
}

export default function Layout({ children }: LayoutProps<"/app/w/[productId]/settings">) {
  return children;
}
