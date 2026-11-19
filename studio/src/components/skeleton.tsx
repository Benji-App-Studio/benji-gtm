// Loading placeholders shaped like the page that's about to appear. Each shape sits in a box as tall
// as the real thing (a text line's line-height, a button's height, a card's padding), so nothing moves
// when the data arrives. The shimmer is the .skeleton class in app/globals.css (one wave across the
// page, still with reduced motion). Wrap a page's placeholder in <Skeleton>: it marks the region busy
// and gives screen readers a "Loading" label; the shapes themselves are hidden from them.
import type { CSSProperties, ReactNode } from "react";
import { Card, cx } from "./ui";

// MARK: Region

/** The busy region: aria-busy plus a visually hidden label. Every page placeholder goes in one. */
export function Skeleton({ label = "Loading", className, style, children }: { label?: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div aria-busy="true" className={className} style={style}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

// MARK: Primitives

/** One shimmering shape. Size and corners come from className. */
export function Bone({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={cx("skeleton block shrink-0", className)} style={style} />;
}

type TextSize = "xs" | "caption" | "sm" | "lg" | "title";
/** Each text size's line box and the bar drawn in it (roughly the x-height to the cap height). */
const LINE: Record<TextSize, { box: string; bar: string }> = {
  xs: { box: "h-4", bar: "h-2.5" },               // text-xs (12/16), .eyebrow
  caption: { box: "h-[18px]", bar: "h-2.5" },     // text-caption (12/18)
  sm: { box: "h-5", bar: "h-3" },                 // text-sm (13/20), the body size
  lg: { box: "h-6", bar: "h-3.5" },               // text-lg (16/24), a page's title
  title: { box: "h-[22px]", bar: "h-3.5" },       // text-title (15/22), card and group titles
};

/** One line of text: a bar inside a box exactly one line tall. */
export function SkeletonLine({ size = "sm", width = "w-full", className }: { size?: TextSize; width?: string; className?: string }) {
  return <span aria-hidden className={cx("flex items-center", LINE[size].box, className)}><Bone className={cx(LINE[size].bar, width, "max-w-full")} /></span>;
}

/** A paragraph: full lines and a shorter last one. */
export function SkeletonText({ lines = 2, size = "sm", last = "w-2/3", className }: { lines?: number; size?: TextSize; last?: string; className?: string }) {
  return (
    <span className={cx("block", className)}>
      {Array.from({ length: lines }, (_, i) => <SkeletonLine key={i} size={size} width={i === lines - 1 && lines > 1 ? last : "w-full"} />)}
    </span>
  );
}

/** The page title's line box (PageHeader: a 16 px title in a 28 px row), or another passed as `box`. */
export const PAGE_TITLE = "h-7";
export function SkeletonTitle({ box = PAGE_TITLE, width = "w-64", className }: { box?: string; width?: string; className?: string }) {
  return <span aria-hidden className={cx("flex items-center", box, className)}><Bone className={cx("h-4 max-w-full", width)} /></span>;
}

/** A filled rectangle with an inner box's corners: images, charts, fields. */
export function SkeletonBlock({ className, style }: { className?: string; style?: CSSProperties }) {
  return <Bone className={cx("rounded-inner", className)} style={style} />;
}

export function SkeletonCircle({ className = "size-8" }: { className?: string }) {
  return <Bone className={cx("rounded-full", className)} />;
}

/** A button's footprint: md is 32 px, sm 28 px (buttonClass). */
export function SkeletonButton({ size = "md", width = "w-24", className }: { size?: "sm" | "md"; width?: string; className?: string }) {
  return <Bone className={cx(size === "sm" ? "h-7" : "h-8", "rounded-control", width, className)} />;
}

/** A small rounded label (Badge: 20 px). */
export function SkeletonBadge({ width = "w-16", className }: { width?: string; className?: string }) {
  return <Bone className={cx("h-5 rounded-full", width, className)} />;
}

/** A real card (same border, fill and corners) holding placeholders. */
export function SkeletonCard({ className, children }: { className?: string; children?: ReactNode }) {
  return <Card aria-hidden className={className}>{children}</Card>;
}

// MARK: Compositions

/**
 * A page header (PageHeader): the breadcrumbs, the 28 px title row, one muted line under it, and the
 * actions on the right. `eyebrow` is the breadcrumbs' width (false for a page with none). `left` bounds
 * the text column like the real one (its subtitle's max width), so the buttons wrap under it at the same
 * widths.
 */
export function SkeletonPageHeader({
  eyebrow = "w-24", tabs, title = "w-56", titleBox = PAGE_TITLE, titleClass = "", subtitle = 1, subtitleClass = "mt-1", subtitleWidth = "w-full",
  left = "w-full max-w-3xl", actions = [], actionSize = "md", actionsClass = "gap-2", aside, before, className = "mb-5 gap-x-6 gap-y-3",
}: {
  eyebrow?: string | false; before?: ReactNode; tabs?: number[]; title?: string; titleBox?: string; titleClass?: string;
  subtitle?: number; subtitleClass?: string; subtitleWidth?: string; left?: string;
  actions?: string[]; actionSize?: "sm" | "md"; actionsClass?: string; aside?: ReactNode; className?: string;
}) {
  return (
    <div className={cx("flex flex-wrap items-end justify-between", className)}>
      <div className={cx("min-w-0", left)}>
        {before}
        {eyebrow && <SkeletonLine size="xs" width={eyebrow} className="mb-0.5" />}
        {tabs && <SkeletonTabs widths={tabs} className="mt-2" />}
        <SkeletonTitle box={titleBox} width={title} className={titleClass} />
        {subtitle > 0 && <SkeletonText lines={subtitle} last={subtitle > 1 ? "w-1/2" : subtitleWidth} className={subtitleClass} />}
      </div>
      {aside ?? (actions.length > 0 && <div className={cx("flex flex-wrap items-center", actionsClass)}>{actions.map((w, i) => <SkeletonButton key={i} size={actionSize} width={w} />)}</div>)}
    </div>
  );
}

/** A segmented control's grey track with segments of the given widths (px). */
export function SkeletonTabs({ widths, className }: { widths: number[]; className?: string }) {
  return (
    <div aria-hidden className={cx("inline-flex max-w-full items-center gap-0.5 overflow-hidden rounded-control bg-control p-0.5", className)}>
      {widths.map((w, i) => (
        <span key={i} className={cx("grid h-6 shrink-0 place-items-center rounded-sm", i === 0 && "bg-raised shadow-raised")} style={{ width: w }}>
          <Bone className="h-2.5 w-3/5" />
        </span>
      ))}
    </div>
  );
}

/**
 * A strip of figures in one card, split by hairlines (Stat / StatStrip). Pass the grid's columns, and
 * the label size and the figure's line box where a page's figures differ.
 */
export function SkeletonStats({ count = 4, label = "caption", value = "h-[clamp(1.375rem,2.64cqi,1.65rem)]", className = "grid-cols-2 @3xl:grid-cols-4" }: {
  count?: number; label?: TextSize; value?: string; className?: string;
}) {
  return (
    <SkeletonCard className={cx("grid gap-px overflow-hidden bg-line", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-1.5 bg-card px-4 py-3.5">
          <SkeletonLine size={label} width="w-24" />
          <span className={cx("flex items-center", value)}><Bone className="h-[80%] w-14" /></span>
          <SkeletonLine size={label} width="w-28" />
        </div>
      ))}
    </SkeletonCard>
  );
}

/** A filter card: labelled selects, then a row of chips and a note (Research's filter bar). */
export function SkeletonFilterBar({ fields = 7, chips = 8, className }: { fields?: number; chips?: number; className?: string }) {
  return (
    <SkeletonCard className={cx("grid gap-4 p-4", className)}>
      <div className="grid grid-cols-2 gap-3 @2xl:flex @2xl:flex-wrap @2xl:items-end">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="flex min-w-0 flex-col gap-1.5">
            <SkeletonLine size="xs" width="w-14" />
            <Bone className="h-9 w-full rounded-control @2xl:w-32" />
          </div>
        ))}
        <div className="col-span-2 flex flex-wrap gap-x-5 @2xl:ml-auto">
          {[150, 120].map((w) => <span key={w} className="flex h-9 items-center"><Bone className="h-4" style={{ width: w }} /></span>)}
        </div>
      </div>
      <div className="grid gap-2.5 border-t border-line pt-4">
        <div className="flex flex-wrap gap-1.5">{Array.from({ length: chips }, (_, i) => <Bone key={i} className="h-8 rounded-full" style={{ width: 84 + ((i * 37) % 60) }} />)}</div>
        <SkeletonLine size="xs" width="w-3/4" />
      </div>
    </SkeletonCard>
  );
}

