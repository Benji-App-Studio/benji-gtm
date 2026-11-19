"use client";
// Settings → API keys. One row per key in the catalogue, grouped by what it is for. A row shows
// whether the key is set (never its value), and for the owner an Add or Replace action that opens the
// steps for getting the key and a field to paste it into. Saving checks the key live; the result is
// shown on the row. A stored value is never shown or filled in.
import { useId, useState, type FormEvent } from "react";
import { KEY_CATALOG, KEY_GROUPS, keysInGroup, type KeySpec } from "@/lib/install/key-catalog";
import { keyState, type InstallState, type KeyState } from "@/lib/install/types";
import type { UseInstall } from "@/lib/install/use-install";
import { ask } from "../dialog";
import { IconExternal, IconMore } from "../icons";
import { Badge, Button, cx, inputClass, Menu, MenuItem, SettingsGroup, SettingsRow, Spinner } from "../ui";
import { api, ReadOnlyNote, SettingsPage, WithInstall } from "./settings-ui";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const keyUrl = (name: string) => `/api/install/keys/${encodeURIComponent(name)}`;
const labelOf = (name: string) => KEY_CATALOG.find((key) => key.name === name)?.label ?? name;
/** The key in a sentence: "OpenAI key", but "Meta app secret" and "TikTok research client key" as they are. */
const nounOf = (spec: KeySpec) => (/\b(key|secret|token|account)$/i.test(spec.label) ? spec.label : `${spec.label} key`);
/** Why a key that is stored hasn't passed a check, when the server said (a key that waits for its pair, a service with no check). */
const whyUnchecked = (key: KeyState | undefined) => (key?.status === "unverified" && key.message ? key.message : null);

/** The key's state in words, and the tone of the dot beside it. */
export function describeKey(key: KeyState): { text: string; tone: "off" | "ok" | "failed" | "set" } {
  if (!key.set) return { text: "Not set", tone: "off" };
  if (key.source === "env") return { text: "Set on the server", tone: "ok" };
  if (key.status === "failed") return { text: `Check failed: ${key.message || "the service refused this key"}`, tone: "failed" };
  const ending = key.last4 ? `, ending ${key.last4}` : "";
  if (key.status === "ok") return { text: `Set${ending}${key.verifiedAt ? `, checked ${day(key.verifiedAt)}` : ""}`, tone: "ok" };
  // The server's reason starts "Saved, but not checked yet: …"; on a row that already says "Set" it reads "Not checked yet: …".
  return { text: key.message ? `Set${ending}. ${key.message.replace(/^Saved, but n/, "N")}` : `Set${ending}, not checked yet`, tone: "set" };
}

const DOT = { off: "bg-ink/20", ok: "bg-win", failed: "bg-warn", set: "bg-accent" };

export function KeysSettings() {
  return (
    <SettingsPage page="keys">
      <WithInstall>
        {(install, manage, refresh) => (
          <>
            <ReadOnlyNote install={install} what="API keys" legacy={<><span className="font-medium text-ink">Keys are set on the server for this workspace.</span> It was set up before keys could be managed here, so each one is a secret on the Supabase project&apos;s edge functions. This page shows which are set.</>} />
            {KEY_GROUPS.map((group) => (
              <SettingsGroup key={group.id} title={group.title} description={group.blurb}>
                {keysInGroup(group.id).map((spec) => <KeyRow key={spec.name} spec={spec} install={install} manage={manage} refresh={refresh} />)}
              </SettingsGroup>
            ))}
          </>
        )}
      </WithInstall>
    </SettingsPage>
  );
}

