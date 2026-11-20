import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";
import { cookies } from "next/headers";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { readCookie } from "@/lib/storage-keys";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Appearance") };
}

export default async function AppearanceSettingsPage() {
  const theme = parseTheme(readCookie(await cookies(), THEME_COOKIE));
  return <AppearanceSettings initial={theme} />;
}
