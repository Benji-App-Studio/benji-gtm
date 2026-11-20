"use client";
import { useEffect, useMemo, useState } from "react";
import { HOOK_LABEL, PLATFORM_LABEL, ROLE_LABEL, THEME_LABEL, TYPE_COPY, VISUAL_LABEL, type Audience, type Creator, type Platform, type Post, type Project, type Report } from "@/lib/types";
import { peek, refresh } from "@/lib/client-cache";
import { ReportSkeleton } from "./page-skeletons";
import { RecreatePostDialog, ROLE_COLOR } from "./recreate-panel";
import { ScrollRow } from "./scroll-row";
import { Badge, Button, Card, cx, ErrorNote, fmt, PlatformBadge, segmentTrackClass, Stat, tabClass, Thumb } from "./ui";
import { PANEL, PANEL_OVERLAY, PanelPortal } from "./panel-portal";
import { useT } from "@/lib/i18n/client";
import { sentenceGap } from "@/lib/i18n/join";
import { rich } from "./rich";
import { m } from "@/lib/i18n/translate";

type Tab = "overview" | "content" | "playbook" | "audience" | "creators" | "partners" | "competitors";
type Sort = "score" | "converting" | "views" | "velocity";


const median = (values: number[]) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** One run's saved report. Every run keeps its own, so past runs read exactly as they did. */
export function ReportView({ runId, project }: { runId: string; project: Project }) {
  const { t, tn, intl } = useT();
  // A finished report never changes, so one fetched (or preloaded on hover) shows at once.
  const [report, setReport] = useState<Report | null>(() => peek<{ report?: Report }>(`/api/runs/${runId}`)?.report ?? null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [selected, setSelected] = useState<Post | null>(null);
  const [filters, setFilters] = useState<{ platform: string; account: string; format: string; hook: string; sort: Sort; converting: boolean }>({ platform: "", account: "", format: "", hook: "", sort: "score", converting: false });

  useEffect(() => {
    if (peek<{ report?: Report }>(`/api/runs/${runId}`)?.report) return;
    refresh<{ report?: Report; status?: string; message?: string; error?: string }>(`/api/runs/${runId}`).then((run) => {
      if (run.error) return setError(run.error);
      if (!run.report) return setError(run.status === "running" ? t("This run is still going.") : run.message ?? t("This run has no report."));
      setReport(run.report);
    }).catch((e) => setError(String(e)));
  }, [runId, t]);

  // Thumbnails are stored with the run (Supabase storage) and saved as full URLs in its report.
  const thumb = (post: { thumb: string | null }) => post.thumb;
  const formatName = (id: string | null) => report?.formats.find((f) => f.id === id)?.name ?? (id ? id.replace(/_/g, " ") : "–");
  // Keyword-search strays (on-topic below 0.5) never count as competitor content.
  const posts = useMemo(() => (report?.reels ?? []).filter((r) => r.onTopic == null || r.onTopic >= 0.5), [report]);

  const copy = TYPE_COPY[project.type ?? "competitors"];
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!report) return <ReportSkeleton />;

  const openContent = (patch: Partial<typeof filters>) => { setFilters({ ...filters, platform: "", account: "", format: "", hook: "", ...patch }); setTab("content"); };
  const byId = new Map(report.reels.map((r) => [r.id, r]));
  const openPost = (id: string) => { const post = byId.get(id); if (post) setSelected(post); };
  const type = project.type ?? "competitors";
  const tabs: [Tab, string][] = [
    ["overview", t("Overview")], ["content", t("Winning content")], ["playbook", t("Playbook")],
    ...(report.audience ? [["audience", t("Audience")] as [Tab, string]] : []),
    ...(report.creators?.length && type !== "account" ? [["creators", type === "campaign" ? t("Worth rebooking") : t("Creators to work with")] as [Tab, string]] : []),
    ...(report.partners?.length ? [["partners", type === "campaign" ? t("Brand's creators") : t("Creator programs")] as [Tab, string]] : []),
    ["competitors", t(copy.many)],
  ];

  return (
    <div className="@container">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <ScrollRow label={t("Report sections")} className={segmentTrackClass}>
          {tabs.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)} className={tabClass(tab === key)}>{label}</button>
          ))}
        </ScrollRow>
        <span className="text-caption text-muted">{tn(report.sinceDays ?? project.sinceDays, "Last {n} day", "Last {n} days")} · {tn(report.kpis.videos, "{n} post", "{n} posts")} · {t("collected {date}", { date: report.status?.collectedAt ? new Date(report.status.collectedAt).toLocaleDateString(intl) : "–" })}</span>
      </div>

      {tab === "overview" && <Overview type={project.type ?? "competitors"} report={report} posts={posts} thumb={thumb} formatName={formatName} onOpen={openContent} onSelect={setSelected} />}
      {tab === "content" && <Content posts={posts} report={report} filters={filters} setFilters={setFilters} thumb={thumb} formatName={formatName} onSelect={setSelected} />}
      {tab === "playbook" && <Playbook report={report} posts={posts} formatName={formatName} onSelect={setSelected} />}
      {tab === "audience" && report.audience && <AudienceView audience={report.audience} onOpenPost={openPost} />}
      {tab === "partners" && report.partners && <Partners programs={report.partners} byId={byId} thumb={thumb} campaign={type === "campaign"} onOpenPost={openPost} />}
      {tab === "creators" && <Creators creators={report.creators ?? []} byId={byId} thumb={thumb} formatName={formatName} campaign={type === "campaign"} onOpenPost={openPost} />}
      {tab === "competitors" && <Competitors posts={posts} thumb={thumb} onOpen={openContent} onSelect={setSelected} />}

      {selected && <PostDrawer post={selected} thumb={thumb(selected)} formatName={formatName} formats={report.formats} productId={(project as Project & { productId?: string | null }).productId ?? null} onClose={() => setSelected(null)} />}
    </div>
  );
}

// MARK: Overview

