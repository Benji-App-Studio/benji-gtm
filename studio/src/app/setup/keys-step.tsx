"use client";
// Step 5 of the checklist: the keys the app needs to do its work. The fields come from the key
// catalogue; saving goes through /api/install, where the backend checks the key live before storing
// it in the project's Vault.
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, ErrorNote, Field, inputClass, Spinner } from "@/components/ui";
import { rich } from "@/components/rich";
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";
import { serverErrorText, translateServerMessage } from "@/lib/i18n/server-messages";
import { KEY_CATALOG, type KeySpec } from "@/lib/install/key-catalog";
import { keyState, type InstallState, type KeyState } from "@/lib/install/types";
import { OutLink, Steps } from "./parts";

const FIRST_KEYS = ["OPENAI_API_KEY", "APIFY_TOKEN"];

function KeyField({ spec, state, tag, onSaved }: { spec: KeySpec; state: KeyState; tag: "Required" | "Recommended"; onSaved: (key: KeyState) => void }) {
  const { t, locale } = useT();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/install/keys/${spec.name}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: value.trim() }) });
      const data = (await response.json().catch(() => null)) as { key?: KeyState; error?: string } | null;
      if (!response.ok || !data?.key) setError(serverErrorText(data, { t, locale }, t("The key couldn't be saved. Try again.")));
      else { onSaved(data.key); setValue(""); }
    } catch {
      setError(t("Couldn't reach the app. Check that it is still running, then try again."));
    }
    setBusy(false);
  }

  return (
    <div className="rounded-inner border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t(spec.label)}</h3>
        <span className="flex items-center gap-2">
          <Badge tone={tag === "Required" ? "caution" : "neutral"}>{tag === "Required" ? t("Required") : t("Recommended")}</Badge>
          {state.set && <Badge tone={state.status === "failed" ? "warn" : "win"}>{state.status === "failed" ? t("Check failed") : t("Saved")}</Badge>}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">{t(spec.unlocks)}</p>
      <div className="mt-3 space-y-3">
        <Steps>
          <li>{rich(t("Open {link}."), { link: <OutLink href={spec.getUrl}>{t(spec.label)}</OutLink> })}</li>
          {spec.steps.map((step) => <li key={step}>{t(step)}</li>)}
        </Steps>
        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-64">
            <Field label={t("{name} key", { name: t(spec.label) })} hint={t(spec.hint)}>
              <input className={inputClass} type="password" autoComplete="off" spellCheck={false} value={value} onChange={(event) => setValue(event.target.value)}
                placeholder={state.set && state.last4 ? t("Saved, ends in {last4}. Paste a new key to replace it.", { last4: state.last4 }) : t("Paste the key here")} />
            </Field>
          </div>
          <Button type="submit" disabled={busy || !value.trim()} className="mb-[22px]">{busy ? <><Spinner className="size-3.5" />{t("Checking")}</> : t("Save and check")}</Button>
        </form>
        {error && <p role="alert" className="text-sm text-warn">{error}</p>}
        {!error && state.set && state.status === "ok" && <p className="text-sm text-win">{state.last4 ? t("This key works. It is saved in your project (ends in {last4}).", { last4: state.last4 }) : t("This key works. It is saved in your project.")}</p>}
        {!error && state.set && state.status === "unverified" && <p className="text-sm text-muted">{state.last4 ? t("Saved (ends in {last4}). It hasn't been checked yet.", { last4: state.last4 }) : t("Saved. It hasn't been checked yet.")}</p>}
        {!error && state.set && state.status === "failed" && <p className="text-sm text-warn">{state.message ? translateServerMessage(state.message, { t, locale }) : t("The last check of this key failed. Paste a new key.")}</p>}
      </div>
    </div>
  );
}

async function readInstall(): Promise<{ install: InstallState | null; error: string }> {
  try {
    const response = await fetch("/api/install", { cache: "no-store" });
    const data = (await response.json().catch(() => null)) as (InstallState & { error?: string }) | null;
    if (!response.ok || !data?.keys) return { install: null, error: data?.error ?? m("Couldn't read which keys are set. Try again.") };
    return { install: data, error: "" };
  } catch {
    return { install: null, error: m("Couldn't reach the app. Check that it is still running, then try again.") };
  }
}

export function KeysStep({ onDone }: { onDone: () => void }) {
  const { t, intl } = useT();
  const [install, setInstall] = useState<InstallState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  const apply = useCallback((result: { install: InstallState | null; error: string }) => {
    setInstall(result.install); setLoadError(result.error); setLoading(false);
  }, []);
  // Reads the saved keys once, when the step opens.
  useEffect(() => { void readInstall().then(apply); }, [apply]);
  const retry = () => { setLoading(true); void readInstall().then(apply); };

  const saved = (name: string) => (key: KeyState) => setInstall((current) => (current ? { ...current, keys: { ...current.keys, [name]: key } } : current));
  const first = FIRST_KEYS.flatMap((name) => KEY_CATALOG.filter((spec) => spec.name === name));
  const later = KEY_CATALOG.filter((spec) => !FIRST_KEYS.includes(spec.name)).map((spec) => t(spec.label));
  const ready = FIRST_KEYS.slice(0, 1).every((name) => keyState(install, name).set && keyState(install, name).status !== "failed");

  if (loading) return <p className="flex items-center gap-2 text-sm text-muted"><Spinner className="size-3.5" />{t("Reading your keys")}</p>;
  if (loadError) {
    return (
      <ErrorNote title={t("Couldn't load your keys")} className="mb-0">
        <p>{t(loadError)}</p>
        <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={retry}>{t("Try again")}</Button>
      </ErrorNote>
    );
  }
  return (
    <>
      {first.map((spec) => (
        <KeyField key={spec.name} spec={spec} state={keyState(install, spec.name)} tag={spec.required ? "Required" : "Recommended"} onSaved={saved(spec.name)} />
      ))}
      <p className="text-sm text-muted">{t("You can add the rest later in Settings, when you need them: {keys}.", { keys: new Intl.ListFormat(intl, { type: "conjunction" }).format(later) })}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onDone} disabled={!ready}>{t("Continue")}</Button>
        {!ready && <span className="text-sm text-muted">{t("Save your OpenAI key to continue.")}</span>}
      </div>
    </>
  );
}
