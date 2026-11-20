"use client";
// The example app (/example): a made-up app with every module filled in (competitors' ads in Research,
// creatives in Studio, launched ads with results, Measure's unit economics, Market), drawn by the real
// page components on sample data (components/preview/sample*.ts) and answered in the browser, so it
// needs no keys and no app of your own. It is read-only: every write is refused before it leaves the
// browser and says so (lib/example-guard.ts), and links into the real app become the example's own pages.
// It is opened and left with full page loads, so nothing of it stays in memory in the real app.
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { EXAMPLE_APP_ID, exampleHref, exampleTab, type ExampleTab } from "@/lib/example-guard";
import type { AppSettingsTab } from "@/lib/nav-model";
import { ExampleContext } from "@/lib/example-mode";
import { useT } from "@/lib/i18n/client";
import { DialogHost, setExampleRefusal } from "../dialog";
import { IconArrowRight, IconX } from "../icons";
import { LaunchAdsView } from "../launch/ads-view";
import { LaunchView } from "../launch/launch-view";
import { MarketAppView } from "../market/market-app";
import { MarketView } from "../market/market-view";
import { AllApps } from "../all-apps";
import { AppSettingsView } from "../brand/brand-view";
import { SocialPosts } from "../social-posts";
import { PlaygroundView } from "../playground/playground-view";
import { MeasureView } from "../measure/measure-view";
import { PathOverride } from "../nav/path";
import { installSampleApi } from "../preview/sample";
import { WORLD } from "../preview/sample-world";
import { ResearchAds } from "../research-ads";
import { StudioView } from "../studio/studio-view";
import { cx } from "../ui";
import { WorkspaceOverview } from "../workspace/workspace-overview";

const ID = EXAMPLE_APP_ID;
const NAME = WORLD.name;
const never = () => () => {};
const BLOCKED_EVENT = "example-blocked";

