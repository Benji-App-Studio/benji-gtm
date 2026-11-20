"use client";
// The command menu (⌘K, or the search button): type to jump to an app, one of its pages or tabs, a
// settings page or an analysis, or to run a small action (new app, switch theme, help). ↑ ↓ move, Enter
// runs, Escape closes. Open it from anywhere with openCommandMenu(). It follows the sidebar's structure
// (lib/nav-model.ts) and still answers to the old page names (Market, Playground, Brand, Accounts…),
// in English whatever the language.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { preloadProject, useCached } from "@/lib/client-cache";
import { useT } from "@/lib/i18n/client";
import { useInstall } from "@/lib/install/use-install";
import {
  ALL_APPS_HREF, ANALYSES_HREF, APP_SECTIONS, APP_SETTINGS_TABS, appHref, appSettingsHref, commandMatches, destinationKeywords, guideHref, NEW_APP_HREF,
  newAnalysisHref, RESEARCH_TABS, researchHref, STUDIO_TABS, studioHref,
} from "@/lib/nav-model";
import { applyTheme } from "@/lib/theme";
import { THEME_OPTIONS } from "../appearance";
import { useLayer } from "../layers";
import { IconChart, IconGrid, IconHelp, IconLayers, IconMonitor, IconMoon, IconPlus, IconSearch, IconSettings, IconSparkles, IconSun } from "../icons";
import type { ProjectSummary } from "../project-list";
import { visibleSettingsPages } from "../settings/pages";
import { useSettingsLabels } from "../settings/settings-nav";
import { cx, Kbd } from "../ui";
import { openHelp } from "./help-panel";
import { useNavLabels } from "./nav-labels";
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

