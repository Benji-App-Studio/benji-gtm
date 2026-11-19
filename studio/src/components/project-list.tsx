"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { preloadProject, useCached } from "@/lib/client-cache";
import { goInstant } from "./instant";
import { createClient } from "@/lib/supabase/client";
import { TYPE_COPY, type Platform, type ProjectStatus, type ProjectType } from "@/lib/types";
import { Skeleton, SkeletonProjectCards } from "./skeleton";
import { Badge, ButtonLink, Card, EmptyState, Gear, Page, PageHeader, PlatformBadge } from "./ui";

export interface ProjectSummary {
  id: string; type: ProjectType; name: string; description: string; status: ProjectStatus; message: string | null; demo: boolean;
  platforms: Platform[]; sinceDays: number; competitors: number; runs: number; lastRunAt: string | null; posts: number | null; createdAt: string;
}

export const STATUS: Record<ProjectStatus, { label: string; tone: "neutral" | "accent" | "win" | "warn" }> = {
  draft: { label: "Draft", tone: "neutral" },
  discovering: { label: "Finding competitors", tone: "accent" },
  review: { label: "Ready to run", tone: "accent" },
  analyzing: { label: "Analyzing", tone: "accent" },
  ready: { label: "Report ready", tone: "win" },
  error: { label: "Needs attention", tone: "warn" },
};

/** The user's analyses (optionally one type): shown at once from cache, kept live over Realtime. */
export function useProjects(type?: ProjectType) {
  const [all, reload] = useCached<ProjectSummary[]>("/api/projects");
  const supabase = useMemo(() => createClient(), []);
  const statuses = useRef(new Map<string, string>());
  useEffect(() => {
    if (Array.isArray(all)) statuses.current = new Map(all.map((p) => [p.id, p.status]));
  }, [all]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => { reload().catch(() => {}); }, 200); };
    // Changes arrive over Realtime (row-level security limits them to this user's rows). Progress
    // messages change often; the list only reloads when a status does, or a run starts or goes.
    const channel = supabase.channel(`projects-${type ?? "all"}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, (payload) => {
        const row = payload.new as { id?: string; status?: string };
        if (payload.eventType !== "UPDATE" || (row.id && statuses.current.get(row.id) !== row.status)) soon();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "runs" }, soon)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "runs" }, soon)
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [type, supabase, reload]);
  return useMemo(() => (Array.isArray(all) ? all.filter((p) => !type || p.type === type) : all === undefined ? null : []), [all, type]);
}

/** Placeholder project cards while a list loads for the first time. */
export function CardSkeletons({ count = 3 }: { count?: number }) {
  return <Skeleton label="Loading projects"><SkeletonProjectCards count={count} /></Skeleton>;
}

export function ProjectCard({ p, index = 0 }: { p: ProjectSummary; index?: number }) {
  const copy = TYPE_COPY[p.type];
  return (
    <Link href={`/app/p/${p.id}`} className="rise group rounded-card" style={{ "--i": index } as React.CSSProperties}
      onMouseEnter={() => preloadProject(p.id)} onFocus={() => preloadProject(p.id)} onTouchStart={() => preloadProject(p.id)}
      onClick={(event) => { preloadProject(p.id); goInstant(event, `/app/p/${p.id}`); }}>
      <Card className="flex h-full flex-col gap-3 p-4 transition-colors group-hover:border-hairline group-hover:bg-hover">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-title font-medium">{p.name}</h3>
            <p className="mt-0.5 text-caption text-muted">{copy.label} · last {p.sinceDays} days</p>
          </div>
          <Badge tone={STATUS[p.status].tone}>
            {(p.status === "discovering" || p.status === "analyzing") && <Gear className="size-3" />}
            {STATUS[p.status].label}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-3">{p.platforms.map((platform) => <PlatformBadge key={platform} platform={platform} />)}</div>
        <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-sm">
          <span><b className="font-medium tabular-nums">{p.competitors}</b> <span className="text-muted">{copy.nouns}</span></span>
          <span><b className="font-medium tabular-nums">{p.runs}</b> <span className="text-muted">run{p.runs === 1 ? "" : "s"}</span></span>
          {p.posts != null && <span><b className="font-medium tabular-nums">{p.posts}</b> <span className="text-muted">posts</span></span>}
          {p.demo && <Badge>demo</Badge>}
        </div>
      </Card>
    </Link>
  );
}

/** One kind of analysis under Analyze (Competitors, Accounts, Campaigns): what it does, its projects, and a way to start a new one. */
export function WorkflowPage({ type }: { type: ProjectType }) {
  const projects = useProjects(type);
  const copy = TYPE_COPY[type];
  const page = type === "competitors" ? "Competitors" : type === "account" ? "Accounts" : "Campaigns";
  const start = `New ${type === "competitors" ? "competitor analysis" : type === "account" ? "account analysis" : "campaign analysis"}`;
  return (
    <Page>
      <PageHeader crumbs={[{ label: "Home", href: "/app" }, { label: page }]} title={page}
        subtitle={<>{copy.blurb} Every run is kept in the analysis&apos;s history.</>}
        actions={<ButtonLink href={`/app/new?type=${type}`}>{start}</ButtonLink>} />
      {projects === null ? <CardSkeletons />
        : projects.length === 0 ? (
          <EmptyState title={`No ${type === "competitors" ? "competitor analyses" : type === "account" ? "account analyses" : "campaign analyses"} yet`} body="Start one and every run of it is kept here."
            action={<ButtonLink href={`/app/new?type=${type}`} variant="secondary">{start}</ButtonLink>} />
        ) : <div className="grid gap-3 @xl:grid-cols-2 @5xl:grid-cols-3">{projects.map((p, i) => <ProjectCard key={p.id} p={p} index={i} />)}</div>}
    </Page>
  );
}
