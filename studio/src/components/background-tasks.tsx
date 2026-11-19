"use client";
// Background work you'd otherwise not see: ad media being saved to storage, Studio batches, Launch
// uploads to Meta, analyses and ad pulls (from the server), plus work this tab runs itself, such as an import
// or a competitor being deleted (lib/local-tasks.ts). A small box in the corner of every page, expandable into
// progress bars. It checks every 5 seconds while anything runs (every 30 when idle, at once when the tab's own
// work starts or ends), shows "Done" for a few seconds when a task finishes, and disappears when nothing runs.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BackgroundTask } from "@/lib/server/background";
import { DONE_SHOWN_MS, useLocalTasks, useLocalTasksVersion } from "@/lib/local-tasks";
import { IconAlert, IconCheckCircle, IconChevronDown } from "./icons";
import { cx, Gear } from "./ui";
import { UI_LOCALE } from "@/lib/ui-locale";

const POLL_MS = 5_000;
const IDLE_POLL_MS = 30_000;

interface Shown extends Omit<BackgroundTask, "kind"> { finishedAt?: number; failed?: boolean }

export function BackgroundTasks() {
  const [server, setServer] = useState<Shown[]>([]);
  const [open, setOpen] = useState(false);
  const previous = useRef<Map<string, Shown>>(new Map());
  const local = useLocalTasks();
  const localVersion = useLocalTasksVersion();
  const poll = useRef<() => void>(() => {});

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      if (timer) clearTimeout(timer);
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch("/api/background", { cache: "no-store" });
          if (response.ok) {
            const { tasks: running } = (await response.json()) as { tasks: BackgroundTask[] };
            const now = Date.now();
            const ids = new Set(running.map((t) => t.id));
            // Tasks that just finished stay a few seconds as "Done" (a timer below clears them).
            const finished = [...previous.current.values()]
              .filter((t) => !ids.has(t.id))
              .map((t) => ({ ...t, finishedAt: t.finishedAt ?? now, done: t.total ?? t.done }))
              .filter((t) => now - t.finishedAt < DONE_SHOWN_MS);
            const next: Shown[] = [...running, ...finished];
            previous.current = new Map(next.map((t) => [t.id, t]));
            if (!stopped) setServer(next);
          }
        } catch { /* offline: try again next time */ }
      }
      if (!stopped) timer = setTimeout(load, [...previous.current.values()].some((t) => !t.finishedAt) ? POLL_MS : IDLE_POLL_MS);
    };
    poll.current = () => { void load(); };
    load();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  // The tab's own work started or ended (an import queues media to save): check the server now.
  useEffect(() => { if (localVersion) poll.current(); }, [localVersion]);

  // A "Done" goes after a few seconds, without waiting for the next check.
  useEffect(() => {
    const finished = server.filter((t) => t.finishedAt);
    if (!finished.length) return;
    const due = Math.max(0, Math.min(...finished.map((t) => t.finishedAt! + DONE_SHOWN_MS)) - Date.now());
    const timer = setTimeout(() => {
      const now = Date.now();
      setServer((list) => {
        const next = list.filter((t) => !t.finishedAt || now - t.finishedAt < DONE_SHOWN_MS);
        previous.current = new Map(next.map((t) => [t.id, t]));
        return next;
      });
    }, due + 50);
    return () => clearTimeout(timer);
  }, [server]);

  const tasks = useMemo<Shown[]>(() => [
    ...local.map((t) => ({
      id: `local:${t.id}`, label: t.label, productName: t.productName ?? null, done: t.done, total: t.total, detail: t.detail ?? null, href: t.href ?? null,
      finishedAt: t.finishedAt, failed: t.status === "failed",
    })),
    ...server,
  ], [local, server]);

  if (!tasks.length) return null;
  const running = tasks.filter((t) => !t.finishedAt);
  const failed = tasks.filter((t) => t.failed);
  const first = running[0] ?? tasks[0];
  const pct = (t: Shown) => (t.total ? Math.min(100, Math.round(((t.done ?? 0) / t.total) * 100)) : null);

  return (
    <div className="fixed right-4 bottom-4 z-40 w-[min(360px,calc(100vw-2rem))] print:hidden" aria-live="polite">
      <div className="overflow-hidden rounded-card border border-line bg-raised shadow-pop">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
          className="flex h-10 w-full items-center gap-2.5 px-3 text-left text-sm">
          {running.length ? <Gear className="size-3.5 shrink-0 text-accent" /> : failed.length ? <IconAlert className="size-3.5 shrink-0 text-warn" /> : <IconCheckCircle className="size-3.5 shrink-0 text-win" />}
          <span className="min-w-0 flex-1 truncate">
            {running.length
              ? <><span className="font-medium">{running.length} running</span><span className="text-muted"> · {first.label}{pct(first) != null ? ` ${pct(first)}%` : ""}</span></>
              : failed.length ? <><span className="font-medium text-warn">Failed</span><span className="text-muted"> · {failed[0].label}</span></> : <><span className="font-medium">Done</span><span className="text-muted"> · {first.label}</span></>}
          </span>
          <IconChevronDown className={cx("size-3.5 shrink-0 text-muted transition-transform", open ? "rotate-180" : "")} />
        </button>
        {!open && running.length > 0 && <Bar value={pct(first)} />}
        {open && (
          <ul className="max-h-[50vh] overflow-y-auto border-t border-line">
            {tasks.map((t) => {
              const value = pct(t);
              const body = (
                <>
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate font-medium">{t.label}</span>
                    <span className={cx("shrink-0 text-xs tabular-nums", t.failed ? "text-warn" : "text-muted")}>
                      {t.failed ? "Failed" : t.finishedAt ? "Done" : t.total ? `${(t.done ?? 0).toLocaleString(UI_LOCALE)} / ${t.total.toLocaleString(UI_LOCALE)}` : "Running"}
                    </span>
                  </span>
                  {(t.productName || t.detail) && <span className={cx("mt-0.5 block truncate text-xs", t.failed ? "text-warn" : "text-muted")}>{[t.productName, t.detail].filter(Boolean).join(" · ")}</span>}
                  {!t.failed && <span className="mt-2 block"><Bar value={t.finishedAt ? 100 : value} rounded /></span>}
                </>
              );
              return (
                <li key={t.id} className="border-b border-line px-3 py-2.5 last:border-0">
                  {t.href ? <Link href={t.href} className="block hover:opacity-80">{body}</Link> : body}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A progress bar: filled to `value` %, or a moving stripe when the task has no count. */
function Bar({ value, rounded }: { value: number | null; rounded?: boolean }) {
  return (
    <span className={cx("relative block h-1 w-full overflow-hidden bg-control", rounded && "rounded-full")} role="progressbar" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      {value != null
        ? <span className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-700" style={{ width: `${value}%` }} />
        : <span className="bg-task-indeterminate absolute inset-y-0 w-1/3 bg-accent" />}
    </span>
  );
}
