"use client";
// Pieces the account screens share: a password field with Show/Hide, the "Your sign-in details" box shown
// once after a password is chosen.
import { useId, useState, type ComponentProps } from "react";
import { useT } from "@/lib/i18n/client";
import { IconCheck, IconCopy, IconEye, IconEyeOff } from "./icons";
import { Button, cx, inputClass } from "./ui";

/** A password input with a Show/Hide button inside it. */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const { t } = useT();
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block">
      <input {...props} type={shown ? "text" : "password"} className={cx(inputClass, "pr-16", className)} spellCheck={false} />
      <button type="button" onClick={() => setShown((value) => !value)} aria-pressed={shown} aria-label={shown ? t("Hide password") : t("Show password")}
        className="absolute inset-y-0 right-1 my-auto flex h-[22px] items-center gap-1 rounded-sm px-1.5 text-xs font-medium text-muted hover:bg-hover hover:text-ink">
        {shown ? <IconEyeOff className="size-3.5" /> : <IconEye className="size-3.5" />}{shown ? t("Hide") : t("Show")}
      </button>
    </span>
  );
}

/**
 * The email and password just chosen, shown once, with a Copy button. This and the matching box after a
 * reset or a change are the only places a password is ever shown.
 */
export function SignInDetails({ email, password }: { email: string; password: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const titleId = useId();
  async function copy() {
    try { await navigator.clipboard.writeText(`${t("Email")}: ${email}\n${t("Password")}: ${password}`); setCopied("yes"); } catch { setCopied("no"); }
  }
  return (
    <section aria-labelledby={titleId} className="rounded-card border border-line bg-card p-4">
      <h3 id={titleId} className="text-sm font-medium text-ink">{t("Your sign-in details")}</h3>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-xs leading-5 text-muted">{t("Email")}</dt><dd className="font-mono [overflow-wrap:anywhere] text-ink">{email}</dd>
        <dt className="text-xs leading-5 text-muted">{t("Password")}</dt><dd className="font-mono [overflow-wrap:anywhere] text-ink">{password}</dd>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={copy}>{copied === "yes" ? <IconCheck /> : <IconCopy />}{copied === "yes" ? t("Copied") : t("Copy")}</Button>
        {copied === "no" && <span className="text-xs text-warn">{t("Copying didn't work here. Select the text and copy it, or write it down.")}</span>}
      </div>
      <p className="mt-3 text-xs text-muted">{t("Save these somewhere safe, like your notes or a password manager. You won't need them on this computer, because the app signs you in by itself.")}</p>
    </section>
  );
}
