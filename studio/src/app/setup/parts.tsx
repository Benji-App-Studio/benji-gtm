"use client";
// The pieces the setup checklist and the Updates view share: a step card, the access-token
// instructions, and the live list of provisioning steps fed by the streamed progress.
import { useCallback, useState, type ReactNode } from "react";
import { Badge, Button, Card, cx, ErrorNote, Spinner } from "@/components/ui";
import { IconCheck, IconExternal } from "@/components/icons";
import { rich, sentenceGap } from "@/components/rich";
import { useT } from "@/lib/i18n/client";
import { provisionText } from "./provision-words";
import { m } from "@/lib/i18n/translate";
import { STEP_LABELS, type ProgressEvent, type StepId, type StepStatus } from "@/lib/server/provision/types";

export const SUPABASE_LINKS = {
  signUp: "https://supabase.com/dashboard/sign-up",
  newProject: "https://supabase.com/dashboard/new",
  tokens: "https://supabase.com/dashboard/account/tokens",
  dashboard: "https://supabase.com/dashboard/projects",
};

/** A project's page in the Supabase dashboard (where a paused project is restored). */
export const projectDashboard = (ref: string | null) => (ref ? `https://supabase.com/dashboard/project/${ref}` : SUPABASE_LINKS.dashboard);

/** A link that opens in a new tab, so the checklist stays where it is. */
export function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-ink underline underline-offset-2">
      {children}<IconExternal className="size-3.5" />
    </a>
  );
}

/** Numbered instructions. */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink">{children}</ol>;
}

export type CardState = "todo" | "open" | "done";

/** One step of the checklist: a number, a title, a line on what it is and why, and its body while open. */
export function StepCard({ number, title, why, state, summary, onOpen, children }: {
  number: number; title: string; why: ReactNode; state: CardState; summary?: ReactNode; onOpen?: () => void; children: ReactNode;
}) {
  const { t } = useT();
  return (
    <Card className={cx("px-4 py-3", state === "open" && "pb-4", state === "todo" && "opacity-60")} aria-current={state === "open" ? "step" : undefined}>
      <div className="flex items-start gap-3">
        <span className={cx("mt-px grid size-5 shrink-0 place-items-center rounded-full text-xs font-medium tabular-nums", state === "done" ? "bg-win-soft text-win" : "bg-control text-label")}>
          {state === "done" ? <IconCheck className="size-3" /> : number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-h-[22px] flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">{title}</h2>
            {state === "done" && (
              <span className="flex items-center gap-2">
                <Badge tone="win">{t("Done")}</Badge>
                {onOpen && <Button type="button" variant="ghost" size="sm" onClick={onOpen}>{t("Change")}</Button>}
              </span>
            )}
          </div>
          {state === "done" && summary && <p className="mt-0.5 text-xs text-muted">{summary}</p>}
          {state === "open" && (
            <>
              <p className="mt-0.5 text-sm text-muted">{why}</p>
              <div className="mt-4 space-y-4">{children}</div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

/** What an access token is, said plainly, and how to make one. `action` is the button pressed after pasting it. */
export function TokenHelp({ appName, action }: { appName: string; action?: string }) {
  const { t, locale } = useT();
  const gap = sentenceGap(locale);
  return (
    <>
      <p className="text-sm text-ink">
        {t("An access token gives {app}, on this computer, temporary access to your Supabase account. It is used only while this page works.", { app: appName })}{gap}
        {t("It is not saved anywhere. You can delete it in Supabase as soon as you are done.")}
      </p>
      <Steps>
        <li>{rich(t("Open {link}."), { link: <OutLink href={SUPABASE_LINKS.tokens}>{t("Access Tokens in Supabase")}</OutLink> })}</li>
        <li>{rich(t("Click {button} and name it \"setup\"."), { button: <b>Generate new token</b> })}</li>
        <li>{rich(t("Choose your project, and the {preset} preset."), { preset: <b>Full access</b> })}</li>
        <li>{rich(t("Pick the shortest expiry, create the token, and click {copy}. It starts with {prefix}."), { copy: <b>Copy</b>, prefix: <code>sbp_</code> })}</li>
        <li>{rich(t("Paste it in the box below and click {action}."), { action: <b>{action ?? t("Check")}</b> })}</li>
      </Steps>
      <p className="text-sm text-muted">{rich(t("If the page says the token isn't allowed, create it again with {preset}: a Read-only token doesn't work."), { preset: <b>Full access</b> })}</p>
    </>
  );
}

// MARK: Live progress

export interface StepProgress { status: StepStatus | "waiting"; message: string; detail?: string; progress?: { done: number; total: number } }
export type ProgressMap = Partial<Record<StepId, StepProgress>>;
export interface RunFailure { step?: StepId; message: string; detail?: string; code?: string }

/**
 * Calls a setup route that streams one JSON object per line and feeds each progress event to the
 * page. Resolves with null on success, or with what went wrong.
 */
export async function runStream(url: string, body: unknown, onEvent: (event: ProgressEvent) => void): Promise<RunFailure | null> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { message: m("Couldn't reach the app. Check that it is still running, then press Retry.") };
  }
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => null)) as { error?: string; detail?: string; code?: string } | null;
    return { message: data?.error ?? m("Setup couldn't start. Press Retry."), detail: data?.detail, code: data?.code ?? (response.status === 401 || response.status === 403 ? `http_${response.status}` : undefined) };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outcome: RunFailure | null | undefined;
  const take = (line: string) => {
    if (!line.trim()) return;
    let parsed: ({ type: "event" } & ProgressEvent) | { type: "result"; ok: boolean; failed: RunFailure | null };
    try { parsed = JSON.parse(line); } catch { return; }
    if (parsed.type === "event") onEvent(parsed);
    else if (parsed.type === "result") outcome = parsed.ok ? null : parsed.failed ?? { message: m("Setup stopped. Press Retry.") };
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(take);
    }
    take(buffer);
  } catch {
    return { message: m("The connection to the app dropped. Press Retry: finished steps are skipped.") };
  }
  return outcome === undefined ? { message: m("Setup stopped before it finished. Press Retry: finished steps are skipped.") } : outcome;
}

