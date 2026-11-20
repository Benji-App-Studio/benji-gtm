import type { Metadata } from "next";
import { m } from "@/lib/i18n/translate";
import { appPageMetadata } from "@/lib/server/page-title";

/** Measure: the tab reads "Measure · <app> · Benji GTM" (lib/server/page-title.ts). */
export async function generateMetadata({ params }: LayoutProps<"/app/w/[productId]/measure">): Promise<Metadata> {
  return appPageMetadata((await params).productId, m("Measure"));
}

export default function Layout({ children }: LayoutProps<"/app/w/[productId]/measure">) {
  return children;
}
