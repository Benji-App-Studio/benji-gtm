"use client";
// Keyboard rules for everything that sits on top of the page: dialogs, side panels and sheets, the
// command menu and the phone drawer. While one is open:
// - Tab and Shift+Tab stay inside the top-most one (they wrap around instead of reaching the page behind).
// - Escape closes only the top-most one, never the panel underneath as well.
// - Closing puts the keyboard back on whatever opened it.
// Popover menus (role="menu") handle their own keys and are left alone while open.
import { useEffect, useRef, useState, type RefObject } from "react";

interface Layer {
  el: HTMLElement;
  opener: HTMLElement | null;
  /** Called on Escape when this layer is on top. A layer without one closes itself (older panels). */
  escape: RefObject<(() => void) | undefined>;
}

const stack: Layer[] = [];

const FOCUSABLE = [
  "a[href]", "area[href]", "button:not([disabled])", "input:not([disabled]):not([type='hidden'])", "select:not([disabled])",
  "textarea:not([disabled])", "iframe", "audio[controls]", "video[controls]", "summary", "[contenteditable='true']", "[tabindex]",
].join(",");

/** The elements Tab can reach inside `root`, in order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) =>
    el.tabIndex >= 0 && !el.closest("[inert]") && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");
}

const menuOpen = () => Boolean(document.querySelector('[role="menu"]'));
const inMenu = (el: Element | null) => Boolean(el?.closest('[role="menu"]'));

function onKeyDown(event: KeyboardEvent) {
  const top = stack[stack.length - 1];
  if (!top || event.defaultPrevented) return;
  const active = document.activeElement as HTMLElement | null;

  if (event.key === "Escape") {
    // Something inside already used it (a field cancelling an edit, a menu closing), or a menu is open.
    if (menuOpen() || !top.escape.current) return;
    event.preventDefault();
    event.stopPropagation(); // the panels underneath (and their own window listeners) don't see it
    top.escape.current();
    return;
  }

  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey || inMenu(active)) return;
  const items = focusables(top.el);
  if (!items.length) { event.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1];
  const inside = Boolean(active && top.el.contains(active));
  if (!inside) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
  else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
}

function push(layer: Layer) {
  if (!stack.length) document.addEventListener("keydown", onKeyDown);
  stack.push(layer);
}

function remove(layer: Layer) {
  const index = stack.indexOf(layer);
  if (index < 0) return;
  const wasTop = index === stack.length - 1;
  stack.splice(index, 1);
  if (!stack.length) document.removeEventListener("keydown", onKeyDown);
  if (!wasTop) return;
  // Back to the opener; if it's gone (a menu item that closed), into the layer now on top.
  const active = document.activeElement;
  const focusLeftBehind = !active || active === document.body || layer.el.contains(active) || !active.isConnected;
  if (!focusLeftBehind) return;
  if (layer.opener?.isConnected) layer.opener.focus({ preventScroll: true });
  else { const below = stack[stack.length - 1]; if (below) focusables(below.el)[0]?.focus({ preventScroll: true }); }
}

/**
 * True while anything sits on top of the page: a registered layer, or any open dialog, sheet or drawer
 * (not every overlay registers with useLayer, so the DOM is checked too). Page-level hints such as the
 * getting-started coach marks hide while this is true.
 */
export function overlayOpen() {
  if (stack.length) return true;
  return typeof document !== "undefined" && Boolean(document.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]'));
}

/** True when `el` belongs to the top-most open layer (or nothing is open). */
export function isTopLayer(el: Element | null) {
  const top = stack[stack.length - 1];
  return !top || Boolean(el && top.el.contains(el));
}

/**
 * Makes the element in `ref` a layer while `enabled`: Tab stays inside, Escape calls `onEscape` (only
 * when it's the top-most layer), and focus returns to the opener on close. On open, focus moves to
 * `initialFocus` (or the first control) unless something inside already took it (an autoFocus field).
 */
export function useLayer(ref: RefObject<HTMLElement | null>, options: { onEscape?: () => void; enabled?: boolean; initialFocus?: RefObject<HTMLElement | null> } = {}) {
  const { onEscape, enabled = true, initialFocus } = options;
  // What had focus when this mounted: read before an autoFocus field inside takes it.
  const [atMount] = useState(() => (typeof document === "undefined" ? null : document.activeElement as HTMLElement | null));
  const escape = useRef(onEscape);
  useEffect(() => { escape.current = onEscape; });

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const active = document.activeElement as HTMLElement | null;
    const outside = (node: HTMLElement | null) => (node && node !== document.body && !el.contains(node) ? node : null);
    const opener = outside(atMount?.isConnected ? atMount : null) ?? outside(active);
    const layer: Layer = { el, opener, escape };
    push(layer);
    if (!el.contains(document.activeElement)) (initialFocus?.current ?? focusables(el)[0])?.focus({ preventScroll: true });
    return () => remove(layer);
    // Opening and closing is what matters here; the latest onEscape is read through its ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
