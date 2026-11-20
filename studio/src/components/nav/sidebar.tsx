"use client";
// The app's sidebar. At the top: the workspace button (its menu holds Settings, Appearance, Language and
// Sign out), search and "new". Then All apps, then "Your apps": each app is a row that opens to show its
// pages in the order of the journey (Home, Research, Studio, Launch, Measure, App settings; the order is
// lib/nav-model.ts). At the bottom: the next thing to do, then Help. In Settings the same column shows the
// settings pages instead. Wide screens show it beside the page; below lg there is a top bar and the same
// content in a drawer.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { STORAGE_PREFIX } from "@/lib/brand-config";
import { preload } from "@/lib/client-cache";
import { featureState } from "@/lib/capabilities";
import { setLocale, useT } from "@/lib/i18n/client";
import { LOCALE_NAMES, LOCALES } from "@/lib/i18n/locales";
import { canManage, roleLabel, useInstall } from "@/lib/install/use-install";
import { ALL_APPS_HREF, ANALYSES_HREF, APP_SECTIONS, appHref, locate, NEW_APP_HREF, newAnalysisHref, SHORTCUTS, shortcutHref, type AppSection } from "@/lib/nav-model";
import { applyTheme } from "@/lib/theme";
import { noticeText, percent } from "@/lib/storage-usage";
import { useStorage } from "@/lib/use-storage";
import { THEME_OPTIONS, useTheme } from "../appearance";
import {
  IconChart, IconChevronDown, IconChevronRight, IconCompass, IconCompose, IconGrid, IconHelp, IconHome, IconLayers, IconList, IconLogout, IconMenu,
  IconMonitor, IconMoon, IconPlus, IconRocket, IconSearch, IconSettings, IconSparkles, IconSun, IconX,
} from "../icons";
import { GettingStartedCompact, useGuide } from "../getting-started";
import { goInstant } from "../instant";
import { useLayer } from "../layers";
import { useProjects } from "../project-list";
import { SettingsNav } from "../settings/settings-nav";
import { Badge, cx, Gear, Kbd, Menu, MenuItem, MenuSeparator, MenuSub } from "../ui";
import { openCommandMenu } from "./command-menu";
import { openHelp } from "./help-panel";
import { useNavLabels } from "./nav-labels";
import { inSettings, rememberAppPath, SETTINGS_ROOT, useAppPath } from "./path";
import { navRowClass, navSectionClass } from "./rows";
import { InstallMark, rememberWorkspace, useWorkspaces, WorkspaceMark } from "./workspaces";
import { useWorkspaceLabel } from "./who";

/** Each app page's icon, in the journey's order. */
const SECTION_ICONS: Record<AppSection, ReactNode> = {
  home: <IconHome />,
  research: <IconCompass />,
  studio: <IconSparkles />,
  launch: <IconRocket />,
  measure: <IconChart />,
  settings: <IconSettings />,
};

// MARK: A yes/no kept in localStorage (the server render uses the default)

const flagListeners = new Set<() => void>();
function useStoredFlag(name: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const key = `${STORAGE_PREFIX}.${name}`;
  const value = useSyncExternalStore(
    (listener) => { flagListeners.add(listener); return () => { flagListeners.delete(listener); }; },
    () => { try { const stored = localStorage.getItem(key); return stored === null ? fallback : stored === "1"; } catch { return fallback; } },
    () => fallback,
  );
  return [value, (next) => { try { localStorage.setItem(key, next ? "1" : "0"); } catch { /* storage blocked: nothing to remember */ } flagListeners.forEach((listener) => listener()); }];
}

// MARK: The column

/** `local`: a copy in local mode signs its owner in by itself, so it has no Sign out. */
type Who = { name?: string | null; email?: string; local?: boolean };

export function Sidebar({ name, email, local }: Who) {
  return (
    <aside className="hidden w-[244px] shrink-0 flex-col bg-sidebar lg:flex">
      <NavBody name={name} email={email} local={local} />
    </aside>
  );
}

