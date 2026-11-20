"use client";
// Settings → API keys. One row per key in the catalogue, grouped by what it is for. A row shows
// whether the key is set (never its value), and for the owner an Add or Replace action that opens the
// steps for getting the key and a field to paste it into. Saving checks the key live; the result is
// shown on the row. A stored value is never shown or filled in.
import { useId, useState, type FormEvent } from "react";
import { KEY_CATALOG, KEY_GROUPS, keysInGroup, type KeySpec } from "@/lib/install/key-catalog";
import { useT } from "@/lib/i18n/client";
import { sentenceGap } from "../rich";
import { joinSentences } from "@/lib/i18n/join";
import { translateServerMessage } from "@/lib/i18n/server-messages";
import { isAccountsMode, isStaff, keyState, type InstallState, type KeyState } from "@/lib/install/types";
import { useInstall, type UseInstall } from "@/lib/install/use-install";
import { ask } from "../dialog";
import { IconExternal, IconMore } from "../icons";
import { Badge, Button, cx, inputClass, Menu, MenuItem, SettingsGroup, SettingsRow, Spinner } from "../ui";
import { api, ReadOnlyNote, sayError, SettingsPage, WithInstall } from "./settings-ui";
import { repoFileUrl } from "@/lib/brand-config";

type T = ReturnType<typeof useT>;
const day = (iso: string, intl: string) => new Date(iso).toLocaleDateString(intl, { day: "numeric", month: "short" });
const keyUrl = (name: string) => `/api/install/keys/${encodeURIComponent(name)}`;
const labelOf = (name: string) => KEY_CATALOG.find((key) => key.name === name)?.label ?? name;
/** The key in a sentence: "OpenAI key", but "Meta app secret" and "TikTok research client key" as they are. */
const nounOf = (spec: KeySpec, t: T["t"]) => (/\b(key|secret|token|account)$/i.test(spec.label) ? t(spec.label) : t("{name} key", { name: t(spec.label) }));
/** Why a key that is stored hasn't passed a check, when the server said (a key that waits for its pair, a service with no check). */
const whyUnchecked = (key: KeyState | undefined) => (key?.status === "unverified" && key.message ? key.message : null);

/** The key's state in words, and the tone of the dot beside it. */
export function describeKey(key: KeyState, { t, intl, locale }: Pick<T, "t" | "intl" | "locale">): { text: string; tone: "off" | "ok" | "failed" | "set" } {
  // The check's sentence comes from the backend in English (install/checks.ts): said in the page's language.
  const say = (message: string) => translateServerMessage(message, { t, locale });
  if (!key.set) return { text: t("Not set"), tone: "off" };
  if (key.source === "env") return { text: t("Set on the server"), tone: "ok" };
  if (key.status === "failed") return { text: t("Check failed: {reason}", { reason: key.message ? say(key.message) : t("the service refused this key") }), tone: "failed" };
  const last4 = key.last4 ?? "";
  if (key.status === "ok") {
    if (key.verifiedAt) return { text: last4 ? t("Set, ending {last4}, checked {date}", { last4, date: day(key.verifiedAt, intl) }) : t("Set, checked {date}", { date: day(key.verifiedAt, intl) }), tone: "ok" };
    return { text: last4 ? t("Set, ending {last4}", { last4 }) : t("Set"), tone: "ok" };
  }
  // The server's reason starts "Saved, but not checked yet: …"; on a row that already says "Set" it reads "Not checked yet: …".
  if (key.message) {
    const reason = say(key.message.replace(/^Saved, but n/, "N"));
    return { text: last4 ? t("Set, ending {last4}. {reason}", { last4, reason }) : t("Set. {reason}", { reason }), tone: "set" };
  }
  return { text: last4 ? t("Set, ending {last4}, not checked yet", { last4 }) : t("Set, not checked yet"), tone: "set" };
}

const DOT = { off: "bg-ink/20", ok: "bg-win", failed: "bg-warn", set: "bg-accent" };

