"use client";
// Settings → AI models: which provider reads ads and writes analyses, and the model for each of the
// four jobs. "Reset models to defaults" asks the server for its own defaults again. When the server's
// environment sets a model itself, that one runs whatever is typed here, and the row says so.
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { prime } from "@/lib/client-cache";
import { useT } from "@/lib/i18n/client";
import { sentenceGap } from "../rich";
import { m } from "@/lib/i18n/translate";
import { hasKey, type AiProvider, type InstallModels, type InstallState } from "@/lib/install/types";
import { INSTALL_URL } from "@/lib/install/use-install";
import { Button, cx, inputClass, Locked, Segmented, SettingsGroup, SettingsRow, Spinner } from "../ui";
import { api, ReadOnlyNote, SettingsPage, Status, WithInstall } from "./settings-ui";

const PROVIDERS: { value: AiProvider; label: string; key: string }[] = [
  { value: "openai", label: "OpenAI", key: "OPENAI_API_KEY" },
  { value: "typesafe", label: "TypeSafe", key: "TYPESAFE_API_KEY" },
];

const JOBS: { key: keyof InstallModels; label: string; description: string }[] = [
  { key: "text", label: m("Text"), description: m("Writes the analysis, the product profile and ad copy.") },
  { key: "vision", label: m("Vision"), description: m("Reads images and video frames from ads and posts.") },
  { key: "transcribe", label: m("Transcribe"), description: m("Turns what is said in a video into text.") },
  { key: "image", label: m("Image"), description: m("Makes images when the AI provider generates them.") },
];

export function ModelsSettings() {
  const { t } = useT();
  return (
    <SettingsPage page="models">
      <WithInstall>
        {(install, manage) => (
          <>
            <ReadOnlyNote install={install} what={t("AI models")} />
            <ModelsBody install={install} manage={manage} />
          </>
        )}
      </WithInstall>
    </SettingsPage>
  );
}

type Note = { error?: string; ok?: string };

/** Holds the "Saved" line, and starts the form again from the server's values after a save or a reset. */
function ModelsBody({ install, manage }: { install: InstallState; manage: boolean }) {
  const [note, setNote] = useState<Note>({});
  return <ModelsForm key={JSON.stringify([install.aiProvider, install.models])} install={install} manage={manage} note={note} setNote={setNote} />;
}

function ModelsForm({ install, manage, note, setNote }: { install: InstallState; manage: boolean; note: Note; setNote: (note: Note) => void }) {
  const { t } = useT();
  const [provider, setProvider] = useState<AiProvider>(install.aiProvider);
  const [models, setModels] = useState<InstallModels>(install.models);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const dirty = provider !== install.aiProvider || JOBS.some((job) => models[job.key].trim() !== install.models[job.key]);
  const chosen = PROVIDERS.find((p) => p.value === provider)!;
  const needsKey = !hasKey(install, chosen.key);

  async function send(kind: "save" | "reset", body: unknown, done: string) {
    setBusy(kind); setNote({});
    const result = await api<InstallState>("/api/install/settings", "PATCH", body);
    setBusy(null);
    if (!result.ok) return setNote({ error: result.error });
    prime(INSTALL_URL, result.data);
    setNote({ ok: done });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = Object.fromEntries(JOBS.map((job) => [job.key, models[job.key].trim()])) as unknown as InstallModels;
    const empty = JOBS.find((job) => !clean[job.key]);
    if (empty) return setNote({ error: t("Give the {job} model a name, or reset to the defaults.", { job: t(empty.label).toLowerCase() }) });
    void send("save", { aiProvider: provider, models: clean }, needsKey ? t("Saved. {provider} has no key yet, so nothing is read or analysed until you add it.", { provider: chosen.label }) : t("Saved."));
  }

  return (
    <form onSubmit={submit} className="grid gap-10">
      <SettingsGroup title={t("Provider")}>
        <SettingsRow label={t("AI provider")} description={t("The service that reads ads and posts, writes analyses and checks creatives.")}
          below={needsKey ? <Locked className="mt-2.5" href="/app/settings/keys" action={t("Add the key")}>{t("{provider} needs its API key before it can be used", { provider: chosen.label })}</Locked> : null}>
          {manage
            ? <Segmented label={t("AI provider")} options={PROVIDERS} value={provider} onChange={(value) => { setProvider(value); setNote({}); }} />
            : <span className="text-sm text-label">{chosen.label}</span>}
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("Models")} description={<>{t("The model each job uses, by the name the provider gives it. Change one only if you know the provider offers it to your account: the key decides what is available.")} <Link href="/app/settings/keys" className="font-medium text-accent hover:underline">{t("Open your keys")}</Link></>}>
        {JOBS.map((job) => (
          <SettingsRow key={job.key} label={t(job.label)} description={t(job.description)} below={<InUse stored={install.models[job.key]} running={install.resolvedModels?.[job.key]} />}>
            {manage
              ? <input aria-label={t("{job} model", { job: t(job.label) })} className={cx(inputClass, "font-mono text-xs sm:w-60!")} value={models[job.key]} spellCheck={false} autoComplete="off" disabled={busy !== null}
                  onChange={(event) => { setModels({ ...models, [job.key]: event.target.value }); setNote({}); }} />
              : <code className="font-mono text-xs [overflow-wrap:anywhere] text-label">{install.models[job.key]}</code>}
          </SettingsRow>
        ))}
      </SettingsGroup>

      {manage && (
        <div className="-mt-6 flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={!dirty || busy !== null}>{busy === "save" && <Spinner className="size-3.5" />}{t("Save")}</Button>
          <Button type="button" variant="secondary" size="sm" disabled={busy !== null} onClick={() => { void send("reset", { models: null }, t("The models are back to the defaults.")); }}>{busy === "reset" && <Spinner className="size-3.5" />}{t("Reset models to defaults")}</Button>
          <Status error={note.error} ok={note.ok} className="ml-1" />
        </div>
      )}
    </form>
  );
}

/** Shown under a model when the server runs a different one than the name stored here (its environment sets it). */
function InUse({ stored, running }: { stored: string; running: string | undefined }) {
  const { t, locale } = useT();
  const gap = sentenceGap(locale);
  if (!running || running === stored) return null;
  return (
    <p className="mt-2 text-xs text-caution-ink">
      {t("In use now:")} <code className="font-mono [overflow-wrap:anywhere]">{running}</code>{gap}{t("The server's own setting names this model, and it wins over the name here until that setting is removed from the Supabase project's edge function secrets.")}
    </p>
  );
}
