import { redirectLegacy } from "@/lib/server/legacy-page";

/** Old address: the Playground is Studio › Remix now, and its Library (?tab=library, ?template=) Studio › Templates. */
export default async function LegacyPlayground({ params, searchParams }: PageProps<"/app/w/[productId]/playground">) {
  const { productId } = await params;
  redirectLegacy(`/app/w/${productId}/playground`, await searchParams);
}
