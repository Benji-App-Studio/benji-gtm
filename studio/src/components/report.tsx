"use client";
import { useEffect, useMemo, useState } from "react";
import { HOOK_LABEL, PLATFORM_LABEL, ROLE_LABEL, THEME_LABEL, TYPE_COPY, VISUAL_LABEL, type Audience, type Creator, type Platform, type Post, type Project, type Report } from "@/lib/types";
import { peek, refresh } from "@/lib/client-cache";
import { ReportSkeleton } from "./page-skeletons";
import { RecreatePostDialog, ROLE_COLOR } from "./recreate-panel";
import { useEscape } from "./research/escape";
import { ScrollRow } from "./scroll-row";
import { Badge, Button, Card, cx, ErrorNote, fmt, PlatformBadge, segmentTrackClass, Stat, tabClass, Thumb } from "./ui";
import { PANEL, PANEL_OVERLAY, PanelPortal } from "./panel-portal";

type Tab = "overview" | "content" | "playbook" | "audience" | "creators" | "partners" | "competitors";
type Sort = "score" | "converting" | "views" | "velocity";


const median = (values: number[]) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** One run's saved report. Every run keeps its own, so past runs read exactly as they did. */
export function ReportView({ runId, project }: { runId: string; project: Project }) {
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
      if (!run.report) return setError(run.status === "running" ? "This run is still going." : run.message ?? "This run has no report.");
      setReport(run.report);
    }).catch((e) => setError(String(e)));
  }, [runId]);

  // Thumbnails are stored with the run (Supabase storage) and saved as full URLs in its report.
  const thumb = (post: { thumb: string | null }) => post.thumb;
  const formatName = (id: string | null) => report?.formats.find((f) => f.id === id)?.name ?? (id ? id.replace(/_/g, " ") : "–");
  // Keyword-search strays (on-topic below 0.5) never count as competitor content.
  const posts = useMemo(() => (report?.reels ?? []).filter((r) => r.onTopic == null || r.onTopic >= 0.5), [report]);

  const copy = TYPE_COPY[project.type ?? "competitors"];
  const Nouns = copy.nouns[0].toUpperCase() + copy.nouns.slice(1);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!report) return <ReportSkeleton />;

  const openContent = (patch: Partial<typeof filters>) => { setFilters({ ...filters, platform: "", account: "", format: "", hook: "", ...patch }); setTab("content"); };
  const byId = new Map(report.reels.map((r) => [r.id, r]));
  const openPost = (id: string) => { const post = byId.get(id); if (post) setSelected(post); };
  const type = project.type ?? "competitors";
  const tabs: [Tab, string][] = [
    ["overview", "Overview"], ["content", "Winning content"], ["playbook", "Playbook"],
    ...(report.audience ? [["audience", "Audience"] as [Tab, string]] : []),
    ...(report.creators?.length && type !== "account" ? [["creators", type === "campaign" ? "Worth rebooking" : "Creators to work with"] as [Tab, string]] : []),
    ...(report.partners?.length ? [["partners", type === "campaign" ? "Brand's creators" : "Creator programs"] as [Tab, string]] : []),
    ["competitors", Nouns],
  ];

  return (
    <div className="@container">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <ScrollRow label="Report sections" className={segmentTrackClass}>
          {tabs.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)} className={tabClass(tab === key)}>{label}</button>
          ))}
        </ScrollRow>
        <span className="text-caption text-muted">Last {report.sinceDays ?? project.sinceDays} days · {report.kpis.videos} posts · collected {report.status?.collectedAt ? new Date(report.status.collectedAt).toLocaleDateString() : "–"}</span>
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
    top && platforms.length > 1 && `${PLATFORM_LABEL[top.platform]} is where ${type === "competitors" ? "competitors win" : type === "campaign" ? "the campaign wins" : "it wins"} most: ${Math.round(top.hitRate * 100)}% of posts there get ${report.hitMultiple}× the typical views.`,
    playbook?.formats[0] && `The strongest format on ${PLATFORM_LABEL[playbook.platform]} is “${formatName(playbook.formats[0].id)}” (typical ${fmt(playbook.formats[0].medianViews)} views over ${playbook.formats[0].posts} posts).`,
    playbook?.hooks[0] && `Winning posts most often open with a ${HOOK_LABEL[playbook.hooks[0].id]?.toLowerCase() ?? playbook.hooks[0].id} hook.`,
    playbook && playbook.ctaWinners > playbook.ctaRest + 0.1 && `Winners ask for an action more often: ${Math.round(playbook.ctaWinners * 100)}% of top posts end with a CTA vs ${Math.round(playbook.ctaRest * 100)}% of the rest.`,
    converting.length > 0 && `${converting.length} posts have buyers in the comments: people asking for the link, the price or saying they bought.`,
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
        <Stat label="Posts read" value={posts.length} hint={`of ${report.kpis.videos} collected`} />
        <Stat label={TYPE_COPY[type].nouns[0].toUpperCase() + TYPE_COPY[type].nouns.slice(1)} value={accounts.length} />
        <Stat label="Channels" value={platforms.length} hint={platforms.map((p) => PLATFORM_LABEL[p]).join(", ")} />
        <Stat label="Typical views" value={fmt(typical)} hint="median per post" />
        <Stat label="Best channel" value={top ? PLATFORM_LABEL[top.platform] : "–"} hint={top ? `${Math.round(top.hitRate * 100)}% hit rate` : ""} />
      </Card>

      {takeaways.length > 0 && (
        <Card className="p-4">
          <p className="eyebrow">What the data says</p>
          <ul className="mt-3 grid gap-2.5">
            {takeaways.map((t) => <li key={t} className="flex gap-3 text-sm"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />{t}</li>)}
          </ul>
        </Card>
      )}

      <div>
        <h3 className="mb-3 text-title font-medium">Channels, ranked</h3>
        <div className="grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-3">
          {byPlatform.map(({ platform, items, median: med, hitRate, best }) => (
            <Card key={platform} className="flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between"><PlatformBadge platform={platform} showBeta /><span className="text-xs text-muted">{items.length} posts</span></div>
              <div className="flex items-end gap-6">
                <div><p className="text-figure font-medium tabular-nums">{fmt(med)}</p><p className="text-xs text-muted">typical views</p></div>
                <div><p className="text-figure font-medium tabular-nums">{Math.round(hitRate * 100)}%</p><p className="text-xs text-muted">hit rate</p></div>
              </div>
              {best && (
                <button onClick={() => onSelect(best)} className="flex items-center gap-3 rounded-inner bg-raised p-2 text-left hover:bg-hover">
                  <Thumb src={thumb(best)} alt="" className="h-12 w-9 shrink-0 rounded-md" />
                  <span className="min-w-0 text-xs"><span className="block truncate font-medium">{best.account}</span><span className="text-muted">best post · {fmt(best.views)} views</span></span>
                </button>
              )}
              <Button variant="secondary" size="sm" onClick={() => onOpen({ platform })}>See winning {PLATFORM_LABEL[platform]} posts</Button>
            </Card>
          ))}
        </div>
      </div>

      {type === "account" && <OverTime posts={posts} typical={typical} hitMultiple={report.hitMultiple} formatName={formatName} />}

      <Card className="overflow-x-auto p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-5 pb-3"><h3 className="text-title font-medium">{type === "campaign" ? "Which creators deliver, where" : "Who wins where"}</h3><span className="text-xs text-muted">typical views per channel · darker = more hits</span></div>
        <table className="w-full text-sm" style={{ minWidth: 190 + platforms.length * 115 }}>
          <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-5 py-2 font-normal">{TYPE_COPY[type].noun[0].toUpperCase() + TYPE_COPY[type].noun.slice(1)}</th>{platforms.map((p) => <th key={p} className="px-3 py-2 font-medium">{PLATFORM_LABEL[p]}</th>)}</tr></thead>
          <tbody>
            {grid.map((row) => (
              <tr key={row.account} className="border-b border-line transition last:border-0 hover:bg-raised">
                <td className="px-5 py-2.5"><button onClick={() => onOpen({ account: row.account })} className="font-medium hover:underline">{row.account}</button><span className="ml-2 text-xs text-muted">{row.total} post{row.total === 1 ? "" : "s"}</span></td>
                {platforms.map((p) => {
                  const cell = row.cells[p];
                  return (
                    <td key={p} className="px-3 py-2.5">
                      {cell ? (
                        <button onClick={() => onOpen({ account: row.account, platform: p })} className="rounded-md px-2 py-1 tabular-nums transition hover:ring-2 hover:ring-ink/10"
                          style={{ background: `color-mix(in srgb, var(--color-win) ${Math.round((0.06 + cell.hitRate * 0.45) * 100)}%, transparent)` }}>{fmt(cell.median)} <span className="text-xs text-muted">· {cell.posts}</span></button>
                      ) : <span className="text-xs text-faint">not active</span>}
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
  if (months.length < 2) return null;
  const peak = Math.max(...months.map((m) => median(posts.filter((p) => p.postedAt?.startsWith(m)).map((p) => p.views))), 1);
  return (
    <Card className="overflow-x-auto p-0">
      <div className="flex items-baseline justify-between p-5 pb-3"><h3 className="text-title font-medium">Over time</h3><span className="text-xs text-muted">month by month</span></div>
      <table className="w-full min-w-[560px] text-sm">
        <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-5 py-2 font-normal">Month</th><th className="px-3 py-2 font-normal">Posts</th><th className="px-3 py-2 font-normal">Typical views</th><th className="px-3 py-2 font-normal">Hit rate</th><th className="px-3 py-2 font-normal">What worked</th></tr></thead>
        <tbody>
          {months.map((month) => {
            const items = posts.filter((p) => p.postedAt?.startsWith(month));
            const med = median(items.map((p) => p.views));
            const best = [...items].sort((a, b) => b.score - a.score)[0];
            return (
              <tr key={month} className="border-b border-line transition last:border-0 hover:bg-raised">
                <td className="px-5 py-2.5 font-mono text-xs">{new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</td>
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
      <select value={value} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })} className="h-9 rounded-control border border-line bg-raised px-2.5 text-sm text-ink">
        <option value="">All</option>{values.map((v) => <option key={v} value={v}>{name(v)}</option>)}
      </select>
    </label>
  );

  return (
    <div>
      <Card className="mb-5 flex flex-wrap items-end gap-3 p-4">
        {select("Channel", filters.platform, "platform", options((p) => p.platform), (v) => PLATFORM_LABEL[v as Platform] ?? v)}
        {select("Competitor", filters.account, "account", options((p) => p.account), (v) => v)}
        {select("Format", filters.format, "format", options((p) => p.format), formatName)}
        {select("Hook", filters.hook, "hook", options((p) => p.hookType), (v) => HOOK_LABEL[v] ?? v)}
        <label className="flex flex-col gap-1 text-xs text-muted">Sort by
          <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as Sort })} className="h-9 rounded-control border border-line bg-raised px-2.5 text-sm text-ink">
            <option value="score">Best overall</option>{hasIntent && <option value="converting">Most converting</option>}<option value="views">Most views</option><option value="velocity">Fastest growing</option>
          </select>
        </label>
        {hasIntent && (
          <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={filters.converting} onChange={(e) => setFilters({ ...filters, converting: e.target.checked })} className="size-4 accent-win" />Buyers in comments only</label>
        )}
      </Card>
      <p className="mb-3 text-sm text-muted">{shown.length} posts · a “hit” gets {report.hitMultiple}× the typical views</p>
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
                  <Badge>{fmt(post.views)} views</Badge>
                  {(post.buyerIntent ?? 0) >= 0.6 && <Badge tone="win">buyers in comments</Badge>}
                  {post.partnerOf && <Badge tone="accent">creator for {post.partnerOf}</Badge>}
                  {post.reasons.slice(0, 1).map((r) => <Badge key={r} tone="highlight">{r}</Badge>)}
                </div>
              </div>
            </Card>
          </button>
        ))}
      </div>
      {shown.length === 0 && <Card className="px-6 py-10 text-center text-sm text-muted">No posts match these filters.</Card>}
    </div>
  );
}

// MARK: Playbook

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}
      className="shrink-0 rounded-control border border-current/30 px-2 py-1 text-xs opacity-70 hover:opacity-100">{done ? "Copied" : label}</button>
  );
}

