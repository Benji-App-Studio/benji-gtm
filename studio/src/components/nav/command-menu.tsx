"use client";
// The command menu (⌘K, or the search button): type to jump to a page, an app, one of an app's pages,
// a settings page or an analysis, or to run a small action (new app, switch theme). ↑ ↓ move, Enter
// runs, Escape closes. Open it from anywhere with openCommandMenu().
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { preloadProject, useCached } from "@/lib/client-cache";
import { applyTheme } from "@/lib/theme";
import { WORKSPACE_MODULES, workspaceHref } from "@/lib/workspace-schema";
import { THEME_OPTIONS } from "../appearance";
import { IconChart, IconHome, IconLayers, IconMegaphone, IconMonitor, IconMoon, IconPlus, IconSearch, IconSettings, IconSun, IconUser } from "../icons";
import type { ProjectSummary } from "../project-list";
import { appSettingsHref, SETTINGS_PAGES } from "../settings/pages";
import { cx, Kbd } from "../ui";
import { useWorkspaces, WorkspaceMark } from "./workspaces";

// MARK: Open state, shared by the button, the shortcut and the menu itself

let isOpen = false;
const listeners = new Set<() => void>();
const setOpen = (next: boolean) => { if (isOpen === next) return; isOpen = next; listeners.forEach((listener) => listener()); };
export const openCommandMenu = () => setOpen(true);

type Command = { id: string; group: string; label: string; hint?: string; icon: ReactNode; keywords?: string; href?: string; run?: () => void; projectId?: string;
  /** Only found by typing: left out of the short list shown before a search. */
  deep?: boolean };

/** Mounted once by the app shell. Listens for ⌘K (Ctrl K) and draws the menu while it is open. */
export function CommandMenu() {
  const open = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => isOpen, () => false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(!isOpen); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return open ? <CommandDialog /> : null;
}

const THEME_ICONS = { light: <IconSun />, dark: <IconMoon />, system: <IconMonitor /> };
const THEME_COMMAND = { light: "Use the light theme", dark: "Use the dark theme", system: "Match the device's theme" };

