"use client";
// Analyses of social posts (the organic side: Instagram, TikTok, YouTube…). Each app's Research ›
// Social posts tab lists the ones for that app; All analyses (/app/analyses) lists every one, including
// the analyses that name no app, and can assign each to an app. Both open with the latest finished
// report at a glance (report-overview.tsx) and what's waiting on you. Kept live (project-list.tsx).
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { refresh, useCached } from "@/lib/client-cache";
import type { ProductRow } from "@/lib/db";
import { useT } from "@/lib/i18n/client";
import { sentenceGap } from "@/lib/i18n/join";
import { ALL_APPS_HREF, newAnalysisHref, researchHref, ANALYSES_HREF } from "@/lib/nav-model";
import type { ProjectType } from "@/lib/types";
import { notice } from "./dialog";
import { IconAlert, IconCheckCircle, IconClock, IconGrid, IconMore, IconPlus } from "./icons";
import { useNavLabels } from "./nav/nav-labels";
import { CardSkeletons, ProjectRows, useProjects, type ProjectSummary } from "./project-list";
import { NeedsYou, ReportOverview, useLatestReport } from "./report-overview";
import { ButtonLink, EmptyState, ListRow, Menu, MenuItem, MenuLabel, MenuSeparator, Page, PageHeader, SectionHeader, SelectPill } from "./ui";
import { ProductPageHeader } from "./workspace/product-header";

type Filter = "all" | ProjectType;

function useKinds() {
  const { t } = useT();
  return [
    { value: "all", label: t("All kinds") },
    { value: "competitors", label: t("My competitors") },
    { value: "account", label: t("One account") },
    { value: "campaign", label: t("A brand campaign") },
  ];
}

/** The latest finished report with "Needs you" beside it; without a report yet, "Needs you" alone when something waits. */
function Overview({ projects, newHref }: { projects: ProjectSummary[] | null; newHref: string }) {
  const { project, report } = useLatestReport(projects);
  if (report && project) return <section className="mb-10"><ReportOverview report={report} project={project} aside={<NeedsYou projects={projects ?? []} newHref={newHref} />} /></section>;
  return <Waiting projects={projects ?? []} />;
}

/** Research › Social posts: this app's analyses, what's waiting on them, and a way to start one. */
export function SocialPosts({ productId }: { productId: string }) {
  const { t, tn, locale } = useT();
  const projects = useProjects();
  const [filter, setFilter] = useState<Filter>("all");
  const kinds = useKinds();
  const mine = projects?.filter((p) => p.productId === productId) ?? null;
  const others = projects ? projects.length - (mine?.length ?? 0) : 0;
  const shown = (mine ?? []).filter((p) => filter === "all" || p.type === filter);
  return (
    <Page>
      <ProductPageHeader productId={productId} page="Research"
        subtitle={t("What works in competitors' and creators' own posts on Instagram, TikTok and YouTube: formats, hooks and what their audience asks for. Every run is kept.")}
        actions={<ButtonLink href={newAnalysisHref(productId)} variant="secondary" size="sm"><IconPlus />{t("New analysis")}</ButtonLink>} />
      <Overview projects={mine} newHref={newAnalysisHref(productId)} />
      <section>
        <SectionHeader title={t("Analyses")} subtitle={mine === null ? undefined : tn(shown.length, "{n} analysis", "{n} analyses")}
          action={(mine ?? []).length > 0 ? <SelectPill label={t("Kind of analysis")} icon={<IconGrid />} value={filter} onChange={(v) => setFilter(v as Filter)} options={kinds} /> : undefined} />
        {mine === null ? <CardSkeletons />
          : shown.length === 0 ? (
            <EmptyState title={(mine ?? []).length ? t("None of this kind yet") : t("No analyses for this app yet")}
              body={t("Start with your competitors: the analysis finds them from your app's profile and reads what wins for them on each channel.")}
              action={<ButtonLink href={newAnalysisHref(productId, "competitors")} variant="secondary">{t("Find my competitors")}</ButtonLink>} />
          ) : <ProjectRows projects={shown} />}
      </section>
      {others > 0 && (
        <p className="mt-6 text-xs text-muted">
          {tn(others, "{n} other analysis isn't tied to this app.", "{n} other analyses aren't tied to this app.")}{sentenceGap(locale)}
          <Link href={ANALYSES_HREF} className="rounded-xs font-medium text-accent hover:underline">{t("See all analyses")}</Link>
        </p>
      )}
    </Page>
  );
}

/** Searches to review, runs that failed and work in progress, when there are any. */
function Waiting({ projects }: { projects: ProjectSummary[] }) {
  const { t } = useT();
  const rows = [
    ...projects.filter((p) => p.status === "review").map((p) => ({ p, icon: <IconCheckCircle />, tone: "caution" as const, title: t("Check the list for {name}", { name: p.name }), subtitle: t("Ready to run once you've picked who to read") })),
    ...projects.filter((p) => p.status === "error").map((p) => ({ p, icon: <IconAlert />, tone: "warn" as const, title: t("{name} needs attention", { name: p.name }), subtitle: p.message ?? t("The last step stopped") })),
    ...projects.filter((p) => p.status === "discovering" || p.status === "analyzing").map((p) => ({ p, icon: <IconClock />, tone: "accent" as const, title: t("{name} is running", { name: p.name }), subtitle: t("You can leave; it keeps going") })),
  ];
  if (!rows.length) return null;
  return (
    <section className="mb-8">
      <SectionHeader title={t("Needs you")} />
      <div>{rows.slice(0, 5).map((r) => <ListRow key={r.p.id + r.tone} icon={r.icon} tone={r.tone} title={r.title} subtitle={r.subtitle} href={`/app/p/${r.p.id}`} />)}</div>
    </section>
  );
}

