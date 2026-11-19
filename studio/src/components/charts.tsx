"use client";
// Chart primitives in the reference's style: hatched "planned" bars, a solid blue "actual", magenta for
// what was lost, dashed targets and white hover cards. Plain SVG and CSS, no chart library; colours come
// from the tokens, so they follow the theme. Every chart takes plain numbers and a formatter.
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cx, stagger } from "./ui";

type Format = (n: number) => string;
const plain: Format = (n) => `${Math.round(n * 10) / 10}`;

/** A white hover card made of segments split by hairlines: "October | 35.2% on the current path | 36.7% with changes". */
export function ChartTip({ parts, className, style }: { parts: ReactNode[]; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cx("pointer-events-none inline-flex items-center rounded-control bg-raised py-1.5 text-caption whitespace-nowrap shadow-pop", className)} style={style}>
      {parts.map((part, i) => <span key={i} className={cx("px-3", i > 0 && "border-l border-line")}>{part}</span>)}
    </div>
  );
}

// MARK: Bars

/**
 * Vertical bars, hatched and fading toward the base, the latest one solid with its value on top, and a
 * dashed target line ("Last 12 weeks"). Hover a bar for its value.
 */
export function BarChart({ data, target, targetLabel, format = plain, height = 190, solidLast = true, className }: {
  data: { label: string; value: number }[]; target?: number; targetLabel?: string; format?: Format; height?: number; solidLast?: boolean; className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), target ?? 0, 1) * 1.08;
  const y = (v: number) => (v / max) * 100;
  return (
    <div className={className}>
      <div className="relative" style={{ height }}>
        {target != null && (
          <div className="absolute inset-x-0 border-t border-dashed border-ink/70" style={{ bottom: `${y(target)}%` }}>
            {targetLabel && <span className={cx("absolute bottom-1 text-xs text-label", solidLast && data.length > 0 && Math.abs(y(data[data.length - 1].value) - y(target)) < 14 ? "left-0" : "right-0")}>{targetLabel}</span>}
          </div>
        )}
        <div className="absolute inset-0 flex items-end gap-[clamp(4px,1.6cqi,14px)]">
          {data.map((d, i) => {
            const last = solidLast && i === data.length - 1;
            return (
              <div key={d.label + i} className="relative flex h-full min-w-0 flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <div className={cx("grow-y w-full rounded-t-sm rounded-b-xs", last ? "bg-accent" : "hatch fade-down text-accent-muted", hover === i && !last && "text-accent")}
                  style={{ height: `${y(d.value)}%`, ...stagger(i) }} />
                {(last || hover === i) && <span className="absolute left-1/2 -translate-x-1/2 text-xs font-medium whitespace-nowrap tabular-nums" style={{ bottom: `calc(${y(d.value)}% + 6px)` }}>{format(d.value)}</span>}
              </div>
            );
          })}
        </div>
      </div>
      {data.length > 0 && <div className="mt-3 flex justify-between text-xs text-muted"><span>{data[0].label}</span><span>{data[data.length - 1].label}</span></div>}
    </div>
  );
}

/**
 * A horizontal waterfall from a start to an end ("Why it is under target"): the start bar hatched grey,
 * each step a hatched magenta block where it loses (blue where it gains), dashed connectors, and the end
 * a solid blue block. Values are in the same unit; `domain` is the axis range.
 */
export function Waterfall({ start, steps, end, domain, ticks, format = plain, className }: {
  start: { label: string; value: number }; steps: { label: string; delta: number; note?: string }[]; end: { label: string; value: number };
  domain: [number, number]; ticks?: number[]; format?: Format; className?: string;
}) {
  const [lo, hi] = domain;
  const pct = (v: number) => ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100;
  const rows = steps.map((step, i) => {
    const from = start.value + steps.slice(0, i).reduce((n, s) => n + s.delta, 0);
    return { ...step, from, to: from + step.delta };
  });
  return (
    <div className={className}>
      <div className="grid gap-[18px]">
        <Row label={start.label} note={format(start.value)}>
          <div className="hatch grow-x absolute inset-y-0 left-0 rounded-xs text-faint/70" style={{ width: `${pct(start.value)}%` }} />
        </Row>
        {rows.map((row, i) => {
          const left = pct(Math.min(row.from, row.to)), right = pct(Math.max(row.from, row.to));
          return (
            <Row key={row.label} label={row.label} note={row.note ?? format(row.delta)} noteClass={row.delta < 0 ? "text-warn" : "text-win"} connector={pct(row.from)}>
              <div className={cx("hatch grow-x absolute inset-y-0 rounded-xs", row.delta < 0 ? "text-warn" : "text-win")} style={{ left: `${left}%`, width: `${Math.max(right - left, 0.8)}%`, ...stagger(i + 1) }} />
            </Row>
          );
        })}
        <Row label={end.label} note={format(end.value)} connector={pct(end.value)}>
          <div className="grow-x absolute inset-y-0 left-0 w-[34px] rounded-sm bg-accent" style={{ left: `calc(${pct(end.value)}% - 34px)`, ...stagger(rows.length + 1) }} />
        </Row>
      </div>
      {ticks && (
        <div className="relative mt-3 h-4 text-xs text-muted">
          {ticks.map((t, i) => <span key={t} className={cx("absolute", i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: `${pct(t)}%` }}>{format(t)}</span>)}
        </div>
      )}
    </div>
  );
}

