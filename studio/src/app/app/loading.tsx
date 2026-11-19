"use client";
import { usePathname } from "next/navigation";
import {
  BrandSkeleton, DashboardSkeleton, FormatsSkeleton, GenericPageSkeleton, LaunchSkeleton, MarketSkeleton, MeasureSkeleton, ProductsSkeleton, ProjectSkeleton,
  PlaygroundSkeleton, ResearchSkeleton, StudioSkeleton, WorkflowListSkeleton, WorkspaceOverviewSkeleton, WorkspaceSettingsSkeleton,
} from "@/components/page-skeletons";
import { SettingsLoading } from "@/components/settings/settings-ui";
import type { WorkspaceModule } from "@/lib/workspace-schema";

/** A product's pages ("" is its Home), each with the skeleton it shows while its data loads. */
const PRODUCT_PAGES: Record<WorkspaceModule | "", () => React.ReactNode> = {
  "": WorkspaceOverviewSkeleton,
  brand: BrandSkeleton,
  research: ResearchSkeleton,
  market: MarketSkeleton,
  formats: FormatsSkeleton,
  studio: StudioSkeleton,
  playground: PlaygroundSkeleton,
  launch: LaunchSkeleton,
  measure: MeasureSkeleton,
  settings: WorkspaceSettingsSkeleton,
};

/**
 * Shown the moment a link is clicked, while the next page loads: that page's own skeleton (the same
 * one it shows while its data loads, so nothing moves in between).
 */
export default function Loading() {
  const path = (usePathname() ?? "/app").replace(/\/$/, "");
  const product = /^\/app\/w\/([^/]+)(?:\/([^/]+))?/.exec(path);
  if (product) {
    const Page = PRODUCT_PAGES[(product[2] ?? "") as WorkspaceModule | ""];
    return Page ? <Page /> : <GenericPageSkeleton />;
  }
  if (path === "/app") return <DashboardSkeleton />;
  if (/^\/app\/(accounts|campaigns)$/.test(path)) return <WorkflowListSkeleton />;
  if (path.startsWith("/app/p/")) return <ProjectSkeleton />;
  if (path === "/app/product") return <ProductsSkeleton />;
  if (path === "/app/settings" || path.startsWith("/app/settings/")) return <SettingsLoading framed />;
  return <GenericPageSkeleton />;
}
