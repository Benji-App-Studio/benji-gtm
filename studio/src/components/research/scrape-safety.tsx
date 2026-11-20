"use client";
// The Ad Library extension's safety warnings, repeated here: in the import dialog (what the file says
// about its own run) and as a dismissible card on the Research page (the last day's runs).
// Warnings only: nothing here blocks an import.
import { useEffect, useState } from "react";
import { runSafetySummary, scrapeWarnings, type LocalRunRow, type LocalScrape } from "@/lib/research";
import { IconAlert, IconX } from "../icons";
import { cx } from "../ui";
import { readStored, storageKey } from "@/lib/storage-keys";
import { useT } from "@/lib/i18n/client";

const timeIn = (intl: string) => (d: Date) => d.toLocaleString(intl, { weekday: "short", hour: "numeric", minute: "2-digit" });

/** In the import dialog: an amber box with the run's warnings, and a red line when Meta blocked it. */
export function ImportSafety({ file }: { file: Pick<LocalScrape, "run_safety" | "stopped_reason" | "scraped_at"> }) {
  const { t, intl } = useT();
  const time = timeIn(intl);
  const s = runSafetySummary(file, t);
  if (!s.line && !s.other.length && !s.blocked) return null;
  return (
    <div className="mt-3 grid gap-1.5 rounded-inner bg-caution-soft px-3 py-2.5 text-xs text-caution-ink" role="note">
      {s.line && <p>{s.line}</p>}
      {s.other.map((w) => <p key={w}>{w}</p>)}
      {s.blocked && (
        <p className="font-medium text-warn">
          {s.until ? t("Meta flagged this run. The extension started a 6-hour cooldown; don't collect again before {time}.", { time: time(s.until) }) : t("Meta flagged this run. The extension started a 6-hour cooldown; don't collect again before 6 hours have passed.")}
        </p>
      )}
      <p className="opacity-80">{t("Importing is fine either way: these are about the next runs.")}</p>
    </div>
  );
}

const dismissKey = (productId: string) => storageKey(`scrapeSafety.${productId}`);

/** On the Research page: what the last day's collections did that tends to get the connection blocked. Hidden until a newer run warns again. */
export function ScrapeSafetyCard({ productId, runs, className }: { productId: string; runs: LocalRunRow[]; className?: string }) {
  const { t, intl } = useT();
  // Read after hydration (the clock and the dismissal), so a dismissed card never flashes.
  const [dismissed, setDismissed] = useState<string | null | undefined>(undefined);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const restore = async () => {
      setNow(Date.now());
      try { setDismissed(readStored(localStorage, dismissKey(productId))); } catch { setDismissed(null); }
    };
    restore();
  }, [productId, runs]);
  if (now == null || dismissed === undefined) return null;
  const { warnings, newestId } = scrapeWarnings(runs, now, timeIn(intl), t);
  if (!warnings.length || (newestId && dismissed === newestId)) return null;
  const dismiss = () => {
    setDismissed(newestId);
    try { if (newestId) localStorage.setItem(dismissKey(productId), newestId); } catch { /* private mode */ }
  };
  return (
    <aside className={cx("relative flex gap-2.5 rounded-inner bg-caution-soft py-2.5 pr-9 pl-3 text-xs text-caution-ink", className)} aria-label={t("Collecting safely")}>
      <IconAlert className="mt-px size-3.5 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">{t("Collecting safely")}</p>
        <ul className="mt-0.5 grid gap-1.5">
          {warnings.map((w) => (
            <li key={w.kind} className={cx(w.kind === "blocked" && "text-warn")}>
              <span className="font-medium">{w.title}</span> {w.why} <span className="font-medium">{t("What to do:")}</span> {w.todo}
            </li>
          ))}
        </ul>
      </div>
      <button type="button" onClick={dismiss} aria-label={t("Hide until a newer warning")} title={t("Hide until a newer warning")} className="absolute top-2 right-2 grid size-6 place-items-center rounded-control transition hover:bg-hover">
        <IconX className="size-3.5" />
      </button>
    </aside>
  );
}
