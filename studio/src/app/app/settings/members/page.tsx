import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";
import { HiddenInAccounts } from "@/components/settings/accounts";
import { MembersSettings } from "@/components/settings/members";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Members") };
}

export default function MembersSettingsPage() {
  return <HiddenInAccounts page="members"><MembersSettings /></HiddenInAccounts>;
}
