"use client";
// Settings → Account: the signed-in person's own sign-in. Their name and email, a Change password form
// (on a local copy the password the app signs in with is updated too), and on a local copy a note on
// what changes when the app is put online.
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { APP_NAME } from "@/lib/brand-config";
import { PasswordInput, SignInDetails } from "../account-pieces";
import { Button, SettingsGroup, SettingsRow, Spinner } from "../ui";
import { api, SettingsPage, Status } from "./settings-ui";
import { UI_LOCALE } from "@/lib/ui-locale";

export interface Account { name: string | null; email: string | null; since: string | null }

export function AccountSettings({ account, local }: { account: Account; local: boolean }) {
  return (
    <SettingsPage page="account">
      <SettingsGroup title="Your account" description={local ? "Your own sign-in. On this computer the app signs you in by itself." : "Your own sign-in on this workspace."}>
        <SettingsRow label="Name"><span className="text-sm text-label">{account.name || "Not set"}</span></SettingsRow>
        <SettingsRow label="Email"><span className="text-sm [overflow-wrap:anywhere] text-label">{account.email || "Not set"}</span></SettingsRow>
        {account.since && <SettingsRow label="Member since"><span className="text-sm text-label">{new Date(account.since).toLocaleDateString(UI_LOCALE, { day: "numeric", month: "long", year: "numeric" })}</span></SettingsRow>}
        {!local && (
          <SettingsRow label="Sign out" description="Ends your session on this device.">
            <form action="/auth/signout" method="post"><Button type="submit" variant="secondary" size="sm">Sign out</Button></form>
          </SettingsRow>
        )}
      </SettingsGroup>

      <SettingsGroup title="Password" description={local ? "You need it only if you put the app online. The app on this computer keeps using the new one by itself." : undefined}>
        <ChangePassword local={local} />
        {local && (
          <SettingsRow label="Forgot your password?" description="You don't need the old one to change it above. You can also choose a new one with a Supabase access token, no email needed.">
            <Link href="/reset-password?next=/app/settings/account" className="text-sm font-medium text-accent hover:underline">Reset it</Link>
          </SettingsRow>
        )}
      </SettingsGroup>

      {local && (
        <SettingsGroup title="Use it online" description={`You can also put ${APP_NAME} online, for example on Vercel, to open it from anywhere.`}>
          <SettingsRow label="An online copy asks you to sign in" description={`Anyone with its address could reach it, so it shows a login page. Sign in there with your email${account.email ? ` (${account.email})` : ""} and your password: the one you chose during setup, or the one you set above. People you add in Members sign in there too.`} />
        </SettingsGroup>
      )}
    </SettingsPage>
  );
}

function ChangePassword({ local }: { local: boolean }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string; password: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) return setError("Use a password with at least 8 characters.");
    setBusy(true); setError(null);
    const result = await api<{ ok: boolean; email: string | null }>("/api/account/password", "POST", { password });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setDone({ email: result.data.email ?? "", password });
    setPassword("");
  }

  return (
    <SettingsRow label="Change password" description={local ? "Choose a new password. The app saves it on this computer, so it keeps signing you in." : "Choose a new password for signing in."}
      below={done ? <div className="mt-3"><SignInDetails email={done.email} password={done.password} /></div> : error ? <Status error={error} className="mt-2" /> : null}>
      <form onSubmit={submit} noValidate className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <div className="w-full sm:w-56">
          <PasswordInput aria-label="New password" autoComplete="new-password" minLength={8} required value={password} disabled={busy}
            onChange={(event) => { setPassword(event.target.value); setError(null); setDone(null); }} placeholder="At least 8 characters" />
        </div>
        <Button type="submit" size="sm" disabled={busy || !password}>{busy && <Spinner className="size-3.5" />}Save</Button>
      </form>
    </SettingsRow>
  );
}
