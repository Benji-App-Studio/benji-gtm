import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UUID } from "@/lib/workspace-schema";

/** Every module page of a workspace: only for one of the user's own products. */
export default async function WorkspaceLayout({ children, params }: LayoutProps<"/app/w/[productId]">) {
  const { productId } = await params;
  if (!UUID.test(productId)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("id").eq("id", productId).maybeSingle();
  if (!data) notFound();
  return children;
}
