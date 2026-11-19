import { notFound } from "next/navigation";
import { MeasureView } from "@/components/measure/measure-view";
import { getWorkspace } from "@/lib/workspace";

/** Measure: one dashboard for a workspace's ads, attribution and subscription money. */
export default async function MeasurePage({ params }: PageProps<"/app/w/[productId]/measure">) {
  const { productId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(productId)) notFound();
  const workspace = await getWorkspace(productId).catch(() => null);
  if (!workspace) notFound();
  return <MeasureView productId={workspace.id} name={workspace.name} />;
}
