"use client";
// Dropping an ads file (the radar.meta-ad-library/v1 .json the Ad Library extension saves) on the
// Research ads page: a drop zone next to the import button, and a drop anywhere on the
// page, which shows a full-window overlay while a file is dragged over it. Both hand the files to the
// page, which runs them through the same import as the file picker.
import { useEffect, useEffectEvent, useId, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { useT } from "@/lib/i18n/client";
import { IconUpload } from "../icons";
import { PanelPortal } from "../panel-portal";
import { cx, Spinner } from "../ui";
import { StorageNotice } from "../storage-notice";

const isJson = (file: File) => /\.json$/i.test(file.name) || file.type === "application/json";

/** The first .json, and how many other files came with it. */
export function pickScrapeFile(files: File[]): { file: File | null; ignored: number } {
  const file = files.find(isJson) ?? null;
  return { file, ignored: files.length - (file ? 1 : 0) };
}

/** Every .json (one per advertiser, imported one after another), and how many other files came with them. */
export function pickScrapeFiles(files: File[]): { files: File[]; ignored: number } {
  const json = files.filter(isJson);
  return { files: json, ignored: files.length - json.length };
}

/** True for a drag that carries files from outside the page (Finder, the downloads bar), not text or a picture on it. */
const carriesFiles = (dataTransfer: DataTransfer | null) => Boolean(dataTransfer && Array.from(dataTransfer.types).includes("Files"));

export interface DropMessage { tone: "error" | "note"; text: string }

/**
 * The visible drop zone: a button that opens the file picker (click, Enter or Space), and takes a file
 * dropped on it. Highlights while a file is dragged over it.
 */
export function ScrapeDropZone({ onFiles, onChoose, busy, busyText, message, ours = false }: {
  onFiles: (files: File[]) => void; onChoose: () => void; busy: boolean; busyText?: string; message: DropMessage | null;
  /** On the "Our ads" side the files are our own Pages', not competitors'. */
  ours?: boolean;
}) {
  const { t } = useT();
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const id = useId();
  const files = (e: ReactDragEvent) => !busy && carriesFiles(e.dataTransfer);
  return (
    <div className="grid gap-1.5">
      <button
        type="button" onClick={onChoose} disabled={busy}
        aria-labelledby={`${id}-title`} aria-describedby={cx(`${id}-hint`, message && `${id}-message`) || undefined}
        onDragEnter={(e) => { if (!files(e)) return; e.preventDefault(); depth.current += 1; setOver(true); }}
        onDragOver={(e) => { if (!files(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
        onDragLeave={(e) => { if (!files(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
        onDrop={(e) => {
          depth.current = 0;
          setOver(false);
          if (!files(e)) return;
          // Taken here: the page-wide drop sees defaultPrevented and leaves it alone.
          e.preventDefault();
          onFiles(Array.from(e.dataTransfer.files));
        }}
        className={cx(
          "flex min-h-12 w-full items-center gap-3 rounded-inner border border-dashed px-3 py-2 text-left text-sm transition outline-none",
          "focus-visible:border-focus/70 focus-visible:ring-2 focus-visible:ring-focus/20 disabled:cursor-progress",
          over ? "border-accent bg-accent-soft" : "border-hairline bg-raised hover:bg-hover",
        )}
      >
        <span className={cx("grid size-6 shrink-0 place-items-center rounded-md text-accent transition", over ? "bg-raised" : "bg-accent-soft")} aria-hidden>
          {busy ? <Spinner className="size-3.5" /> : <IconUpload className="size-3.5" />}
        </span>
        <span className="min-w-0">
          <span id={`${id}-title`} className="block text-ink">
            {busy ? (busyText ?? t("Importing…")) : over ? t("Drop to import") : <>{t("Drop ads files here, or")} <span className="font-medium text-accent">{t("choose files")}</span></>}
          </span>
          <span id={`${id}-hint`} className="block text-xs text-muted">{ours ? t("The .json files the Ad Library extension saves: one per Page, as many as you like at once.") : t("The .json files the Ad Library extension saves: one per competitor, as many as you like at once.")}</span>
        </span>
      </button>
      {/* Importing saves the ads' images and videos: at 95% of storage, say so first (the import's own check leaves out what won't fit). */}
      <StorageNotice action="save_media" />
      {message && (
        <p id={`${id}-message`} role={message.tone === "error" ? "alert" : "status"} className={cx("text-xs", message.tone === "error" ? "text-warn" : "text-muted")}>
          {message.text}
        </p>
      )}
    </div>
  );
}

/**
 * A file dropped anywhere on the page. Returns whether a file is being dragged over the window (for the
 * overlay). Counts dragenter/dragleave so moving between elements doesn't flicker; resets on drop, on
 * dragend, on leaving the window and on Escape. Drags that start on the page (text, a card's picture)
 * are ignored, and so is a drop a drop zone already took. While `enabled` is false (an import is
 * running), files can't be dropped and nothing shows.
 */
export function usePageFileDrop({ enabled, onFiles }: { enabled: boolean; onFiles: (files: File[]) => void }): boolean {
  const [dragging, setDragging] = useState(false);
  const take = useEffectEvent((files: File[]) => onFiles(files));
  const isEnabled = useEffectEvent(() => enabled);
  useEffect(() => {
    let depth = 0;
    let internal = false;
    const reset = () => { depth = 0; setDragging(false); };
    const external = (e: DragEvent) => !internal && carriesFiles(e.dataTransfer);
    const onDragStart = () => { internal = true; };
    // No mouse events fire during a drag, so a mouse move means any drag from the page is over (in case
    // its dragend never came, e.g. the dragged element was removed).
    const onMouseMove = () => { internal = false; };
    const onDragEnd = () => { internal = false; reset(); };
    const onDragEnter = (e: DragEvent) => {
      if (!external(e)) return;
      depth += 1;
      if (isEnabled()) setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!external(e) || !e.dataTransfer) return;
      // Without this the browser opens the file in the tab, leaving the dashboard.
      e.preventDefault();
      e.dataTransfer.dropEffect = isEnabled() ? "copy" : "none";
    };
    const onDragLeave = (e: DragEvent) => {
      if (!external(e)) return;
      depth = Math.max(0, depth - 1);
      // Leaving the window: Chrome reports (0, 0), Firefox a point outside. Catches a count thrown off by
      // an element that was swapped out mid-drag.
      const left = e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight;
      if (!depth || left) reset();
    };
    // Capture: hides the overlay even when something on the page stops the drop from bubbling.
    const onDropCapture = () => reset();
    const onDrop = (e: DragEvent) => {
      const files = external(e);
      internal = false;
      if (!files || e.defaultPrevented || !e.dataTransfer) return;
      e.preventDefault();
      if (isEnabled()) take(Array.from(e.dataTransfer.files));
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") reset(); };
    const listeners: [string, EventListener, boolean][] = [
      ["dragstart", onDragStart as EventListener, true],
      ["mousemove", onMouseMove as EventListener, true],
      ["dragend", onDragEnd as EventListener, true],
      ["dragenter", onDragEnter as EventListener, true],
      ["dragleave", onDragLeave as EventListener, true],
      ["dragover", onDragOver as EventListener, false],
      ["drop", onDropCapture as EventListener, true],
      ["drop", onDrop as EventListener, false],
      ["keydown", onKey as EventListener, false],
    ];
    for (const [type, listener, capture] of listeners) window.addEventListener(type, listener, capture);
    return () => { for (const [type, listener, capture] of listeners) window.removeEventListener(type, listener, capture); };
  }, []);
  return dragging && enabled;
}

/** The full-window target while a file is dragged over the page. It doesn't take pointer events, so the drop lands on the page below. */
export function PageDropOverlay({ shown }: { shown: boolean }) {
  const { t } = useT();
  if (!shown) return null;
  return (
    <PanelPortal modal={false}>
      <div className="pointer-events-none fixed inset-0 z-[90] bg-canvas/60 p-3 backdrop-blur-xs" aria-hidden>
        <div className="grid size-full place-items-center rounded-dialog border-2 border-dashed border-accent bg-accent-soft/50">
          <div className="flex items-center gap-3 rounded-card border border-line bg-raised px-4 py-3 shadow-pop">
            <span className="grid size-6 place-items-center rounded-md bg-accent-soft text-accent"><IconUpload className="size-3.5" /></span>
            <span>
              <span className="block text-sm font-medium text-ink">{t("Drop to import ads")}</span>
              <span className="block text-xs text-muted">{t("One or many .json files the Ad Library extension saved")}</span>
            </span>
          </div>
        </div>
      </div>
    </PanelPortal>
  );
}
