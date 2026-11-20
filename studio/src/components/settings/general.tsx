"use client";
// Settings → General: the workspace's name (the owner can change it). The person's own sign-in is on Account.
import { useState, type FormEvent } from "react";
import { APP_NAME } from "@/lib/brand-config";
import { prime } from "@/lib/client-cache";
import type { InstallState } from "@/lib/install/types";
import { INSTALL_URL } from "@/lib/install/use-install";
import { Button, inputClass, SettingsGroup, SettingsRow, Spinner } from "../ui";
import { PlanUsage } from "./accounts";
import { useT } from "@/lib/i18n/client";
import { api, ReadOnlyNote, SettingsPage, Status, WithInstall } from "./settings-ui";
import { useWorkspaceLabel } from "../nav/who";

export function GeneralSettings() {
  const { t } = useT();
  return (
    <SettingsPage page="general">
      <WithInstall>
        {(install, manage) => (
          <>
            <ReadOnlyNote install={install} what={t("the workspace name")} />
            <SettingsGroup title={t("Workspace")}>
              <WorkspaceName install={install} manage={manage} />
            </SettingsGroup>
            <PlanUsage install={install} />
          </>
        )}
      </WithInstall>
    </SettingsPage>
  );
}

function WorkspaceName({ install, manage }: { install: InstallState; manage: boolean }) {
  const { t } = useT();
  const saved = install.name ?? "";
  const [name, setName] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ error?: string; ok?: string }>({});
  const clean = name.trim();
  const dirty = clean !== saved.trim();
  // With no name saved, the sidebar calls it after the person ("Ann's workspace"): shown here as the suggestion.
  const { label, named } = useWorkspaceLabel();
  const suggestion = named ? APP_NAME : label;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!clean) return setNote({ error: t("Give the workspace a name.") });
    setBusy(true); setNote({});
    const result = await api<InstallState>("/api/install/settings", "PATCH", { name: clean });
    setBusy(false);
    if (!result.ok) return setNote({ error: result.error });
    prime(INSTALL_URL, result.data);
    setNote({ ok: t("Saved.") });
  }

  if (!manage) {
    return <SettingsRow label={t("Name")} description={t("Shown at the top of the sidebar.")}><span className="text-sm text-label">{saved || label}</span></SettingsRow>;
  }
  return (
    <SettingsRow label={t("Name")} description={t("Shown at the top of the sidebar, to everyone in this workspace.")}
      below={(note.error || note.ok) ? <Status error={note.error} ok={note.ok} className="mt-2" /> : null}>
      <form onSubmit={submit} className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <input aria-label={t("Workspace name")} className={`${inputClass} sm:w-56!`} value={name} maxLength={60} placeholder={suggestion} onChange={(event) => { setName(event.target.value); setNote({}); }} disabled={busy} />
        <Button type="submit" size="sm" disabled={!dirty || busy}>{busy && <Spinner className="size-3.5" />}{t("Save")}</Button>
      </form>
    </SettingsRow>
  );
}
