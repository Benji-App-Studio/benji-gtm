"use client";
// Measure's charts: diagonal-hatched bars with the current period solid and a dashed target, a
// stepped waterfall with hatched losses and dashed connectors, and a line with a range band and a
// hover card. Self-contained (HTML + CSS, SVG only for the line) and sized in percentages, so they
// fit any width without measuring.
//
// Colour comes from theme tokens only (accent for the series, warn for losses, ink for targets),
// so light and dark both work. Labels stay in text tokens; the marks carry the colour.
import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cx } from "@/components/ui";

/** Diagonal stripes ("/") in a token colour, fading a little toward the baseline. */
export function hatch(color: string, fade = true): CSSProperties {
  const stripes = `repeating-linear-gradient(-45deg, ${color} 0 1.6px, transparent 1.6px 5px)`;
  return { backgroundImage: fade ? `linear-gradient(to bottom, transparent 35%, color-mix(in srgb, var(--color-card) 55%, transparent)), ${stripes}` : stripes };
}

const ACCENT = "var(--color-accent)";
const WARN = "var(--color-warn)";
const NEUTRAL = "color-mix(in srgb, var(--color-ink) 35%, transparent)";

/** Where a hover card sits so it never leaves its chart: left-aligned near the left edge, right near the right. */
const anchor = (fraction: number): CSSProperties =>
  fraction < 0.25 ? { left: `${fraction * 100}%`, transform: "translate(-12px, -100%)" }
  : fraction > 0.75 ? { left: `${fraction * 100}%`, transform: "translate(calc(-100% + 12px), -100%)" }
  : { left: `${fraction * 100}%`, transform: "translate(-50%, -100%)" };

/** The hover card: a small raised box with the value first, then what it is. */
export function HoverCard({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <div role="status" style={style} className={cx("pointer-events-none absolute z-10 flex max-w-[min(460px,88vw)] flex-wrap items-center gap-x-2 gap-y-0.5 rounded-control border border-line bg-raised px-2.5 py-1.5 text-xs whitespace-nowrap text-muted shadow-pop", className)}>
      {children}
    </div>
  );
}

/** A hover-card segment: the value strong, its label quiet, separated by a hairline. */
export function Readout({ value, label, first }: { value: ReactNode; label?: ReactNode; first?: boolean }) {
  return (
    <span className={cx("inline-flex items-baseline gap-1", !first && "border-l border-line pl-2")}>
      <strong className="font-medium text-ink tabular-nums">{value}</strong>{label && <span>{label}</span>}
    </span>
  );
}

// MARK: Hatched bars

export interface BarPoint { key: string; label: string; value: number; tip?: ReactNode }

/** Columns, hatched, with the last one (the current period) solid and labelled, and a dashed target. */
export function HatchedBars({ points, target, format, height = 190, name }: { points: BarPoint[]; target?: { value: number; label: string } | null; format: (n: number) => string; height?: number; name: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...points.map((p) => p.value), target?.value ?? 0, 0) * 1.12 || 1;
  const pct = (v: number) => `${Math.max(0, (v / max) * 100)}%`;
  const last = points.length - 1;
  const dense = points.length > 40;
  return (
    <div>
      <div className="relative mt-7" style={{ height }} onPointerLeave={() => setHover(null)}>
        {target && target.value > 0 && (
          <div className="pointer-events-none absolute inset-x-0 z-[1] border-t border-dashed border-ink/60" style={{ bottom: pct(target.value) }}>
            <span className="absolute right-0 bottom-1.5 rounded-full border border-hairline bg-raised px-2 py-0.5 text-xs text-ink">{target.label}</span>
          </div>
        )}
        <div className={cx("absolute inset-0 flex items-end justify-between", dense ? "gap-px" : "gap-[3px]")} role="list" aria-label={name}>
          {points.map((p, i) => (
            <button key={p.key} type="button" role="listitem" aria-label={`${p.label}: ${format(p.value)}`}
              onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              className="relative flex h-full min-w-0 flex-1 items-end justify-center outline-none">
              <span className={cx("block w-full max-w-[22px] rounded-t-sm transition-opacity", hover != null && hover !== i && "opacity-55")}
                style={{ height: pct(p.value), minHeight: p.value > 0 ? 2 : 0, ...(i === last ? { background: ACCENT } : hatch(ACCENT)) }} />
              {i === last && p.value > 0 && hover == null && (
                <span className="absolute -translate-y-1.5 text-xs font-medium whitespace-nowrap text-ink tabular-nums" style={{ bottom: pct(p.value) }}>{format(p.value)}</span>
              )}
            </button>
          ))}
        </div>
        {hover != null && points[hover] && (
          <HoverCard style={{ ...anchor((hover + 0.5) / points.length), top: -6 }}>
            {points[hover].tip ?? <><Readout first value={format(points[hover].value)} /><span>{points[hover].label}</span></>}
          </HoverCard>
        )}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted">
        <span>{points[0]?.label}</span>
        <span>{points[last]?.label}</span>
      </div>
    </div>
  );
}

