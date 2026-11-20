import type { Metadata } from "next";
import { m } from "@/lib/i18n/translate";
import { appPageMetadata } from "@/lib/server/page-title";

/** Studio and its tabs (Create, Remix, Templates): the tab reads "Studio · <app> · Benji GTM" (lib/server/page-title.ts). */
export async function generateMetadata({ params }: LayoutProps<"/app/w/[productId]/studio">): Promise<Metadata> {
  return appPageMetadata((await params).productId, m("Studio"));
}

export default function Layout({ children }: LayoutProps<"/app/w/[productId]/studio">) {
  return children;
}
