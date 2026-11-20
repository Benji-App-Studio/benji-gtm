"use client";
// Settings > Account > Delete my account. What goes and what stays, the launched Meta ads to pause first,
// a word to type, then the deletion (POST /api/account/delete, called again while the backend answers
// "not done yet"), then /goodbye. A deletion that stops part way leaves the account locked: the app sends
// it to /delete-account (FinishDeletion below), which carries it on.
// Accounts mode: every account. Install mode: members; the owner sees why they can't and what to do
// instead. Hidden on a legacy database (nobody owns what is shared there) and while the role is unknown.
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { DELETION_ENDED_PATH } from "@/lib/auth/session-gate";
import { confirmWordMatches } from "@/lib/confirm-word";
import { useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translate";
import { useInstall } from "@/lib/install/use-install";
import { formatBytes } from "@/lib/storage-usage";
import { Button, inputClass, SettingsGroup, SettingsRow, Spinner } from "../ui";
import { Status } from "./settings-ui";

interface Answer { deleted: boolean; done: boolean; apps: number; files: number; bytes: number; error?: string; code?: string | null }
/** An app with ads sent to Meta from Launch (they stay in the person's ad account). */
export interface LaunchedApp { id: string; name: string; ads: number }
type Progress = { files: number; bytes: number };
/** How many calls one deletion may take (each works up to 90 s), and how long to wait while another call works on it. */
const MAX_CALLS = 40;
const BUSY_WAIT_MS = 5_000;

/**
 * Starts (`start`) or carries on (`resume`) the deletion until it is done. Never throws: the error, in
 * the page's language, comes back instead. On success the browser is sent to /goodbye.
 */
export async function driveDeletion(t: Translator["t"], how: "start" | "resume", onProgress: (progress: Progress) => void): Promise<string | null> {
  const total = { files: 0, bytes: 0 };
  let body: Record<string, boolean> = how === "start" ? { confirm: true } : { resume: true };
  for (let call = 0; call < MAX_CALLS; call++) {
    let answer: Answer | null = null;
    let status = 0;
    try {
      const response = await fetch("/api/account/delete", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      status = response.status;
      answer = await response.json().catch(() => null) as Answer | null;
    } catch {
      return t("Couldn't reach the backend. Nothing more was deleted; try again in a moment.");
    }
    // Once started, every further call carries it on.
    if (status !== 400) body = { resume: true };
    if (status === 409 && answer?.code === "busy") { await new Promise((done) => setTimeout(done, BUSY_WAIT_MS)); continue; }
    // Signed out part way: another call (one this page was reloaded during) may have finished the deletion
    // and its answer, which cleared the session, never arrived. /auth/ended asks Supabase and ends on the
    // goodbye page when the account is gone (the login page otherwise).
    if (status === 401 && (how === "resume" || call > 0)) {
      window.location.assign(DELETION_ENDED_PATH);
      return null;
    }
    if (status < 200 || status >= 300 || !answer) return answer?.error || t("Your account couldn't be deleted. Try again in a moment.");
    total.files += answer.files;
    total.bytes += answer.bytes;
    onProgress({ ...total });
    if (answer.deleted) {
      window.location.assign("/goodbye");
      return null;
    }
  }
  return t("Your account wasn't fully deleted yet. Try again: it carries on where it stopped.");
}

function ProgressLine({ busy, progress }: { busy: boolean; progress: Progress | null }) {
  const { t, tn } = useT();
  if (!busy) return null;
  return (
    <p className="text-caption text-muted" role="status">
      {progress
        ? tn(progress.files, "Deleting… {n} file removed so far ({size}).", "Deleting… {n} files removed so far ({size}).", { size: formatBytes(progress.bytes) })
        : t("Deleting… This can take a few minutes for a big account.")}
    </p>
  );
}

export function DeleteAccount({ launched = [] }: { launched?: LaunchedApp[] }) {
  const { t, tn } = useT();
  const { install } = useInstall();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  if (!install || install.role === "legacy") return null;

  // The word to type, in the page's language ("削除", "삭제", …), or DELETE.
  const word = t("DELETE");
  const matches = confirmWordMatches(typed, word);
  const member = install.mode !== "accounts";

  if (install.role === "owner") {
    return (
      <SettingsGroup title={t("Delete my account")}>
        <SettingsRow label={t("You're the owner of this workspace")}
          description={t("The owner's account can't be deleted here: the workspace's keys, members and data depend on it. Give the workspace to someone else first, or delete the whole workspace by deleting its Supabase project.")} />
      </SettingsGroup>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!matches || busy) return;
    setBusy(true); setError(null);
    const failed = await driveDeletion(t, "start", setProgress);
    if (failed) { setBusy(false); setError(failed); }
  }

  const items = [
    t("Every app, with its competitors and the ads collected for them"),
    t("Creatives, generated images and videos, and brand files"),
    t("Launch drafts and launch tracking"),
    t("Measure data and connections"),
    t("Every stored file: uploads, saved ad media and generated files"),
    t("Your saved keys"),
    t("Your sign-in, name and settings"),
  ];

  return (
    <SettingsGroup title={t("Delete my account")} description={t("Deletes your account and everything in it, for good. This can't be undone.")}>
      <SettingsRow label={t("What is deleted")} description={member ? t("The workspace itself, its owner and the other members aren't affected.") : undefined}
        below={
          <div className="mt-2 grid gap-2 text-caption text-muted">
            <ul className="grid list-disc gap-0.5 pl-5">{items.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        }>
        {!open && <Button variant="danger" size="sm" onClick={() => setOpen(true)}>{t("Delete my account")}</Button>}
      </SettingsRow>
      <SettingsRow label={t("Ads already in Meta stay there")}
        description={t("Ads you sent to your own Meta ad account are not deleted, and once your account is gone they can't be paused from here. Pause the ones that are running first.")}
        below={launched.length > 0 && (
          <ul className="mt-2 grid gap-1 text-caption">
            {launched.map((app) => (
              <li key={app.id} className="flex flex-wrap items-center gap-x-2">
                <span className="[overflow-wrap:anywhere] text-label">{app.name}</span>
                <span className="text-muted">{tn(app.ads, "{n} ad sent to Meta", "{n} ads sent to Meta")}</span>
                <Link href={`/app/w/${app.id}/launch/ads`} className="font-medium text-accent hover:underline">{t("Open Launch › Ads")}</Link>
              </li>
            ))}
          </ul>
        )} />
      {open && (
        <SettingsRow label={t("Confirm")} description={t("Type {word} to confirm.", { word })}
          below={<div className="mt-2"><ProgressLine busy={busy} progress={progress} />{error && <Status error={error} className="mt-1" />}</div>}>
          <form onSubmit={submit} className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <input className={`${inputClass} w-full sm:w-40`} value={typed} onChange={(e) => { setTyped(e.target.value); setError(null); }} disabled={busy}
              aria-label={t("Type {word} to confirm.", { word })} placeholder={word} autoComplete="off" autoCapitalize="off" spellCheck={false} />
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setOpen(false); setTyped(""); setError(null); }}>{t("Cancel")}</Button>
            <Button type="submit" variant="danger" size="sm" disabled={!matches || busy}>{busy && <Spinner className="size-3.5" />}{t("Delete my account")}</Button>
          </form>
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}

/** /delete-account: an account whose deletion stopped part way. It carries on by itself as soon as the page opens. */
export function FinishDeletion() {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const started = useRef(false);

  async function go() {
    setBusy(true); setError(null);
    const failed = await driveDeletion(t, "resume", setProgress);
    if (failed) { setBusy(false); setError(failed); }
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="text-center">
      <h1 className="text-display font-semibold">{t("Finish deleting your account")}</h1>
      <p className="mt-2 text-sm text-muted">{t("You asked to delete your account and it isn't finished yet. Your account stays locked until it is; the rest is deleted now.")}</p>
      <div className="mt-6 grid justify-items-center gap-2">
        <ProgressLine busy={busy} progress={progress} />
        {error && <Status error={error} />}
        {!busy && <Button variant="danger" onClick={() => void go()}>{t("Finish deleting my account")}</Button>}
      </div>
    </div>
  );
}
