import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppSettings } from "@/components/settings/app-settings";
import { createClient } from "@/lib/supabase/server";
import { UUID } from "@/lib/workspace-schema";

export const metadata: Metadata = { title: "App settings" };

/** Settings → one app: its connections and its danger zone. Only for an app the person can open. */
export default async function AppSettingsPage({ params }: PageProps<"/app/settings/apps/[productId]">) {
  const { productId } = await params;
  if (!UUID.test(productId)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("id").eq("id", productId).maybeSingle();
  if (!data) notFound();
  return <AppSettings key={productId} id={productId} />;
}