/** The ad grid's columns (Research's AdCard grid). */
export const AD_GRID = "grid gap-4 @md:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-4";

/** An ad card: 4:5 media, name, type, run line, two lines of copy, tags, and the action row. */
export function SkeletonAdCard() {
  return (
    <SkeletonCard className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="aspect-[4/5] border-b border-line"><Bone className="size-full rounded-none" /></div>
      <div className="flex flex-1 flex-col px-3 pt-2.5 pb-2.5">
        <SkeletonLine size="sm" width="w-1/2" />
        <span className="flex h-4 items-center"><Bone className="h-2.5 w-24" /></span>
        <span className="mt-2 flex h-4 items-center"><Bone className="h-2.5 w-28" /></span>
        <span className="mt-2 grid h-[2.9em] content-center gap-1.5 text-xs"><Bone className="h-2.5 w-full" /><Bone className="h-2.5 w-3/4" /></span>
        <span className="mt-2 flex h-5 gap-1"><Bone className="h-5 w-14 rounded-full" /><Bone className="h-5 w-20 rounded-full" /></span>
      </div>
      <div className="mt-auto flex items-center gap-1 border-t border-line p-1.5">
        <Bone className="h-8 w-20 rounded-control" />
        <Bone className="ml-auto h-8 w-28 rounded-control" />
      </div>
    </SkeletonCard>
  );
}

