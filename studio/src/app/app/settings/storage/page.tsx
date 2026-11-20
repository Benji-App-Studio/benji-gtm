import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";
import { StorageSettings } from "@/components/settings/storage";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Storage") };
}

export default function StorageSettingsPage() {
  return <StorageSettings />;
}
