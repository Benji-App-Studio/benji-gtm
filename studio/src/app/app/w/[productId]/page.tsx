import { WorkspaceOverview } from "@/components/workspace/workspace-overview";

export default async function WorkspacePage({ params }: PageProps<"/app/w/[productId]">) {
  const { productId } = await params;
  return <WorkspaceOverview id={productId} />;
}
