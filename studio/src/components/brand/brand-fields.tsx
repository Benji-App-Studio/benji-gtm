"use client";
// The small pieces the Brand page's tabs share: sections, text and list fields, a remove button, a
// fact's source (where it was checked and when), and the uploads (fonts to the brand route's signed URL; the logo and screenshots to the workspace's
// brand folder in Storage).
import type { ReactNode } from "react";
import { FACT_SOURCE_KINDS, isVerified, sourceAgeDays, type FactSource, type FactSourceKind } from "@/lib/brand-system";
import { createClient } from "@/lib/supabase/client";
import { uploadErrorText } from "@/lib/storage-usage";
import { useT } from "@/lib/i18n/client";
import { fill, type Translator } from "@/lib/i18n/translate";
import { IconX } from "../icons";
import { Badge, Button, Card, cx, Field, inputClass } from "../ui";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const IMAGE_MAX_BYTES = 15 * 1024 * 1024;

const lines = (v: string[]) => v.join("\n");
const unlines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);

/** An always-open block: a title, a short hint and an optional count on the right. */
export function Block({ title, hint, count, children }: { title: string; hint: ReactNode; count?: string; children: ReactNode }) {
  return (
    <Card className="grid gap-3 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="grid gap-0.5"><span className="text-sm font-medium">{title}</span><span className="text-xs text-muted">{hint}</span></span>
        {count && <span className="shrink-0 text-xs text-muted">{count}</span>}
      </div>
      {children}
    </Card>
  );
}

/** A collapsible block, closed unless `open`. */
export function Section({ title, hint, children, open = false, count }: { title: string; hint: string; children: ReactNode; open?: boolean; count?: string }) {
  return (
    <details open={open} className="group rounded-card border border-line bg-card">
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 px-4 py-3">
        <span className="grid gap-0.5"><span className="text-sm font-medium">{title}</span><span className="text-xs text-muted">{hint}</span></span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted">{count}<span className="transition group-open:rotate-180">⌄</span></span>
      </summary>
      <div className="grid gap-3 border-t border-line px-4 py-4">{children}</div>
    </details>
  );
}

export function ListField({ label, hint, value, onChange, rows = 3 }: { label: string; hint?: string; value: string[]; onChange: (v: string[]) => void; rows?: number }) {
  const { t } = useT();
  return (
    <Field label={label} hint={hint ?? t("One per line.")}>
      <textarea className={cx(inputClass, "min-h-0")} rows={rows} value={lines(value)} onChange={(e) => onChange(e.target.value.split("\n"))} onBlur={(e) => onChange(unlines(e.target.value))} />
    </Field>
  );
}

export const Text = ({ label, hint, value, onChange, area, rows = 2, max = 1200, placeholder }: { label: string; hint?: string; value: string; onChange: (v: string) => void; area?: boolean; rows?: number; max?: number; placeholder?: string }) => (
  <Field label={label} hint={hint}>
    {area
      ? <textarea className={cx(inputClass, "min-h-0")} rows={rows} maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      : <input className={inputClass} maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
  </Field>
);

export const RemoveButton = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button type="button" onClick={onClick} aria-label={label} className="grid size-7 shrink-0 place-items-center rounded-control text-faint hover:bg-hover hover:text-ink"><IconX className="size-3.5" /></button>
);

/** "Live ad · verified 12 days ago", "App Store · not verified" (lib/brand-system.ts sourceLabel, in the page's language). */
function sourceText(source: FactSource | undefined, t: Translator["t"]): string {
  if (!source) return t("No source");
  const kind = t(FACT_SOURCE_KINDS.find((k) => k.id === source.kind)?.label ?? "Source");
  const days = sourceAgeDays(source);
  const age = days === null ? t("not verified") : days === 0 ? t("verified today") : days === 1 ? t("verified yesterday") : t("verified {n} days ago", { n: days });
  return `${kind} · ${age}`;
}

/** A source checked more than this many days ago is shown as stale. */
const STALE_DAYS = 30;

/**
 * Where a fact, price or offer was checked: the kind (live ad, App Store, website, our own records), the
 * link, and the date someone verified it ("Verified today" stamps it). The badge says how long ago.
 */
export function SourceField({ value, onChange, label }: { value?: FactSource; onChange: (v: FactSource | undefined) => void; label?: string }) {
  const { t } = useT();
  const source: FactSource = value ?? { kind: "manual" };
  const set = (patch: Partial<FactSource>) => onChange({ ...source, ...patch });
  const days = sourceAgeDays(value);
  const tone = !value ? "caution" : !isVerified(value) ? "caution" : days !== null && days > STALE_DAYS ? "warn" : "win";
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-label">{label ?? t("Source")}</span>
        <Badge tone={tone}>{sourceText(value, t)}</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className={cx(inputClass, "w-40!")} aria-label={t("Where it was checked")} value={source.kind} onChange={(e) => set({ kind: e.target.value as FactSourceKind })}>
          {FACT_SOURCE_KINDS.map((k) => <option key={k.id} value={k.id}>{t(k.label)}</option>)}
        </select>
        <input className={cx(inputClass, "min-w-48 flex-1")} aria-label={t("Link")} placeholder={t("https://… (the live ad, the App Store page)")} value={source.url ?? ""} onChange={(e) => set({ url: e.target.value })} />
        <input className={cx(inputClass, "w-40!")} type="date" aria-label={t("Verified on")} value={source.verifiedAt?.slice(0, 10) ?? ""} onChange={(e) => set({ verifiedAt: e.target.value || undefined })} />
        <Button size="sm" variant="ghost" onClick={() => set({ verifiedAt: new Date().toISOString() })}>{t("Verified today")}</Button>
        {value && <RemoveButton label={t("Remove the source")} onClick={() => onChange(undefined)} />}
      </div>
    </div>
  );
}

/** Uploads a font file to the product's storage and returns its public URL. `t` words the errors. */
export async function uploadFont(productId: string, file: File, t: Translator["t"] = fill): Promise<string> {
  const ticket = await fetch(`/api/products/${productId}/brand`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "font-ticket", fileName: file.name, size: file.size }) })
    .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({ error: t("Couldn't reach the server. Try again.") })) }));
  if (!ticket.ok) throw new Error(ticket.data.error);
  const { error } = await createClient().storage.from(ticket.data.bucket).uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: ticket.data.contentType });
  if (error) throw new Error(`${file.name}: ${uploadErrorText(error, undefined, t)}`);
  return ticket.data.url as string;
}

/** Uploads the logo (app icon) or a screenshot straight to Storage (the workspace's brand folder) and returns its public URL. */
export async function uploadBrandImage(productId: string, kind: "icon" | "screenshot", file: File, t: Translator["t"] = fill): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error(t("{name} isn't a PNG, JPEG or WebP image.", { name: file.name }));
  if (file.size > IMAGE_MAX_BYTES) throw new Error(t("{name} is over 15 MB.", { name: file.name }));
  const response = await fetch(`/api/workspaces/${productId}/assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, contentType: file.type, size: file.size }) });
  const ticket = await response.json().catch(() => ({ error: t("Couldn't start the upload.") }));
  if (!response.ok) throw new Error(ticket.error);
  const { error } = await createClient().storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
  if (error) throw new Error(`${file.name}: ${uploadErrorText(error, undefined, t)}`);
  return ticket.url as string;
}
