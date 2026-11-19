// The look of a sidebar row and of a section label, shared by the app's sidebar and the settings one.
import { cx } from "../ui";

/** The classes of one sidebar row (a link or a button). Taller in the drawer, where it is tapped. */
export const navRowClass = (active = false) => cx(
  "flex h-7 w-full min-w-0 items-center gap-2 rounded-control px-2 text-left text-sm whitespace-nowrap transition-colors max-lg:h-9 [&>svg]:size-4 [&>svg]:shrink-0",
  active ? "bg-active font-medium text-ink [&>svg]:text-ink" : "text-label hover:bg-hover [&>svg]:text-muted",
);

export const navSectionClass = "flex h-6 items-center gap-1 rounded-control px-2 text-xs font-medium text-faint";
