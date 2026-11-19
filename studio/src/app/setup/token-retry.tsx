"use client";
// When Supabase turns the access token down partway through setup (it expired, was deleted, or is
// read-only), Retry with the same token can't work, and the token field sits in the closed step 2.
// This puts a field for a new token right where the step failed, and retries with it.
import { useId, useState } from "react";
import { Button, ErrorNote, inputClass } from "@/components/ui";
import { OutLink, SUPABASE_LINKS, type RunFailure } from "./parts";

/** True when the failure is Supabase answering 401 or 403 to the access token. */
export function tokenRejected(failure: RunFailure | null | undefined): boolean {
  if (!failure) return false;
  return /^http_40[13]$/.test(failure.code ?? "") || /: HTTP 40[13]\b/.test(failure.detail ?? "");
}

export function NewTokenNote({ failure, oldToken, busy, onRetry }: { failure: RunFailure; oldToken: string; busy: boolean; onRetry: (token: string) => void }) {
  const [fresh, setFresh] = useState("");
  const id = useId();
  const usable = fresh.length > 0 && fresh !== oldToken;
  return (
    <ErrorNote title="Your access token has expired or isn't allowed" className="mb-0">
      <p>
        Create a new one in <OutLink href={SUPABASE_LINKS.tokens}>Access Tokens in Supabase</OutLink> with the <b>Full access</b> preset,
        from the account that owns the project. Paste it here and press Retry: finished steps are skipped.
      </p>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (usable && !busy) onRetry(fresh); }}>
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5">
          <label htmlFor={id} className="text-xs font-medium text-muted">New access token</label>
          <input id={id} className={inputClass} type="password" autoComplete="off" spellCheck={false} value={fresh} onChange={(event) => setFresh(event.target.value.trim())} />
        </div>
        <Button type="submit" variant="secondary" disabled={busy || !usable}>Retry</Button>
      </form>
      {fresh && fresh === oldToken && <p className="mt-2 text-xs text-muted">That&apos;s the same token. Paste the new one.</p>}
      {failure.detail && (
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer">Technical detail</summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-small bg-control p-3 font-mono text-[11px] whitespace-pre-wrap">{failure.detail}</pre>
        </details>
      )}
    </ErrorNote>
  );
}
