"use client";
// The header every app page shares: crumbs (app → page), title, subtitle and actions. On Research and
// Studio it also draws that section's tabs (Ads · App Store · Social posts; Create · Remix · Templates)
// under the header, lit from the address. A page that switches tabs itself passes `tab` and `onTab`.
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { useCached } from "@/lib/client-cache";
import type { ProductRow } from "@/lib/db";
import { useT } from "@/lib/i18n/client";
import { locate, RESEARCH_TABS, researchHref, STUDIO_TABS, studioHref, type ResearchTab, type StudioTab } from "@/lib/nav-model";
import { workspaceHref } from "@/lib/workspace-schema";
import { useNavLabels } from "../nav/nav-labels";
import { useAppPath } from "../nav/path";
import { explainedPage, PageTip } from "../playbook-tip";
import { cx, PageHeader, segmentClass, segmentTrackClass } from "../ui";

/** A product's name, from the list the sidebar already keeps cached. */
export function useProductName(productId: string): string | undefined {
  const [list] = useCached<ProductRow[]>("/api/products");
  return Array.isArray(list) ? list.find((p) => p.id === productId)?.name : undefined;
}

type Tab = ResearchTab | StudioTab;

type Props = Omit<ComponentProps<typeof PageHeader>, "crumbs" | "title"> & {
  productId: string;
  /** The page's name in the sidebar, in English (shown translated): the last crumb, and the title unless one is given. */
  page: string;
  title?: ReactNode;
  /** The product's name when the page already has it (else it comes from the cached list). */
  name?: string;
  /** The section tab to light, when the page switches tabs itself (else the address decides). */
  tab?: Tab;
  /** Called instead of following the link, for the tabs the page switches itself. */
  onTab?: (tab: Tab) => boolean;
};

/** A crumb is a way back, not the title: a very long name is cut short there (the page shows it in full). */
const CRUMB_MAX = 40;
const crumb = (label: string) => (label.length > CRUMB_MAX ? `${label.slice(0, CRUMB_MAX - 1).trimEnd()}…` : label);

export function ProductPageHeader({ productId, page, title, name, tab, onTab, ...rest }: Props) {
  const { t } = useT();
  const cached = useProductName(productId);
  const labels = useNavLabels();
  const here = locate(useAppPath());
  // The pages' English names, said in the viewer's language.
  const PAGE: Record<string, string> = {
    Home: labels.section.home, Research: labels.section.research, Studio: labels.section.studio, Launch: labels.section.launch,
    Measure: labels.section.measure, "App settings": labels.section.settings,
  };
  const label = PAGE[page] ?? page;
  const section = here.section === "research" || here.section === "studio" ? here.section : null;
  const explained = explainedPage(here.section, here.tab);
  return (
    <>
      <PageHeader crumbs={[{ label: crumb(name || cached || t("App")), href: workspaceHref(productId) }, { label }]} title={title ?? label} {...rest} />
      {section && <SectionTabs productId={productId} section={section} current={tab ?? here.tab ?? undefined} onTab={onTab} />}
      {/* A first-visit explainer for the page or tab (components/playbook-tip.tsx). */}
      {explained && <PageTip page={explained} />}
    </>
  );
}

/** Research's or Studio's tabs: links, so each tab has its own address (and Back works). */
function SectionTabs({ productId, section, current, onTab }: { productId: string; section: "research" | "studio"; current?: Tab; onTab?: (tab: Tab) => boolean }) {
  const labels = useNavLabels();
  const items: { key: Tab; label: string; href: string }[] = section === "research"
    ? RESEARCH_TABS.map((key) => ({ key, label: labels.research[key], href: researchHref(productId, key) }))
    : STUDIO_TABS.map((key) => ({ key, label: labels.studio[key], href: studioHref(productId, key) }));
  // Its own row (a block around the pills), so a page's own pills below never share the line.
  return (
    <div className="-mt-2 mb-5">
      <nav aria-label={labels.section[section]} className={cx(segmentTrackClass, "no-scrollbar overflow-x-auto")}>
        {items.map((item) => (
          <Link key={item.key} href={item.href} aria-current={current === item.key ? "page" : undefined} className={segmentClass(current === item.key)}
            onClick={(event) => { if (onTab && !event.metaKey && !event.ctrlKey && !event.shiftKey && onTab(item.key)) event.preventDefault(); }}>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
