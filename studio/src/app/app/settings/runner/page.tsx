import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";
import { staffPageTitle } from "@/lib/server/staff";
import { HiddenInAccounts } from "@/components/settings/accounts";
import { RunnerSettings } from "@/components/settings/runner";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: await staffPageTitle(t("Desktop runner"), t("Settings")) };
}

export default function RunnerSettingsPage() {
  return <HiddenInAccounts page="runner"><RunnerSettings /></HiddenInAccounts>;
}
