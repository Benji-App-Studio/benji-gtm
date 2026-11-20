"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { classifyAuthError, confirmUrl, FORGOT_PASSWORD_PATH, loginError, loginNext, looksLikeEmail, RESEND_COOLDOWN, retryAfterSeconds, signUpOutcome, type AuthErrorLike, type AuthProblem } from "@/lib/auth/flows";
import { APP_NAME } from "@/lib/brand-config";
import { useT } from "@/lib/i18n/client";
import { withCaptcha, type CaptchaConfig } from "@/lib/install/captcha";
import { createClient } from "@/lib/supabase/client";
import { Captcha } from "./captcha";
import { GoogleButton, OrDivider, ProblemNote, useCooldown } from "./auth-parts";
import { rich } from "./rich";
import { Button, buttonClass, cx, Field, inputClass, Spinner } from "./ui";

const linkClass = "rounded-xs font-medium text-accent hover:underline";

/** A refusal to show: what it means, and how long to wait when Supabase said. */
type Shown = { problem: AuthProblem; seconds: number | null } | null;
const shown = (error: AuthErrorLike): Shown => ({ problem: classifyAuthError(error), seconds: retryAfterSeconds(error) });

/**
 * Sign up or log in with email and password, or with Google (`google`: the project has it switched on
 * and this install takes new accounts, see showGoogle). The link from Log in to Sign up shows only when
 * the page says sign-up is open (`signupOpen`). `forgot` is the "Forgot your password?" link: the email
 * reset online, null where the page shows its own help. `initialEmail` is the address typed on the
 * landing page; `refusesSignups` says the Supabase project itself takes no new accounts.
 */
