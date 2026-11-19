"use client";
// A project: its live progress, review, run history and reports. It opens from the client cache
// (warmed when its card is hovered) and follows the backend live over Realtime.
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { peek, refresh } from "@/lib/client-cache";
import type { ActivityRow, RunSummary } from "@/lib/db";
import { ask, Facts, notice } from "./dialog";
import { ActivityLog, LiveProgress } from "./live-progress";
import { ProjectSkeleton } from "./page-skeletons";
import { ReportView } from "./report";
import { Review } from "./review";
import { LockedNote, useFirstLocked } from "./research/gates";
import { Badge, Button, ButtonLink, Card, cx, EmptyState, fmt, Gear, Page, PageHeader } from "./ui";
import { createClient } from "@/lib/supabase/client";
import { TYPE_COPY, type Estimate, type Project, type ProjectStatus } from "@/lib/types";

type Details = { project: Project & { includeNiche?: boolean }; runs: RunSummary[]; estimate: Estimate; error?: string };

/** Moves within the project (e.g. picking a run) without a server round trip. */
const setUrl = (url: string, push = false) => (push ? window.history.pushState(null, "", url) : window.history.replaceState(null, "", url));

export function ProjectView({ id }: { id: string }) {
  const params = useSearchParams();
  const url = `/api/projects/${id}`;
  const cached = peek<Details>(url);
  const [project, setProject] = useState<Details["project"] | null>(cached?.project ?? null);
  const [runs, setRuns] = useState<RunSummary[]>(cached?.runs ?? []);
  const [estimate, setEstimate] = useState<Estimate | null>(cached?.estimate ?? null);
  const [missing, setMissing] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [editing, setEditing] = useState(false);
  const [activity, setActivity] = useState<ActivityRow[]>(() => peek<{ activity?: ActivityRow[] }>(`${url}/log`)?.activity ?? []);
  const [showLog, setShowLog] = useState(false);
  // A run collects posts and reads them: with either key missing, the run buttons say what to connect.
  const locked = useFirstLocked(["research.collect", "ai"]);
  const selectedRun = params.get("run");
  const supabase = useMemo(() => createClient(), []);

  const load = useCallback(async () => {
    const data = await refresh<Details>(url).catch(() => null);
    // No answer at all (the connection dropped): say so, unless the project is already on screen.
    if (!data) { setUnreachable(true); return null; }
    setUnreachable(false);
    if (!data.project) { if (data.error) setMissing(true); return null; }
    setProject(data.project);
    setRuns(data.runs);
    setEstimate(data.estimate);
    return data.project as Project;
  }, [url]);

  const loadActivity = useCallback(() => refresh<{ activity?: ActivityRow[] }>(`${url}/log`).then((l) => setActivity(l.activity ?? [])).catch(() => {}), [url]);

  // Everything the backend does streams in over Realtime: the project's status and message, each
  // run's progress, and the activity feed. A full reload only happens when a status changes.
  const reloadSoon = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const initial = async () => { await Promise.all([load(), loadActivity()]); };
    initial();
    const scheduleLoad = () => {
      if (reloadSoon.current) clearTimeout(reloadSoon.current);
      reloadSoon.current = setTimeout(load, 150);
    };
    const channel = supabase.channel(`project-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "projects", filter: `id=eq.${id}` }, (payload) => {
        const row = payload.new as { status: ProjectStatus; message: string | null };
        setProject((p) => {
          if (p && p.status !== row.status) scheduleLoad();
          return p ? { ...p, status: row.status, message: row.message ?? undefined } : p;
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "runs", filter: `project_id=eq.${id}` }, (payload) => {
        if (payload.eventType === "DELETE") return scheduleLoad();
        const row = payload.new as RunSummary;
        setRuns((list) => {
          const known = list.find((r) => r.id === row.id);
          if (!known || known.status !== row.status) scheduleLoad();
          return known ? list.map((r) => (r.id === row.id ? { ...r, ...row } : r)) : [row, ...list];
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity", filter: `project_id=eq.${id}` }, (payload) => {
        setActivity((list) => [...list, payload.new as ActivityRow].slice(-300));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (reloadSoon.current) clearTimeout(reloadSoon.current);
    };
  }, [id, load, loadActivity, supabase]);

  // A safety net while work is running, in case the live connection drops.
  const working = project?.status === "discovering" || project?.status === "analyzing";
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => { load(); loadActivity(); }, 15_000);
    return () => clearInterval(timer);
  }, [working, load, loadActivity]);

  async function post(path: string, question?: Parameters<typeof ask>[0]) {
    if (question && !(await ask(question))) return;
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const data = await response.json().catch(() => ({ error: "Something went wrong. Try again." }));
    if (!response.ok) return notice(data.error);
    setEditing(false);
    setUrl(`/app/p/${id}`);
    await load();
  }

  async function stop() {
    const response = await fetch(`/api/projects/${id}/cancel`, { method: "POST" });
    if (!response.ok) await notice((await response.json().catch(() => ({}))).error ?? "Couldn't stop it. Try again.");
    await load();
  }

  async function removeRun(runId: string) {
    if (!(await ask({ title: "Remove this run?", body: "Its report and thumbnails are deleted. Other runs stay in the history.", confirm: "Remove the run", danger: true }))) return;
    const response = await fetch(`/api/runs/${runId}`, { method: "DELETE" });
    if (!response.ok) return notice((await response.json().catch(() => ({}))).error ?? "Couldn't remove it. Try again.");
    setUrl(`/app/p/${id}`);
    load();
  }

  async function remove() {
    if (!(await ask({ title: `Delete ${project?.name}?`, body: "The project, all its runs and their reports are deleted for good.", confirm: "Delete the project", danger: true }))) return;
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    refresh("/api/projects").catch(() => {});
    setUrl("/app", true);
  }

  if (missing) return <Page className="max-w-3xl"><EmptyState title="This analysis doesn't exist" body="It may have been deleted, or the link is wrong." action={<ButtonLink href="/app" variant="secondary">Back to Home</ButtonLink>} /></Page>;
  if ((!project || !estimate) && unreachable) return <Page className="max-w-3xl"><EmptyState title="Couldn't load this analysis" body="The server didn't answer. Check your connection and try again." action={<Button variant="secondary" onClick={() => { setUnreachable(false); void load(); }}>Try again</Button>} /></Page>;
  if (!project || !estimate) return <ProjectSkeleton />;

  const type = project.type ?? "competitors";
  const liveRun = runs.find((r) => r.status === "running") ?? null;
  const doneRuns = runs.filter((r) => r.status === "done");
  const viewing = runs.find((r) => r.id === selectedRun && r.status === "done") ?? doneRuns[0];
  const crumbs = [{ label: "Home", href: "/app" }, ...(type === "account" ? [{ label: "Accounts", href: "/app/accounts" }] : type === "campaign" ? [{ label: "Campaigns", href: "/app/campaigns" }] : []), { label: project.name }];
  const rerunText: Parameters<typeof ask>[0] = {
    title: "Run this analysis again?",
    body: <Facts rows={[["Time frame", `Last ${project.sinceDays} days`], ["Posts", `About ${estimate.posts}`], ["Estimated Apify cost", <span key="usd" className="font-medium text-ink">~${estimate.usd.toFixed(2)}</span>]]} note="Same settings as before. Previous runs stay in the history." />,
    confirm: "Start the run",
  };

  return (
    <Page>
      <PageHeader crumbs={crumbs} title={project.name} badge={<>{project.demo && <Badge>demo</Badge>}<Badge tone="neutral">{TYPE_COPY[type].label}</Badge></>}
        subtitle={project.description || undefined}
        actions={<>
          {project.status === "ready" && !project.demo && !editing && (
            <>
              {locked ? <LockedNote state={locked} /> : <Button size="sm" onClick={() => post(`/api/projects/${id}/analyze`, rerunText)}>Run again</Button>}
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Change {TYPE_COPY[type].nouns} and settings</Button>
            </>
          )}
          {editing && <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>Back to report</Button>}
          <Button variant="ghost" size="sm" onClick={remove}>Delete</Button>
        </>} />

      {working && <LiveProgress project={project} run={project.status === "analyzing" ? liveRun : null} activity={activity} onStop={stop} />}

      {project.status === "error" && (
        <Card className="mb-4 border-warn/35 p-4">
          <h2 className="text-title font-medium text-warn">The last run stopped</h2>
          <p className="mt-1 text-sm text-muted">{project.message || "It didn't finish. Nothing was lost: earlier runs are still in the history."}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {locked && <LockedNote state={locked} />}
            {!locked && (project.candidates.length > 0 || type !== "competitors") && <Button size="sm" onClick={() => post(`/api/projects/${id}/analyze`, rerunText)}>Try the analysis again</Button>}
            {!locked && type === "competitors" && <Button size="sm" variant="secondary" onClick={() => post(`/api/projects/${id}/discover`)}>Search for competitors again</Button>}
            {project.candidates.length > 0 && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Review {TYPE_COPY[type].nouns}</Button>}
            <Button size="sm" variant="ghost" onClick={() => setShowLog(!showLog)}>{showLog ? "Hide" : "Show"} activity</Button>
          </div>
          {showLog && <ActivityLog rows={activity.slice(-60)} empty="No activity yet." className="mt-3" />}
        </Card>
      )}

      {(project.status === "review" || editing) && (
        <Review project={project} estimate={estimate} onChange={(p, e) => { setProject(p); setEstimate(e); }} onStarted={() => { setEditing(false); setUrl(`/app/p/${id}`); load(); }} />
      )}

      {!editing && runs.length > 0 && (
        <div className={cx("mt-3 grid gap-3", viewing && "@6xl:grid-cols-[minmax(0,1fr)_260px]")}>
          <div className="min-w-0">
            {viewing ? <ReportView key={viewing.id} runId={viewing.id} project={project} /> : <Card className="p-4 text-sm text-muted">No finished run yet. A report shows here when one finishes.</Card>}
          </div>
          {/* Beside the report when there's room for both; above it, compact, when there isn't. */}
          <aside className="order-first @6xl:order-none">
            <Card className="p-4 @6xl:sticky @6xl:top-4">
              <p className="eyebrow mb-3">Run history · {runs.length}</p>
              <ol className="grid gap-1.5 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-1">
                {runs.map((run, i) => (
                  <li key={run.id}>
                    <div className={cx("group flex items-start justify-between gap-2 rounded-control border px-3 py-2 text-sm transition", viewing?.id === run.id ? "border-hairline bg-active" : "border-line hover:bg-hover")}>
                      <button type="button" className="min-w-0 flex-1 rounded-xs text-left disabled:cursor-default" disabled={run.status !== "done"} onClick={() => setUrl(`/app/p/${id}?run=${run.id}`)}>
                        <span className="block font-medium">Run {runs.length - i}{i === 0 && run.status === "done" ? " · latest" : ""}</span>
                        <span className="block text-xs text-muted">{new Date(run.started_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          <Badge tone={run.status === "done" ? "win" : run.status === "running" ? "accent" : "warn"}>{run.status === "running" && <Gear className="size-3" />}{run.status === "done" ? `${run.posts ?? 0} posts` : run.status === "running" ? "running" : "failed"}</Badge>
                          {run.status === "done" && <Badge>{run.settings.sinceDays}d</Badge>}
                          {run.status === "done" && Number(run.apify_usd) > 0 && <Badge>${Number(run.apify_usd).toFixed(2)}</Badge>}
                        </span>
                        {run.status === "error" && run.message && <span className="mt-1 block text-xs text-warn">{run.message}</span>}
                      </button>
                      {run.status !== "running" && !project.demo && <button type="button" onClick={() => removeRun(run.id)} className="rounded-xs text-xs text-faint opacity-0 group-hover:opacity-100 hover:text-warn focus-visible:opacity-100" aria-label="Remove run">✕</button>}
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-muted">Every run keeps its own report. {fmt(doneRuns.reduce((n, r) => n + (r.posts ?? 0), 0))} posts decoded in total.</p>
            </Card>
          </aside>
        </div>
      )}
    </Page>
  );
}
