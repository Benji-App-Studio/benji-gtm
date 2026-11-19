"use client";
// Results and review: every creative with its QA verdict, and the panel where a person reads the
// checks (TypeSafe's Jev), fills in the ad copy Launch will use, and approves or rejects it with a note. A creative still
// waiting for its composed text or our logo (`waiting`) can't be approved; one where that failed after
// its retries (`failures`) says so on its card, with a way to try again. Approval rules: lib/creative-review.ts.
// Playground results are reviewed here too (badged "Playground", with a source chip); `openId` comes from
// the Studio so a link (?review=<id>) can open one's panel.
// Ad copy: "Write copy" (on a card, in the panel, or "Write copy for all" for the creatives shown) has
// OpenAI write A (creator voice) and B (brand voice) from the brand's rules (lib/creative-copy.ts); the
// A/B switcher sets the headline, primary text and description Launch uses. QA checks the copy again.
import { COPY_LIMITS, LAYOUTS, layoutById, layoutRoles, unplacedCopy, unplacedNote, type ComposedCopy } from "@/lib/composed-ads";
import { useCallback, useEffect, useRef, useState } from "react";
import { chosenVariant } from "@/lib/creative-copy";
import { KIND_LABEL } from "@/lib/creative-plan";
import { needsHuman, QA_BADGE } from "@/lib/creative-review";
import { CTA_SUGGESTIONS, type BatchRow, type CopyVariant, type CreativeView, type QaCheck, type QaStatus } from "@/lib/creative-types";
import { cleanAwareness } from "@/lib/awareness";
import { AwarenessCoverage } from "./awareness-picker";
import { byOrigin, originOf, type OriginFilter } from "@/lib/studio-sources";
import { ask, notice } from "../dialog";
import { IconX } from "../icons";
import { Badge, Button, ButtonLink, cx, EmptyState, Field, Gear, IconButton, inputClass, segmentClass, segmentTrackClass, Spinner } from "../ui";
import { FeatureLock, type Features } from "./features";
import type { FeatureState } from "@/lib/capabilities";
import { workspaceHref } from "@/lib/workspace-schema";
import { PANEL, PANEL_OVERLAY, PanelPortal } from "../panel-portal";

type Filter = "review" | "approved" | "rejected" | "all";
const QA: Record<QaStatus, (typeof QA_BADGE)[string]> = QA_BADGE;
/**
 * A creative's check on a badge. With no AI connected nothing can be checked: one that is waiting, or
 * whose check stopped for that reason, reads "Not checked" (the lock beside it says what to connect)
 * instead of a failure.
 */
const qaBadge = (status: QaStatus, aiLock: FeatureState | null): (typeof QA_BADGE)[string] =>
  (aiLock && (status === "error" || status === "pending") ? { label: "Not checked", tone: "neutral" } : QA[status]);
const ORIGIN_LABEL: Record<OriginFilter, string> = { all: "All sources", studio: "Studio", playground: "Playground" };
const ASPECT_CLASS: Record<string, string> = { "9:16": "aspect-[9/16]", "4:5": "aspect-[4/5]", "1:1": "aspect-square", "3:4": "aspect-[3/4]", "16:9": "aspect-video" };