function CommandDialog() {
  const router = useRouter();
  const { products } = useWorkspaces();
  const [projectList] = useCached<ProjectSummary[]>("/api/projects");
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // Focus goes back to where it was when the menu closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => { previous?.focus?.(); };
  }, []);

  const commands = useMemo<Command[]>(() => {
    const apps = products ?? [];
    const modules = WORKSPACE_MODULES.filter((m) => !m.hidden);
    const projects = Array.isArray(projectList) ? projectList : [];
    return [
      { id: "home", group: "Go to", label: "Home", icon: <IconHome />, href: "/app" },
      { id: "accounts", group: "Go to", label: "Accounts", icon: <IconUser />, href: "/app/accounts" },
      { id: "campaigns", group: "Go to", label: "Campaigns", icon: <IconMegaphone />, href: "/app/campaigns" },
      { id: "new-analysis", group: "Go to", label: "New analysis", icon: <IconPlus />, href: "/app/new", keywords: "create start competitor" },
      ...apps.map((app) => ({ id: `app-${app.id}`, group: "Apps", label: app.name, hint: "Home", icon: <WorkspaceMark name={app.name} />, href: workspaceHref(app.id), keywords: "app" })),
      ...apps.flatMap((app) => modules.map((m) => ({ id: `app-${app.id}-${m.key}`, group: "Apps", label: m.label, hint: app.name, icon: <WorkspaceMark name={app.name} />, href: workspaceHref(app.id, m.key), keywords: app.name, deep: true }))),
      ...SETTINGS_PAGES.map((page) => ({ id: `settings-${page.key}`, group: "Settings", label: page.label, hint: "Settings", icon: <IconSettings />, href: page.href, keywords: "settings preferences" })),
      ...apps.map((app) => ({ id: `settings-app-${app.id}`, group: "Settings", label: `${app.name} connections`, hint: "Settings", icon: <IconSettings />, href: appSettingsHref(app.id), keywords: "settings meta revenuecat appstack storage delete", deep: true })),
      { id: "new-app", group: "Actions", label: "New app", icon: <IconLayers />, href: "/app/product/new", keywords: "create add product" },
      ...THEME_OPTIONS.map((option) => ({ id: `theme-${option.value}`, group: "Actions", label: THEME_COMMAND[option.value], icon: THEME_ICONS[option.value], run: () => applyTheme(option.value), keywords: "appearance theme mode" })),
      ...projects.map((p) => ({ id: `analysis-${p.id}`, group: "Analyses", label: p.name, icon: <IconChart />, href: `/app/p/${p.id}`, projectId: p.id, keywords: "analysis report", deep: true })),
    ];
  }, [products, projectList]);

  // Nothing typed: the short list. Typing searches everything (each word must appear in the label or its keywords).
  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return commands.filter((c) => !c.deep);
    return commands.filter((c) => { const text = `${c.label} ${c.hint ?? ""} ${c.keywords ?? ""} ${c.group}`.toLowerCase(); return words.every((w) => text.includes(w)); }).slice(0, 40);
  }, [commands, query]);
  const active = Math.min(index, Math.max(0, results.length - 1));

  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [active, results]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    setOpen(false);
    if (command.projectId) preloadProject(command.projectId);
    if (command.run) command.run();
    else if (command.href) router.push(command.href);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-scrim/25 px-3 pt-[12vh] max-sm:pt-3" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-label="Search and commands" className="page-in flex max-h-[min(460px,calc(100dvh-24px))] w-full max-w-[560px] flex-col overflow-hidden rounded-dialog border border-hairline bg-raised shadow-pop">
        <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-3.5">
          <IconSearch className="size-4 shrink-0 text-muted" />
          <input autoFocus value={query} placeholder="Search pages, apps and analyses" role="combobox" aria-expanded aria-controls={`${id}-list`} aria-autocomplete="list"
            aria-activedescendant={results[active] ? `${id}-${results[active].id}` : undefined}
            onChange={(event) => { setQuery(event.target.value); setIndex(0); }}
            onKeyDown={(event) => {
              const last = results.length - 1;
              if (event.key === "ArrowDown") { event.preventDefault(); setIndex(active >= last ? 0 : active + 1); }
              else if (event.key === "ArrowUp") { event.preventDefault(); setIndex(active <= 0 ? last : active - 1); }
              else if (event.key === "Home" && !query) { event.preventDefault(); setIndex(0); }
              else if (event.key === "End" && !query) { event.preventDefault(); setIndex(last); }
              else if (event.key === "Enter") { event.preventDefault(); run(results[active]); }
              else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); }
              else if (event.key === "Tab") event.preventDefault();
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-faint" />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} id={`${id}-list`} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>}
          {results.map((command, i) => (
            <div key={command.id}>
              {(i === 0 || results[i - 1].group !== command.group) && <p className={cx("px-2 pb-1 text-xs text-faint", i === 0 ? "pt-1" : "pt-2.5")}>{command.group}</p>}
              <div id={`${id}-${command.id}`} role="option" aria-selected={i === active} onMouseMove={() => { if (i !== active) setIndex(i); }} onMouseDown={(event) => event.preventDefault()} onClick={() => run(command)}
                className={cx("flex h-9 cursor-default items-center gap-2.5 rounded-md px-2 text-sm", i === active ? "bg-active text-ink" : "text-label")}>
                <span className="grid size-[18px] shrink-0 place-items-center text-muted [&>svg]:size-4">{command.icon}</span>
                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                {command.hint && <span className="shrink-0 truncate text-xs text-faint">{command.hint}</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="flex h-8 shrink-0 items-center gap-3 border-t border-line px-3 text-xs text-faint max-sm:hidden">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd>to move</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd>to open</span>
        </div>
      </div>
    </div>
  );
}
