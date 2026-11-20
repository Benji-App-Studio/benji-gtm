"use client";
// "Forgot your password?" on an online copy, by email: type the address, get a link, choose a new
// password, and you are signed in. (A copy run on its owner's own computer resets with a Supabase access
// token instead: reset-password-form.tsx.) Accounts made with Google can use the same link to add a password.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { classifyAuthError, confirmUrl, looksLikeEmail, RESEND_COOLDOWN, retryAfterSeconds, UPDATE_PASSWORD_PATH, type AuthProblem } from "@/lib/auth/flows";
import { APP_NAME } from "@/lib/brand-config";
import { useT } from "@/lib/i18n/client";
import { withCaptcha, type CaptchaConfig } from "@/lib/install/captcha";
import { createClient } from "@/lib/supabase/client";
import { ProblemNote, useCooldown } from "./auth-parts";
import { Captcha } from "./captcha";
import { Button, ButtonLink, Field, inputClass, Spinner } from "./ui";

const linkClass = "rounded-xs font-medium text-accent hover:underline";
type Shown = { problem: AuthProblem; seconds: number | null } | null;

export function ForgotPasswordForm({ captcha = null }: { captcha?: CaptchaConfig | null }) {
  const { t } = useT();
  const [token, setToken] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const params = useSearchParams();
  const [expired] = useState(() => params.get("error") === "expired");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Shown>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const cooldown = useCooldown();

  async function send(to: string): Promise<boolean> {
    if (captcha && !token) { setProblem({ problem: "captcha", seconds: null }); return false; }
    setBusy(true); setProblem(null);
    try {
      const { error } = await createClient().auth.resetPasswordForEmail(to, withCaptcha({ redirectTo: confirmUrl(location.origin, UPDATE_PASSWORD_PATH) }, token));
      setTries((n) => n + 1); setToken(null);
      if (error) {
        const seconds = retryAfterSeconds(error);
        if (seconds) cooldown.start(seconds);
        setProblem({ problem: classifyAuthError(error), seconds });
        return false;
      }
      cooldown.start(RESEND_COOLDOWN);
      return true;
    } catch {
      setProblem({ problem: "network", seconds: null });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const to = email.trim();
    if (!looksLikeEmail(to)) return setProblem({ problem: "invalid_email", seconds: null });
    if (await send(to)) { setSentTo(to); setAgain(false); }
  }

  if (sentTo) {
    return (
      <div className="text-center">
        <h1 className="text-display font-semibold">{t("Check your inbox")}</h1>
        <p className="mt-2 text-sm text-muted">{t("If {email} has an account, we sent it a link to choose a new password. Open it in this browser.", { email: sentTo })}</p>
        <p className="mt-4 text-sm text-muted">{t("Signed up with Google? The same link lets you add a password.")}</p>
        <div className="mt-6 grid gap-3">
          <Captcha config={captcha} onToken={setToken} reset={tries} />
          <Button type="button" variant="secondary" className="h-8 w-full" disabled={busy || cooldown.left > 0} onClick={async () => setAgain(await send(sentTo))}>
            {busy && <Spinner className="size-3.5" />}{cooldown.left > 0 ? t("Resend email in {seconds}s", { seconds: cooldown.left }) : t("Resend email")}
          </Button>
          {again && !problem && <p role="status" className="text-sm text-win">{t("Sent again. It can take a minute to arrive.")}</p>}
          {problem && <ProblemNote problem={problem.problem} seconds={problem.seconds} />}
        </div>
        <p className="mt-8 text-sm text-muted">
          <button type="button" className={linkClass} onClick={() => { setSentTo(null); setProblem(null); }}>{t("Use a different email")}</button>
          {" · "}<Link href="/login" className={linkClass}>{t("Back to log in")}</Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-center text-display font-semibold">{t("Reset your password")}</h1>
      <p className="mt-1 text-center text-sm text-muted">{t("Type the email you use for {app}. We'll send you a link to choose a new password.", { app: APP_NAME })}</p>
      {expired && <p role="alert" className="mt-4 text-center text-sm text-warn">{t("That link has expired, was already used, or was opened in a different browser. Ask for a new one below.")}</p>}
      <form onSubmit={submit} className="mt-8 grid gap-3.5" noValidate>
        <Field label={t("Email")}><input className={inputClass} type="email" value={email} onChange={(e) => { setEmail(e.target.value); setProblem(null); }} autoComplete="email" required /></Field>
        <Captcha config={captcha} onToken={setToken} reset={tries} />
        {problem && <ProblemNote problem={problem.problem} seconds={problem.seconds} />}
        <Button type="submit" disabled={busy || cooldown.left > 0} className="mt-2 h-8 w-full">
          {busy && <Spinner className="size-3.5" />}{cooldown.left > 0 ? t("Try again in {seconds}s", { seconds: cooldown.left }) : t("Send reset link")}
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted"><Link href="/login" className={linkClass}>{t("Back to log in")}</Link></p>
    </div>
  );
}

/** Where the reset link lands (signed in by /auth/confirm): choose the new password, then into the app. */
export function UpdatePasswordForm({ email }: { email: string | null }) {
  const { t } = useT();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Shown>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) return setProblem({ problem: "weak_password", seconds: null });
    setBusy(true); setProblem(null);
    try {
      const { error } = await createClient().auth.updateUser({ password });
      if (error) return setProblem({ problem: classifyAuthError(error), seconds: retryAfterSeconds(error) });
      router.replace("/app/w");
      router.refresh();
    } catch {
      setProblem({ problem: "network", seconds: null });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="text-center text-display font-semibold">{t("Choose a new password")}</h1>
      {email && <p className="mt-1 text-center text-sm text-muted">{t("For {email}. You'll stay signed in after you save it.", { email })}</p>}
      <form onSubmit={submit} className="mt-8 grid gap-3.5" noValidate>
        <Field label={t("New password")} hint={t("At least 8 characters.")}>
          <input className={inputClass} type="password" value={password} onChange={(e) => { setPassword(e.target.value); setProblem(null); }} autoComplete="new-password" minLength={8} required />
        </Field>
        {problem && <ProblemNote problem={problem.problem} seconds={problem.seconds} />}
        <Button type="submit" disabled={busy} className="mt-2 h-8 w-full">{busy && <Spinner className="size-3.5" />}{t("Save and open {app}", { app: APP_NAME })}</Button>
      </form>
    </div>
  );
}

/** The reset link was opened but there is no session: it expired, was used, or came from another browser. */
export function UpdatePasswordExpired() {
  const { t } = useT();
  return (
    <div className="text-center">
      <h1 className="text-display font-semibold">{t("This link no longer works")}</h1>
      <p className="mt-2 text-sm text-muted">{t("Reset links work once, for a limited time, in the browser where you asked for them. Ask for a new one: it only takes a moment.")}</p>
      <ButtonLink href="/forgot-password" className="mt-6 h-8 w-full">{t("Get a new link")}</ButtonLink>
      <p className="mt-6 text-sm text-muted"><Link href="/login" className={linkClass}>{t("Back to log in")}</Link></p>
    </div>
  );
}
