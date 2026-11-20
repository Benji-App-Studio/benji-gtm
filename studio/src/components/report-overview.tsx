"use client";
// The latest finished report of social-posts analyses, at a glance (what the old Home showed): typical
// views, the hit rate, posts per week, "What wins" (formats ranked by typical views), the pattern
// carousel, the top hook, and "Needs you" across the analyses. Research › Social posts shows it for
// one app's analyses; All analyses for every analysis. The latest report is cached, so it shows at once
// on later visits.
import { useEffect, useMemo, useState } from "react";
import { BarChart, RankBars } from "./charts";
import { IconAlert, IconCheckCircle, IconChevronRight, IconClock, IconSparkles } from "./icons";
import type { ProjectSummary } from "./project-list";
import { ButtonLink, Card, CardHeader, ChevronLink, DeltaChip, HeroCard, Kpi, ListRow, StatRow, TargetBar, fmt, stagger } from "./ui";
import { peek, preloadProject, refresh } from "@/lib/client-cache";
import type { RunSummary } from "@/lib/db";
import { useT } from "@/lib/i18n/client";
import { HOOK_LABEL, PLATFORM_LABEL, TYPE_COPY, type Platform, type Report } from "@/lib/types";

const median = (values: number[]) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The newest finished report among the projects (cached, so it shows at once on later visits). */
export function useLatestReport(projects: ProjectSummary[] | null) {
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

/** The three-column overview built from one report. */
export function ReportOverview({ report, project, aside }: { report: Report; project: ProjectSummary; aside: React.ReactNode }) {
  const { t, tn, intl } = useT();
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
      .map(([key, count]) => ({ label: new Date(`${key}T00:00:00Z`).toLocaleDateString(intl, { month: "short", day: "numeric", timeZone: "UTC" }), value: count }));
  }, [posts, intl]);
  const perWeek = weeks.reduce((n, w) => n + w.value, 0) / Math.max(weeks.length, 1);

  // What wins: formats ranked by typical views.
  const formats = useMemo(() => {
    const by = new Map<string, number[]>();
    for (const p of posts) if (p.format && p.format !== "no_clear_format") by.set(p.format, [...(by.get(p.format) ?? []), p.views]);
    return [...by.entries()].filter(([, v]) => v.length >= 2).map(([id, v]) => ({ key: id, label: formatName(id), value: median(v), note: tn(v.length, "{n} post", "{n} posts") })).sort((a, b) => b.value - a.value).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, report]);

  // Patterns for the gradient card, one at a time.
  const patterns = report.playbook.flatMap((channel) => [
    channel.formats[0] && { value: fmt(channel.formats[0].medianViews), unit: t("typical views on {channel}", { channel: PLATFORM_LABEL[channel.platform] }), headline: t("“{format}” wins on {channel}", { format: formatName(channel.formats[0].id), channel: PLATFORM_LABEL[channel.platform] }), body: tn(channel.formats[0].posts, "Across {n} post it beats every other format. Borrow the pattern, not the post.", "Across {n} posts it beats every other format. Borrow the pattern, not the post.") },
    channel.hooks[0] && { value: `${Math.round(channel.ctaWinners * 100)}%`, unit: t("of winning posts end with a call to action"), headline: t("Winners open with this hook: {hook}", { hook: HOOK_LABEL[channel.hooks[0].id] ? t(HOOK_LABEL[channel.hooks[0].id]) : channel.hooks[0].id }), body: t("On {channel} against {pct}% of the rest.", { channel: PLATFORM_LABEL[channel.platform], pct: Math.round(channel.ctaRest * 100) }) },
  ]).filter(Boolean) as { value: string; unit: string; headline: string; body: string }[];
  const [pattern, setPattern] = useState(0);
  const shownPattern = patterns[pattern % Math.max(patterns.length, 1)];
  const best = [...posts].sort((a, b) => b.score - a.score)[0];

  return (
    <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2">
      <div className="grid min-w-0 grid-cols-1 content-start gap-3">
        <Card className="rise p-4" style={stagger(0)}>
          <CardHeader title={t("Typical views")} subtitle={tn(report.sinceDays ?? project.sinceDays, "{name} · last {n} day", "{name} · last {n} days", { name: project.name })} />
          <Kpi className="mt-3" value={fmt(typical)} delta={best ? <DeltaChip direction="up" value={t("{views} best", { views: fmt(best.views) })} /> : undefined} compare={t("median views per post")} />
          <p className="mt-3 text-xs text-muted">{t("{pct}% of posts are hits: {hits} of {posts} got {multiple}× the typical views.", { pct: Math.round((hits.length / Math.max(posts.length, 1)) * 100), hits: hits.length, posts: posts.length, multiple: report.hitMultiple })}{best ? ` ${t("The best came from {account}.", { account: best.account })}` : ""}</p>
          <TargetBar className="mt-4" value={hits.length / Math.max(posts.length, 1)} target={0.25} startLabel="0%" targetLabel={t("Healthy 25%")} />
          <div className="mt-4">
            <StatRow label={t("Posts read")} value={posts.length} note={t("of {total}", { total: report.kpis.videos })} />
            <StatRow label={t(TYPE_COPY[project.type].many)} value={accounts} />
            <StatRow label={t("Channels")} value={platforms.length} note={platforms.map((p) => PLATFORM_LABEL[p]).join(", ")} />
          </div>
        </Card>
        {weeks.length > 1 && (
          <Card className="rise p-4" style={stagger(1)}>
            <CardHeader title={tn(weeks.length, "Last {n} week", "Last {n} weeks")} action={<span className="pt-1 text-caption text-muted">{t("Posts by week")}</span>} />
            <BarChart className="mt-6" data={weeks} target={perWeek} targetLabel={t("Average {n}", { n: Math.round(perWeek * 10) / 10 })} />
          </Card>
        )}
      </div>

      <Card className="rise flex flex-col p-4" style={stagger(2)}>
        <CardHeader title={t("What wins")} subtitle={t("Formats ranked by typical views")} action={<ChevronLink href={`/app/p/${project.id}`} onMouseEnter={() => preloadProject(project.id)}>{t("Report")}</ChevronLink>} />
        <RankBars className="-mx-2 mt-3" rows={formats} format={fmt} tone="accent" selected={formats[0]?.key} />
        {formats.length === 0 && <p className="mt-4 text-sm text-muted">{t("Not enough posts per format yet.")}</p>}
        <div className="mt-auto pt-4">
          {report.playbook[0]?.examples[0]?.hook && (
            <div className="rounded-inner border border-line bg-raised px-3 py-2.5">
              <p className="text-sm font-medium">“{report.playbook[0].examples[0].hook}”</p>
              <p className="mt-1 text-caption text-muted">{t("The top hook on {channel}, from {account} · {views} views.", { channel: PLATFORM_LABEL[report.playbook[0].platform], account: report.playbook[0].examples[0].account, views: fmt(report.playbook[0].examples[0].views) })}</p>
            </div>
          )}
        </div>
      </Card>

      <div className="grid min-w-0 grid-cols-1 content-start gap-3">
        {shownPattern && (
          <HeroCard className="rise" pager={patterns.length > 1 ? <button type="button" onClick={() => setPattern(pattern + 1)} className="rounded-xs hover:text-ink">{t("{n} of {total}", { n: (pattern % patterns.length) + 1, total: patterns.length })}</button> : undefined}
            value={shownPattern.value} unit={shownPattern.unit} headline={shownPattern.headline} body={shownPattern.body}
            action={<ButtonLink href={`/app/p/${project.id}`} variant="secondary" size="sm" onMouseEnter={() => preloadProject(project.id)}>{t("Open the playbook")}<IconChevronRight /></ButtonLink>} />
        )}
        {aside}
      </div>
    </div>
  );
}

