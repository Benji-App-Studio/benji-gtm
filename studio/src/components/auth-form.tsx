"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { APP_NAME } from "@/lib/brand-config";
import { createClient } from "@/lib/supabase/client";
import { Button, Field, inputClass, Spinner } from "./ui";

/** Supabase's sign-in refusals, in the app's own words. Anything else is shown as Supabase wrote it. */
const SIGN_IN_ERRORS: Record<string, string> = {
  "Email not confirmed": "Confirm your email first: check your inbox for the link.",
  "Invalid login credentials": "That email and password don't match. Check both and try again.",
};

/**
 * Sign up or log in with email and password (Supabase Auth). The link from Log in to Sign up shows only
 * when the page says sign-up is open (`signupOpen`); it is closed unless told otherwise, because on a
 * set-up install the owner adds people from Settings.
 */
export function AuthForm({ mode, signupOpen = false }: { mode: "login" | "signup"; signupOpen?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // A link that didn't work (an expired or used confirmation or invite) lands here with ?error=confirm.
  const [error, setError] = useState(() => (mode === "login" && params.get("error") === "confirm" ? "That link has expired or was already used. Log in, or ask for a new link." : ""));
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const supabase = createClient();
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: name.trim() }, emailRedirectTo: `${location.origin}/auth/confirm?next=/onboarding` },
        });
        if (error) return setError(error.message);
        // With email confirmation on, there's no session until the link is clicked.
        if (!data.session) return setSent(true);
        router.replace("/onboarding");
        router.refresh();
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return setError(SIGN_IN_ERRORS[error.message] ?? error.message);
      router.replace(params.get("next") || "/app/w");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <h1 className="text-display font-semibold">Check your inbox</h1>
        <p className="mt-2 text-sm text-muted">We sent a confirmation link to <b className="font-medium text-ink">{email}</b>. Open it to finish signing up.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-center text-display font-semibold">{mode === "signup" ? "Create your account" : `Log in to ${APP_NAME}`}</h1>
      {mode === "signup" && <p className="mt-1 text-center text-sm text-muted">Next you describe your product, which takes about two minutes.</p>}
      <form onSubmit={submit} className="mt-8 grid gap-3.5">
        {mode === "signup" && <Field label="Your name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></Field>}
        <Field label="Email"><input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></Field>
        <Field label="Password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
          <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={mode === "signup" ? 8 : undefined}
            autoComplete={mode === "signup" ? "new-password" : "current-password"} required />
        </Field>
        {error && <p role="alert" className="text-sm text-warn">{error}</p>}
        <Button type="submit" disabled={busy} className="mt-2 h-8 w-full">{busy && <Spinner className="size-3.5" />}{mode === "signup" ? "Sign up" : "Log in"}</Button>
      </form>
      {mode === "signup"
        ? <p className="mt-8 text-center text-sm text-muted">Already have an account? <Link href="/login" className="rounded-xs font-medium text-accent hover:underline">Log in</Link></p>
        : signupOpen && <p className="mt-8 text-center text-sm text-muted">No account yet? <Link href="/signup" className="rounded-xs font-medium text-accent hover:underline">Sign up</Link></p>}
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
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** The token is good for one check: once it has passed, a second try only saves the password. */
  const [signedIn, setSignedIn] = useState(false);
  const [expired, setExpired] = useState(false);

  const fields = new URLSearchParams((hash ?? "").replace(/^#/, ""));
  const token = fields.get("token");
  const type = fields.get("type") === "recovery" ? "recovery" : "invite";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    setBusy(true); setError("");
    try {
      const supabase = createClient();
      if (!signedIn) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: token, type });
        if (error) return setExpired(true);
        setSignedIn(true);
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return setError(error.message);
      router.replace("/app/w");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (expired || (hash !== null && !token)) {
    return (
      <div className="text-center">
        <h1 className="text-display font-semibold">{expired ? "This link no longer works" : "This link is incomplete"}</h1>
        <p className="mt-2 text-sm text-muted">{expired
          ? "It has expired or was already used. Ask the person who invited you to add you again: that makes a new link."
          : "Copy the whole link you were sent and open it again, or ask the person who invited you for a new one."}</p>
        <p className="mt-6 text-sm text-muted">Already chose a password? <Link href="/login" className="rounded-xs font-medium text-accent hover:underline">Log in</Link></p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-center text-display font-semibold">Choose your password</h1>
      <p className="mt-1 text-center text-sm text-muted">You were invited to {APP_NAME}. From now on you log in with your email and this password.</p>
      <form onSubmit={submit} className="mt-8 grid gap-3.5">
        <Field label="Password" hint="At least 8 characters.">
          <input className={inputClass} type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} minLength={8} autoComplete="new-password" required disabled={busy} />
        </Field>
        {error && <p role="alert" className="text-sm text-warn">{error}</p>}
        <Button type="submit" disabled={busy || hash === null} className="mt-2 h-8 w-full">{busy && <Spinner className="size-3.5" />}Save and open {APP_NAME}</Button>
      </form>
    </div>
  );
}
