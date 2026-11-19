"use client";
// Escape for panels and sheets. The app's confirm and notice dialogs (components/dialog.tsx) open on top
// of a panel and close on Escape too; without this check one key press closed both, and whatever was
// typed in the panel went with it.
import { useEffect } from "react";

/** True while a confirm or notice dialog is open: Escape belongs to it, not to what's underneath. */
export const dialogOnTop = () => typeof document !== "undefined" && Boolean(document.querySelector('[role="alertdialog"]'));

/** Calls `onClose` on Escape, unless a dialog is open on top or `enabled` is false. */
export function useEscape(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !dialogOnTop()) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, enabled]);
}
