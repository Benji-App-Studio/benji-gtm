"use client";
// The app's sidebar. At the top: the workspace button (its menu holds Settings, Appearance and Sign
// out), search and "new". Then the top-level links, then "Your apps": each app is a row that opens to
// show its pages. In Settings the same column shows the settings pages instead. Wide screens show it
// beside the page; below lg there is a top bar and the same content in a drawer.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { APP_NAME, STORAGE_PREFIX } from "@/lib/brand-config";
import { preload } from "@/lib/client-cache";
import { featureState } from "@/lib/capabilities";
import { canManage, roleLabel, useInstall } from "@/lib/install/use-install";
import { applyTheme } from "@/lib/theme";
import { WORKSPACE_MODULES, workspaceHref, type WorkspaceModule } from "@/lib/workspace-schema";
import { noticeText, percent } from "@/lib/storage-usage";
import { useStorage } from "@/lib/use-storage";
import { THEME_OPTIONS, useTheme } from "../appearance";
import { notice } from "../dialog";
import {
  IconChart, IconChevronDown, IconChevronRight, IconCompass, IconCompose, IconHelp, IconHome, IconLayers, IconLogout, IconMegaphone, IconMenu,
  IconMonitor, IconMoon, IconPlug, IconPlus, IconRocket, IconSearch, IconSettings, IconSparkles, IconSun, IconTarget, IconTrendUp, IconUser, IconWand, IconX,
} from "../icons";
import { goInstant } from "../instant";
import { useLayer } from "../layers";
import { useProjects } from "../project-list";
import { SettingsNav } from "../settings/settings-nav";
import { Badge, cx, Gear, Kbd, Menu, MenuItem, MenuSeparator, MenuSub } from "../ui";
import { openCommandMenu } from "./command-menu";
import { inSettings, rememberAppPath, SETTINGS_ROOT, useAppPath } from "./path";
import { navRowClass, navSectionClass } from "./rows";
import { IN_WORKSPACE, InstallMark, rememberWorkspace, useWorkspaces, WorkspaceMark } from "./workspaces";

type NavLink = { href: string; label: string; icon: ReactNode; exact?: boolean; type?: "account" | "campaign" };

/** Each app page's icon; the order and labels come from WORKSPACE_MODULES. */
const MODULE_ICONS: Record<WorkspaceModule, ReactNode> = {
  brand: <IconTarget />,
  research: <IconCompass />,
  market: <IconTrendUp />,
  formats: <IconLayers />,
  studio: <IconSparkles />,
  playground: <IconWand />,
  launch: <IconRocket />,
  measure: <IconChart />,
  settings: <IconPlug />,
};

