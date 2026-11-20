"use client";
import { usePathname } from "next/navigation";
import {
  BrandSkeleton, DashboardSkeleton, GenericPageSkeleton, LaunchSkeleton, MarketSkeleton, MeasureSkeleton, ProjectSkeleton,
  PlaygroundSkeleton, ResearchSkeleton, StudioSkeleton, WorkflowListSkeleton, WorkspaceOverviewSkeleton,
} from "@/components/page-skeletons";
import { SettingsLoading } from "@/components/settings/settings-ui";

/** An app's pages ("" is its Home; "research/app-store" a tab), each with the skeleton it shows while its data loads. */
const PRODUCT_PAGES: Record<string, () => React.ReactNode> = {
  "": WorkspaceOverviewSkeleton,
  research: ResearchSkeleton,
  "research/app-store": MarketSkeleton,
  "research/social": WorkflowListSkeleton,
  studio: StudioSkeleton,
  "studio/remix": PlaygroundSkeleton,
  "studio/templates": PlaygroundSkeleton,
  launch: LaunchSkeleton,
  measure: MeasureSkeleton,
  settings: BrandSkeleton,
};

/**
 * Shown the moment a link is clicked, while the next page loads: that page's own skeleton (the same
 * one it shows while its data loads, so nothing moves in between).
 */
export default function Loading() {
  const path = (usePathname() ?? "/app").replace(/\/$/, "");
  const product = /^\/app\/w\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/.exec(path);
  if (product) {
    const Page = PRODUCT_PAGES[[product[2], product[3]].filter(Boolean).join("/")] ?? PRODUCT_PAGES[product[2] ?? ""];
    return Page ? <Page /> : <GenericPageSkeleton />;
  }
  if (path === "/app/apps") return <DashboardSkeleton />;
  if (path === "/app/analyses") return <WorkflowListSkeleton />;
  if (path.startsWith("/app/p/")) return <ProjectSkeleton />;
  if (path === "/app/settings" || path.startsWith("/app/settings/")) return <SettingsLoading framed />;
  return <GenericPageSkeleton />;
}
