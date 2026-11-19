import { LaunchView } from "@/components/launch/launch-view";

/** Launch: approved creatives → paused drafts on Meta, promote/pause suggestions, daily uploads. */
export default async function LaunchPage({ params }: PageProps<"/app/w/[productId]/launch">) {
  const { productId } = await params;
  return <LaunchView productId={productId} />;
}
