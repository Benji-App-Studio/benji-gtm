"use client";
// Home (/app): every app with a way in, then the analyses. The latest finished report gives the numbers
// (typical views, posting rhythm, what wins) and one pattern at a time; "Needs you" lists what's waiting.
// With no apps or no analyses yet it shows the first thing to do instead of an empty overview.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BarChart, RankBars } from "./charts";
import { IconAlert, IconCheckCircle, IconChevronRight, IconClock, IconCompass, IconGrid, IconPlus, IconSparkles } from "./icons";
import { OverviewSkeleton } from "./page-skeletons";
import { CardSkeletons, ProjectRows, useProjects, type ProjectSummary } from "./project-list";
import { ConnectFor, FreeRoute, useGate } from "./research/gates";
import { Badge, Button, ButtonLink, Card, CardHeader, ChevronLink, DeltaChip, EmptyState, ErrorNote, HeroCard, Kpi, ListRow, Page, PageHeader, SectionHeader, SelectPill, StatRow, TargetBar, fmt, stagger } from "./ui";
import { WorkspaceIcon } from "./workspace/parts";
import { peek, preloadProject, refresh, useCached } from "@/lib/client-cache";
import { APP_NAME } from "@/lib/brand-config";
import type { FeatureState } from "@/lib/capabilities";
import type { ProductRow, RunSummary } from "@/lib/db";
import { HOOK_LABEL, PLATFORM_LABEL, TYPE_COPY, type Platform, type Report } from "@/lib/types";
import { workspaceHref, type WorkspaceSummary } from "@/lib/workspace-schema";
import { UI_LOCALE } from "@/lib/ui-locale";

const median = (values: number[]) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The newest finished report among the projects (cached, so it shows at once on later visits). */
function useLatestReport(projects: ProjectSummary[] | null) {
  const latest = projects?.find((p) => p.status === "ready") ?? null;
  // `report: null` once the try is over and there is none to show (the run is gone, or it didn't load).
  const [state, setState] = useState<{ id: string; report: Report | null } | null>(null);
  useEffect(() => {
    if (!latest) return;
    let live = true;
    const details = `/api/projects/${latest.id}`;
    const load = async () => {
      const data = peek<{ runs?: RunSummary[] }>(details) ?? await refresh<{ runs?: RunSummary[] }>(details).catch(() => null);
      const run = data?.runs?.find((r) => r.status === "done");
      const url = run ? `/api/runs/${run.id}` : null;
      const got = url ? peek<{ report?: Report }>(url) ?? await refresh<{ report?: Report }>(url).catch(() => null) : null;
      if (live) setState({ id: latest.id, report: got?.report ?? null });
    };
    load();
    return () => { live = false; };
  }, [latest]);
  const mine = state && state.id === latest?.id ? state : null;
  return { project: latest, report: mine?.report ?? null, settled: !latest || Boolean(mine) };
}

