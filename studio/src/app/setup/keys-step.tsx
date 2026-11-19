"use client";
// Step 5 of the checklist: the keys the app needs to do its work. The fields come from the key
// catalogue; saving goes through /api/install, where the backend checks the key live before storing
// it in the project's Vault.
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, ErrorNote, Field, inputClass, Spinner } from "@/components/ui";
import { KEY_CATALOG, type KeySpec } from "@/lib/install/key-catalog";
import { keyState, type InstallState, type KeyState } from "@/lib/install/types";
import { OutLink, Steps } from "./parts";

const FIRST_KEYS = ["OPENAI_API_KEY", "APIFY_TOKEN"];

function KeyField({ spec, state, tag, onSaved }: { spec: KeySpec; state: KeyState; tag: "Required" | "Recommended"; onSaved: (key: KeyState) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/install/keys/${spec.name}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: value.trim() }) });
      const data = (await response.json().catch(() => null)) as { key?: KeyState; error?: string } | null;
      if (!response.ok || !data?.key) setError(data?.error ?? "The key couldn't be saved. Try again.");
      else { onSaved(data.key); setValue(""); }
    } catch {
      setError("Couldn't reach the app. Check that it is still running, then try again.");
    }
    setBusy(false);
  }

  return (
    <div className="rounded-inner border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{spec.label}</h3>
        <span className="flex items-center gap-2">
          <Badge tone={tag === "Required" ? "caution" : "neutral"}>{tag}</Badge>
          {state.set && <Badge tone={state.status === "failed" ? "warn" : "win"}>{state.status === "failed" ? "Check failed" : "Saved"}</Badge>}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">{spec.unlocks}</p>
      <div className="mt-3 space-y-3">
        <Steps>
          <li>Open <OutLink href={spec.getUrl}>{spec.label}</OutLink>.</li>
          {spec.steps.map((step) => <li key={step}>{step}</li>)}
        </Steps>
        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-64">
            <Field label={`${spec.label} key`} hint={spec.hint}>
              <input className={inputClass} type="password" autoComplete="off" spellCheck={false} value={value} onChange={(event) => setValue(event.target.value)}
                placeholder={state.set && state.last4 ? `Saved, ends in ${state.last4}. Paste a new key to replace it.` : "Paste the key here"} />
            </Field>
          </div>
          <Button type="submit" disabled={busy || !value.trim()} className="mb-[22px]">{busy ? <><Spinner className="size-3.5" />Checking</> : "Check and save"}</Button>
        </form>
        {error && <p role="alert" className="text-sm text-warn">{error}</p>}
        {!error && state.set && state.status === "ok" && <p className="text-sm text-win">This key works. It is saved in your project{state.last4 ? ` (ends in ${state.last4})` : ""}.</p>}
        {!error && state.set && state.status === "unverified" && <p className="text-sm text-muted">Saved{state.last4 ? ` (ends in ${state.last4})` : ""}. It hasn&apos;t been checked yet.</p>}
        {!error && state.set && state.status === "failed" && <p className="text-sm text-warn">{state.message ?? "The last check of this key failed. Paste a new key."}</p>}
      </div>
    </div>
  );
}

async function readInstall(): Promise<{ install: InstallState | null; error: string }> {
  try {
    const response = await fetch("/api/install", { cache: "no-store" });
    const data = (await response.json().catch(() => null)) as (InstallState & { error?: string }) | null;
    if (!response.ok || !data?.keys) return { install: null, error: data?.error ?? "Couldn't read which keys are set. Try again." };
    return { install: data, error: "" };
  } catch {
    return { install: null, error: "Couldn't reach the app. Check that it is still running, then try again." };
  }
}

export function KeysStep({ onDone }: { onDone: () => void }) {
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
  const later = KEY_CATALOG.filter((spec) => !FIRST_KEYS.includes(spec.name)).map((spec) => spec.label);
  const ready = FIRST_KEYS.slice(0, 1).every((name) => keyState(install, name).set && keyState(install, name).status !== "failed");

  if (loading) return <p className="flex items-center gap-2 text-sm text-muted"><Spinner className="size-3.5" />Reading your keys</p>;
  if (loadError) {
    return (
      <ErrorNote title="Couldn't load your keys" className="mb-0">
        <p>{loadError}</p>
        <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={retry}>Try again</Button>
      </ErrorNote>
    );
  }
  return (
    <>
      {first.map((spec) => (
        <KeyField key={spec.name} spec={spec} state={keyState(install, spec.name)} tag={spec.required ? "Required" : "Recommended"} onSaved={saved(spec.name)} />
      ))}
      <p className="text-sm text-muted">You can add the rest later in Settings, when you need them: {later.join(", ")}.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onDone} disabled={!ready}>Continue</Button>
        {!ready && <span className="text-sm text-muted">Save your OpenAI key to continue.</span>}
      </div>
    </>
  );
}
