import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";
import { AccountSettings } from "@/components/settings/account";
import type { LaunchedApp } from "@/components/settings/delete-account";
import { localModePage } from "@/lib/server/owner-session";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Account") };
}

/** Settings → Account: the signed-in person's sign-in, password, and (on a local copy) using it online. */
export default async function AccountSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [{ data: profile }, launched] = await Promise.all([
    user ? supabase.from("profiles").select("full_name, created_at").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
    launchedApps(supabase),
  ]);
  return <AccountSettings local={await localModePage()} launched={launched} account={{ name: profile?.full_name ?? null, email: user?.email ?? null, since: profile?.created_at ?? null }} />;
}

/** The person's apps with ads sent to Meta from Launch, for "pause them first" before deleting the account. */
async function launchedApps(supabase: Awaited<ReturnType<typeof createClient>>): Promise<LaunchedApp[]> {
  const { data } = await supabase.from("launch_drafts").select("product_id, products(name)").not("ad_id", "is", null).limit(5000);
  const apps = new Map<string, LaunchedApp>();
  for (const row of (data ?? []) as { product_id: string; products: { name: string } | { name: string }[] | null }[]) {
    const name = (Array.isArray(row.products) ? row.products[0]?.name : row.products?.name) ?? "";
    const app = apps.get(row.product_id) ?? { id: row.product_id, name, ads: 0 };
    app.ads++;
    apps.set(row.product_id, app);
  }
  return [...apps.values()];
}