/** Below lg: a top bar with the menu button, the workspace and search; the menu button opens the sidebar as a drawer. */
export function MobileBar({ name, email, local }: Who) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const path = useAppPath();
  const { loading } = useInstall();
  const [openedOn, setOpenedOn] = useState(path);
  if (open && openedOn !== path) setOpen(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  // A layer while open: Tab stays in the drawer, Escape closes it, and closing puts the keyboard back on
  // the menu button (unless focus already moved on).
  useLayer(drawerRef, { enabled: open, onEscape: () => setOpen(false), initialFocus: closeRef });
  // Its saved name; with none yet, "Ann's workspace" after the person (lib/workspace-name.ts).
  const { label: workspace } = useWorkspaceLabel();
  const settings = inSettings(path);
  // While the install loads the name isn't known yet: keep its place instead of flashing the product's name.
  const pending = loading && !settings;
  return (
    <>
      <header className="sticky top-0 z-30 flex h-11 items-center gap-1 border-b border-line bg-shell/95 px-2 backdrop-blur lg:hidden">
        <button type="button" onClick={() => { setOpenedOn(path); setOpen(true); }} aria-label={t("Open menu")} aria-expanded={open} className="grid size-8 shrink-0 place-items-center rounded-control text-label hover:bg-hover"><IconMenu className="size-[18px]" /></button>
        <Link href={settings ? SETTINGS_ROOT : ALL_APPS_HREF} className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control px-1.5">
          <InstallMark name={workspace} className={cx(pending && "invisible")} />
          <span className={cx("truncate text-sm font-medium", pending && "invisible")}>{settings ? t("Settings") : workspace}</span>
        </Link>
        <button type="button" onClick={openCommandMenu} aria-label={t("Search")} className="grid size-8 shrink-0 place-items-center rounded-control text-label hover:bg-hover"><IconSearch className="size-[18px]" /></button>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="page-in absolute inset-0 bg-scrim/30" onClick={() => setOpen(false)} />
          <div ref={drawerRef} role="dialog" aria-modal="true" aria-label={t("Menu")} className="absolute inset-y-0 left-0 flex w-[min(288px,86vw)] flex-col border-r border-hairline bg-sidebar shadow-pop">
            <NavBody name={name} email={email} local={local} onNavigate={() => setOpen(false)}
              close={<button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label={t("Close menu")} className="grid size-8 shrink-0 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink"><IconX className="size-4" /></button>} />
          </div>
        </div>
      )}
    </>
  );
}

type BodyProps = Who & { onNavigate?: () => void; close?: ReactNode };

function NavBody(props: BodyProps) {
  const path = useAppPath();
  return inSettings(path) ? <SettingsNav onNavigate={props.onNavigate} close={props.close} /> : <AppNav {...props} />;
}

// MARK: The app's own navigation