function Overview({ type, report, posts, thumb, formatName, onOpen, onSelect }: {
  type: NonNullable<Project["type"]>; report: Report; posts: Post[]; thumb: (p: Post) => string | null; formatName: (id: string | null) => string;
  onOpen: (f: { platform?: string; account?: string }) => void; onSelect: (p: Post) => void;
}) {
  const { t, tn } = useT();
  const accounts = [...new Set(posts.map((p) => p.account))];
  const platforms = [...new Set(posts.map((p) => p.platform))] as Platform[];
  const typical = median(posts.map((p) => p.views));
  const hit = (p: Post) => p.views >= report.hitMultiple * typical;
  const byPlatform = platforms.map((platform) => {
    const items = posts.filter((p) => p.platform === platform);
    return { platform, items, median: median(items.map((p) => p.views)), hitRate: items.filter(hit).length / Math.max(items.length, 1), best: [...items].sort((a, b) => b.score - a.score)[0] };
  }).sort((a, b) => b.hitRate - a.hitRate || b.median - a.median);
  const top = byPlatform[0];
  const converting = posts.filter((p) => (p.buyerIntent ?? 0) >= 0.6);
  const playbook = report.playbook.find((p) => p.platform === top?.platform);

  // Plain-language takeaways from the numbers.
  const takeaways = [
    top && platforms.length > 1 && (type === "competitors" ? t("{channel} is where competitors win most: {pct}% of posts there get {multiple}× the typical views.", { channel: PLATFORM_LABEL[top.platform], pct: Math.round(top.hitRate * 100), multiple: report.hitMultiple })
      : type === "campaign" ? t("{channel} is where the campaign wins most: {pct}% of posts there get {multiple}× the typical views.", { channel: PLATFORM_LABEL[top.platform], pct: Math.round(top.hitRate * 100), multiple: report.hitMultiple })
      : t("{channel} is where it wins most: {pct}% of posts there get {multiple}× the typical views.", { channel: PLATFORM_LABEL[top.platform], pct: Math.round(top.hitRate * 100), multiple: report.hitMultiple })),
    playbook?.formats[0] && t("The strongest format on {channel} is “{format}” (typical {views} views over {posts} posts).", { channel: PLATFORM_LABEL[playbook.platform], format: formatName(playbook.formats[0].id), views: fmt(playbook.formats[0].medianViews), posts: playbook.formats[0].posts }),
    playbook?.hooks[0] && t("Winning posts most often open with this hook: {hook}.", { hook: HOOK_LABEL[playbook.hooks[0].id] ? t(HOOK_LABEL[playbook.hooks[0].id]) : playbook.hooks[0].id }),
    playbook && playbook.ctaWinners > playbook.ctaRest + 0.1 && t("Winners ask for an action more often: {top}% of top posts end with a CTA vs {rest}% of the rest.", { top: Math.round(playbook.ctaWinners * 100), rest: Math.round(playbook.ctaRest * 100) }),
    converting.length > 0 && tn(converting.length, "{n} post has buyers in the comments: people asking for the link, the price or saying they bought.", "{n} posts have buyers in the comments: people asking for the link, the price or saying they bought."),
  ].filter(Boolean) as string[];

  // Competitor × channel grid.
  const grid = accounts.map((account) => {
    const mine = posts.filter((p) => p.account === account);
    return { account, total: mine.length, median: median(mine.map((p) => p.views)), cells: Object.fromEntries(platforms.map((platform) => {
      const items = mine.filter((p) => p.platform === platform);
      return [platform, items.length ? { posts: items.length, median: median(items.map((p) => p.views)), hitRate: items.filter(hit).length / items.length } : null];
    })) as Record<Platform, { posts: number; median: number; hitRate: number } | null> };
  }).sort((a, b) => b.median - a.median).slice(0, 15);

  return (
    <div className="grid gap-4">
      <Card className="flex flex-wrap gap-px overflow-hidden bg-line [&>*]:flex-[1_1_160px]">
        <Stat label={t("Posts read")} value={posts.length} hint={t("of {total} collected", { total: report.kpis.videos })} />
        <Stat label={t(TYPE_COPY[type].many)} value={accounts.length} />
        <Stat label={t("Channels")} value={platforms.length} hint={platforms.map((p) => PLATFORM_LABEL[p]).join(", ")} />
        <Stat label={t("Typical views")} value={fmt(typical)} hint={t("median per post")} />
        <Stat label={t("Best channel")} value={top ? PLATFORM_LABEL[top.platform] : "–"} hint={top ? t("{pct}% hit rate", { pct: Math.round(top.hitRate * 100) }) : ""} />
      </Card>

      {takeaways.length > 0 && (
        <Card className="p-4">
          <p className="eyebrow">{t("What the data says")}</p>
          <ul className="mt-3 grid gap-2.5">
            {takeaways.map((line) => <li key={line} className="flex gap-3 text-sm"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />{line}</li>)}
          </ul>
        </Card>
      )}

      <div>
        <h3 className="mb-2 text-sm font-medium">{t("Channels, ranked")}</h3>
        <div className="grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-3">
          {byPlatform.map(({ platform, items, median: med, hitRate, best }) => (
            <Card key={platform} className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between"><PlatformBadge platform={platform} showBeta /><span className="text-xs text-muted">{tn(items.length, "{n} post", "{n} posts")}</span></div>
              <div className="flex items-end gap-5">
                <div><p className="text-figure font-medium tabular-nums">{fmt(med)}</p><p className="text-xs text-muted">{t("typical views")}</p></div>
                <div><p className="text-figure font-medium tabular-nums">{Math.round(hitRate * 100)}%</p><p className="text-xs text-muted">{t("hit rate")}</p></div>
              </div>
              {best && (
                <button onClick={() => onSelect(best)} className="flex items-center gap-3 rounded-inner bg-raised p-2 text-left hover:bg-hover">
                  <Thumb src={thumb(best)} alt="" className="h-12 w-9 shrink-0 rounded-md" />
                  <span className="min-w-0 text-xs"><span className="block truncate font-medium">{best.account}</span><span className="text-muted">{t("best post · {views} views", { views: fmt(best.views) })}</span></span>
                </button>
              )}
              <Button variant="secondary" size="sm" onClick={() => onOpen({ platform })}>{t("See winning {channel} posts", { channel: PLATFORM_LABEL[platform] })}</Button>
            </Card>
          ))}
        </div>
      </div>

      {type === "account" && <OverTime posts={posts} typical={typical} hitMultiple={report.hitMultiple} formatName={formatName} />}

      <Card className="overflow-x-auto p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-3 pb-2"><h3 className="text-title font-medium">{type === "campaign" ? t("Which creators deliver, where") : t("Who wins where")}</h3><span className="text-xs text-muted">{t("typical views per channel · darker = more hits")}</span></div>
        <table className="w-full text-sm" style={{ minWidth: 190 + platforms.length * 115 }}>
          <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-5 py-2 font-normal">{t(TYPE_COPY[type].one)}</th>{platforms.map((p) => <th key={p} className="px-3 py-2 font-medium">{PLATFORM_LABEL[p]}</th>)}</tr></thead>
          <tbody>
            {grid.map((row) => (
              <tr key={row.account} className="border-b border-line transition last:border-0 hover:bg-raised">
                <td className="px-5 py-2.5"><button onClick={() => onOpen({ account: row.account })} className="font-medium hover:underline">{row.account}</button><span className="ml-2 text-xs text-muted">{tn(row.total, "{n} post", "{n} posts")}</span></td>
                {platforms.map((p) => {
                  const cell = row.cells[p];
                  return (
                    <td key={p} className="px-3 py-2.5">
                      {cell ? (
                        <button onClick={() => onOpen({ account: row.account, platform: p })} className="rounded-md px-2 py-1 tabular-nums transition hover:ring-2 hover:ring-ink/10"
                          style={{ background: `color-mix(in srgb, var(--color-win) ${Math.round((0.06 + cell.hitRate * 0.45) * 100)}%, transparent)` }}>{fmt(cell.median)} <span className="text-xs text-muted">· {cell.posts}</span></button>
                      ) : <span className="text-xs text-faint">{t("not active")}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/** A single account month by month: how much it posted, how it performed, and what worked. */
function OverTime({ posts, typical, hitMultiple, formatName }: { posts: Post[]; typical: number; hitMultiple: number; formatName: (id: string | null) => string }) {
  const months = [...new Set(posts.flatMap((p) => (p.postedAt ? [p.postedAt.slice(0, 7)] : [])))].sort().reverse();
  const { t, intl } = useT();
  if (months.length < 2) return null;
  const peak = Math.max(...months.map((m) => median(posts.filter((p) => p.postedAt?.startsWith(m)).map((p) => p.views))), 1);
  return (
    <Card className="overflow-x-auto p-0">
      <div className="flex items-baseline justify-between px-4 pt-3 pb-2"><h3 className="text-title font-medium">{t("Over time")}</h3><span className="text-xs text-muted">{t("month by month")}</span></div>
      <table className="w-full min-w-[560px] text-sm">
        <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-5 py-2 font-normal">{t("Month")}</th><th className="px-3 py-2 font-normal">{t("Posts")}</th><th className="px-3 py-2 font-normal">{t("Typical views")}</th><th className="px-3 py-2 font-normal">{t("Hit rate")}</th><th className="px-3 py-2 font-normal">{t("What worked")}</th></tr></thead>
        <tbody>
          {months.map((month) => {
            const items = posts.filter((p) => p.postedAt?.startsWith(month));
            const med = median(items.map((p) => p.views));
            const best = [...items].sort((a, b) => b.score - a.score)[0];
            return (
              <tr key={month} className="border-b border-line transition last:border-0 hover:bg-raised">
                <td className="px-5 py-2.5 font-mono text-xs">{new Date(`${month}-01T00:00:00`).toLocaleDateString(intl, { month: "short", year: "numeric" })}</td>
                <td className="px-3 py-2.5 tabular-nums">{items.length}</td>
                <td className="px-3 py-2.5"><div className="flex items-center gap-2"><span className="h-1.5 bg-accent" style={{ width: `${Math.max(4, (med / peak) * 120)}px` }} /><span className="tabular-nums">{fmt(med)}</span></div></td>
                <td className="px-3 py-2.5 tabular-nums">{Math.round((items.filter((p) => p.views >= hitMultiple * typical).length / items.length) * 100)}%</td>
                <td className="px-3 py-2.5 text-xs text-muted">{best ? formatName(best.format) : "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

// MARK: Winning content

function Content({ posts, report, filters, setFilters, thumb, formatName, onSelect }: {
  posts: Post[]; report: Report; filters: { platform: string; account: string; format: string; hook: string; sort: Sort; converting: boolean };
  setFilters: (f: typeof filters) => void; thumb: (p: Post) => string | null; formatName: (id: string | null) => string; onSelect: (p: Post) => void;
}) {
  const { t, tn } = useT();
  const options = (key: (p: Post) => string | null) => [...new Set(posts.map(key).filter(Boolean) as string[])].sort();
  const sortKey: Record<Sort, (p: Post) => number> = {
    score: (p) => p.score, views: (p) => p.views, velocity: (p) => p.viewsPerDay ?? 0,
    converting: (p) => (p.buyerIntent ?? -1) * 2 + p.engagementPer1k / 1000,
  };
  const shown = posts.filter((p) =>
    (!filters.platform || p.platform === filters.platform) && (!filters.account || p.account === filters.account) &&
    (!filters.format || p.format === filters.format) && (!filters.hook || p.hookType === filters.hook) &&
    (!filters.converting || (p.buyerIntent ?? 0) >= 0.6)).sort((a, b) => sortKey[filters.sort](b) - sortKey[filters.sort](a));
  const hasIntent = posts.some((p) => p.buyerIntent != null);
  const select = (label: string, value: string, key: keyof typeof filters, values: string[], name: (v: string) => string) => (
    <label className="flex flex-col gap-1 text-xs text-muted">{label}
      <select value={value} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })} className="h-[30px] rounded-control border border-hairline bg-raised px-2.5 text-sm text-ink">
        <option value="">{t("All")}</option>{values.map((v) => <option key={v} value={v}>{name(v)}</option>)}
      </select>
    </label>
  );

  return (
    <div>
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
        {select(t("Channel"), filters.platform, "platform", options((p) => p.platform), (v) => PLATFORM_LABEL[v as Platform] ?? v)}
        {select(t("Account"), filters.account, "account", options((p) => p.account), (v) => v)}
        {select(t("Format"), filters.format, "format", options((p) => p.format), formatName)}
        {select(t("Hook"), filters.hook, "hook", options((p) => p.hookType), (v) => HOOK_LABEL[v] ? t(HOOK_LABEL[v]) : v)}
        <label className="flex flex-col gap-1 text-xs text-muted">{t("Sort by")}
          <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as Sort })} className="h-[30px] rounded-control border border-hairline bg-raised px-2.5 text-sm text-ink">
            <option value="score">{t("Best overall")}</option>{hasIntent && <option value="converting">{t("Most converting")}</option>}<option value="views">{t("Most views")}</option><option value="velocity">{t("Fastest growing")}</option>
          </select>
        </label>
        {hasIntent && (
          <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={filters.converting} onChange={(e) => setFilters({ ...filters, converting: e.target.checked })} className="size-4 accent-win" />{t("Buyers in comments only")}</label>
        )}
      </Card>
      <p className="mb-3 text-sm text-muted">{tn(shown.length, "{n} post · a “hit” gets {multiple}× the typical views", "{n} posts · a “hit” gets {multiple}× the typical views", { multiple: report.hitMultiple })}</p>
      <div className="grid gap-4 @md:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4">
        {shown.slice(0, 80).map((post, i) => (
          <button key={post.id} onClick={() => onSelect(post)} className="group text-left">
            <Card className="flex h-full flex-col overflow-hidden transition group-hover:border-ink/25 group-hover:shadow-raised">
              <div className="relative">
                {post.platform === "x" || post.platform === "linkedin" ? (
                  <div className="flex aspect-[4/3] items-center bg-raised p-4 text-title font-medium">“{(post.script[0]?.text ?? post.caption).slice(0, 140)}”</div>
                ) : <Thumb src={thumb(post)} alt={post.caption.slice(0, 60)} className="aspect-[4/5] w-full" />}
                <span className="absolute left-2 top-2 rounded-full bg-primary/85 px-2 py-0.5 text-xs font-medium text-on-ink backdrop-blur">#{i + 1}</span>
                <span className="absolute right-2 top-2 rounded-full bg-raised px-2 py-0.5 text-xs font-medium text-ink shadow-raised">{post.score}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5"><span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{post.account}</span><PlatformBadge platform={post.platform} /></div>
                <p className="line-clamp-2 text-xs text-muted">{post.caption.split("\n")[0]}</p>
                <div className="mt-auto flex flex-wrap gap-1">
                  <Badge>{t("{views} views", { views: fmt(post.views) })}</Badge>
                  {(post.buyerIntent ?? 0) >= 0.6 && <Badge tone="win">{t("buyers in comments")}</Badge>}
                  {post.partnerOf && <Badge tone="accent">{t("creator for {brand}", { brand: post.partnerOf })}</Badge>}
                  {post.reasons.slice(0, 1).map((r) => <Badge key={r} tone="highlight">{r}</Badge>)}
                </div>
              </div>
            </Card>
          </button>
        ))}
      </div>
      {shown.length === 0 && <Card className="px-4 py-8 text-center text-sm text-muted">{t("No posts match these filters.")}</Card>}
    </div>
  );
}

// MARK: Playbook

function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  return (
    <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}
      className="h-6 shrink-0 rounded-control border border-hairline px-2 text-xs text-muted hover:bg-hover hover:text-ink">{done ? t("Copied") : label ?? t("Copy")}</button>
  );
}

function Playbook({ report, posts, formatName, onSelect }: { report: Report; posts: Post[]; formatName: (id: string | null) => string; onSelect: (p: Post) => void }) {
  const { t, tn } = useT();
  const byId = new Map(posts.map((p) => [p.id, p]));
  return (
    <div className="grid gap-4">
      <p className="max-w-3xl text-sm text-muted">{t("What the best-performing competitor posts have in common on each channel. Borrow the pattern, not the post: keep the hook shape and structure, put your product and voice in it.")}</p>
      {report.playbook.map((channel) => (
        <section key={channel.platform}>
          <div className="mb-3 flex items-center gap-3"><PlatformBadge platform={channel.platform} showBeta /><span className="text-xs text-muted">{tn(channel.posts, "from {n} post", "from {n} posts")}</span></div>
          <div className="grid gap-4 @4xl:grid-cols-3">
            <Card className="p-4 @4xl:col-span-2">
              <h4 className="text-title font-medium">{t("Hooks to adapt")}</h4>
              <p className="mt-0.5 text-xs text-muted">{t("Opening lines of the top posts, verbatim.")}</p>
              <ul className="mt-4 grid gap-2">
                {channel.examples.filter((e) => e.hook).map((example) => {
                  const post = byId.get(example.id);
                  return (
                    <li key={example.id} className="flex items-start gap-3 rounded-inner border border-line p-3 transition hover:border-ink/20">
                      <button className="min-w-0 flex-1 text-left" onClick={() => post && onSelect(post)}>
                        <p className="text-title">“{example.hook}”</p>
                        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          <span className="font-medium text-ink">{example.account}</span>· {t("{views} views", { views: fmt(example.views) })}
                          {example.hookType && <Badge tone="accent">{HOOK_LABEL[example.hookType] ? t(HOOK_LABEL[example.hookType]) : example.hookType}</Badge>}
                          {example.format && example.format !== "no_clear_format" && <Badge>{formatName(example.format)}</Badge>}
                        </p>
                      </button>
                      <CopyButton text={example.hook} />
                    </li>
                  );
                })}
              </ul>
            </Card>
            <div className="grid content-start gap-4">
              <Card className="p-4">
                <h4 className="text-title font-medium">{t("Formats that win")}</h4>
                <ol className="mt-3 grid gap-2">
                  {channel.formats.length ? channel.formats.map((f, i) => (
                    <li key={f.id} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0"><span className="mr-2 font-mono text-xs text-faint">{i + 1}</span>{formatName(f.id)}</span><span className="shrink-0 text-xs text-muted tabular-nums">{fmt(f.medianViews)} · {f.posts}</span></li>
                  )) : <li className="text-sm text-muted">{t("Not enough posts per format yet.")}</li>}
                </ol>
              </Card>
              <Card className="p-4">
                <h4 className="text-title font-medium">{t("Hook types that win")}</h4>
                <div className="mt-3 flex flex-wrap gap-1.5">{channel.hooks.map((h) => <Badge key={h.id} tone="accent">{HOOK_LABEL[h.id] ? t(HOOK_LABEL[h.id]) : h.id} · {fmt(h.medianViews)}</Badge>)}</div>
              </Card>
              <Card className="p-4">
                <h4 className="text-title font-medium">{t("How winners are built")}</h4>
                <ul className="mt-3 grid gap-2 text-sm">
                  {channel.structures.map((s) => <li key={s.shape} className="flex items-center justify-between gap-2"><span className="font-mono text-xs">{s.shape.split(" → ").map((r) => ROLE_LABEL[r] ? t(ROLE_LABEL[r]) : r).join(" → ")}</span><span className="text-xs text-muted">{s.count}×</span></li>)}
                  <li className="mt-1 text-xs text-muted">{t("CTA in {top}% of winners vs {rest}% of the rest", { top: Math.round(channel.ctaWinners * 100), rest: Math.round(channel.ctaRest * 100) })}</li>
                  {channel.lengths[0] && <li className="text-xs text-muted">{t("Best length: {length}", { length: channel.lengths[0].id })}</li>}
                  {channel.intentWinners != null && <li className="text-xs text-muted">{t("Buying intent in winners' comments: {pct}%", { pct: Math.round(channel.intentWinners * 100) })}</li>}
                </ul>
              </Card>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

// MARK: Competitors

function Competitors({ posts, thumb, onOpen, onSelect }: { posts: Post[]; thumb: (p: Post) => string | null; onOpen: (f: { account?: string }) => void; onSelect: (p: Post) => void }) {
  const { t, tn } = useT();
  const typical = median(posts.map((p) => p.views));
  const rows = [...new Set(posts.map((p) => p.account))].map((account) => {
    const mine = posts.filter((p) => p.account === account).sort((a, b) => b.score - a.score);
    return { account, mine, median: median(mine.map((p) => p.views)), hitRate: mine.filter((p) => p.views >= 2 * typical).length / mine.length, platforms: [...new Set(mine.map((p) => p.platform))] as Platform[] };
  }).sort((a, b) => b.median - a.median);
  return (
    <div className="grid gap-3">
      {rows.map((row) => (
        <Card key={row.account} className="flex flex-col gap-4 p-4 @2xl:flex-row @2xl:items-center">
          <div className="min-w-0 @2xl:w-64 @2xl:shrink-0">
            <button onClick={() => onOpen({ account: row.account })} className="truncate font-medium hover:underline">{row.account}</button>
            <div className="mt-1.5 flex flex-wrap gap-2">{row.platforms.map((p) => <PlatformBadge key={p} platform={p} />)}</div>
            <p className="mt-2 text-xs text-muted">{tn(row.mine.length, "{n} post · typical {views} views · {pct}% hits", "{n} posts · typical {views} views · {pct}% hits", { views: fmt(row.median), pct: Math.round(row.hitRate * 100) })}</p>
          </div>
          <ScrollRow className="flex min-w-0 flex-1 gap-2">
            {row.mine.slice(0, 6).map((post) => (
              <button key={post.id} onClick={() => onSelect(post)} className="relative shrink-0" title={post.caption.slice(0, 80)}>
                {post.platform === "x" || post.platform === "linkedin"
                  ? <div className="flex h-28 w-36 items-center rounded-small bg-raised p-2 text-left text-xs leading-snug">{(post.script[0]?.text ?? post.caption).slice(0, 90)}</div>
                  : <Thumb src={thumb(post)} alt="" className="h-28 w-[84px] rounded-small" />}
                <span className="absolute bottom-1 left-1 rounded bg-ink/80 px-1 font-mono text-xs text-on-ink">{fmt(post.views)}</span>
              </button>
            ))}
          </ScrollRow>
        </Card>
      ))}
    </div>
  );
}

// MARK: Audience

/** What commenters ask for, object to and talk about: content ideas straight from the audience. */
function AudienceView({ audience, onOpenPost }: { audience: Audience; onOpenPost: (id: string) => void }) {
  const { t, tn } = useT();
  if (!audience.total) {
    return (
      <Card className="px-4 py-8 text-center">
        <p className="font-medium">{t("No comments read in this run")}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">{t("Turn on “Read more comments” and run it again: up to 25 comments are read on each channel's most-viewed posts and sorted into what buyers want, ask and doubt.")}</p>
      </Card>
    );
  }
  const theme = (id: string) => audience.themes.find((x) => x.theme === id);
  const label = (id: string | null) => (id ? (THEME_LABEL[id] ? t(THEME_LABEL[id].label) : id.replace(/_/g, " ")) : "–");
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const ideas = [
    { id: "how_question", title: t("Answer these in a post"), body: t("People asking how it works are buyers who need one more step. A how-to post answering them is the easiest content to make next.") },
    { id: "objection", title: t("Handle these objections"), body: t("Each objection is a post: name the doubt in the hook, then show why it doesn't apply.") },
    { id: "feature_request", title: t("What they wish existed"), body: t("If your product does this, lead with it. Competitors' audiences are asking for it.") },
    { id: "relates", title: t("The pains they recognise"), body: t("Lines that make people say “this is me”. Reuse their words in your hooks.") },
  ].map((idea) => ({ ...idea, theme: theme(idea.id) })).filter((idea) => idea.theme && idea.theme.examples.length);
  const platforms = Object.keys(audience.byPlatform) as Platform[];
  const topThemes = audience.themes.filter((x) => x.theme !== "other").slice(0, 5);

  return (
    <div className="grid gap-4">
      <Card className="flex flex-wrap gap-px overflow-hidden bg-line [&>*]:flex-[1_1_160px]">
        <Stat label={t("Comments read")} value={fmt(audience.total)} hint={tn(audience.posts, "on {n} post", "on {n} posts")} />
        <Stat label={t("Want to buy")} value={pct(theme("buy_intent")?.share ?? 0)} hint={t("link, price, “just ordered”")} tone="win" />
        <Stat label={t("Asking how")} value={pct(theme("how_question")?.share ?? 0)} hint={t("questions about using it")} />
        <Stat label={t("Doubting")} value={pct((theme("objection")?.share ?? 0) + (theme("skeptic")?.share ?? 0))} hint={t("objections and skeptics")} />
      </Card>

      <Card className="p-4">
        <p className="eyebrow">{t("What the audience is saying")}</p>
        <ul className="mt-4 grid gap-3">
          {audience.themes.map((row) => (
            <li key={row.theme} className="grid gap-1 @xl:grid-cols-[200px_1fr_48px] @xl:items-center @xl:gap-4">
              <span className="text-sm font-medium">{label(row.theme)} <span className="block text-xs font-normal text-muted">{THEME_LABEL[row.theme] ? t(THEME_LABEL[row.theme].hint) : null}</span></span>
              <span className="h-2 bg-raised"><span className={cx("block h-2", row.theme === "buy_intent" ? "bg-win" : row.theme === "objection" || row.theme === "skeptic" ? "bg-warn" : "bg-accent")} style={{ width: `${Math.max(2, row.share * 100)}%` }} /></span>
              <span className="text-right text-sm tabular-nums">{pct(row.share)}</span>
            </li>
          ))}
        </ul>
      </Card>

      {ideas.length > 0 && (
        <div>
          <h3 className="mb-1 text-title font-medium">{t("Content ideas from the comments")}</h3>
          <p className="mb-3 text-sm text-muted">{t("Real comments from the best posts. Each one is a post you can make yourself.")}</p>
          <div className="grid gap-4 @4xl:grid-cols-2">
            {ideas.map((idea) => (
              <Card key={idea.id} className="p-4">
                <div className="flex items-baseline justify-between gap-3"><h4 className="text-title font-medium">{idea.title}</h4><span className="text-xs text-muted">{tn(idea.theme!.count, "{n} comment", "{n} comments")}</span></div>
                <p className="mt-1 text-xs text-muted">{idea.body}</p>
                <ul className="mt-3 grid gap-2">
                  {idea.theme!.examples.map((example, i) => (
                    <li key={i}>
                      <button onClick={() => onOpenPost(example.postId)} className="w-full rounded-inner border border-line bg-raised p-3 text-left transition hover:border-ink/25">
                        <p className="text-sm leading-snug">“{example.text}”</p>
                        <p className="mt-1.5 flex items-center gap-2 text-xs text-muted"><PlatformBadge platform={example.platform} />{t("on {account}", { account: example.account })}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </div>
      )}

      {platforms.length > 1 && (
        <Card className="overflow-x-auto p-0">
          <div className="px-4 pt-3 pb-2"><h3 className="text-title font-medium">{t("By channel")}</h3><p className="text-xs text-muted">{t("Share of each channel's comments")}</p></div>
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-5 py-2 font-normal">{t("Channel")}</th><th className="px-3 py-2 font-normal">{t("Comments")}</th>{topThemes.map((x) => <th key={x.theme} className="px-3 py-2 font-medium">{label(x.theme)}</th>)}</tr></thead>
            <tbody>
              {platforms.map((platform) => {
                const row = audience.byPlatform[platform]!;
                return (
                  <tr key={platform} className="border-b border-line transition last:border-0 hover:bg-raised">
                    <td className="px-5 py-2.5"><PlatformBadge platform={platform} /></td>
                    <td className="px-3 py-2.5 tabular-nums">{row.total}</td>
                    {topThemes.map((x) => <td key={x.theme} className="px-3 py-2.5 tabular-nums">{pct(row.themes[x.theme] ?? 0)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {audience.byAccount.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <div className="px-4 pt-3 pb-2"><h3 className="text-title font-medium">{t("Whose audience is buying")}</h3><p className="text-xs text-muted">{t("Accounts with at least 3 comments read, most buyers first")}</p></div>
          <table className="w-full min-w-[620px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-5 py-2 font-normal">{t("Account")}</th><th className="px-3 py-2 font-normal">{t("Comments")}</th><th className="px-3 py-2 font-normal">{t("Want to buy")}</th><th className="px-3 py-2 font-normal">{t("Asking how")}</th><th className="px-3 py-2 font-normal">{t("Objections")}</th><th className="px-3 py-2 font-normal">{t("Mostly")}</th></tr></thead>
            <tbody>
              {audience.byAccount.map((row) => (
                <tr key={row.account} className="border-b border-line transition last:border-0 hover:bg-raised">
                  <td className="px-5 py-2.5 font-medium">{row.account}</td>
                  <td className="px-3 py-2.5 tabular-nums">{row.total}</td>
                  <td className="px-3 py-2.5 tabular-nums">{pct(row.buyShare)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{pct(row.questionShare)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{pct(row.objectionShare)}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{label(row.topTheme)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// MARK: Creators

/** Creators worth working with: reliable hits, buyers in their comments, reach beyond their size. */
function Creators({ creators, byId, thumb, formatName, campaign, onOpenPost }: {
  creators: Creator[]; byId: Map<string, Post>; thumb: (p: Post) => string | null; formatName: (id: string | null) => string; campaign: boolean; onOpenPost: (id: string) => void;
}) {
  const { t, locale } = useT();
  return (
    <div className="grid gap-4">
      <p className="max-w-3xl text-sm text-muted">
        {campaign ? t("The creators who delivered for this brand, ranked.") : t("Creators already making winning content for your buyers. They aren't your competitors: they're people to partner with, sponsor or send your product to.")}
        {sentenceGap(locale)}{t("Ranked by how often they beat the typical post, buyers in their comments, and reach for their size (smaller accounts with big hits rank higher: cheaper to work with).")}
      </p>
      {/* Narrower spaces get one card per creator; the full table needs about 900px. */}
      <ol className="grid gap-3 @lg:grid-cols-2 @4xl:hidden">
        {creators.map((creator, i) => {
          const best = byId.get(creator.bestReel);
          return (
            <li key={`${creator.platform}:${creator.owner}`}>
              <Card className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="w-5 shrink-0 font-mono text-xs text-faint">{i + 1}</span>
                    <span className="min-w-0"><span className="block truncate font-medium">{creator.account}</span><PlatformBadge platform={creator.platform} /></span>
                  </span>
                  <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-xs font-medium shadow-raised" title={t("Fit")}>{creator.score}</span>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  {([[t("Followers"), fmt(creator.followers)], [t("Typical views"), fmt(creator.medianViews)], [t("Hit rate"), `${Math.round(creator.hitRate * 100)}%`], [t("Posts"), String(creator.posts)], [t("Buyers"), creator.medianIntent == null ? "–" : `${Math.round(creator.medianIntent * 100)}%`], [t("Reach"), creator.viewsPerFollower != null ? `${creator.viewsPerFollower.toFixed(1)}×` : "–"]] as [string, string][]).map(([label, value]) => (
                    <div key={label} className="min-w-0"><dt className="truncate text-muted">{label}</dt><dd className="text-sm font-medium tabular-nums">{value}</dd></div>
                  ))}
                </dl>
                <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3">
                  {best ? (
                    <button onClick={() => onOpenPost(best.id)} className="flex min-w-0 items-center gap-2 text-left hover:underline">
                      {best.platform !== "x" && best.platform !== "linkedin" && <Thumb src={thumb(best)} alt="" className="h-10 w-8 shrink-0" />}
                      <span className="min-w-0 text-xs"><span className="block tabular-nums">{t("Best: {views} views", { views: fmt(creator.bestViews) })}</span><span className="block truncate text-muted">{formatName(creator.topFormat)}</span></span>
                    </button>
                  ) : <span />}
                  <a href={creator.profileUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-accent hover:underline">{t("Profile")} ↗</a>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
      <Card className="hidden overflow-x-auto p-0 @4xl:block">
        <table className="w-full min-w-[820px] text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-muted">
            <th className="px-5 py-3 font-normal">{t("Creator")}</th><th className="px-3 py-3 font-normal">{t("Followers")}</th><th className="px-3 py-3 font-normal">{t("Posts")}</th>
            <th className="px-3 py-3 font-normal">{t("Typical views")}</th><th className="px-3 py-3 font-normal">{t("Hit rate")}</th><th className="px-3 py-3 font-normal">{t("Buyers")}</th>
            <th className="px-3 py-3 font-normal">{t("Best post")}</th><th className="px-3 py-3 font-normal">{t("Fit")}</th><th className="px-3 py-3" />
          </tr></thead>
          <tbody>
            {creators.map((creator, i) => {
              const best = byId.get(creator.bestReel);
              return (
                <tr key={`${creator.platform}:${creator.owner}`} className="border-b border-line transition last:border-0 hover:bg-raised">
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-3"><span className="w-5 font-mono text-xs text-faint">{i + 1}</span>
                      <span className="min-w-0"><span className="block truncate font-medium">{creator.account}</span><PlatformBadge platform={creator.platform} /></span>
                    </span>
                  </td>
                  <td className="px-3 py-3 tabular-nums">{fmt(creator.followers)}</td>
                  <td className="px-3 py-3 tabular-nums">{creator.posts}</td>
                  <td className="px-3 py-3 tabular-nums">{fmt(creator.medianViews)}{creator.viewsPerFollower != null && creator.viewsPerFollower >= 1 && <span className="block text-xs text-win">{t("{multiple}× followers", { multiple: creator.viewsPerFollower.toFixed(1) })}</span>}</td>
                  <td className="px-3 py-3 tabular-nums">{Math.round(creator.hitRate * 100)}%</td>
                  <td className="px-3 py-3 tabular-nums">{creator.medianIntent == null ? <span className="text-xs text-faint">–</span> : `${Math.round(creator.medianIntent * 100)}%`}</td>
                  <td className="px-3 py-3">
                    {best && (
                      <button onClick={() => onOpenPost(best.id)} className="flex items-center gap-2 text-left hover:underline">
                        {best.platform !== "x" && best.platform !== "linkedin" && <Thumb src={thumb(best)} alt="" className="h-10 w-8 shrink-0" />}
                        <span className="text-xs"><span className="block tabular-nums">{t("{views} views", { views: fmt(creator.bestViews) })}</span><span className="text-muted">{formatName(creator.topFormat)}</span></span>
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-3"><span className="rounded-full bg-raised px-2 py-0.5 text-xs font-medium shadow-raised">{creator.score}</span></td>
                  <td className="px-3 py-3 text-right"><a href={creator.profileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">{t("Profile")} ↗</a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// MARK: Partners

const SIGNAL = {
  collab: { label: m("Collab"), hint: m("a collab post with the brand as co-author"), tone: "accent" },
  paid: { label: m("Paid label"), hint: m("Instagram's paid-partnership label"), tone: "highlight" },
  bio: { label: m("Bio"), hint: m("their bio declares the tie (athlete, ambassador, a discount code…)"), tone: "win" },
  tagged: { label: m("Tagged"), hint: m("posts tagging the brand"), tone: "neutral" },
  mentioned: { label: m("Mentioned"), hint: m("posts @mentioning the brand in the caption"), tone: "neutral" },
} as const;

/** The creators posting for each brand, and the public signals that show it. */
function Partners({ programs, byId, thumb, campaign, onOpenPost }: {
  programs: NonNullable<Report["partners"]>; byId: Map<string, Post>; thumb: (p: Post) => string | null; campaign: boolean; onOpenPost: (id: string) => void;
}) {
  const { t, tn, locale } = useT();
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        <p className="max-w-3xl text-sm text-muted">
          {campaign ? t("Everyone posting for this brand, including creators you didn't list.") : t("Who creates for each competitor: the people to study, or to approach yourself.")}
          {sentenceGap(locale)}{rich(t("{confirmed} means a collab post, the paid-partnership label or a bio that declares the tie. {likely} means they tag or mention the brand."), {
            confirmed: <b className="font-medium text-ink">{t("Confirmed")}</b>, likely: <b className="font-medium text-ink">{t("Likely")}</b>,
          })}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {(Object.keys(SIGNAL) as (keyof typeof SIGNAL)[]).map((key) => <span key={key} className="flex items-center gap-1.5 text-muted"><Badge tone={SIGNAL[key].tone}>{t(SIGNAL[key].label)}</Badge>{t(SIGNAL[key].hint)}</span>)}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmedOnly} onChange={(e) => setConfirmedOnly(e.target.checked)} className="size-4 accent-ink" />{t("Confirmed partners only")}</label>
      </div>
      {programs.map((program) => {
        const creators = program.creators.filter((c) => !confirmedOnly || c.strength === "confirmed");
        const confirmed = program.creators.filter((c) => c.strength === "confirmed").length;
        return (
          <section key={program.handle}>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-title font-medium">{program.brand} <a href={`https://www.instagram.com/${program.handle}/`} target="_blank" rel="noopener noreferrer" className="text-sm font-normal text-muted hover:text-ink">@{program.handle} ↗</a></h3>
              <span className="text-xs text-muted">{tn(program.creators.length, "{n} creator", "{n} creators")} · {t("{n} confirmed", { n: confirmed })} · {tn(program.posts, "{n} linked post", "{n} linked posts")}</span>
            </div>
            {creators.length === 0 ? (
              <Card className="p-4 text-sm text-muted">{program.creators.length ? t("No confirmed partners yet: only creators who tag the brand.") : t("No creators tagged or collaborated with @{handle} in this period.", { handle: program.handle })}</Card>
            ) : (
              <ol className="grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-3">
                {creators.map((creator, i) => {
                  const best = creator.bestPost ? byId.get(creator.bestPost) : undefined;
                  const chips = ([["collab", creator.signals.collab], ["paid", creator.signals.paid], ["bio", creator.signals.bio != null && creator.signals.bio >= 0.5 ? 1 : 0], ["tagged", creator.signals.tagged], ["mentioned", creator.signals.mentioned]] as [keyof typeof SIGNAL, number][]).filter(([, n]) => n > 0);
                  return (
                    <li key={creator.handle} className="rise" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
                      <Card className="flex h-full flex-col gap-3 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block font-medium [overflow-wrap:anywhere]">{creator.account}{creator.verified && <span className="ml-1 text-accent" title={t("Verified")}>✓</span>}</span>
                            <span className="text-xs text-muted">{creator.followers != null ? `${t("{n} followers", { n: fmt(creator.followers) })} · ` : ""}{tn(creator.posts, "{n} post", "{n} posts")}</span>
                          </span>
                          <Badge tone={creator.strength === "confirmed" ? "win" : "neutral"}>{creator.strength === "confirmed" ? t("confirmed") : t("likely")}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-1">{chips.map(([key, n]) => <Badge key={key} tone={SIGNAL[key].tone}>{t(SIGNAL[key].label)}{key !== "bio" && n > 1 ? ` ×${n}` : ""}</Badge>)}</div>
                        {creator.bio && <p className="line-clamp-3 border-l-2 border-line pl-3 text-xs text-muted whitespace-pre-line">{creator.bio}</p>}
                        <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3">
                          {best ? (
                            <button onClick={() => onOpenPost(best.id)} className="flex min-w-0 items-center gap-2 text-left hover:underline">
                              {best.platform !== "x" && best.platform !== "linkedin" && <Thumb src={thumb(best)} alt="" className="h-10 w-8 shrink-0" />}
                              <span className="min-w-0 text-xs"><span className="block tabular-nums">{t("Best: {views} views", { views: fmt(creator.bestViews) })}</span><span className="block text-muted">{t("open the breakdown")}</span></span>
                            </button>
                          ) : <span className="text-xs text-muted">{creator.bestViews ? t("{views} views", { views: fmt(creator.bestViews) }) : t("Image posts only")}</span>}
                          <a href={creator.profileUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-accent hover:underline">{t("Profile")} ↗</a>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** A post's public ties to brands: collab co-authors, the paid label, tagged accounts and @mentions. */
function PostTies({ post }: { post: Post }) {
  const { t } = useT();
  // `strong`: a declared tie (found as a creator, a collab, the paid label) rather than a tag or a mention.
  const ties = [
    ...(post.partnerOf ? [{ text: t("Found as a creator for {brand}", { brand: post.partnerOf }), strong: true }] : []),
    ...(post.coauthors ?? []).map((c) => ({ text: t("Collab with @{handle}", { handle: c }), strong: true })),
    ...(post.paidPartnership ? [{ text: t("Paid partnership label"), strong: true }] : []),
    ...(post.taggedUsers ?? []).slice(0, 6).map((u) => ({ text: t("Tags @{handle}", { handle: u }), strong: false })),
    ...(post.mentions ?? []).slice(0, 6).map((u) => ({ text: t("Mentions @{handle}", { handle: u }), strong: false })),
  ].filter((tie, i, all) => all.findIndex((x) => x.text === tie.text) === i);
  if (!ties.length) return null;
  return (
    <div>
      <p className="eyebrow">{t("Brand ties")}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">{ties.map((tie) => <Badge key={tie.text} tone={tie.strong ? "accent" : "neutral"}>{tie.text}</Badge>)}</div>
    </div>
  );
}

// MARK: Post drawer

const HOOK_TEMPLATE: Record<string, string> = {
  question: m("Ask the question your buyer is already asking themselves: “Why does [their problem] keep happening?”"),
  bold_claim: m("State your strongest claim flatly, no warm-up: “[Result] without [the usual pain].”"),
  number_list: m("Promise a count and deliver it in order: “[N] [things] that [outcome].”"),
  story: m("Start in the middle of a story: “Last [time], I [moment that went wrong]…”"),
  pov: m("Set the scene in one line: “POV: you [a situation your buyer knows too well].”"),
  warning: m("Warn them off a common mistake: “Stop [mistake] before [consequence].”"),
  news: m("Lead with what changed: “[New thing] just changed. Here's what it means for [audience].”"),
  how_to: m("Name the outcome and how fast: “How to [outcome] in [time or steps].”"),
  curiosity_gap: m("Tease the answer and hold it back: “Nobody tells you this about [topic]…”"),
  other: m("Keep the shape of its opening line and swap in your product and audience."),
};

const ROLE_TEMPLATE: Record<string, string> = {
  setup: m("Name the problem in your buyer's own words."),
  product: m("Bring your product in as the fix. Show it working, don't describe it."),
  method: m("Walk through the steps, one per beat."),
  benefit: m("Say what changes for them: time, money or stress saved."),
  proof: m("Show proof: a result, a number, a review or the screen itself."),
  cta: m("Tell them exactly what to do next (comment a word, tap the link, save it)."),
  other: m("A bridge line to the next beat."),
};

const SHOT_TIP: Record<string, string> = {
  talking_head: m("Phone at eye level, you talking straight to camera."),
  screen_demo: m("Screen recording of the product doing the thing, zoomed in."),
  product_shot: m("Close-up of the product in hand or in use."),
  text_on_screen: m("Big text over a simple background; the words carry it."),
  broll: m("Scenery or everyday footage under the voice-over."),
  proof_shot: m("Screenshot or footage of the result: numbers, reviews, before/after."),
  reaction: m("Your face reacting to what's on screen."),
  skit: m("A short acted scene: you playing the buyer, or two characters."),
};

/** Everything about one post, plus a free, code-built breakdown to make your own version (no generation). */
function PostDrawer({ post, thumb, formatName, formats, productId, onClose }: { post: Post; thumb: string | null; formatName: (id: string | null) => string; formats: Report["formats"]; productId: string | null; onClose: () => void }) {
  const { t, tn } = useT();
  const [recreating, setRecreating] = useState(false);
  const [allComments, setAllComments] = useState(false);
  const textPost = post.platform === "x" || post.platform === "linkedin";
  const lines = post.script.filter((l) => l.role);
  const hook = post.script[0]?.text ?? post.caption.split("\n")[0];
  const time = (s?: number | null) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
  const comments = post.commentList ?? [];

  return (
    <PanelPortal onClose={onClose}>
    <div className={`${PANEL_OVERLAY} z-40`} onClick={onClose}>
      <aside className={`${PANEL} max-w-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex h-11 items-center justify-between border-b border-line bg-card px-4">
          <div className="flex items-center gap-2"><PlatformBadge platform={post.platform} /><span className="text-xs text-muted">{post.postedAt?.slice(0, 10)}</span>{post.niche && <Badge>{t("niche")}</Badge>}</div>
          <button onClick={onClose} className="grid size-7 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink" aria-label={t("Close")}>✕</button>
        </div>
        <div className="grid gap-4 p-4">
          <div className="flex gap-4">
            {!textPost && <Thumb src={thumb} alt="" className="h-40 w-28 shrink-0" />}
            <div className="min-w-0">
              <p className="font-medium">{post.account}</p>
              <p className="mt-1 line-clamp-6 text-sm whitespace-pre-line text-muted">{post.caption}</p>
              <a href={post.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-accent hover:underline">{t("Open original")} ↗</a>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-inner border border-line bg-line text-center">
            {[[t("Views"), fmt(post.views)], [t("Likes"), fmt(post.likes)], [t("Comments"), fmt(post.comments)], [t("Score"), String(post.score)], [t("vs creator"), post.outlier != null ? `${post.outlier.toFixed(1)}×` : "–"], [t("Views/day"), fmt(post.viewsPerDay)]].map(([label, value]) => (
              <div key={label} className="bg-card px-2 py-3"><p className="text-title font-medium tabular-nums">{value}</p><p className="text-xs text-muted">{label}</p></div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {post.format && <Badge tone="neutral">{formatName(post.format)}</Badge>}
            {post.hookType && <Badge tone="accent">{t("Hook: {type}", { type: HOOK_LABEL[post.hookType] ? t(HOOK_LABEL[post.hookType]) : post.hookType })}</Badge>}
            {(post.buyerIntent ?? 0) >= 0.6 && <Badge tone="win">{t("buyers in comments")}</Badge>}
            {post.reasons.map((r) => <Badge key={r} tone="highlight">{r}</Badge>)}
          </div>
          <PostTies post={post} />

          <Recreate post={post} hook={hook} textPost={textPost} formatName={formatName} time={time} onRecreate={() => setRecreating(true)} />
          {recreating && <RecreatePostDialog post={post} formats={formats} productId={productId} onClose={() => setRecreating(false)} />}

          {lines.length > 0 && !textPost && (
            <div>
              <p className="eyebrow">{t("Full script")}</p>
              <ol className="mt-3 grid gap-2">
                {lines.map((l, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className={cx("mt-1.5 size-2 shrink-0", ROLE_COLOR[l.role ?? "other"])} />
                    <span><span className="mr-2 font-mono text-xs uppercase text-muted">{time(l.start)} {t(ROLE_LABEL[l.role ?? "other"] ?? ROLE_LABEL.other)}</span>{" "}{l.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {comments.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between"><p className="eyebrow">{t("What commenters said")}</p><span className="text-xs text-muted">{t("{n} read", { n: comments.length })}</span></div>
              <CommentGroups comments={comments} all={allComments} />
              {comments.length > 6 && <button onClick={() => setAllComments(!allComments)} className="mt-3 text-xs text-accent hover:underline">{allComments ? t("Show fewer") : t("Show all {n} comments", { n: comments.length })}</button>}
            </div>
          )}
        </div>
      </aside>
    </div>
    </PanelPortal>
  );
}

function CommentGroups({ comments, all }: { comments: { text: string; theme: string | null }[]; all: boolean }) {
  const { t } = useT();
  const order = Object.keys(THEME_LABEL);
  const groups = [...new Set(comments.map((c) => c.theme ?? "other"))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const sorted = comments.some((c) => c.theme);
  if (!sorted) return <ul className="mt-3 grid gap-1.5">{comments.slice(0, all ? undefined : 6).map((c, i) => <li key={i} className="border-l-2 border-line pl-3 text-sm">{c.text}</li>)}</ul>;
  return (
    <div className="mt-3 grid gap-4">
      {groups.map((group) => {
        const list = comments.filter((c) => (c.theme ?? "other") === group);
        return (
          <div key={group}>
            <p className="text-xs font-medium">{THEME_LABEL[group] ? t(THEME_LABEL[group].label) : group} <span className="text-muted">· {list.length}</span></p>
            <ul className="mt-1.5 grid gap-1.5">
              {list.slice(0, all ? undefined : 2).map((c, i) => <li key={i} className={cx("border-l-2 pl-3 text-sm", group === "buy_intent" ? "border-win" : group === "objection" || group === "skeptic" ? "border-warn" : "border-line")}>{c.text}</li>)}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** A free breakdown to make your own version: built by code from what Jev already decoded. */
function Recreate({ post, hook, textPost, formatName, time, onRecreate }: { post: Post; hook: string; textPost: boolean; formatName: (id: string | null) => string; time: (s?: number | null) => string; onRecreate: () => void }) {
  const { t, tn, intl, locale } = useT();
  const script = post.script.filter((l) => l.text);
  const hookTip = HOOK_TEMPLATE[post.hookType ?? "other"] ?? HOOK_TEMPLATE.other;
  const posted = post.postedAt ? new Date(post.postedAt) : null;
  const hashtags = post.hashtags?.length ? post.hashtags : post.caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];

  // The opening line is always the hook. After it, consecutive lines with the same role form one beat
  // (filler lines join the beat before them), timed from their start to the next beat's.
  type Beat = { role: string; from: number | null; to: number | null; text: string[]; visual: string | null };
  const beats: Beat[] = [];
  script.forEach((line, i) => {
    const role = i === 0 ? "hook" : line.role ?? "other";
    const last = beats[beats.length - 1];
    const next = script[i + 1]?.start ?? post.durationSec ?? null;
    if (i > 0 && last && (last.role === role || role === "other")) { last.text.push(line.text); last.to = next; if (!last.visual && line.visual) last.visual = line.visual; }
    else beats.push({ role, from: line.start ?? null, to: next, text: [line.text], visual: line.visual ?? null });
  });
  const firstOfRole = new Set(beats.map((b) => beats.findIndex((x) => x.role === b.role)));
  const [allBeats, setAllBeats] = useState(false);
  const tip = (role: string) => t(role === "hook" ? hookTip : ROLE_TEMPLATE[role] ?? ROLE_TEMPLATE.other);
  const roleName = (role: string) => (ROLE_LABEL[role] ? t(ROLE_LABEL[role]) : role);
  const visualName = (visual: string) => (VISUAL_LABEL[visual] ? t(VISUAL_LABEL[visual]) : visual);
  const span = (b: Beat) => (b.from != null && b.to != null ? `${time(b.from)}–${time(b.to)}` : "");
  const words = script.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
  const hookBeat = beats[0];
  const hookSeconds = hookBeat?.from != null && hookBeat.to != null ? hookBeat.to - hookBeat.from : null;
  const cta = script.findIndex((l) => l.role === "cta");
  const silent = !textPost && script.length === 0;

  const facts: [string, string][] = textPost ? (() => {
    const text = post.caption;
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim()).length;
    const firstLine = text.split("\n")[0] ?? "";
    const lineCount = text.split("\n").filter((l) => l.trim()).length;
    return [
      [t("Length"), t("{chars} characters · {words} words", { chars: text.length, words: text.split(/\s+/).filter(Boolean).length })],
      [t("Layout"), `${tn(paragraphs, "{lines} lines in {n} block", "{lines} lines in {n} blocks", { lines: lineCount })}${paragraphs > 2 ? `${sentenceGap(locale)}${t("(short, spaced out)")}` : ""}`],
      [t("First line"), `${tn(firstLine.length, "{n} character", "{n} characters")}${firstLine.length <= 60 ? `${sentenceGap(locale)}${t("(fits before “see more”)")}` : ""}`],
      [t("Ends with"), cta >= 0 ? t("a call to action") : /\?\s*$/.test(text.trim()) ? t("a question to the reader") : t("no ask")],
      [t("Links"), /https?:\/\/|www\./.test(text) ? t("has a link in the post") : t("no link in the post")],
      [t("Hashtags"), hashtags.length ? `${hashtags.length}: ${hashtags.slice(0, 5).join(" ")}` : t("none")],
    ];
  })() : [
    [t("Length"), post.durationSec ? tn(Math.round(post.durationSec), "{n} second", "{n} seconds") : "–"],
    [t("Hook"), hookSeconds != null ? t("first {seconds}s", { seconds: hookSeconds.toFixed(1) }) : tn(hook.split(/\s+/).filter(Boolean).length, "{n} word", "{n} words")],
    ...(silent ? [[t("Voice"), t("no speech: music and on-screen text")]] as [string, string][] : [
      [t("Pace"), post.durationSec && words ? t("{n} words a minute", { n: Math.round((words / post.durationSec) * 60) }) : "–"],
      [t("Product shows up"), post.brandMoment ? post.brandMoment.start != null ? t("at {time} (line {line} of {of})", { time: time(post.brandMoment.start), line: post.brandMoment.sentence, of: post.brandMoment.of }) : t("line {line} of {of}", { line: post.brandMoment.sentence, of: post.brandMoment.of }) : t("never named")],
      [t("Ask (call to action)"), cta >= 0 ? script[cta].start != null ? t("CTA at {time}", { time: time(script[cta].start) }) : t("CTA in line {line}", { line: cta + 1 }) : t("no CTA")],
    ] as [string, string][]),
    [t("Caption"), `${tn(post.caption.length, "{n} character", "{n} characters")} · ${tn(hashtags.length, "{n} hashtag", "{n} hashtags")}`],
  ];
  if (posted) facts.push([t("Posted"), t("{day} around {time} (your time)", { day: posted.toLocaleDateString(intl, { weekday: "long" }), time: posted.toLocaleTimeString(intl, { hour: "numeric" }) })]);

  const outline = [
    t("{format} · modelled on {account} ({views} views)", { format: formatName(post.format), account: post.account, views: fmt(post.views) }),
    "",
    ...beats.map((b) => `${roleName(b.role).toUpperCase()}${span(b) ? ` (${span(b)})` : ""}${b.visual ? ` [${visualName(b.visual)}]` : ""}\n  ${t("Them: “{text}”", { text: b.text.join(" ").slice(0, 200) })}\n  ${t("You: {tip}", { tip: tip(b.role) })}`),
  ].join("\n");

  return (
    <section className="overflow-hidden rounded-inner border border-line bg-raised">
      <div className="flex items-start justify-between gap-3 border-b border-line bg-card px-4 py-3">
        <div><p className="text-sm font-medium">{t("Make your own version")}</p><p className="text-xs text-muted">{t("Free: the post broken down so you can recreate it yourself. No generation, no credits.")}</p></div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {beats.length > 0 && <CopyButton text={outline} label={t("Copy outline")} />}
          <button onClick={onRecreate} className="h-7 shrink-0 rounded-full bg-accent-fill px-3 text-xs font-medium text-on-accent hover:bg-accent-fill/90">{t("Recreate for my app")}</button>
        </div>
      </div>
      <div className="grid gap-4 p-4">
        <div className="bg-raised p-4">
          <div className="flex items-start justify-between gap-3"><p className="eyebrow">{t("The hook")}{post.hookType ? ` · ${HOOK_LABEL[post.hookType] ? t(HOOK_LABEL[post.hookType]) : post.hookType}` : ""}{silent ? ` · ${t("from the caption")}` : ""}</p><CopyButton text={hook} /></div>
          <p className="mt-2 text-title">“{hook}”</p>
          <p className="mt-2 text-sm text-muted"><span className="font-medium text-ink">{t("Your version:")} </span>{t(hookTip)}</p>
        </div>

        {silent && <p className="text-sm text-muted">{t("Nobody speaks in this video, so the message is in the text on screen and the caption. Open the original to copy its text overlays, then film your own footage under the same words.")}</p>}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          {facts.map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-0.5">{value}</dd></div>)}
        </dl>

        {beats.length > 1 && (
          <div>
            <p className="eyebrow">{t("Beat by beat")}</p>
            {!textPost && (
              <div className="mt-2 flex h-2 gap-0.5 overflow-hidden">
                {beats.map((b, i) => <span key={i} className={ROLE_COLOR[b.role] ?? ROLE_COLOR.other} style={{ flex: b.from != null && b.to != null ? Math.max(0.5, b.to - b.from) : 1 }} title={roleName(b.role)} />)}
              </div>
            )}
            <ol className="mt-3 grid gap-3">
              {beats.slice(0, allBeats ? undefined : 8).map((b, i) => (
                <li key={i} className="grid grid-cols-[8px_1fr] gap-3 text-sm">
                  <span className={cx("mt-1.5 size-2", ROLE_COLOR[b.role] ?? ROLE_COLOR.other)} />
                  <div className="min-w-0">
                    <p className="font-mono text-xs uppercase text-muted">{roleName(b.role)}{span(b) && ` · ${span(b)}`}{b.visual && ` · ${visualName(b.visual)}`}</p>
                    <p className="mt-0.5 line-clamp-3 text-muted">“{b.text.join(" ")}”</p>
                    {firstOfRole.has(i) && <p className="mt-1">{tip(b.role)}</p>}
                    {firstOfRole.has(i) && !textPost && b.visual && SHOT_TIP[b.visual] && <p className="mt-1 text-xs text-muted">{t("Shot: {tip}", { tip: t(SHOT_TIP[b.visual]) })}</p>}
                  </div>
                </li>
              ))}
            </ol>
            {beats.length > 8 && <button onClick={() => setAllBeats(!allBeats)} className="mt-3 text-xs text-accent hover:underline">{allBeats ? t("Show fewer beats") : t("Show all {n} beats", { n: beats.length })}</button>}
          </div>
        )}
      </div>
    </section>
  );
}
