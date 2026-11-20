"use client";
// Results and review: every creative with its QA verdict, and the panel where a person reads the
// checks (TypeSafe's Jev), fills in the ad copy Launch will use, and approves or rejects it with a note. A creative still
// waiting for its composed text or our logo (`waiting`) can't be approved; one where that failed after
// its retries (`failures`) says so on its card, with a way to try again. Approval rules: lib/creative-review.ts.
// Playground results are reviewed here too (badged "Remix", with a source chip); `openId` comes from
// the Studio so a link (?review=<id>) can open one's panel.
// Ad copy: "Write copy" (on a card, in the panel, or "Write copy for all" for the creatives shown) has
// OpenAI write A (creator voice) and B (brand voice) from the brand's rules (lib/creative-copy.ts); the
// A/B switcher sets the headline, primary text and description Launch uses. QA checks the copy again.
import { COMPOSE_WORDS, COPY_LIMITS, LAYOUTS, layoutById, layoutRoles, unplacedCopy, unplacedNote, type ComposedCopy } from "@/lib/composed-ads";
import { storedWords } from "@/lib/stored-words";
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
import { PANEL, PANEL_OVERLAY, PanelPortal } from "../panel-portal";
import { studioHref } from "@/lib/nav-model";
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";

type Filter = "review" | "approved" | "rejected" | "all";
const QA: Record<QaStatus, (typeof QA_BADGE)[string]> = QA_BADGE;
/**
 * A creative's check on a badge. With no AI connected nothing can be checked: one that is waiting, or
 * whose check stopped for that reason, reads "Not checked" (the lock beside it says what to connect)
 * instead of a failure.
 */
const qaBadge = (status: QaStatus, aiLock: FeatureState | null): (typeof QA_BADGE)[string] =>
  (aiLock && (status === "error" || status === "pending") ? { label: m("Not checked"), tone: "neutral" } : QA[status]);
const ASPECT_CLASS: Record<string, string> = { "9:16": "aspect-[9/16]", "4:5": "aspect-[4/5]", "1:1": "aspect-square", "3:4": "aspect-[3/4]", "16:9": "aspect-video" };

function Preview({ creative, controls = false, className }: { creative: CreativeView; controls?: boolean; className?: string }) {
  const { t } = useT();
  if (creative.kind === "video") {
    return <video src={creative.url} poster={creative.thumbnail_url ?? undefined} controls={controls} muted={!controls} playsInline preload="metadata" className={cx("h-full w-full bg-console object-contain", className)} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={creative.url} alt={creative.title ?? t(KIND_LABEL[creative.style])} loading="lazy" className={cx("h-full w-full bg-canvas object-contain", className)} />;
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
  const { t, tn } = useT();
  const [writing, setWriting] = useState<ReadonlySet<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const mark = (id: string, on: boolean) => setWriting((s) => { const next = new Set(s); if (on) next.add(id); else next.delete(id); return next; });

  const request = useCallback(async (id: string, variant?: string): Promise<{ fields?: CopyFields; error?: string }> => {
    const response = await fetch(`/api/studio/creatives/${id}/copy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(variant ? { variant } : {}) }).catch(() => null);
    const data = await response?.json().catch(() => null) as { error?: string; creative?: CreativeView } | null;
    if (!response?.ok || !data?.creative) return { error: data?.error ?? t("Couldn't write the copy. Try again.") };
    const c = data.creative;
    return { fields: { headline: c.headline ?? "", primary_text: c.primary_text ?? "", description: c.description ?? "" } };
  }, [t]);

  const write = useCallback(async (id: string, variant?: string) => {
    mark(id, true);
    const result = await request(id, variant);
    mark(id, false);
    if (result.error) { await notice(result.error, t("Couldn't write the copy")); return null; }
    onChanged();
    return result.fields ?? null;
  }, [request, onChanged, t]);

  const writeAll = useCallback(async (ids: string[]) => {
    const ok = await ask({
      title: tn(ids.length, "Write copy for {n} creative?", "Write copy for {n} creatives?"),
      body: t("The AI writes two versions of each: A in a creator's voice, B in the brand's, following your brand rules. Version A becomes the ad copy, and it is checked again."),
      confirm: t("Write copy"),
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
    if (errors.length) await notice(t("{written} written; {failed} didn't: {reason}", { written: ids.length - errors.length, failed: errors.length, reason: errors[0] }), t("Ad copy"));
  }, [request, onChanged, t, tn]);

  const pick = useCallback(async (creative: CreativeView, v: CopyVariant) => {
    const response = await fetch(`/api/studio/creatives/${creative.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fieldsOf(v)) }).catch(() => null);
    if (!response?.ok) { await notice((await response?.json().catch(() => ({})))?.error ?? t("Couldn't switch the copy. Try again.")); return null; }
    onChanged();
    return fieldsOf(v);
  }, [onChanged, t]);

  return { writing, progress, write, writeAll, pick };
}

