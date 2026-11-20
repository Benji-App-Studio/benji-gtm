import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { appLayoutRedirect } from "@/lib/auth/session-gate";
import { deletionPending } from "@/lib/server/account-deletion";
import { localModePage } from "@/lib/server/owner-session";
import { createClient } from "@/lib/supabase/server";

/** The signed-in app: requires a session and a finished onboarding (the rules: lib/auth/session-gate.ts). */
export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? { id: data.claims.sub, email: data.claims.email as string | undefined } : null;
  if (!user) redirect(appLayoutRedirect({ signedIn: false, profile: null }) as string);
  const { data: profile } = await supabase.from("profiles").select("full_name, onboarded_at").eq("id", user.id).maybeSingle();
  // No profile: a locked account (being deleted) finishes the deletion; a session whose account is gone is
  // cleared (its token is still valid until it expires, and the login page would send it straight back).
  const pending = profile ? false : await deletionPending(supabase);
  const userExists = profile || pending ? true : Boolean((await supabase.auth.getUser()).data?.user);
  const to = appLayoutRedirect({ signedIn: true, profile: profile ? { onboarded: Boolean(profile.onboarded_at) } : null, deletionPending: pending, userExists });
  if (to || !profile) redirect(to ?? "/onboarding");
  return <AppShell name={profile.full_name} email={user.email} local={await localModePage()}>{children}</AppShell>;
}
