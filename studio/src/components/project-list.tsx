"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { preloadProject, useCached } from "@/lib/client-cache";
import { goInstant } from "./instant";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";
import { TYPE_COPY, type Platform, type ProjectStatus, type ProjectType } from "@/lib/types";
import { Skeleton, SkeletonProjectCards } from "./skeleton";
import { Badge, Card, Gear, PlatformBadge, cx } from "./ui";
import { rich } from "./rich";

export interface ProjectSummary {
  id: string; type: ProjectType; name: string; description: string; status: ProjectStatus; message: string | null; demo: boolean;
  platforms: Platform[]; sinceDays: number; competitors: number; runs: number; lastRunAt: string | null; posts: number | null; createdAt: string;
  /** The app the analysis is for (Research › Social posts lists it there); null for one that names none. */
  productId?: string | null;
}

export const STATUS: Record<ProjectStatus, { label: string; tone: "neutral" | "accent" | "win" | "warn" }> = {
  draft: { label: m("Draft"), tone: "neutral" },
  discovering: { label: m("Finding competitors"), tone: "accent" },
  review: { label: m("Ready to run"), tone: "accent" },
  analyzing: { label: m("Analyzing"), tone: "accent" },
  ready: { label: m("Report ready"), tone: "win" },
  error: { label: m("Needs attention"), tone: "warn" },
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

/** "3 competitors", "1 account", "12 creators": the count of what an analysis reads, per kind, with {count} left for the number. */
function countLabel(type: ProjectType, n: number, tn: ReturnType<typeof useT>["tn"]) {
  return type === "account" ? tn(n, "{count} account", "{count} accounts")
    : type === "campaign" ? tn(n, "{count} creator", "{count} creators")
    : tn(n, "{count} competitor", "{count} competitors");
}

/** A count sentence ("{count} runs") with its number set apart, the way the list shows counts. */
function withCount(text: string, n: number, intl: string, className: string): ReactNode {
  return rich(text, { count: <b className={cx("tabular-nums", className)}>{n.toLocaleString(intl)}</b> });
}

/** Placeholder project cards while a list loads for the first time. */
export function CardSkeletons({ count = 3 }: { count?: number }) {
  const { t } = useT();
  return <Skeleton label={t("Loading analyses")}><SkeletonProjectCards count={count} /></Skeleton>;
}

export function ProjectCard({ p, index = 0 }: { p: ProjectSummary; index?: number }) {
  const copy = TYPE_COPY[p.type];
  const { t, tn, intl } = useT();
  return (
    <Link href={`/app/p/${p.id}`} className="rise group rounded-card" style={{ "--i": index } as React.CSSProperties}
      onMouseEnter={() => preloadProject(p.id)} onFocus={() => preloadProject(p.id)} onTouchStart={() => preloadProject(p.id)}
      onClick={(event) => { preloadProject(p.id); goInstant(event, `/app/p/${p.id}`); }}>
      <Card className="flex h-full flex-col gap-2.5 p-3 transition-colors group-hover:border-hairline group-hover:bg-hover">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium">{p.name}</h3>
            <p className="mt-0.5 text-caption text-muted">{tn(p.sinceDays, "{kind} · last {n} day", "{kind} · last {n} days", { kind: t(copy.label) })}</p>
          </div>
          <Badge tone={STATUS[p.status].tone}>
            {(p.status === "discovering" || p.status === "analyzing") && <Gear className="size-3" />}
            {t(STATUS[p.status].label)}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-3">{p.platforms.map((platform) => <PlatformBadge key={platform} platform={platform} />)}</div>
        <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className="text-muted">{withCount(countLabel(p.type, p.competitors, tn), p.competitors, intl, "font-medium text-ink")}</span>
          <span className="text-muted">{withCount(tn(p.runs, "{count} run", "{count} runs"), p.runs, intl, "font-medium text-ink")}</span>
          {p.posts != null && <span className="text-muted">{withCount(tn(p.posts, "{count} post", "{count} posts"), p.posts, intl, "font-medium text-ink")}</span>}
          {p.demo && <Badge>{t("demo")}</Badge>}
        </div>
      </Card>
    </Link>
  );
}

/** One analysis as a list row (Linear's projects list): name and kind at left, channels, counts and status at right. */
export function ProjectRow({ p, index = 0 }: { p: ProjectSummary; index?: number }) {
  const copy = TYPE_COPY[p.type];
  const { t, tn, intl } = useT();
  return (
    <Link href={`/app/p/${p.id}`} className="rise group flex min-h-12 items-center gap-3 rounded-control px-2 py-1.5 transition-colors hover:bg-hover" style={{ "--i": index } as React.CSSProperties}
      onMouseEnter={() => preloadProject(p.id)} onFocus={() => preloadProject(p.id)} onTouchStart={() => preloadProject(p.id)}
      onClick={(event) => { preloadProject(p.id); goInstant(event, `/app/p/${p.id}`); }}>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{p.name}</span>
          {p.demo && <Badge>{t("demo")}</Badge>}
        </span>
        <span className="block truncate text-xs text-muted">{tn(p.sinceDays, "{kind} · last {n} day", "{kind} · last {n} days", { kind: t(copy.label) })}</span>
      </span>
      <span className="hidden shrink-0 items-center gap-3 @2xl:flex">{p.platforms.map((platform) => <PlatformBadge key={platform} platform={platform} />)}</span>
      <span className="hidden w-[200px] shrink-0 justify-end gap-3 text-xs text-muted tabular-nums @xl:flex">
        <span>{withCount(countLabel(p.type, p.competitors, tn), p.competitors, intl, "font-normal text-ink")}</span>
        <span>{withCount(tn(p.runs, "{count} run", "{count} runs"), p.runs, intl, "font-normal text-ink")}</span>
        {p.posts != null && <span>{withCount(tn(p.posts, "{count} post", "{count} posts"), p.posts, intl, "font-normal text-ink")}</span>}
      </span>
      <Badge tone={STATUS[p.status].tone} className="shrink-0">
        {(p.status === "discovering" || p.status === "analyzing") && <Gear className="size-3" />}
        {t(STATUS[p.status].label)}
      </Badge>
    </Link>
  );
}

/** Analyses as a list: rows back to back, full width, under a quiet column header. */
/** `trailing`: something after each row, outside its link (All analyses' "Assign to app" menu). */
export function ProjectRows({ projects, offset = 0, className, trailing }: { projects: ProjectSummary[]; offset?: number; className?: string; trailing?: (p: ProjectSummary) => ReactNode }) {
  const { t } = useT();
  return (
    <div className={cx("-mx-2", className)}>
      <div className="flex h-8 items-center gap-3 border-b border-line px-2 text-xs text-muted">
        <span className="flex-1">{t("Name")}</span>
        <span className="hidden w-[200px] text-right @xl:block">{t("Size")}</span>
        <span className="w-[104px] text-right">{t("Status")}</span>
        {trailing && <span className="w-7" aria-hidden />}
      </div>
      <div className="pt-1">{projects.map((p, i) => trailing
        ? <div key={p.id} className="flex items-center gap-1"><div className="min-w-0 flex-1"><ProjectRow p={p} index={i + offset} /></div>{trailing(p)}</div>
        : <ProjectRow key={p.id} p={p} index={i + offset} />)}</div>
    </div>
  );
}
