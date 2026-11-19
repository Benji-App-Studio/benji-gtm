import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WORKSPACE_COOKIE, workspaceHref } from "@/lib/workspace-schema";
import { readCookie } from "@/lib/storage-keys";

/** Where sign-in and onboarding land: the Home of the last product opened, else of the main one. */
export default async function Workspaces() {
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("id").order("is_primary", { ascending: false }).order("created_at");
  const remembered = readCookie(await cookies(), WORKSPACE_COOKIE);
  const id = data?.find((p) => p.id === remembered)?.id ?? data?.[0]?.id;
  redirect(id ? workspaceHref(id) : "/app/product/new");
}
