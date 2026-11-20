import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";
import { staffPageTitle } from "@/lib/server/staff";
import { HiddenInAccounts } from "@/components/settings/accounts";
import { UpdatesSettings } from "@/components/settings/updates";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: await staffPageTitle(t("Updates"), t("Settings")) };
}

export default function UpdatesSettingsPage() {
  return <HiddenInAccounts page="updates"><UpdatesSettings /></HiddenInAccounts>;
}
