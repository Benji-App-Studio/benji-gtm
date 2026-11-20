"use client";
// The sidebar while in Settings: "Back to app" at the top, then the settings pages in three groups:
// Workspace, You and Advanced (pages.ts). Each app's own settings are on the app (App settings).
import Link from "next/link";
import type { ReactNode } from "react";
import { useT } from "@/lib/i18n/client";
import { IconArrowLeft, IconBox, IconChip, IconCompass, IconKey, IconMonitor, IconPlug, IconRadar, IconRefresh, IconSettings, IconSun, IconUser, IconUsers } from "../icons";
import { backToAppHref, useAppPath } from "../nav/path";
import { navRowClass, navSectionClass } from "../nav/rows";
import { useInstall } from "@/lib/install/use-install";
import { SETTINGS_GROUPS, type SettingsGroupKey, type SettingsPageKey, visibleSettingsPages } from "./pages";

const ICONS: Record<SettingsPageKey, ReactNode> = {
  general: <IconSettings />,
  account: <IconUser />,
  language: <IconCompass />,
  keys: <IconKey />,
  research: <IconRadar />,
  models: <IconChip />,
  members: <IconUsers />,
  runner: <IconMonitor />,
  extension: <IconPlug />,
  storage: <IconBox />,
  appearance: <IconSun />,
  updates: <IconRefresh />,
};

/** Each settings page's name and each group's, in the viewer's language. */
export function useSettingsLabels() {
  const { t } = useT();
  const page: Record<SettingsPageKey, string> = {
    general: t("General & plan"), keys: t("Your keys"), storage: t("Storage"), members: t("Members"),
    account: t("Account"), language: t("Language"), appearance: t("Appearance"),
    models: t("AI models"), research: t("Research sources"), extension: t("Ad Library extension"), runner: t("Desktop runner"), updates: t("Updates"),
  };
  const group: Record<SettingsGroupKey, string> = { workspace: t("Workspace"), you: t("You"), advanced: t("Advanced") };
  return { page, group };
}

export function SettingsNav({ onNavigate, close }: { onNavigate?: () => void; close?: ReactNode }) {
  const { t } = useT();
  const path = useAppPath();
  const { install } = useInstall();
  const labels = useSettingsLabels();
  const pages = visibleSettingsPages(install);
  const link = (href: string, label: string, icon: ReactNode) => {
    const active = path === href;
    return <Link key={href} href={href} aria-current={active ? "page" : undefined} onClick={() => onNavigate?.()} className={navRowClass(active)}>{icon}<span className="min-w-0 truncate">{label}</span></Link>;
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 px-3 pt-2.5 pb-3">
        <Link href={backToAppHref()} onClick={() => onNavigate?.()} className={navRowClass(false)}><IconArrowLeft />{t("Back to app")}</Link>
        {close}
      </div>
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 pb-3">
        {SETTINGS_GROUPS.map((group, i) => {
          const mine = pages.filter((page) => page.group === group);
          if (!mine.length) return null;
          return (
            <div key={group} className={i ? "mt-4" : undefined}>
              <p className={navSectionClass}>{labels.group[group]}</p>
              <nav aria-label={labels.group[group]} className="flex flex-col">{mine.map((page) => link(page.href, labels.page[page.key], ICONS[page.key]))}</nav>
            </div>
          );
        })}
      </div>
    </div>
  );
}
