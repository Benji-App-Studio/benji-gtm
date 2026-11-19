import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { localModePage } from "@/lib/server/owner-session";
import { createClient } from "@/lib/supabase/server";

export default async function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("onboarded_at").eq("id", user.id).maybeSingle();
  if (profile?.onboarded_at) redirect("/app/w");
  // A copy in local mode signs its owner in by itself: no Sign out there.
  const local = await localModePage();
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-shell">
      <header className="mx-auto flex h-11 w-full max-w-[748px] shrink-0 items-center justify-between gap-4 px-4 sm:px-6">
        <Logo href="/onboarding" />
        {local ? <span className="min-w-0 truncate text-xs text-muted">{user.email}</span> : (
          <form action="/auth/signout" method="post" className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 truncate text-xs text-muted">{user.email}</span>
            <button className="shrink-0 rounded-xs text-xs font-medium text-label hover:text-ink">Sign out</button>
          </form>
        )}
      </header>
      <main className="@container mx-auto mb-2 w-full min-w-0 max-w-[748px] flex-1 border-line bg-canvas sm:mb-8 sm:rounded-frame sm:border sm:shadow-frame">{children}</main>
    </div>
  );
}
