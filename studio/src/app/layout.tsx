import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from "@/lib/brand-config";
import { getInstallConfig, toPublic } from "@/lib/install/config";
import { installScript } from "@/lib/install/public";
import { readCookie, THEME_KEY } from "@/lib/storage-keys";
import { THEME_RESTORE_SCRIPT, parseTheme } from "@/lib/theme";
import "./globals.css";

// Inter (variable, with its optical-size axis so big numbers and titles tighten like the reference);
// JetBrains Mono only for handles and the activity log.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], axes: ["opsz"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"], weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  title: { default: `${APP_NAME} · ${APP_TAGLINE}`, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The theme comes from a cookie so the first paint is already in the right colours (a choice saved
  // under the cookie's earlier name still counts; the script in <head> then moves it).
  const theme = parseTheme(readCookie(await cookies(), THEME_KEY));
  // The Supabase project this install uses is known only at run time; the browser gets it from here.
  const config = getInstallConfig();
  const install = config ? toPublic(config) : null;
  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <head><script dangerouslySetInnerHTML={{ __html: `${installScript(install)}${THEME_RESTORE_SCRIPT}` }} /></head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
