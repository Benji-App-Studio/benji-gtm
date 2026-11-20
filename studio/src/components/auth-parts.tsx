"use client";
// Pieces the sign-in screens share: what each Supabase refusal means in plain words (with the way
// forward), the "Continue with Google" button, the "or" line, and a countdown for "Resend email".
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { classifyAuthError, confirmUrl, FORGOT_PASSWORD_PATH, type AuthProblem } from "@/lib/auth/flows";
import { GSI_LOCALE, GSI_SCRIPT, googleFinishUrl, googleNonce, gsiTheme, gsiWidth } from "@/lib/auth/google-id";
import { useT } from "@/lib/i18n/client";
import { createClient } from "@/lib/supabase/client";
import { buttonClass, cx, Spinner } from "./ui";

const link = "rounded-xs font-medium text-accent hover:underline";

/** The message for a refusal, under the form. `seconds` is the wait Supabase asked for, when it said. */
export function ProblemNote({ problem, seconds, google = false, className }: { problem: AuthProblem; seconds?: number | null; google?: boolean; className?: string }) {
  const { t } = useT();
  let body: React.ReactNode;
  switch (problem) {
    case "invalid_credentials":
      body = <>{t("That email and password don't match. Check both and try again.")}{google && <> {t("If you signed up with Google, use Continue with Google instead.")}</>}{" "}<Link href={FORGOT_PASSWORD_PATH} className={link}>{t("Reset your password")}</Link></>;
      break;
    case "email_not_confirmed": body = t("Confirm your email first: open the link we sent you. No email? Send a new one below."); break;
    case "rate_limited": body = seconds ? t("Too many tries. Try again in {seconds} seconds.", { seconds }) : t("Too many tries. Wait a minute, then try again."); break;
    case "weak_password": body = t("Choose a stronger password: at least 8 characters, and not one that's easy to guess."); break;
    case "same_password": body = t("That's your current password. Choose a new one."); break;
    case "email_exists":
      body = <>{t("There's already an account with this email.")}{" "}<Link href="/login" className={link}>{t("Log in")}</Link>{" · "}<Link href={FORGOT_PASSWORD_PATH} className={link}>{t("Reset your password")}</Link></>;
      break;
    case "link_expired": body = t("That link has expired, was already used, or was opened in a different browser."); break;
    case "signup_disabled": body = t("New accounts aren't being accepted right now."); break;
    case "invalid_email": body = t("Check your email address: it doesn't look complete."); break;
    case "email_rejected": body = t("This email address can't be used. Use another address."); break;
    case "email_send_failed": body = t("We couldn't send the email just now. Try again in a few minutes."); break;
    case "provider_disabled": body = t("That way of signing in is switched off right now. Use your email and password."); break;
    case "session_missing":
      body = <>{t("Your reset link has expired.")}{" "}<Link href={FORGOT_PASSWORD_PATH} className={link}>{t("Get a new link")}</Link></>;
      break;
    case "captcha": body = t("Complete the security check above, then try again."); break;
    case "network": body = t("That didn't go through. Check your connection and try again."); break;
    default: body = t("Something went wrong. Try again in a moment.");
  }
  return <p role="alert" className={cx("text-sm text-warn", className)}>{body}</p>;
}

/** Google's "G", in Google's own colours (its sign-in guidelines ask for the mark as it is). */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="size-4">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * "Continue with Google". With a Google client ID (GOOGLE_CLIENT_ID on the deployment) it is Google's own
 * button: Google's window opens on this site and names it, then Supabase checks Google's token and the
 * browser goes through /auth/finish to `next` (lib/auth/google-id.ts). Without one, or when Google's
 * script can't load, it is the redirect flow: off to Google, back through /auth/confirm to `next`.
 */
export function GoogleButton({ next, clientId = null, onProblem }: { next: string; clientId?: string | null; onProblem: (problem: AuthProblem) => void }) {
  const [fallback, setFallback] = useState(false);
  if (clientId && !fallback) return <GoogleIdButton clientId={clientId} next={next} onProblem={onProblem} onUnavailable={() => setFallback(true)} />;
  return <GoogleRedirectButton next={next} onProblem={onProblem} />;
}

function GoogleRedirectButton({ next, onProblem }: { next: string; onProblem: (problem: AuthProblem) => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const { error } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: confirmUrl(location.origin, next, "google") } });
      // On success the browser is already leaving for Google; the button stays busy until then.
      if (error) { setBusy(false); onProblem(error.code === "provider_disabled" || /provider is not enabled/i.test(error.message) ? "provider_disabled" : "unknown"); }
    } catch {
      setBusy(false);
      onProblem("network");
    }
  }
  return (
    <button type="button" onClick={go} disabled={busy} className={cx(buttonClass("secondary"), "h-8 w-full [&_svg]:size-4")}>
      {busy ? <Spinner className="size-3.5" /> : <GoogleMark />}{t("Continue with Google")}
    </button>
  );
}