export function Dashboard() {
  const projects = useProjects();
  const [products] = useCached<ProductRow[]>("/api/products");
  const [workspaces] = useCached<WorkspaceSummary[]>("/api/workspaces");
  const apps = Array.isArray(products) ? products : null;
  // The list of apps came back as an error (not as a list): say so instead of waiting on the placeholder for ever.
  const appsFailed = products !== undefined && !Array.isArray(products);
  const main = apps?.find((p) => p.is_primary) ?? apps?.[0];
  const [filter, setFilter] = useState("all");
  const { project, report, settled } = useLatestReport(projects);
  // An analysis collects posts and reads them: with either key missing, the page says what to connect.
  const { locked, also, checking } = useGate(["research.collect", "ai"]);

  const shown = (projects ?? []).filter((p) => filter === "all" || p.type === filter);
  // The install too: what the empty states offer depends on which keys are connected.
  const loading = projects === null || apps === null || !settled || checking;
  const none = apps !== null && apps.length === 0;

  return (
    <Page>
      <PageHeader title="Home" subtitle="Your apps, what's waiting for you and every analysis."
        actions={none ? undefined : <ButtonLink href="/app/new" variant="secondary"><IconPlus />New analysis</ButtonLink>} />

      {appsFailed ? <ErrorNote>Couldn&apos;t load your apps. Reload the page to try again.</ErrorNote> : loading ? <OverviewSkeleton /> : none ? (
        <EmptyState className="rise" icon={<IconCompass />} title="Add your first app"
          body={`Describe what you sell. ${APP_NAME} keeps a profile, a brand, a competitor list and the creatives for each app.`}
          action={<ButtonLink href="/app/product/new">Add an app</ButtonLink>} />
      ) : (
        <>
          <Apps apps={apps ?? []} icons={Array.isArray(workspaces) ? workspaces : []} />
          {report && project ? (
            <ReportOverview report={report} project={project} aside={<NeedsYou projects={projects ?? []} />} />
          ) : (
            <div className="grid grid-cols-1 items-start gap-3 @4xl:grid-cols-2">
              <FirstSteps app={main} locked={locked} hasAnalyses={(projects ?? []).length > 0} />
              <NeedsYou projects={projects ?? []} />
            </div>
          )}
        </>
      )}

      {!none && !appsFailed && (
        <section className="mt-10">
          <SectionHeader title="Analyses" subtitle={projects === null ? undefined : `${shown.length} ${shown.length === 1 ? "analysis" : "analyses"}${filter !== "all" ? ` · ${TYPE_COPY[filter as keyof typeof TYPE_COPY].label}` : ""}`}
            action={(projects ?? []).length > 0 ? (
              <SelectPill label="Kind of analysis" icon={<IconGrid />} value={filter} onChange={setFilter}
                options={[{ value: "all", label: "All kinds" }, { value: "competitors", label: "Competitors" }, { value: "account", label: "Accounts" }, { value: "campaign", label: "Campaigns" }]} />
            ) : undefined} />
          {projects === null || checking ? <CardSkeletons />
            : shown.length === 0 ? (
              (projects ?? []).length > 0
                ? <EmptyState title="None of this kind yet" action={<Button variant="secondary" onClick={() => setFilter("all")}>Show all kinds</Button>} />
                : locked
                  ? <Card><ConnectFor state={locked} also={also} otherwise={<FreeRoute productId={main?.id} />} /></Card>
                  : <EmptyState title="No analyses yet" body="An analysis collects accounts' recent posts and reads what works in them: formats, hooks and what the audience asks for." action={<ButtonLink href="/app/new" variant="secondary">New analysis</ButtonLink>} />
            )
            : <ProjectRows projects={shown.slice(0, 9)} offset={4} />}
        </section>
      )}
    </Page>
  );
}