function KeyRow({ spec, install, manage, refresh }: { spec: KeySpec; install: InstallState; manage: boolean; refresh: UseInstall["refresh"] }) {
  const key = keyState(install, spec.name);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ error?: string; ok?: string } | null>(null);
  const state = describeKey(key);
  // A key from the environment can't be changed from the app.
  const editable = manage && key.source !== "env";

  async function verify() {
    setBusy(true); setNote(null);
    const result = await api<{ key: KeyState }>(`${keyUrl(spec.name)}/verify`, "POST");
    await refresh();
    setBusy(false);
    const checked = result.ok ? result.data.key : undefined;
    if (!result.ok) setNote({ error: result.error });
    else if (checked?.status === "ok") setNote({ ok: "Checked just now: the key works." });
    else if (checked?.status === "failed") setNote({ error: "Checked just now: the service refused this key." });
    // The reason is on the row itself (describeKey); this says the check did run.
    else setNote({ ok: whyUnchecked(checked) ? "Checked just now. Nothing has changed." : "It could not be checked right now. Try again later." });
  }

  async function remove() {
    const yes = await ask({ title: `Remove the ${nounOf(spec)}?`, body: `It is deleted from this workspace, and what it is for stops working until one is added again: ${spec.unlocks}`, confirm: "Remove key", danger: true });
    if (!yes) return;
    setBusy(true); setNote(null);
    const result = await api<{ ok: boolean }>(keyUrl(spec.name), "DELETE");
    await refresh();
    setBusy(false);
    setNote(result.ok ? { ok: "Removed." } : { error: result.error });
  }

  return (
    <SettingsRow
      label={<span className="flex flex-wrap items-center gap-2">{spec.label}{spec.required && <Badge tone="accent">Required</Badge>}</span>}
      description={<>
        {spec.unlocks}{spec.pairsWith?.length && !/together with/i.test(spec.unlocks) ? ` Works together with the ${spec.pairsWith.map(labelOf).join(" and ")}.` : ""}
        <span className={cx("mt-1.5 flex items-start gap-2", state.tone === "failed" ? "text-warn" : state.tone === "off" ? "text-faint" : "text-label")}>
          <span aria-hidden className={cx("mt-[7px] size-1.5 shrink-0 rounded-full", DOT[state.tone])} />
          <span className="min-w-0 [overflow-wrap:anywhere]">{state.text}</span>
        </span>
        {note && <span role="status" className={cx("mt-1 block", note.error ? "text-warn" : "text-win")}>{note.error ?? note.ok}</span>}
      </>}
      below={editing ? <KeyForm spec={spec} replacing={key.set} onCancel={() => setEditing(false)} onSaved={async (message) => { await refresh(); setEditing(false); setNote(message); }} /> : null}>
      {editable && !editing && (
        <>
          {busy && <Spinner className="size-3.5 text-muted" />}
          <Button variant="secondary" size="sm" onClick={() => { setNote(null); setEditing(true); }} disabled={busy}>{key.set ? "Replace" : "Add"}</Button>
          {key.set && (
            <Menu label={`More for the ${nounOf(spec)}`} align="end" width={180} trigger={(trigger) => (
              <button {...trigger} disabled={busy} aria-label={`More for the ${nounOf(spec)}`} className="grid size-7 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-hover hover:text-ink aria-expanded:bg-hover disabled:opacity-50"><IconMore className="size-4" /></button>
            )}>
              <MenuItem onSelect={() => { void verify(); }}>Check again</MenuItem>
              <MenuItem danger onSelect={() => { void remove(); }}>Remove</MenuItem>
            </Menu>
          )}
        </>
      )}
    </SettingsRow>
  );
}

function KeyForm({ spec, replacing, onCancel, onSaved }: { spec: KeySpec; replacing: boolean; onCancel: () => void; onSaved: (message: { error?: string; ok?: string }) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  let site = spec.getUrl;
  try { site = new URL(spec.getUrl).hostname.replace(/^www\./, ""); } catch { /* keep the link as written */ }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return setError("Paste the key first.");
    setBusy(true); setError("");
    // The server checks the key against the service before it stores it; a key that fails is not saved.
    const result = await api<{ key: KeyState }>(keyUrl(spec.name), "PUT", { value: trimmed });
    if (!result.ok) { setBusy(false); return setError(`${result.error} ${replacing ? "Nothing was changed: the key stored before is still in use." : "Nothing was saved."}`); }
    const saved = result.data.key;
    await onSaved(saved?.status === "failed" ? { error: `Saved, but the check failed: ${saved.message || "the service refused this key"}` }
      : saved?.status === "ok" ? { ok: "Saved. The key was checked and works." }
      // The row itself says why (it waits for its pair, or the service has no check).
      : { ok: whyUnchecked(saved) ? "Saved." : "Saved. It could not be checked right now; use Check again later." });
  }

  const field = { id, value, onChange: (event: { target: { value: string } }) => { setValue(event.target.value); setError(""); }, autoComplete: "off", spellCheck: false, "aria-describedby": `${id}-hint`, "aria-invalid": Boolean(error) || undefined, disabled: busy };
  return (
    <form onSubmit={submit} className="mt-3 rounded-inner border border-line bg-canvas p-3.5">
      <p className="text-xs font-medium text-label">How to get it</p>
      <ol className="mt-1.5 grid list-decimal gap-1 pl-4 text-sm text-label marker:text-faint">
        {spec.steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <a href={spec.getUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 rounded-xs text-sm font-medium text-accent hover:underline">Open {site}<IconExternal className="size-3.5" /></a>
      <label htmlFor={id} className="mt-4 block text-xs font-medium text-label">{replacing ? `New ${nounOf(spec)}` : nounOf(spec)}</label>
      {spec.multiline
        ? <textarea {...field} rows={6} placeholder={spec.hint} className={cx(inputClass, "mt-1.5 resize-y font-mono text-xs")} />
        : <input {...field} type="password" data-1p-ignore data-lpignore="true" className={cx(inputClass, "mt-1.5 font-mono")} />}
      <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">{spec.hint}. {replacing ? "The key stored now stays in use until the new one passes its check." : "It is checked with the service, then stored in your Supabase project. It is never shown again."}</p>
      {error && <p role="alert" className="mt-2 text-sm text-warn">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner className="size-3.5" />}{busy ? "Checking" : "Save and check"}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}