function CommandDialog() {
  const { t, locale } = useT();
  const kw = useCallback((key: string) => destinationKeywords(key, locale), [locale]);
  const router = useRouter();
  const labels = useNavLabels();
  const settingsLabels = useSettingsLabels();
  const { products, id: currentId } = useWorkspaces();
  const { install } = useInstall();
  const [projectList] = useCached<ProjectSummary[]>("/api/projects");
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // A layer: Escape closes only this, and focus goes back to where it was when the menu closes.
  const boxRef = useRef<HTMLDivElement>(null);
  useLayer(boxRef, { onEscape: () => setOpen(false) });

  const commands = useMemo<Command[]>(() => {
    const apps = products ?? [];
    // The app being worked on comes first, so its pages are the short list's.
    const ordered = [...apps].sort((a, b) => Number(b.id === currentId) - Number(a.id === currentId));
    const projects = Array.isArray(projectList) ? projectList : [];
    const themeCommand = { light: t("Use the light theme"), dark: t("Use the dark theme"), system: t("Match the device's theme") };
    const goTo = t("Go to");
    const appCommands = ordered.flatMap((app, i) => {
      const mark = <WorkspaceMark name={app.name} />;
      const group = apps.length > 1 ? app.name : goTo;
      // Only the current app's main pages show before a search; everything else is found by typing.
      const deep = i > 0;
      return [
        ...APP_SECTIONS.map((section) => ({ id: `${app.id}-${section}`, group, label: labels.section[section], icon: mark, href: appHref(app.id, section), keywords: `${app.name} ${kw(section)}`, deep })),
        ...RESEARCH_TABS.map((tab) => ({ id: `${app.id}-research-${tab}`, group, label: labels.research[tab], hint: `${labels.section.research}`, icon: mark, href: researchHref(app.id, tab), keywords: `${app.name} ${kw(`research:${tab}`)}`, deep: true })),
        ...STUDIO_TABS.map((tab) => ({ id: `${app.id}-studio-${tab}`, group, label: labels.studio[tab], hint: `${labels.section.studio}`, icon: mark, href: studioHref(app.id, tab), keywords: `${app.name} ${kw(`studio:${tab}`)}`, deep: true })),
        { id: `${app.id}-launch-ads`, group, label: t("Ads and results"), hint: `${labels.section.launch}`, icon: mark, href: `${appHref(app.id, "launch")}/ads`, keywords: `${app.name} ${kw("launch:ads")}`, deep: true },
        ...APP_SETTINGS_TABS.map((tab) => ({ id: `${app.id}-settings-${tab}`, group, label: labels.appSettings[tab], hint: `${labels.section.settings}`, icon: mark, href: appSettingsHref(app.id, tab), keywords: `${app.name} ${kw(`settings:${tab}`)}`, deep: true })),
      ];
    });
    return [
      ...appCommands,
      { id: "all-apps", group: goTo, label: labels.allApps, icon: <IconGrid />, href: ALL_APPS_HREF, keywords: kw("all-apps") },
      { id: "analyses", group: goTo, label: labels.analyses, icon: <IconChart />, href: ANALYSES_HREF, keywords: kw("analyses") },
      ...visibleSettingsPages(install).map((page) => ({ id: `settings-${page.key}`, group: t("Settings"), label: settingsLabels.page[page.key], hint: t("Settings"), icon: <IconSettings />, href: page.href,
        // The old names too: "API keys" is Your keys now, "General" holds the plan.
        keywords: `settings preferences ${page.label} ${page.key === "keys" ? "api keys tokens" : page.key === "general" ? "general plan usage billing" : page.key === "language" ? "language locale translate" : ""}`, deep: true })),
      { id: "new-app", group: t("Actions"), label: t("New app"), icon: <IconLayers />, href: NEW_APP_HREF, keywords: kw("new-app") },
      { id: "new-analysis", group: t("Actions"), label: t("New analysis of social posts"), icon: <IconPlus />, href: newAnalysisHref(currentId), keywords: kw("new-analysis"), deep: true },
      { id: "guide", group: t("Actions"), label: t("Get started"), icon: <IconSparkles />, href: guideHref(currentId), keywords: kw("guide"), deep: true },
      { id: "help", group: t("Actions"), label: t("Help"), icon: <IconHelp />, run: openHelp, keywords: kw("help"), deep: true },
      ...THEME_OPTIONS.map((option) => ({ id: `theme-${option.value}`, group: t("Actions"), label: themeCommand[option.value], icon: THEME_ICONS[option.value], run: () => applyTheme(option.value), keywords: "appearance theme mode", deep: true })),
      ...projects.map((p) => ({ id: `analysis-${p.id}`, group: t("Analyses"), label: p.name, icon: <IconChart />, href: `/app/p/${p.id}`, projectId: p.id, keywords: "analysis report social posts", deep: true })),
    ];
  }, [products, currentId, projectList, install, labels, settingsLabels, t, kw]);

  // Nothing typed: the short list. Typing searches everything (each word must appear in the label, hint or keywords).
  const results = useMemo(() => {
    if (!query.trim()) return commands.filter((c) => !c.deep);
    return commands.filter((c) => commandMatches(c, query)).slice(0, 40);
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
      <div ref={boxRef} role="dialog" aria-modal="true" aria-label={t("Search and commands")} className="page-in flex max-h-[min(460px,calc(100dvh-24px))] w-full max-w-[560px] flex-col overflow-hidden rounded-dialog border border-hairline bg-raised shadow-pop">
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
          <IconSearch className="size-3.5 shrink-0 text-muted" />
          <input autoFocus value={query} aria-label={t("Search pages, apps and analyses")} placeholder={t("Search pages, apps and analyses")} role="combobox" aria-expanded aria-controls={`${id}-list`} aria-autocomplete="list"
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
            className="h-full min-w-0 flex-1 bg-transparent text-lg text-ink outline-none placeholder:text-faint" />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} id={`${id}-list`} role="listbox" aria-label={t("Results")} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted">{t("Nothing matches “{query}”.", { query: query.trim() })}</p>}
          {results.map((command, i) => (
            <div key={command.id}>
              {(i === 0 || results[i - 1].group !== command.group) && <p className={cx("truncate px-2 pb-1 text-xs text-muted", i === 0 ? "pt-1" : "pt-2.5")}>{command.group}</p>}
              <div id={`${id}-${command.id}`} role="option" aria-selected={i === active} onMouseMove={() => { if (i !== active) setIndex(i); }} onMouseDown={(event) => event.preventDefault()} onClick={() => run(command)}
                className={cx("flex h-9 cursor-default items-center gap-2.5 rounded-control px-2 text-sm", i === active ? "bg-active text-ink" : "text-label")}>
                <span className="grid size-[18px] shrink-0 place-items-center text-muted [&>svg]:size-3.5">{command.icon}</span>
                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                {command.hint && <span className="max-w-[45%] min-w-0 truncate text-xs text-faint">{command.hint}</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="flex h-8 shrink-0 items-center gap-3 border-t border-line px-3 text-xs text-faint max-sm:hidden">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd>{t("to move")}</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd>{t("to open")}</span>
        </div>
      </div>
    </div>
  );
}