export function ExampleApp({ view, signedIn, tab: settingsTab = "profile", template = null }: { view: string; signedIn: boolean; tab?: AppSettingsTab; template?: string | null }) {
  const { t } = useT();
  const router = useRouter();
  const [blocked, setBlocked] = useState(0);
  // Before any page asks for data: the sample answers, and a stand-in database address nothing can reach.
  useState(() => {
    if (typeof window === "undefined") return true;
    (window as unknown as { __INSTALL__?: unknown }).__INSTALL__ = { url: "https://example.invalid", key: "example", origin: null, imageTransforms: false };
    // No database and no Realtime in the example (lib/supabase/client.ts answers "nothing").
    (window as unknown as { __EXAMPLE_MODE__?: boolean }).__EXAMPLE_MODE__ = true;
    const refusal = t("This is an example: add your own app to do this.");
    // The sample app's own words (its profile, a store's category, an error) come in the reader's language.
    installSampleApi("owner", false, { blocked: refusal, onBlocked: () => window.dispatchEvent(new Event(BLOCKED_EVENT)), t });
    setExampleRefusal(refusal);
    leaveWithFullLoad();
    return true;
  });
  useEffect(() => {
    // Only a write someone asked for gets the note: pages also write on their own (reading new ads), refused quietly.
    let lastInput = 0;
    const onInput = () => { lastInput = Date.now(); };
    const onBlocked = () => { if (Date.now() - lastInput < 2500) setBlocked((n) => n + 1); };
    window.addEventListener("pointerdown", onInput, true);
    window.addEventListener("keydown", onInput, true);
    window.addEventListener(BLOCKED_EVENT, onBlocked);
    return () => {
      window.removeEventListener("pointerdown", onInput, true);
      window.removeEventListener("keydown", onInput, true);
      window.removeEventListener(BLOCKED_EVENT, onBlocked);
    };
  }, []);
  // The pages open live channels and read the window: drawn in the browser only.
  const inBrowser = useSyncExternalStore(never, () => true, () => false);

  // Links into the real app become the example's pages; anything else in the app is refused with the same note.
  function onClick(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const raw = anchor.getAttribute("href") ?? "";
    if (/^(mailto:|tel:|#)/.test(raw)) return;
    const to = exampleHref(raw, window.location.origin);
    if (to && /^https?:\/\//.test(to) && new URL(to).origin !== window.location.origin) return;
    event.preventDefault();
    event.stopPropagation();
    if (to) router.push(to);
    else setBlocked((n) => n + 1);
  }

  // The app's sections, as the sidebar has them (lib/nav-model.ts); each section's own tabs show on its pages.
  const tabs: { view: ExampleTab; label: string }[] = [
    { view: "", label: t("Home") }, { view: "research", label: t("Research") }, { view: "studio", label: t("Studio") },
    { view: "launch", label: t("Launch") }, { view: "measure", label: t("Measure") }, { view: "settings", label: t("App settings") },
  ];
  const at = exampleTab(view);
  const start = signedIn ? "/app" : "/signup";

  return (
    <ExampleContext.Provider value={true}>
      <div className="flex min-h-dvh flex-col bg-canvas">
        <div className="sticky top-0 z-30 border-b border-line bg-shell/95 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 sm:px-6">
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{t("Example")}</span>
            <p className="min-w-0 flex-[1_1_240px] text-xs text-muted">{t("A made-up app with everything filled in. Look around: nothing here is real, and nothing can be changed.")}</p>
            {/* Full page loads in and out: the example's sample answers never stay in the real app's memory. */}
            <a href={start} className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-control bg-accent-fill px-3 text-xs font-medium text-on-accent hover:bg-accent-fill/90">{t("Add your own app")}<IconArrowRight className="size-3.5" /></a>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-1.5 sm:px-5" aria-label={t("Example app pages")}>
            {tabs.map((tab) => (
              <a key={tab.view} href={`/example${tab.view ? `/${tab.view}` : ""}`} onClick={(e) => { e.preventDefault(); router.push(`/example${tab.view ? `/${tab.view}` : ""}`); }}
                aria-current={at === tab.view ? "page" : undefined}
                className={cx("shrink-0 rounded-control px-2.5 py-1 text-sm transition-colors", at === tab.view ? "bg-active font-medium text-ink" : "text-muted hover:bg-hover hover:text-ink")}>{tab.label}</a>
            ))}
          </nav>
        </div>
        <main id="main" className="min-w-0 flex-1" onClickCapture={onClick}>
          <div className="@container min-h-full">
            <PathOverride value={view === "apps" ? "/app/apps" : view ? `/app/w/${ID}/${view}` : `/app/w/${ID}`}>
              {inBrowser ? <Page view={view} settingsTab={settingsTab} template={template} /> : null}
            </PathOverride>
          </div>
        </main>
        <DialogHost />
        {blocked > 0 && <BlockedNote key={blocked} start={start} onClose={() => setBlocked(0)} />}
      </div>
    </ExampleContext.Provider>
  );
}

/**
 * A page that moves to an address outside /example by itself (a router.push after an action) leaves with a
 * full page load instead, so the real app never starts with the example's sample answers in place.
 */
function leaveWithFullLoad() {
  const flags = window as unknown as { __exampleHistory?: boolean };
  if (flags.__exampleHistory) return;
  flags.__exampleHistory = true;
  for (const name of ["pushState", "replaceState"] as const) {
    const original = window.history[name].bind(window.history);
    window.history[name] = (data: unknown, unused: string, url?: string | URL | null) => {
      if (url != null) {
        const target = new URL(String(url), window.location.href);
        if (target.origin === window.location.origin && !(target.pathname === "/example" || target.pathname.startsWith("/example/"))) {
          window.location.assign(target.href);
          return;
        }
      }
      original(data, unused, url);
    };
  }
}

/** The real page for each example view (the same components as the app's routes, lib/nav-model.ts). */
function Page({ view, settingsTab, template }: { view: string; settingsTab: AppSettingsTab; template: string | null }): ReactNode {
  if (view === "research") return <ResearchAds productId={ID} />;
  if (view === "research/app-store") return <MarketView productId={ID} />;
  if (view.startsWith("research/app-store/")) return <MarketAppView productId={ID} appId={view.slice("research/app-store/".length)} />;
  if (view === "research/social") return <SocialPosts productId={ID} />;
  if (view === "studio") return <StudioView productId={ID} />;
  if (view === "studio/remix") return <PlaygroundView key={`${ID}-remix`} productId={ID} />;
  if (view === "studio/templates") return <PlaygroundView key={`${ID}-templates`} productId={ID} openTemplate={template} library />;
  if (view === "launch") return <LaunchView productId={ID} />;
  if (view === "launch/ads") return <LaunchAdsView productId={ID} initialAd={null} />;
  if (view === "measure") return <MeasureView productId={ID} name={NAME} />;
  if (view === "settings") return <AppSettingsView key={settingsTab} productId={ID} tab={settingsTab} />;
  if (view === "apps") return <AllApps />;
  return <WorkspaceOverview id={ID} />;
}

/** What a click that would change something says, for a few seconds. */
function BlockedNote({ start, onClose }: { start: string; onClose: () => void }) {
  const { t } = useT();
  useEffect(() => {
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <div role="status" className="fixed inset-x-4 bottom-4 z-[70] mx-auto flex max-w-md items-center gap-3 rounded-inner border border-line bg-card px-3 py-2.5 text-sm shadow-raised">
      <p className="min-w-0 flex-1">{t("This is an example: add your own app to do this.")}</p>
      <a href={start} className="shrink-0 text-xs font-medium text-accent hover:underline">{t("Add your own app")}</a>
      <button type="button" onClick={onClose} aria-label={t("Close")} className="grid size-6 shrink-0 place-items-center rounded-full text-faint hover:bg-hover hover:text-ink"><IconX className="size-3.5" /></button>
    </div>
  );
}
