"use client";
// An ad term with its meaning (CAC, LTV, ROAS, CPI, ad set, paused): a dotted underline, and on hover,
// focus or tap one short line in a small pop-over. Re-exported by ui.tsx.
// - Screen readers get the meaning through aria-describedby, from text that is always in the page
//   (visually hidden), not only while the pop-over shows.
// - The pop-over is drawn in a portal with fixed position, so a box that clips (overflow hidden, a
//   truncated label) never cuts it off; it is clamped inside the viewport (375 px included) and opens
//   above the term when there is no room below.
// - It stays open while the pointer is over it (WCAG 1.4.13), closes on Escape, on scroll, and when focus
//   or the pointer leaves both the term and the pop-over.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
const TIP_WIDTH = 240;
const EDGE = 8;

type Place = { left: number; top: number; width: number; above: boolean };

/** Where the pop-over goes for a term at `rect` in a `view`-sized window: clamped to the edges, flipped above near the bottom. */
export function placeTip(rect: { left: number; top: number; bottom: number }, view: { width: number; height: number }): Place {
  const width = Math.min(TIP_WIDTH, view.width - EDGE * 2);
  const left = Math.max(EDGE, Math.min(rect.left, view.width - width - EDGE));
  const above = rect.bottom + 4 + 80 > view.height && rect.top > 80;
  return { left, top: above ? rect.top - 4 : rect.bottom + 4, width, above };
}

export function Term({ tip, children, className }: {
  /** The meaning, already translated. */
  tip: string; children: ReactNode; className?: string;
  /** Kept for older callers: the pop-over already escapes boxes that clip. */
  native?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => { if (leaving.current) clearTimeout(leaving.current); leaving.current = null; };
  const close = useCallback(() => { cancel(); setPlace(null); }, []);
  // When it last opened: a tap focuses (opens) and then clicks, and that click must not close it again.
  const openedAt = useRef(0);
  const show = () => {
    cancel();
    openedAt.current = Date.now();
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPlace(placeTip(rect, { width: window.innerWidth, height: window.innerHeight }));
  };
  // A short grace period, so the pointer can travel from the term onto the pop-over.
  const later = () => { cancel(); leaving.current = setTimeout(() => setPlace(null), 150); };

  useEffect(() => {
    if (!place) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [place, close]);
  useEffect(() => cancel, []);

  return (
    <>
    <span ref={ref} tabIndex={0} aria-describedby={id} onMouseEnter={show} onMouseLeave={later} onFocus={show} onBlur={close}
      onClick={() => { if (!place) show(); else if (Date.now() - openedAt.current > 400) close(); }}
      className={cx("relative inline-flex cursor-help rounded-xs underline decoration-faint decoration-dotted underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-focus/30", className)}>
      {children}
      {place && typeof document !== "undefined" && createPortal(
        <span aria-hidden onMouseEnter={cancel} onMouseLeave={later}
          style={{ left: place.left, top: place.top, maxWidth: place.width, transform: place.above ? "translateY(-100%)" : undefined }}
          className="fixed z-[90] w-max rounded-small border border-hairline bg-raised px-2 py-1.5 text-xs font-normal whitespace-normal text-label normal-case no-underline shadow-pop">
          {tip}
        </span>,
        document.body,
      )}
    </span>
    {/* The meaning for screen readers, always in the page (visually hidden), named by aria-describedby. */}
    <span id={id} className="sr-only">{tip}</span>
    </>
  );
}
