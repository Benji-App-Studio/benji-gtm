"use client";
// An app's settings, Connections and Advanced tabs (components/brand/brand-view.tsx draws the page):
// the accounts its pages work from (IDs only; keys are under Your keys), where its files go, and its
// danger zone (delete the app). Each connection saves on its own.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { repoFileUrl } from "@/lib/brand-config";
import { refresh, useCached } from "@/lib/client-cache";
import { useT } from "@/lib/i18n/client";
import { connectionMessage } from "./connection-words";
import { syncMessage } from "../measure/sync-words";
import { isPerAppBase, keySpec, PER_APP_KEYS, perAppKeyName } from "@/lib/install/key-catalog";
import { isAccountsMode } from "@/lib/install/types";
import { canManage, useInstall } from "@/lib/install/use-install";
import type { ProductRow } from "@/lib/db";
import { CONNECTION_FIELDS, CONNECTION_KEYS, workspaceHref, type ConnectionKey, type WorkspaceView } from "@/lib/workspace-schema";
import { useHydrated } from "@/lib/install/use-install";
import { IconExternal } from "../icons";
import { rich } from "../rich";
import { Skeleton, SkeletonForm } from "../skeleton";
import { Button, Card, cx, ErrorNote, Field, inputClass, SettingsGroup, SettingsRow, Spinner } from "../ui";
import { ConnectionBadge, isWorkspace, useWorkspace } from "../workspace/parts";
import { api, sayError } from "./settings-ui";
import { toast } from "../dialog";
import { confirmWordMatches } from "@/lib/confirm-word";
import { m } from "@/lib/i18n/translate";

type Patch = { connections?: Partial<Record<ConnectionKey, Record<string, string>>> };
type Save = (section: string, patch: Patch) => Promise<string | null>;

/**
 * App settings' Connections tab: the accounts this app's pages work from. Only IDs go here; the keys that
 * use them are set once, under Your keys. `only` limits the cards (Advanced shows the storage card alone).
 */
export function AppConnectionsPanel({ id, only }: { id: string; only?: ConnectionKey[] }) {
  const { t } = useT();
  return (
    <section>
      {!only && <p className="mb-4 max-w-xl text-xs text-muted">{rich(t("Only IDs go here. The keys that use them are added once, under {keys}."), { keys: <Link href="/app/settings/keys" className="font-medium text-accent hover:underline">{t("Your keys")}</Link> })}</p>}
      <AppConnections id={id} only={only ?? CONNECTION_KEYS.filter((key) => key !== "storage")} />
    </section>
  );
}

/** App settings' Advanced tab: where the app's files go, then deleting the app. */
export function AppAdvanced({ id }: { id: string }) {
  const { t } = useT();
  // Accounts mode: files go to the account's own space; only the optional Drive folder (the account's own Google key) is theirs to set.
  const accounts = isAccountsMode(useInstall().install);
  const [list] = useCached<ProductRow[]>("/api/products");
  const hydrated = useHydrated();
  const products = hydrated && Array.isArray(list) ? list : undefined;
  const product = products?.find((p) => p.id === id);
  return (
    <div className="grid gap-10">
      <section>
        <h2 className="text-group font-medium">{t("Where files go")}</h2>
        <p className="mt-0.5 mb-4 max-w-xl text-xs text-muted">{accounts ? t("Optional. Most people don't need this: add a Google Drive folder to share finished creatives there.") : t("Leave these empty unless you want this app's files in a folder of your own.")}</p>
        <AppConnections id={id} only={["storage"]} hideFields={accounts ? ["supabasePrefix"] : undefined} />
      </section>
      <DangerZone id={id} product={product} products={products} />
    </div>
  );
}

// MARK: Connections

