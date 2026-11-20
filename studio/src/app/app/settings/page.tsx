import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";
import { GeneralSettings } from "@/components/settings/general";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Settings") };
}

/** Settings → General: the workspace's name. */
export default function GeneralSettingsPage() {
  return <GeneralSettings />;
}
