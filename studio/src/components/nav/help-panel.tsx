"use client";
// The Help panel (the sidebar's Help, or ? on the keyboard): what each section does with a link to it,
// "Get started" (the app Home's guide, ?guide), the keyboard shortcuts, the step-by-step guides for each
// key, and how to reach us. A panel on the right, over the page; Escape or the scrim closes it.
import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { CONTACT_EMAIL, isRealContact, repoFileUrl } from "@/lib/brand-config";
import { useT } from "@/lib/i18n/client";
import { ALL_APPS_HREF, APP_SECTIONS, appHref, guideHref, KEY_GUIDES, SETTINGS_HREF, SHORTCUTS, type ShortcutTarget } from "@/lib/nav-model";
import { IconArrowRight, IconChart, IconCompass, IconExternal, IconGrid, IconHome, IconKey, IconRocket, IconSettings, IconSparkles, IconX } from "../icons";
import { useLayer } from "../layers";
import { Kbd } from "../ui";
import { useNavLabels } from "./nav-labels";
import { useWorkspaces } from "./workspaces";

// MARK: Open state, shared by the sidebar's button and the ? key

let isOpen = false;
const listeners = new Set<() => void>();
const setOpen = (next: boolean) => { if (isOpen === next) return; isOpen = next; listeners.forEach((listener) => listener()); };
export const openHelp = () => setOpen(true);

/** Contact shows only once the owner has set a real address (brand-config.ts): never the placeholder. */
const CONTACT_READY = isRealContact(CONTACT_EMAIL);

const SECTION_ICONS = { home: <IconHome />, research: <IconCompass />, studio: <IconSparkles />, launch: <IconRocket />, measure: <IconChart />, settings: <IconSettings /> };

/** Mounted once by the app shell. Draws the panel while it is open; ? (Shift /) opens it outside a field. */
export function HelpPanel() {
  const open = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => isOpen, () => false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]'))) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return open ? <Panel /> : null;
}

