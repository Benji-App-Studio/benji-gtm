"use client";
// Measure's own building blocks, in the shared look (components/ui.tsx): cards with a title row, a KPI
// with a delta chip and a "how" toggle, key/value rows, a segmented control whose options can be
// switched off, and the "Needs you" list. They differ from the shared pieces only where Measure needs
// more (the formula under a label, a disabled option with its reason).
import { useState, type ComponentProps, type ReactNode } from "react";
import { cx, segmentClass, segmentTrackClass } from "@/components/ui";

export function Panel({ className, ...props }: ComponentProps<"section">) {
  return <section className={cx("min-w-0 rounded-card border border-line bg-card shadow-card", className)} {...props} />;
}

export function PanelHead({ title, sub, right, className }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <h2 className="text-title font-medium text-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-caption text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** "▲ 6.2%" in a rounded chip. The arrow carries the tone (good / bad), the number stays ink. */
export function DeltaChip({ value, goodWhenUp = true, suffix = "%", className }: { value: number | null; goodWhenUp?: boolean; suffix?: string; className?: string }) {
  if (value == null || !Number.isFinite(value)) return null;
  const up = value > 0;
  const flat = Math.abs(value) < 0.0005;
  const good = flat ? null : up === goodWhenUp;
  const shown = suffix === "%" ? Math.abs(value * 100) : Math.abs(value);
  return (
    <span className={cx("inline-flex h-[22px] items-center gap-1 rounded-full border border-hairline bg-raised px-2 text-xs font-medium whitespace-nowrap text-ink tabular-nums", className)}>
      <span aria-hidden className={cx("text-[9px]", good === null ? "text-muted" : good ? "text-win" : "text-warn")}>{flat ? "■" : up ? "▲" : "▼"}</span>
      <span className="sr-only">{flat ? "No change" : up ? "Up" : "Down"}</span>
      {shown < 10 ? shown.toFixed(1) : Math.round(shown)}{suffix}
    </span>
  );
}

/** A label with a quiet "how" toggle that unfolds the formula underneath (no popover to overflow). */
export function HowLabel({ label, how, className }: { label: ReactNode; how?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={cx("block", className)}>
      <span className="inline-flex items-center gap-1.5">
        {label}
        {how && (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} title="How this is calculated"
            className="inline-grid size-4 place-items-center rounded-full border border-hairline text-[10px] leading-none text-muted transition-colors hover:bg-hover hover:text-ink">
            ?
          </button>
        )}
      </span>
      {how && open && <span className="mt-1.5 block max-w-sm text-caption font-normal tracking-normal text-muted normal-case">{how}</span>}
    </span>
  );
}

/** A KPI inside a strip: label, a big number, and one line under it. */
export function Kpi({ label, value, hint, delta, how, tone }: { label: string; value: ReactNode; hint?: ReactNode; delta?: ReactNode; how?: string; tone?: "warn" | "win" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 bg-card px-4 py-3.5">
      <HowLabel label={<span className="text-caption text-muted">{label}</span>} how={how} />
      <div className="flex flex-wrap items-center gap-2.5">
        <span className={cx("text-figure font-medium tabular-nums", tone === "warn" ? "text-warn" : tone === "win" ? "text-win" : "text-ink")}>{value}</span>
        {delta}
      </div>
      {hint && <span className="text-caption text-label">{hint}</span>}
    </div>
  );
}

/** Label on the left, value (and an optional chip) on the right, with a hairline between rows. */
export function KeyValue({ label, value, chip, how }: { label: string; value: ReactNode; chip?: ReactNode; how?: string }) {
  return (
    <div className="flex min-h-10 items-start justify-between gap-4 border-t border-line py-2.5 first:border-t-0">
      <HowLabel label={<span className="text-sm text-label">{label}</span>} how={how} className="min-w-0" />
      <span className="flex shrink-0 items-center gap-2 text-sm font-medium text-ink tabular-nums">{value}{chip}</span>
    </div>
  );
}

/** The shared segmented control's look, with options that can be switched off (and say why in their title). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; disabled?: boolean; title?: string }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx(segmentTrackClass, "flex-wrap")}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={o.disabled} title={o.title} onClick={() => onChange(o.value)}
          className={cx(segmentClass(value === o.value), "disabled:cursor-not-allowed disabled:opacity-40")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** "● On target" — a dot for the tone and the words, in a rounded chip (as in the jobs table). */
export function StatusChip({ label, tone }: { label: string; tone: "win" | "warn" | "neutral" | "accent" }) {
  return (
    <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-hairline bg-raised px-2 text-xs leading-none font-medium whitespace-nowrap text-ink">
      <span aria-hidden className={cx("size-1.5 rounded-full", tone === "win" ? "bg-win" : tone === "warn" ? "bg-warn" : tone === "accent" ? "bg-accent" : "bg-faint")} />
      {label}
    </span>
  );
}

export interface NeedsYouItem { id: string; tone: "warn" | "win" | "accent"; title: string; detail: string; onClick?: () => void }

const ICON: Record<NeedsYouItem["tone"], ReactNode> = {
  warn: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  win: <path d="M7 17 17 7M9 7h8v8" />,
  accent: <><circle cx="12" cy="12" r="9" /><path d="M12 8v4l2.5 2.5" /></>,
};

/** The "Needs you" list: what to look at first, each with a way into the table. */
export function NeedsYou({ items, empty }: { items: NeedsYouItem[]; empty: ReactNode }) {
  if (!items.length) return <p className="mt-4 text-sm text-muted">{empty}</p>;
  return (
    <ul className="mt-2 divide-y divide-line">
      {items.map((item) => {
        const body = (
          <>
            <span className={cx("grid size-8 shrink-0 place-items-center rounded-md", item.tone === "warn" ? "bg-warn-soft text-warn" : item.tone === "win" ? "bg-win-soft text-win" : "bg-accent-soft text-accent")}>
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{ICON[item.tone]}</svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">{item.title}</span>
              <span className="block text-caption text-muted">{item.detail}</span>
            </span>
            {item.onClick && <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden><path d="M6 3.5 10.5 8 6 12.5" /></svg>}
          </>
        );
        return (
          <li key={item.id}>
            {item.onClick
              ? <button type="button" onClick={item.onClick} className="flex w-full items-center gap-3 py-2.5 text-left transition-opacity hover:opacity-80">{body}</button>
              : <div className="flex items-center gap-3 py-2.5">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** A small round icon for a source's state, with its name. */
export function SourceDot({ name, state, title }: { name: string; state: "ok" | "error" | "off" | "unsynced"; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span aria-hidden className={cx("size-2 rounded-full", state === "ok" ? "bg-win" : state === "error" ? "bg-warn" : state === "unsynced" ? "border border-accent bg-accent-soft" : "border border-faint")} />
      {name}
      <span className="sr-only">{state === "ok" ? "synced" : state === "error" ? "sync failed" : state === "unsynced" ? "connected, not synced yet" : "not connected"}</span>
    </span>
  );
}
