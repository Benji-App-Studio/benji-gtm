"use client";
// "Forgot your password?" on the computer the app runs on: paste a new Supabase access token (the same
// steps as setup), choose a new password, and the app sets it, saves it for automatic sign-in and signs
// you in. The token lives in this component's memory only and is sent once.
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { FailureNote, postJson, projectDashboard, TokenHelp, type RunFailure } from "@/app/setup/parts";
import { PasswordInput, SignInDetails } from "./account-pieces";
import { Button, buttonClass, Field, inputClass, Spinner } from "./ui";

export function ResetPasswordForm({ appName, next, projectRef }: { appName: string; next: string | null; projectRef: string | null }) {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [needAccount, setNeedAccount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RunFailure | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string; password: string; recreated: boolean } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token) return setProblem("Paste your Supabase access token first.");
    if (password.length < 8) return setProblem("Use a password with at least 8 characters.");
    if (needAccount && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setProblem("Type your email address.");
    setBusy(true); setFailure(null); setProblem(null);
    const { data, error } = await postJson<{ ok: boolean; email: string; signedIn: boolean; recreated?: boolean }>("/api/local/reset-password", { token, password, ...(needAccount ? { recreateEmail: email.trim() } : {}) });
    setBusy(false);
    if (error || !data) {
      if (error?.code === "no_account") setNeedAccount(true);
      return setFailure(error);
    }
    // The token leaves the page's memory; the new details are shown once.
    setToken("");
    setDone({ email: data.email, password, recreated: data.recreated === true });
  }

  if (done) {
    return (
      <div>
        <h1 className="text-center text-display font-semibold">{done.recreated ? "Your account is back" : "Your new password is set"}</h1>
        <p className="mt-1 text-center text-sm text-muted">You are signed in, and the app will keep signing you in on this computer.</p>
        <div className="mt-6"><SignInDetails email={done.email} password={done.password} /></div>
        <Button type="button" className="mt-6 w-full" onClick={() => window.location.assign(next ?? "/app")}>Open {appName}</Button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-center text-display font-semibold">Choose a new password</h1>
      <p className="mt-1 text-center text-sm text-muted">No email needed. You use a new Supabase access token, the same kind you used during setup.</p>
      <div className="mt-6 space-y-4">
        <TokenHelp appName={appName} action="Set my new password" />
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field label="Access token">
            <input className={inputClass} type="password" autoComplete="off" spellCheck={false} placeholder="sbp_..." value={token}
              onChange={(event) => { setToken(event.target.value.trim()); setProblem(null); }} />
          </Field>
          {needAccount && (
            <Field label="Your email" hint="Your account is created again with this email and the new password. Your workspace and its data stay as they are.">
              <input className={inputClass} type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setProblem(null); }} placeholder="you@example.com" />
            </Field>
          )}
          <Field label="New password" hint="At least 8 characters.">
            <PasswordInput autoComplete="new-password" minLength={8} value={password} onChange={(event) => { setPassword(event.target.value); setProblem(null); }} />
          </Field>
          {problem && <p role="alert" className="text-sm text-warn">{problem}</p>}
          <Button type="submit" disabled={busy} className="h-8 w-full">
            {busy ? <><Spinner className="size-3.5" />Working</> : needAccount ? "Create my account again" : "Set my new password"}
          </Button>
        </form>
        {failure && (
          <>
            <FailureNote failure={failure} />
            {failure.code === "not_ready" && <a href={projectDashboard(projectRef)} target="_blank" rel="noreferrer" className={buttonClass("secondary") + " w-full"}>Open your Supabase dashboard</a>}
          </>
        )}
        <p className="text-center text-sm"><Link href={next ?? "/app"} className="rounded-xs font-medium text-accent hover:underline">Back</Link></p>
      </div>
    </div>
  );
}
