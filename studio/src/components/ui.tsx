// The shared pieces. Every page builds from these so the whole app reads as one system; the look
// itself lives in the tokens in app/globals.css (see DESIGN.md for the spec and how to re-skin).
// This file has no "use client": server pages call buttonClass() and friends. Pieces that keep state
// live in their own client files and are re-exported here (Menu).
import Link from "next/link";
import type { ComponentProps, CSSProperties, KeyboardEvent, ReactNode } from "react";
import { m } from "@/lib/i18n/translate";
import { showOriginal, thumbUrl } from "@/lib/thumb";
import { PLATFORM_BETA, PLATFORM_LABEL, type Platform } from "@/lib/types";
import { PageStep, Said, SaidNav, WithSaid } from "./said";
import { IconCalendar, IconChevronDown, IconChevronRight, IconLock, IconMore, IconPlug, IconSearch, IconSparkles } from "./icons";

export { Menu, MenuItem, MenuLabel, MenuSeparator, MenuSub, type MenuTriggerProps } from "./menu";
export { Term } from "./term";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export const fmt = (n: number | null | undefined) => {
  if (n == null || Number.isNaN(n)) return "–";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return `${Math.round(n)}`;
};

/** Staggers a .rise element: style={stagger(i)}. */
export const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

// MARK: Page structure

/** The width and padding every page shares inside the page panel. The page's header bar sits at the very top. */
export const pageClass = "mx-auto w-full max-w-[1360px] px-4 pb-12 sm:px-6";

/** The narrow column for detail and form pages (~700 px of content), centred in the panel: `<Page className={columnClass}>`. */
export const columnClass = "max-w-[748px]";

export function Page({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx(pageClass, className)} {...props} />;
}

export type Crumb = { label: string; href?: string };

/** The bar at the top of the panel: 44 px, full panel width, the breadcrumb or title at left (13 px medium), small actions at right. */
export const headerBarClass = "relative z-20 mb-5 ml-[calc(50%-50cqi)] flex h-11 w-[100cqi] items-center justify-between gap-3 border-b border-header-line bg-canvas px-4 sm:px-6 lg:sticky lg:top-0";

/**
 * The page's header bar: breadcrumbs ending in the current page (or the title alone) and a badge at left,
 * actions at right (pills, 28 px). Under the bar, an optional intro: the title at 24 px when it says more
 * than the last crumb (a detail or form page), and the subtitle as one muted line.
 */
