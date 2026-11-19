"use client";
// The login page on a copy in local mode. The app normally signs its owner in by itself there; this
// shows only when it couldn't, says why, and always offers a way forward:
//   no-owner     an older install with no saved sign-in: sign in once, and it is kept from then on
//   signin       the saved password no longer works (changed elsewhere, or the account was removed)
//   unreachable  the Supabase project can't be reached (paused, or no internet)
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { projectDashboard } from "@/app/setup/parts";
import type { LoginReason } from "@/lib/install/local-auth";
import { PasswordInput } from "./account-pieces";
import { Button, buttonClass, Field, inputClass, Spinner } from "./ui";

export function LocalLogin({ reason, next, projectRef }: { reason: LoginReason; next: string | null; projectRef: string | null }) {
  const target = next ?? "/app";
  const reset = `/reset-password${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unreachable, setUnreachable] = useState(reason === "unreachable");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/local/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; reason?: string } | null;
      if (response.ok && data?.ok) { window.location.assign(target); return; }
      if (data?.reason === "unreachable") { setUnreachable(true); return; }
      setError(data?.error ?? "That didn't go through. Try again.");
    } catch {
      setError("Couldn't reach the app. Check that it is still running, then try again.");
    } finally {
      setBusy(false);
    }
  }

  if (unreachable) {
    return (
      <div>
        <h1 className="text-center text-display font-semibold">{"Can't reach your Supabase project"}</h1>
        <p className="mt-2 text-sm text-muted">The app couldn&apos;t connect to your project to sign you in. Supabase can pause a free project. Open your Supabase dashboard: if the project says it is paused, press <b>Resume project</b> and wait until it is running again. Also check that this computer is online.</p>
        <div className="mt-6 grid gap-2">
          <a href={projectDashboard(projectRef)} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>Open your Supabase dashboard</a>
          <Button type="button" onClick={() => window.location.assign(target)}>Try again</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-center text-display font-semibold">{reason === "signin" ? "Sign in again" : "Sign in once on this computer"}</h1>
      <p className="mt-1 text-center text-sm text-muted">
        {reason === "signin"
          ? "The app couldn't sign you in by itself: your password may have been changed somewhere else, or your account was removed. Sign in with your current password, or press Forgot your password."
          : "Type the email and password of your account. From then on, the app signs you in automatically on this computer."}
      </p>
      <form onSubmit={submit} className="mt-8 grid gap-3.5">
        <Field label="Email"><input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></Field>
        <Field label="Password"><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
        {error && <p role="alert" className="text-sm text-warn">{error}</p>}
        <Button type="submit" disabled={busy} className="mt-2 h-8 w-full">{busy && <Spinner className="size-3.5" />}Sign in</Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        <Link href={reset} className="rounded-xs font-medium text-accent hover:underline">Forgot your password?</Link>
        {" "}You can choose a new one here, without email.
      </p>
    </div>
  );
}