export function KeysSettings() {
  const { t, locale } = useT();
  const gap = sentenceGap(locale);
  const { install: loaded } = useInstall();
  // Accounts mode: every account brings its own keys, kept apart from everyone else's.
  const accounts = isAccountsMode(loaded);
  return (
    <SettingsPage page="keys"
      title={accounts ? t("Your keys") : undefined}
      description={accounts ? t("The services your account uses. Each key is checked when you save it and kept for your account only: nobody else's work ever uses it.") : undefined}>
      <WithInstall>
        {(install, manage, refresh) => (
          <>
            <ReadOnlyNote install={install} what={t("Your keys")} legacy={<><span className="font-medium text-ink">{t("Keys are set on the server for this workspace.")}</span>{gap}{t("It was set up before keys could be managed here, so each one is a secret on the Supabase project's edge functions. This page shows which are set.")}</>} />
            {KEY_GROUPS.map((group) => {
              // The desktop runner is the platform's: an account other than staff has no secret for it.
              const specs = keysInGroup(group.id).filter((spec) => !(isAccountsMode(install) && !isStaff(install) && spec.name === "CREATIVES_RUNNER_SECRET"));
              if (!specs.length) return null;
              return (
                <SettingsGroup key={group.id} title={t(group.title)} description={accounts && group.id === "advanced" ? t("Optional. Most people never need these.") : t(group.blurb)}>
                  {specs.map((spec) => <KeyRow key={spec.name} spec={spec} install={install} manage={manage} refresh={refresh} />)}
                </SettingsGroup>
              );
            })}
          </>
        )}
      </WithInstall>
    </SettingsPage>
  );
}

function KeyRow({ spec, install, manage, refresh }: { spec: KeySpec; install: InstallState; manage: boolean; refresh: UseInstall["refresh"] }) {
  const { t, intl, locale } = useT();
  const noun = nounOf(spec, t);
  const key = keyState(install, spec.name);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ error?: string; ok?: string } | null>(null);
  // A staff account borrowing the platform's key: say so; adding their own replaces it for their work.
  const borrowed = key.source === "platform";
  const state = borrowed ? { text: t("Using the platform's key (staff). Add your own to use it instead."), tone: "ok" as const } : describeKey(key, { t, intl, locale });
  // A key from the environment can't be changed from the app.
  const editable = manage && key.source !== "env";

  async function verify() {
    setBusy(true); setNote(null);
    const result = await api<{ key: KeyState }>(`${keyUrl(spec.name)}/verify`, "POST");
    await refresh();
    setBusy(false);
    const checked = result.ok ? result.data.key : undefined;
    if (!result.ok) setNote({ error: result.error });
    else if (checked?.status === "ok") setNote({ ok: t("Checked just now: the key works.") });
    else if (checked?.status === "failed") setNote({ error: t("Checked just now: the service refused this key.") });
    // The reason is on the row itself (describeKey); this says the check did run.
    else setNote({ ok: whyUnchecked(checked) ? t("Checked just now. Nothing has changed.") : t("It could not be checked right now. Try again later.") });
  }

  async function remove() {
    const yes = await ask({ title: t("Remove the {key}?", { key: noun }), body: t("It is deleted from this workspace, and what it is for stops working until one is added again: {unlocks}", { unlocks: t(spec.unlocks) }), confirm: t("Remove key"), danger: true });
    if (!yes) return;
    setBusy(true); setNote(null);
    const result = await api<{ ok: boolean }>(keyUrl(spec.name), "DELETE");
    await refresh();
    setBusy(false);
    setNote(result.ok ? { ok: t("Removed.") } : { error: result.error });
  }

  return (
    <SettingsRow
      label={<span className="flex flex-wrap items-center gap-2">{t(spec.label)}{spec.required && <Badge tone="accent">{t("Required")}</Badge>}</span>}
      description={<>
        {t(spec.unlocks)}{spec.pairsWith?.length && !/together with/i.test(spec.unlocks) ? `${sentenceGap(locale)}${t("Works together with the {keys}.", { keys: new Intl.ListFormat(intl, { type: "conjunction" }).format(spec.pairsWith.map((name) => t(labelOf(name)))) })}` : ""}
        <span className={cx("mt-1.5 flex items-start gap-2", state.tone === "failed" ? "text-warn" : state.tone === "off" ? "text-faint" : "text-label")}>
          <span aria-hidden className={cx("mt-[7px] size-1.5 shrink-0 rounded-full", DOT[state.tone])} />
          <span className="min-w-0 [overflow-wrap:anywhere]">{state.text}</span>
        </span>
        {note && <span role="status" className={cx("mt-1 block", note.error ? "text-warn" : "text-win")}>{note.error ? sayError(t, note.error) : note.ok}</span>}
      </>}
      below={editing ? <KeyForm spec={spec} replacing={key.set && !borrowed} accounts={isAccountsMode(install)} onCancel={() => setEditing(false)} onSaved={async (message) => { await refresh(); setEditing(false); setNote(message); }} /> : null}>
      {editable && !editing && (
        <>
          {busy && <Spinner className="size-3.5 text-muted" />}
          <Button variant="secondary" size="sm" onClick={() => { setNote(null); setEditing(true); }} disabled={busy}>{borrowed ? t("Add your own") : key.set ? t("Replace") : t("Add")}</Button>
          {key.set && !borrowed && (
            <Menu label={t("More for the {key}", { key: noun })} align="end" width={180} trigger={(trigger) => (
              <button {...trigger} disabled={busy} aria-label={t("More for the {key}", { key: noun })} className="grid size-7 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-hover hover:text-ink aria-expanded:bg-hover disabled:opacity-50"><IconMore className="size-4" /></button>
            )}>
              <MenuItem onSelect={() => { void verify(); }}>{t("Check again")}</MenuItem>
              <MenuItem danger onSelect={() => { void remove(); }}>{t("Remove")}</MenuItem>
            </Menu>
          )}
        </>
      )}
    </SettingsRow>
  );
}

