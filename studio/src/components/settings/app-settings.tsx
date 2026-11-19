"use client";
// Settings → one app: its connections (the accounts its pages work from: IDs only, keys are under
// API keys) and its danger zone (delete the app). Each connection saves on its own.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { refresh, useCached } from "@/lib/client-cache";
import type { ProductRow } from "@/lib/db";
import { useHydrated } from "@/lib/install/use-install";
import { CONNECTION_FIELDS, CONNECTION_KEYS, workspaceHref, type ConnectionKey, type WorkspaceView } from "@/lib/workspace-schema";
import { Skeleton, SkeletonForm } from "../skeleton";
import { Button, ButtonLink, Card, cx, ErrorNote, Field, inputClass, SettingsGroup, SettingsRow, Spinner } from "../ui";
import { ConnectionBadge, isWorkspace, useWorkspace } from "../workspace/parts";
import { api, SettingsPage } from "./settings-ui";

type Patch = { connections?: Partial<Record<ConnectionKey, Record<string, string>>> };
type Save = (section: string, patch: Patch) => Promise<string | null>;

export function AppSettings({ id }: { id: string }) {
  const [list] = useCached<ProductRow[]>("/api/products");
  // The sidebar loads the same list first; the title starts as the server drew it (lib/install/use-install.ts).
  const hydrated = useHydrated();
  const products = hydrated && Array.isArray(list) ? list : undefined;
  const product = products?.find((p) => p.id === id);
  return (
    <SettingsPage title={product?.name ?? "App settings"} description="The accounts this app's pages work from, and deleting the app.">
      <section>
        <div className="mb-2.5 flex items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-medium">Connections</h2>
            <p className="mt-0.5 max-w-xl text-sm text-muted">Only IDs go here. The keys and tokens that use them are set once for the whole workspace, under <Link href="/app/settings/keys" className="font-medium text-accent hover:underline">API keys</Link>.</p>
          </div>
          <ButtonLink href={workspaceHref(id)} variant="secondary" size="sm">Open app</ButtonLink>
        </div>
        <AppConnections id={id} />
      </section>
      <DangerZone id={id} product={product} products={products} />
    </SettingsPage>
  );
}

// MARK: Connections

export function AppConnections({ id }: { id: string }) {
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
    if (!workspace || !("error" in workspace)) return <Skeleton label="Loading connections" className="grid gap-4"><SkeletonForm fields={4} /><SkeletonForm fields={2} /></Skeleton>;
    return <ErrorNote title="The connections didn't load">{workspace.error}</ErrorNote>;
  }

  const props = { id, workspace, save, saved };
  return (
    <div className="grid gap-4">
      {CONNECTION_KEYS.map((key) => <ConnectionCard key={`${key}-${JSON.stringify(workspace.connections[key] ?? {})}`} connection={key} {...props} />)}
    </div>
  );
}

type CardProps = { id: string; workspace: WorkspaceView; save: Save; saved: string | null };

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
      <p className="mt-0.5 text-sm text-muted">{blurb}</p>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

function SaveRow({ form, justSaved, children }: { form: { dirty: boolean; busy: boolean; error: string; submit: () => void; reset: () => void }; justSaved: boolean; children?: ReactNode }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
      <p role="status" className={cx("mr-auto text-sm", form.error ? "text-warn" : "text-win")}>{form.error || (justSaved && !form.dirty ? "Saved" : "")}</p>
      {children}
      {form.dirty && <Button variant="ghost" size="sm" onClick={form.reset} disabled={form.busy}>Discard</Button>}
      <Button size="sm" onClick={form.submit} disabled={!form.dirty || form.busy}>{form.busy && <Spinner className="size-3.5" />}Save</Button>
    </div>
  );
}

function ConnectionCard({ id, workspace, save, saved, connection }: CardProps & { connection: ConnectionKey }) {
  const spec = CONNECTION_FIELDS[connection];
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
    if (!result.ok) setNote(result.error);
    else if (result.data.result?.pending) { setNote(result.data.result.message ?? "The check is still running."); setNeedsKey(/API keys/.test(result.data.result.message ?? "")); }
    else await refresh(`/api/workspaces/${id}`).catch(() => {});
    setChecking(false);
  }

  const message = note ?? (status.message ? `${status.message}${status.checkedAt ? ` Checked ${new Date(status.checkedAt).toLocaleString()}.` : ""}` : null);
  return (
    <Section title={spec.label} blurb={spec.blurb} badge={<ConnectionBadge status={status} />}>
      <div className="grid gap-4 @xl:grid-cols-2">
        {spec.fields.map((field) => (
          <Field key={field.key} label={field.label} hint={field.hint}>
            <input className={cx(inputClass, "font-mono text-xs")} value={form.draft[field.key]} onChange={(e) => form.set({ [field.key]: e.target.value })} placeholder={field.placeholder} spellCheck={false} autoComplete="off" />
          </Field>
        ))}
      </div>
      {message && <p className={cx("mt-3 text-sm", status.failed && !note ? "text-warn" : "text-muted")}>{message}{note && needsKey && <> <Link href="/app/settings/keys" className="font-medium text-accent hover:underline">Open API keys</Link></>}</p>}
      <SaveRow form={form} justSaved={saved === connection}>
        {status.state !== "not_set" && (
          <Button variant="secondary" size="sm" onClick={verify} disabled={checking || form.dirty} title={form.dirty ? "Save first" : undefined}>{checking && <Spinner className="size-3.5" />}Verify</Button>
        )}
      </SaveRow>
    </Section>
  );
}

// MARK: Danger zone

function DangerZone({ id, product, products }: { id: string; product: ProductRow | undefined; products: ProductRow[] | undefined }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = product?.name ?? "";
  const matches = Boolean(name) && typed.trim() === name.trim();

  async function remove() {
    if (!matches) return;
    setBusy(true); setError("");
    const result = await api<{ deleted: boolean }>(`/api/products/${id}`, "DELETE");
    if (!result.ok) { setBusy(false); return setError(result.error); }
    const rest = await refresh<ProductRow[]>("/api/products").catch(() => undefined);
    refresh("/api/workspaces").catch(() => {});
    const next = (Array.isArray(rest) ? rest : products ?? []).find((p) => p.id !== id);
    router.replace(next ? workspaceHref(next.id) : "/app/product/new");
  }

  return (
    <SettingsGroup title="Danger zone">
      {product?.is_primary ? (
        <SettingsRow label="Delete app" description="This is your main app, so it can't be deleted. You can change everything about it on its Brand page." >
          <ButtonLink href={workspaceHref(id, "brand")} variant="secondary" size="sm">Open Brand</ButtonLink>
        </SettingsRow>
      ) : (
        <SettingsRow label="Delete app" description="Deletes the app with its brand, research, creatives and connections. This can't be undone."
          below={product ? (
            <form onSubmit={(event) => { event.preventDefault(); void remove(); }} className="mt-3 flex flex-wrap items-end gap-2">
              <label className="flex min-w-0 flex-[1_1_240px] flex-col gap-1.5">
                <span className="text-xs text-label">Type <span className="font-medium text-ink">{name}</span> to confirm</span>
                <input className={inputClass} value={typed} onChange={(event) => { setTyped(event.target.value); setError(""); }} autoComplete="off" spellCheck={false} disabled={busy} />
              </label>
              <Button type="submit" variant="danger" disabled={!matches || busy}>{busy && <Spinner className="size-3.5" />}Delete app</Button>
              {error && <p role="alert" className="basis-full text-sm text-warn">{error}</p>}
            </form>
          ) : null} />
      )}
    </SettingsGroup>
  );
}
