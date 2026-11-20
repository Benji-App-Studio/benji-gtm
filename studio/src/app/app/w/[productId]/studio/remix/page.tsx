import { PlaygroundView } from "@/components/playground/playground-view";

/**
 * Studio › Remix (the old Playground): bring a reference ad and say what to change, or describe a video.
 * Keyed by the app, so switching app starts from a clean slate.
 */
export default async function StudioRemixPage({ params }: PageProps<"/app/w/[productId]/studio/remix">) {
  const { productId } = await params;
  return <PlaygroundView key={productId} productId={productId} />;
}