// MARK: Waterfall

export interface Step { label: string; value: number; note?: string }

/**
 * A horizontal waterfall, top to bottom: the starting amount (hatched grey), each loss as a hatched
 * step down from where the last one ended (dashed connectors between), and the result solid.
 */
export function Waterfall({ start, steps, end, format }: { start: Step; steps: Step[]; end: Step; format: (n: number) => string }) {
  // Each step starts where the one before it ended.
  const rows = steps.map((s, i) => {
    const from = start.value + steps.slice(0, i).reduce((total, p) => total + p.value, 0);
    return { ...s, from, to: from + s.value };
  });
  const lo = Math.min(0, end.value, ...rows.map((r) => r.to));
  const hi = Math.max(start.value, ...rows.map((r) => r.from), end.value, 0) || 1;
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const bar = (a: number, b: number) => ({ left: `${x(Math.min(a, b))}%`, width: `${Math.max(x(Math.max(a, b)) - x(Math.min(a, b)), 0.8)}%` });
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + (hi - lo) * f);

  const row = (label: string, value: ReactNode, note: string | undefined, track: ReactNode, connectAt?: number) => (
    <div className="relative">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-ink">{label}</span>
        <span className="shrink-0 text-right tabular-nums">{value}</span>
      </div>
      {note && <p className="text-xs text-muted">{note}</p>}
      <div className="relative mt-2 h-5">{track}</div>
      {connectAt != null && <span aria-hidden className="absolute top-full h-full border-l border-dashed border-ink/35" style={{ left: `${x(connectAt)}%` }} />}
    </div>
  );

  return (
    <div>
      <div className="flex flex-col gap-5">
        {row(start.label, <span className="text-ink">{format(start.value)}</span>, start.note,
          <span className="absolute inset-y-0 rounded-xs" style={{ ...bar(0, start.value), ...hatch(NEUTRAL, false) }} />, start.value)}
        {rows.map((r) => (
          <div key={r.label}>
            {row(r.label, <span className="text-warn">{r.value < 0 ? "−" : "+"}{format(Math.abs(r.value))}</span>, r.note,
              <span className="absolute inset-y-0 rounded-xs" style={{ ...bar(r.from, r.to), ...hatch(r.value < 0 ? WARN : ACCENT, false) }} />,
              r.to)}
          </div>
        ))}
        {row(end.label, <span className={end.value < 0 ? "text-warn" : "text-ink"}>{end.value < 0 ? "−" : ""}{format(Math.abs(end.value))}</span>, end.note,
          <span className="absolute inset-y-0 rounded-xs" style={{ ...bar(0, end.value), background: end.value < 0 ? WARN : ACCENT }} />)}
      </div>
      <div className="relative mt-3 h-4 text-xs text-muted tabular-nums">
        {ticks.map((t, i) => (
          <span key={i} className={cx("absolute", i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: `${x(t)}%` }}>{format(t)}</span>
        ))}
      </div>
    </div>
  );
}

// MARK: Line with a band

export interface LinePoint { key: string; label: string; value: number | null; other: number | null; tip?: ReactNode }

function niceMax(v: number) {
  if (v <= 0) return 4;
  const step = 10 ** Math.floor(Math.log10(v));
  const n = v / step;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : 10) * step;
}

/**
 * One measure over time from the chosen source (solid), the other source (dashed) and the band
 * between them: the range the true number most likely sits in. One y-axis, always.
 */
