import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";

/** The signed-in app: requires a session and a finished onboarding. */
export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? { id: data.claims.sub, email: data.claims.email as string | undefined } : null;
  if (!user) redirect("/login?next=/app/w");
  const { data: profile } = await supabase.from("profiles").select("full_name, onboarded_at").eq("id", user.id).maybeSingle();
  if (!profile?.onboarded_at) redirect("/onboarding");
  return <AppShell name={profile.full_name} email={user.email}>{children}</AppShell>;
}
