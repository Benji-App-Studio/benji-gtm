"use client";
// Launch's settings in a side drawer, so the page leads with the queue and the drafts: where ads go,
// the testing and scaling ad sets, budgets and promotion rules, then the daily-uploads switch. It
// opens from the page's Settings button and from any `#settings` link on the page (the suggestions'
// "Open Launch settings", the setup checklist), and closes with Escape, the ✕ or a click outside.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { LaunchSettings } from "@/lib/launch/types";
import { IconX } from "../icons";
import { PANEL, PANEL_OVERLAY, PanelPortal } from "../panel-portal";
import { PlaybookTips } from "../playbook-tip";
import { Automation } from "./automation";
import { LaunchSettingsForm } from "./settings";

/** The hashes that open the drawer. */
const HASHES = new Set(["#settings", "#automation"]);

const subscribe = (notify: () => void) => {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
};

/** Whether the drawer is open (the URL hash is #settings), and functions to open and close it. */
export function useSettingsDrawer() {
  const open = useSyncExternalStore(subscribe, () => HASHES.has(window.location.hash), () => false);
  const show = useCallback(() => { window.location.hash = "settings"; }, []);
  const hide = useCallback(() => {
    history.replaceState(history.state, "", window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, []);
  return { open, show, hide };
}

export function SettingsDrawer({ productId, open, onClose, saved, defaults, onSaved }: {
  productId: string;
  open: boolean;
  onClose: () => void;
  /** The workspace's saved settings, null until the first save (the form then starts from the defaults). */
  saved: LaunchSettings | null;
  defaults: LaunchSettings;
  onSaved: () => Promise<unknown>;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // A confirm dialog above the drawer handles its own Escape.
      if (e.key === "Escape" && !document.querySelector("[role=alertdialog]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <PanelPortal>
      <div className={`${PANEL_OVERLAY} z-40`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <aside role="dialog" aria-modal="true" aria-labelledby="launch-settings-title" className={`${PANEL} @container max-w-3xl`}>
          <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-card px-5 py-3">
            <div className="min-w-0">
              <h2 id="launch-settings-title" className="text-title font-medium">Launch settings</h2>
              <p className="text-xs text-muted">Where ads go, the testing and scaling ad sets, the promotion rules and daily uploads.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 shrink-0 place-items-center rounded-control text-muted transition hover:bg-hover hover:text-ink"><IconX className="size-4" /></button>
          </div>
          <div className="grid gap-8 p-4 @md:p-5">
            <LaunchSettingsForm productId={productId} settings={saved ?? defaults} saved={Boolean(saved)} onSaved={onSaved} onCancel={onClose} />
            <Automation productId={productId} settings={saved} onSaved={onSaved} />
            <PlaybookTips ids={["deepest-event", "broad-targeting", "headroom", "creative-is-targeting"]} />
          </div>
        </aside>
      </div>
    </PanelPortal>
  );
}