export function SkeletonAdGrid({ count = 8, className = AD_GRID }: { count?: number; className?: string }) {
  return <div className={className}>{Array.from({ length: count }, (_, i) => <SkeletonAdCard key={i} />)}</div>;
}

/** Rows of a list card: a tinted icon tile, a title and a subtitle, and something on the right (ListRow). */
export function SkeletonList({ rows = 4, icon = true, trailing = "w-14", className }: { rows?: number; icon?: boolean; trailing?: string | false; className?: string }) {
  return (
    <div aria-hidden className={className}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
          {icon && <Bone className="size-8 rounded-md" />}
          <span className="min-w-0 flex-1">
            <SkeletonLine size="sm" width={i % 2 ? "w-1/2" : "w-2/3"} />
            <SkeletonLine size="caption" width="w-1/3" />
          </span>
          {trailing && <Bone className={cx("h-5 rounded-full", trailing)} />}
        </div>
      ))}
    </div>
  );
}

/** A table: a quiet header row and body rows split by hairlines (Table / Th / Td). */
export function SkeletonTable({ rows = 6, columns = 5, className }: { rows?: number; columns?: number; className?: string }) {
  const widths = ["w-2/3", "w-1/2", "w-3/5", "w-2/5", "w-1/2", "w-1/3"];
  const row = (cells: ReactNode[], key: number, head = false) => (
    <div key={key} className={cx("grid items-center gap-x-6", head ? "pb-2" : "border-b border-line py-2 last:border-transparent")} style={{ gridTemplateColumns: `2fr repeat(${columns - 1}, minmax(0, 1fr))` }}>{cells}</div>
  );
  return (
    <div aria-hidden className={cx("px-4", className)}>
      {row(Array.from({ length: columns }, (_, c) => <SkeletonLine key={c} size="xs" width={c ? "w-12" : "w-20"} />), -1, true)}
      {Array.from({ length: rows }, (_, r) => row(Array.from({ length: columns }, (_, c) => <SkeletonLine key={c} size="sm" width={c ? "w-14" : widths[r % widths.length]} />), r))}
    </div>
  );
}