function KeyForm({ spec, replacing, accounts, onCancel, onSaved }: { spec: KeySpec; replacing: boolean; accounts: boolean; onCancel: () => void; onSaved: (message: { error?: string; ok?: string }) => Promise<void> }) {
  const { t, locale } = useT();
  const noun = nounOf(spec, t);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  let site = spec.getUrl;
  try { site = new URL(spec.getUrl).hostname.replace(/^www\./, ""); } catch { /* keep the link as written */ }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return setError(t("Paste the key first."));
    setBusy(true); setError("");
    // The server checks the key against the service before it stores it; a key that fails is not saved.
    const result = await api<{ key: KeyState }>(keyUrl(spec.name), "PUT", { value: trimmed });
    // The backend's reason (translated on the way: relay()) then what that means here, joined the language's way.
    if (!result.ok) { setBusy(false); return setError(joinSentences(locale, translateServerMessage(sayError(t, result.error), { t, locale }), replacing ? t("Nothing was changed: the key stored before is still in use.") : t("Nothing was saved."))); }
    const saved = result.data.key;
    await onSaved(saved?.status === "failed" ? { error: t("Saved, but the check failed: {reason}", { reason: saved.message ? translateServerMessage(saved.message, { t, locale }) : t("the service refused this key") }) }
      : saved?.status === "ok" ? { ok: t("Saved. The key was checked and works.") }
      // The row itself says why (it waits for its pair, or the service has no check).
      : { ok: whyUnchecked(saved) ? t("Saved.") : t("Saved. It could not be checked right now; use Check again later.") });
  }

  const field = { id, value, onChange: (event: { target: { value: string } }) => { setValue(event.target.value); setError(""); }, autoComplete: "off", spellCheck: false, "aria-describedby": `${id}-hint`, "aria-invalid": Boolean(error) || undefined, disabled: busy };
  return (
    <form onSubmit={submit} className="mt-3 rounded-inner border border-line bg-canvas p-3.5">
      <p className="text-xs font-medium text-label">{t("How to get it")}</p>
      <ol className="mt-1.5 grid list-decimal gap-1 pl-4 text-sm text-label marker:text-faint">
        {spec.steps.map((step) => <li key={step}>{t(step)}</li>)}
      </ol>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <a href={spec.getUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-xs text-sm font-medium text-accent hover:underline">{t("Open {site}", { site })}<IconExternal className="size-3.5" /></a>
        <a href={repoFileUrl(spec.guide)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-xs text-sm font-medium text-accent hover:underline">{t("Full step-by-step guide")}<IconExternal className="size-3.5" /></a>
      </div>
      <label htmlFor={id} className="mt-4 block text-xs font-medium text-label">{replacing ? t("New {key}", { key: noun }) : noun}</label>
      {spec.multiline
        ? <textarea {...field} rows={6} placeholder={t(spec.hint)} className={cx(inputClass, "mt-1.5 resize-y font-mono text-xs")} />
        : <input {...field} type="password" data-1p-ignore data-lpignore="true" className={cx(inputClass, "mt-1.5 font-mono")} />}
      <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">{t("{hint}. {note}", { hint: t(spec.hint), note: replacing ? t("The key stored now stays in use until the new one passes its check.") : accounts ? t("It is checked with the service, then stored encrypted in your workspace. It is never shown again.") : t("It is checked with the service, then stored in your Supabase project. It is never shown again.") })}</p>
      {error && <p role="alert" className="mt-2 text-sm text-warn">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner className="size-3.5" />}{busy ? t("Checking") : t("Save and check")}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>{t("Cancel")}</Button>
      </div>
    </form>
  );
}
