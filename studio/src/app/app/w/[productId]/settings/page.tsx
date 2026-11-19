import { redirect } from "next/navigation";
import { appSettingsHref } from "@/components/settings/pages";

/** An app's settings live in Settings now; old links land there. */
export default async function WorkspaceSettingsPage({ params }: PageProps<"/app/w/[productId]/settings">) {
  const { productId } = await params;
  redirect(appSettingsHref(productId));
}
