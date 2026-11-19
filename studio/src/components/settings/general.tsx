"use client";
// Settings → General: the workspace's name (the owner can change it). The person's own sign-in is on Account.
import { useState, type FormEvent } from "react";
import { APP_NAME } from "@/lib/brand-config";
import { prime } from "@/lib/client-cache";
import type { InstallState } from "@/lib/install/types";
import { INSTALL_URL } from "@/lib/install/use-install";
import { Button, inputClass, SettingsGroup, SettingsRow, Spinner } from "../ui";
import { api, ReadOnlyNote, SettingsPage, Status, WithInstall } from "./settings-ui";

export function GeneralSettings() {
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