export function PageHeader({ title, badge, subtitle, crumbs, actions, className }: {
  title: ReactNode; badge?: ReactNode; subtitle?: ReactNode; crumbs?: Crumb[]; actions?: ReactNode; className?: string;
}) {
  const trail = crumbs ?? [];
  const last = trail[trail.length - 1];
  // The bar ends in the current page: the last crumb when it has no link, else the title.
  const current = last && !last.href ? last.label : null;
  const items = current ? trail.slice(0, -1) : trail;
  const titleIsCurrent = !current || (typeof title === "string" && title === current);
  const intro = !titleIsCurrent;
  return (
    <>
      <header className={cx(headerBarClass, !intro && !subtitle && className)}>
        <SaidNav label={m("Breadcrumb")} className="flex min-w-0 shrink items-center gap-1 text-sm font-medium">
          {items.map((crumb, i) => (
            <span key={i} className="flex min-w-0 shrink items-center gap-1">
              {crumb.href ? <Link href={crumb.href} className="truncate rounded-xs text-muted transition-colors hover:text-ink">{crumb.label}</Link> : <span className="truncate text-muted">{crumb.label}</span>}
              <IconChevronRight className="size-3 shrink-0 text-faint" />
            </span>
          ))}
          {titleIsCurrent
            ? <h1 className="flex min-w-0 items-center gap-2 truncate text-ink"><span className="truncate">{title}</span>{badge}</h1>
            : <span aria-current="page" className="truncate text-ink">{current}</span>}
        </SaidNav>
        {actions && <div className="no-scrollbar -my-1 flex max-w-[70%] min-w-0 items-center gap-1.5 overflow-x-auto py-1 sm:max-w-none [&>*]:shrink-0 [&_a]:rounded-full [&_button]:rounded-full">{actions}</div>}
      </header>
      {(intro || subtitle) && (
        <div className={cx("mb-6", className)}>
          {intro && <h1 className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-display font-semibold [overflow-wrap:anywhere]">{title}{badge}</h1>}
          {subtitle && <p className={cx("max-w-2xl text-sm text-muted", intro && "mt-1")}>{subtitle}</p>}
        </div>
      )}
    </>
  );
}

/** A heading for a group of cards inside a page. */
export function SectionHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("mb-2 flex min-h-7 flex-wrap items-center justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// MARK: Buttons

type Variant = "primary" | "secondary" | "ghost" | "danger" | "white" | "outline" | "light";
type Size = "sm" | "md";
type ButtonProps = ComponentProps<"button"> & { variant?: Variant; size?: Size };

/**
 * Accent fill (primary: one per view), bordered (secondary and outline: everything else), text only (ghost),
 * red text (danger), and two for coloured backgrounds (white: on callouts; light: kept for older code, now bordered).
 * Every size is 28 px tall; header actions turn into pills (PageHeader does that).
 */
export const buttonClass = (variant: Variant = "primary", size: Size = "md") => cx(
  // Compact: 28 px tall, 14 px icons, an 8 px radius, no shadow.
  "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-control font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5",
  size === "sm" ? "px-2.5 text-xs" : "px-3 text-sm",
  variant === "primary" && "bg-accent-fill text-on-accent hover:bg-accent-fill/90",
  variant === "secondary" && "border border-hairline bg-raised text-ink hover:bg-hover",
  variant === "ghost" && "text-label hover:bg-hover hover:text-ink",
  variant === "danger" && "border border-warn/35 bg-raised text-warn hover:bg-warn-soft",
  variant === "white" && "bg-raised text-ink shadow-raised hover:bg-raised/90",
  variant === "outline" && "border border-hairline bg-raised text-ink hover:bg-hover",
  variant === "light" && "border border-hairline bg-raised text-ink hover:bg-hover",
);

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return <button className={cx(buttonClass(variant, size), className)} {...props} />;
}

export function ButtonLink({ variant, size, className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={cx(buttonClass(variant, size), className)} {...props} />;
}

/** A small square button holding one icon ("…" on cards, the sidebar's search). Pass the icon as children. */
export function IconButton({ size = "md", className, children, label, ...props }: ComponentProps<"button"> & { size?: "sm" | "md"; label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cx(
      "grid shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-hover hover:text-ink [&_svg]:size-3.5",
      size === "sm" ? "size-6" : "size-7", className)} {...props}>{children ?? <IconMore />}</button>
  );
}

// MARK: Cards

/** The card: one step lighter than the panel, 10 px corners, a hairline border, no shadow. Padding is the caller's (p-3 or p-4). */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-card border border-line bg-card", className)} {...props} />;
}

/** A card's title row: 13 px medium title, 12 px grey subtitle, and a menu or link on the right. */
export function CardHeader({ title, subtitle, action, menu, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; menu?: () => void; className?: string }) {
  return (
    <div className={cx("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-medium">{title}</h3>
        {subtitle && <p className="mt-0.5 text-caption text-muted">{subtitle}</p>}
      </div>
      {action}
      {menu && <WithSaid text={m("More")}>{(label) => <IconButton size="sm" label={label} onClick={menu} />}</WithSaid>}
    </div>
  );
}

/** A text link with a chevron ("Leakage ›", "Review discount rules ›"). */
export function ChevronLink({ className, children, ...props }: ComponentProps<typeof Link>) {
  return <Link className={cx("inline-flex items-center gap-0.5 rounded-xs text-sm font-medium text-ink transition-opacity hover:opacity-70", className)} {...props}>{children}<IconChevronRight className="size-3.5" /></Link>;
}

// MARK: Labels

type Tone = "neutral" | "accent" | "win" | "warn" | "highlight" | "caution";

/** A small tinted label (kind, stage, counts). */
export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cx(
      "inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs leading-none font-medium tracking-normal whitespace-nowrap",
      tone === "neutral" && "bg-control text-label",
      tone === "accent" && "bg-accent-soft text-accent",
      tone === "win" && "bg-win-soft text-win",
      tone === "warn" && "bg-warn-soft text-warn",
      (tone === "highlight" || tone === "caution") && "bg-caution-soft text-caution-ink",
      className,
    )}>{children}</span>
  );
}

