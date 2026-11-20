"use client";
// The login page on a copy in local mode. The app normally signs its owner in by itself there; this
// shows only when it couldn't, says why, and always offers a way forward:
//   no-owner     an older install with no saved sign-in: sign in once, and it is kept from then on
//   signin       the saved password no longer works (changed elsewhere, or the account was removed)
//   unreachable  the Supabase project can't be reached (paused, or no internet)
//   captcha      the project has Supabase's CAPTCHA protection on, which blocks this copy's own sign-in
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { projectDashboard } from "@/app/setup/parts";
import { useT } from "@/lib/i18n/client";
import type { LoginReason } from "@/lib/install/local-auth";
import { PasswordInput } from "./account-pieces";
import { Button, buttonClass, Field, inputClass, Spinner } from "./ui";

export function LocalLogin({ reason, next, projectRef }: { reason: LoginReason; next: string | null; projectRef: string | null }) {
  const { t } = useT();
  const target = next ?? "/app";
  const reset = `/reset-password${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unreachable, setUnreachable] = useState(reason === "unreachable");
  const [captcha, setCaptcha] = useState(reason === "captcha");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/local/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; reason?: string } | null;
      if (response.ok && data?.ok) { window.location.assign(target); return; }
      if (data?.reason === "unreachable") { setUnreachable(true); return; }
      if (data?.reason === "captcha") { setCaptcha(true); return; }
      setError(data?.error ?? t("That didn't go through. Try again."));
    } catch {
      setError(t("Couldn't reach the app. Check that it is still running, then try again."));
    } finally {
      setBusy(false);
    }
  }

  if (captcha) {
    return (
      <div>
        <h1 className="text-center text-display font-semibold">{t("Turn off CAPTCHA for this project")}</h1>
        <p className="mt-2 text-sm text-muted">{t("This copy signs you in by itself on this computer, and Supabase's CAPTCHA protection blocks that. CAPTCHA is for a public sign-up page. In your Supabase dashboard, open Authentication, then Attack Protection, turn CAPTCHA protection off and save.")}</p>
        <div className="mt-6 grid gap-2">
          <a href={projectDashboard(projectRef)} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>{t("Open your Supabase dashboard")}</a>
          <Button type="button" onClick={() => window.location.assign(target)}>{t("Try again")}</Button>
        </div>
      </div>
    );
  }

  if (unreachable) {
    return (
      <div>
        <h1 className="text-center text-display font-semibold">{t("Can't reach your Supabase project")}</h1>
        <p className="mt-2 text-sm text-muted">{t("The app couldn't connect to your project to sign you in. Supabase can pause a free project. Open your Supabase dashboard: if the project says it is paused, press Resume project and wait until it is running again. Also check that this computer is online.")}</p>
        <div className="mt-6 grid gap-2">
          <a href={projectDashboard(projectRef)} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>{t("Open your Supabase dashboard")}</a>
          <Button type="button" onClick={() => window.location.assign(target)}>{t("Try again")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-center text-display font-semibold">{reason === "signin" ? t("Sign in again") : t("Sign in once on this computer")}</h1>
      <p className="mt-1 text-center text-sm text-muted">
        {reason === "signin"
          ? t("The app couldn't sign you in by itself: your password may have been changed somewhere else, or your account was removed. Sign in with your current password, or press Forgot your password.")
          : t("Type the email and password of your account. From then on, the app signs you in automatically on this computer.")}
      </p>
      <form onSubmit={submit} className="mt-8 grid gap-3.5">
        <Field label={t("Email")}><input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></Field>
        <Field label={t("Password")}><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
        {error && <p role="alert" className="text-sm text-warn">{error}</p>}
        <Button type="submit" disabled={busy} className="mt-2 h-8 w-full">{busy && <Spinner className="size-3.5" />}{t("Sign in")}</Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        <Link href={reset} className="rounded-xs font-medium text-accent hover:underline">{t("Forgot your password?")}</Link>
        {" "}{t("You can choose a new one here, without email.")}
      </p>
    </div>
  );
}
