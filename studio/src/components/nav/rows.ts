// The look of a sidebar row and of a section label, shared by the app's sidebar and the settings one.
import { cx } from "../ui";

/** The classes of one sidebar row (a link or a button). Taller in the drawer, where it is tapped. */
/** Linear's row: 28 px, 8 px corners, 13 px medium text and a 14 px icon, muted until it is the current page (a subtle grey pill).
 * 1 px above and below, so two highlighted rows (a hovered app and its current page) never touch. */
export const navRowClass = (active = false) => cx(
  "my-px flex h-7 w-full min-w-0 items-center gap-2 rounded-control pr-[9px] pl-2 text-left text-sm font-medium whitespace-nowrap transition-colors max-lg:h-9 [&>svg]:size-3.5 [&>svg]:shrink-0",
  active ? "bg-active text-ink [&>svg]:text-ink" : "text-nav hover:bg-hover hover:text-ink [&>svg]:text-nav",
);

/** A section header ("Your apps ▾"): 12 px medium muted, a 28 px row, a small caret after it. */
export const navSectionClass = "flex h-7 items-center gap-1 rounded-control px-[5px] text-xs font-medium text-muted";
