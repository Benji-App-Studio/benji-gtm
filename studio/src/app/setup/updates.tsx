"use client";
// Shown at /setup once the install is connected, to its owner: after downloading a newer version of
// the app, paste a token here to apply the new database changes and reinstall the backend functions.
import { useState } from "react";
import { Button, ButtonLink, Card, Field, inputClass, Spinner } from "@/components/ui";
import { sentenceGap } from "@/components/rich";
import { useT } from "@/lib/i18n/client";
import { UPDATE_STEPS } from "@/lib/server/provision/types";
import { FailureNote, postJson, ProgressList, runStream, TokenHelp, useProgress, type RunFailure } from "./parts";
import { NewTokenNote, tokenRejected } from "./token-retry";

interface Inspection { project: { ref: string; name: string; region: string }; state: "empty" | "update"; pending: number; applied: number }

export function Updates({ appName }: { appName: string }) {
  const { t, tn, locale } = useT();
  const gap = sentenceGap(locale);
  const [token, setToken] = useState("");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RunFailure | null>(null);
  const [done, setDone] = useState(false);
  const progress = useProgress();

  async function check(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setFailure(null); setInspection(null); setDone(false); progress.reset();
    const { data, error } = await postJson<Inspection>("/api/setup/inspect", { token });
    setBusy(false);
    if (error || !data) return setFailure(error);
    setInspection(data);
  }

  async function apply(useToken = token) {
    setBusy(true); setFailure(null); setDone(false); progress.reset();
    const failed = await runStream("/api/setup/prepare", { token: useToken }, progress.record);
    setBusy(false);
    if (failed) return setFailure(failed);
    setDone(true);
    setToken("");
  }

  const started = busy || done || Object.keys(progress.steps).length > 0;
  return (
    <Card id="updates" className="scroll-mt-6 space-y-4 p-4">
      <div>
        <h2 className="text-sm font-medium">{t("Updates")}</h2>
        <p className="mt-0.5 text-sm text-muted">
          {t("After you update your copy of {app} (Sync fork on GitHub, or npm run update for a template copy, then start the app again), come here once. This applies the new database changes and reinstalls the backend in your Supabase project.", { app: appName })}{gap}
          {t("Your data and your keys are not touched.")}
        </p>
      </div>
      <TokenHelp appName={appName} action={t("Check for updates")} />
      <form onSubmit={check} className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-64">
          <Field label={t("Access token")}>
            <input className={inputClass} type="password" autoComplete="off" spellCheck={false} placeholder="sbp_..." value={token}
              onChange={(event) => { setToken(event.target.value.trim()); setInspection(null); }} />
          </Field>
        </div>
        <Button type="submit" variant="secondary" disabled={busy || !token}>{busy && !inspection ? <><Spinner className="size-3.5" />{t("Checking")}</> : t("Check for updates")}</Button>
      </form>
      {inspection && !started && (
        <>
          <p className="text-sm text-ink">
            {inspection.pending > 0
              ? tn(inspection.pending, "\"{project}\" needs {n} new database change. The backend will be reinstalled too.", "\"{project}\" needs {n} new database changes. The backend will be reinstalled too.", { project: inspection.project.name })
              : t("The database of \"{project}\" is up to date. You can still reinstall the backend, which is what a new version usually changes.", { project: inspection.project.name })}
          </p>
          <Button type="button" onClick={() => { void apply(); }} disabled={busy}>{t("Apply the update")}</Button>
        </>
      )}
      {started && <ProgressList ids={UPDATE_STEPS} steps={progress.steps} running={busy} />}
      {/* A token turned down while applying: a field for a new one right here (while checking, the field above is it). */}
      {failure && (tokenRejected(failure) && inspection
        ? <NewTokenNote failure={failure} oldToken={token} busy={busy} onRetry={(fresh) => { setToken(fresh); void apply(fresh); }} />
        : <FailureNote failure={failure} onRetry={inspection && token ? () => { void apply(); } : undefined} busy={busy} />)}
      {done && (
        <>
          <p className="text-sm text-win">{t("Your project is up to date. You can now delete the access token in Supabase.")}</p>
          <ButtonLink href="/app/w" variant="secondary">{t("Back to the app")}</ButtonLink>
        </>
      )}
    </Card>
  );
}
