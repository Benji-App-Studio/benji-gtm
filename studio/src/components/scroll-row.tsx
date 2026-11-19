"use client";
// A horizontally scrolling row without the browser's scrollbar: its edges fade when there's more to
// see on that side, so it reads as scrollable without a bar under it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

export function ScrollRow({ className, children, label }: { className?: string; children: ReactNode; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    // The observer reports the first size straight away, and again whenever the row or its content changes.
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    el.addEventListener("scroll", update, { passive: true });
    return () => { observer.disconnect(); el.removeEventListener("scroll", update); };
  }, []);
  return (
    <div ref={ref} role={label ? "group" : undefined} aria-label={label}
      data-fade-left={edges.left || undefined} data-fade-right={edges.right || undefined}
      className={cx("no-scrollbar overflow-x-auto", className)}>
      {children}
    </div>
  );
}
