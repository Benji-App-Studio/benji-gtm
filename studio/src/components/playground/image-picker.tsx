"use client";
// "Pick from…": the workspace's product images, Research's stored copies of competitors' image ads, and
// earlier Playground results, as one grid per source. Picks one image (the reference) or several (your
// images, up to a limit, numbered in the order they go to Higgsfield).
import { useEffect, useRef, useState } from "react";
import type { PlaygroundPick } from "@/lib/playground-plan";
import { showOriginal, thumbUrl } from "@/lib/thumb";
import { IconX } from "../icons";
import { PanelPortal } from "../panel-portal";
import { Button, cx, Segmented } from "../ui";

export type PickSource = "product" | "research" | "results";
export type PickTile = PlaygroundPick & { caption?: string | null };

const SOURCE_LABEL: Record<PickSource, string> = { product: "Product images", research: "Research ads", results: "Results" };
const EMPTY: Record<PickSource, string> = {
  product: "No product images yet. Add them under Brand > Assets.",
  research: "No stored competitor image ads yet. Import ads in Research; their images are saved in the background.",
  results: "No Playground results yet.",
};

export function ImagePicker({ title, sources, initial = "product", picked, max = 1, onPick, onClose }: {
  title: string;
  sources: Record<PickSource, PickTile[]>;
  initial?: PickSource;
  /** Already picked (multi mode): shown numbered; clicking one unpicks it. */
  picked?: string[];
  /** 1 picks and closes; more toggles tiles until Done. */
  max?: number;
  onPick: (urls: string[]) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<PickSource>(initial);
  const [chosen, setChosen] = useState<string[]>(picked ?? []);
  const closeRef = useRef<HTMLButtonElement>(null);
  const multi = max > 1;
  const tiles = sources[source];

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle(url: string) {
    if (!multi) { onPick([url]); return; }
    setChosen((list) => (list.includes(url) ? list.filter((u) => u !== url) : list.length >= max ? list : [...list, url]));
  }

  return (
    <PanelPortal>
      <div className="fixed inset-0 z-[70] grid place-items-center bg-scrim/30 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div role="dialog" aria-modal="true" aria-label={title} className="page-in flex h-[min(560px,88dvh)] w-full max-w-[720px] flex-col overflow-hidden rounded-dialog bg-card shadow-pop">
          <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            <h2 className="mr-auto text-title font-medium">{title}</h2>
            <Segmented label="Source" value={source} onChange={setSource} options={(Object.keys(SOURCE_LABEL) as PickSource[]).map((s) => ({ value: s, label: <>{SOURCE_LABEL[s]} <span className="text-faint tabular-nums">{sources[s].length}</span></> }))} />
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="grid size-7 place-items-center rounded-control text-muted transition hover:bg-hover hover:text-ink"><IconX className="size-4" /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            {tiles.length ? (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2.5">
                {tiles.map((t) => {
                  const n = chosen.indexOf(t.url) + 1;
                  const full = multi && !n && chosen.length >= max;
                  return (
                    <li key={t.url} className="grid min-w-0 gap-1">
                      <button
                        type="button" onClick={() => toggle(t.url)} aria-pressed={multi ? n > 0 : undefined} disabled={full}
                        title={[t.label, t.caption, full ? `Up to ${max}: unpick one first` : null].filter(Boolean).join(" · ")}
                        className={cx("relative aspect-square overflow-hidden rounded-inner border bg-canvas transition", n ? "border-accent ring-2 ring-accent" : "border-line hover:border-ink/30", full && "cursor-not-allowed opacity-45")}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={thumbUrl(t.url, 320, 320)} alt={t.label ?? ""} loading="lazy" decoding="async" onError={(e) => showOriginal(e.currentTarget)} className="size-full object-cover" />
                        {n > 0 && <span className="absolute top-1.5 left-1.5 grid size-5 place-items-center rounded-full bg-accent text-[11px] font-medium text-white tabular-nums">{n}</span>}
                      </button>
                      {(t.caption || t.label) && <span className="truncate text-xs leading-tight text-muted">{t.caption || t.label}</span>}
                    </li>
                  );
                })}
              </ul>
            ) : <p className="py-10 text-center text-xs text-muted">{EMPTY[source]}</p>}
          </div>
          {multi && (
            <footer className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
              <span className="text-xs text-muted tabular-nums">{chosen.length} of {max} picked</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
                <Button size="sm" onClick={() => onPick(chosen)}>Done</Button>
              </div>
            </footer>
          )}
        </div>
      </div>
    </PanelPortal>
  );
}
