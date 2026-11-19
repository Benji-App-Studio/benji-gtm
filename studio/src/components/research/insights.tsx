"use client";

// Research → Insights: what the imports say beyond single ads. "Competitors" is a scorecard per
// competitor (how fast it launches, how much it keeps, what it scales, its weekly launches); "What lasts"
// ranks formats, hook types and creative types by the share of their ads still running 2+ weeks after they were first seen here.
// Both read the ads already on the page. The card folds away and remembers it.

import { useEffect, useMemo, useState } from "react";
import { AD_FORMAT_LABEL, competitorStats, INSIGHT_WEEKS, KEPT_AFTER_DAYS, lastingBy, LONG_RUNNER_DAYS, MANY_VARIANTS, TYPE_GROUPS, type LastingRow, type RankedAdRow } from "@/lib/research";
import { HOOK_LABEL } from "@/lib/types";
import { RankBars } from "../charts";
import { IconChevronDown } from "../icons";
import { Card, cx, segmentClass, segmentTrackClass, Table, Td, Th, Tr } from "../ui";
import { PageLogo } from "./page-logo";
import { readStored, storageKey } from "@/lib/storage-keys";

const pct = (n: number | null) => (n == null ? "–" : `${Math.round(n * 100)}%`);
const TYPE_LABEL = Object.fromEntries(TYPE_GROUPS.map((g) => [g.id, g.label])) as Record<string, string>;

function useOpen(key: string) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const restore = async () => { try { setOpen(readStored(localStorage, key) === "1"); } catch { /* not kept */ } };
    restore();
  }, [key]);
  const set = (next: boolean) => { setOpen(next); try { localStorage.setItem(key, next ? "1" : "0"); } catch { /* not kept */ } };
  return [open, set] as const;
}

