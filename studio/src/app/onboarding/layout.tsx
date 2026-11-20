import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getTranslator } from "@/lib/i18n/server";
import { onboardingLayoutRedirect, SESSION_ENDED_PATH } from "@/lib/auth/session-gate";
import { deletionPending } from "@/lib/server/account-deletion";
import { localModePage } from "@/lib/server/owner-session";
import { createClient } from "@/lib/supabase/server";

export default async function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // The proxy let this session through (its token is valid), so no user means its account is gone: clear it
  // rather than send it to the login page, which would send it straight back (lib/auth/session-gate.ts).
  if (!user) redirect(SESSION_ENDED_PATH);
  const { data: profile } = await supabase.from("profiles").select("onboarded_at").eq("id", user.id).maybeSingle();
  const to = onboardingLayoutRedirect({
    userExists: true, profile: profile ? { onboarded: Boolean(profile.onboarded_at) } : null,
    deletionPending: profile ? false : await deletionPending(supabase),
  });
  if (to) redirect(to);
  // A copy in local mode signs its owner in by itself: no Sign out there.
  const local = await localModePage();
  const { t } = await getTranslator();
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-shell">
      <header className="mx-auto flex h-11 w-full max-w-[748px] shrink-0 items-center justify-between gap-4 px-4 sm:px-6">
        <Logo href="/onboarding" />
        {local ? <span className="min-w-0 truncate text-xs text-muted">{user.email}</span> : (
          <form action="/auth/signout" method="post" className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 truncate text-xs text-muted">{user.email}</span>
            <button className="shrink-0 rounded-xs text-xs font-medium text-label hover:text-ink">{t("Sign out")}</button>
          </form>
        )}
      </header>
      <main className="@container mx-auto mb-2 w-full min-w-0 max-w-[748px] flex-1 border-line bg-canvas sm:mb-8 sm:rounded-frame sm:border sm:shadow-frame">{children}</main>
    </div>
  );
}