/** The top-level links: Home, then the analyses that are not tied to one app. */
export const TOP_LINKS: NavLink[] = [
  { href: "/app", label: "Home", icon: <IconHome />, exact: true },
  { href: "/app/accounts", label: "Accounts", icon: <IconUser />, type: "account" },
  { href: "/app/campaigns", label: "Campaigns", icon: <IconMegaphone />, type: "campaign" },
  { href: "/app/new", label: "New analysis", icon: <IconPlus /> },
];

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
  const [open, setOpen] = useState(false);
  const path = useAppPath();
  const { install, loading } = useInstall();
  const [openedOn, setOpenedOn] = useState(path);
  if (open && openedOn !== path) setOpen(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  // A layer while open: Tab stays in the drawer, Escape closes it, and closing puts the keyboard back on
  // the menu button (unless focus already moved on).
  useLayer(drawerRef, { enabled: open, onEscape: () => setOpen(false), initialFocus: closeRef });
  const workspace = install?.name?.trim() || APP_NAME;
  const settings = inSettings(path);
  // While the install loads the name isn't known yet: keep its place instead of flashing the product's name.
  const pending = loading && !settings;
  return (
    <>
      <header className="sticky top-0 z-30 flex h-11 items-center gap-1 border-b border-line bg-shell/95 px-2 backdrop-blur lg:hidden">
        <button type="button" onClick={() => { setOpenedOn(path); setOpen(true); }} aria-label="Open menu" aria-expanded={open} className="grid size-8 shrink-0 place-items-center rounded-control text-label hover:bg-hover"><IconMenu className="size-[18px]" /></button>
        <Link href={settings ? SETTINGS_ROOT : "/app"} className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control px-1.5">
          <InstallMark name={workspace} className={cx(pending && "invisible")} />
          <span className={cx("truncate text-sm font-medium", pending && "invisible")}>{settings ? "Settings" : workspace}</span>
        </Link>
        <button type="button" onClick={openCommandMenu} aria-label="Search" className="grid size-8 shrink-0 place-items-center rounded-control text-label hover:bg-hover"><IconSearch className="size-[18px]" /></button>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="page-in absolute inset-0 bg-scrim/30" onClick={() => setOpen(false)} />
          <div ref={drawerRef} role="dialog" aria-modal="true" aria-label="Menu" className="absolute inset-y-0 left-0 flex w-[min(288px,86vw)] flex-col border-r border-hairline bg-sidebar shadow-pop">
            <NavBody name={name} email={email} local={local} onNavigate={() => setOpen(false)}
              close={<button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="grid size-8 shrink-0 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink"><IconX className="size-4" /></button>} />
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
  const path = useAppPath();
  const { products } = useWorkspaces();
  const projects = useProjects();
  const busy = new Set((projects ?? []).filter((p) => p.status === "discovering" || p.status === "analyzing").map((p) => p.type));
  const attention = (projects ?? []).filter((p) => p.status === "review" || p.status === "error").length;
  // The clicked link lights up straight away, before the next page has loaded.
  const [clicked, setClicked] = useState<{ href: string; from: string } | null>(null);
  const at = clicked && clicked.from === path ? clicked.href : path;
  const urlApp = at.match(IN_WORKSPACE)?.[1] ?? null;
  const [appsOpen, setAppsOpen] = useStoredFlag("nav.apps", true);
  // Apps the person opened or closed by hand; otherwise the app in the URL is open (and a lone app always is).
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const appsId = useId();
  const warm = () => { preload("/api/projects"); preload("/api/products"); };

  const isActive = (link: NavLink) => (link.exact ? at === link.href : at === link.href || at.startsWith(`${link.href}/`));
  const go = (href: string) => (event: React.MouseEvent<HTMLAnchorElement>) => { setClicked({ href, from: path }); goInstant(event, href); onNavigate?.(); };

  const row = (link: NavLink, extra?: ReactNode) => {
    const active = isActive(link);
    return (
      <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined} onClick={go(link.href)} onMouseEnter={warm} onFocus={warm} className={navRowClass(active)}>
        {link.icon}<span className="min-w-0 flex-1 truncate">{link.label}</span>
        {link.type && busy.has(link.type) && <span title="An analysis is running"><Gear className="size-3.5 text-muted" /></span>}
        {extra}
      </Link>
    );
  };

  const modules = WORKSPACE_MODULES.filter((m) => !m.hidden);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The workspace, search and new */}
      <div className="flex shrink-0 items-center gap-1 px-3 pt-2.5 pb-3">
        <WorkspaceMenu name={name} email={email} local={local} />
        <button type="button" onClick={openCommandMenu} aria-label="Search" title="Search (⌘K)" className="grid size-7 shrink-0 place-items-center rounded-full text-nav transition-colors hover:bg-hover hover:text-ink max-lg:size-8"><IconSearch className="size-3.5" /></button>
        <Menu label="New" align="end" width={200} trigger={(trigger) => (
          <button {...trigger} aria-label="New" title="New" className="grid size-7 shrink-0 place-items-center rounded-full border border-hairline bg-raised text-label transition-colors hover:bg-hover hover:text-ink aria-expanded:bg-hover aria-expanded:text-ink max-lg:size-8"><IconCompose className="size-3.5" /></button>
        )}>
          <MenuItem icon={<IconPlus />} href="/app/new" onSelect={onNavigate}>New analysis</MenuItem>
          <MenuItem icon={<IconLayers />} href="/app/product/new" onSelect={onNavigate}>New app</MenuItem>
        </Menu>
        {close}
      </div>

      {/* The links scroll on short windows; the row above and the footer stay put. */}
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 pb-3">
        <nav aria-label="Main" className="flex flex-col">{TOP_LINKS.map((link) => row(link))}</nav>

        <div className="mt-4">
          <button type="button" onClick={() => setAppsOpen(!appsOpen)} aria-expanded={appsOpen} aria-controls={appsId} className={cx(navSectionClass, "transition-colors hover:bg-hover hover:text-label")}>
            Your apps<IconChevronDown className={cx("size-3 transition-transform motion-reduce:transition-none", !appsOpen && "-rotate-90")} />
          </button>
          {appsOpen && (
            <nav id={appsId} aria-label="Your apps" className="flex flex-col">
              {(products ?? []).map((product) => {
                const open = toggled[product.id] ?? (product.id === urlApp || products?.length === 1);
                const home = workspaceHref(product.id);
                const listId = `${appsId}-${product.id}`;
                return (
                  <div key={product.id}>
                    <div className="group/app relative flex items-center">
                      <Link href={home} onClick={(event) => { setToggled((t) => ({ ...t, [product.id]: true })); rememberWorkspace(product.id); go(home)(event); }}
                        className={cx(navRowClass(false), "pr-8")}>
                        <WorkspaceMark name={product.name} /><span className="min-w-0 truncate">{product.name}</span>
                      </Link>
                      <button type="button" onClick={() => setToggled((t) => ({ ...t, [product.id]: !open }))} aria-expanded={open} aria-controls={listId} aria-label={`${open ? "Hide" : "Show"} ${product.name}'s pages`}
                        className="absolute right-0.5 grid size-6 place-items-center rounded-control text-faint transition-colors hover:bg-hover hover:text-ink max-lg:size-8">
                        <IconChevronRight className={cx("size-3 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
                      </button>
                    </div>
                    {open && (
                      <div id={listId} className="mb-1 flex flex-col pl-4">
                        {row({ href: home, label: "Home", icon: <IconHome />, exact: true })}
                        {modules.map((m) => row({ href: workspaceHref(product.id, m.key), label: m.label, icon: MODULE_ICONS[m.key] }))}
                      </div>
                    )}
                  </div>
                );
              })}
              <Link href="/app/product/new" onClick={() => onNavigate?.()} className={navRowClass(at === "/app/product/new")}><IconPlus />New app</Link>
            </nav>
          )}
        </div>

        {/* Footer: what needs doing, then Help */}
        <div className="mt-auto flex flex-col gap-1.5 pt-6">
          <NextStep attention={attention} onNavigate={onNavigate} go={go} />
          <button type="button" onClick={() => { onNavigate?.(); void notice(<HelpText />, "Getting around"); }} className={navRowClass(false)}><IconHelp />Help</button>
        </div>
      </div>
    </div>
  );
}