/** Ads launched per week as small bars, this week last; hover a bar for its week. */
function WeeklyBars({ weekly, now }: { weekly: number[]; now: number }) {
  const max = Math.max(...weekly, 1);
  return (
    <span className="flex h-6 items-end gap-[2px]" aria-label={`Launched per week, oldest first: ${weekly.join(", ")}`}>
      {weekly.map((n, i) => {
        const weeksAgo = weekly.length - 1 - i;
        const from = new Date(now - (weeksAgo + 1) * 7 * 86_400_000 + 86_400_000);
        return (
          <span key={i} title={`${weeksAgo === 0 ? "Last 7 days" : `Week from ${from.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}: ${n} launched`}
            className={cx("w-[7px] rounded-t-[2px]", i === weekly.length - 1 ? "bg-accent" : "bg-accent-muted")}
            style={{ height: `${n ? Math.max(12, (n / max) * 100) : 4}%`, opacity: n ? 1 : 0.35 }} />
        );
      })}
    </span>
  );
}

function Lasting({ title, rows, label }: { title: string; rows: LastingRow[]; label: (key: string) => string }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-1 px-3">{title}</p>
      {rows.length
        ? <RankBars tone="accent" rows={rows.slice(0, 8).map((r) => ({ key: r.key, label: label(r.key), value: r.rate, note: `${r.lasted.toLocaleString()} of ${r.ads.toLocaleString()}` }))} format={(v) => pct(v)} />
        : <p className="px-3 py-2 text-sm text-muted">Not enough ads seen {KEPT_AFTER_DAYS}+ days ago yet: import again in a week or two.</p>}
    </div>
  );
}

export function ResearchInsights({ ads, competitor, ours, onPick }: {
  /** This side's ads, every one (live and stopped). */
  ads: RankedAdRow[];
  /** The competitor picked above the ads ("" for all): "What lasts" reads only theirs. */
  competitor: string;
  ours: boolean;
  onPick: (name: string) => void;
}) {
  const [open, setOpen] = useOpen(storageKey(`research.insights.${ours ? "ours" : "theirs"}`));
  const [tab, setTab] = useState<"competitors" | "lasting">("competitors");
  const [now] = useState(() => Date.now());
  const stats = useMemo(() => competitorStats(ads, now), [ads, now]);
  const lasting = useMemo(() => lastingBy(competitor ? ads.filter((ad) => (ad.competitor ?? ad.page_name) === competitor) : ads, now), [ads, competitor, now]);
  if (!ads.length) return null;
  const launched = stats.reduce((s, c) => s + c.launched, 0);
  const stopped = stats.reduce((s, c) => s + c.stopped, 0);
  const busiest = [...stats].sort((a, b) => b.launched - a.launched)[0];

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="-ml-1 flex min-w-0 items-center gap-2 rounded-control py-1 pr-2 pl-1 text-left transition hover:bg-hover">
          <IconChevronDown className={cx("size-4 shrink-0 text-muted transition", !open && "-rotate-90")} />
          <span className="text-title font-medium">Insights</span>
          <span className="truncate text-sm text-muted">
            Last 14 days: {launched.toLocaleString()} launched · {stopped.toLocaleString()} stopped{busiest?.launched ? ` · ${busiest.name} tests the most` : ""}
          </span>
        </button>
        {open && (
          <div className={segmentTrackClass} role="tablist" aria-label="Insight">
            <button type="button" role="tab" aria-selected={tab === "competitors"} onClick={() => setTab("competitors")} className={segmentClass(tab === "competitors")}>{ours ? "Pages" : "Competitors"}</button>
            <button type="button" role="tab" aria-selected={tab === "lasting"} onClick={() => setTab("lasting")} className={segmentClass(tab === "lasting")}>What lasts</button>
          </div>
        )}
      </div>

      {open && tab === "competitors" && (
        <div className="border-t border-line px-2 pt-3 pb-2">
          <Table minWidth={760}>
            <thead>
              <tr>
                <Th>{ours ? "Page" : "Competitor"}</Th>
                <Th className="text-right">Live</Th>
                <Th className="text-right" title="Launched in the last 14 days">New · 14d</Th>
                <Th className="text-right" title="Stopped in the last 14 days">Stopped · 14d</Th>
                <Th className="text-right" title={`Of its ads first seen here ${KEPT_AFTER_DAYS}+ days ago, the share still running. Higher: it keeps what it launches; lower: it tests hard and cuts fast.`}>Kept 2+ wks</Th>
                <Th className="text-right" title={`Live ads running ${LONG_RUNNER_DAYS}+ days`}>Long runners</Th>
                <Th className="text-right" title={`Live creatives with ${MANY_VARIANTS}+ copies`}>Scaled</Th>
                <Th className="text-right" title="Share of live ads that are video">Video</Th>
                <Th title={`Ads launched per week, last ${INSIGHT_WEEKS} weeks (this week on the right)`}>Launches / week</Th>
              </tr>
            </thead>
            <tbody>
              {stats.map((c) => (
                <Tr key={c.name} className={cx("cursor-pointer", competitor === c.name && "[&>td]:bg-raised")} onClick={() => onPick(competitor === c.name ? "" : c.name)} title={`Show ${c.name}'s ads`}>
                  <Td><span className="flex items-center gap-2"><PageLogo pageId={c.pageId} name={c.name} size="sm" /><span className="truncate font-medium">{c.name}</span></span></Td>
                  <Td className="text-right tabular-nums">{c.live.toLocaleString()}</Td>
                  <Td className="text-right tabular-nums">{c.launched.toLocaleString()}</Td>
                  <Td className="text-right tabular-nums">{c.stopped.toLocaleString()}</Td>
                  <Td className="text-right tabular-nums">{pct(c.keptRate)}</Td>
                  <Td className="text-right tabular-nums">{c.longRunners.toLocaleString()}</Td>
                  <Td className="text-right tabular-nums">{c.scaled.toLocaleString()}</Td>
                  <Td className="text-right tabular-nums">{pct(c.videoShare)}</Td>
                  <Td><WeeklyBars weekly={c.weekly} now={now} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <p className="px-2 pt-2 text-xs text-faint">Click a row to see its ads. Stopped counts start from your imports: an ad launched and stopped between two imports is never seen.</p>
        </div>
      )}

      {open && tab === "lasting" && (
        <div className="border-t border-line px-1 pt-3 pb-2">
          <div className="grid gap-4 @3xl:grid-cols-3">
            <Lasting title="By format" rows={lasting.format} label={(k) => AD_FORMAT_LABEL[k] ?? k} />
            <Lasting title="By hook" rows={lasting.hook} label={(k) => HOOK_LABEL[k] ?? k} />
            <Lasting title="By creative type" rows={lasting.type} label={(k) => TYPE_LABEL[k] ?? k} />
          </div>
          <p className="px-3 pt-2 text-xs text-faint">
            Share still running, of the ads first seen here {KEPT_AFTER_DAYS}+ days ago{competitor ? ` (${competitor} only)` : ""}: a higher share means advertisers keep paying for that kind of ad. Groups under 10 ads are left out. It sharpens with every import.
          </p>
        </div>
      )}
    </Card>
  );
}