/** Every app, each a way in to its Home and its main pages: one list row per app. */
function Apps({ apps, icons }: { apps: ProductRow[]; icons: WorkspaceSummary[] }) {
  return (
    <section className="mb-8">
      <SectionHeader title="Your apps" action={<ChevronLink href="/app/product/new" className="text-xs text-muted hover:text-ink">New app</ChevronLink>} />
      <div className="-mx-2">
        {apps.map((app, i) => {
          const summary = icons.find((w) => w.id === app.id);
          return (
            <div key={app.id} className="rise group/app flex min-h-12 min-w-0 items-center gap-3 rounded-control px-2 py-1.5 transition-colors hover:bg-hover" style={stagger(i)}>
              <Link href={workspaceHref(app.id)} className="group flex min-w-0 flex-1 items-center gap-3 rounded-xs">
                <WorkspaceIcon name={summary?.appName || app.name} url={summary?.iconUrl} className="size-6 text-xs" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2"><span className="truncate text-sm font-medium">{summary?.appName || app.name}</span>{app.is_primary && apps.length > 1 && <Badge>main</Badge>}</span>
                  <span className="block truncate text-xs text-muted">{app.description?.trim() || "No description yet"}</span>
                </span>
              </Link>
              <nav aria-label={`${app.name} pages`} className="hidden shrink-0 items-center gap-3 text-xs @xl:flex">
                {(["research", "studio", "brand"] as const).map((page) => <Link key={page} href={workspaceHref(app.id, page)} className="rounded-xs text-muted hover:text-ink">{page === "research" ? "Research" : page === "studio" ? "Studio" : "Brand"}</Link>)}
              </nav>
              <IconChevronRight className="size-3.5 shrink-0 text-faint" />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** With no report to summarise yet: the one thing to do next, and the free way to start. */
function FirstSteps({ app, locked, hasAnalyses }: { app: ProductRow | undefined; locked: FeatureState | null; hasAnalyses: boolean }) {
  if (hasAnalyses) {
    return (
      <Card className="rise p-4">
        <CardHeader title="No finished report yet" subtitle="When an analysis finishes, its numbers show here: typical views, posting rhythm and what wins." />
      </Card>
    );
  }
  return (
    <Card className="rise p-4">
      <CardHeader title="Start here" subtitle={app ? `What to do first to see what's working around ${app.name}.` : undefined} />
      <div className="mt-2">
        {app && <ListRow icon={<IconCheckCircle />} tone="accent" title={`Finish setting up ${app.name}`} subtitle="Profile, brand basics and competitors" href={workspaceHref(app.id)} />}
        {app && <ListRow icon={<IconCompass />} tone="win" title="Import competitors' ads" subtitle="Free: collect them with the Ad Library extension and drop the file on Research" href={workspaceHref(app.id, "research")} />}
        {!locked && <ListRow icon={<IconSparkles />} tone="caution" title="Find my competitors" subtitle="An analysis of their organic posts, starting from your app's profile" href="/app/new?type=competitors" />}
      </div>
    </Card>
  );
}

/** The three-column overview built from one report. */
function ReportOverview({ report, project, aside }: { report: Report; project: ProjectSummary; aside: React.ReactNode }) {
  const posts = useMemo(() => report.reels.filter((r) => r.onTopic == null || r.onTopic >= 0.5), [report]);
  const typical = median(posts.map((p) => p.views));
  const hits = posts.filter((p) => p.views >= report.hitMultiple * typical);
  const accounts = new Set(posts.map((p) => p.account)).size;
  const platforms = [...new Set(posts.map((p) => p.platform))] as Platform[];
  const formatName = (id: string | null) => report.formats.find((f) => f.id === id)?.name ?? (id ? id.replace(/_/g, " ") : "–");

  // Posting rhythm: how many posts went out each week, the last 12 weeks with posts.
  const weeks = useMemo(() => {
    const byWeek = new Map<string, number>();
    for (const p of posts) {
      if (!p.postedAt) continue;
      const d = new Date(p.postedAt); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const key = d.toISOString().slice(0, 10);
      byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
    }
    return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12)
      .map(([key, count]) => ({ label: new Date(`${key}T00:00:00Z`).toLocaleDateString(UI_LOCALE, { month: "short", day: "numeric", timeZone: "UTC" }), value: count }));
  }, [posts]);
  const perWeek = weeks.reduce((n, w) => n + w.value, 0) / Math.max(weeks.length, 1);

  // What wins: formats ranked by typical views.
  const formats = useMemo(() => {
    const by = new Map<string, number[]>();
    for (const p of posts) if (p.format && p.format !== "no_clear_format") by.set(p.format, [...(by.get(p.format) ?? []), p.views]);
    return [...by.entries()].filter(([, v]) => v.length >= 2).map(([id, v]) => ({ key: id, label: formatName(id), value: median(v), note: `${v.length} posts` })).sort((a, b) => b.value - a.value).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, report]);

  // Patterns for the gradient card, one at a time.
  const patterns = report.playbook.flatMap((channel) => [
    channel.formats[0] && { value: fmt(channel.formats[0].medianViews), unit: `typical views on ${PLATFORM_LABEL[channel.platform]}`, headline: `“${formatName(channel.formats[0].id)}” wins on ${PLATFORM_LABEL[channel.platform]}`, body: `Across ${channel.formats[0].posts} posts it beats every other format. Borrow the pattern, not the post.` },
    channel.hooks[0] && { value: `${Math.round(channel.ctaWinners * 100)}%`, unit: "of winning posts end with a call to action", headline: `Winners open with a ${(HOOK_LABEL[channel.hooks[0].id] ?? channel.hooks[0].id).toLowerCase()} hook`, body: `On ${PLATFORM_LABEL[channel.platform]} against ${Math.round(channel.ctaRest * 100)}% of the rest.` },
  ]).filter(Boolean) as { value: string; unit: string; headline: string; body: string }[];
  const [pattern, setPattern] = useState(0);
  const shownPattern = patterns[pattern % Math.max(patterns.length, 1)];
  const best = [...posts].sort((a, b) => b.score - a.score)[0];

  return (
    <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2">
      <div className="grid min-w-0 grid-cols-1 content-start gap-3">
        <Card className="rise p-4" style={stagger(0)}>
          <CardHeader title="Typical views" subtitle={`${project.name} · last ${report.sinceDays ?? project.sinceDays} days`} />
          <Kpi className="mt-3" value={fmt(typical)} delta={best ? <DeltaChip direction="up" value={`${fmt(best.views)} best`} /> : undefined} compare="median views per post" />
          <p className="mt-3 text-xs text-muted">{Math.round((hits.length / Math.max(posts.length, 1)) * 100)}% of posts are hits: {hits.length} of {posts.length} got {report.hitMultiple}× the typical views.{best ? ` The best came from ${best.account}.` : ""}</p>
          <TargetBar className="mt-4" value={hits.length / Math.max(posts.length, 1)} target={0.25} startLabel="0%" targetLabel="Healthy 25%" />
          <div className="mt-4">
            <StatRow label="Posts read" value={posts.length} note={`of ${report.kpis.videos}`} />
            <StatRow label={TYPE_COPY[project.type].nouns[0].toUpperCase() + TYPE_COPY[project.type].nouns.slice(1)} value={accounts} />
            <StatRow label="Channels" value={platforms.length} note={platforms.map((p) => PLATFORM_LABEL[p]).join(", ")} />
          </div>
        </Card>
        {weeks.length > 1 && (
          <Card className="rise p-4" style={stagger(1)}>
            <CardHeader title={`Last ${weeks.length} weeks`} action={<span className="pt-1 text-caption text-muted">Posts by week</span>} />
            <BarChart className="mt-6" data={weeks} target={perWeek} targetLabel={`Average ${Math.round(perWeek * 10) / 10}`} />
          </Card>
        )}
      </div>

      <Card className="rise flex flex-col p-4" style={stagger(2)}>
        <CardHeader title="What wins" subtitle="Formats ranked by typical views" action={<ChevronLink href={`/app/p/${project.id}`} onMouseEnter={() => preloadProject(project.id)}>Report</ChevronLink>} />
        <RankBars className="-mx-2 mt-3" rows={formats} format={fmt} tone="accent" selected={formats[0]?.key} />
        {formats.length === 0 && <p className="mt-4 text-sm text-muted">Not enough posts per format yet.</p>}
        <div className="mt-auto pt-4">
          {report.playbook[0]?.examples[0]?.hook && (
            <div className="rounded-inner border border-line bg-raised px-3 py-2.5">
              <p className="text-sm font-medium">“{report.playbook[0].examples[0].hook}”</p>
              <p className="mt-1 text-caption text-muted">The top hook on {PLATFORM_LABEL[report.playbook[0].platform]}, from {report.playbook[0].examples[0].account} · {fmt(report.playbook[0].examples[0].views)} views.</p>
            </div>
          )}
        </div>
      </Card>

      <div className="grid min-w-0 grid-cols-1 content-start gap-3">
        {shownPattern && (
          <HeroCard className="rise" pager={patterns.length > 1 ? <button type="button" onClick={() => setPattern(pattern + 1)} className="rounded-xs hover:text-ink">{(pattern % patterns.length) + 1} of {patterns.length}</button> : undefined}
            value={shownPattern.value} unit={shownPattern.unit} headline={shownPattern.headline} body={shownPattern.body}
            action={<ButtonLink href={`/app/p/${project.id}`} variant="secondary" size="sm" onMouseEnter={() => preloadProject(project.id)}>Open the playbook<IconChevronRight /></ButtonLink>} />
        )}
        {aside}
      </div>
    </div>
  );
}

/** What's waiting on the user: searches to review, runs that failed, work in progress. */
function NeedsYou({ projects, className }: { projects: ProjectSummary[]; className?: string }) {
  const rows = [
    ...projects.filter((p) => p.status === "review").map((p) => ({ p, icon: <IconCheckCircle />, tone: "caution" as const, title: `Pick the ${TYPE_COPY[p.type].nouns} for ${p.name}`, subtitle: "Ready to run once you've checked the list" })),
    ...projects.filter((p) => p.status === "error").map((p) => ({ p, icon: <IconAlert />, tone: "warn" as const, title: `${p.name} needs attention`, subtitle: p.message ?? "The last step stopped" })),
    ...projects.filter((p) => p.status === "discovering" || p.status === "analyzing").map((p) => ({ p, icon: <IconClock />, tone: "accent" as const, title: `${p.name} is ${p.status === "discovering" ? "finding competitors" : "being analyzed"}`, subtitle: "You can leave; it keeps going" })),
  ];
  return (
    <Card id="needs-you" className={`rise scroll-mt-4 p-4 ${className ?? ""}`} style={stagger(3)}>
      <CardHeader title="Needs you" subtitle={rows.length ? `${rows.length} ${rows.length === 1 ? "thing" : "things"} waiting` : "Nothing waiting"} />
      <div className="mt-2">
        {rows.length ? rows.slice(0, 5).map((r) => <ListRow key={r.p.id + r.tone} icon={r.icon} tone={r.tone} title={r.title} subtitle={r.subtitle} href={`/app/p/${r.p.id}`} />)
          : <ListRow icon={<IconSparkles />} tone="accent" title="Start a new analysis" subtitle="Competitors, one account or a brand campaign" href="/app/new" />}
      </div>
    </Card>
  );
}