function Preview({ creative, controls = false, className }: { creative: CreativeView; controls?: boolean; className?: string }) {
  if (creative.kind === "video") {
    return <video src={creative.url} poster={creative.thumbnail_url ?? undefined} controls={controls} muted={!controls} playsInline preload="metadata" className={cx("h-full w-full bg-console object-contain", className)} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={creative.url} alt={creative.title ?? KIND_LABEL[creative.style]} loading="lazy" className={cx("h-full w-full bg-canvas object-contain", className)} />;
}

interface Work { waiting?: Record<string, string>; failures?: Record<string, string>; onRetryWork?: (id: string) => void }

const NO_PLAYGROUND: ReadonlySet<string> = new Set();
const NO_BATCHES: BatchRow[] = [];
/** "Write copy for all" asks OpenAI this many at a time. */
const COPY_AT_ONCE = 2;

type CopyFields = { headline: string; primary_text: string; description: string };
const fieldsOf = (v: CopyVariant): CopyFields => ({ headline: v.headline, primary_text: v.primary_text, description: v.description });

/**
 * Writing copy and picking a variant, shared by the cards and the review panel: `write` asks the copy
 * route (OpenAI, A and B), `pick` makes one variant the creative's ad copy. Both return the new copy
 * fields (or null when it failed: the reason is shown), then refresh the list.
 */
function useCopyWriter(onChanged: () => void) {
  const [writing, setWriting] = useState<ReadonlySet<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const mark = (id: string, on: boolean) => setWriting((s) => { const next = new Set(s); if (on) next.add(id); else next.delete(id); return next; });

  const request = useCallback(async (id: string, variant?: string): Promise<{ fields?: CopyFields; error?: string }> => {
    const response = await fetch(`/api/studio/creatives/${id}/copy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(variant ? { variant } : {}) }).catch(() => null);
    const data = await response?.json().catch(() => null) as { error?: string; creative?: CreativeView } | null;
    if (!response?.ok || !data?.creative) return { error: data?.error ?? "Couldn't write the copy. Try again." };
    const c = data.creative;
    return { fields: { headline: c.headline ?? "", primary_text: c.primary_text ?? "", description: c.description ?? "" } };
  }, []);

  const write = useCallback(async (id: string, variant?: string) => {
    mark(id, true);
    const result = await request(id, variant);
    mark(id, false);
    if (result.error) { await notice(result.error, "Couldn't write the copy"); return null; }
    onChanged();
    return result.fields ?? null;
  }, [request, onChanged]);

  const writeAll = useCallback(async (ids: string[]) => {
    const ok = await ask({
      title: `Write copy for ${ids.length} creative${ids.length === 1 ? "" : "s"}?`,
      body: "The AI writes two versions of each: A in a creator's voice, B in the brand's, following your brand rules. Version A becomes the ad copy, and it is checked again.",
      confirm: "Write copy",
    });
    if (!ok) return;
    const queue = [...ids];
    const errors: string[] = [];
    setProgress({ done: 0, total: ids.length });
    await Promise.all(Array.from({ length: Math.min(COPY_AT_ONCE, ids.length) }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        mark(id, true);
        const result = await request(id);
        mark(id, false);
        if (result.error) errors.push(result.error);
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
    }));
    setProgress(null);
    onChanged();
    if (errors.length) await notice(`${ids.length - errors.length} written; ${errors.length} didn't: ${errors[0]}`, "Ad copy");
  }, [request, onChanged]);

  const pick = useCallback(async (creative: CreativeView, v: CopyVariant) => {
    const response = await fetch(`/api/studio/creatives/${creative.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fieldsOf(v)) }).catch(() => null);
    if (!response?.ok) { await notice((await response?.json().catch(() => ({})))?.error ?? "Couldn't switch the copy. Try again."); return null; }
    onChanged();
    return fieldsOf(v);
  }, [onChanged]);

  return { writing, progress, write, writeAll, pick };
}

/** Under a card: "Write copy", or the A/B switcher once there's copy (hover a letter to read it). */
function CardCopy({ creative, busy, canWrite, onWrite, onPick }: { creative: CreativeView; busy: boolean; canWrite: boolean; onWrite: () => void; onPick: (v: CopyVariant) => void }) {
  const variants = creative.copy_variants ?? [];
  const chosen = chosenVariant(creative);
  // Nothing to switch between and nothing that could write it: no row.
  if (!variants.length && !canWrite && !busy) return null;
  return (
    <div className="flex items-center gap-1 border-t border-line px-2.5 py-1.5 text-xs">
      {busy ? <span className="flex items-center gap-1 text-muted"><Spinner className="size-3" /> Writing copy…</span>
        : variants.length ? (
          <>
            <span className="mr-1 text-muted">Copy</span>
            {variants.map((v) => (
              <button key={v.label} type="button" aria-pressed={chosen === v.label} onClick={() => onPick(v)} title={`${v.label} · ${v.voice === "creator" ? "creator voice" : "brand voice"}: ${v.primary_text}`}
                className={cx("min-w-6 rounded-full border px-1.5 py-0.5 tabular-nums transition-colors", chosen === v.label ? "border-transparent bg-primary text-on-ink" : "border-hairline text-label hover:bg-hover")}>{v.label}</button>
            ))}
            {canWrite && <button type="button" onClick={onWrite} className="ml-auto rounded-xs font-medium text-accent hover:underline" title="Write both versions again">Rewrite</button>}
          </>
        ) : <button type="button" onClick={onWrite} className="rounded-xs font-medium text-accent hover:underline">Write copy</button>}
    </div>
  );
}

/** A creative's awareness level: its own column, else its batch's (column, then settings.awarenessLevel). */
export function levelOf(c: Pick<CreativeView, "awareness_level" | "batch_id">, batches: Pick<BatchRow, "id" | "settings" | "awareness_level">[]): number | null {
  const batch = batches.find((b) => b.id === c.batch_id);
  return cleanAwareness(c.awareness_level) ?? cleanAwareness(batch?.awareness_level) ?? cleanAwareness(batch?.settings?.awarenessLevel);
}

export function CreativeGallery({ productId, features, creatives, batches = NO_BATCHES, onChanged, waiting = {}, failures = {}, onRetryWork, playgroundBatchIds = NO_PLAYGROUND, openId, onOpen, onSendToMeta }: {
  productId: string; creatives: CreativeView[]; onChanged: () => void;
  /** What this install can do: writing copy and checking need the AI, Drive and Meta their own connections. */
  features?: Features;
  /** The Studio's recent batches: their awareness level, for the coverage strip. */
  batches?: BatchRow[];
  /** Opens "Send to Meta" with these approved creatives. */
  onSendToMeta?: (ids: string[]) => void;
  /** Batches the Playground made: their creatives carry a "Playground" badge and a source chip. */
  playgroundBatchIds?: ReadonlySet<string>;
  openId: string | null; onOpen: (id: string | null) => void;
} & Work) {
  const [filter, setFilter] = useState<Filter>("review");
  const [origin, setOrigin] = useState<OriginFilter>("all");
  const fromPlayground = creatives.some((c) => originOf(c, playgroundBatchIds) === "playground");
  const shown = byOrigin(creatives, fromPlayground ? origin : "all", playgroundBatchIds);
  const counts: Record<Filter, number> = {
    review: shown.filter((c) => c.approval === "pending").length,
    approved: shown.filter((c) => c.approval === "approved").length,
    rejected: shown.filter((c) => c.approval === "rejected").length,
    all: shown.length,
  };
  const list = shown.filter((c) => filter === "all" || (filter === "review" ? c.approval === "pending" : c.approval === filter));
  const open = creatives.find((c) => c.id === openId) ?? null;
  const [exporting, setExporting] = useState(false);
  const copyWriter = useCopyWriter(onChanged);
  const aiLock = features?.locked("ai") ?? null;
  const driveLock = features?.locked("drive.export") ?? null;
  const launchLock = features?.locked("launch") ?? null;
  const hasApproved = filter === "approved" && counts.approved > 0;
  // "Write copy for all": the creatives shown that have no copy yet (posts carry their own words).
  const needCopy = list.filter((c) => !c.copy_variants?.length && c.style !== "reddit" && c.style !== "tweet").map((c) => c.id);

  async function exportToDrive() {
    const ids = creatives.filter((c) => c.approval === "approved" && !c.drive_file_id).map((c) => c.id).slice(0, 50);
    if (!ids.length) return notice("Every approved creative is already in Drive.", "Nothing to copy");
    setExporting(true);
    const response = await fetch(`/api/studio/${productId}/drive`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creativeIds: ids }) });
    const data = await response.json().catch(() => ({}));
    setExporting(false);
    if (!response.ok) return notice(data.error ?? "Couldn't copy to Drive.");
    const results = (data.results ?? []) as { error?: string }[];
    const failed = results.filter((r) => r.error);
    await notice(failed.length ? `${results.length - failed.length} copied; ${failed.length} didn't: ${failed[0].error}` : `${results.length} copied to the workspace's Drive folder.`, "Google Drive");
    onChanged();
  }

  const [zipping, setZipping] = useState(false);
  /** "Download approved": one zip, filed <awareness level or format>/<creative>/<aspect>.<ext> (lib/export-paths.ts). */
  async function downloadApproved() {
    setZipping(true);
    const response = await fetch(`/api/studio/${productId}/export`, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) {
      setZipping(false);
      const data = await response?.json().catch(() => null) as { error?: string } | null;
      return notice(data?.error ?? "Couldn't make the zip. Try again.");
    }
    const blob = await response.blob();
    setZipping(false);
    const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "approved.zip";
    const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    const missing = Number(response.headers.get("X-Export-Missing") ?? 0);
    if (missing) notice(`${missing} file${missing === 1 ? "" : "s"} couldn't be read from storage and ${missing === 1 ? "is" : "are"} missing from the zip.`, "Downloaded");
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <div className={segmentTrackClass} role="tablist" aria-label="Filter creatives">
          {(["review", "approved", "rejected", "all"] as Filter[]).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={segmentClass(filter === f)}>
              {{ review: "To review", approved: "Approved", rejected: "Rejected", all: "All" }[f]} <span className="tabular-nums opacity-70">{counts[f]}</span>
            </button>
          ))}
        </div>
        {hasApproved && <Button size="sm" variant="secondary" className="ml-auto" disabled={zipping} onClick={downloadApproved} title="One zip, in folders by awareness level (or format), then by creative: the files only">{zipping ? <><Spinner className="size-3" /> Zipping…</> : "Download approved"}</Button>}
        {hasApproved && !driveLock && <Button size="sm" variant="secondary" disabled={exporting} onClick={exportToDrive} title="Into this app's Drive folder, in the same folders as the zip">{exporting ? <><Spinner className="size-3" /> Copying…</> : "Copy to Google Drive"}</Button>}
        {hasApproved && onSendToMeta && !launchLock && <Button size="sm" onClick={() => onSendToMeta([])} title="Pick the creatives, the campaign and ad set, and every setting">Send to Meta</Button>}
        {!aiLock && (needCopy.length > 0 || copyWriter.progress) && (
          <Button size="sm" variant="secondary" className={hasApproved ? "" : "ml-auto"} disabled={Boolean(copyWriter.progress)} onClick={() => void copyWriter.writeAll(needCopy)}
            title="A in a creator's voice, B in the brand's, for every creative shown that has no copy yet">
            {copyWriter.progress ? <><Spinner className="size-3" /> Writing {copyWriter.progress.done}/{copyWriter.progress.total}…</> : `Write copy for all (${needCopy.length})`}
          </Button>
        )}
      </div>
      {/* What isn't connected yet, in place of the buttons that would need it. */}
      {((hasApproved && (driveLock || (launchLock && onSendToMeta))) || (aiLock && shown.length > 0)) && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {aiLock && shown.length > 0 && <FeatureLock state={aiLock} />}
          {hasApproved && launchLock && onSendToMeta && <FeatureLock state={launchLock} />}
          {hasApproved && driveLock && <FeatureLock state={driveLock} />}
        </div>
      )}
      <AwarenessCoverage levels={shown.filter((c) => c.approval !== "rejected").map((c) => levelOf(c, batches))} />
      {fromPlayground && (
        <div className="mb-3 flex flex-wrap items-center gap-1" role="tablist" aria-label="Filter by source">
          {(["all", "studio", "playground"] as OriginFilter[]).map((o) => (
            <button key={o} type="button" role="tab" aria-selected={origin === o} onClick={() => setOrigin(o)} className={cx("h-6 rounded-full border px-2.5 text-xs transition-colors", origin === o ? "border-transparent bg-active font-medium text-ink" : "border-hairline text-muted hover:bg-hover")}>
              {ORIGIN_LABEL[o]} <span className="tabular-nums opacity-70">{byOrigin(creatives, o, playgroundBatchIds).length}</span>
            </button>
          ))}
        </div>
      )}
      {list.length ? (
        <ul className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-4 @6xl:grid-cols-5">
          {list.map((c) => (
            <li key={c.id} className="overflow-hidden rounded-card border border-line bg-card shadow-card transition-colors hover:border-hairline">
              <button type="button" onClick={() => onOpen(c.id)} className="group block w-full text-left">
                <div className="relative aspect-[4/5] w-full overflow-hidden bg-canvas">
                  {c.kind === "video" && c.thumbnail_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={c.thumbnail_url} alt="" loading="lazy" className="h-full w-full bg-console object-contain" />
                    : <Preview creative={c} />}
                  <span className="absolute top-2 right-2 rounded-xs bg-card/90 px-1.5 py-0.5 text-[11px] text-ink tabular-nums">{c.aspect}</span>
                  {c.kind === "video" && <span className="absolute bottom-2 left-2 rounded-xs bg-scrim/70 px-1.5 py-0.5 text-[11px] text-white">▶ {c.duration_sec ? `${Math.round(Number(c.duration_sec))}s` : "video"}</span>}
                </div>
                <div className="grid gap-1.5 p-2.5">
                  <span className="truncate text-xs font-medium">{c.title ?? KIND_LABEL[c.style]}</span>
                  <span className="flex flex-wrap gap-1">
                    {originOf(c, playgroundBatchIds) === "playground" && <Badge tone="neutral">Playground</Badge>}
                    {levelOf(c, batches) && <Badge tone="neutral">L{levelOf(c, batches)}</Badge>}
                    <Badge tone={qaBadge(c.qa_status, aiLock).tone}>{c.qa_status === "running" && <Gear className="size-3" />}{qaBadge(c.qa_status, aiLock).label}</Badge>
                    {c.approval !== "pending" && <Badge tone={c.approval === "approved" ? "win" : "warn"}>{c.approval}</Badge>}
                    {Boolean(c.copy?.composed) && <Badge tone="accent">composed</Badge>}
                    {Boolean(c.copy?.composeError) && <Badge tone="caution">text to shorten</Badge>}
                    {failures[c.id] ? <Badge tone="warn">not finished</Badge> : waiting[c.id] && !c.copy?.composeError ? <Badge tone="neutral">finishing</Badge> : null}
                  </span>
                  {failures[c.id] && <span className="line-clamp-3 text-xs text-warn">{failures[c.id]}</span>}
                </div>
              </button>
              {c.style !== "reddit" && c.style !== "tweet" && (
                <CardCopy creative={c} busy={copyWriter.writing.has(c.id)} canWrite={!aiLock} onWrite={() => void copyWriter.write(c.id)} onPick={(v) => void copyWriter.pick(c, v)} />
              )}
            </li>
          ))}
        </ul>
      ) : filter === "review"
        ? <EmptyState className="py-8" title="Nothing waiting for review" body="New creatives land here once they have been checked. Start a batch in New batch above, or make images in the Playground." />
        : <EmptyState className="py-8" title="No creatives here yet" body="Start a batch in New batch above, or make images in the Playground: they're reviewed here."
            action={<ButtonLink href={workspaceHref(productId, "playground")} variant="secondary" size="sm">Open the Playground</ButtonLink>} />}
      {open && <ReviewPanel key={open.id} aiLock={aiLock} launchLock={launchLock} creative={open} fromPlayground={originOf(open, playgroundBatchIds) === "playground"} waiting={waiting[open.id]} failure={failures[open.id]} onRetryWork={onRetryWork} onClose={() => onOpen(null)} onChanged={onChanged} copyWriter={copyWriter}
        onSendToMeta={onSendToMeta ? (ids) => { onOpen(null); onSendToMeta(ids); } : undefined} />}
    </div>
  );
}

const VERDICT_ICON: Record<QaCheck["verdict"], { mark: string; cls: string }> = {
  pass: { mark: "✓", cls: "bg-win-soft text-win" }, warn: { mark: "!", cls: "bg-caution-soft text-caution-ink" }, fail: { mark: "✕", cls: "bg-warn-soft text-warn" }, skipped: { mark: "–", cls: "bg-control text-muted" },
};

type ComposedRecord = { layout: string; copy: ComposedCopy; warnings?: string[]; plate?: { url: string }; svgUrl?: string | null; layersUrl?: string | null };
type ComposeErrorRecord = { problems: string[]; copy: ComposedCopy; layout: string };
const COPY_FIELDS: { key: keyof ComposedCopy; label: string }[] = [
  { key: "eyebrow", label: "Eyebrow" }, { key: "headline", label: "Headline" }, { key: "subhead", label: "Subhead" },
  { key: "offer", label: "Offer (word for word from your list)" }, { key: "cta", label: "Button" }, { key: "legal", label: "Legal line" },
];

/** A composed ad's words and layout: edit and set them again on the same plate (free; QA runs again). */
function ComposedPanel({ creative, onChanged }: { creative: CreativeView; onChanged: () => void }) {
  const record = (creative.copy?.composed ?? null) as ComposedRecord | null;
  const failed = (creative.copy?.composeError ?? null) as ComposeErrorRecord | null;
  const [copy, setCopy] = useState<ComposedCopy>(record?.copy ?? failed?.copy ?? { headline: "" });
  const [layout, setLayout] = useState(record?.layout ?? failed?.layout ?? LAYOUTS[0].id);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>(failed?.problems ?? []);
  async function apply() {
    setBusy(true);
    const response = await fetch(`/api/studio/creatives/${creative.id}/compose`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ copy, layout }) }).catch(() => null);
    const data = await response?.json().catch(() => null) as { error?: string; problems?: string[] } | null;
    setBusy(false);
    if (!response?.ok) { setProblems(data?.problems ?? [data?.error ?? "Couldn't set the text. Try again."]); return; }
    setProblems([]);
    onChanged();
  }
  return (
    <details open={Boolean(failed) && !record} className="grid gap-2 rounded-inner border border-line p-3 text-xs">
      <summary className="cursor-pointer font-medium text-ink">Edit text <span className="font-normal text-muted">· set in your brand fonts on the same plate (free)</span></summary>
      <div className="mt-2 grid gap-2">
        {problems.map((p) => <p key={p} className="text-caution-ink">{p}</p>)}
        {record?.warnings?.map((w) => <p key={w} className="text-muted">{w}</p>)}
        <select className={cx(inputClass, "h-9 py-1.5")} value={layout} aria-label="Layout" onChange={(e) => setLayout(e.target.value)}>
          {LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        {unplacedCopy(copy, layoutById(layout)).length > 0 && <p className="text-caution-ink">{unplacedNote(layoutById(layout), unplacedCopy(copy, layoutById(layout)))}</p>}
        {COPY_FIELDS.filter((f) => layoutRoles(layoutById(layout)).includes(f.key) || copy[f.key]?.trim()).map((f) => (
          <input key={f.key} className={cx(inputClass, "h-9 py-1.5")} value={copy[f.key] ?? ""} maxLength={COPY_LIMITS[f.key]} placeholder={f.label} aria-label={f.label}
            onChange={(e) => setCopy({ ...copy, [f.key]: e.target.value })} />
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy || !copy.headline.trim()} onClick={apply}>{busy ? <><Spinner className="size-3" /> Setting…</> : "Set the text"}</Button>
          {record?.svgUrl && <a href={record.svgUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">Editable SVG</a>}
          {record?.layersUrl && <a href={record.layersUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">Layers</a>}
          {record?.plate?.url && <a href={record.plate.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">Plate (no text)</a>}
        </div>
      </div>
    </details>
  );
}

function ReviewPanel({ aiLock, launchLock, creative, fromPlayground, waiting, failure, onRetryWork, onClose, onChanged, onSendToMeta, copyWriter }: { aiLock: FeatureState | null; launchLock: FeatureState | null; creative: CreativeView; fromPlayground: boolean; waiting?: string; failure?: string; onRetryWork?: (id: string) => void; onClose: () => void; onChanged: () => void; onSendToMeta?: (ids: string[]) => void; copyWriter: ReturnType<typeof useCopyWriter> }) {
  const [copy, setCopy] = useState({ title: creative.title ?? "", headline: creative.headline ?? "", primary_text: creative.primary_text ?? "", description: creative.description ?? "", cta: creative.cta ?? "" });
  const variants = creative.copy_variants ?? [];
  const chosen = chosenVariant({ ...creative, ...copy });
  const writingCopy = copyWriter.writing.has(creative.id);
  const writeCopy = async () => { const fields = await copyWriter.write(creative.id); if (fields) setCopy((c) => ({ ...c, ...fields })); };
  const pickCopy = async (v: CopyVariant) => { const fields = await copyWriter.pick(creative, v); if (fields) setCopy((c) => ({ ...c, ...fields })); };
  const [note, setNote] = useState(creative.approval_note ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const qa = creative.qa;
  const checks = [...(qa?.checks ?? [])].sort((a, b) => ["fail", "warn", "pass", "skipped"].indexOf(a.verdict) - ["fail", "warn", "pass", "skipped"].indexOf(b.verdict));
  const qaDone = creative.qa_status === "pass" || creative.qa_status === "warn";
  // Anything QA left to a person, or a warning, needs a note saying it was checked.
  const human = needsHuman(creative);
  const noteNeeded = creative.qa_status === "warn";
  const canApprove = qaDone && !waiting && (!noteNeeded || Boolean(note.trim()));
  const approveHint = !qaDone ? "QA must pass (or warn) first" : waiting ?? (noteNeeded && !note.trim() ? "Add a note first" : undefined);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(body: Record<string, unknown>, label: string) {
    setBusy(label);
    const response = await fetch(`/api/studio/creatives/${creative.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null);
    if (!response.ok) return notice((await response.json().catch(() => ({}))).error ?? "Couldn't save. Try again.");
    onChanged();
  }
  async function rerun() {
    setBusy("qa");
    const response = await fetch(`/api/studio/creatives/${creative.id}/qa`, { method: "POST" });
    setBusy(null);
    if (!response.ok) return notice((await response.json().catch(() => ({}))).error ?? "Couldn't run QA. Try again.");
    onChanged();
  }

  return (
    <PanelPortal>
    <div className={`${PANEL_OVERLAY} z-40`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="review-title" className={`${PANEL} max-w-4xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <p className="text-xs text-muted">{fromPlayground ? "Playground · " : ""}{KIND_LABEL[creative.style]} · {creative.aspect}{creative.width ? ` · ${creative.width}×${creative.height}` : ""}{creative.duration_sec ? ` · ${Number(creative.duration_sec)}s` : ""}</p>
            <h2 id="review-title" className="mt-0.5 truncate text-title font-medium">{creative.title ?? "Creative"}</h2>
          </div>
          <IconButton ref={closeRef} label="Close" onClick={onClose}><IconX /></IconButton>
        </div>
        <div className="grid gap-5 p-5 @container md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div className="grid content-start gap-3">
            <div className={cx("w-full overflow-hidden rounded-card border border-line", ASPECT_CLASS[creative.aspect] ?? "aspect-square")}><Preview creative={creative} controls /></div>
            <a href={creative.url} target="_blank" rel="noreferrer" className="text-xs text-muted underline-offset-2 hover:underline">Open the file</a>
            {failure && (
              <div className="grid gap-2 rounded-inner border border-warn/40 p-3 text-xs">
                <p className="text-warn">{failure}</p>
                {onRetryWork && <div><Button size="sm" variant="secondary" onClick={() => onRetryWork(creative.id)}>Try again</Button></div>}
              </div>
            )}
            {(creative.copy?.composed || creative.copy?.composeError) ? <ComposedPanel creative={creative} onChanged={onChanged} /> : null}
            {creative.prompt && (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">Brief sent to {creative.model ?? "the model"}</summary>
                <p className="mt-2 whitespace-pre-wrap">{creative.prompt}</p>
              </details>
            )}
          </div>

          <div className="grid content-start gap-5">
            <section>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Checked</h3>
                <span className="flex items-center gap-2">
                  <Badge tone={qaBadge(creative.qa_status, aiLock).tone}>{qaBadge(creative.qa_status, aiLock).label}</Badge>
                  {!aiLock && <Button size="sm" variant="ghost" disabled={busy === "qa" || creative.qa_status === "running"} onClick={rerun}>{busy === "qa" ? <Spinner className="size-3" /> : "Run again"}</Button>}
                </span>
              </div>
              {aiLock && <FeatureLock state={aiLock} className="mt-2" />}
              {/* While the AI isn't connected the lock above is the whole story; the stored reason only repeats it. */}
              {qa?.error && !(aiLock && creative.qa_status === "error") && <p className="mt-2 text-sm text-warn">{qa.error}</p>}
              {checks.length > 0 && (
                <ul className="mt-3 grid gap-2">
                  {checks.map((c) => (
                    <li key={c.id} className="flex gap-2.5 text-sm">
                      <span aria-hidden className={cx("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[10px] leading-none font-medium", VERDICT_ICON[c.verdict].cls)}>{VERDICT_ICON[c.verdict].mark}</span>
                      <span className="min-w-0">
                        <span className="font-medium">{c.label}</span> <span className="text-xs text-faint">{c.rules.join(" ")}</span>
                        {c.verdict !== "pass" && <span className="block text-xs text-muted">{c.reason}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {human.length > 0 && <p className="mt-3 text-xs"><span className="font-medium">Check yourself:</span> <span className="text-muted">{human.join(", ")}.</span></p>}
              {qa?.notes?.map((n) => <p key={n} className="mt-1 text-xs text-muted">{n}</p>)}
              {(qa?.textSeen?.length ?? 0) > 0 && (
                <details className="mt-2 text-xs text-muted">
                  <summary className="cursor-pointer">Text read on the creative ({qa!.textSeen!.length} lines)</summary>
                  <ul className="mt-1 list-disc pl-4">{qa!.textSeen!.map((t, i) => <li key={i}>{t}</li>)}</ul>
                </details>
              )}
            </section>

            <section className="grid gap-3 border-t border-line pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Ad copy for Launch</h3>
                <span className="flex flex-wrap items-center gap-1">
                  {variants.map((v) => (
                    <Button key={v.label} size="sm" variant={chosen === v.label ? "primary" : "secondary"} aria-pressed={chosen === v.label} disabled={Boolean(busy) || writingCopy} onClick={() => void pickCopy(v)}
                      title={`${v.voice === "creator" ? "Creator voice" : "Brand voice"}: ${v.primary_text}`}>{v.label} · {v.voice === "creator" ? "creator" : "brand"}</Button>
                  ))}
                  {!aiLock && <Button size="sm" variant="ghost" disabled={Boolean(busy) || writingCopy} onClick={() => void writeCopy()}>{writingCopy ? <><Spinner className="size-3" /> Writing…</> : variants.length ? "Rewrite" : "Write copy"}</Button>}
                </span>
              </div>
              <div className="grid gap-3 @lg:grid-cols-2">
                <Field label="Name"><input className={inputClass} value={copy.title} maxLength={200} onChange={(e) => setCopy({ ...copy, title: e.target.value })} /></Field>
                <Field label="Call to action">
                  <input className={inputClass} list="cta-suggestions" value={copy.cta} maxLength={40} onChange={(e) => setCopy({ ...copy, cta: e.target.value })} placeholder="Download" />
                  <datalist id="cta-suggestions">{CTA_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
                </Field>
              </div>
              <Field label="Headline"><input className={inputClass} value={copy.headline} maxLength={255} onChange={(e) => setCopy({ ...copy, headline: e.target.value })} /></Field>
              <Field label="Primary text" hint="The check reads the creative, not this copy: keep it to the same rules (no guarantees, no personal attributes).">
                <textarea className={cx(inputClass, "min-h-20")} value={copy.primary_text} maxLength={2200} onChange={(e) => setCopy({ ...copy, primary_text: e.target.value })} />
              </Field>
              <Field label="Description" hint="Under the headline on Meta: where disclaimers go (Results vary., AI-generated imagery.).">
                <input className={inputClass} value={copy.description} maxLength={1000} onChange={(e) => setCopy({ ...copy, description: e.target.value })} />
              </Field>
              <div><Button size="sm" variant="secondary" disabled={busy === "copy"} onClick={() => save(copy, "copy")}>{busy === "copy" ? "Saving…" : "Save copy"}</Button></div>
            </section>

            <section className="grid gap-3 border-t border-line pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Your decision</h3>
                {creative.approval !== "pending" && <Badge tone={creative.approval === "approved" ? "win" : "warn"}>{creative.approval}{creative.reviewed_at ? ` · ${new Date(creative.reviewed_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : ""}</Badge>}
              </div>
              <Field label="Note" hint={creative.qa_status === "warn" ? "The check raised a warning: say why it's fine to ship (required to approve)." : "Required to reject, so the next batch can avoid it."}>
                <textarea className={cx(inputClass, "min-h-16")} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!canApprove || Boolean(busy)} onClick={() => save({ ...copy, approval: "approved", note }, "approve")} title={canApprove ? undefined : approveHint}>{busy === "approve" ? "Approving…" : "Approve"}</Button>
                <Button size="sm" variant="danger" disabled={Boolean(busy)} onClick={() => save({ approval: "rejected", note }, "reject")}>{busy === "reject" ? "Rejecting…" : "Reject"}</Button>
                {creative.approval !== "pending" && <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => save({ approval: "pending", note }, "reset")}>Undo decision</Button>}
                {creative.approval === "approved" && qaDone && onSendToMeta && !launchLock && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => onSendToMeta([creative.id])}>Send to Meta</Button>}
              </div>
              {creative.approval === "approved" && qaDone && onSendToMeta && launchLock && <FeatureLock state={launchLock} />}
              {!qaDone && <p className="text-xs text-muted">{creative.qa_status === "fail" ? "The check failed: fix the brief and make a new one. Failed creatives can't be approved." : creative.qa?.rerun ? "The file or its words changed: it is checked again, then approval opens." : aiLock ? "Approval opens once the creative has been checked, which needs the AI connected." : "Approval opens once the creative has been checked."}</p>}
              {qaDone && waiting && <p className="text-xs text-muted">{waiting}</p>}
            </section>
          </div>
        </div>
      </div>
    </div>
    </PanelPortal>
  );
}
