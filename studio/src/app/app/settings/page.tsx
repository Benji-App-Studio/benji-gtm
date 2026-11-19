import type { Metadata } from "next";
import { GeneralSettings } from "@/components/settings/general";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

/** Settings → General: the workspace's name, and the signed-in person's account. */
export default async function GeneralSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user ? await supabase.from("profiles").select("full_name, created_at").eq("id", user.id).maybeSingle() : { data: null };
  return <GeneralSettings account={{ name: profile?.full_name ?? null, email: user?.email ?? null, since: profile?.created_at ?? null }} />;
}