function Row({ label, note, noteClass, connector, children }: { label: string; note: string; noteClass?: string; connector?: number; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between gap-3 text-sm"><span className="min-w-0 truncate">{label}</span><span className={cx("shrink-0 tabular-nums", noteClass ?? "text-label")}>{note}</span></div>
      <div className="relative h-[22px]">
        {connector != null && <span className="absolute -top-[52px] bottom-1/2 border-l border-dashed border-faint/70" style={{ left: `${connector}%` }} />}
        {children}
      </div>
    </div>
  );
}

/**
 * Planned against actual on one line ("Estimate vs actual"): the plan hatched light blue above, the actual
 * solid blue below, and the part over plan hatched magenta. Values share one scale (`max`).
 */
export function CompareBar({ planned, actual, max, className }: { planned: number; actual: number; max: number; className?: string }) {
  const w = (v: number) => `${(Math.max(0, v) / max) * 100}%`;
  return (
    <div className={cx("grid gap-1.5", className)}>
      <div className="hatch grow-x h-2 rounded-full text-accent-muted" style={{ width: w(planned) }} />
      <div className="flex h-2">
        <div className="grow-x h-full rounded-full bg-accent" style={{ width: w(Math.min(planned, actual)) }} />
        {actual > planned && <div className="hatch grow-x -ml-1 h-full rounded-r-full text-warn" style={{ width: w(actual - planned) }} />}
      </div>
    </div>
  );
}

/**
 * Columns stepping down from a plan to what was kept ("Where the profit went"): each column hatched blue
 * for what is left with the loss stacked on top in hatched magenta, a soft blue ribbon linking the tops,
 * and the last column solid blue.
 */