const DOT: Record<Tone, string> = { neutral: "bg-faint", accent: "bg-accent", win: "bg-win", warn: "bg-warn", highlight: "bg-caution", caution: "bg-caution" };

/** The white status pill with a coloured dot ("● At risk", "● Critical"). */
export function StatusPill({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cx("inline-flex h-[22px] items-center gap-1.5 rounded-full border border-hairline bg-raised px-2 text-xs leading-none font-medium tracking-normal whitespace-nowrap text-ink", className)}>
      <span className={cx("size-1.5 rounded-full", DOT[tone])} />{children}
    </span>
  );
}

/** "▲ 6.2%" in a small chip. Up is green and down is red unless `good` says otherwise (a cost going down is good). */
export function DeltaChip({ value, direction, good, className }: { value: ReactNode; direction: "up" | "down"; good?: boolean; className?: string }) {
  const positive = good ?? direction === "up";
  return (
    <span className={cx("inline-flex h-[22px] items-center gap-1 rounded-full border border-hairline bg-raised px-2 text-xs font-medium whitespace-nowrap text-ink tabular-nums", className)}>
      <svg viewBox="0 0 10 10" aria-hidden="true" className={cx("size-2", positive ? "text-win" : "text-warn", direction === "down" && "rotate-180")}><path d="M5 1.5 9 8.5H1z" fill="currentColor" /></svg>
      {value}
    </span>
  );
}

const PLATFORM_DOT: Record<Platform, string> = {
  instagram: "bg-gradient-to-br from-amber-400 via-pink-500 to-purple-600",
  // TikTok and X are black marks; ink keeps them visible on the dark theme (they turn near-white).
  tiktok: "bg-ink",
  youtube: "bg-red-600",
  x: "bg-ink",
  linkedin: "bg-sky-700",
};

export function PlatformBadge({ platform, showBeta = false }: { platform: Platform; showBeta?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
      <span className={cx("size-2.5 rounded-full", PLATFORM_DOT[platform])} />
      {PLATFORM_LABEL[platform]}
      {showBeta && PLATFORM_BETA[platform] && <span className="rounded-full bg-control px-1.5 text-[10px] text-muted"><Said text={m("beta")} /></span>}
    </span>
  );
}

// MARK: Numbers

/** One figure in a KPI row: 12 px label, an 18 px figure, grey hint. Strips put these side by side with dividers. */
export function Stat({ label, value, hint, tone, delta }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "dark" | "highlight" | "win" | "warn"; delta?: ReactNode }) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-1 px-4 py-3", tone === "dark" ? "bg-primary text-on-ink" : tone === "highlight" ? "bg-caution-soft" : "bg-card")}>
      <span className={cx("text-caption", tone === "dark" ? "text-on-ink/60" : "text-muted")}>{label}</span>
      <span className="flex flex-wrap items-center gap-2.5">
        <span className={cx("text-figure font-medium tabular-nums", tone === "win" && "text-win", tone === "warn" && "text-warn")}>{value}</span>
        {delta}
      </span>
      {hint && <span className={cx("truncate text-caption", tone === "dark" ? "text-on-ink/60" : "text-label")}>{hint}</span>}
    </div>
  );
}

/** A row of Stats in one card, split by hairlines (Forecast's top strip). */
export function StatStrip({ className, children }: { className?: string; children: ReactNode }) {
  return <Card className={cx("flex flex-wrap gap-px overflow-hidden bg-line [&>*]:flex-[1_1_200px]", className)}>{children}</Card>;
}

/** The one larger number on a page: 24 px, with an optional delta chip and comparison underneath. */
export function Kpi({ value, delta, compare, className }: { value: ReactNode; delta?: ReactNode; compare?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="text-kpi font-medium tabular-nums">{value}</p>
      {(delta || compare) && <div className="mt-2 flex flex-wrap items-center gap-2">{delta}{compare && <span className="text-caption text-muted">{compare}</span>}</div>}
    </div>
  );
}

/** Label on the left, value (and delta) on the right, with a hairline above: "Revenue  $482K  ▲ 6.2%". */
export function StatRow({ label, value, delta, note, className }: { label: ReactNode; value: ReactNode; delta?: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex min-h-9 items-center justify-between gap-3 border-t border-line py-1.5", className)}>
      <span className="min-w-0 truncate text-sm text-label">{label}</span>
      <span className="flex shrink-0 items-center gap-2.5">
        <span className="text-sm font-medium tabular-nums">{value}</span>
        {delta}
        {note && <span className="text-caption text-muted">{note}</span>}
      </span>
    </div>
  );
}

