import type { Metadata } from "next";
import { ExampleApp } from "@/components/example/example-app";
import { exampleView } from "@/lib/example-guard";
import { getTranslator } from "@/lib/i18n/server";
import { getInstallConfig } from "@/lib/install/config";
import { appSettingsTab } from "@/lib/nav-model";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Example app"), robots: { index: false } };
}

/**
 * The example app: every page filled in with sample data, read-only, open to anyone (it holds nothing
 * real). Reached from the first run ("Look around an example first"), an app's Home, the guide and the
 * page explainers. The views mirror the app's routes (lib/example-guard.ts EXAMPLE_VIEWS):
 *   /example, /example/research[/app-store[/<id>] | /social], /studio[/remix | /templates], /launch[/ads],
 *   /measure, /settings?tab=profile|brand|connections|advanced, /apps. Old names (market, playground, brand) still work.
 */
export default async function Example({ params, searchParams }: PageProps<"/example/[[...view]]">) {
  const { view } = await params;
  const query = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  // The old Brand page with no ?tab= opened on the brand itself.
  const tab = appSettingsTab(one(query.tab) ?? ((view ?? []).join("/") === "brand" ? "brand" : undefined));
  // Signed in: "Add your own app" goes to the app (or the first run); signed out: to sign-up.
  let signedIn = false;
  if (getInstallConfig()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
  }
  return <ExampleApp view={exampleView(view)} signedIn={signedIn} tab={tab} template={one(query.template) ?? null} />;
}
