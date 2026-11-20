"use client";
import { useEffect, useState } from "react";
import type { ActivityRow, RunSummary } from "@/lib/db";
import type { Project } from "@/lib/types";
import { ask } from "./dialog";
import { Button, Card, cx, Gear, Spinner } from "./ui";
import { useT } from "@/lib/i18n/client";

const elapsed = (from: string, now: number) => {
  const s = Math.max(0, Math.round((now - Date.parse(from)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

const time = (iso: string, intl: string) => new Date(iso).toLocaleTimeString(intl, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** The activity feed, on the console surface (dark in both themes): the level is a coloured mark, the message stays light. */
export function ActivityLog({ rows, empty, className }: { rows: ActivityRow[]; empty: string; className?: string }) {
  const { t, intl } = useT();
  return (
    <ol className={cx("max-h-64 overflow-auto rounded-inner bg-console p-3 font-mono text-xs text-white/80", className)}>
      {rows.length ? rows.map((a) => (
        <li key={a.id} className={cx(a.level === "error" && "text-white")}>
          <span className="text-white/45">{time(a.created_at, intl)}</span>{" "}
          {a.level === "warn" && <span className="text-caution" aria-label={t("Warning")}>▲ </span>}
          {a.level === "error" && <span className="text-warn" aria-label={t("Error")}>● </span>}
          {a.level === "done" && <span className="text-win" aria-label={t("Done")}>✓ </span>}
          {a.message}
        </li>
      )) : <li className="text-white/55">{empty}</li>}
    </ol>
  );
}

/** A search or run as it happens: each scrape, the reading of every post and the activity feed, streamed live. */
export function LiveProgress({ project, run, activity, onStop }: { project: Project; run: RunSummary | null; activity: ActivityRow[]; onStop: () => void }) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  const [showLog, setShowLog] = useState(false);
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const discovering = project.status === "discovering";
  const progress = run?.progress ?? {};
  const steps = progress.steps ?? [];
  const scrapes = steps.filter((s) => !s.key.startsWith("comments"));
  const comments = steps.filter((s) => s.key.startsWith("comments"));
  const stage = progress.stage ?? "collect";
  const order = ["collect", "expand", "comments", "decode", "finish", "done"];
  const reached = (s: string) => order.indexOf(stage) >= order.indexOf(s);
  const decodedShare = progress.total ? Math.min(1, (progress.decoded ?? 0) / progress.total) : 0;
  const recent = activity.filter((a) => (discovering ? !a.run_id : a.run_id === run?.id));

  return (
    <Card className="mb-3 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-accent-soft text-accent"><Gear className="size-3.5" /></span>
          <div className="min-w-0">
            <h2 className="text-title font-medium">{discovering ? t("Finding your competitors") : t("Analyzing the content")}</h2>
            <p className="mt-0.5 text-sm text-muted" aria-live="polite">{project.message ?? t("Starting…")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          {run && <span className="tabular-nums">{elapsed(run.started_at, now)}</span>}
          {!discovering && Number(run?.apify_usd) > 0 && <span className="tabular-nums">Apify ${Number(run!.apify_usd).toFixed(2)}</span>}
          <Button size="sm" variant="secondary" disabled={stopping} onClick={async () => {
            const ok = await ask(discovering
              ? { title: t("Stop the competitor search?"), body: t("You can add competitors yourself or search again later."), confirm: t("Stop the search"), danger: true }
              : { title: t("Stop this run?"), body: t("Scrapes in progress are cancelled and nothing is saved for this run. Earlier runs stay in the history."), confirm: t("Stop the run"), danger: true });
            if (!ok) return;
            setStopping(true); await onStop(); setStopping(false);
          }}>
            {stopping ? <><Spinner className="size-3" /> {t("Stopping…")}</> : t("Stop")}
          </Button>
        </div>
      </div>

      {!discovering && (
        <ol className="grid gap-px border-t border-line bg-line">
          <Stage title={t("Collecting posts")} state={reached("comments") || reached("decode") ? "done" : "running"}
            detail={scrapes.length ? t("{done} of {total} scrapes", { done: scrapes.filter((s) => s.status === "done" || s.status === "failed").length, total: scrapes.length }) : t("Starting the scrapers")}>
            {scrapes.length > 0 && (
              <ul className="mt-2 grid gap-1 @2xl:grid-cols-2">
                {scrapes.map((s) => <Scrape key={s.key} label={s.label} status={s.status} count={s.count} error={s.error} />)}
              </ul>
            )}
          </Stage>
          {comments.length > 0 && (
            <Stage title={t("Reading more comments")} state={reached("decode") ? "done" : stage === "comments" ? "running" : "pending"}>
              <ul className="mt-2 grid gap-1 @2xl:grid-cols-2">
                {comments.map((s) => <Scrape key={s.key} label={s.label} status={s.status} count={s.count} error={s.error} unit="comments" />)}
              </ul>
            </Stage>
          )}
          <Stage title={t("Reading every post")} state={reached("finish") ? "done" : stage === "decode" ? "running" : "pending"}
            detail={progress.total ? t("{n} of {total}", { n: progress.decoded ?? 0, total: progress.total }) : undefined}>
            {stage === "decode" && progress.total ? (
              <div className="mt-2 h-2 rounded-full bg-control"><div className="hatch h-2 rounded-full text-accent transition-[width] duration-500" style={{ width: `${decodedShare * 100}%` }} /></div>
            ) : null}
          </Stage>
          <Stage title={t("Saving the report")} state={stage === "done" ? "done" : stage === "finish" ? "running" : "pending"} />
        </ol>
      )}

      <div className="border-t border-line px-4 py-2.5">
        <button type="button" aria-expanded={showLog} className="rounded-xs text-xs text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setShowLog(!showLog)}>{showLog ? t("Hide activity ({n})", { n: recent.length }) : t("Show activity ({n})", { n: recent.length })}</button>
        {showLog && <ActivityLog rows={recent} empty={t("Waiting for the first update…")} className="mt-2" />}
      </div>
    </Card>
  );
}

function Stage({ title, state, detail, children }: { title: string; state: "pending" | "running" | "done"; detail?: string; children?: React.ReactNode }) {
  return (
    <li className={cx("bg-card px-4 py-2.5", state === "pending" && "text-muted")}>
      <div className="flex items-center gap-3 text-sm">
        <StatusIcon status={state} />
        <span className="font-medium">{title}</span>
        {detail && <span className="ml-auto text-xs text-muted tabular-nums">{detail}</span>}
      </div>
      {state !== "pending" && children && <div className="pl-7">{children}</div>}
    </li>
  );
}

function Scrape({ label, status, count, error, unit = "posts" }: { label: string; status: "pending" | "running" | "done" | "failed"; count: number | null; error: string | null; unit?: "posts" | "comments" }) {
  const { t, tn } = useT();
  return (
    <li className="flex items-center gap-2 text-xs" title={error ?? undefined}>
      <StatusIcon status={status} small />
      <span className={cx("truncate", status === "pending" && "text-muted")}>{label}</span>
      <span className={cx("ml-auto shrink-0 tabular-nums", status === "failed" ? "text-warn" : "text-muted")}>
        {status === "done" ? (unit === "comments" ? tn(count ?? 0, "{n} comment", "{n} comments") : tn(count ?? 0, "{n} post", "{n} posts")) : status === "failed" ? t("failed") : status === "running" ? t("scraping") : t("queued")}
      </span>
    </li>
  );
}

function StatusIcon({ status, small }: { status: "pending" | "running" | "done" | "failed"; small?: boolean }) {
  const size = small ? "size-3" : "size-4";
  if (status === "running") return <Gear className={cx(size, "text-accent")} />;
  if (status === "done") return <span className={cx(size, "grid shrink-0 place-items-center rounded-full bg-win text-[9px] text-on-ink")}>✓</span>;
  if (status === "failed") return <span className={cx(size, "grid shrink-0 place-items-center rounded-full bg-warn text-[9px] text-on-ink")}>!</span>;
  return <span className={cx(size, "shrink-0 rounded-full border border-line")} />;
}
