"use client";
// The sidebar while in Settings: "Back to app" at the top, the workspace's settings pages, then one
// entry per app (its connections and danger zone).
import Link from "next/link";
import type { ReactNode } from "react";
import { IconArrowLeft, IconBox, IconChip, IconKey, IconMonitor, IconPlug, IconRadar, IconRefresh, IconSettings, IconSun, IconUser, IconUsers } from "../icons";
import { backToAppHref, useAppPath } from "../nav/path";
import { navRowClass, navSectionClass } from "../nav/rows";
import { useWorkspaces, WorkspaceMark } from "../nav/workspaces";
import { appSettingsHref, SETTINGS_PAGES, type SettingsPageKey } from "./pages";

const ICONS: Record<SettingsPageKey, ReactNode> = {
  general: <IconSettings />,
  account: <IconUser />,
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

export function SettingsNav({ onNavigate, close }: { onNavigate?: () => void; close?: ReactNode }) {
  const path = useAppPath();
  const { products } = useWorkspaces();
  const link = (href: string, label: string, icon: ReactNode) => {
    const active = path === href;
    return <Link key={href} href={href} aria-current={active ? "page" : undefined} onClick={() => onNavigate?.()} className={navRowClass(active)}>{icon}<span className="min-w-0 truncate">{label}</span></Link>;
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 px-3 pt-2.5 pb-3">
        <Link href={backToAppHref()} onClick={() => onNavigate?.()} className={navRowClass(false)}><IconArrowLeft />Back to app</Link>
        {close}
      </div>
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 pb-3">
        <p className={navSectionClass}>Workspace</p>
        <nav aria-label="Workspace settings" className="flex flex-col">{SETTINGS_PAGES.map((page) => link(page.href, page.label, ICONS[page.key]))}</nav>
        {products && products.length > 0 && (
          <>
            <p className={`${navSectionClass} mt-4`}>Your apps</p>
            <nav aria-label="App settings" className="flex flex-col">{products.map((product) => link(appSettingsHref(product.id), product.name, <WorkspaceMark name={product.name} />))}</nav>
          </>
        )}
      </div>
    </div>
  );
}
