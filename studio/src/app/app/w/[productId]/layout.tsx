import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { appPageMetadata } from "@/lib/server/page-title";
import { createClient } from "@/lib/supabase/server";
import { UUID } from "@/lib/workspace-schema";

/** The tab: the app's name; each section's layout puts its own name first (lib/server/page-title.ts). */
export async function generateMetadata({ params }: LayoutProps<"/app/w/[productId]">): Promise<Metadata> {
  return appPageMetadata((await params).productId, null);
}

/** Every module page of a workspace: only for one of the user's own products. */
export default async function WorkspaceLayout({ children, params }: LayoutProps<"/app/w/[productId]">) {
  const { productId } = await params;
  if (!UUID.test(productId)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("id").eq("id", productId).maybeSingle();
  if (!data) notFound();
  return children;
}
