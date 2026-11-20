"use client";
// A small info box with one tip from the Meta ads playbook. Optional by design: it can be closed
// (remembered in this browser) and never blocks anything.
import { useEffect, useState } from "react";
import { TIPS, type TipId } from "@/lib/playbook";
import { IconSparkles, IconX } from "./icons";
import { cx } from "./ui";
import { readStored, storageKey } from "@/lib/storage-keys";
import { explainKey } from "@/lib/ui-state";
import { useClosedFlag } from "@/lib/use-ui-state";
import { useExample } from "@/lib/example-mode";
import { useT } from "@/lib/i18n/client";

const key = (id: string) => storageKey(`tip.${id}`);

export function PlaybookTip({ id, className, children }: { id: TipId; className?: string; children?: React.ReactNode }) {
  const { t } = useT();
  const tip = TIPS[id];
  // Hidden until after hydration, so a closed tip never flashes.
  const [shown, setShown] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const restore = async () => {
      try { setShown(readStored(localStorage, key(id)) !== "closed"); } catch { setShown(true); }
    };
    restore();
  }, [id]);
  if (!shown) return null;
  const close = () => {
    setShown(false);
    try { localStorage.setItem(key(id), "closed"); } catch { /* private mode */ }
  };
  return (
    <aside className={cx("relative flex gap-2.5 rounded-inner border border-accent/20 bg-accent-soft/60 py-2.5 pr-9 pl-3 text-xs leading-relaxed", className)} aria-label={t("Playbook tip: {title}", { title: t(tip.title) })}>
      <IconSparkles className="mt-px size-4 shrink-0 text-accent" />
      <div className="min-w-0">
        <p className="font-medium text-ink">{t(tip.title)} <span className="font-normal text-faint">· {t("playbook, {section}", { section: t(tip.section).toLowerCase() })}</span></p>
        <p className="mt-0.5 text-muted">{t(tip.body)}</p>
        {tip.more && more && <p className="mt-1 text-muted">{t(tip.more)}</p>}
        {children}
        {tip.more && <button type="button" onClick={() => setMore(!more)} className="mt-1 font-medium text-accent hover:underline">{more ? t("Show less") : t("Show more")}</button>}
      </div>
      <button type="button" onClick={close} aria-label={t("Hide this tip")} title={t("Hide this tip")} className="absolute top-2 right-2 grid size-6 place-items-center rounded-full text-faint transition hover:bg-ink/[0.06] hover:text-ink">
        <IconX className="size-3.5" />
      </button>
    </aside>
  );
}

// MARK: First-visit explainers

export type ExplainedPage = "research" | "app-store" | "studio" | "launch" | "measure";

/** The explainer a page or tab has (lib/nav-model.ts locate): Research's Ads and App stores, Studio, Launch, Measure. */
export function explainedPage(section: string | null, tab: string | null): ExplainedPage | null {
  if (section === "research") return tab === "app-store" ? "app-store" : tab === "social" ? null : "research";
  if (section === "studio") return tab === "create" || !tab ? "studio" : null;
  return section === "launch" || section === "measure" ? section : null;
}

/** The same page in the example app ("See how it works"). */
const EXAMPLE_PAGE: Record<ExplainedPage, string> = { research: "/example/research", "app-store": "/example/research/app-store", studio: "/example/studio", launch: "/example/launch", measure: "/example/measure" };

/**
 * One sentence on what a page is for, the first time it's opened, with a "how it works" link to the same
 * page in the example app. Closed for good per account (localStorage), never shown inside the example.
 */
export function PageTip({ page, className }: { page: ExplainedPage; className?: string }) {
  const { t } = useT();
  const example = useExample();
  const { closed, close } = useClosedFlag(explainKey(page));
  if (example || closed !== false) return null;
  const text = {
    research: t("Research shows the ads your competitors are running. The longer an ad runs, the more likely it works: start from those."),
    studio: t("Studio makes ads for your app, from a competitor's ad or a short brief. Every creative is checked before you approve it."),
    launch: t("Launch sends approved creatives to your Meta ad account as paused ads. Nothing spends until you publish them in Meta."),
    measure: t("Measure puts what you spend on ads next to what it brings in: CAC, LTV and what each ad earned."),
    "app-store": t("App stores shows your competitors' apps on the App Store: ratings, prices, updates and what their reviewers love and hate."),
  }[page];
  return (
    <aside className={cx("relative mb-6 flex gap-2.5 rounded-inner border border-line bg-raised py-2.5 pr-9 pl-3 text-sm", className)} aria-label={t("About this page")}>
      <IconSparkles className="mt-0.5 size-4 shrink-0 text-accent" />
      <p className="min-w-0 text-muted">
        {text}{" "}
        {/* A full page load: the example answers from sample data, apart from the real app. */}
        <a href={EXAMPLE_PAGE[page]} className="font-medium whitespace-nowrap text-accent hover:underline">{t("See how it works")}</a>
      </p>
      <button type="button" onClick={close} aria-label={t("Hide this")} title={t("Hide this")} className="absolute top-2 right-2 grid size-6 place-items-center rounded-full text-faint transition hover:bg-ink/[0.06] hover:text-ink">
        <IconX className="size-3.5" />
      </button>
    </aside>
  );
}

/** Several tips in a responsive grid. */
export function PlaybookTips({ ids, className }: { ids: TipId[]; className?: string }) {
  return <div className={cx("grid gap-2 @3xl:grid-cols-2", className)}>{ids.map((id) => <PlaybookTip key={id} id={id} />)}</div>;
}