/** Under a card: "Write copy", or the A/B switcher once there's copy (hover a letter to read it). */
function CardCopy({ creative, busy, canWrite, onWrite, onPick }: { creative: CreativeView; busy: boolean; canWrite: boolean; onWrite: () => void; onPick: (v: CopyVariant) => void }) {
  const { t } = useT();
  const variants = creative.copy_variants ?? [];
  const chosen = chosenVariant(creative);
  // Nothing to switch between and nothing that could write it: no row.
  if (!variants.length && !canWrite && !busy) return null;
  return (
    <div className="flex items-center gap-1 border-t border-line px-2 py-1 text-xs">
      {busy ? <span className="flex items-center gap-1 text-muted"><Spinner className="size-3" /> {t("Writing copy…")}</span>
        : variants.length ? (
          <>
            <span className="mr-1 text-muted">{t("Copy")}</span>
            {variants.map((v) => (
              <button key={v.label} type="button" aria-pressed={chosen === v.label} onClick={() => onPick(v)} title={v.voice === "creator" ? t("{label} · creator voice: {text}", { label: v.label, text: v.primary_text }) : t("{label} · brand voice: {text}", { label: v.label, text: v.primary_text })}
                className={cx("min-w-6 rounded-full border px-1.5 py-0.5 tabular-nums transition-colors", chosen === v.label ? "border-hairline bg-control font-medium text-ink" : "border-transparent text-muted hover:bg-hover hover:text-ink")}>{v.label}</button>
            ))}
            {canWrite && <button type="button" onClick={onWrite} className="ml-auto rounded-xs font-medium text-accent hover:underline" title={t("Write both versions again")}>{t("Rewrite")}</button>}
          </>
        ) : <button type="button" onClick={onWrite} className="rounded-xs font-medium text-accent hover:underline">{t("Write copy")}</button>}
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
  /** Batches the Playground made: their creatives carry a "Remix" badge and a source chip. */
  playgroundBatchIds?: ReadonlySet<string>;
  openId: string | null; onOpen: (id: string | null) => void;
} & Work) {
  const { t, tn } = useT();
  const originLabel: Record<OriginFilter, string> = { all: t("All sources"), studio: t("Studio"), playground: t("Remix") };
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
    if (!ids.length) return notice(t("Every approved creative is already in Drive."), t("Nothing to copy"));
    setExporting(true);
    const response = await fetch(`/api/studio/${productId}/drive`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creativeIds: ids }) });
    const data = await response.json().catch(() => ({}));
    setExporting(false);
    if (!response.ok) return notice(data.error ?? t("Couldn't copy to Drive."));
    const results = (data.results ?? []) as { error?: string }[];
    const failed = results.filter((r) => r.error);
    await notice(failed.length ? t("{copied} copied; {failed} didn't: {reason}", { copied: results.length - failed.length, failed: failed.length, reason: failed[0].error ?? "" }) : t("{n} copied to the workspace's Drive folder.", { n: results.length }), "Google Drive");
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
      return notice(data?.error ?? t("Couldn't make the zip. Try again."));
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
    if (missing) notice(tn(missing, "{n} file couldn't be read from storage and is missing from the zip.", "{n} files couldn't be read from storage and are missing from the zip."), t("Downloaded"));
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <div className={segmentTrackClass} role="tablist" aria-label={t("Filter creatives")}>
          {(["review", "approved", "rejected", "all"] as Filter[]).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={segmentClass(filter === f)}>
              {{ review: t("To review"), approved: t("Approved"), rejected: t("Rejected"), all: t("All") }[f]} <span className="tabular-nums opacity-70">{counts[f]}</span>
            </button>
          ))}
        </div>
        {hasApproved && <Button size="sm" variant="secondary" className="ml-auto" disabled={zipping} onClick={downloadApproved} title={t("One zip, in folders by awareness level (or format), then by creative: the files only")}>{zipping ? <><Spinner className="size-3" /> {t("Zipping…")}</> : t("Download approved")}</Button>}
        {hasApproved && !driveLock && <Button size="sm" variant="secondary" disabled={exporting} onClick={exportToDrive} title={t("Into this app's Drive folder, in the same folders as the zip")}>{exporting ? <><Spinner className="size-3" /> {t("Copying…")}</> : t("Copy to Google Drive")}</Button>}
        {hasApproved && onSendToMeta && !launchLock && <Button size="sm" onClick={() => onSendToMeta([])} title={t("Pick the creatives, the campaign and ad set, and every setting")}>{t("Send to Meta")}</Button>}
        {!aiLock && (needCopy.length > 0 || copyWriter.progress) && (
          <Button size="sm" variant="secondary" className={hasApproved ? "" : "ml-auto"} disabled={Boolean(copyWriter.progress)} onClick={() => void copyWriter.writeAll(needCopy)}
            title={t("A in a creator's voice, B in the brand's, for every creative shown that has no copy yet")}>
            {copyWriter.progress ? <><Spinner className="size-3" /> {t("Writing {done}/{total}…", { done: copyWriter.progress.done, total: copyWriter.progress.total })}</> : t("Write copy for all ({n})", { n: needCopy.length })}
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
        <div className={cx(segmentTrackClass, "mb-3 flex-wrap")} role="tablist" aria-label={t("Filter by source")}>
          {(["all", "studio", "playground"] as OriginFilter[]).map((o) => (
            <button key={o} type="button" role="tab" aria-selected={origin === o} onClick={() => setOrigin(o)} className={segmentClass(origin === o)}>
              {originLabel[o]} <span className="tabular-nums opacity-70">{byOrigin(creatives, o, playgroundBatchIds).length}</span>
            </button>
          ))}
        </div>
      )}
      {list.length ? (
        <ul className="grid grid-cols-2 gap-2 @xl:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5 @7xl:grid-cols-6">
          {list.map((c) => (
            <li key={c.id} className="overflow-hidden rounded-small border border-line bg-card transition-colors hover:border-hairline">
              <button type="button" onClick={() => onOpen(c.id)} className="group block w-full text-left">
                <div className="relative aspect-[4/5] w-full overflow-hidden bg-canvas">
                  {c.kind === "video" && c.thumbnail_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={c.thumbnail_url} alt="" loading="lazy" className="h-full w-full bg-console object-contain" />
                    : <Preview creative={c} />}
                  <span className="absolute top-1.5 right-1.5 rounded-xs bg-card/90 px-1 py-px text-[11px] text-ink tabular-nums">{c.aspect}</span>
                  {c.kind === "video" && <span className="absolute bottom-1.5 left-1.5 rounded-xs bg-scrim/70 px-1 py-px text-[11px] text-white">▶ {c.duration_sec ? `${Math.round(Number(c.duration_sec))}s` : t("video")}</span>}
                </div>
                <div className="grid gap-1 p-2">
                  <span className="truncate text-xs font-medium">{c.title ?? t(KIND_LABEL[c.style])}</span>
                  <span className="flex flex-wrap gap-1">
                    {originOf(c, playgroundBatchIds) === "playground" && <Badge tone="neutral">{t("Remix")}</Badge>}
                    {levelOf(c, batches) && <Badge tone="neutral">L{levelOf(c, batches)}</Badge>}
                    <Badge tone={qaBadge(c.qa_status, aiLock).tone}>{c.qa_status === "running" && <Gear className="size-3" />}{t(qaBadge(c.qa_status, aiLock).label)}</Badge>
                    {c.approval !== "pending" && <Badge tone={c.approval === "approved" ? "win" : "warn"}>{c.approval === "approved" ? t("approved") : t("rejected")}</Badge>}
                    {Boolean(c.copy?.composed) && <Badge tone="accent">{t("composed")}</Badge>}
                    {Boolean(c.copy?.composeError) && <Badge tone="caution">{t("text to shorten")}</Badge>}
                    {failures[c.id] ? <Badge tone="warn">{t("not finished")}</Badge> : waiting[c.id] && !c.copy?.composeError ? <Badge tone="neutral">{t("finishing")}</Badge> : null}
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
        ? <EmptyState className="py-8" title={t("Nothing waiting for review")} body={t("New creatives land here once they have been checked. Start a batch in New batch above, or remix an ad on the Remix tab.")} />
        : <EmptyState className="py-8" title={t("No creatives here yet")} body={t("Start a batch in New batch above, or remix an ad on the Remix tab: they're reviewed here.")}
            action={<ButtonLink href={studioHref(productId, "remix")} variant="secondary" size="sm">{t("Open Remix")}</ButtonLink>} />}
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
  { key: "eyebrow", label: m("Eyebrow") }, { key: "headline", label: m("Headline") }, { key: "subhead", label: m("Subhead") },
  { key: "offer", label: m("Offer (word for word from your list)") }, { key: "cta", label: m("Button") }, { key: "legal", label: m("Legal line") },
];

/** A composed ad's words and layout: edit and set them again on the same plate (free; QA runs again). */
function ComposedPanel({ creative, onChanged }: { creative: CreativeView; onChanged: () => void }) {
  const { t } = useT();
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
    if (!response?.ok) { setProblems(data?.problems ?? [data?.error ?? t("Couldn't set the text. Try again.")]); return; }
    setProblems([]);
    onChanged();
  }
  return (
    <details open={Boolean(failed) && !record} className="grid gap-2 rounded-inner border border-line p-3 text-xs">
      <summary className="cursor-pointer font-medium text-ink">{t("Edit text")} <span className="font-normal text-muted">· {t("set in your brand fonts on the same plate (free)")}</span></summary>
      <div className="mt-2 grid gap-2">
        {problems.map((p) => <p key={p} className="text-caution-ink">{storedWords(p, COMPOSE_WORDS, t)}</p>)}
        {record?.warnings?.map((w) => <p key={w} className="text-muted">{storedWords(w, COMPOSE_WORDS, t)}</p>)}
        <select className={inputClass} value={layout} aria-label={t("Layout")} onChange={(e) => setLayout(e.target.value)}>
          {LAYOUTS.map((l) => <option key={l.id} value={l.id}>{t(l.name)}</option>)}
        </select>
        {unplacedCopy(copy, layoutById(layout)).length > 0 && <p className="text-caution-ink">{unplacedNote(layoutById(layout), unplacedCopy(copy, layoutById(layout)), t)}</p>}
        {COPY_FIELDS.filter((f) => layoutRoles(layoutById(layout)).includes(f.key) || copy[f.key]?.trim()).map((f) => (
          <input key={f.key} className={inputClass} value={copy[f.key] ?? ""} maxLength={COPY_LIMITS[f.key]} placeholder={t(f.label)} aria-label={t(f.label)}
            onChange={(e) => setCopy({ ...copy, [f.key]: e.target.value })} />
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy || !copy.headline.trim()} onClick={apply}>{busy ? <><Spinner className="size-3" /> {t("Setting…")}</> : t("Set the text")}</Button>
          {record?.svgUrl && <a href={record.svgUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">{t("Editable SVG")}</a>}
          {record?.layersUrl && <a href={record.layersUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">{t("Layers")}</a>}
          {record?.plate?.url && <a href={record.plate.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{t("Plate (no text)")}</a>}
        </div>
      </div>
    </details>
  );
}

function ReviewPanel({ aiLock, launchLock, creative, fromPlayground, waiting, failure, onRetryWork, onClose, onChanged, onSendToMeta, copyWriter }: { aiLock: FeatureState | null; launchLock: FeatureState | null; creative: CreativeView; fromPlayground: boolean; waiting?: string; failure?: string; onRetryWork?: (id: string) => void; onClose: () => void; onChanged: () => void; onSendToMeta?: (ids: string[]) => void; copyWriter: ReturnType<typeof useCopyWriter> }) {
  const { t, tn, intl } = useT();
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
  const approveHint = !qaDone ? t("QA must pass (or warn) first") : waiting ? t(waiting) : (noteNeeded && !note.trim() ? t("Add a note first") : undefined);

  useEffect(() => { closeRef.current?.focus(); }, []);

  async function save(body: Record<string, unknown>, label: string) {
    setBusy(label);
    const response = await fetch(`/api/studio/creatives/${creative.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null);
    if (!response.ok) return notice((await response.json().catch(() => ({}))).error ?? t("Couldn't save. Try again."));
    onChanged();
  }
  async function rerun() {
    setBusy("qa");
    const response = await fetch(`/api/studio/creatives/${creative.id}/qa`, { method: "POST" });
    setBusy(null);
    if (!response.ok) return notice((await response.json().catch(() => ({}))).error ?? t("Couldn't run QA. Try again."));
    onChanged();
  }

  return (
    <PanelPortal onClose={onClose}>
    <div className={`${PANEL_OVERLAY} z-40`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="review-title" className={`${PANEL} max-w-4xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-xs text-muted">{fromPlayground ? `${t("Remix")} · ` : ""}{t(KIND_LABEL[creative.style])} · {creative.aspect}{creative.width ? ` · ${creative.width}×${creative.height}` : ""}{creative.duration_sec ? ` · ${Number(creative.duration_sec)}s` : ""}</p>
            <h2 id="review-title" className="mt-0.5 truncate text-sm font-medium">{creative.title ?? t("Creative")}</h2>
          </div>
          <IconButton ref={closeRef} label={t("Close")} onClick={onClose}><IconX /></IconButton>
        </div>
        <div className="grid gap-4 p-4 @container md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <div className="grid content-start gap-3">
            <div className={cx("w-full overflow-hidden rounded-small border border-line", ASPECT_CLASS[creative.aspect] ?? "aspect-square")}><Preview creative={creative} controls /></div>
            <a href={creative.url} target="_blank" rel="noreferrer" className="text-xs text-muted underline-offset-2 hover:underline">{t("Open the file")}</a>
            {failure && (
              <div className="grid gap-2 rounded-inner border border-warn/40 p-3 text-xs">
                <p className="text-warn">{failure}</p>
                {onRetryWork && <div><Button size="sm" variant="secondary" onClick={() => onRetryWork(creative.id)}>{t("Try again")}</Button></div>}
              </div>
            )}
            {(creative.copy?.composed || creative.copy?.composeError) ? <ComposedPanel creative={creative} onChanged={onChanged} /> : null}
            {creative.prompt && (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">{creative.model ? t("Brief sent to {model}", { model: creative.model }) : t("Brief sent to the model")}</summary>
                <p className="mt-2 whitespace-pre-wrap">{creative.prompt}</p>
              </details>
            )}
          </div>

          <div className="grid content-start gap-4">
            <section>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{t("Checked")}</h3>
                <span className="flex items-center gap-2">
                  <Badge tone={qaBadge(creative.qa_status, aiLock).tone}>{t(qaBadge(creative.qa_status, aiLock).label)}</Badge>
                  {!aiLock && <Button size="sm" variant="ghost" disabled={busy === "qa" || creative.qa_status === "running"} onClick={rerun}>{busy === "qa" ? <Spinner className="size-3" /> : t("Run again")}</Button>}
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
              {human.length > 0 && <p className="mt-3 text-xs"><span className="font-medium">{t("Check yourself:")}</span> <span className="text-muted">{human.join(", ")}.</span></p>}
              {qa?.notes?.map((n) => <p key={n} className="mt-1 text-xs text-muted">{n}</p>)}
              {(qa?.textSeen?.length ?? 0) > 0 && (
                <details className="mt-2 text-xs text-muted">
                  <summary className="cursor-pointer">{tn(qa!.textSeen!.length, "Text read on the creative ({n} line)", "Text read on the creative ({n} lines)")}</summary>
                  <ul className="mt-1 list-disc pl-4">{qa!.textSeen!.map((line, i) => <li key={i}>{line}</li>)}</ul>
                </details>
              )}
            </section>

            <section className="grid gap-3 border-t border-line pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{t("Ad copy for Launch")}</h3>
                <span className="flex flex-wrap items-center gap-1">
                  {variants.map((v) => (
                    <Button key={v.label} size="sm" variant={chosen === v.label ? "primary" : "secondary"} aria-pressed={chosen === v.label} disabled={Boolean(busy) || writingCopy} onClick={() => void pickCopy(v)}
                      title={v.voice === "creator" ? t("Creator voice: {text}", { text: v.primary_text }) : t("Brand voice: {text}", { text: v.primary_text })}>{v.voice === "creator" ? t("{label} · creator", { label: v.label }) : t("{label} · brand", { label: v.label })}</Button>
                  ))}
                  {!aiLock && <Button size="sm" variant="ghost" disabled={Boolean(busy) || writingCopy} onClick={() => void writeCopy()}>{writingCopy ? <><Spinner className="size-3" /> {t("Writing…")}</> : variants.length ? t("Rewrite") : t("Write copy")}</Button>}
                </span>
              </div>
              <div className="grid gap-3 @lg:grid-cols-2">
                <Field label={t("Name")}><input className={inputClass} value={copy.title} maxLength={200} onChange={(e) => setCopy({ ...copy, title: e.target.value })} /></Field>
                <Field label={t("Call to action")}>
                  <input className={inputClass} list="cta-suggestions" value={copy.cta} maxLength={40} onChange={(e) => setCopy({ ...copy, cta: e.target.value })} placeholder="Download" />
                  <datalist id="cta-suggestions">{CTA_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
                </Field>
              </div>
              <Field label={t("Headline")}><input className={inputClass} value={copy.headline} maxLength={255} onChange={(e) => setCopy({ ...copy, headline: e.target.value })} /></Field>
              <Field label={t("Primary text")} hint={t("The check reads the creative, not this copy: keep it to the same rules (no guarantees, no personal attributes).")}>
                <textarea className={cx(inputClass, "min-h-20")} value={copy.primary_text} maxLength={2200} onChange={(e) => setCopy({ ...copy, primary_text: e.target.value })} />
              </Field>
              <Field label={t("Description")} hint={t("Under the headline on Meta: where disclaimers go (Results vary., AI-generated imagery.).")}>
                <input className={inputClass} value={copy.description} maxLength={1000} onChange={(e) => setCopy({ ...copy, description: e.target.value })} />
              </Field>
              <div><Button size="sm" variant="secondary" disabled={busy === "copy"} onClick={() => save(copy, "copy")}>{busy === "copy" ? t("Saving…") : t("Save copy")}</Button></div>
            </section>

            <section className="grid gap-3 border-t border-line pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{t("Your decision")}</h3>
                {creative.approval !== "pending" && <Badge tone={creative.approval === "approved" ? "win" : "warn"}>{creative.approval === "approved" ? t("approved") : t("rejected")}{creative.reviewed_at ? ` · ${new Date(creative.reviewed_at).toLocaleString(intl, { dateStyle: "medium", timeStyle: "short" })}` : ""}</Badge>}
              </div>
              <Field label={t("Note")} hint={creative.qa_status === "warn" ? t("The check raised a warning: say why it's fine to ship (required to approve).") : t("Required to reject, so the next batch can avoid it.")}>
                <textarea className={cx(inputClass, "min-h-16")} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!canApprove || Boolean(busy)} onClick={() => save({ ...copy, approval: "approved", note }, "approve")} title={canApprove ? undefined : approveHint}>{busy === "approve" ? t("Approving…") : t("Approve")}</Button>
                <Button size="sm" variant="danger" disabled={Boolean(busy)} onClick={() => save({ approval: "rejected", note }, "reject")}>{busy === "reject" ? t("Rejecting…") : t("Reject")}</Button>
                {creative.approval !== "pending" && <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => save({ approval: "pending", note }, "reset")}>{t("Undo decision")}</Button>}
                {creative.approval === "approved" && qaDone && onSendToMeta && !launchLock && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => onSendToMeta([creative.id])}>{t("Send to Meta")}</Button>}
              </div>
              {creative.approval === "approved" && qaDone && onSendToMeta && launchLock && <FeatureLock state={launchLock} />}
              {!qaDone && <p className="text-xs text-muted">{creative.qa_status === "fail" ? t("The check failed: fix the brief and make a new one. Failed creatives can't be approved.") : creative.qa?.rerun ? t("The file or its words changed: it is checked again, then approval opens.") : aiLock ? t("Approval opens once the creative has been checked, which needs the AI connected.") : t("Approval opens once the creative has been checked.")}</p>}
              {qaDone && waiting && <p className="text-xs text-muted">{t(waiting)}</p>}
            </section>
          </div>
        </div>
      </div>
    </div>
    </PanelPortal>
  );
}
