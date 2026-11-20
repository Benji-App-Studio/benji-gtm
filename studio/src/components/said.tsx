"use client";
// Words for the shared pieces in ui.tsx, which server pages render too and so can't call useT() there.
// Mark the sentence with m() where it is written; these say it in the viewer's language.
import type { ComponentProps, ReactNode } from "react";
import { useT } from "../lib/i18n/client";
import { IconChevronLeft, IconChevronRight } from "./icons";

/** A marked sentence, said in the viewer's language. */
export function Said({ text, vars }: { text: string; vars?: Record<string, string | number> }) {
  return <>{useT().t(text, vars)}</>;
}

/** A <nav> whose accessible name is said in the viewer's language. */
export function SaidNav({ label, children, ...props }: Omit<ComponentProps<"nav">, "aria-label"> & { label: string; children: ReactNode }) {
  const { t } = useT();
  return <nav aria-label={t(label)} {...props}>{children}</nav>;
}

/** Hands a marked sentence, said in the viewer's language, to a piece that needs it as a string (a label). */
export function WithSaid({ text, children }: { text: string; children: (said: string) => ReactNode }) {
  return <>{children(useT().t(text))}</>;
}

/** The previous and next page buttons of Pagination, with their names said in the viewer's language. */
export function PageStep({ dir, ...props }: Omit<ComponentProps<"button">, "aria-label" | "children"> & { dir: "previous" | "next" }) {
  const { t } = useT();
  return (
    <button type="button" aria-label={dir === "previous" ? t("Previous page") : t("Next page")} {...props}>
      {dir === "previous" ? <IconChevronLeft className="size-3.5" /> : <IconChevronRight className="size-3.5" />}
    </button>
  );
}
