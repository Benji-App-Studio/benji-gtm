import { settingsColumnClass } from "@/components/settings/pages";

/**
 * Settings: every page sits in one centred column. The sidebar beside it shows the settings pages
 * while the URL is under /app/settings (components/nav/sidebar.tsx switches on the path).
 */
export default function SettingsLayout({ children }: LayoutProps<"/app/settings">) {
  return <div className={settingsColumnClass}>{children}</div>;
}
