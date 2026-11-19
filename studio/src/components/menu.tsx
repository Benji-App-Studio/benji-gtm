"use client";
// A popover menu with full keyboard support, exported through components/ui.tsx.
//   <Menu label="Workspace" trigger={(props) => <button {...props}>Open</button>}>
//     <MenuItem href="/app/settings" kbd={<Kbd>G</Kbd>}>Settings</MenuItem>
//     <MenuSub label="Appearance"><MenuItem checked onSelect={…}>Light</MenuItem></MenuSub>
//     <MenuSeparator />
//     <MenuItem onSelect={signOut}>Sign out</MenuItem>
//   </Menu>
// Keys: Enter, Space or ↓ on the trigger opens it; ↑ ↓ Home End move; → or Enter opens a submenu and ←
// closes it; Escape closes and puts focus back on the trigger; Tab closes. The menu is drawn in a portal
// at a fixed position, so it is never clipped by a scrolling parent, and it flips to stay on screen.
import Link from "next/link";
import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref,
} from "react";
import { createPortal } from "react-dom";

const join = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export interface MenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  id: string;
  type: "button";
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  onClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent) => void;
}

const MenuContext = createContext<{ close: (refocus?: boolean) => void }>({ close: () => {} });

const ITEMS = '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemradio"]:not([aria-disabled="true"])';
/** The rows of one menu level (not those of a submenu inside it). */
const itemsOf = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLElement>(ITEMS)].filter((el) => el.closest('[role="menu"]') === menu);

/** Arrow keys, Home and End inside one menu level. Returns true when it handled the key. */
function moveFocus(event: ReactKeyboardEvent<HTMLElement>): boolean {
  const items = itemsOf(event.currentTarget);
  if (!items.length) return false;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const to = event.key === "ArrowDown" ? (at + 1) % items.length
    : event.key === "ArrowUp" ? (at <= 0 ? items.length - 1 : at - 1)
    : event.key === "Home" ? 0
    : event.key === "End" ? items.length - 1
    : -1;
  if (to < 0) return false;
  event.preventDefault();
  items[to]?.focus();
  return true;
}

const panelClass = "page-in min-w-[180px] rounded-lg border border-hairline bg-raised p-1 text-ink shadow-pop outline-none";

