"use client";
// The app's own confirm and notice dialogs, replacing the browser's (which some embedded browsers
// dismiss on their own, and which can't show a cost breakdown). Call `ask()` or `notice()` from
// anywhere; <DialogHost /> in the app layout renders them.
import { useRef, useSyncExternalStore, type ReactNode } from "react";
import { IconX } from "./icons";
import { useLayer } from "./layers";
import { Button, cx } from "./ui";

interface Request {
  id: number;
  title: string;
  body?: ReactNode;
  confirm: string;
  cancel?: string | null;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

let current: Request | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const set = (next: Request | null) => { current = next; listeners.forEach((notify) => notify()); };

/** Asks the user to confirm. Resolves true when they do, false when they cancel or press Escape. */
export function ask(o: { title: string; body?: ReactNode; confirm: string; cancel?: string | null; danger?: boolean }): Promise<boolean> {
  current?.resolve(false);
  return new Promise((resolve) => set({ ...o, id: nextId++, resolve }));
}

/** Tells the user something (usually what went wrong) and waits for them to close it. */
export function notice(message: ReactNode, title = "Something went wrong"): Promise<void> {
  return ask({ title, body: message, confirm: "OK", cancel: null }).then(() => undefined);
}

/** Facts in a confirm dialog: label on the left, value on the right. */
export function Facts({ rows, note }: { rows: [string, ReactNode][]; note?: ReactNode }) {
  return (
    <div>
      <dl className="rounded-inner bg-card px-4 py-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 border-t border-line py-2.5 first:border-t-0"><dt className="text-muted">{label}</dt><dd className="text-right font-medium text-ink">{value}</dd></div>
        ))}
      </dl>
      {note && <p className="mt-3 text-xs text-muted">{note}</p>}
    </div>
  );
}

export function DialogHost() {
  const request = useSyncExternalStore((notify) => { listeners.add(notify); return () => { listeners.delete(notify); }; }, () => current, () => null);
  return request ? <DialogBox key={request.id} request={request} /> : null;
}

// One dialog. A destructive confirm starts on Cancel, so a stray Enter never deletes anything; a safe one
// starts on its confirm button. Tab stays inside, Escape cancels, and focus goes back to the opener.
function DialogBox({ request }: { request: Request }) {
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
          <h2 id="dialog-title" className="pt-1 text-lg font-medium">{request.title}</h2>
          <button type="button" onClick={() => close(false)} aria-label="Close" className="grid size-7 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-hover hover:text-ink"><IconX className="size-4" /></button>
        </div>
        {request.body && <div className="mt-2.5 text-sm text-label">{request.body}</div>}
        <div className="mt-4 flex justify-end gap-2">
          {hasCancel && <Button ref={cancelRef} variant="secondary" onClick={() => close(false)}>{request.cancel ?? "Cancel"}</Button>}
          <Button ref={confirmRef} onClick={() => close(true)} className={cx(request.danger && "!bg-warn !text-on-ink hover:!bg-warn/85")}>{request.confirm}</Button>
        </div>
      </div>
    </div>
  );
}
