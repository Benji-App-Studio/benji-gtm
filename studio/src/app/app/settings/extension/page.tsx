import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";
import { ExtensionSettings } from "@/components/settings/extension";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Ad Library extension") };
}

export default function ExtensionSettingsPage() {
  return <ExtensionSettings />;
}
