"use client";
// All apps (/app/apps): every app in the workspace on one page, each with its key numbers and its one
// next step, and a way into its Home. The numbers are the business card's (spend, revenue, CAC) when a
// source is connected, else how far the app has come (competitors, their ads, creatives, ads sent).
// The next step is the app's getting-started guide's (lib/workspace-setup.ts), the same as its Home and the
// sidebar's card, so they never disagree.
import Link from "next/link";
import type { ReactNode } from "react";
import type { BusinessSummary } from "@/lib/business-summary";
import { useCached } from "@/lib/client-cache";
import type { ProductRow } from "@/lib/db";
import { useT } from "@/lib/i18n/client";
import { useInstall } from "@/lib/install/use-install";
import { ANALYSES_HREF, appHref, NEW_APP_HREF } from "@/lib/nav-model";
import type { WorkspaceCounts, WorkspaceSummary } from "@/lib/workspace-schema";
import { guideStatus, guideSteps } from "@/lib/workspace-setup";
import { useGuideWords } from "./getting-started";
import { IconArrowRight, IconChevronRight, IconCompass, IconPlus, IconSparkles } from "./icons";
import { formatters } from "./measure/operating";
import { useNavLabels, useTermTips } from "./nav/nav-labels";
import { useProjects } from "./project-list";
import { Badge, ButtonLink, Card, EmptyState, ErrorNote, Page, PageHeader, Spinner, stagger, Term } from "./ui";
import { isWorkspace, useWorkspace, WorkspaceIcon } from "./workspace/parts";

export function AllApps() {
  const { t, tn } = useT();
  const labels = useNavLabels();
  const [products] = useCached<ProductRow[]>("/api/products");
  const [summaries] = useCached<WorkspaceSummary[]>("/api/workspaces");
  const projects = useProjects();
  const apps = Array.isArray(products) ? products : null;
  const failed = products !== undefined && !Array.isArray(products);
  const loose = (projects ?? []).filter((p) => !p.productId).length;
  return (
    <Page>
      <PageHeader title={labels.allApps} subtitle={t("Every app in this workspace: how each one is doing and what to do next.")}
        actions={<ButtonLink href={NEW_APP_HREF} variant="secondary" size="sm"><IconPlus />{t("New app")}</ButtonLink>} />
      {failed ? <ErrorNote>{t("Couldn't load your apps. Reload the page to try again.")}</ErrorNote>
        : apps === null ? <Card className="flex h-32 items-center justify-center"><Spinner className="size-3.5" /></Card>
        : apps.length === 0 ? (
          <EmptyState className="rise" icon={<IconCompass />} title={t("Add your first app")} body={t("Each app keeps its own research, creatives, ads and numbers.")}
            action={<ButtonLink href={NEW_APP_HREF}>{t("Add an app")}</ButtonLink>} />
        ) : (
          <div className="grid gap-3 @3xl:grid-cols-2">
            {apps.map((app, i) => <AppCard key={app.id} app={app} summary={Array.isArray(summaries) ? summaries.find((s) => s.id === app.id) : undefined} index={i} many={apps.length > 1} />)}
          </div>
        )}
      {(projects ?? []).length > 0 && (
        <p className="mt-8 text-xs text-muted">
          {loose > 0 ? tn(loose, "{n} analysis of social posts isn't tied to an app.", "{n} analyses of social posts aren't tied to an app.") : t("Analyses of social posts sit under each app's Research.")}{" "}
          <Link href={ANALYSES_HREF} className="rounded-xs font-medium text-accent hover:underline">{t("See all analyses")}</Link>
        </p>
      )}
    </Page>
  );
}

function AppCard({ app, summary, index, many }: { app: ProductRow; summary?: WorkspaceSummary; index: number; many: boolean }) {
  const tr = useT();
  const { t } = tr;
  const f = formatters(tr);
  const tips = useTermTips();
  const [workspace] = useWorkspace(app.id);
  const [counted] = useCached<{ counts: WorkspaceCounts }>(`/api/workspaces/${app.id}/counts`);
  const [business] = useCached<BusinessSummary & { error?: string }>(`/api/w/${app.id}/business`);
  const { install, loading } = useInstall();
  const home = appHref(app.id);
  const name = summary?.appName || app.name;

  const counts = counted === undefined ? undefined : counted?.counts ?? null;
  const ready = isWorkspace(workspace);
  const words = useGuideWords(ready ? workspace.brandKit.appName || name : name);
  const status = ready && !loading && counts !== undefined ? guideStatus(guideSteps(app.id, counts, install, { id: app.id, connections: workspace.connections })) : null;
  const next = !status ? null
    : status.current ? { title: words(status.current.key).title, href: status.current.href, action: t("Show me") }
    : { title: t("See what's working"), href: appHref(app.id, "measure"), action: t("Open Measure") };

  const money = business && !business.error && business.anyConnection && business.connected.length > 0;
  const numbers: { label: ReactNode; value: string }[] = money ? [
    { label: t("Spend"), value: business.spend == null ? "–" : f.money(business.spend, business.currency) },
    { label: t("Revenue"), value: f.money(business.revenue?.value, business.revenue?.currency ?? "USD") },
    { label: <Term tip={tips.cac}>{t("CAC")}</Term>, value: f.money(business.cac?.value, "USD") },
  ] : [
    { label: t("Competitors"), value: f.count(counts?.watchlist) },
    { label: t("Their ads"), value: f.count(counts?.paidAds) },
    { label: t("Creatives"), value: f.count(counts?.creatives) },
    { label: t("Ads sent"), value: f.count(counts?.metaAds) },
  ];

  return (
    <Card className="rise flex min-w-0 flex-col p-4" style={stagger(index)}>
      <Link href={home} className="group -m-1 flex min-w-0 items-center gap-3 rounded-control p-1">
        <WorkspaceIcon name={name} url={summary?.iconUrl} className="size-8 text-sm" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2"><span className="truncate text-sm font-medium group-hover:underline">{name}</span>{app.is_primary && many && <Badge>{t("main")}</Badge>}</span>
          <span className="block truncate text-xs text-muted">{app.description?.trim() || t("No description yet")}</span>
        </span>
        <IconChevronRight className="size-3.5 shrink-0 text-faint" />
      </Link>
      <dl className={`mt-3 grid gap-px overflow-hidden rounded-inner border border-line bg-line ${numbers.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {numbers.map((n, i) => (
          <div key={i} className="min-w-0 bg-card px-3 py-2">
            <dt className="truncate text-xs text-muted">{n.label}</dt>
            <dd className="mt-0.5 text-sm font-medium tabular-nums">{counts === undefined && !money ? "…" : n.value}</dd>
          </div>
        ))}
      </dl>
      {money && <p className="mt-1.5 text-[11px] text-faint">{t("Last {n} days", { n: business.days })}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-3 pt-3">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-accent-soft text-accent"><IconSparkles className="size-3.5" /></span>
        <div className="min-w-0 flex-[1_1_180px]">
          <p className="text-xs text-muted">{t("Next step")}</p>
          <p className="truncate text-sm font-medium">{next ? next.title : t("Working out the next step…")}</p>
        </div>
        {next && <ButtonLink href={next.href} variant="secondary" size="sm" className="rounded-full">{next.action}<IconArrowRight /></ButtonLink>}
      </div>
    </Card>
  );
}
