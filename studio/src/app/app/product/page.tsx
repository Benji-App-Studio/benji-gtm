import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { brandTabHref } from "@/components/brand/brand-tabs";
import { createClient } from "@/lib/supabase/server";
import { WORKSPACE_COOKIE } from "@/lib/workspace-schema";
import { readCookie } from "@/lib/storage-keys";

/**
 * The product profile is the Brand page's Product tab now. Old links land on it for the product last
 * opened (else the main one); with no product yet, on adding one.
 */
export default async function ProductPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("id").order("is_primary", { ascending: false }).order("created_at");
  const remembered = readCookie(await cookies(), WORKSPACE_COOKIE);
  const id = data?.find((p) => p.id === remembered)?.id ?? data?.[0]?.id;
  redirect(id ? brandTabHref(id, "product") : "/app/product/new");
}
