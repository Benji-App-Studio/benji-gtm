import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from "@/lib/brand-config";
import { I18nProvider } from "@/lib/i18n/client";
import { dictionaryFor } from "@/lib/i18n/dictionaries";
import { HTML_LANG } from "@/lib/i18n/locales";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { getInstallConfig, toPublic } from "@/lib/install/config";
import { installScript } from "@/lib/install/public";
import { readCookie, THEME_KEY } from "@/lib/storage-keys";
import { THEME_RESTORE_SCRIPT, parseTheme } from "@/lib/theme";
import "./globals.css";

// Inter (variable, with its optical-size axis so big numbers and titles tighten like the reference);
// JetBrains Mono only for handles and the activity log.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], axes: ["opsz"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"], weight: ["400", "500", "700"] });

// The default title and description, in the page's language (pages set their own on top).
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return {
    title: { default: `${APP_NAME} · ${t(APP_TAGLINE)}`, template: `%s · ${APP_NAME}` },
    description: t(APP_DESCRIPTION),
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The theme comes from a cookie so the first paint is already in the right colours (a choice saved
  // under the cookie's earlier name still counts; the script in <head> then moves it).
  const theme = parseTheme(readCookie(await cookies(), THEME_KEY));
  // The Supabase project this install uses is known only at run time; the browser gets it from here.
  const config = getInstallConfig();
  const install = config ? toPublic(config) : null;
  // The language: a saved choice or the browser's. Only that language's dictionary is sent.
  const locale = await getLocale();
  return (
    <html lang={HTML_LANG[locale]} dir="ltr" data-theme={theme} suppressHydrationWarning className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <head><script dangerouslySetInnerHTML={{ __html: `${installScript(install)}${THEME_RESTORE_SCRIPT}` }} /></head>
      <body className="flex min-h-full flex-col"><I18nProvider locale={locale} dict={dictionaryFor(locale)}>{children}</I18nProvider></body>
    </html>
  );
}
