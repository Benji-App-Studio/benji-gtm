"use client";

// Research → Our ads: how our ads compare with competitors'. A side-by-side of our numbers and the typical
// competitor's (the median across competitors), the formats and hooks competitors keep running that we
// barely use (each opens their examples), and how many of ours are due for a refresh. Reads the ads already
// on the page; folds away and remembers it.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AD_FORMAT_LABEL, KEPT_AFTER_DAYS, readGaps, REFRESH_DAYS, sideStats, typicalCompetitor, type RankedAdRow, type SideStats } from "@/lib/research";
import { HOOK_LABEL } from "@/lib/types";
import { IconArrowRight, IconChevronDown } from "../icons";
import { Card, cx } from "../ui";
import { readStored, storageKey } from "@/lib/storage-keys";
import { UI_LOCALE } from "@/lib/ui-locale";

const pct = (n: number | null) => (n == null ? "–" : `${Math.round(n * 100)}%`);
const num = (n: number | null) => (n == null ? "–" : Math.round(n).toLocaleString(UI_LOCALE));

function useOpen(key: string) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const restore = async () => { try { const saved = readStored(localStorage, key); if (saved != null) setOpen(saved === "1"); } catch { /* not kept */ } };
    restore();
  }, [key]);
  const set = (next: boolean) => { setOpen(next); try { localStorage.setItem(key, next ? "1" : "0"); } catch { /* not kept */ } };
  return [open, set] as const;
}

const ROWS: { key: keyof SideStats; label: string; hint: string; format: (n: number | null) => string }[] = [
  { key: "live", label: "Live ads", hint: "Ads running now", format: num },
  { key: "launched", label: "Launched in 14 days", hint: "How fast new ads go out", format: num },
  { key: "keptRate", label: "Kept 2+ weeks", hint: `Of the ads first seen here ${KEPT_AFTER_DAYS}+ days ago, the share still running ("–": none seen that long ago yet)`, format: pct },
  { key: "longShare", label: "Long runners", hint: "Share of live ads running 30+ days", format: pct },
  { key: "videoShare", label: "Video", hint: "Share of live ads that are video", format: pct },
  { key: "medianDays", label: "Median days running", hint: "Of live ads", format: (n) => (n == null ? "–" : `${Math.round(n)} days`) },
];

function Gap({ label, rate, theirLive, ours, onOpen }: { label: string; rate: number; theirLive: number; ours: number; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="group flex w-full items-center gap-3 rounded-control px-3 py-2 text-left transition hover:bg-raised">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{label}</span>
          <span className="block text-xs text-muted">{pct(rate)} of theirs kept · {theirLive.toLocaleString(UI_LOCALE)} live · we run {ours}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-accent opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">Their examples<IconArrowRight className="size-3.5" /></span>
      </button>
    </li>
  );
}

function Column({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-1 px-3">{title}</p>
      {children.length ? <ul className="grid gap-0.5">{children}</ul> : <p className="px-3 py-2 text-sm text-muted">{empty}</p>}
    </div>
  );
}

export function HowWeCompare({ ours, theirs, onTheirExamples, onRefresh }: {
  /** Our ads (every one, live and stopped). */
  ours: RankedAdRow[];
  /** Competitors' ads. */
  theirs: RankedAdRow[];
  /** Shows competitors' long runners of a format or hook. */
  onTheirExamples: (read: { format?: string; hook?: string }) => void;
  /** Shows our ads due for a refresh. */
  onRefresh: () => void;
}) {
  const [open, setOpen] = useOpen(storageKey("research.compare"));
  const [now] = useState(() => Date.now());
  const us = useMemo(() => sideStats(ours, now), [ours, now]);
  const them = useMemo(() => typicalCompetitor(theirs, now), [theirs, now]);
  const formats = useMemo(() => readGaps(theirs, ours, "format", now).slice(0, 5), [theirs, ours, now]);
  const hooks = useMemo(() => readGaps(theirs, ours, "hook", now).slice(0, 5), [theirs, ours, now]);
  const due = useMemo(() => ours.filter((ad) => ad.active && (ad.days ?? 0) >= REFRESH_DAYS).length, [ours]);
  if (!ours.length || !theirs.length) return null;

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-7 min-w-0 items-center gap-2 rounded-control pr-2 pl-1 text-left transition-colors hover:bg-hover">
          <IconChevronDown className={cx("size-3.5 shrink-0 text-muted transition", !open && "-rotate-90")} />
          <span className="shrink-0 text-sm font-medium">How we compare</span>
          <span className="truncate text-xs text-muted">Our ads against the typical competitor{formats.length ? ` · ${formats.length} format${formats.length === 1 ? "" : "s"} they keep that we barely use` : ""}</span>
        </button>
        {due > 0 && (
          <button type="button" onClick={onRefresh} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-caution-soft px-2.5 text-xs font-medium text-caution-ink transition hover:opacity-80"
            title={`Our ads live ${REFRESH_DAYS}+ days: likely wearing out, so make the next version before they stop`}>
            {due.toLocaleString(UI_LOCALE)} of ours due for a refresh<IconArrowRight className="size-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="grid gap-4 border-t border-line px-1 pt-2 pb-3 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <div className="min-w-0 px-3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-5 text-sm">
              <span className="pb-2 text-xs text-muted" />
              <span className="pb-2 text-right text-xs text-muted">Us</span>
              <span className="pb-2 text-right text-xs text-muted" title="The median across competitors: each competitor counts once">Typical competitor</span>
              {ROWS.map((row) => (
                <div key={row.key} className="contents">
                  <span className="truncate border-t border-line py-2 text-label" title={row.hint}>{row.label}</span>
                  <span className="border-t border-line py-2 text-right font-medium tabular-nums">{row.format(us[row.key])}</span>
                  <span className="border-t border-line py-2 text-right text-muted tabular-nums">{row.format(them[row.key])}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid min-w-0 gap-3 @2xl:grid-cols-2">
            <Column title="Formats they keep, we barely use" empty="We already use every format they keep running.">
              {formats.map((g) => <Gap key={g.key} label={AD_FORMAT_LABEL[g.key] ?? g.key} rate={g.rate} theirLive={g.theirLive} ours={g.ours} onOpen={() => onTheirExamples({ format: g.key })} />)}
            </Column>
            <Column title="Hooks they keep, we barely use" empty="We already use every hook they keep running.">
              {hooks.map((g) => <Gap key={g.key} label={`${HOOK_LABEL[g.key] ?? g.key} hook`} rate={g.rate} theirLive={g.theirLive} ours={g.ours} onOpen={() => onTheirExamples({ hook: g.key })} />)}
            </Column>
          </div>
          <p className="px-3 text-xs text-faint @4xl:col-span-2">
            &ldquo;Kept&rdquo;: of their ads first seen here {KEPT_AFTER_DAYS}+ days ago, the share still running; listed when it&apos;s at least their average. &ldquo;Barely use&rdquo;: 2 or fewer of ours live. Click one to see their long runners of it.
          </p>
        </div>
      )}
    </Card>
  );
}