export function Menu({ trigger, children, label, align = "start", side = "bottom", width = 236, className }: {
  /** The button that opens the menu: spread the props you are given onto it. */
  trigger: (props: MenuTriggerProps, open: boolean) => ReactNode;
  children: ReactNode;
  /** What the menu is, for screen readers. */
  label: string;
  /** Which edge of the trigger the menu lines up with. */
  align?: "start" | "end";
  side?: "bottom" | "top";
  width?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // Place it against the trigger, flipped or nudged to stay on screen, then focus the first row.
  useLayoutEffect(() => {
    const menu = menuRef.current, button = triggerRef.current;
    if (!open || !menu || !button) return;
    const t = button.getBoundingClientRect();
    const w = menu.offsetWidth, h = menu.offsetHeight, gap = 4, edge = 8;
    const left = align === "start" ? t.left : t.right - w;
    const below = t.bottom + gap, above = t.top - gap - h;
    const top = side === "bottom" ? (below + h > window.innerHeight - edge && above >= edge ? above : below) : (above < edge ? below : above);
    menu.style.left = `${Math.max(edge, Math.min(left, window.innerWidth - w - edge))}px`;
    menu.style.top = `${Math.max(edge, Math.min(top, window.innerHeight - h - edge))}px`;
    menu.style.visibility = "visible";
    (itemsOf(menu).find((el) => el.getAttribute("aria-checked") === "true") ?? itemsOf(menu)[0] ?? menu).focus({ preventScroll: true });
  }, [open, align, side]);

  // A press outside, a resize or a scroll of the page behind it closes the menu.
  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) => target instanceof Node && (menuRef.current?.contains(target) || triggerRef.current?.contains(target));
    const onDown = (event: PointerEvent) => { if (!inside(event.target)) setOpen(false); };
    const onScroll = (event: Event) => { if (!inside(event.target)) setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const props: MenuTriggerProps = {
    ref: triggerRef,
    id: `${id}-trigger`,
    type: "button",
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": open ? `${id}-menu` : undefined,
    onClick: () => setOpen((value) => !value),
    onKeyDown: (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
    },
  };

  return (
    <>
      {trigger(props, open)}
      {open && createPortal(
        <MenuContext.Provider value={{ close }}>
          <div ref={menuRef} id={`${id}-menu`} role="menu" aria-label={label} tabIndex={-1}
            style={{ position: "fixed", top: 0, left: 0, width, maxWidth: "calc(100vw - 16px)", visibility: "hidden" }}
            className={join(panelClass, "z-[90]", className)}
            onKeyDown={(event) => {
              if (moveFocus(event)) return;
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
              if (event.key === "Tab") close(false);
            }}>
            {children}
          </div>
        </MenuContext.Provider>,
        document.body,
      )}
    </>
  );
}

const rowClass = (danger?: boolean, disabled?: boolean) => join(
  "flex min-h-8 w-full cursor-default items-center gap-2 rounded-md px-2 py-1 text-left text-sm outline-none select-none focus:bg-active",
  danger ? "text-warn" : "text-ink",
  disabled && "pointer-events-none opacity-45",
);

function RowBody({ icon, children, kbd, checked, chevron }: { icon?: ReactNode; children: ReactNode; kbd?: ReactNode; checked?: boolean; chevron?: boolean }) {
  return (
    <>
      {icon && <span className="grid size-4 shrink-0 place-items-center text-muted [&>svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {kbd && <span className="flex shrink-0 items-center gap-1 text-xs text-faint">{kbd}</span>}
      {checked && <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>}
      {chevron && <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3.5 shrink-0 text-faint" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="m9.5 6.5 5.5 5.5-5.5 5.5" /></svg>}
    </>
  );
}

/** One row. Give it `href` to go somewhere or `onSelect` to do something; `checked` makes it one of a set of choices. */
export function MenuItem({ children, icon, kbd, href, onSelect, checked, danger, disabled, keepOpen }: {
  children: ReactNode; icon?: ReactNode; kbd?: ReactNode; href?: string; onSelect?: () => void;
  checked?: boolean; danger?: boolean; disabled?: boolean; keepOpen?: boolean;
}) {
  const { close } = useContext(MenuContext);
  const shared = {
    role: checked === undefined ? "menuitem" as const : "menuitemradio" as const,
    "aria-checked": checked,
    "aria-disabled": disabled || undefined,
    tabIndex: -1,
    className: rowClass(danger, disabled),
    onPointerMove: (event: { currentTarget: HTMLElement }) => { if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true }); },
  };
  const body = <RowBody icon={icon} kbd={kbd} checked={checked}>{children}</RowBody>;
  if (href && !disabled) return <Link href={href} {...shared} onClick={() => { onSelect?.(); close(false); }}>{body}</Link>;
  return <button type="button" {...shared} onClick={() => { if (disabled) return; onSelect?.(); if (!keepOpen) close(!href); }}>{body}</button>;
}

/** A row that opens a second menu beside it (or under it when there is no room). */
export function MenuSub({ label, icon, children }: { label: ReactNode; icon?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [focusFirst, setFocusFirst] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    const sub = subRef.current;
    if (!open || !sub) return;
    // Beside the row when it fits (right, else left); otherwise in line under it.
    sub.dataset.place = "right";
    const rect = sub.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) sub.dataset.place = rect.left - rect.width - (rowRef.current?.offsetWidth ?? 0) >= 8 ? "left" : "inline";
    if (focusFirst) (itemsOf(sub).find((el) => el.getAttribute("aria-checked") === "true") ?? itemsOf(sub)[0])?.focus({ preventScroll: true });
  }, [open, focusFirst]);

  const show = (viaKeyboard: boolean) => { setFocusFirst(viaKeyboard); setOpen(true); };
  const hide = (refocus: boolean) => { setOpen(false); if (refocus) rowRef.current?.focus(); };

  return (
    <div className="relative" onPointerEnter={(event) => { if (event.pointerType === "mouse") show(false); }} onPointerLeave={(event) => { if (event.pointerType === "mouse") hide(false); }}>
      <button ref={rowRef} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} tabIndex={-1}
        className={join(rowClass(), open && "bg-hover")}
        onPointerMove={(event) => { if (document.activeElement !== event.currentTarget && !subRef.current?.contains(document.activeElement)) event.currentTarget.focus({ preventScroll: true }); }}
        onClick={() => (open ? hide(true) : show(true))}
        onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); show(true); } }}>
        <RowBody icon={icon} chevron>{label}</RowBody>
      </button>
      {open && (
        <div ref={subRef} id={id} role="menu" aria-label={typeof label === "string" ? label : undefined} data-place="right"
          className={join(panelClass, "absolute top-0 z-10 w-[180px] -translate-y-1",
            "data-[place=right]:left-full data-[place=left]:right-full",
            "data-[place=inline]:static data-[place=inline]:mt-1 data-[place=inline]:w-full data-[place=inline]:translate-y-0 data-[place=inline]:border-line data-[place=inline]:shadow-none")}
          onKeyDown={(event) => {
            if (moveFocus(event)) { event.stopPropagation(); return; }
            if (event.key === "ArrowLeft" || event.key === "Escape") { event.preventDefault(); event.stopPropagation(); hide(true); }
            // The parent menu's own arrow keys must not also run.
            if (event.key === "ArrowRight") event.stopPropagation();
          }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-line" />;
}

/** A quiet heading above a group of rows. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-2 pt-1.5 pb-1 text-xs text-faint">{children}</p>;
}