function Panel() {
  const { t } = useT();
  const labels = useNavLabels();
  const { id: appId, current } = useWorkspaces();
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useLayer(boxRef, { onEscape: () => setOpen(false), initialFocus: closeRef });
  const close = () => setOpen(false);
  const shortcutLabel: Record<ShortcutTarget, string> = {
    home: labels.section.home, research: labels.section.research, studio: labels.section.studio, launch: labels.section.launch,
    measure: labels.section.measure, "all-apps": labels.allApps, "workspace-settings": t("Settings"),
  };
  const heading = "mb-2 text-xs font-medium text-muted";
  const row = "-mx-2 flex min-h-9 items-center gap-2.5 rounded-control px-2 py-1.5 text-sm transition-colors hover:bg-hover";

  return (
    <div className="fixed inset-0 z-[65]">
      <div className="page-in absolute inset-0 bg-scrim/25" onClick={close} />
      <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby="help-title"
        className="absolute inset-y-0 right-0 flex w-[min(400px,100vw)] flex-col border-l border-hairline bg-raised shadow-pop">
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
          <h2 id="help-title" className="text-sm font-medium">{t("Help")}</h2>
          <button ref={closeRef} type="button" onClick={close} aria-label={t("Close help")} className="grid size-7 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink"><IconX className="size-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          <section className="mb-6">
            <Link href={guideHref(appId)} onClick={close} className="flex items-center gap-3 rounded-card border border-line bg-card px-3 py-3 transition-colors hover:bg-hover">
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent-soft text-accent [&_svg]:size-3.5"><IconSparkles /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{t("Get started")}</span>
                <span className="block text-xs text-muted">{current ? t("The steps to set up {name}, one at a time.", { name: current.name }) : t("The steps to set up your app, one at a time.")}</span>
              </span>
              <IconArrowRight className="size-3.5 shrink-0 text-faint" />
            </Link>
          </section>

          <section className="mb-6">
            <h3 className={heading}>{current ? t("What each page of {name} does", { name: current.name }) : t("What each page does")}</h3>
            <ul>
              {APP_SECTIONS.map((section) => (
                <li key={section}>
                  <Link href={appId ? appHref(appId, section) : "/app/w"} onClick={close} className={row}>
                    <span className="mt-0.5 shrink-0 self-start text-muted [&_svg]:size-3.5">{SECTION_ICONS[section]}</span>
                    <span className="min-w-0"><span className="block font-medium text-ink">{labels.section[section]}</span><span className="block text-xs text-muted">{labels.blurb[section]}</span></span>
                  </Link>
                </li>
              ))}
              <li>
                <Link href={ALL_APPS_HREF} onClick={close} className={row}>
                  <span className="mt-0.5 shrink-0 self-start text-muted [&_svg]:size-3.5"><IconGrid /></span>
                  <span className="min-w-0"><span className="block font-medium text-ink">{labels.allApps}</span><span className="block text-xs text-muted">{t("Every app at once, with its numbers and next step.")}</span></span>
                </Link>
              </li>
              <li>
                <Link href={SETTINGS_HREF} onClick={close} className={row}>
                  <span className="mt-0.5 shrink-0 self-start text-muted [&_svg]:size-3.5"><IconSettings /></span>
                  <span className="min-w-0"><span className="block font-medium text-ink">{t("Settings")}</span><span className="block text-xs text-muted">{t("Your keys, plan, storage, language and look, for the whole workspace.")}</span></span>
                </Link>
              </li>
            </ul>
          </section>

          <section className="mb-6">
            <h3 className={heading}>{t("Keyboard shortcuts")}</h3>
            <dl className="grid gap-1.5 text-sm">
              <Shortcut keys={<><Kbd>⌘</Kbd><Kbd>K</Kbd></>}>{t("Search pages, apps and analyses")}</Shortcut>
              <Shortcut keys={<Kbd>?</Kbd>}>{t("Open this help")}</Shortcut>
              {SHORTCUTS.map((s) => (
                <Shortcut key={s.key} keys={<><Kbd>G</Kbd><span className="text-xs text-faint">{t("then")}</span><Kbd>{s.key.toUpperCase()}</Kbd></>}>{shortcutLabel[s.to]}</Shortcut>
              ))}
            </dl>
          </section>

          <section className="mb-6">
            <h3 className={heading}>{t("Guides for each key")}</h3>
            <p className="mb-2 text-xs text-muted">{t("Step by step: where to find each key and ID, and what it costs. Add them under Settings › Your keys.")}</p>
            <ul className="grid grid-cols-2 gap-x-3">
              {KEY_GUIDES.map((guide) => (
                <li key={guide.file}>
                  <a href={repoFileUrl(guide.file)} target="_blank" rel="noreferrer" className="-mx-2 flex min-h-8 items-center gap-2 rounded-control px-2 text-sm text-label hover:bg-hover hover:text-ink">
                    <IconKey className="size-3.5 shrink-0 text-muted" /><span className="min-w-0 truncate">{guide.name}</span><IconExternal className="ml-auto size-3 shrink-0 text-faint" />
                  </a>
                </li>
              ))}
            </ul>
          </section>

          {CONTACT_READY && <section>
            <h3 className={heading}>{t("Contact")}</h3>
            <p className="text-sm text-label">{t("Stuck, or something looks wrong? Write to us and say what you were doing.")}</p>
            <a href={`mailto:${CONTACT_EMAIL.trim()}`} className="mt-1 inline-block rounded-xs text-sm font-medium text-accent hover:underline">{CONTACT_EMAIL.trim()}</a>
          </section>}
        </div>
      </div>
    </div>
  );
}

function Shortcut({ keys, children }: { keys: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="min-w-0 truncate text-label">{children}</dt>
      <dd className="flex shrink-0 items-center gap-1">{keys}</dd>
    </div>
  );
}