export function AppConnections({ id, only = CONNECTION_KEYS, hideFields }: { id: string; only?: ConnectionKey[]; /** Fields left out of the cards (an install's own settings, in accounts mode). */ hideFields?: string[] }) {
  const { t } = useT();
  const [cached, reload] = useWorkspace(id);
  const workspace = useHydrated() ? cached : undefined;
  const [saved, setSaved] = useState<string | null>(null);

  /** Saves part of the app's settings; returns an error message, or null when it worked. */
  const save: Save = async (section, patch) => {
    const result = await api<WorkspaceView>(`/api/workspaces/${id}`, "PATCH", patch);
    if (!result.ok) return result.error;
    await reload().catch(() => {});
    refresh("/api/workspaces").catch(() => {});
    setSaved(section);
    return null;
  };

  if (!isWorkspace(workspace)) {
    if (!workspace || !("error" in workspace)) return <Skeleton label={t("Loading connections")} className="grid gap-4"><SkeletonForm fields={4} /><SkeletonForm fields={2} /></Skeleton>;
    return <ErrorNote title={t("The connections didn't load")}>{sayError(t, workspace.error)}</ErrorNote>;
  }

  const props = { id, workspace, save, saved, hideFields };
  return (
    <div className="grid gap-3">
      {only.map((key) => (PLUG_IN[key]
        // Keyed by the source alone: Connect saves the IDs half-way through and must keep its progress.
        ? <PlugInCard key={key} connection={key} keyName={PLUG_IN[key]!} {...props} />
        : <ConnectionCard key={`${key}-${JSON.stringify(workspace.connections[key] ?? {})}`} connection={key} {...props} />))}
    </div>
  );
}

type CardProps = { id: string; workspace: WorkspaceView; save: Save; saved: string | null; hideFields?: string[] };

/** A card's draft: the values being edited, whether they differ from what's saved, and saving them. */
function useDraft<T>(initial: T, section: string, save: Save, toPatch: (draft: T) => Patch) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  return {
    draft, dirty, busy, error,
    set: (patch: Partial<T>) => { setDraft((d) => ({ ...d, ...patch })); setError(""); },
    reset: () => { setDraft(initial); setError(""); },
    submit: async () => {
      setBusy(true); setError("");
      const failed = await save(section, toPatch(draft));
      setBusy(false);
      if (failed) setError(failed);
    },
  };
}