/** What's waiting on the user: searches to review, runs that failed, work in progress. */
/** `newHref`: where "Start a new analysis" goes (tied to the app when there is one). */
export function NeedsYou({ projects, className, newHref = "/app/new" }: { projects: ProjectSummary[]; className?: string; newHref?: string }) {
  const { t, tn } = useT();
  const rows = [
    ...projects.filter((p) => p.status === "review").map((p) => ({ p, icon: <IconCheckCircle />, tone: "caution" as const, title: t(TYPE_COPY[p.type].pick, { name: p.name }), subtitle: t("Ready to run once you've checked the list") })),
    ...projects.filter((p) => p.status === "error").map((p) => ({ p, icon: <IconAlert />, tone: "warn" as const, title: t("{name} needs attention", { name: p.name }), subtitle: p.message ?? t("The last step stopped") })),
    ...projects.filter((p) => p.status === "discovering" || p.status === "analyzing").map((p) => ({ p, icon: <IconClock />, tone: "accent" as const, title: p.status === "discovering" ? t("{name} is finding competitors", { name: p.name }) : t("{name} is being analyzed", { name: p.name }), subtitle: t("You can leave; it keeps going") })),
  ];
  return (
    <Card id="needs-you" className={`rise scroll-mt-4 p-4 ${className ?? ""}`} style={stagger(3)}>
      <CardHeader title={t("Needs you")} subtitle={rows.length ? tn(rows.length, "{n} thing waiting", "{n} things waiting") : t("Nothing waiting")} />
      <div className="mt-2">
        {rows.length ? rows.slice(0, 5).map((r) => <ListRow key={r.p.id + r.tone} icon={r.icon} tone={r.tone} title={r.title} subtitle={r.subtitle} href={`/app/p/${r.p.id}`} />)
          : <ListRow icon={<IconSparkles />} tone="accent" title={t("Start a new analysis")} subtitle={t("Competitors, one account or a brand campaign")} href={newHref} />}
      </div>
    </Card>
  );
}