/** The part of Google Identity Services this uses (loaded from accounts.google.com/gsi/client). */
interface GsiIdApi {
  initialize: (config: { client_id: string; callback: (response: { credential?: string }) => void; nonce: string; ux_mode: "popup"; context: "signin" | "signup"; itp_support: boolean }) => void;
  renderButton: (parent: HTMLElement, options: { type: "standard"; theme: string; size: "medium"; text: "continue_with"; shape: "rectangular"; logo_alignment: "center"; width: number; locale: string }) => void;
}
declare global { interface Window { google?: { accounts?: { id?: GsiIdApi } } } }

let gsiLoading: Promise<GsiIdApi> | null = null;
/** Loads Google's script once per page; rejects when it can't be reached (blocked, offline). */
function loadGsi(): Promise<GsiIdApi> {
  const ready = () => window.google?.accounts?.id;
  const loaded = ready();
  if (loaded) return Promise.resolve(loaded);
  gsiLoading ??= new Promise<GsiIdApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GSI_SCRIPT;
    script.async = true;
    const timer = window.setTimeout(() => reject(new Error("timeout")), 8000);
    script.onload = () => { window.clearTimeout(timer); const api = ready(); if (api) resolve(api); else reject(new Error("no api")); };
    script.onerror = () => { window.clearTimeout(timer); reject(new Error("load")); };
    document.head.appendChild(script);
  }).catch((error: unknown) => { gsiLoading = null; throw error; });
  return gsiLoading;
}

function GoogleIdButton({ clientId, next, onProblem, onUnavailable }: { clientId: string; next: string; onProblem: (problem: AuthProblem) => void; onUnavailable: () => void }) {
  const { t, locale } = useT();
  const slot = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  // The latest callbacks, so Google's button (set up once) always calls the current ones.
  const latest = useRef({ next, onProblem, onUnavailable });
  useEffect(() => { latest.current = { next, onProblem, onUnavailable }; });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [api, nonce] = await Promise.all([loadGsi(), googleNonce()]);
        const parent = slot.current;
        if (cancelled || !parent) return;
        api.initialize({
          client_id: clientId, nonce: nonce.hashed, ux_mode: "popup", context: "signin", itp_support: true,
          callback: async ({ credential }) => {
            if (!credential) { latest.current.onProblem("unknown"); return; }
            setBusy(true);
            try {
              const { error } = await createClient().auth.signInWithIdToken({ provider: "google", token: credential, nonce: nonce.raw });
              if (error) { setBusy(false); latest.current.onProblem(classifyAuthError(error)); return; }
              window.location.assign(googleFinishUrl(latest.current.next));
            } catch {
              setBusy(false);
              latest.current.onProblem("network");
            }
          },
        });
        const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
        parent.replaceChildren();
        api.renderButton(parent, {
          type: "standard", size: "medium", text: "continue_with", shape: "rectangular", logo_alignment: "center",
          theme: gsiTheme(document.documentElement.dataset["theme"], dark), width: gsiWidth(parent.clientWidth), locale: GSI_LOCALE[locale],
        });
      } catch {
        if (!cancelled) latest.current.onUnavailable();
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, locale]);

  // Our own button is what people see; Google's button sits over it, invisible, so the click is Google's
  // (its window opens on this site). Hover and keyboard focus are shown through the wrapper.
  return (
    <div className="group relative h-8 w-full">
      <div aria-hidden className={cx(buttonClass("secondary"), "pointer-events-none h-8 w-full [&_svg]:size-4 group-hover:bg-hover group-focus-within:ring-2 group-focus-within:ring-focus/30")}>
        {busy ? <Spinner className="size-3.5" /> : <GoogleMark />}{t("Continue with Google")}
      </div>
      {/* Google's frame is a light page: keeping its colour scheme stops the browser painting a box behind it. */}
      <div ref={slot} className={cx("absolute inset-0 overflow-hidden rounded-control opacity-0 [color-scheme:light]", busy && "pointer-events-none")} />
    </div>
  );
}

/** The quiet line between Google and the email form. */
export function OrDivider() {
  const { t } = useT();
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-muted" role="separator">
      <span className="h-px flex-1 bg-line" />{t("or")}<span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** A countdown in seconds: `start(60)` and `left` counts down to 0. */
export function useCooldown(): { left: number; start: (seconds: number) => void } {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (until <= now) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [until, now]);
  return {
    left: Math.max(0, Math.ceil((until - now) / 1000)),
    start: (seconds) => { const at = Date.now(); setNow(at); setUntil(at + seconds * 1000); },
  };
}