/** A card of fields (a settings Section): title and blurb, fields in two columns, and the save row. */
export function SkeletonForm({ fields = 3, columns = 2, title = true, save = true, className }: { fields?: number; columns?: 1 | 2; title?: boolean; save?: boolean; className?: string }) {
  return (
    <SkeletonCard className={cx("p-5", className)}>
      {title && <><SkeletonLine size="title" width="w-40" /><SkeletonLine size="sm" width="w-2/3" className="mt-0.5" /></>}
      <div className={cx("grid gap-4", title && "mt-4", columns === 2 && "@2xl:grid-cols-2")}>
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className={cx("flex flex-col gap-1.5", columns === 2 && fields % 2 === 1 && i === fields - 1 && "@2xl:col-span-2")}>
            <SkeletonLine size="xs" width="w-28" />
            <Bone className="h-8 w-full rounded-control" />
          </div>
        ))}
      </div>
      {save && <div className="mt-4 flex justify-end border-t border-line pt-3"><SkeletonButton size="sm" width="w-14" /></div>}
    </SkeletonCard>
  );
}

/** A product card (the product profile): name and badges, link, buttons, description, facts, then its images and AI profile. */
export function SkeletonProductCard() {
  const section = (tiles: boolean) => (
    <div className="border-t border-line">
      <div className="flex items-start gap-3 px-4 py-4">
        <Bone className="size-6 rounded-md" />
        <span className="min-w-0 flex-1">
          <span className="flex h-8 items-center"><Bone className="h-3 w-28" /></span>
          <SkeletonLine size="caption" width="w-2/3" />
        </span>
      </div>
      {tiles && <div className="flex gap-3 overflow-hidden px-4 pb-4">{[0, 1, 2, 3, 4].map((i) => <SkeletonBlock key={i} className="aspect-square w-32" />)}</div>}
    </div>
  );
  return (
    <SkeletonCard className="overflow-hidden p-0">
      <div className="grid gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-[240px]">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <SkeletonLine size="title" width="w-40" />
              <span className="flex gap-1.5"><SkeletonBadge width="w-12" /><SkeletonBadge /><SkeletonBadge width="w-20" /></span>
            </div>
            <SkeletonLine size="sm" width="w-36" className="mt-1" />
          </div>
          <SkeletonButton size="sm" width="w-12" />
        </div>
        <SkeletonText lines={2} />
        <div className="grid gap-x-6 gap-y-3.5 @xl:grid-cols-2 @3xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="min-w-0 border-t border-line pt-2.5">
              <SkeletonLine size="xs" width="w-16" />
              <SkeletonLine size="sm" width={i % 2 ? "w-1/2" : "w-3/4"} className="mt-0.5" />
            </div>
          ))}
        </div>
      </div>
      {section(true)}
      {section(false)}
    </SkeletonCard>
  );
}

/** Project cards in their grid (ProjectCard): name, type and badge, platforms, and the counts row. */
export function SkeletonProjectCards({ count = 3, className = "grid gap-3 @xl:grid-cols-2 @5xl:grid-cols-3" }: { count?: number; className?: string }) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 flex-1">
              <SkeletonLine size="title" width="w-2/3" />
              <SkeletonLine size="caption" width="w-1/2" className="mt-0.5" />
            </span>
            <SkeletonBadge width="w-24" />
          </div>
          <div className="flex gap-3"><SkeletonLine size="xs" width="w-20" /><SkeletonLine size="xs" width="w-16" /></div>
          <div className="mt-auto flex gap-4 border-t border-line pt-3"><SkeletonLine size="sm" width="w-24" /><SkeletonLine size="sm" width="w-14" /><SkeletonLine size="sm" width="w-16" /></div>
        </SkeletonCard>
      ))}
    </div>
  );
}
