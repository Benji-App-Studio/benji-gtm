import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";
import { KeysSettings } from "@/components/settings/keys";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Your keys") };
}

export default function KeysSettingsPage() {
  return <KeysSettings />;
}
