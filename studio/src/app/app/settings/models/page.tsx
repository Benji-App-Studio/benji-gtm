import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";
import { ModelsSettings } from "@/components/settings/models";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("AI models") };
}

export default function ModelsSettingsPage() {
  return <ModelsSettings />;
}
