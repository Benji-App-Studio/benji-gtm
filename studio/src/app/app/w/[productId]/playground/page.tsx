import { PlaygroundView } from "@/components/playground/playground-view";

/**
 * The Playground for one workspace: reference-driven image experiments on the creative pipeline.
 * Keyed by the product, so switching product remounts it empty: no form, template, picker or lightbox
 * state carries over from the last one. The Studio's "Start from: A Playground template" links here:
 * `?template=<id>` opens that template, `?tab=library` the Library.
 */
export default async function PlaygroundPage({ params, searchParams }: PageProps<"/app/w/[productId]/playground">) {
  const { productId } = await params;
  const { template, tab } = await searchParams;
  const openTemplate = typeof template === "string" && template ? template : null;
  return <PlaygroundView key={productId} productId={productId} openTemplate={openTemplate} library={Boolean(openTemplate) || tab === "library"} />;
}
