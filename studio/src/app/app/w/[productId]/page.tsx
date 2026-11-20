import type { Metadata } from "next";
import { WorkspaceOverview } from "@/components/workspace/workspace-overview";
import { m } from "@/lib/i18n/translate";
import { appPageMetadata } from "@/lib/server/page-title";

export async function generateMetadata({ params }: PageProps<"/app/w/[productId]">): Promise<Metadata> {
  return appPageMetadata((await params).productId, m("Home"));
}

export default async function WorkspacePage({ params }: PageProps<"/app/w/[productId]">) {
  const { productId } = await params;
  return <WorkspaceOverview id={productId} />;
}
