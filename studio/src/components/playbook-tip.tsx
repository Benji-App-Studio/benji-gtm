"use client";
// A small info box with one tip from the Meta ads playbook. Optional by design: it can be closed
// (remembered in this browser) and never blocks anything.
import { useEffect, useState } from "react";
import { TIPS, type TipId } from "@/lib/playbook";
import { IconSparkles, IconX } from "./icons";
import { cx } from "./ui";
import { readStored, storageKey } from "@/lib/storage-keys";

const key = (id: string) => storageKey(`tip.${id}`);

export function PlaybookTip({ id, className, children }: { id: TipId; className?: string; children?: React.ReactNode }) {
  const tip = TIPS[id];
  // Hidden until after hydration, so a closed tip never flashes.
  const [shown, setShown] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const restore = async () => {
      try { setShown(readStored(localStorage, key(id)) !== "closed"); } catch { setShown(true); }
    };
    restore();
  }, [id]);
  if (!shown) return null;
  const close = () => {
    setShown(false);
    try { localStorage.setItem(key(id), "closed"); } catch { /* private mode */ }
  };
  return (
    <aside className={cx("relative flex gap-2.5 rounded-inner border border-accent/20 bg-accent-soft/60 py-2.5 pr-9 pl-3 text-xs leading-relaxed", className)} aria-label={`Playbook tip: ${tip.title}`}>
      <IconSparkles className="mt-px size-4 shrink-0 text-accent" />
      <div className="min-w-0">
        <p className="font-medium text-ink">{tip.title} <span className="font-normal text-faint">· playbook, {tip.section.toLowerCase()}</span></p>
        <p className="mt-0.5 text-muted">{tip.body}</p>
        {tip.more && more && <p className="mt-1 text-muted">{tip.more}</p>}
        {children}
        {tip.more && <button type="button" onClick={() => setMore(!more)} className="mt-1 font-medium text-accent hover:underline">{more ? "Less" : "More"}</button>}
      </div>
      <button type="button" onClick={close} aria-label="Hide this tip" title="Hide this tip" className="absolute top-2 right-2 grid size-6 place-items-center rounded-full text-faint transition hover:bg-ink/[0.06] hover:text-ink">
        <IconX className="size-3.5" />
      </button>
    </aside>
  );
}

/** Several tips in a responsive grid. */
export function PlaybookTips({ ids, className }: { ids: TipId[]; className?: string }) {
  return <div className={cx("grid gap-2 @3xl:grid-cols-2", className)}>{ids.map((id) => <PlaybookTip key={id} id={id} />)}</div>;
}