/** The quiet card at the bottom of the sidebar: the one thing worth doing next, when there is one. */
function NextStep({ attention, onNavigate, go }: { attention: number; onNavigate?: () => void; go: (href: string) => (event: React.MouseEvent<HTMLAnchorElement>) => void }) {
  const { install } = useInstall();
  // The one key nothing reads without: the AI's, for whichever provider Settings chose.
  const ai = featureState("ai", install);
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
        <span className="block text-xs font-medium text-ink">{missing} key needed</span>
        <span className="mt-0.5 block text-xs text-muted">{canManage(install) ? "Add it to start analysing competitors." : install.owned ? "Ask the owner to add it in Settings." : "It is set on the server for this install."}</span>
      </Link>
    );
  }
  if (storage && notice80) {
    return (
      <Link href={`${SETTINGS_ROOT}/storage`} onClick={() => onNavigate?.()} className={card}>
        <span className={cx("block text-xs font-medium", storage.level === "notice" ? "text-ink" : "text-warn")}>{storage.level === "full" ? "Storage is full" : storage.level === "warn" ? "Storage is almost full" : `Storage ${percent(storage.ratio)} full`}</span>
        <span className="mt-0.5 block text-xs text-muted">{storage.level === "notice" ? "Free up space before it fills." : "Free up space to keep saving ads and creatives."}</span>
      </Link>
    );
  }
  if (attention > 0) {
    return (
      <Link href="/app" onClick={go("/app")} className={card}>
        <span className="block text-xs font-medium text-ink">{attention === 1 ? "1 analysis needs you" : `${attention} analyses need you`}</span>
        <span className="mt-0.5 block text-xs text-muted">Open Home to review {attention === 1 ? "it" : "them"}.</span>
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
  const { install, loading } = useInstall();
  const theme = useTheme();
  const workspace = install?.name?.trim() || APP_NAME;
  const role = roleLabel(install?.role);
  return (
    <Menu label="Workspace" width={252} trigger={(trigger) => (
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
      <MenuItem icon={<IconSettings />} href={SETTINGS_ROOT} kbd={<><Kbd>G</Kbd>then<Kbd>S</Kbd></>}>Settings</MenuItem>
      <MenuSub icon={theme ? THEME_ICONS[theme] : <IconSun />} label="Appearance">
        {THEME_OPTIONS.map((option) => (
          <MenuItem key={option.value} icon={THEME_ICONS[option.value]} checked={theme === option.value} keepOpen onSelect={() => applyTheme(option.value)}>{option.label}</MenuItem>
        ))}
      </MenuSub>
      {!local && (
        <>
          <MenuSeparator />
          <MenuItem icon={<IconLogout />} onSelect={signOut}>Sign out</MenuItem>
        </>
      )}
    </Menu>
  );
}

// MARK: Keys that work anywhere in the app

/** G then S opens Settings, G then H goes Home. (⌘K is the command menu's own.) Mounted once, by the app shell. */
export function NavKeys() {
  const router = useRouter();
  const path = useAppPath();
  useEffect(() => { rememberAppPath(path); }, [path]);
  useEffect(() => {
    let armedAt = 0;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest('[role="menu"], [role="dialog"], [role="alertdialog"]'))) return;
      const key = event.key.toLowerCase();
      if (key === "g") { armedAt = Date.now(); return; }
      const armed = Date.now() - armedAt < 1200;
      armedAt = 0;
      if (!armed) return;
      if (key === "s") { event.preventDefault(); router.push(SETTINGS_ROOT); }
      if (key === "h") { event.preventDefault(); router.push("/app"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  return null;
}

function HelpText() {
  const strong = "font-medium text-ink";
  return (
    <div className="grid gap-2.5 text-sm text-label">
      <p><b className={strong}>Home</b> lists every analysis and what is waiting for you. <b className={strong}>Accounts</b> and <b className={strong}>Campaigns</b> hold the analyses of one account or one brand campaign.</p>
      <p><b className={strong}>Your apps</b> holds one entry per app. Open one to reach its pages: <b className={strong}>Brand</b> is what every creative follows; <b className={strong}>Research</b> finds what works for competitors; <b className={strong}>Studio</b> and <b className={strong}>Playground</b> make creatives from it; <b className={strong}>Launch</b> sends them to Meta as paused drafts; <b className={strong}>Measure</b> shows what they earn.</p>
      <p><b className={strong}>Settings</b> is in the menu under the workspace name: API keys, AI models, members and each app&apos;s connections.</p>
      <p className="flex flex-wrap items-center gap-1.5">Press <Kbd>⌘K</Kbd> to jump to any page, app or analysis, and <Kbd>G</Kbd> then <Kbd>S</Kbd> to open Settings.</p>
    </div>
  );
}