export function BandLine({ points, height = 240, name, format }: { points: LinePoint[]; height?: number; name: string; format: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const top = niceMax(Math.max(...points.flatMap((p) => [p.value ?? 0, p.other ?? 0]), 0));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => top * f);
  const X = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const Y = (v: number) => 100 - (v / top) * 100;
  const path = (pick: (p: LinePoint) => number | null) => {
    let d = "";
    let pen = false;
    points.forEach((p, i) => {
      const v = pick(p);
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${X(i) * 10},${Y(v)}`;
      pen = true;
    });
    return d;
  };
  const both = points.filter((p) => p.value != null && p.other != null);
  const band = both.length > 1
    ? `M${points.map((p, i) => (p.value != null && p.other != null ? `${X(i) * 10},${Y(Math.max(p.value, p.other))}` : null)).filter(Boolean).join("L")}`
      + `L${[...points.keys()].reverse().map((i) => (points[i].value != null && points[i].other != null ? `${X(i) * 10},${Y(Math.min(points[i].value!, points[i].other!))}` : null)).filter(Boolean).join("L")}Z`
    : "";
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setHover(Math.round(Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1) * (n - 1)));
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      setHover((h) => Math.min(Math.max((h ?? n - 1) + (event.key === "ArrowRight" ? 1 : -1), 0), n - 1));
    }
  };
  const showDots = n <= 31;

  return (
    <div className="flex gap-3">
      <div className="relative w-9 shrink-0 text-right text-xs text-muted tabular-nums" style={{ height }}>
        {ticks.map((t) => <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${Y(t)}%` }}>{format(t)}</span>)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative outline-none" style={{ height }} tabIndex={0} role="img" aria-label={name}
          onPointerMove={pick} onPointerLeave={() => setHover(null)} onFocus={() => setHover(n - 1)} onBlur={() => setHover(null)} onKeyDown={keys}>
          {ticks.map((t) => <span key={t} aria-hidden className="absolute inset-x-0 border-t border-line" style={{ top: `${Y(t)}%` }} />)}
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            {band && <path d={band} fill={ACCENT} fillOpacity={0.12} />}
            <path d={path((p) => p.other)} fill="none" stroke={ACCENT} strokeOpacity={0.7} strokeWidth={2} strokeDasharray="5 5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            <path d={path((p) => p.value)} fill="none" stroke={ACCENT} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          {points.map((p, i) => p.value != null && (showDots || i === n - 1 || i === hover) && (
            <span key={p.key} aria-hidden className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-accent" style={{ left: `${X(i)}%`, top: `${Y(p.value)}%` }} />
          ))}
          {hover != null && points[hover] && (
            <>
              <span aria-hidden className="absolute inset-y-0 border-l border-ink/25" style={{ left: `${X(hover)}%` }} />
              <HoverCard style={{ ...anchor(X(hover) / 100), top: -8 }}>{points[hover].tip}</HoverCard>
            </>
          )}
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted">
          <span>{points[0]?.label}</span>
          {n > 2 && <span>{points[Math.floor((n - 1) / 2)]?.label}</span>}
          <span>{points[n - 1]?.label}</span>
        </div>
      </div>
    </div>
  );
}

/** The legend for BandLine: a solid line, a dashed line and the band (identity never by colour alone). */
export function BandLegend({ solid, dashed }: { solid: string; dashed?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 rounded-full bg-accent" />{solid}</span>
      {dashed && <span className="inline-flex items-center gap-1.5"><span aria-hidden className="w-4 border-t-2 border-dashed border-accent/70" />{dashed}</span>}
      {dashed && <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-4 rounded-xs bg-accent/15" />Likely range</span>}
    </div>
  );
}

// MARK: Small pieces

/** A share split (e.g. annual vs monthly): first part solid, the rest hatched, 2 px gaps between. */
export function SplitBar({ parts, format }: { parts: { label: string; value: number }[]; format: (n: number) => string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return null;
  const styles = [{ background: ACCENT }, hatch(ACCENT, false), hatch(NEUTRAL, false)];
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
        {parts.filter((p) => p.value > 0).map((p, i) => <span key={p.label} title={`${p.label}: ${format(p.value)}`} style={{ width: `${(p.value / total) * 100}%`, ...styles[Math.min(i, 2)] }} />)}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {parts.filter((p) => p.value > 0).map((p, i) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-xs" style={styles[Math.min(i, 2)]} />
            {p.label} <strong className="font-medium text-ink tabular-nums">{format(p.value)}</strong> · {Math.round((p.value / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

/** The table's gauge: a short hatched bar against a tick at the target (here CAC against LTV). */
export function TargetGauge({ value, target, label }: { value: number | null; target: number | null; label: string }) {
  if (value == null || target == null || target <= 0) return <span className="inline-block w-14" aria-hidden />;
  const over = value > target;
  const fill = Math.min(value / target, 1.5) / 1.5;
  return (
    <span className="relative inline-flex h-2.5 w-14 items-center" title={label} aria-label={label}>
      <span className="absolute inset-y-0 left-0 rounded-xs" style={{ width: `${fill * 100}%`, ...hatch(over ? WARN : ACCENT, false) }} />
      <span aria-hidden className="absolute -inset-y-1 border-l-2 border-ink" style={{ left: `${(1 / 1.5) * 100}%` }} />
    </span>
  );
}

/** A progress track toward a target: hatched fill, a tick for the target, labels under it. */
export function TargetTrack({ value, target, max, leftLabel, targetLabel, bad }: { value: number; target: number; max: number; leftLabel: string; targetLabel: string; bad?: boolean }) {
  const pos = (v: number) => `${Math.min(Math.max(v / (max || 1), 0), 1) * 100}%`;
  return (
    <div>
      <div className="relative h-3 rounded-full bg-control">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: pos(value), ...hatch(bad ? WARN : ACCENT, false) }} />
        <span aria-hidden className="absolute -top-1.5 h-6 border-l-2 border-ink" style={{ left: pos(target) }} />
      </div>
      <div className="relative mt-2 h-4 text-xs text-muted">
        <span className="absolute left-0">{leftLabel}</span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pos(target) }}>{targetLabel}</span>
      </div>
    </div>
  );
}