/** Keeps the latest state of each step while a run streams in. */
export function useProgress() {
  const [steps, setSteps] = useState<ProgressMap>({});
  const record = useCallback((event: ProgressEvent) => {
    setSteps((current) => ({ ...current, [event.step]: { status: event.status, message: event.message, detail: event.detail ?? current[event.step]?.detail, progress: event.progress } }));
  }, []);
  const reset = useCallback(() => setSteps({}), []);
  return { steps, record, reset };
}

/** The live list: every step with its state and latest message, technical detail folded away. */
export function ProgressList({ ids, steps, running }: { ids: readonly StepId[]; steps: ProgressMap; running: boolean }) {
  const tr = useT();
  const { t } = tr;
  const details = ids.flatMap((id) => (steps[id]?.detail ? [`${id}: ${steps[id]?.detail}`] : []));
  return (
    <div>
      <ul className="space-y-2" aria-live="polite">
        {ids.map((id) => {
          const step = steps[id];
          const status = step?.status ?? "waiting";
          return (
            <li key={id} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
                {status === "running" && running ? <Spinner className="size-3.5 text-muted" />
                  : status === "done" || status === "skipped" ? <IconCheck className="size-3.5 text-win" />
                  : status === "failed" ? <span className="size-2 rounded-full bg-warn" />
                  : <span className="size-2 rounded-full bg-control" />}
              </span>
              <span className="min-w-0">
                <span className={cx("font-medium", status === "waiting" ? "text-muted" : "text-ink")}>{t(STEP_LABELS[id])}</span>
                {step && <span className={cx("block", status === "failed" ? "text-warn" : "text-muted")}>
                  {provisionText(step.message, tr)}{step.progress && status === "running" ? ` (${t("{done} of {total}", { done: step.progress.done, total: step.progress.total })})` : ""}
                </span>}
              </span>
            </li>
          );
        })}
      </ul>
      {details.length > 0 && (
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer">{t("Technical detail")}</summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-small bg-control p-3 font-mono text-[11px] whitespace-pre-wrap">{details.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}

/** What went wrong, in one sentence, with the technical detail folded away and a Retry button. */
export function FailureNote({ failure, onRetry, busy }: { failure: RunFailure; onRetry?: () => void; busy?: boolean }) {
  const tr = useT();
  const { t } = tr;
  return (
    <ErrorNote title={t("This step didn't finish")} className="mb-0">
      <p>{provisionText(failure.message, tr)}</p>
      {failure.detail && (
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer">{t("Technical detail")}</summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-small bg-control p-3 font-mono text-[11px] whitespace-pre-wrap">{failure.detail}</pre>
        </details>
      )}
      {onRetry && <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={onRetry} disabled={busy}>{t("Retry")}</Button>}
    </ErrorNote>
  );
}

/** Posts JSON to a setup route and answers with the data, or with the route's own error sentence. */
export async function postJson<T>(url: string, body: unknown): Promise<{ data: T | null; error: RunFailure | null }> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await response.json().catch(() => null)) as (T & { error?: string; detail?: string; code?: string }) | null;
    if (!response.ok) return { data: null, error: { message: data?.error ?? m("That didn't work. Try again."), detail: data?.detail, code: data?.code } };
    return { data, error: null };
  } catch {
    return { data: null, error: { message: m("Couldn't reach the app. Check that it is still running, then try again.") } };
  }
}
