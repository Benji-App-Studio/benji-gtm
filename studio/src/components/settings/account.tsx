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
import { DeleteAccount, type LaunchedApp } from "./delete-account";
import { useT } from "@/lib/i18n/client";

export interface Account { name: string | null; email: string | null; since: string | null }

export function AccountSettings({ account, local, launched = [] }: { account: Account; local: boolean; launched?: LaunchedApp[] }) {
  const { t, intl } = useT();
  return (
    <SettingsPage page="account">
      <SettingsGroup title={t("Your account")} description={local ? t("Your own sign-in. On this computer the app signs you in by itself.") : t("Your own sign-in on this workspace.")}>
        <SettingsRow label={t("Name")}><span className="text-sm text-label">{account.name || t("Not set")}</span></SettingsRow>
        <SettingsRow label={t("Email")}><span className="text-sm [overflow-wrap:anywhere] text-label">{account.email || t("Not set")}</span></SettingsRow>
        {account.since && <SettingsRow label={t("Member since")}><span className="text-sm text-label">{new Date(account.since).toLocaleDateString(intl, { day: "numeric", month: "long", year: "numeric" })}</span></SettingsRow>}
        {!local && (
          <SettingsRow label={t("Sign out")} description={t("Ends your session on this device.")}>
            <form action="/auth/signout" method="post"><Button type="submit" variant="secondary" size="sm">{t("Sign out")}</Button></form>
          </SettingsRow>
        )}
      </SettingsGroup>

      <SettingsGroup title={t("Password")} description={local ? t("You need it only if you put the app online. The app on this computer keeps using the new one by itself.") : undefined}>
        <ChangePassword local={local} />
        {local && (
          <SettingsRow label={t("Forgot your password?")} description={t("You don't need the old one to change it above. You can also choose a new one with a Supabase access token, no email needed.")}>
            <Link href="/reset-password?next=/app/settings/account" className="text-sm font-medium text-accent hover:underline">{t("Reset it")}</Link>
          </SettingsRow>
        )}
      </SettingsGroup>

      {local && (
        <SettingsGroup title={t("Use it online")} description={t("You can also put {app} online, for example on Vercel, to open it from anywhere.", { app: APP_NAME })}>
          <SettingsRow label={t("An online copy asks you to sign in")} description={account.email ? t("Anyone with its address could reach it, so it shows a login page. Sign in there with your email ({email}) and your password: the one you chose during setup, or the one you set above. People you add in Members sign in there too.", { email: account.email }) : t("Anyone with its address could reach it, so it shows a login page. Sign in there with your email and your password: the one you chose during setup, or the one you set above. People you add in Members sign in there too.")} />
        </SettingsGroup>
      )}

      <DeleteAccount launched={launched} />
    </SettingsPage>
  );
}

function ChangePassword({ local }: { local: boolean }) {
  const { t } = useT();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string; password: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) return setError(t("Use a password with at least 8 characters."));
    setBusy(true); setError(null);
    const result = await api<{ ok: boolean; email: string | null }>("/api/account/password", "POST", { password });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setDone({ email: result.data.email ?? "", password });
    setPassword("");
  }

  return (
    <SettingsRow label={t("Change password")} description={local ? t("Choose a new password. The app saves it on this computer, so it keeps signing you in.") : t("Choose a new password for signing in.")}
      below={done ? <div className="mt-3"><SignInDetails email={done.email} password={done.password} /></div> : error ? <Status error={error} className="mt-2" /> : null}>
      <form onSubmit={submit} noValidate className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <div className="w-full sm:w-56">
          <PasswordInput aria-label={t("New password")} autoComplete="new-password" minLength={8} required value={password} disabled={busy}
            onChange={(event) => { setPassword(event.target.value); setError(null); setDone(null); }} placeholder={t("At least 8 characters")} />
        </div>
        <Button type="submit" size="sm" disabled={busy || !password}>{busy && <Spinner className="size-3.5" />}{t("Save")}</Button>
      </form>
    </SettingsRow>
  );
}