/** A thin hatched bar against a target marker ("20% … Target 38%"). value and target are 0–1. */
export function TargetBar({ value, target, startLabel, targetLabel, className }: { value: number; target?: number; startLabel?: ReactNode; targetLabel?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="relative h-1.5 rounded-full bg-control">
        <div className="grow-x hatch absolute inset-y-0 left-0 rounded-full text-accent" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
        {target != null && <span className="absolute -top-1.5 h-[18px] w-0.5 rounded-full bg-ink" style={{ left: `calc(${target * 100}% - 1px)` }} />}
      </div>
      {(startLabel || targetLabel) && (
        <div className="relative mt-2 h-4 text-xs text-muted">
          {startLabel && <span className="absolute left-0">{startLabel}</span>}
          {targetLabel && target != null && <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${target * 100}%` }}>{targetLabel}</span>}
        </div>
      )}
    </div>
  );
}

// MARK: Controls

/**
 * A choice of a few options, drawn as Linear's tab pills: 28 px pills, the chosen one filled with a hairline,
 * the others plain muted text. One tab stop; the arrow keys move the choice.
 */
export function Segmented<T extends string>({ options, value, onChange, label, className }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (value: T) => void; label?: string; className?: string }) {
  const current = options.some((o) => o.value === value) ? value : options[0]?.value;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step || !options.length) return;
    event.preventDefault();
    const next = options[(options.findIndex((o) => o.value === current) + step + options.length) % options.length];
    onChange(next.value);
    event.currentTarget.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cx("no-scrollbar overflow-x-auto", segmentTrackClass, className)}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" data-value={o.value} aria-checked={value === o.value} tabIndex={o.value === current ? 0 : -1} onClick={() => onChange(o.value)} className={segmentClass(value === o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** The class for one segment, for controls that render their own buttons. */
export const segmentClass = (active: boolean) => cx(
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors [&_svg]:size-3.5",
  active ? "border-hairline bg-control text-ink" : "border-transparent text-muted hover:bg-hover hover:text-ink",
);

/** The row a set of tab pills sits in (for controls that render their own buttons). */
export const segmentTrackClass = "inline-flex max-w-full items-center gap-1";

/** Section tabs: the same pills. */
export const tabClass = segmentClass;

/** The header's date range: a white segment with the range, then the comparison in grey. */
export function DateRangePill({ label, compare, onClick, className }: { label: ReactNode; compare?: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <div className={cx("inline-flex h-7 items-center", className)}>
      <button type="button" onClick={onClick} className="flex h-7 items-center gap-1.5 rounded-full border border-hairline bg-raised px-2.5 text-xs font-medium whitespace-nowrap hover:bg-hover">
        <IconCalendar className="size-3.5 text-muted" />{label}<IconChevronDown className="size-3.5 text-muted" />
      </button>
      {compare && <span className="hidden px-2.5 text-xs whitespace-nowrap text-faint sm:inline">{compare}</span>}
    </div>
  );
}

/** A bordered picker with a leading icon and a chevron ("◎ All branches ⌄"). Wraps a native select, so the keyboard works as usual. */
export function SelectPill({ icon, value, onChange, options, label, className }: { icon?: ReactNode; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; label: string; className?: string }) {
  return (
    <label className={cx("relative inline-flex h-7 items-center gap-1.5 rounded-control border border-hairline bg-raised pr-7 pl-2.5 text-sm font-medium transition-colors hover:bg-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus/70 [&_svg]:size-3.5", className)}>
      {icon}
      <span className="whitespace-nowrap">{options.find((o) => o.value === value)?.label}</span>
      <IconChevronDown className="pointer-events-none absolute right-2 text-muted" />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0 outline-none">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** A search field with a magnifier and an optional key hint. */
export function SearchField({ hint, className, ...props }: ComponentProps<"input"> & { hint?: string }) {
  return (
    <label className={cx("flex h-7 items-center gap-2 rounded-control border border-hairline bg-raised px-2.5 text-sm transition-colors focus-within:border-focus/70 focus-within:ring-2 focus-within:ring-focus/20", className)}>
      <IconSearch className="size-3.5 shrink-0 text-muted" />
      <input type="search" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden" {...props} />
      {hint && <Kbd>{hint}</Kbd>}
    </label>
  );
}

/** A small on/off switch (accent when on). */
export function Toggle({ checked, onChange, label, className }: { checked: boolean; onChange: (checked: boolean) => void; label: string; className?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx("relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-ink/20", className)}>
      <span className={cx("absolute top-[2px] size-3.5 rounded-full bg-white shadow-raised transition-[left] motion-reduce:transition-none", checked ? "left-[14px]" : "left-[2px]")} />
    </button>
  );
}

/** Small square page buttons, the current page filled ("‹ 1 2 3 … 23 ›"). */
export function Pagination({ page, pages, onPage, className }: { page: number; pages: number; onPage: (page: number) => void; className?: string }) {
  const shown = [...new Set([1, 2, 3, page - 1, page, page + 1, pages].filter((p) => p >= 1 && p <= pages))].sort((a, b) => a - b);
  const round = "grid size-7 place-items-center rounded-control text-xs tabular-nums transition-colors";
  return (
    <SaidNav label={m("Pagination")} className={cx("flex items-center gap-1", className)}>
      <PageStep dir="previous" disabled={page <= 1} onClick={() => onPage(page - 1)} className={cx(round, "border border-hairline bg-raised hover:bg-hover disabled:pointer-events-none disabled:opacity-40")} />
      {shown.map((p, i) => (
        <span key={p} className="flex items-center gap-1">
          {i > 0 && p - shown[i - 1] > 1 && <span className="px-1 text-faint">…</span>}
          <button type="button" aria-current={p === page ? "page" : undefined} onClick={() => onPage(p)} className={cx(round, p === page ? "border border-hairline bg-control font-medium text-ink" : "text-label hover:bg-hover")}>{p}</button>
        </span>
      ))}
      <PageStep dir="next" disabled={page >= pages} onClick={() => onPage(page + 1)} className={cx(round, "border border-hairline bg-raised hover:bg-hover disabled:pointer-events-none disabled:opacity-40")} />
    </SaidNav>
  );
}

// MARK: Lists, tables, callouts

const TINT: Record<Tone, string> = {
  neutral: "bg-control text-ink", accent: "bg-accent-soft text-accent", win: "bg-win-soft text-win",
  warn: "bg-warn-soft text-warn", highlight: "bg-caution-soft text-caution", caution: "bg-caution-soft text-caution",
};

/** A small rounded square tinted to its meaning, holding an icon ("Needs you" rows, action cards). */
export function TintIcon({ tone = "neutral", size = "md", className, children }: { tone?: Tone; size?: "sm" | "md"; className?: string; children: ReactNode }) {
  return <span className={cx("grid shrink-0 place-items-center rounded-md [&_svg]:size-3.5", size === "sm" ? "size-5" : "size-6", TINT[tone], className)}>{children}</span>;
}

/** A list row (40-48 px, no dividers): tinted icon, 13 px title, 12 px grey subtitle, chevron. Renders a link when given href. */
export function ListRow({ icon, tone, title, subtitle, href, onClick, trailing, className }: {
  icon?: ReactNode; tone?: Tone; title: ReactNode; subtitle?: ReactNode; href?: string; onClick?: () => void; trailing?: ReactNode; className?: string;
}) {
  const body = (
    <>
      {icon && <TintIcon tone={tone}>{icon}</TintIcon>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {subtitle && <span className="block truncate text-caption text-muted">{subtitle}</span>}
      </span>
      {trailing ?? ((href || onClick) && <IconChevronRight className="size-3.5 shrink-0 text-faint transition-colors group-hover:text-ink" />)}
    </>
  );
  const rowClass = cx("group -mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-3 rounded-control px-2 py-1.5 text-left", (href || onClick) && "transition-colors hover:bg-hover", className);
  if (href) return <Link href={href} className={rowClass}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={rowClass}>{body}</button>;
  return <div className={rowClass}>{body}</div>;
}

/** Table pieces: a horizontally scrolling wrapper, a quiet 12 px header and 40 px rows with no dividers that tint on hover. */
export function Table({ className, minWidth, children }: { className?: string; minWidth?: number; children: ReactNode }) {
  return (
    <div className={cx("-mx-2 overflow-x-auto px-2", className)}>
      <table className="w-full border-separate border-spacing-0 text-sm" style={minWidth ? { minWidth } : undefined}>{children}</table>
    </div>
  );
}
export const thClass = "h-8 border-b border-line px-3 text-left text-xs font-book whitespace-nowrap text-muted first:pl-4 last:pr-4";
export const trClass = "group/row";
export const tdClass = "h-10 px-3 py-1.5 align-middle first:pl-4 last:pr-4 group-hover/row:bg-hover";
export function Th({ className, ...props }: ComponentProps<"th">) { return <th className={cx(thClass, className)} {...props} />; }
export function Td({ className, ...props }: ComponentProps<"td">) { return <td className={cx(tdClass, className)} {...props} />; }
export function Tr({ className, ...props }: ComponentProps<"tr">) { return <tr className={cx(trClass, className)} {...props} />; }

/** An insight inside a card: a bordered box (default), or a tinted callout with a sparkle label. */
export function Callout({ tone = "raised", label, title, children, action, className }: { tone?: "raised" | "caution" | "win"; label?: ReactNode; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-inner p-3", tone === "raised" && "border border-line bg-raised", tone === "caution" && "bg-caution-soft", tone === "win" && "bg-win-soft", className)}>
      {label && <p className={cx("mb-1.5 flex items-center gap-1.5 text-caption font-medium", tone === "caution" ? "text-caution-ink" : tone === "win" ? "text-win" : "text-muted")}><IconSparkles className="size-3.5" />{label}</p>}
      {title && <p className="text-sm font-medium">{title}</p>}
      {children && <div className={cx("text-caption", title ? "mt-1 text-muted" : "text-ink")}>{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** The one emphasised card on a page ("Pattern found", a figure, a headline, a button): a plain card like any other, no gradient. */
export function HeroCard({ label = <Said text={m("Pattern found")} />, pager, value, unit, headline, body, action, className }: {
  label?: ReactNode; pager?: ReactNode; value?: ReactNode; unit?: ReactNode; headline: ReactNode; body?: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <section className={cx("flex flex-col overflow-hidden rounded-card border border-line bg-card p-4", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted"><IconSparkles className="size-3.5 text-accent" />{label}</span>
        {pager && <span className="text-xs text-muted">{pager}</span>}
      </div>
      {value != null && (
        <p className="mt-3 flex flex-wrap items-end gap-x-2 gap-y-1">
          <span className="text-kpi font-medium tabular-nums">{value}</span>
          {unit && <span className="mb-0.5 max-w-[150px] text-xs leading-tight text-muted">{unit}</span>}
        </p>
      )}
      <h3 className="mt-3 text-sm font-medium">{headline}</h3>
      {body && <p className="mt-1 text-sm text-muted">{body}</p>}
      {action && <div className="relative mt-auto pt-4">{action}</div>}
    </section>
  );
}

/** Linear's empty state: a quiet icon, one short line (and a muted sentence), one small button. No card around it. */
export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center px-6 py-12 text-center", className)}>
      {icon && <span className="mb-3 text-faint [&_svg]:size-6">{icon}</span>}
      <p className="text-sm font-medium text-ink">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-4 [&_a]:rounded-full [&_button]:rounded-full">{action}</div>}
    </div>
  );
}

/** Something that failed or blocks the page, in the one error style every page uses (with an optional heading). */
export function ErrorNote({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card role="alert" className={cx("mb-4 rounded-small border-warn/35 px-3 py-2.5 text-sm", className)}>
      {title && <p className="font-medium text-warn">{title}</p>}
      <div className={title ? "mt-1 text-ink" : "text-warn"}>{children}</div>
    </Card>
  );
}

/** A legend entry: a swatch (solid, hatched, a line, a dash or a dot) and its label. Colour it with a text-* class. */
export function LegendItem({ swatch = "solid", color, children }: { swatch?: "solid" | "hatch" | "line" | "dash" | "dot"; color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-label">
      <span className={cx(color,
        swatch === "solid" && "h-2 w-4 rounded-full bg-current",
        swatch === "hatch" && "hatch h-2 w-4 rounded-full",
        swatch === "line" && "h-[3px] w-5 rounded-full bg-current",
        swatch === "dash" && "h-0 w-5 border-t-2 border-dashed border-current",
        swatch === "dot" && "size-2 rounded-full bg-current")} />
      {children}
    </span>
  );
}

// MARK: Forms

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)} aria-hidden />;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** Text fields, selects and textareas: 30 px tall, a hairline border, and the focus colour on the border when in use. */
export const inputClass = "w-full rounded-control border border-hairline bg-raised px-2.5 py-1 text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-focus/70 focus:ring-2 focus:ring-focus/20 disabled:opacity-60";

// MARK: Keys, settings rows and locked states

/** A key hint: <Kbd>⌘K</Kbd>. For a sequence, put a word between two of them: <Kbd>G</Kbd> then <Kbd>S</Kbd>. */
export function Kbd({ className, children }: { className?: string; children: ReactNode }) {
  return <kbd className={cx("inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-hairline bg-control px-1 font-sans text-[11px] leading-none font-medium text-muted", className)}>{children}</kbd>;
}

/** A titled group of settings (Linear's): a 15 px title 16 px above its box, then a box whose 66 px rows are split by hairlines. */
export function SettingsGroup({ title, description, action, children, className }: { title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-group font-medium">{title}</h2>}
            {description && <p className="mt-0.5 max-w-xl text-xs text-muted">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <Card className="divide-y divide-line">{children}</Card>
    </section>
  );
}

/**
 * One setting: its name and one line about it on the left, the control on the right (under the text on a
 * narrow screen). Children passed as `below` sit under the row, full width (a form that opens in place).
 */
export function SettingsRow({ label, description, children, below, className }: { label: ReactNode; description?: ReactNode; children?: ReactNode; below?: ReactNode; className?: string }) {
  return (
    <div className={cx("px-4 py-3.5", className)}>
      <div className="flex min-h-[38px] flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-[1_1_220px]">
          <p className="text-sm font-medium text-ink">{label}</p>
          {description && <p className="mt-0.5 text-caption text-muted">{description}</p>}
        </div>
        {children && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{children}</div>}
      </div>
      {below}
    </div>
  );
}

/** A small inline "needs X" state, with a link to where X is set: <Locked href="/app/settings/keys">Needs an OpenAI key</Locked>. */
export function Locked({ children, href = "/app/settings/keys", action = <Said text={m("Add it")} />, className }: { children: ReactNode; href?: string; action?: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex min-h-7 max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-control border border-hairline px-2 py-1 text-xs text-muted", className)}>
      <span className="inline-flex items-center gap-1.5"><IconLock className="size-3.5 shrink-0" />{children}</span>
      <Link href={href} className="rounded-xs font-medium text-accent hover:underline">{action}</Link>
    </span>
  );
}

/** A page-level "connect X to use this" panel: a title, one line, and a button that goes to Settings. */
export function ConnectState({ title, body, href = "/app/settings/keys", action = <Said text={m("Open settings")} />, icon, className }: {
  title: ReactNode; body?: ReactNode; href?: string; action?: ReactNode; icon?: ReactNode; className?: string;
}) {
  return (
    <div className={cx("mx-auto flex w-full max-w-md flex-col items-center px-6 py-16 text-center", className)}>
      <span className="mb-3 text-faint [&_svg]:size-6">{icon ?? <IconPlug />}</span>
      <h2 className="text-sm font-medium">{title}</h2>
      {body && <p className="mt-1 text-sm text-muted">{body}</p>}
      {/* data-guide: the getting-started guide points here when a step's page needs a key first. */}
      <ButtonLink href={href} className="mt-4 rounded-full" data-guide="connect">{action}</ButtonLink>
    </div>
  );
}

/**
 * A cover-cropped image. With `size` (about 2× the tile, in px), one of our stored images is shown as a
 * resized copy of that square (lib/thumb.ts) instead of the original.
 */
export function Thumb({ src, alt, className, size }: { src: string | null; alt: string; className?: string; size?: number }) {
  return src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={size ? thumbUrl(src, size, size) : src} alt={alt} loading="lazy" decoding="async" onError={size ? (e) => showOriginal(e.currentTarget) : undefined} className={cx("object-cover", className)} />
    : <div className={cx("bg-gradient-to-br from-line to-canvas", className)} aria-label={alt} />;
}

/** A small gear that turns while work is running (stays still with reduced motion). */
export function Gear({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cx("gear-spin size-4 shrink-0", className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
