import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { readCookie } from "@/lib/storage-keys";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

export const metadata: Metadata = { title: "Appearance" };

export default async function AppearanceSettingsPage() {
  const theme = parseTheme(readCookie(await cookies(), THEME_COOKIE));
  return <AppearanceSettings initial={theme} />;
}
