"use client";
// Pieces the account screens share: a password field with Show/Hide, the "Your sign-in details" box shown
// once after a password is chosen, and the "Forgot your password?" help for an online copy.
import { useId, useState, type ComponentProps } from "react";
import { IconCheck, IconCopy, IconEye, IconEyeOff } from "./icons";
import { Button, cx, inputClass } from "./ui";

/** A password input with a Show/Hide button inside it. */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block">
      <input {...props} type={shown ? "text" : "password"} className={cx(inputClass, "pr-16", className)} spellCheck={false} />
      <button type="button" onClick={() => setShown((value) => !value)} aria-pressed={shown} aria-label={shown ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-1 my-auto flex h-[22px] items-center gap-1 rounded-sm px-1.5 text-xs font-medium text-muted hover:bg-hover hover:text-ink">
        {shown ? <IconEyeOff className="size-3.5" /> : <IconEye className="size-3.5" />}{shown ? "Hide" : "Show"}
      </button>
    </span>
  );
}

/**
 * The email and password just chosen, shown once, with a Copy button. This and the matching box after a
 * reset or a change are the only places a password is ever shown.
 */
export function SignInDetails({ email, password }: { email: string; password: string }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const titleId = useId();
  async function copy() {
    try { await navigator.clipboard.writeText(`Email: ${email}\nPassword: ${password}`); setCopied("yes"); } catch { setCopied("no"); }
  }
  return (
    <section aria-labelledby={titleId} className="rounded-card border border-line bg-card p-4">
      <h3 id={titleId} className="text-sm font-medium text-ink">Your sign-in details</h3>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-xs leading-5 text-muted">Email</dt><dd className="font-mono [overflow-wrap:anywhere] text-ink">{email}</dd>
        <dt className="text-xs leading-5 text-muted">Password</dt><dd className="font-mono [overflow-wrap:anywhere] text-ink">{password}</dd>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={copy}>{copied === "yes" ? <IconCheck /> : <IconCopy />}{copied === "yes" ? "Copied" : "Copy"}</Button>
        {copied === "no" && <span className="text-xs text-warn">Copying didn&apos;t work here. Select the text and copy it, or write it down.</span>}
      </div>
      <p className="mt-3 text-xs text-muted">Save these somewhere safe, like your notes or a password manager. You won&apos;t need them on this computer, because the app signs you in by itself.</p>
    </section>
  );
}

/** "Forgot your password?" on an online copy: two plain steps, no email needed. */
export function OnlineForgotHelp() {
  return (
    <details className="mt-8 text-sm text-muted">
      <summary className="cursor-pointer rounded-xs text-center font-medium text-accent">Forgot your password?</summary>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-label">
        <li>Open the app on your Mac, the one where you set it up. It signs you in by itself.</li>
        <li>Go to <b>Settings &gt; Account</b> and change your password there. Then sign in here with the new one.</li>
      </ol>
      <p className="mt-3">If that Mac isn&apos;t available, reset it from the app on any Mac where you copied your code: start the app there and follow its setup page. It connects your project again and lets you choose a new password with a Supabase access token. No email is needed.</p>
    </details>
  );
}
