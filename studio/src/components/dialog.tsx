"use client";
// The app's own confirm and notice dialogs, replacing the browser's (which some embedded browsers
// dismiss on their own, and which can't show a cost breakdown). Call `ask()` or `notice()` from
// anywhere; <DialogHost /> in the app layout renders them. `toast()` says a short "done" that goes away
// by itself (it outlives a page change, so a page can say it and move on).
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";
import { IconX } from "./icons";
import { useLayer } from "./layers";
import { Button, cx } from "./ui";

interface Request {
  id: number;
  title: string;
  body?: ReactNode;
  confirm: ReactNode;
  cancel?: string | null;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

let current: Request | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const set = (next: Request | null) => { current = next; listeners.forEach((notify) => notify()); };

/** Asks the user to confirm. Resolves true when they do, false when they cancel or press Escape. */
export function ask(o: { title: string; body?: ReactNode; confirm: ReactNode; cancel?: string | null; danger?: boolean }): Promise<boolean> {
  current?.resolve(false);
  return new Promise((resolve) => set({ ...o, id: nextId++, resolve }));
}

/** The example app's refusal (components/example): set while it is open, so a refused action isn't called an error. */
let exampleRefusal: string | null = null;
export const setExampleRefusal = (text: string | null) => { exampleRefusal = text; };

/**
 * Tells the user something (usually what went wrong) and waits for them to close it. In the example app,
 * a write it refused says so under "This is an example" instead of an error's title.
 */
export function notice(message: ReactNode, title: string = m("Something went wrong")): Promise<void> {
  if (exampleRefusal && typeof message === "string" && message.includes(exampleRefusal)) title = m("This is an example");
  return ask({ title, body: typeof message === "string" ? <Said text={message} /> : message, confirm: m("OK"), cancel: null }).then(() => undefined);
}

// MARK: Toasts

interface Toast { id: number; message: string; vars?: Record<string, string | number> }
let toastNow: Toast | null = null;
const toastListeners = new Set<() => void>();
const setToast = (next: Toast | null) => { toastNow = next; toastListeners.forEach((notify) => notify()); };

/** A short confirmation at the foot of the screen for a few seconds ("App deleted"). The message is an English sentence (translated with its values). */
export function toast(message: string, vars?: Record<string, string | number>) {
  setToast({ id: nextId++, message, vars });
}

function ToastBox({ item }: { item: Toast }) {
  const { t } = useT();
  useEffect(() => {
    const timer = setTimeout(() => { if (toastNow === item) setToast(null); }, 4500);
    return () => clearTimeout(timer);
  }, [item]);
  return (
    <div role="status" aria-live="polite" className="page-in fixed inset-x-4 bottom-4 z-[70] mx-auto flex max-w-md items-center gap-3 rounded-inner border border-line bg-card px-3 py-2.5 text-sm text-ink shadow-raised print:hidden">
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t(item.message, item.vars)}</span>
      <button type="button" onClick={() => setToast(null)} aria-label={t("Close")} className="grid size-6 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-hover hover:text-ink"><IconX className="size-3.5" /></button>
    </div>
  );
}

/** A sentence in a dialog said in the viewer's language (a dictionary entry), or as it came. */
function Said({ text }: { text: string }) {
  return <>{useT().t(text)}</>;
}

/** Facts in a confirm dialog: label on the left, value on the right. */
export function Facts({ rows, note }: { rows: [ReactNode, ReactNode][]; note?: ReactNode }) {
  return (
    <div>
      <dl className="rounded-inner bg-card px-4 py-1 text-sm">
        {rows.map(([label, value], i) => (
          <div key={i} className="flex items-baseline justify-between gap-4 border-t border-line py-2.5 first:border-t-0"><dt className="text-muted">{label}</dt><dd className="text-right font-medium text-ink">{value}</dd></div>
        ))}
      </dl>
      {note && <p className="mt-3 text-xs text-muted">{note}</p>}
    </div>
  );
}

export function DialogHost() {
  const request = useSyncExternalStore((notify) => { listeners.add(notify); return () => { listeners.delete(notify); }; }, () => current, () => null);
  const shown = useSyncExternalStore((notify) => { toastListeners.add(notify); return () => { toastListeners.delete(notify); }; }, () => toastNow, () => null);
  return (
    <>
      {request && <DialogBox key={request.id} request={request} />}
      {shown && <ToastBox key={shown.id} item={shown} />}
    </>
  );
}

// One dialog. A destructive confirm starts on Cancel, so a stray Enter never deletes anything; a safe one
// starts on its confirm button. Tab stays inside, Escape cancels, and focus goes back to the opener.
function DialogBox({ request }: { request: Request }) {
  const { t } = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const close = (ok: boolean) => { request.resolve(ok); if (current === request) set(null); };
  const hasCancel = request.cancel !== null;
  useLayer(boxRef, { onEscape: () => close(false), initialFocus: request.danger && hasCancel ? cancelRef : confirmRef });

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-scrim/25 p-4 backdrop-blur-[1px]" onMouseDown={(event) => { if (event.target === event.currentTarget) close(false); }}>
      <div ref={boxRef} role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" className="page-in max-h-[calc(100dvh-2rem)] w-full max-w-[460px] overflow-y-auto overscroll-contain rounded-dialog border border-hairline bg-raised p-4 shadow-pop">
        <div className="flex items-start justify-between gap-4">
          <h2 id="dialog-title" className="pt-1 text-lg font-medium">{t(request.title)}</h2>
          <button type="button" onClick={() => close(false)} aria-label={t("Close")} className="grid size-7 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-hover hover:text-ink"><IconX className="size-4" /></button>
        </div>
        {request.body && <div className="mt-2.5 text-sm text-label">{request.body}</div>}
        <div className="mt-4 flex justify-end gap-2">
          {hasCancel && <Button ref={cancelRef} variant="secondary" onClick={() => close(false)}>{request.cancel ? t(request.cancel) : t("Cancel")}</Button>}
          <Button ref={confirmRef} onClick={() => close(true)} className={cx(request.danger && "!bg-warn !text-on-ink hover:!bg-warn/85")}>{typeof request.confirm === "string" ? t(request.confirm) : request.confirm}</Button>
        </div>
      </div>
    </div>
  );
}
