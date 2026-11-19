"use client";
// Settings → General: the workspace's name (the owner can change it) and the signed-in person's account.
import { useState, type FormEvent } from "react";
import { APP_NAME } from "@/lib/brand-config";
import { prime } from "@/lib/client-cache";
import type { InstallState } from "@/lib/install/types";
import { INSTALL_URL } from "@/lib/install/use-install";
import { Button, inputClass, SettingsGroup, SettingsRow, Spinner } from "../ui";
import { api, ReadOnlyNote, SettingsPage, Status, WithInstall } from "./settings-ui";

export interface Account { name: string | null; email: string | null; since: string | null }

export function GeneralSettings({ account }: { account: Account }) {
  return (
    <SettingsPage page="general">
      <WithInstall>
        {(install, manage) => (
          <>
            <ReadOnlyNote install={install} what="the workspace name" />
            <SettingsGroup title="Workspace">
              <WorkspaceName install={install} manage={manage} />
            </SettingsGroup>
          </>
        )}
      </WithInstall>
      <SettingsGroup title="Your account" description="Your own sign-in on this workspace.">
        <SettingsRow label="Name"><span className="text-sm text-label">{account.name || "Not set"}</span></SettingsRow>
        <SettingsRow label="Email"><span className="text-sm [overflow-wrap:anywhere] text-label">{account.email || "Not set"}</span></SettingsRow>
        {account.since && <SettingsRow label="Member since"><span className="text-sm text-label">{new Date(account.since).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</span></SettingsRow>}
        <SettingsRow label="Sign out" description="Ends your session on this device.">
          <form action="/auth/signout" method="post"><Button type="submit" variant="secondary" size="sm">Sign out</Button></form>
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}

function WorkspaceName({ install, manage }: { install: InstallState; manage: boolean }) {
  const saved = install.name ?? "";
  const [name, setName] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ error?: string; ok?: string }>({});
  const clean = name.trim();
  const dirty = clean !== saved.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!clean) return setNote({ error: "Give the workspace a name." });
    setBusy(true); setNote({});
    const result = await api<InstallState>("/api/install/settings", "PATCH", { name: clean });
    setBusy(false);
    if (!result.ok) return setNote({ error: result.error });
    prime(INSTALL_URL, result.data);
    setNote({ ok: "Saved." });
  }

  if (!manage) {
    return <SettingsRow label="Name" description="Shown at the top of the sidebar."><span className="text-sm text-label">{saved || APP_NAME}</span></SettingsRow>;
  }
  return (
    <SettingsRow label="Name" description="Shown at the top of the sidebar, to everyone in this workspace."
      below={(note.error || note.ok) ? <Status error={note.error} ok={note.ok} className="mt-2" /> : null}>
      <form onSubmit={submit} className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <input aria-label="Workspace name" className={`${inputClass} sm:w-56!`} value={name} maxLength={60} placeholder={APP_NAME} onChange={(event) => { setName(event.target.value); setNote({}); }} disabled={busy} />
        <Button type="submit" size="sm" disabled={!dirty || busy}>{busy && <Spinner className="size-3.5" />}Save</Button>
      </form>
    </SettingsRow>
  );
}