export function BridgeChart({ steps, format = plain, height = 320, className }: {
  steps: { label: string; value: number; loss?: number; lossLabel?: string }[]; format?: Format; height?: number; className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const max = Math.max(...steps.map((s) => s.value + (s.loss ?? 0)), 1) * 1.18;
  const top = (v: number) => 100 - (v / max) * 100;
  const n = steps.length;
  return (
    <div className={className}>
      <div className="relative" style={{ height }}>
        <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs><linearGradient id={`rb-${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.18" /><stop offset="1" stopColor="var(--color-accent)" stopOpacity="0" /></linearGradient></defs>
          <polygon fill={`url(#rb-${id})`} points={[...steps.map((s, i) => `${((i + 0.5) / n) * 100},${top(s.value + (s.loss ?? 0))}`), `${((n - 0.5) / n) * 100},100`, `${(0.5 / n) * 100},100`].join(" ")} />
        </svg>
        <div className="absolute inset-0 flex items-end border-b border-line">
          {steps.map((s, i) => {
            const last = i === n - 1;
            return (
              <div key={s.label} className="relative flex h-full flex-1 flex-col items-center justify-end px-[9%]">
                <div className="absolute inset-x-0 text-center" style={{ top: `calc(${top(s.value + (s.loss ?? 0))}% - ${s.loss ? 58 : 40}px)` }}>
                  <p className="text-figure font-medium tabular-nums">{format(s.value)}</p>
                  {s.loss ? <p className="text-xs font-medium text-warn">−{format(s.loss)}{s.lossLabel ? ` ${s.lossLabel}` : ""}</p> : null}
                </div>
                <div className="grow-y flex w-full flex-col" style={{ height: `${((s.value + (s.loss ?? 0)) / max) * 100}%`, ...stagger(i) }}>
                  {s.loss ? <div className="hatch w-full shrink-0 rounded-t-xs text-warn" style={{ height: `${(s.loss / (s.value + s.loss)) * 100}%` }} /> : null}
                  <div className={cx("w-full flex-1", s.loss ? "" : "rounded-t-xs", last ? "rounded-t-sm bg-accent" : "hatch fade-down text-accent")} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex text-xs text-label">{steps.map((s) => <span key={s.label} className="flex-1 truncate px-1 text-center">{s.label}</span>)}</div>
    </div>
  );
}

// MARK: Line

export interface LineSeries { key: string; label: string; values: (number | null)[]; color: "accent" | "win" | "warn" | "ink"; dashed?: boolean; hollow?: boolean }

const STROKE: Record<LineSeries["color"], string> = { accent: "var(--color-accent)", win: "var(--color-win)", warn: "var(--color-warn)", ink: "var(--color-ink)" };

/**
 * A line chart with an optional likely-range band, a dashed target and a hover card ("Margin outlook").
 * Series share the x labels; null values leave gaps (so actuals can stop where the forecast starts).
 */
export function LineChart({ labels, series, band, target, targetLabel, domain, yTicks, format = plain, height = 320, tip, className }: {
  labels: string[]; series: LineSeries[]; band?: { from: number; low: number[]; high: number[] }; target?: number; targetLabel?: string;
  domain?: [number, number]; yTicks?: number[]; format?: Format; height?: number; tip?: (index: number) => ReactNode[]; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const values = series.flatMap((s) => s.values.filter((v): v is number => v != null)).concat(band ? [...band.low, ...band.high] : [], target != null ? [target] : []);
  const [lo, hi] = domain ?? [Math.min(...values), Math.max(...values)];
  const pad = { l: 44, r: 8, t: 12, b: 34 };
  const plotW = Math.max(width - pad.l - pad.r, 10), plotH = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (labels.length < 2 ? plotW / 2 : (i / (labels.length - 1)) * plotW * 0.94 + plotW * 0.03);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * plotH;
  const ticks = yTicks ?? [lo, (lo + hi) / 2, hi];
  const path = (vals: (number | null)[]) => vals.reduce((d, v, i) => (v == null ? d : `${d}${d && vals[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`), "");
  const bandPath = useMemo(() => {
    if (!band || !width) return "";
    const idx = band.low.map((_, k) => band.from + k);
    return `M${idx.map((i, k) => `${x(i)},${y(band.high[k])}`).join("L")}L${[...idx].reverse().map((i) => `${x(i)},${y(band.low[i - band.from])}`).join("L")}Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band, width, lo, hi, height]);

  return (
    <div ref={ref} className={cx("relative", className)} style={{ height }} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible" role="img">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
              <text x={0} y={y(t) + 4} className="fill-faint text-xs">{format(t)}</text>
            </g>
          ))}
          {band && band.from < labels.length && (
            <rect x={x(band.from) + 8} y={pad.t} width={Math.max(x(labels.length - 1) - x(band.from) + 8, 0)} height={plotH + 4} rx={12} fill="var(--color-accent-soft)" opacity={0.7} />
          )}
          {bandPath && <path d={bandPath} fill="var(--color-accent)" opacity={0.16} />}
          {target != null && (
            <g>
              <line x1={pad.l} x2={width - pad.r} y1={y(target)} y2={y(target)} stroke="var(--color-ink)" strokeDasharray="3 3" />
              {targetLabel && <text x={pad.l + 4} y={y(target) - 7} className="fill-ink text-xs font-medium">{targetLabel}</text>}
            </g>
          )}
          {series.map((s) => (
            <g key={s.key}>
              <path d={path(s.values)} fill="none" stroke={STROKE[s.color]} strokeWidth={2} strokeDasharray={s.dashed ? "6 4" : undefined} strokeLinejoin="round" />
              {s.values.map((v, i) => v == null ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5.5 : 4.5} fill={s.hollow ? "var(--color-raised)" : STROKE[s.color]} stroke={STROKE[s.color]} strokeWidth={2} />
              ))}
            </g>
          ))}
          {labels.map((label, i) => (
            <Fragment key={label + i}>
              <text x={x(i)} y={height - 8} textAnchor="middle" className="fill-label text-xs">{label}</text>
              <rect x={x(i) - plotW / labels.length / 2} y={pad.t} width={plotW / labels.length} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
            </Fragment>
          ))}
        </svg>
      )}
      {hover != null && tip && width > 0 && (
        <ChartTip parts={tip(hover)} className="absolute -translate-x-1/2 -translate-y-full" style={{ left: Math.min(Math.max(x(hover), 140), width - 140), top: pad.t + 4 }} />
      )}
    </div>
  );
}

// MARK: Heat map

/** Rows × columns of values in magenta tints, with column totals on top and row totals on the right ("Where it leaks"). */
export function HeatGrid({ columns, rows, format = plain, steps, className }: {
  columns: string[]; rows: { label: string; values: number[] }[]; format?: Format; steps?: number[]; className?: string;
}) {
  const all = rows.flatMap((r) => r.values);
  const cuts = steps ?? [0.25, 0.5, 0.75].map((q) => [...all].sort((a, b) => a - b)[Math.floor(q * (all.length - 1))]);
  const level = (v: number) => cuts.filter((c) => v > c).length; // 0..3
  const TINTS = ["bg-heat-1 text-ink", "bg-heat-2 text-ink", "bg-heat-3 text-white", "bg-heat-4 text-white"];
  const colTotals = columns.map((_, c) => rows.reduce((n, r) => n + (r.values[c] ?? 0), 0));
  return (
    <div className={cx("overflow-x-auto", className)}>
      <div className="grid min-w-[560px] items-center gap-2" style={{ gridTemplateColumns: `minmax(80px,auto) repeat(${columns.length}, minmax(64px,1fr)) minmax(64px,auto)` }}>
        <span />
        {columns.map((c, i) => <span key={c} className="pl-1"><span className="block text-xs text-muted">{c}</span><span className="block text-sm font-medium tabular-nums">{format(colTotals[i])}</span></span>)}
        <span className="self-end text-right text-xs text-muted">Total</span>
        {rows.map((row, r) => (
          <Fragment key={row.label}>
            <span className="text-sm font-medium">{row.label}</span>
            {row.values.map((v, c) => (
              <span key={c} className={cx("rise grid h-[62px] place-items-center rounded-control text-sm font-medium tabular-nums", TINTS[level(v)])} style={stagger(r * columns.length + c)}>{format(v)}</span>
            ))}
            <span className="text-right text-sm font-medium tabular-nums">{format(row.values.reduce((a, b) => a + b, 0))}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// MARK: Timeline

/** Steps along a line ("What happened"): a coloured dot, date, title and detail for each. */
export function Timeline({ steps, className }: { steps: { date: string; title: string; body?: string; tone?: "accent" | "warn" | "win" }[]; className?: string }) {
  return (
    <ol className={cx("relative grid gap-4 @xl:gap-3", className)} style={{ gridTemplateColumns: `repeat(auto-fit, minmax(130px, 1fr))` }}>
      <span aria-hidden className="absolute top-[6px] right-4 left-1 hidden h-px bg-line @xl:block" />
      {steps.map((s, i) => (
        <li key={i} className="rise relative" style={stagger(i)}>
          <span className={cx("relative block size-3 rounded-full ring-4 ring-card", s.tone === "warn" ? "bg-warn" : s.tone === "win" ? "bg-win" : "bg-accent")} />
          <p className="mt-3 text-caption text-muted">{s.date}</p>
          <p className="mt-1 text-sm font-medium">{s.title}</p>
          {s.body && <p className="mt-1 text-caption text-label">{s.body}</p>}
        </li>
      ))}
    </ol>
  );
}

/** A bar of dots, filled up to a count ("29 jobs" in "Where to act first"). */
export function DotMeter({ count, total = count, tone = "warn", className }: { count: number; total?: number; tone?: "warn" | "accent" | "win"; className?: string }) {
  return (
    <span className={cx("flex flex-wrap gap-[5px]", className)} aria-label={`${count} of ${total}`}>
      {Array.from({ length: total }, (_, i) => <span key={i} className={cx("size-[9px] rounded-full", i < count ? (tone === "warn" ? "bg-heat-2" : tone === "win" ? "bg-win/60" : "bg-accent-muted") : "bg-control")} />)}
    </span>
  );
}

// MARK: Ranked bars

/**
 * A ranked list with a hatched bar under each row ("From all leakage to the people behind it"): label and
 * value on one line, the bar beneath scaled to the largest. The selected row lifts to white with a solid
 * label colour.
 */
export function RankBars({ rows, format = plain, tone = "warn", selected, onSelect, className }: {
  rows: { key: string; label: ReactNode; value: number; note?: ReactNode }[]; format?: Format; tone?: "warn" | "accent" | "faint";
  selected?: string | null; onSelect?: (key: string) => void; className?: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  const color = tone === "warn" ? "text-warn" : tone === "accent" ? "text-accent" : "text-faint";
  return (
    <ul className={cx("grid grid-cols-1 gap-1", className)}>
      {rows.map((row, i) => {
        const on = selected === row.key;
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className={cx("min-w-0 truncate", on && "font-medium")}>{row.label}</span>
              <span className="flex shrink-0 items-baseline gap-2">{row.note && <span className="text-xs text-muted">{row.note}</span>}<span className={cx("font-medium tabular-nums", on && color)}>{format(row.value)}</span></span>
            </span>
            <span className="mt-2 block h-[5px] rounded-full bg-raised/80">
              <span className={cx("hatch grow-x block h-full rounded-full", on ? color : "text-faint/70")} style={{ width: `${(row.value / max) * 100}%`, ...stagger(i) }} />
            </span>
          </>
        );
        return (
          <li key={row.key}>
            {onSelect
              ? <button type="button" onClick={() => onSelect(row.key)} className={cx("block w-full rounded-control px-3 py-2.5 text-left transition", on ? "bg-raised shadow-raised" : "hover:bg-raised/60")}>{body}</button>
              : <div className="px-3 py-2.5">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}