export function AuthForm({ mode, signupOpen = false, google = false, googleClientId = null, forgot = FORGOT_PASSWORD_PATH, initialEmail = "", refusesSignups = false, captcha = null }: {
  mode: "login" | "signup"; signupOpen?: boolean; google?: boolean;
  /** Google's own sign-in button when set (lib/server/auth-providers.ts googleClientId); else the redirect flow. */
  googleClientId?: string | null;
  forgot?: string | null; initialEmail?: string; refusesSignups?: boolean;
  /** The deployment's CAPTCHA (lib/install/captcha.ts captchaConfig, read by the server page); null shows none. */
  captcha?: CaptchaConfig | null;
}) {
  const { t, locale } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Shown>(null);
  /** A link or Google sign-in that didn't work lands on /login with ?error= (see confirmFailureTarget). */
  const [linkError] = useState(() => (mode === "login" ? loginError(params.get("error")) : null));
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState<"sent" | Shown>(null);
  const cooldown = useCooldown();
  const next = mode === "signup" ? "/onboarding" : loginNext(params.get("next"));
  // The CAPTCHA's token (one try each), and a counter that asks it for a fresh one.
  const [token, setToken] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const used = () => { setTries((n) => n + 1); setToken(null); };

  async function resend(to: string) {
    setResent(null);
    try {
      if (captcha && !token) return setResent({ problem: "captcha", seconds: null });
      const { error } = await createClient().auth.resend({ type: "signup", email: to, options: withCaptcha({ emailRedirectTo: confirmUrl(location.origin, "/onboarding") }, token) });
      used();
      if (error) {
        const wait = retryAfterSeconds(error);
        if (wait) cooldown.start(wait);
        return setResent(shown(error));
      }
      cooldown.start(RESEND_COOLDOWN);
      setResent("sent");
    } catch {
      setResent({ problem: "network", seconds: null });
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!looksLikeEmail(email)) return setProblem({ problem: "invalid_email", seconds: null });
    if (mode === "signup" && password.length < 8) return setProblem({ problem: "weak_password", seconds: null });
    if (!password) return setProblem({ problem: "invalid_credentials", seconds: null });
    if (captcha && !token) return setProblem({ problem: "captcha", seconds: null });
    setBusy(true); setProblem(null); setResent(null);
    try {
      const supabase = createClient();
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password,
          // locale: the sign-in emails (confirm, reset, magic link) are written in it (release/docs/email-templates).
          options: withCaptcha({ data: { full_name: name.trim(), locale }, emailRedirectTo: confirmUrl(location.origin, "/onboarding") }, token),
        });
        used();
        if (error) return setProblem(shown(error));
        // With email confirmation on, there's no session until the link is clicked. An address that already
        // has an account gets the same screen, so the form never tells anyone which addresses exist.
        if (signUpOutcome(data) === "confirm") { cooldown.start(RESEND_COOLDOWN); return setSentTo(email.trim()); }
        router.replace("/onboarding");
        router.refresh();
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password, options: withCaptcha(undefined, token) });
      used();
      if (error) return setProblem(shown(error));
      router.replace(next);
      router.refresh();
    } catch {
      setProblem({ problem: "network", seconds: null });
    } finally {
      setBusy(false);
    }
  }

  const resendNote = resent === "sent"
    ? <p role="status" className="text-sm text-win">{t("Sent again. It can take a minute to arrive.")}</p>
    : resent && <ProblemNote problem={resent.problem} seconds={resent.seconds} />;

  if (sentTo) {
    return (
      <div className="text-center">
        <h1 className="text-display font-semibold">{t("Check your inbox")}</h1>
        <p className="mt-2 text-sm text-muted">{t("We sent a confirmation link to {email}. Open it to finish signing up.", { email: sentTo })}</p>
        <p className="mt-4 text-sm text-muted">{t("No email after a minute? Check your spam folder, or send it again. Already have an account with this email? Log in instead.")}</p>
        <div className="mt-6 grid gap-3">
          <Captcha config={captcha} onToken={setToken} reset={tries} />
          <Button type="button" variant="secondary" className="h-8 w-full" disabled={cooldown.left > 0} onClick={() => resend(sentTo)}>
            {cooldown.left > 0 ? t("Resend email in {seconds}s", { seconds: cooldown.left }) : t("Resend email")}
          </Button>
          {resendNote}
        </div>
        <p className="mt-8 text-sm text-muted">
          <button type="button" className={linkClass} onClick={() => { setSentTo(null); setResent(null); setPassword(""); }}>{t("Use a different email")}</button>
          {" · "}<Link href="/login" className={linkClass}>{t("Log in")}</Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-center text-display font-semibold">{mode === "signup" ? t("Create your account") : t("Log in to {app}", { app: APP_NAME })}</h1>
      {mode === "signup" && <p className="mt-1 text-center text-sm text-muted">{t("Next, three short steps set up your first app.")}</p>}
      {linkError && (
        <p role="alert" className="mt-4 text-center text-sm text-warn">
          {linkError === "oauth" ? t("Google sign-in didn't finish. Try again, or use your email and password.")
            : linkError === "signup_disabled" ? t("This workspace doesn't take new sign-ups. Ask its owner to add you.")
            : linkError === "confirm" ? t("That link has expired or was already used. If you already confirmed your email, just log in.")
            : t("Signing in didn't work. Try again.")}
        </p>
      )}
      {mode === "signup" && refusesSignups && <ProblemNote problem="signup_disabled" className="mt-4 text-center" />}
      <div className="mt-8">
        {google && <><GoogleButton next={next} clientId={googleClientId} onProblem={(p) => setProblem({ problem: p, seconds: null })} /><OrDivider /></>}
        <form onSubmit={submit} className="grid gap-3.5" noValidate>
          {mode === "signup" && <Field label={t("Your name")}><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></Field>}
          <Field label={t("Email")}><input className={inputClass} type="email" value={email} onChange={(e) => { setEmail(e.target.value); setProblem(null); }} autoComplete="email" required /></Field>
          <Field label={t("Password")} hint={mode === "signup" ? t("At least 8 characters.") : undefined}>
            <input className={inputClass} type="password" value={password} onChange={(e) => { setPassword(e.target.value); setProblem(null); }} minLength={mode === "signup" ? 8 : undefined}
              autoComplete={mode === "signup" ? "new-password" : "current-password"} required />
          </Field>
          {mode === "login" && forgot && <p className="-mt-1.5 text-right text-xs"><Link href={forgot} className={linkClass}>{t("Forgot your password?")}</Link></p>}
          <Captcha config={captcha} onToken={setToken} reset={tries} />
          {problem && <ProblemNote problem={problem.problem} seconds={problem.seconds} google={google} />}
          {problem?.problem === "email_not_confirmed" && (
            <div className="grid gap-2">
              <Button type="button" variant="secondary" className="w-full" disabled={cooldown.left > 0} onClick={() => resend(email.trim())}>
                {cooldown.left > 0 ? t("Resend email in {seconds}s", { seconds: cooldown.left }) : t("Resend confirmation email")}
              </Button>
              {resendNote}
            </div>
          )}
          <Button type="submit" disabled={busy} className="mt-2 h-8 w-full">{busy && <Spinner className="size-3.5" />}{mode === "signup" ? t("Sign up") : t("Log in")}</Button>
          {mode === "signup" && (
            <p className="text-center text-xs text-muted">
              {rich(t("By creating an account you agree to the {terms} and the {privacy}."), {
                terms: <Link href="/terms" target="_blank" className={linkClass}>{t("Terms of Service")}</Link>,
                privacy: <Link href="/privacy" target="_blank" className={linkClass}>{t("Privacy Policy")}</Link>,
              })}
            </p>
          )}
        </form>
      </div>
      {mode === "signup"
        ? <p className="mt-8 text-center text-sm text-muted">{t("Already have an account?")} <Link href="/login" className={linkClass}>{t("Log in")}</Link></p>
        : signupOpen && <p className="mt-8 text-center text-sm text-muted">{t("No account yet?")} <Link href="/signup" className={linkClass}>{t("Sign up")}</Link></p>}
    </div>
  );
}

