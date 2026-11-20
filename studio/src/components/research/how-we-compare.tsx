"use client";

// Research → Our ads: how our ads compare with competitors'. A side-by-side of our numbers and the typical
// competitor's (the median across competitors), the formats and hooks competitors keep running that we
// barely use (each opens their examples), and how many of ours are due for a refresh. Reads the ads already
// on the page; folds away and remembers it.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AD_FORMAT_LABEL, KEPT_AFTER_DAYS, readGaps, REFRESH_DAYS, sideStats, typicalCompetitor, type RankedAdRow, type SideStats } from "@/lib/research";
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";
import { HOOK_LABEL } from "@/lib/types";
import { IconArrowRight, IconChevronDown } from "../icons";
import { Card, cx } from "../ui";
import { readStored, storageKey } from "@/lib/storage-keys";

const pct = (n: number | null) => (n == null ? "–" : `${Math.round(n * 100)}%`);
const num = (n: number | null, intl: string) => (n == null ? "–" : Math.round(n).toLocaleString(intl));
type T = ReturnType<typeof useT>["t"];

function useOpen(key: string) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const restore = async () => { try { const saved = readStored(localStorage, key); if (saved != null) setOpen(saved === "1"); } catch { /* not kept */ } };
    restore();
  }, [key]);
  const set = (next: boolean) => { setOpen(next); try { localStorage.setItem(key, next ? "1" : "0"); } catch { /* not kept */ } };
  return [open, set] as const;
}

// Labels and hints are translated where shown (`{n}` in a hint is KEPT_AFTER_DAYS).
const ROWS: { key: keyof SideStats; label: string; hint: string; format: (n: number | null, intl: string, t: T) => string }[] = [
  { key: "live", label: m("Live ads"), hint: m("Ads running now"), format: num },
  { key: "launched", label: m("Launched in 14 days"), hint: m("How fast new ads go out"), format: num },
  { key: "keptRate", label: m("Kept 2+ weeks"), hint: m("Of the ads first seen here {n}+ days ago, the share still running (\"–\": none seen that long ago yet)"), format: pct },
  { key: "longShare", label: m("Long runners"), hint: m("Share of live ads running 30+ days"), format: pct },
  { key: "videoShare", label: m("Video"), hint: m("Share of live ads that are video"), format: pct },
  { key: "medianDays", label: m("Median days running"), hint: m("Of live ads"), format: (n, _intl, t) => (n == null ? "–" : t("{n} days", { n: Math.round(n) })) },
];

function Gap({ label, rate, theirLive, ours, onOpen }: { label: string; rate: number; theirLive: number; ours: number; onOpen: () => void }) {
  const { t } = useT();
  return (
    <li>
      <button type="button" onClick={onOpen} className="group flex w-full items-center gap-3 rounded-control px-3 py-2 text-left transition hover:bg-raised">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{label}</span>
          <span className="block text-xs text-muted">{t("{pct} of theirs kept · {live} live · we run {ours}", { pct: pct(rate), live: theirLive, ours })}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-accent opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">{t("Their examples")}<IconArrowRight className="size-3.5" /></span>
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
  const { t, tn, intl } = useT();
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
          <span className="shrink-0 text-sm font-medium">{t("How we compare")}</span>
          <span className="truncate text-xs text-muted">{t("Our ads against the typical competitor")}{formats.length ? ` · ${tn(formats.length, "{n} format they keep that we barely use", "{n} formats they keep that we barely use")}` : ""}</span>
        </button>
        {due > 0 && (
          <button type="button" onClick={onRefresh} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-caution-soft px-2.5 text-xs font-medium text-caution-ink transition hover:opacity-80"
            title={t("Our ads live {n}+ days: likely wearing out, so make the next version before they stop", { n: REFRESH_DAYS })}>
            {t("{n} of ours due for a refresh", { n: due })}<IconArrowRight className="size-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="grid gap-4 border-t border-line px-1 pt-2 pb-3 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <div className="min-w-0 px-3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-5 text-sm">
              <span className="pb-2 text-xs text-muted" />
              <span className="pb-2 text-right text-xs text-muted">{t("Us")}</span>
              <span className="pb-2 text-right text-xs text-muted" title={t("The median across competitors: each competitor counts once")}>{t("Typical competitor")}</span>
              {ROWS.map((row) => (
                <div key={row.key} className="contents">
                  <span className="truncate border-t border-line py-2 text-label" title={t(row.hint, { n: KEPT_AFTER_DAYS })}>{t(row.label)}</span>
                  <span className="border-t border-line py-2 text-right font-medium tabular-nums">{row.format(us[row.key], intl, t)}</span>
                  <span className="border-t border-line py-2 text-right text-muted tabular-nums">{row.format(them[row.key], intl, t)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid min-w-0 gap-3 @2xl:grid-cols-2">
            <Column title={t("Formats they keep, we barely use")} empty={t("We already use every format they keep running.")}>
              {formats.map((g) => <Gap key={g.key} label={AD_FORMAT_LABEL[g.key] ? t(AD_FORMAT_LABEL[g.key]) : g.key} rate={g.rate} theirLive={g.theirLive} ours={g.ours} onOpen={() => onTheirExamples({ format: g.key })} />)}
            </Column>
            <Column title={t("Hooks they keep, we barely use")} empty={t("We already use every hook they keep running.")}>
              {hooks.map((g) => <Gap key={g.key} label={t("{hook} hook", { hook: HOOK_LABEL[g.key] ? t(HOOK_LABEL[g.key]) : g.key })} rate={g.rate} theirLive={g.theirLive} ours={g.ours} onOpen={() => onTheirExamples({ hook: g.key })} />)}
            </Column>
          </div>
          <p className="px-3 text-xs text-faint @4xl:col-span-2">
            {t("“Kept”: of their ads first seen here {n}+ days ago, the share still running; listed when it's at least their average. “Barely use”: 2 or fewer of ours live. Click one to see their long runners of it.", { n: KEPT_AFTER_DAYS })}
          </p>
        </div>
      )}
    </Card>
  );
}