function Playbook({ report, posts, formatName, onSelect }: { report: Report; posts: Post[]; formatName: (id: string | null) => string; onSelect: (p: Post) => void }) {
  const byId = new Map(posts.map((p) => [p.id, p]));
  return (
    <div className="grid gap-6">
      <p className="max-w-3xl text-sm text-muted">What the best-performing competitor posts have in common on each channel. Borrow the pattern, not the post: keep the hook shape and structure, put your product and voice in it.</p>
      {report.playbook.map((channel) => (
        <section key={channel.platform}>
          <div className="mb-3 flex items-center gap-3"><PlatformBadge platform={channel.platform} showBeta /><span className="text-xs text-muted">from {channel.posts} posts</span></div>
          <div className="grid gap-4 @4xl:grid-cols-3">
            <Card className="p-5 @4xl:col-span-2">
              <h4 className="text-title font-medium">Hooks to adapt</h4>
              <p className="mt-0.5 text-xs text-muted">Opening lines of the top posts, verbatim.</p>
              <ul className="mt-4 grid gap-2">
                {channel.examples.filter((e) => e.hook).map((example) => {
                  const post = byId.get(example.id);
                  return (
                    <li key={example.id} className="flex items-start gap-3 rounded-inner border border-line p-3 transition hover:border-ink/20">
                      <button className="min-w-0 flex-1 text-left" onClick={() => post && onSelect(post)}>
                        <p className="text-title">“{example.hook}”</p>
                        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          <span className="font-medium text-ink">{example.account}</span>· {fmt(example.views)} views
                          {example.hookType && <Badge tone="accent">{HOOK_LABEL[example.hookType] ?? example.hookType}</Badge>}
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
              <Card className="p-5">
                <h4 className="text-title font-medium">Formats that win</h4>
                <ol className="mt-3 grid gap-2">
                  {channel.formats.length ? channel.formats.map((f, i) => (
                    <li key={f.id} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0"><span className="mr-2 font-mono text-xs text-faint">{i + 1}</span>{formatName(f.id)}</span><span className="shrink-0 text-xs text-muted tabular-nums">{fmt(f.medianViews)} · {f.posts}</span></li>
                  )) : <li className="text-sm text-muted">Not enough posts per format yet.</li>}
                </ol>
              </Card>
              <Card className="p-5">
                <h4 className="text-title font-medium">Hook types that win</h4>
                <div className="mt-3 flex flex-wrap gap-1.5">{channel.hooks.map((h) => <Badge key={h.id} tone="accent">{HOOK_LABEL[h.id] ?? h.id} · {fmt(h.medianViews)}</Badge>)}</div>
              </Card>
              <Card className="p-5">
                <h4 className="text-title font-medium">How winners are built</h4>
                <ul className="mt-3 grid gap-2 text-sm">
                  {channel.structures.map((s) => <li key={s.shape} className="flex items-center justify-between gap-2"><span className="font-mono text-xs">{s.shape.split(" → ").map((r) => ROLE_LABEL[r] ?? r).join(" → ")}</span><span className="text-xs text-muted">{s.count}×</span></li>)}
                  <li className="mt-1 text-xs text-muted">CTA in {Math.round(channel.ctaWinners * 100)}% of winners vs {Math.round(channel.ctaRest * 100)}% of the rest</li>
                  {channel.lengths[0] && <li className="text-xs text-muted">Best length: {channel.lengths[0].id}</li>}
                  {channel.intentWinners != null && <li className="text-xs text-muted">Buying intent in winners&apos; comments: {Math.round(channel.intentWinners * 100)}%</li>}
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
  const typical = median(posts.map((p) => p.views));
  const rows = [...new Set(posts.map((p) => p.account))].map((account) => {
    const mine = posts.filter((p) => p.account === account).sort((a, b) => b.score - a.score);
    return { account, mine, median: median(mine.map((p) => p.views)), hitRate: mine.filter((p) => p.views >= 2 * typical).length / mine.length, platforms: [...new Set(mine.map((p) => p.platform))] as Platform[] };
  }).sort((a, b) => b.median - a.median);
  return (
    <div className="grid gap-3">
      {rows.map((row) => (
        <Card key={row.account} className="flex flex-col gap-4 p-5 @2xl:flex-row @2xl:items-center">
          <div className="min-w-0 @2xl:w-64 @2xl:shrink-0">
            <button onClick={() => onOpen({ account: row.account })} className="truncate font-medium hover:underline">{row.account}</button>
            <div className="mt-1.5 flex flex-wrap gap-2">{row.platforms.map((p) => <PlatformBadge key={p} platform={p} />)}</div>
            <p className="mt-2 text-xs text-muted">{row.mine.length} posts · typical {fmt(row.median)} views · {Math.round(row.hitRate * 100)}% hits</p>
          </div>
          <ScrollRow className="flex min-w-0 flex-1 gap-2">
            {row.mine.slice(0, 6).map((post) => (
              <button key={post.id} onClick={() => onSelect(post)} className="relative shrink-0" title={post.caption.slice(0, 80)}>
                {post.platform === "x" || post.platform === "linkedin"
                  ? <div className="flex h-28 w-36 items-center rounded-lg bg-raised p-2 text-left text-xs leading-snug">{(post.script[0]?.text ?? post.caption).slice(0, 90)}</div>
                  : <Thumb src={thumb(post)} alt="" className="h-28 w-[84px] rounded-lg" />}
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
  if (!audience.total) {
    return (
      <Card className="px-6 py-10 text-center">
        <p className="font-medium">No comments read in this run</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">Turn on “Read more comments” and run it again: up to 25 comments are read on each channel&apos;s most-viewed posts and sorted into what buyers want, ask and doubt.</p>
      </Card>
    );
  }
  const theme = (id: string) => audience.themes.find((t) => t.theme === id);
  const label = (id: string | null) => (id ? THEME_LABEL[id]?.label ?? id.replace(/_/g, " ") : "–");
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const ideas = [
    { id: "how_question", title: "Answer these in a post", body: "People asking how it works are buyers who need one more step. A how-to post answering them is the easiest content to make next." },
    { id: "objection", title: "Handle these objections", body: "Each objection is a post: name the doubt in the hook, then show why it doesn't apply." },
    { id: "feature_request", title: "What they wish existed", body: "If your product does this, lead with it. Competitors' audiences are asking for it." },
    { id: "relates", title: "The pains they recognise", body: "Lines that make people say “this is me”. Reuse their words in your hooks." },
  ].map((idea) => ({ ...idea, theme: theme(idea.id) })).filter((idea) => idea.theme && idea.theme.examples.length);
  const platforms = Object.keys(audience.byPlatform) as Platform[];
  const topThemes = audience.themes.filter((t) => t.theme !== "other").slice(0, 5);

  return (
    <div className="grid gap-4">
      <Card className="flex flex-wrap gap-px overflow-hidden bg-line [&>*]:flex-[1_1_160px]">
        <Stat label="Comments read" value={fmt(audience.total)} hint={`on ${audience.posts} posts`} />
        <Stat label="Want to buy" value={pct(theme("buy_intent")?.share ?? 0)} hint="link, price, “just ordered”" tone="win" />
        <Stat label="Asking how" value={pct(theme("how_question")?.share ?? 0)} hint="questions about using it" />
        <Stat label="Doubting" value={pct((theme("objection")?.share ?? 0) + (theme("skeptic")?.share ?? 0))} hint="objections and skeptics" />
      </Card>

      <Card className="p-4">
        <p className="eyebrow">What the audience is saying</p>
        <ul className="mt-4 grid gap-3">
          {audience.themes.map((t) => (
            <li key={t.theme} className="grid gap-1 @xl:grid-cols-[200px_1fr_48px] @xl:items-center @xl:gap-4">
              <span className="text-sm font-medium">{label(t.theme)} <span className="block text-xs font-normal text-muted">{THEME_LABEL[t.theme]?.hint}</span></span>
              <span className="h-2 bg-raised"><span className={cx("block h-2", t.theme === "buy_intent" ? "bg-win" : t.theme === "objection" || t.theme === "skeptic" ? "bg-warn" : "bg-accent")} style={{ width: `${Math.max(2, t.share * 100)}%` }} /></span>
              <span className="text-right text-sm tabular-nums">{pct(t.share)}</span>
            </li>
          ))}
        </ul>
      </Card>

      {ideas.length > 0 && (
        <div>
          <h3 className="mb-1 text-title font-medium">Content ideas from the comments</h3>
          <p className="mb-3 text-sm text-muted">Real comments from the best posts. Each one is a post you can make yourself.</p>
          <div className="grid gap-4 @4xl:grid-cols-2">
            {ideas.map((idea) => (
              <Card key={idea.id} className="p-5">
                <div className="flex items-baseline justify-between gap-3"><h4 className="text-title font-medium">{idea.title}</h4><span className="text-xs text-muted">{idea.theme!.count} comments</span></div>
                <p className="mt-1 text-xs text-muted">{idea.body}</p>
                <ul className="mt-3 grid gap-2">
                  {idea.theme!.examples.map((example, i) => (
                    <li key={i}>
                      <button onClick={() => onOpenPost(example.postId)} className="w-full rounded-inner border border-line bg-raised p-3 text-left transition hover:border-ink/25">
                        <p className="text-sm leading-snug">“{example.text}”</p>
                        <p className="mt-1.5 flex items-center gap-2 text-xs text-muted"><PlatformBadge platform={example.platform} />on {example.account}</p>
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
          <div className="p-5 pb-3"><h3 className="text-title font-medium">By channel</h3><p className="text-xs text-muted">Share of each channel&apos;s comments</p></div>
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-5 py-2 font-normal">Channel</th><th className="px-3 py-2 font-normal">Comments</th>{topThemes.map((t) => <th key={t.theme} className="px-3 py-2 font-medium">{label(t.theme)}</th>)}</tr></thead>
            <tbody>
              {platforms.map((platform) => {
                const row = audience.byPlatform[platform]!;
                return (
                  <tr key={platform} className="border-b border-line transition last:border-0 hover:bg-raised">
                    <td className="px-5 py-2.5"><PlatformBadge platform={platform} /></td>
                    <td className="px-3 py-2.5 tabular-nums">{row.total}</td>
                    {topThemes.map((t) => <td key={t.theme} className="px-3 py-2.5 tabular-nums">{pct(row.themes[t.theme] ?? 0)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {audience.byAccount.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <div className="p-5 pb-3"><h3 className="text-title font-medium">Whose audience is buying</h3><p className="text-xs text-muted">Accounts with at least 3 comments read, most buyers first</p></div>
          <table className="w-full min-w-[620px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-5 py-2 font-normal">Account</th><th className="px-3 py-2 font-normal">Comments</th><th className="px-3 py-2 font-normal">Want to buy</th><th className="px-3 py-2 font-normal">Asking how</th><th className="px-3 py-2 font-normal">Objections</th><th className="px-3 py-2 font-normal">Mostly</th></tr></thead>
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
  return (
    <div className="grid gap-4">
      <p className="max-w-3xl text-sm text-muted">
        {campaign ? "The creators who delivered for this brand, ranked." : "Creators already making winning content for your buyers. They aren't your competitors: they're people to partner with, sponsor or send your product to."}
        {" "}Ranked by how often they beat the typical post, buyers in their comments, and reach for their size (smaller accounts with big hits rank higher: cheaper to work with).
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
                  <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-xs font-medium shadow-raised" title="Fit">{creator.score}</span>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  {([["Followers", fmt(creator.followers)], ["Typical views", fmt(creator.medianViews)], ["Hit rate", `${Math.round(creator.hitRate * 100)}%`], ["Posts", String(creator.posts)], ["Buyers", creator.medianIntent == null ? "–" : `${Math.round(creator.medianIntent * 100)}%`], ["Reach", creator.viewsPerFollower != null ? `${creator.viewsPerFollower.toFixed(1)}×` : "–"]] as [string, string][]).map(([label, value]) => (
                    <div key={label} className="min-w-0"><dt className="truncate text-muted">{label}</dt><dd className="text-sm font-medium tabular-nums">{value}</dd></div>
                  ))}
                </dl>
                <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3">
                  {best ? (
                    <button onClick={() => onOpenPost(best.id)} className="flex min-w-0 items-center gap-2 text-left hover:underline">
                      {best.platform !== "x" && best.platform !== "linkedin" && <Thumb src={thumb(best)} alt="" className="h-10 w-8 shrink-0" />}
                      <span className="min-w-0 text-xs"><span className="block tabular-nums">Best: {fmt(creator.bestViews)} views</span><span className="block truncate text-muted">{formatName(creator.topFormat)}</span></span>
                    </button>
                  ) : <span />}
                  <a href={creator.profileUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-accent hover:underline">Profile ↗</a>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
      <Card className="hidden overflow-x-auto p-0 @4xl:block">
        <table className="w-full min-w-[820px] text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-muted">
            <th className="px-5 py-3 font-normal">Creator</th><th className="px-3 py-3 font-normal">Followers</th><th className="px-3 py-3 font-normal">Posts</th>
            <th className="px-3 py-3 font-normal">Typical views</th><th className="px-3 py-3 font-normal">Hit rate</th><th className="px-3 py-3 font-normal">Buyers</th>
            <th className="px-3 py-3 font-normal">Best post</th><th className="px-3 py-3 font-normal">Fit</th><th className="px-3 py-3" />
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
                  <td className="px-3 py-3 tabular-nums">{fmt(creator.medianViews)}{creator.viewsPerFollower != null && creator.viewsPerFollower >= 1 && <span className="block text-xs text-win">{creator.viewsPerFollower.toFixed(1)}× followers</span>}</td>
                  <td className="px-3 py-3 tabular-nums">{Math.round(creator.hitRate * 100)}%</td>
                  <td className="px-3 py-3 tabular-nums">{creator.medianIntent == null ? <span className="text-xs text-faint">–</span> : `${Math.round(creator.medianIntent * 100)}%`}</td>
                  <td className="px-3 py-3">
                    {best && (
                      <button onClick={() => onOpenPost(best.id)} className="flex items-center gap-2 text-left hover:underline">
                        {best.platform !== "x" && best.platform !== "linkedin" && <Thumb src={thumb(best)} alt="" className="h-10 w-8 shrink-0" />}
                        <span className="text-xs"><span className="block tabular-nums">{fmt(creator.bestViews)} views</span><span className="text-muted">{formatName(creator.topFormat)}</span></span>
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-3"><span className="rounded-full bg-raised px-2 py-0.5 text-xs font-medium shadow-raised">{creator.score}</span></td>
                  <td className="px-3 py-3 text-right"><a href={creator.profileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">Profile ↗</a></td>
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
  collab: { label: "Collab", hint: "a collab post with the brand as co-author", tone: "accent" },
  paid: { label: "Paid label", hint: "Instagram's paid-partnership label", tone: "highlight" },
  bio: { label: "Bio", hint: "their bio declares the tie (athlete, ambassador, a discount code…)", tone: "win" },
  tagged: { label: "Tagged", hint: "posts tagging the brand", tone: "neutral" },
  mentioned: { label: "Mentioned", hint: "posts @mentioning the brand in the caption", tone: "neutral" },
} as const;

/** The creators posting for each brand, and the public signals that show it. */
function Partners({ programs, byId, thumb, campaign, onOpenPost }: {
  programs: NonNullable<Report["partners"]>; byId: Map<string, Post>; thumb: (p: Post) => string | null; campaign: boolean; onOpenPost: (id: string) => void;
}) {
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <p className="max-w-3xl text-sm text-muted">
          {campaign ? "Everyone posting for this brand, including creators you didn't list." : "Who creates for each competitor: the people to study, or to approach yourself."}
          {" "}<b className="font-medium text-ink">Confirmed</b> means a collab post, the paid-partnership label or a bio that declares the tie. <b className="font-medium text-ink">Likely</b> means they tag or mention the brand.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {(Object.keys(SIGNAL) as (keyof typeof SIGNAL)[]).map((key) => <span key={key} className="flex items-center gap-1.5 text-muted"><Badge tone={SIGNAL[key].tone}>{SIGNAL[key].label}</Badge>{SIGNAL[key].hint}</span>)}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmedOnly} onChange={(e) => setConfirmedOnly(e.target.checked)} className="size-4 accent-ink" />Confirmed partners only</label>
      </div>
      {programs.map((program) => {
        const creators = program.creators.filter((c) => !confirmedOnly || c.strength === "confirmed");
        const confirmed = program.creators.filter((c) => c.strength === "confirmed").length;
        return (
          <section key={program.handle}>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-title font-medium">{program.brand} <a href={`https://www.instagram.com/${program.handle}/`} target="_blank" rel="noopener noreferrer" className="text-sm font-normal text-muted hover:text-ink">@{program.handle} ↗</a></h3>
              <span className="text-xs text-muted">{program.creators.length} creator{program.creators.length === 1 ? "" : "s"} · {confirmed} confirmed · {program.posts} linked post{program.posts === 1 ? "" : "s"}</span>
            </div>
            {creators.length === 0 ? (
              <Card className="p-4 text-sm text-muted">{program.creators.length ? "No confirmed partners yet: only creators who tag the brand." : `No creators tagged or collaborated with @${program.handle} in this period.`}</Card>
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
                            <span className="block font-medium [overflow-wrap:anywhere]">{creator.account}{creator.verified && <span className="ml-1 text-accent" title="Verified">✓</span>}</span>
                            <span className="text-xs text-muted">{creator.followers != null ? `${fmt(creator.followers)} followers · ` : ""}{creator.posts} post{creator.posts === 1 ? "" : "s"}</span>
                          </span>
                          <Badge tone={creator.strength === "confirmed" ? "win" : "neutral"}>{creator.strength}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-1">{chips.map(([key, n]) => <Badge key={key} tone={SIGNAL[key].tone}>{SIGNAL[key].label}{key !== "bio" && n > 1 ? ` ×${n}` : ""}</Badge>)}</div>
                        {creator.bio && <p className="line-clamp-3 border-l-2 border-line pl-3 text-xs text-muted whitespace-pre-line">{creator.bio}</p>}
                        <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3">
                          {best ? (
                            <button onClick={() => onOpenPost(best.id)} className="flex min-w-0 items-center gap-2 text-left hover:underline">
                              {best.platform !== "x" && best.platform !== "linkedin" && <Thumb src={thumb(best)} alt="" className="h-10 w-8 shrink-0" />}
                              <span className="min-w-0 text-xs"><span className="block tabular-nums">Best: {fmt(creator.bestViews)} views</span><span className="block text-muted">open the breakdown</span></span>
                            </button>
                          ) : <span className="text-xs text-muted">{creator.bestViews ? `${fmt(creator.bestViews)} views` : "Image posts only"}</span>}
                          <a href={creator.profileUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-accent hover:underline">Profile ↗</a>
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
  const ties = [
    ...(post.partnerOf ? [`Found as a creator for ${post.partnerOf}`] : []),
    ...(post.coauthors ?? []).map((c) => `Collab with @${c}`),
    ...(post.paidPartnership ? ["Paid partnership label"] : []),
    ...(post.taggedUsers ?? []).slice(0, 6).map((t) => `Tags @${t}`),
    ...(post.mentions ?? []).slice(0, 6).map((m) => `Mentions @${m}`),
  ];
  if (!ties.length) return null;
  return (
    <div>
      <p className="eyebrow">Brand ties</p>
      <div className="mt-2 flex flex-wrap gap-1.5">{[...new Set(ties)].map((tie) => <Badge key={tie} tone={tie.startsWith("Collab") || tie.startsWith("Paid") || tie.startsWith("Found") ? "accent" : "neutral"}>{tie}</Badge>)}</div>
    </div>
  );
}

// MARK: Post drawer

const HOOK_TEMPLATE: Record<string, string> = {
  question: "Ask the question your buyer is already asking themselves: “Why does [their problem] keep happening?”",
  bold_claim: "State your strongest claim flatly, no warm-up: “[Result] without [the usual pain].”",
  number_list: "Promise a count and deliver it in order: “[N] [things] that [outcome].”",
  story: "Start in the middle of a story: “Last [time], I [moment that went wrong]…”",
  pov: "Set the scene in one line: “POV: you [a situation your buyer knows too well].”",
  warning: "Warn them off a common mistake: “Stop [mistake] before [consequence].”",
  news: "Lead with what changed: “[New thing] just changed. Here's what it means for [audience].”",
  how_to: "Name the outcome and how fast: “How to [outcome] in [time or steps].”",
  curiosity_gap: "Tease the answer and hold it back: “Nobody tells you this about [topic]…”",
  other: "Keep the shape of its opening line and swap in your product and audience.",
};

const ROLE_TEMPLATE: Record<string, string> = {
  setup: "Name the problem in your buyer's own words.",
  product: "Bring your product in as the fix. Show it working, don't describe it.",
  method: "Walk through the steps, one per beat.",
  benefit: "Say what changes for them: time, money or stress saved.",
  proof: "Show proof: a result, a number, a review or the screen itself.",
  cta: "Tell them exactly what to do next (comment a word, tap the link, save it).",
  other: "A bridge line to the next beat.",
};

const SHOT_TIP: Record<string, string> = {
  talking_head: "Phone at eye level, you talking straight to camera.",
  screen_demo: "Screen recording of the product doing the thing, zoomed in.",
  product_shot: "Close-up of the product in hand or in use.",
  text_on_screen: "Big text over a simple background; the words carry it.",
  broll: "Scenery or everyday footage under the voice-over.",
  proof_shot: "Screenshot or footage of the result: numbers, reviews, before/after.",
  reaction: "Your face reacting to what's on screen.",
  skit: "A short acted scene: you playing the buyer, or two characters.",
};

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Everything about one post, plus a free, code-built breakdown to make your own version (no generation). */
function PostDrawer({ post, thumb, formatName, formats, productId, onClose }: { post: Post; thumb: string | null; formatName: (id: string | null) => string; formats: Report["formats"]; productId: string | null; onClose: () => void }) {
  const [recreating, setRecreating] = useState(false);
  useEscape(onClose);
  const [allComments, setAllComments] = useState(false);
  const textPost = post.platform === "x" || post.platform === "linkedin";
  const lines = post.script.filter((l) => l.role);
  const hook = post.script[0]?.text ?? post.caption.split("\n")[0];
  const time = (s?: number | null) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
  const comments = post.commentList ?? [];

  return (
    <PanelPortal>
    <div className={`${PANEL_OVERLAY} z-40`} onClick={onClose}>
      <aside className={`${PANEL} max-w-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-card px-5 py-3">
          <div className="flex items-center gap-2"><PlatformBadge platform={post.platform} /><span className="text-xs text-muted">{post.postedAt?.slice(0, 10)}</span>{post.niche && <Badge>niche</Badge>}</div>
          <button onClick={onClose} className="px-2 py-1 text-muted hover:bg-ink/5 hover:text-ink" aria-label="Close">✕</button>
        </div>
        <div className="grid gap-6 p-5">
          <div className="flex gap-4">
            {!textPost && <Thumb src={thumb} alt="" className="h-40 w-28 shrink-0" />}
            <div className="min-w-0">
              <p className="font-medium">{post.account}</p>
              <p className="mt-1 line-clamp-6 text-sm whitespace-pre-line text-muted">{post.caption}</p>
              <a href={post.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-accent hover:underline">Open original ↗</a>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-inner border border-line bg-line text-center">
            {[["Views", fmt(post.views)], ["Likes", fmt(post.likes)], ["Comments", fmt(post.comments)], ["Score", String(post.score)], ["vs creator", post.outlier != null ? `${post.outlier.toFixed(1)}×` : "–"], ["Views/day", fmt(post.viewsPerDay)]].map(([label, value]) => (
              <div key={label} className="bg-card px-2 py-3"><p className="text-title font-medium tabular-nums">{value}</p><p className="text-xs text-muted">{label}</p></div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {post.format && <Badge tone="neutral">{formatName(post.format)}</Badge>}
            {post.hookType && <Badge tone="accent">{HOOK_LABEL[post.hookType] ?? post.hookType} hook</Badge>}
            {(post.buyerIntent ?? 0) >= 0.6 && <Badge tone="win">buyers in comments</Badge>}
            {post.reasons.map((r) => <Badge key={r} tone="highlight">{r}</Badge>)}
          </div>
          <PostTies post={post} />

          <Recreate post={post} hook={hook} textPost={textPost} formatName={formatName} time={time} onRecreate={() => setRecreating(true)} />
          {recreating && <RecreatePostDialog post={post} formats={formats} productId={productId} onClose={() => setRecreating(false)} />}

          {lines.length > 0 && !textPost && (
            <div>
              <p className="eyebrow">Full script</p>
              <ol className="mt-3 grid gap-2">
                {lines.map((l, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className={cx("mt-1.5 size-2 shrink-0", ROLE_COLOR[l.role ?? "other"])} />
                    <span><span className="mr-2 font-mono text-xs uppercase text-muted">{time(l.start)} {ROLE_LABEL[l.role ?? "other"]}</span>{l.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {comments.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between"><p className="eyebrow">What commenters said</p><span className="text-xs text-muted">{comments.length} read</span></div>
              <CommentGroups comments={comments} all={allComments} />
              {comments.length > 6 && <button onClick={() => setAllComments(!allComments)} className="mt-3 text-xs text-accent hover:underline">{allComments ? "Show fewer" : `Show all ${comments.length} comments`}</button>}
            </div>
          )}
        </div>
      </aside>
    </div>
    </PanelPortal>
  );
}

function CommentGroups({ comments, all }: { comments: { text: string; theme: string | null }[]; all: boolean }) {
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
            <p className="text-xs font-medium">{THEME_LABEL[group]?.label ?? group} <span className="text-muted">· {list.length}</span></p>
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
  const tip = (role: string) => (role === "hook" ? hookTip : ROLE_TEMPLATE[role] ?? ROLE_TEMPLATE.other);
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
    return [
      ["Length", `${text.length} characters · ${text.split(/\s+/).filter(Boolean).length} words`],
      ["Layout", `${text.split("\n").filter((l) => l.trim()).length} lines in ${paragraphs} block${paragraphs === 1 ? "" : "s"}${paragraphs > 2 ? " (short, spaced out)" : ""}`],
      ["First line", `${firstLine.length} characters${firstLine.length <= 60 ? " (fits before “see more”)" : ""}`],
      ["Ends with", cta >= 0 ? "a call to action" : /\?\s*$/.test(text.trim()) ? "a question to the reader" : "no ask"],
      ["Links", /https?:\/\/|www\./.test(text) ? "has a link in the post" : "no link in the post"],
      ["Hashtags", hashtags.length ? `${hashtags.length}: ${hashtags.slice(0, 5).join(" ")}` : "none"],
    ];
  })() : [
    ["Length", post.durationSec ? `${Math.round(post.durationSec)} seconds` : "–"],
    ["Hook", hookSeconds != null ? `first ${hookSeconds.toFixed(1)}s` : `${hook.split(/\s+/).filter(Boolean).length} words`],
    ...(silent ? [["Voice", "no speech: music and on-screen text"]] as [string, string][] : [
      ["Pace", post.durationSec && words ? `${Math.round((words / post.durationSec) * 60)} words a minute` : "–"],
      ["Product shows up", post.brandMoment ? post.brandMoment.start != null ? `at ${time(post.brandMoment.start)} (line ${post.brandMoment.sentence} of ${post.brandMoment.of})` : `line ${post.brandMoment.sentence} of ${post.brandMoment.of}` : "never named"],
      ["Ask", cta >= 0 ? `CTA ${script[cta].start != null ? `at ${time(script[cta].start)}` : `in line ${cta + 1}`}` : "no CTA"],
    ] as [string, string][]),
    ["Caption", `${post.caption.length} characters · ${hashtags.length} hashtag${hashtags.length === 1 ? "" : "s"}`],
  ];
  if (posted) facts.push(["Posted", `${DAY[posted.getDay()]} around ${posted.toLocaleTimeString(undefined, { hour: "numeric" })} (your time)`]);

  const outline = [
    `${formatName(post.format)} · modelled on ${post.account} (${fmt(post.views)} views)`,
    "",
    ...beats.map((b) => `${(ROLE_LABEL[b.role] ?? b.role).toUpperCase()}${span(b) ? ` (${span(b)})` : ""}${b.visual ? ` [${VISUAL_LABEL[b.visual] ?? b.visual}]` : ""}\n  Them: “${b.text.join(" ").slice(0, 200)}”\n  You: ${tip(b.role)}`),
  ].join("\n");

  return (
    <section className="overflow-hidden rounded-inner border border-line bg-raised">
      <div className="flex items-start justify-between gap-3 bg-primary px-4 py-3 text-on-ink">
        <div><p className="font-medium">Make your own version</p><p className="text-xs text-on-ink/60">Free: the post broken down so you can recreate it yourself. No generation, no credits.</p></div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {beats.length > 0 && <CopyButton text={outline} label="Copy outline" />}
          <button onClick={onRecreate} className="shrink-0 rounded-full bg-on-ink px-3 py-1 text-xs font-medium text-primary hover:opacity-90">Recreate for my app</button>
        </div>
      </div>
      <div className="grid gap-5 p-4">
        <div className="bg-raised p-4">
          <div className="flex items-start justify-between gap-3"><p className="eyebrow">The hook{post.hookType ? ` · ${HOOK_LABEL[post.hookType] ?? post.hookType}` : ""}{silent ? " · from the caption" : ""}</p><CopyButton text={hook} /></div>
          <p className="mt-2 text-title">“{hook}”</p>
          <p className="mt-2 text-sm text-muted"><span className="font-medium text-ink">Your version: </span>{hookTip}</p>
        </div>

        {silent && <p className="text-sm text-muted">Nobody speaks in this video, so the message is in the text on screen and the caption. Open the original to copy its text overlays, then film your own footage under the same words.</p>}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          {facts.map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-0.5">{value}</dd></div>)}
        </dl>

        {beats.length > 1 && (
          <div>
            <p className="eyebrow">Beat by beat</p>
            {!textPost && (
              <div className="mt-2 flex h-2 gap-0.5 overflow-hidden">
                {beats.map((b, i) => <span key={i} className={ROLE_COLOR[b.role] ?? ROLE_COLOR.other} style={{ flex: b.from != null && b.to != null ? Math.max(0.5, b.to - b.from) : 1 }} title={ROLE_LABEL[b.role]} />)}
              </div>
            )}
            <ol className="mt-3 grid gap-3">
              {beats.slice(0, allBeats ? undefined : 8).map((b, i) => (
                <li key={i} className="grid grid-cols-[8px_1fr] gap-3 text-sm">
                  <span className={cx("mt-1.5 size-2", ROLE_COLOR[b.role] ?? ROLE_COLOR.other)} />
                  <div className="min-w-0">
                    <p className="font-mono text-xs uppercase text-muted">{ROLE_LABEL[b.role] ?? b.role}{span(b) && ` · ${span(b)}`}{b.visual && ` · ${VISUAL_LABEL[b.visual] ?? b.visual}`}</p>
                    <p className="mt-0.5 line-clamp-3 text-muted">“{b.text.join(" ")}”</p>
                    {firstOfRole.has(i) && <p className="mt-1">{tip(b.role)}</p>}
                    {firstOfRole.has(i) && !textPost && b.visual && SHOT_TIP[b.visual] && <p className="mt-1 text-xs text-muted">Shot: {SHOT_TIP[b.visual]}</p>}
                  </div>
                </li>
              ))}
            </ol>
            {beats.length > 8 && <button onClick={() => setAllBeats(!allBeats)} className="mt-3 text-xs text-accent hover:underline">{allBeats ? "Show fewer beats" : `Show all ${beats.length} beats`}</button>}
          </div>
        )}
      </div>
    </section>
  );
}
