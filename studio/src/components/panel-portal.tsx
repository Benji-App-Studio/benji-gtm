"use client";
// Side panels and sheets render into <body>, not inside the page. Pages animate in with a transform,
// and a transformed ancestor turns `position: fixed` into "fixed to the scrolled page": a panel opened
// halfway down a long list then started above the screen (its top, with the media, looked empty) and
// its dark overlay stopped at the sidebar. In <body> they're fixed to the window, and the overlay
// covers everything.
import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const subscribe = () => () => {};

export function PanelPortal({ children }: { children: ReactNode }) {
  // Only on the client: document.body doesn't exist during the server render.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return mounted ? createPortal(children, document.body) : null;
}

/** The overlay behind a side panel: covers the whole window, with a small gap around the panel. */
export const PANEL_OVERLAY = "fixed inset-0 flex justify-end bg-scrim/40 p-2 md:p-3";
/** The panel itself: floats inside that gap with rounded corners and scrolls on its own. */
export const PANEL = "flex h-full w-full flex-col overflow-y-auto overscroll-contain rounded-dialog bg-card shadow-pop";
/** The overlay behind a centred sheet (an ad, its Recreate): the sheet sits in the middle of the window. */
export const MODAL_OVERLAY = "fixed inset-0 flex items-center justify-center bg-scrim/40 p-2 md:p-6";
/** A centred sheet: as tall as its content, at most the window, and scrolls on its own. */
export const MODAL = "flex max-h-full w-full flex-col overflow-y-auto overscroll-contain rounded-dialog bg-card shadow-pop";