function Section({ title, blurb, badge, children }: { title: string; blurb: ReactNode; badge?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {badge}
      </div>
      <p className="mt-0.5 text-caption text-muted">{blurb}</p>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

function SaveRow({ form, justSaved, children }: { form: { dirty: boolean; busy: boolean; error: string; submit: () => void; reset: () => void }; justSaved: boolean; children?: ReactNode }) {
  const { t } = useT();
  return (
    <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
      <p role="status" className={cx("mr-auto text-sm", form.error ? "text-warn" : "text-win")}>{(form.error && sayError(t, form.error)) || (justSaved && !form.dirty ? t("Saved") : "")}</p>
      {children}
      {form.dirty && <Button variant="ghost" size="sm" onClick={form.reset} disabled={form.busy}>{t("Discard")}</Button>}
      <Button size="sm" onClick={form.submit} disabled={!form.dirty || form.busy}>{form.busy && <Spinner className="size-3.5" />}{t("Save")}</Button>
    </div>
  );
}

function ConnectionCard({ id, workspace, save, saved, connection, hideFields }: CardProps & { connection: ConnectionKey }) {
  const tr = useT();
  const { t, intl } = tr;
  const all = CONNECTION_FIELDS[connection];
  const spec = hideFields?.length ? { ...all, fields: all.fields.filter((f) => !hideFields.includes(f.key)) } : all;
  const values = (workspace.connections[connection] ?? {}) as Record<string, string | undefined>;
  const status = workspace.status[connection];
  const form = useDraft(Object.fromEntries(spec.fields.map((f) => [f.key, values[f.key] ?? ""])) as Record<string, string>, connection, save, (d) => ({ connections: { [connection]: d } }));
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** The check couldn't run because a key is missing: the note then links to where keys are added. */
  const [needsKey, setNeedsKey] = useState(false);

  async function verify() {
    setChecking(true); setNote(null); setNeedsKey(false);
    const result = await api<{ result?: { pending?: boolean; message?: string } }>(`/api/workspaces/${id}/verify`, "POST", { connection });
    if (!result.ok) setNote(sayError(t, result.error));
    else if (result.data.result?.pending) { setNote(result.data.result.message ? connectionMessage(result.data.result.message, tr) : t("The check is still running.")); setNeedsKey(/API keys|Your keys/.test(result.data.result.message ?? "")); }
    else await refresh(`/api/workspaces/${id}`).catch(() => {});
    setChecking(false);
  }

  const message = note ?? (status.message ? `${connectionMessage(status.message, tr)}${status.checkedAt ? ` ${t("Checked {when}.", { when: new Date(status.checkedAt).toLocaleString(intl) })}` : ""}` : null);
  return (
    <Section title={t(spec.label)} blurb={t(spec.blurb)} badge={<ConnectionBadge status={status} />}>
      <div className="grid gap-4 @xl:grid-cols-2">
        {spec.fields.map((field) => (
          <Field key={field.key} label={t(field.label)} hint={t(field.hint)}>
            <input className={cx(inputClass, "font-mono text-xs")} value={form.draft[field.key]} onChange={(e) => form.set({ [field.key]: e.target.value })} placeholder={field.placeholder} spellCheck={false} autoComplete="off" />
          </Field>
        ))}
      </div>
      {message && <p className={cx("mt-3 text-sm", status.failed && !note ? "text-warn" : "text-muted")}>{message}{note && needsKey && <> <Link href="/app/settings/keys" className="font-medium text-accent hover:underline">{t("Open your keys")}</Link></>}</p>}
      <SaveRow form={form} justSaved={saved === connection}>
        {status.state !== "not_set" && (
          <Button variant="secondary" size="sm" onClick={verify} disabled={checking || form.dirty} title={form.dirty ? t("Save first") : undefined}>{checking && <Spinner className="size-3.5" />}{t("Verify")}</Button>
        )}
      </SaveRow>
    </Section>
  );
}

// MARK: Plug in and go (Measure's sources)

/** The sources whose card takes the key too: paste it and the IDs, then one button checks and loads. */
const PLUG_IN: Partial<Record<ConnectionKey, string>> = {
  revenuecat: "REVENUECAT_API_KEY", superwall: "SUPERWALL_API_KEY", mixpanel: "MIXPANEL_SERVICE_ACCOUNT", appstack: "APPSTACK_API_KEY",
};
/** Fields tucked under "Event names" (Mixpanel's mapping has sensible defaults). */
const ADVANCED = /Event$|^funnelId$/;
/** After a card's sync, its Connect button rests this long (the edge function also answers a repeat from its last result). */
const COOLDOWN_MS = 60_000;

type Phase = { step: "idle" } | { step: "working"; text: string } | { step: "done"; text: string } | { step: "failed"; text: string; keys?: boolean };

/**
 * One card per Measure source: the key (when it isn't set, or to replace it), the IDs, and Connect.
 * Connect saves the key (checked by the provider on save), saves the IDs, checks the connection with a
 * real read, then loads the last 90 days, so the source's charts are on Measure when it says so.
 */
function PlugInCard({ id, workspace, save, saved, connection, keyName }: CardProps & { connection: ConnectionKey; keyName: string }) {
  const tr = useT();
  const { t, intl } = tr;
  const spec = CONNECTION_FIELDS[connection];
  const key = keySpec(keyName);
  const [restUntil, setRestUntil] = useState(0);
  const { install, refresh: refreshInstall } = useInstall();
  const owner = canManage(install);
  const values = (workspace.connections[connection] ?? {}) as Record<string, string | undefined>;
  const status = workspace.status[connection];
  const form = useDraft(Object.fromEntries(spec.fields.map((f) => [f.key, values[f.key] ?? ""])) as Record<string, string>, connection, save, (d) => ({ connections: { [connection]: d } }));
  // RevenueCat and AppStack keys can be this app's own (a RevenueCat key reads one project): with the ID
  // filled in, a key pasted here is saved as this app's key, and this app's key wins over the default.
  const appId = isPerAppBase(keyName) ? (form.draft[PER_APP_KEYS[keyName]] ?? "").trim() : "";
  const ownName = isPerAppBase(keyName) && appId ? perAppKeyName(keyName, appId) : null;
  const ownState = ownName ? install?.keys[ownName] : undefined;
  const keyState = ownState?.set ? ownState : install?.keys[keyName];
  const keySet = Boolean(keyState?.set);
  const saveAs = ownName ?? keyName;
  const [secret, setSecret] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const busy = phase.step === "working" || form.busy;
  const resting = restUntil > 0 && !form.dirty && !secret;
  const showKey = owner && (!keySet || replacing);
  const main = spec.fields.filter((f) => !ADVANCED.test(f.key));
  const advanced = spec.fields.filter((f) => ADVANCED.test(f.key));
  const hasIds = main.some((f) => (form.draft[f.key] ?? "").trim());

  async function connect() {
    setPhase({ step: "working", text: t("Saving…") });
    if (secret.trim()) {
      const stored = await api<{ key: { status: string; message: string | null } }>(`/api/install/keys/${encodeURIComponent(saveAs)}`, "PUT", { value: secret.trim() });
      if (!stored.ok) return setPhase({ step: "failed", text: sayError(t, stored.error) });
      setSecret(""); setReplacing(false);
      await refreshInstall();
    }
    if (form.dirty) {
      const failed = await save(connection, { connections: { [connection]: form.draft } });
      if (failed) return setPhase({ step: "failed", text: failed });
    }
    setPhase({ step: "working", text: t("Checking the connection…") });
    const checked = await api<{ result?: { ok?: boolean; pending?: boolean; message?: string } }>(`/api/workspaces/${id}/verify`, "POST", { connection });
    if (!checked.ok) return setPhase({ step: "failed", text: sayError(t, checked.error) });
    const result = checked.data.result;
    await refresh(`/api/workspaces/${id}`).catch(() => {});
    if (result?.pending) return setPhase({ step: "failed", text: result.message ? connectionMessage(result.message, tr) : t("The check couldn't run yet."), keys: /API keys|Your keys/.test(result.message ?? "") });
    if (!result?.ok) return setPhase({ step: "failed", text: result?.message ? connectionMessage(result.message, tr) : t("The check failed.") });
    setPhase({ step: "working", text: t("Connected, loading the last 90 days…") });
    // Only this card's source: a 90-day read of every source would spend the others' rate limits.
    const synced = await api<Record<string, { status?: string; message?: string }>>(`/api/w/${id}/measure/sync`, "POST", { days: 90, sources: [connection] });
    const mine = synced.ok ? synced.data[connection] : null;
    if (!synced.ok || mine?.status === "error") return setPhase({ step: "failed", text: synced.ok ? (mine?.message ? syncMessage(mine.message, tr) : t("The first sync failed.")) : sayError(t, synced.error) });
    refresh(`/api/w/${id}/business`).catch(() => {});
    setRestUntil(Date.now() + COOLDOWN_MS);
    window.setTimeout(() => setRestUntil(0), COOLDOWN_MS);
    setPhase({ step: "done", text: mine?.message ? t("Connected. {details}", { details: syncMessage(mine.message, tr) }) : t("Connected. The last 90 days are loaded.") });
  }

  const message = phase.step !== "idle" ? phase.text
    : status.message ? `${connectionMessage(status.message, tr)}${status.checkedAt ? ` ${t("Checked {when}.", { when: new Date(status.checkedAt).toLocaleString(intl) })}` : ""}` : null;
  const input = (field: (typeof spec.fields)[number]) => (
    <Field key={field.key} label={t(field.label)} hint={t(field.hint)}>
      <input className={cx(inputClass, "font-mono text-xs")} value={form.draft[field.key]} onChange={(e) => { form.set({ [field.key]: e.target.value }); setPhase({ step: "idle" }); }} placeholder={field.placeholder} spellCheck={false} autoComplete="off" />
    </Field>
  );
  return (
    <Section title={t(spec.label)} blurb={t(spec.blurb)} badge={<ConnectionBadge status={status} />}>
      <div className="grid gap-4 @xl:grid-cols-2">
        <Field label={key ? t("{name} key", { name: key.label }) : t("Key")} hint={key ? t(key.hint) : undefined}>
          {showKey ? (
            <input type="password" className={cx(inputClass, "font-mono text-xs")} value={secret} onChange={(e) => { setSecret(e.target.value); setPhase({ step: "idle" }); }}
              placeholder={key ? t(key.hint) : ""} spellCheck={false} autoComplete="off" aria-label={t("{name} key", { name: key?.label ?? spec.label })} />
          ) : (
            <span className="flex min-h-7 flex-wrap items-center gap-2 text-sm">
              {keySet
                ? <><span className="text-ink">{t("Set")}{keyState?.last4 ? <span className="font-mono text-xs text-muted"> ····{keyState.last4}</span> : null}</span>{owner && <button type="button" onClick={() => setReplacing(true)} className="rounded-xs text-xs font-medium text-accent hover:underline">{t("Replace")}</button>}</>
                : <span className="text-muted">{t("Not set. Ask the owner of this workspace to add it.")}</span>}
            </span>
          )}
        </Field>
        {main.map(input)}
      </div>
      {key && (
        <p className="mt-2 text-xs text-muted">
          <a href={repoFileUrl(key.guide)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">{t("How to get the {name} key and IDs, step by step", { name: key.label })}<IconExternal className="size-3" /></a>
        </p>
      )}
      {advanced.length > 0 && (
        <details className="mt-3 rounded-inner border border-line px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium select-none">{t("Event names (optional)")}</summary>
          <p className="mt-1 text-caption text-muted">{t("Leave a field empty to use the name shown in it. Names must match Mixpanel exactly, including capitals.")}</p>
          <div className="mt-3 grid gap-4 @xl:grid-cols-2">{advanced.map(input)}</div>
        </details>
      )}
      {message && (
        <p role="status" className={cx("mt-3 flex items-center gap-2 text-sm", phase.step === "failed" || (phase.step === "idle" && status.failed) ? "text-warn" : phase.step === "done" ? "text-win" : "text-muted")}>
          {phase.step === "working" && <Spinner className="size-3.5" />}
          <span>{message}{phase.step === "failed" && phase.keys && <> <Link href="/app/settings/keys" className="font-medium text-accent hover:underline">{t("Open your keys")}</Link></>}
            {phase.step === "done" && <> <Link href={workspaceHref(id, "measure")} className="font-medium text-accent hover:underline">{t("Open Measure")}</Link></>}</span>
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
        <p role="status" className="mr-auto text-sm text-win">{saved === connection && !form.dirty && phase.step === "idle" ? t("Saved") : ""}</p>
        {(form.dirty || secret) && <Button variant="ghost" size="sm" onClick={() => { form.reset(); setSecret(""); setReplacing(false); setPhase({ step: "idle" }); }} disabled={busy}>{t("Discard")}</Button>}
        <Button size="sm" onClick={() => void connect()} disabled={busy || resting || !hasIds || (!keySet && !secret.trim() && owner)}
          title={!hasIds ? t("Add the IDs first") : resting ? t("Just synced. Try again in a minute.") : undefined}>{busy && <Spinner className="size-3.5" />}{status.state === "verified" && !form.dirty && !secret ? t("Check and sync again") : t("Connect")}</Button>
      </div>
    </Section>
  );
}

// MARK: Danger zone

function DangerZone({ id, product, products }: { id: string; product: ProductRow | undefined; products: ProductRow[] | undefined }) {
  const { t } = useT();
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = product?.name ?? "";
  // A short fixed word confirms it (in the viewer's language, or DELETE in English), not the app's whole
  // name, which can run to 80 characters.
  const word = t("DELETE");
  const matches = Boolean(product) && confirmWordMatches(typed, word);

  async function remove() {
    if (!matches) return;
    setBusy(true); setError("");
    const result = await api<{ deleted: boolean }>(`/api/products/${id}`, "DELETE");
    if (!result.ok) { setBusy(false); return setError(sayError(t, result.error)); }
    const rest = await refresh<ProductRow[]>("/api/products").catch(() => undefined);
    refresh("/api/workspaces").catch(() => {});
    const next = (Array.isArray(rest) ? rest : products ?? []).find((p) => p.id !== id);
    toast(name ? m("{name} was deleted.") : m("The app was deleted."), name ? { name } : undefined);
    router.replace(next ? workspaceHref(next.id) : "/app/product/new");
  }

  return (
    <SettingsGroup title={t("Danger zone")}>
      {product?.is_primary ? (
        <SettingsRow label={t("Delete app")} description={t("This is your main app, so it can't be deleted. You can change everything about it on the other tabs.")} />
      ) : (
        <SettingsRow label={t("Delete app")} description={t("Deletes the app with its brand, research, creatives and connections, and removes its files from storage (creatives, saved ad media, uploads), which frees their space. This can't be undone.")}
          below={product ? (
            <form onSubmit={(event) => { event.preventDefault(); void remove(); }} className="mt-3 flex flex-wrap items-end gap-2">
              <label className="flex min-w-0 flex-[1_1_240px] flex-col gap-1.5">
                <span className="text-xs text-label">{rich(t("Type {word} to delete {name}"), { word: <span className="font-mono font-medium text-ink">{word}</span>, name: <span className="font-medium text-ink [overflow-wrap:anywhere]">{name}</span> })}</span>
                <input className={inputClass} value={typed} onChange={(event) => { setTyped(event.target.value); setError(""); }} autoComplete="off" spellCheck={false} disabled={busy} />
              </label>
              <Button type="submit" variant="danger" disabled={!matches || busy}>{busy && <Spinner className="size-3.5" />}{t("Delete app")}</Button>
              {error && <p role="alert" className="basis-full text-sm text-warn">{error}</p>}
            </form>
          ) : null} />
      )}
    </SettingsGroup>
  );
}
