import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/server";

export default async function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("onboarded_at").eq("id", user.id).maybeSingle();
  if (profile?.onboarded_at) redirect("/app/w");
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-shell">
      <header className="mx-auto flex h-12 w-full max-w-3xl shrink-0 items-center justify-between gap-4 px-4 sm:px-6">
        <Logo href="/onboarding" />
        <form action="/auth/signout" method="post" className="flex min-w-0 items-center gap-3">
          <span className="min-w-0 truncate text-xs text-muted">{user.email}</span>
          <button className="shrink-0 rounded-xs text-xs font-medium text-label hover:text-ink">Sign out</button>
        </form>
      </header>
      <main className="@container mx-auto mb-6 w-full min-w-0 max-w-3xl flex-1 border-hairline bg-canvas sm:rounded-frame sm:border">{children}</main>
    </div>
  );
}