function AppNav({ name, email, local, onNavigate, close }: BodyProps) {
  const { t, tn } = useT();
  const labels = useNavLabels();
  const path = useAppPath();
  const { products, id: currentApp } = useWorkspaces();
  const projects = useProjects();
  // Apps with an analysis of social posts running: their Research row shows it.
  const busy = new Set((projects ?? []).filter((p) => p.status === "discovering" || p.status === "analyzing").map((p) => p.productId ?? ""));
  const attention = (projects ?? []).filter((p) => p.status === "review" || p.status === "error").length;
  // The clicked link lights up straight away, before the next page has loaded.
  const [clicked, setClicked] = useState<{ href: string; from: string } | null>(null);
  const at = clicked && clicked.from === path ? clicked.href : path;
  const here = locate(at);
  const [appsOpen, setAppsOpen] = useStoredFlag("nav.apps", true);
  // Apps the person opened or closed by hand; otherwise the app in the URL is open (and a lone app always is).
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const appsId = useId();
  const warm = () => { preload("/api/projects"); preload("/api/products"); };
  const go = (href: string) => (event: React.MouseEvent<HTMLAnchorElement>) => { setClicked({ href, from: path }); goInstant(event, href); onNavigate?.(); };

  const row = (href: string, label: string, icon: ReactNode, active: boolean, extra?: ReactNode) => (
    <Link key={href} href={href} aria-current={active ? "page" : undefined} onClick={go(href)} onMouseEnter={warm} onFocus={warm} className={navRowClass(active)}>
      {icon}<span className="min-w-0 flex-1 truncate">{label}</span>{extra}
    </Link>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The workspace, search and new */}
      <div className="flex shrink-0 items-center gap-1 px-3 pt-2.5 pb-3">
        <WorkspaceMenu name={name} email={email} local={local} />
        <button type="button" onClick={openCommandMenu} aria-label={t("Search")} title={t("Search (⌘K)")} className="grid size-7 shrink-0 place-items-center rounded-full text-nav transition-colors hover:bg-hover hover:text-ink max-lg:size-8"><IconSearch className="size-3.5" /></button>
        <Menu label={t("New")} align="end" width={200} trigger={(trigger) => (
          <button {...trigger} aria-label={t("New")} title={t("New")} className="grid size-7 shrink-0 place-items-center rounded-full border border-hairline bg-raised text-label transition-colors hover:bg-hover hover:text-ink aria-expanded:bg-hover aria-expanded:text-ink max-lg:size-8"><IconCompose className="size-3.5" /></button>
        )}>
          <MenuItem icon={<IconLayers />} href={NEW_APP_HREF} onSelect={onNavigate}>{t("New app")}</MenuItem>
          <MenuItem icon={<IconPlus />} href={newAnalysisHref(currentApp)} onSelect={onNavigate}>{t("New analysis of social posts")}</MenuItem>
        </Menu>
        {close}
      </div>

      {/* The links scroll on short windows; the row above and the footer stay put. */}
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 pb-3">
        <nav aria-label={t("Main")} className="flex flex-col">
          {row(ALL_APPS_HREF, labels.allApps, <IconGrid />, here.allApps)}
          {row(ANALYSES_HREF, labels.analyses, <IconList />, here.analyses && !here.appId,
            attention > 0 ? <span className="min-w-4 rounded-full bg-control px-1 text-center text-[11px] tabular-nums text-label" title={tn(attention, "{n} analysis needs you", "{n} analyses need you")}>{attention}</span> : undefined)}
        </nav>

        <div className="mt-4">
          <button type="button" onClick={() => setAppsOpen(!appsOpen)} aria-expanded={appsOpen} aria-controls={appsId} className={cx(navSectionClass, "transition-colors hover:bg-hover hover:text-label")}>
            {t("Your apps")}<IconChevronDown className={cx("size-3 transition-transform motion-reduce:transition-none", !appsOpen && "-rotate-90")} />
          </button>
          {appsOpen && (
            <nav id={appsId} aria-label={t("Your apps")} className="flex flex-col">
              {(products ?? []).map((product) => {
                const open = toggled[product.id] ?? (product.id === here.appId || products?.length === 1);
                const home = appHref(product.id);
                const listId = `${appsId}-${product.id}`;
                const mine = here.appId === product.id;
                return (
                  <div key={product.id}>
                    <div className="group/app relative flex items-center">
                      <Link href={home} onClick={(event) => { setToggled((all) => ({ ...all, [product.id]: true })); rememberWorkspace(product.id); go(home)(event); }}
                        // Room for the chevron, inline so it beats the row's own right padding: a long name truncates before it.
                        className={navRowClass(false)} style={{ paddingRight: 32 }}>
                        <WorkspaceMark name={product.name} /><span className="min-w-0 truncate">{product.name}</span>
                      </Link>
                      <button type="button" onClick={() => setToggled((all) => ({ ...all, [product.id]: !open }))} aria-expanded={open} aria-controls={listId}
                        aria-label={open ? t("Hide {name}'s pages", { name: product.name }) : t("Show {name}'s pages", { name: product.name })}
                        className="absolute right-0.5 grid size-6 place-items-center rounded-control text-faint transition-colors hover:bg-hover hover:text-ink max-lg:size-8">
                        <IconChevronRight className={cx("size-3 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
                      </button>
                    </div>
                    {open && (
                      <div id={listId} className="mb-1 flex flex-col pl-4">
                        {APP_SECTIONS.map((section) => row(appHref(product.id, section), labels.section[section], SECTION_ICONS[section], mine && here.section === section,
                          section === "research" && busy.has(product.id) ? <span title={t("An analysis is running")}><Gear className="size-3.5 text-muted" /></span> : undefined))}
                      </div>
                    )}
                  </div>
                );
              })}
              <Link href={NEW_APP_HREF} onClick={() => onNavigate?.()} className={navRowClass(at === NEW_APP_HREF)}><IconPlus />{t("New app")}</Link>
            </nav>
          )}
        </div>

        {/* Footer: what needs doing, then Help */}
        <div className="mt-auto flex flex-col gap-1.5 pt-6">
          {/* The app's getting-started guide while it has steps left (components/getting-started.tsx), else the next thing worth doing. */}
          {currentApp ? <GuideOrNextStep appId={currentApp} attention={attention} onNavigate={onNavigate} go={go} /> : <NextStep attention={attention} onNavigate={onNavigate} go={go} />}
          <button type="button" onClick={() => { onNavigate?.(); openHelp(); }} className={navRowClass(false)}><IconHelp /><span className="min-w-0 flex-1 truncate">{t("Help")}</span><Kbd className="max-lg:hidden">?</Kbd></button>
        </div>
      </div>
    </div>
  );
}

/** The quiet card at the bottom of the sidebar: the one thing worth doing next, when there is one. */
/**
 * The footer card in an app: its getting-started guide (the step to do next, and how far along it is) while
 * the guide is open and has steps left; otherwise, or when storage is about to run out (collecting and
 * generating would stop), the next thing worth doing (a missing AI key, storage, analyses that need you).
 */
function GuideOrNextStep({ appId, attention, onNavigate, go }: { appId: string; attention: number; onNavigate?: () => void; go: (href: string) => (event: React.MouseEvent<HTMLAnchorElement>) => void }) {
  const guide = useGuide(appId);
  const { summary: storage } = useStorage();
  const urgent = storage && (storage.level === "warn" || storage.level === "full");
  if (!urgent && guide.show && guide.status.current) return <GettingStartedCompact id={appId} onNavigate={onNavigate} />;
  return <NextStep attention={attention} onNavigate={onNavigate} go={go} />;
}

function NextStep({ attention, onNavigate, go }: { attention: number; onNavigate?: () => void; go: (href: string) => (event: React.MouseEvent<HTMLAnchorElement>) => void }) {
  const { t, tn, intl } = useT();
  const { install } = useInstall();
  // The one key nothing reads without: the AI's, for whichever provider Settings chose.
  const ai = featureState("ai", install, null, { t, intl });
  const missing = install && !ai.ok ? ai.missingKeys[0] : undefined;
  const card = "block rounded-small border border-line bg-card px-3 py-2.5 transition-colors hover:border-hairline hover:bg-raised";
  // From 80% of the plan's storage: a quiet card (Settings > Storage has the rest).
  const { summary: storage } = useStorage();
  const notice80 = storage ? Boolean(noticeText(storage)) : false;
  // Almost full or full outranks everything: collecting, generating and uploading are about to stop.
  const urgent = storage && (storage.level === "warn" || storage.level === "full");
  if (install && missing && !urgent) {
    return (
      <Link href={`${SETTINGS_ROOT}/keys`} onClick={() => onNavigate?.()} className={card}>
        <span className="block text-xs font-medium text-ink">{t("{name} key needed", { name: missing })}</span>
        <span className="mt-0.5 block text-xs text-muted">{canManage(install) ? t("Add it to start reading competitors' ads.") : install.owned ? t("Ask the owner to add it in Settings.") : t("It is set on the server for this workspace.")}</span>
      </Link>
    );
  }
  if (storage && notice80) {
    return (
      <Link href={`${SETTINGS_ROOT}/storage`} onClick={() => onNavigate?.()} className={card}>
        <span className={cx("block text-xs font-medium", storage.level === "notice" ? "text-ink" : "text-warn")}>{storage.level === "full" ? t("Storage is full") : storage.level === "warn" ? t("Storage is almost full") : t("Storage {percent} full", { percent: percent(storage.ratio) })}</span>
        <span className="mt-0.5 block text-xs text-muted">{storage.level === "notice" ? t("Free up space before it fills.") : t("Free up space to keep saving ads and creatives.")}</span>
      </Link>
    );
  }
  if (attention > 0) {
    return (
      <Link href={ANALYSES_HREF} onClick={go(ANALYSES_HREF)} className={card}>
        <span className="block text-xs font-medium text-ink">{tn(attention, "{n} analysis needs you", "{n} analyses need you")}</span>
        <span className="mt-0.5 block text-xs text-muted">{t("Open All analyses to review.")}</span>
      </Link>
    );
  }
  return null;
}

// MARK: The workspace button and its menu

function signOut() {
  const form = document.createElement("form");
  form.method = "post";
  form.action = "/auth/signout";
  document.body.append(form);
  form.submit();
}

const THEME_ICONS = { light: <IconSun />, dark: <IconMoon />, system: <IconMonitor /> };

function WorkspaceMenu({ name, email, local }: Who) {
  const { t, locale } = useT();
  const { install, loading } = useInstall();
  const theme = useTheme();
  const { label: workspace } = useWorkspaceLabel();
  const role = roleLabel(install?.role) ? t(roleLabel(install?.role)!) : null;
  const themeLabel = { light: t("Light"), dark: t("Dark"), system: t("Match the device") };
  return (
    <Menu label={t("Workspace")} width={252} trigger={(trigger) => (
      <button {...trigger} className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control px-1 text-left transition-colors hover:bg-hover aria-expanded:bg-hover">
        {/* The name is unknown while the install loads: its place is kept, so the product's name never flashes first. */}
        <InstallMark name={workspace} className={cx("size-6 rounded-[6px] text-xs", loading && "invisible")} />
        <span className={cx("min-w-0 truncate text-sm font-[550] tracking-[-0.1px]", loading && "invisible")}>{workspace}</span>
        <IconChevronDown className="size-3 shrink-0 text-faint" />
      </button>
    )}>
      {(name || email) && (
        <>
          <div className="flex items-center gap-2 px-2 pt-1.5 pb-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{name?.trim() || email}</span>
              {name?.trim() && email && <span className="block truncate text-xs text-muted">{email}</span>}
            </span>
            {role && <Badge>{role}</Badge>}
          </div>
          <MenuSeparator />
        </>
      )}
      <MenuItem icon={<IconGrid />} href={ALL_APPS_HREF} kbd={<><Kbd>G</Kbd>{t("then")}<Kbd>A</Kbd></>}>{t("All apps")}</MenuItem>
      <MenuItem icon={<IconSettings />} href={SETTINGS_ROOT} kbd={<><Kbd>G</Kbd>{t("then")}<Kbd>S</Kbd></>}>{t("Settings")}</MenuItem>
      <MenuSub icon={theme ? THEME_ICONS[theme] : <IconSun />} label={t("Appearance")}>
        {THEME_OPTIONS.map((option) => (
          <MenuItem key={option.value} icon={THEME_ICONS[option.value]} checked={theme === option.value} keepOpen onSelect={() => applyTheme(option.value)}>{themeLabel[option.value]}</MenuItem>
        ))}
      </MenuSub>
      <MenuSub icon={<IconCompass />} label={t("Language")}>
        {LOCALES.map((code) => (
          <MenuItem key={code} checked={code === locale} onSelect={() => { if (code !== locale) void saveLocale(code); }}><span lang={code}>{LOCALE_NAMES[code]}</span></MenuItem>
        ))}
      </MenuSub>
      {!local && (
        <>
          <MenuSeparator />
          <MenuItem icon={<IconLogout />} onSelect={signOut}>{t("Sign out")}</MenuItem>
        </>
      )}
    </Menu>
  );
}

/** Saves the language to the account (so it follows the person), then switches the page to it (the cookie renders it). */
export async function saveLocale(code: (typeof LOCALES)[number]) {
  await fetch("/api/account/locale", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: code }) }).catch(() => null);
  setLocale(code);
}

// MARK: Keys that work anywhere in the app

/** G then a key goes to a page (lib/nav-model.ts SHORTCUTS); ⌘K is the command menu's own, ? the Help panel's. Mounted once, by the app shell. */
export function NavKeys() {
  const router = useRouter();
  const path = useAppPath();
  const { id } = useWorkspaces();
  const appId = useRef(id);
  useEffect(() => { appId.current = id; }, [id]);
  useEffect(() => { rememberAppPath(path); }, [path]);
  useEffect(() => {
    let armedAt = 0;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest('[role="menu"], [role="dialog"], [role="alertdialog"]'))) return;
      const key = event.key.toLowerCase();
      if (key === "g") { armedAt = Date.now(); return; }
      const armed = Date.now() - armedAt < 1200;
      armedAt = 0;
      if (!armed) return;
      const shortcut = SHORTCUTS.find((s) => s.key === key);
      if (!shortcut) return;
      event.preventDefault();
      router.push(shortcutHref(shortcut.to, appId.current));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  return null;
}