/** The address's # part changes without a page load when another invite link is opened in the same tab. */
const onHashChange = (notify: () => void) => {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
};

/**
 * Where an invite link from Settings > Members lands (/invite#token=…&type=invite): the person chooses a
 * password, which checks the one-time token, signs them in and saves the password. The token is used only
 * when the form is sent, so a chat app that previews the link doesn't use it up.
 */
export function InviteForm() {
  // The part after # is known only in the browser; the server renders the form without it. Another link
  // opened in the same tab starts the form again.
  const hash = useSyncExternalStore(onHashChange, () => window.location.hash, () => null);
  return <InviteFields key={hash ?? ""} hash={hash} />;
}

function InviteFields({ hash }: { hash: string | null }) {
  const { t } = useT();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Shown>(null);
  /** The token is good for one check: once it has passed, a second try only saves the password. */
  const [signedIn, setSignedIn] = useState(false);
  const [expired, setExpired] = useState(false);

  const fields = new URLSearchParams((hash ?? "").replace(/^#/, ""));
  const token = fields.get("token");
  const type = fields.get("type") === "recovery" ? "recovery" : "invite";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    if (password.length < 8) return setProblem({ problem: "weak_password", seconds: null });
    setBusy(true); setProblem(null);
    try {
      const supabase = createClient();
      if (!signedIn) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: token, type });
        if (error) return setExpired(true);
        setSignedIn(true);
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return setProblem(shown(error));
      router.replace("/app/w");
      router.refresh();
    } catch {
      setProblem({ problem: "network", seconds: null });
    } finally {
      setBusy(false);
    }
  }

  // Before the browser has read the part after # (the server's render, the first paint): neither the
  // password form nor the message yet, so /invite without a token never shows a form that can't work.
  if (hash === null) {
    return <p className="flex justify-center py-10 text-muted" role="status" aria-label={t("Checking your link…")}><Spinner className="size-4" /></p>;
  }

  if (expired || !token) {
    return (
      <div className="text-center">
        <h1 className="text-display font-semibold">{expired ? t("This link no longer works") : t("This link is invalid or has expired")}</h1>
        <p className="mt-2 text-sm text-muted">{expired
          ? t("It has expired or was already used. Ask the person who invited you to add you again: that makes a new link.")
          : t("Open the whole link from your invitation email again, or ask the person who invited you for a new one.")}</p>
        <Link href="/login" className={cx(buttonClass("primary"), "mt-6 h-8 w-full")}>{t("Log in")}</Link>
        <p className="mt-3 text-sm text-muted">{t("Already chose a password? Log in with your email and password.")}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-center text-display font-semibold">{t("Choose your password")}</h1>
      <p className="mt-1 text-center text-sm text-muted">{t("You were invited to {app}. From now on you log in with your email and this password.", { app: APP_NAME })}</p>
      <form onSubmit={submit} className="mt-8 grid gap-3.5" noValidate>
        <Field label={t("Password")} hint={t("At least 8 characters.")}>
          <input className={inputClass} type="password" value={password} onChange={(e) => { setPassword(e.target.value); setProblem(null); }} minLength={8} autoComplete="new-password" required disabled={busy} />
        </Field>
        {problem && <ProblemNote problem={problem.problem} seconds={problem.seconds} />}
        <Button type="submit" disabled={busy || hash === null} className="mt-2 h-8 w-full">{busy && <Spinner className="size-3.5" />}{t("Save and open {app}", { app: APP_NAME })}</Button>
      </form>
    </div>
  );
}
