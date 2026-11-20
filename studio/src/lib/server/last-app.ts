// The app last opened (the cookie the sidebar sets), else the main one, else the first: where /app,
// /app/w and old links that name no app land.
import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { readCookie } from "@/lib/storage-keys";
import { WORKSPACE_COOKIE } from "@/lib/workspace-schema";

export async function lastAppId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("id").order("is_primary", { ascending: false }).order("created_at");
  const remembered = readCookie(await cookies(), WORKSPACE_COOKIE);
  return data?.find((p) => p.id === remembered)?.id ?? data?.[0]?.id ?? null;
}
