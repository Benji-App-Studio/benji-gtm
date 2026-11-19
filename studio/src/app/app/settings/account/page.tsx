import type { Metadata } from "next";
import { AccountSettings } from "@/components/settings/account";
import { localModePage } from "@/lib/server/owner-session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account" };

/** Settings → Account: the signed-in person's sign-in, password, and (on a local copy) using it online. */
export default async function AccountSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user ? await supabase.from("profiles").select("full_name, created_at").eq("id", user.id).maybeSingle() : { data: null };
  return <AccountSettings local={await localModePage()} account={{ name: profile?.full_name ?? null, email: user?.email ?? null, since: profile?.created_at ?? null }} />;
}
