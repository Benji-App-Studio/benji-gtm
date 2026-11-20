import { PlaygroundView } from "@/components/playground/playground-view";

/**
 * Studio › Templates (the old Playground's Library): this app's ready-made styles. `?template=<id>` opens
 * one (the Studio's "Start from: a template" links here). Keyed by the app, so switching app starts clean.
 */
export default async function StudioTemplatesPage({ params, searchParams }: PageProps<"/app/w/[productId]/studio/templates">) {
  const { productId } = await params;
  const { template } = await searchParams;
  const openTemplate = typeof template === "string" && template ? template : null;
  return <PlaygroundView key={productId} productId={productId} openTemplate={openTemplate} library />;
}