/** "Assign to app": ties an analysis to one of the apps (or to none), through PATCH /api/projects/<id>. */
function AssignMenu({ project, apps }: { project: ProjectSummary; apps: ProductRow[] }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const assign = async (productId: string | null) => {
    if (busy || productId === (project.productId ?? null)) return;
    setBusy(true);
    const response = await fetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId }) }).catch(() => null);
    const data = await response?.json().catch(() => null) as { error?: string } | null;
    setBusy(false);
    if (!response?.ok) { await notice(data?.error ?? t("Couldn't move it. Try again."), t("Assign to app")); return; }
    await refresh("/api/projects").catch(() => {});
  };
  return (
    <Menu label={t("Assign {name} to an app", { name: project.name })} align="end" width={220} trigger={(trigger) => (
      <button {...trigger} disabled={busy} aria-label={t("Assign {name} to an app", { name: project.name })} title={t("Assign to app")}
        className="grid size-7 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-50 aria-expanded:bg-hover"><IconMore className="size-3.5" /></button>
    )}>
      <MenuLabel>{t("Assign to app")}</MenuLabel>
      {apps.map((app) => <MenuItem key={app.id} checked={project.productId === app.id} onSelect={() => void assign(app.id)}>{app.name}</MenuItem>)}
      <MenuSeparator />
      <MenuItem checked={!project.productId || !apps.some((a) => a.id === project.productId)} onSelect={() => void assign(null)}>{t("Not tied to an app")}</MenuItem>
    </Menu>
  );
}

/** Every analysis, grouped by the app it's for; `?type=` keeps one kind (the old Accounts and Campaigns pages). */
function AllAnalysesBody() {
  const { t, tn } = useT();
  const labels = useNavLabels();
  const params = useSearchParams();
  const kinds = useKinds();
  const requested = params.get("type");
  const [filter, setFilter] = useState<Filter>(kinds.some((k) => k.value === requested) ? requested as Filter : "all");
  const projects = useProjects();
  const [products] = useCached<ProductRow[]>("/api/products");
  const apps = Array.isArray(products) ? products : [];
  const shown = (projects ?? []).filter((p) => filter === "all" || p.type === filter);
  const groups = [
    { key: "none", title: t("Not tied to an app"), href: null, rows: shown.filter((p) => !p.productId || !apps.some((a) => a.id === p.productId)) },
    ...apps.map((app) => ({ key: app.id, title: app.name, href: researchHref(app.id, "social"), rows: shown.filter((p) => p.productId === app.id) })),
  ].filter((g) => g.rows.length);
  const choose = (value: string) => {
    setFilter(value as Filter);
    const url = new URL(window.location.href);
    if (value === "all") url.searchParams.delete("type"); else url.searchParams.set("type", value);
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  };
  return (
    <Page>
      <PageHeader crumbs={[{ label: labels.allApps, href: ALL_APPS_HREF }, { label: labels.analyses }]} title={labels.analyses}
        subtitle={t("Every analysis of social posts, for each app and the ones that name none. Each app's own are also under its Research › Social posts.")}
        actions={<ButtonLink href={newAnalysisHref()} variant="secondary" size="sm"><IconPlus />{t("New analysis")}</ButtonLink>} />
      <Overview projects={projects} newHref={newAnalysisHref()} />
      <SectionHeader title={t("Analyses")} subtitle={projects === null ? undefined : tn(shown.length, "{n} analysis", "{n} analyses")}
        action={(projects ?? []).length > 0 ? <SelectPill label={t("Kind of analysis")} icon={<IconGrid />} value={filter} onChange={choose} options={kinds} /> : undefined} />
      {projects === null ? <CardSkeletons />
        : groups.length === 0 ? <EmptyState title={t("No analyses yet")} body={t("An analysis collects accounts' recent posts and reads what works in them: formats, hooks and what the audience asks for.")} action={<ButtonLink href={newAnalysisHref()} variant="secondary">{t("New analysis")}</ButtonLink>} />
        : groups.map((group) => (
          <section key={group.key} className="mt-6 first-of-type:mt-2">
            <p className="mb-1 flex items-center gap-2 text-xs text-muted">
              {group.href ? <Link href={group.href} className="rounded-xs font-medium text-label hover:text-ink">{group.title}</Link> : <span className="font-medium text-label">{group.title}</span>}
              {group.key === "none" && apps.length > 0 && <span>{t("Use ⋯ on a row to assign it to an app.")}</span>}
            </p>
            <ProjectRows projects={group.rows} trailing={apps.length ? (p) => <AssignMenu project={p} apps={apps} /> : undefined} />
          </section>
        ))}
    </Page>
  );
}

export function AllAnalyses() {
  return <Suspense><AllAnalysesBody /></Suspense>;
}
