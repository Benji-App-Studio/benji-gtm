"use client";
// The workspace's Playground results, newest first: every image and video that came back plus a card for
// each job still queued, running or failed (live, like the Studio's job list). Each shows its prompt,
// reference and input thumbnails, aspect, date and model (a video also its length, with a player), and
// can be opened large, downloaded, used as the next reference (a video: the frame on screen), reopened
// in the form to edit and regenerate, or deleted (row and file). A video the safety filter blocked says
// how to rephrase it and offers "Soften and retry", which refills the form (it never spends). Every result is also
// a creative in the Studio's review: its QA verdict and approval show here, and "Review in Studio" opens
// its review panel there (approve it there and Launch can use it).
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { notice, ask } from "../dialog";
import { IconAlert, IconCheckCircle, IconChevronLeft, IconChevronRight, IconDownload, IconImage, IconPencil, IconPlay, IconTrash, IconWand, IconX } from "../icons";
import { PanelPortal } from "../panel-portal";
import { KEYS_HREF, RunnerLock, type Features } from "../studio/features";
import { Badge, Button, ButtonLink, Card, cx, Gear, IconButton, Locked } from "../ui";
import { adStyleById } from "@/lib/ad-styles";
import { QA_BADGE } from "@/lib/creative-review";
import { DEFAULT_PLAYGROUND_VIDEO } from "@/lib/playground";
import { isActiveJob, type PlaygroundItem, type PlaygroundJob, type PlaygroundOutput } from "@/lib/playground-plan";
import { isSafetyBlock, SAFETY_BLOCK_MESSAGE } from "@/lib/playground-video";
import { fmtUsd, gptImageLabel, PROVIDER_NAME, tryOtherLabel, type ImageProvider } from "@/lib/image-provider";
import { reviewHref } from "@/lib/studio-sources";
import { showOriginal, thumbUrl } from "@/lib/thumb";
import { VARIANT_LABEL, videoModelLabel } from "./playground-form";
import { uploadPlaygroundImage, videoFrame } from "./upload";

export type ResultCard =
  | { type: "output"; key: string; item: PlaygroundItem; output: PlaygroundOutput; job: PlaygroundJob | null }
  | { type: "job"; key: string; item: PlaygroundItem; job: PlaygroundJob };

/** Every result and unfinished job, newest generation first, versions in order. */
export function resultCards(items: PlaygroundItem[]): ResultCard[] {
  const cards: ResultCard[] = [];
  for (const item of items) {
    const used = new Set<string>();
    for (const job of item.jobs) {
      const outs = item.outputs.filter((o) => o.jobId === job.id);
      outs.forEach((output) => { used.add(output.id); cards.push({ type: "output", key: output.id, item, output, job }); });
      if (!outs.length && job.status !== "done") cards.push({ type: "job", key: job.id, item, job });
    }
    for (const output of item.outputs) if (!used.has(output.id)) cards.push({ type: "output", key: output.id, item, output, job: null });
  }
  return cards;
}

const STATUS: Record<PlaygroundJob["status"], string> = { queued: "Queued", running: "Making…", finalizing: "Saving…", done: "Done", failed: "Failed", cancelled: "Cancelled" };
const QA_FALLBACK = { label: "QA", tone: "neutral" as const };
const qaBadge = (o: PlaygroundOutput) => QA_BADGE[o.qaStatus] ?? QA_FALLBACK;
const APPROVAL: Record<string, { label: string; tone: "win" | "warn" }> = { approved: { label: "Approved", tone: "win" }, rejected: { label: "Rejected", tone: "warn" } };
const BACKEND: Record<PlaygroundJob["backend"], string> = { auto: "Higgsfield", local: "the desktop runner", api: "Higgsfield", template: "a template" };
/** Where a job runs, as its card says it: an OpenAI job is on OpenAI, whatever its backend. */
const whereLabel = (job: PlaygroundJob) => (job.provider === "openai" ? "OpenAI" : BACKEND[job.backend]);
/** What a blocked image's card says (videos have their own advice, SAFETY_BLOCK_MESSAGE). */
const imageBlockMessage = (provider: ImageProvider) => `${PROVIDER_NAME[provider]}'s safety filter blocked this (sometimes a false positive). Rephrase the prompt (plainer wording, no real brands, people or claims it could read as harmful) or change the images.`;

/** A Library template as the lightbox names it: a starter's name, or "Your template" for one made from an upload. */
const templateLabel = (styleId: string) => (styleId.startsWith("custom:") ? "Your template" : adStyleById(styleId)?.name ?? styleId);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const isVideoItem = (item: PlaygroundItem) => item.request.mode === "video";
const modelLabel = (item: PlaygroundItem) => (isVideoItem(item) ? videoModelLabel(item.request.video ?? DEFAULT_PLAYGROUND_VIDEO) : `${gptImageLabel(item.request.options.provider)} · ${VARIANT_LABEL[item.request.options.variant]}`);
/** The model line with the image options (a video's line already has its own). */
const modelDetail = (item: PlaygroundItem) => (isVideoItem(item) ? modelLabel(item) : `${modelLabel(item)} · ${item.request.options.quality} · ${item.request.options.resolution}`);
/** A video's length for its pill ("7 s"): what the file says, else what was asked. */
const seconds = (o: PlaygroundOutput, item: PlaygroundItem) => {
  const s = o.durationSec ?? item.request.video?.duration ?? null;
  return s ? `${Math.round(s)} s` : null;
};
/** A blocked job: the provider's moderation refused it (Higgsfield's for videos and images, OpenAI's for images made there). */
const blockedJob = (_item: PlaygroundItem, job: PlaygroundJob | null) => Boolean(job && job.status === "failed" && isSafetyBlock(job.error));
/** A failed image can be tried on the other provider (the person's click; never automatic). */
const canTryOther = (item: PlaygroundItem, job: PlaygroundJob) => !isVideoItem(item) && job.status === "failed";
/** A small pill on a result's corner (aspect, length). */
const pillClass = "rounded-full bg-card/90 px-1.5 text-[10.5px] leading-[18px] font-medium text-label tabular-nums";
const downloadUrl = (o: PlaygroundOutput) => `${o.url}${o.url.includes("?") ? "&" : "?"}download=${encodeURIComponent(`playground-${o.aspect.replace(":", "x")}-${o.id.slice(0, 8)}.${/\.(\w+)(\?|$)/.exec(o.url)?.[1] ?? "png"}`)}`;

/** The reference (ringed) and the person's images as a row of small thumbnails. */
function Inputs({ item, size = "sm" }: { item: PlaygroundItem; size?: "sm" | "md" }) {
  const { referenceUrl, inputUrls } = item.request;
  const box = size === "sm" ? "size-6 rounded-sm" : "size-10 rounded-md";
  const shown = inputUrls.slice(0, size === "sm" ? 4 : 8);
  if (!referenceUrl && !inputUrls.length) return <span className="text-xs text-faint">Prompt only</span>;
  return (
    <span className="flex min-w-0 items-center gap-1">
      {referenceUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbUrl(referenceUrl, 160, 160)} alt="Reference" title="Reference" decoding="async" onError={(e) => showOriginal(e.currentTarget)} className={cx(box, "shrink-0 bg-canvas object-cover ring-[1.5px] ring-accent")} />
      )}
      {shown.map((url, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={url} src={thumbUrl(url, 160, 160)} alt={`Your image ${i + 1}`} decoding="async" onError={(e) => showOriginal(e.currentTarget)} className={cx(box, "shrink-0 border border-line bg-canvas object-cover")} />
      ))}
      {inputUrls.length > shown.length && <span className="text-xs text-muted tabular-nums">+{inputUrls.length - shown.length}</span>}
    </span>
  );
}

export function PlaygroundResults({ productId, items, features, onUseAsReference, onEdit, onSoften, onTryOther, onChanged }: {
  productId: string;
  items: PlaygroundItem[];
  /** What this install can make, so a queued job nothing can pick up says what it waits for. */
  features?: Features;
  onUseAsReference: (url: string) => void;
  onEdit: (item: PlaygroundItem) => void;
  /** A blocked video's request back in the form with its prompt softened (softenVideoPrompt); nothing is spent. */
  onSoften: (item: PlaygroundItem) => void;
  /** A failed image's request back in the form on the other provider; nothing is spent until it's confirmed. */
  onTryOther: (item: PlaygroundItem) => void;
  onChanged: () => void;
}) {
  const cards = resultCards(items);
  const outputs = cards.filter((c): c is Extract<ResultCard, { type: "output" }> => c.type === "output");
  const [openId, setOpenId] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const openIndex = outputs.findIndex((c) => c.output.id === openId);
  const working = cards.filter((c) => c.type === "job" && isActiveJob(c.job.status)).length;

  async function remove(card: ResultCard) {
    const isOutput = card.type === "output";
    const approved = isOutput && card.output.approval === "approved";
    const ok = await ask({
      title: isOutput ? "Delete this result?" : "Remove this generation?",
      body: isOutput
        ? `The image is deleted from this product's storage${approved ? " and leaves Launch, where it's approved" : ""}. This can't be undone.`
        : "It made nothing; this only clears it from the list.",
      confirm: "Delete", danger: true,
    });
    if (!ok) return;
    setActing(card.key);
    const response = await fetch(`/api/playground/${productId}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isOutput ? { creativeId: card.output.id } : { batchId: card.item.batchId }) });
    setActing(null);
    if (!response.ok) return notice((await response.json().catch(() => ({}))).error ?? "Couldn't delete it. Try again.");
    if (isOutput && openId === card.output.id) setOpenId(null);
    onChanged();
  }

  /** "Use as reference": an image as it is; a video's frame (the one on screen, else its first) uploaded as an image. */
  async function takeAsReference(output: PlaygroundOutput, player?: HTMLVideoElement | null) {
    if (output.kind !== "video") return onUseAsReference(output.url);
    setActing(output.id);
    try {
      const frame = await videoFrame(player && player.readyState >= 2 ? player : output.url);
      onUseAsReference(await uploadPlaygroundImage(productId, frame));
    } catch (e) {
      await notice(e instanceof Error ? e.message : "Couldn't take a frame from the video.");
    } finally {
      setActing(null);
    }
  }

  async function jobAction(job: PlaygroundJob, action: "cancel" | "retry") {
    setActing(job.id);
    const response = await fetch(`/api/studio/jobs/${job.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    setActing(null);
    if (!response.ok) return notice((await response.json().catch(() => ({}))).error ?? "Couldn't do that. Try again.");
    onChanged();
  }

  return (
    <section aria-label="Results" className="min-w-0">
      <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-title font-medium">Results <span className="text-xs font-normal text-muted tabular-nums">{outputs.length}</span></h2>
        {working > 0 && <Badge tone="accent"><Gear className="size-3" />{working} in progress</Badge>}
      </div>
      {cards.length ? (
        <ul className="grid grid-cols-2 gap-3 @3xl:grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
          {cards.map((card) => (
            <li key={card.key} className="min-w-0">
              <Card className="flex h-full flex-col overflow-hidden">
                {card.type === "output" ? (
                  <button type="button" onClick={() => setOpenId(card.output.id)} className="group/out relative block aspect-[4/5] w-full overflow-hidden bg-canvas" aria-label={card.output.kind === "video" ? "Play" : "Open large"}>
                    {card.output.kind === "video" ? (
                      <>
                        <video src={card.output.posterUrl ? card.output.url : `${card.output.url}#t=0.1`} poster={card.output.posterUrl ?? undefined} muted playsInline preload="metadata" className="size-full bg-console object-contain" aria-label={card.item.request.prompt.slice(0, 120)} />
                        <span className="absolute inset-0 grid place-items-center"><span className="grid size-10 place-items-center rounded-full bg-scrim/45 text-white backdrop-blur-sm transition group-hover/out:scale-105 group-hover/out:bg-scrim/60"><IconPlay className="size-4 translate-x-px" /></span></span>
                      </>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={card.output.url} alt={card.item.request.prompt.slice(0, 120)} loading="lazy" className="size-full object-contain transition duration-300 hover:scale-[1.015]" />
                    )}
                    <span className="absolute top-2 left-2 flex gap-1">
                      <span className={pillClass}>{card.output.aspect}</span>
                      {card.output.kind === "video" && seconds(card.output, card.item) && <span className={pillClass}>{seconds(card.output, card.item)}</span>}
                    </span>
                    <OutputBadges output={card.output} className="absolute right-2 bottom-2 left-2" />
                  </button>
                ) : (
                  <JobFrame job={card.job} stuck={stuckOn(card.job, features)} video={isVideoItem(card.item)} blocked={blockedJob(card.item, card.job)} acting={acting === card.job.id || acting === card.key} canDismiss={!card.item.outputs.length && !card.item.jobs.some((j) => isActiveJob(j.status))}
                    onCancel={() => jobAction(card.job, "cancel")} onRetry={() => jobAction(card.job, "retry")} onDismiss={() => remove(card)} aspect={card.item.request.aspect} />
                )}
                <div className="flex flex-1 flex-col gap-2 p-2.5">
                  <p className="line-clamp-2 min-h-8 text-xs leading-4 text-ink" title={card.item.request.prompt}>{card.item.request.prompt}</p>
                  {card.type === "job" && blockedJob(card.item, card.job) && (
                    <div className="grid gap-1.5 rounded-md bg-caution-soft px-2.5 py-2 text-xs leading-relaxed text-caution-ink">
                      <p>{isVideoItem(card.item) ? SAFETY_BLOCK_MESSAGE : imageBlockMessage(card.job.provider)}</p>
                      {isVideoItem(card.item) && <Button size="sm" variant="secondary" onClick={() => onSoften(card.item)} title="Puts the prompt back in the form with these changes made; nothing is spent until you generate"><IconWand />Soften and retry</Button>}
                    </div>
                  )}
                  {card.type === "job" && canTryOther(card.item, card.job) && (
                    <Button size="sm" variant="secondary" onClick={() => onTryOther(card.item)} title="Puts this request back in the form on the other provider (same model, GPT Image 2.5); nothing is spent until you generate and confirm the price">
                      {tryOtherLabel(card.job.provider)}
                    </Button>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <Inputs item={card.item} />
                    <span className="shrink-0 text-xs text-faint tabular-nums" title={modelDetail(card.item)}>{when(card.type === "output" ? card.output.createdAt : card.item.createdAt)}</span>
                  </div>
                  {card.type === "output" && (
                    <div className="-mx-1 -mb-1 flex items-center gap-0.5 border-t border-line pt-1.5">
                      <IconButton size="sm" label={card.output.kind === "video" ? "Use its first frame as a reference" : "Use as reference"} disabled={acting === card.output.id} onClick={() => takeAsReference(card.output)}><IconImage /></IconButton>
                      <IconButton size="sm" label="Edit and regenerate" onClick={() => onEdit(card.item)}><IconPencil /></IconButton>
                      <a href={downloadUrl(card.output)} download aria-label="Download" title="Download" className="grid size-7 place-items-center rounded-control text-muted transition hover:bg-hover hover:text-ink"><IconDownload className="size-3.5" /></a>
                      <Link href={reviewHref(productId, card.output.id)} title="Check QA, write the ad copy and approve it for Launch" className="ml-auto inline-flex h-7 min-w-0 items-center gap-1 rounded-control px-1.5 text-xs font-medium text-accent transition hover:bg-accent-soft [&_svg]:size-3.5 [&_svg]:shrink-0">
                        <IconCheckCircle /><span className="truncate">{card.output.approval === "pending" ? "Review in Studio" : "Open in Studio"}</span>
                      </Link>
                      <IconButton size="sm" label="Delete" disabled={acting === card.key} onClick={() => remove(card)} className="hover:!text-warn"><IconTrash /></IconButton>
                    </div>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <Card className="grid place-items-center px-6 py-16 text-center">
          <span className="grid size-9 place-items-center rounded-full bg-control text-muted"><IconImage className="size-4" /></span>
          <p className="mt-3 text-sm font-medium">No results yet</p>
          <p className="mt-1 max-w-xs text-xs text-muted">Bring a reference, say what to change and generate, or describe a shot in Video mode. Every image and video is saved here, newest first.</p>
        </Card>
      )}
      {openIndex >= 0 && (
        <Lightbox
          card={outputs[openIndex]} index={openIndex} total={outputs.length}
          onMove={(step) => setOpenId(outputs[(openIndex + step + outputs.length) % outputs.length].output.id)}
          onClose={() => setOpenId(null)}
          acting={acting === outputs[openIndex].output.id}
          onUseAsReference={async (player) => { await takeAsReference(outputs[openIndex].output, player); setOpenId(null); }}
          onEdit={(item) => { setOpenId(null); onEdit(item); }}
          onDelete={() => remove(outputs[openIndex])}
          reviewUrl={reviewHref(productId, outputs[openIndex].output.id)}
        />
      )}
    </section>
  );
}

/** A queued Higgsfield job in an install with neither a Higgsfield key nor the desktop runner: it waits until one is there. */
function stuckOn(job: PlaygroundJob, features?: Features): ReactNode {
  if (!features?.install || job.status !== "queued" || job.provider === "openai" || job.backend === "template") return null;
  if (job.backend === "local") return features.runner ? null : <RunnerLock>Waiting for the desktop runner</RunnerLock>;
  if (features.state("studio.video").ok || (job.backend === "auto" && features.runner)) return null;
  return <Locked href={KEYS_HREF} action="Add the key">Waiting for a Higgsfield key</Locked>;
}

function JobFrame({ job, stuck, aspect, video, blocked, acting, canDismiss, onCancel, onRetry, onDismiss }: {
  job: PlaygroundJob; stuck?: ReactNode; aspect: string; video: boolean; blocked: boolean; acting: boolean; canDismiss: boolean; onCancel: () => void; onRetry: () => void; onDismiss: () => void;
}) {
  const active = isActiveJob(job.status);
  // Requeued after a busy or failed try: Higgsfield is asked again after a back-off.
  const waiting = job.status === "queued" && Boolean(job.notBefore);
  return (
    <div className="relative grid aspect-[4/5] w-full place-items-center bg-canvas p-4">
      <span className="absolute top-2 left-2 rounded-full bg-card/90 px-1.5 text-[10.5px] leading-[18px] font-medium text-label tabular-nums">{aspect}</span>
      <div className="relative grid justify-items-center gap-2 text-center">
        {active ? <Gear className="size-5 text-accent" /> : blocked ? <IconAlert className="size-5 text-caution-ink" /> : <IconX className={cx("size-5", job.status === "failed" ? "text-warn" : "text-muted")} />}
        <span className={cx("text-xs font-medium", blocked ? "text-caution-ink" : job.status === "failed" && "text-warn")}>{blocked ? "Blocked by the safety filter" : STATUS[job.status]}{job.variant > 1 ? ` · v${job.variant}` : ""}</span>
        {active && !stuck && <span className="text-xs text-muted">{waiting ? "Waiting to try again" : `On ${whereLabel(job)}`}</span>}
        {stuck}
        {active && video && !waiting && !stuck && <span className="max-w-[190px] text-xs text-faint">Seedance takes a few minutes per clip.</span>}
        {blocked && video && <span className="max-w-[190px] text-xs text-muted">Nothing was charged for it.</span>}
        {job.provider === "openai" && job.costUsd != null && <span className="text-xs text-faint">OpenAI cost {fmtUsd(job.costUsd)}</span>}
        {job.error && !blocked && <span className="line-clamp-3 max-w-[190px] text-xs text-muted" title={job.error}>{job.error}</span>}
        <div className="flex gap-1">
          {job.status === "queued" && <Button size="sm" variant="secondary" disabled={acting} onClick={onCancel}>Cancel</Button>}
          {(job.status === "failed" || job.status === "cancelled") && <Button size="sm" variant="secondary" disabled={acting} onClick={onRetry}>Retry</Button>}
          {(job.status === "failed" || job.status === "cancelled") && canDismiss && <Button size="sm" variant="ghost" disabled={acting} onClick={onDismiss}>Dismiss</Button>}
        </div>
      </div>
    </div>
  );
}

/** QA's verdict on a result, and the decision once a person made one in the Studio. */
function OutputBadges({ output, className }: { output: PlaygroundOutput; className?: string }) {
  const qa = qaBadge(output);
  const decided = APPROVAL[output.approval];
  return (
    <span className={cx("pointer-events-none flex flex-wrap gap-1", className)}>
      <Badge tone={qa.tone} className="shadow-raised">{output.qaStatus === "running" && <Gear className="size-3" />}{qa.label}</Badge>
      {decided && <Badge tone={decided.tone} className="shadow-raised">{decided.label}</Badge>}
    </span>
  );
}

function Lightbox({ card, index, total, acting, onMove, onClose, onUseAsReference, onEdit, onDelete, reviewUrl }: {
  reviewUrl: string;
  card: Extract<ResultCard, { type: "output" }>; index: number; total: number; acting: boolean;
  /** For a video, the player: its current frame becomes the reference. */
  onMove: (step: number) => void; onClose: () => void; onUseAsReference: (player: HTMLVideoElement | null) => void; onEdit: (item: PlaygroundItem) => void; onDelete: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const playerRef = useRef<HTMLVideoElement>(null);
  const { item, output } = card;
  const isVideo = output.kind === "video";
  const length = seconds(output, item);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && total > 1) onMove(1);
      if (e.key === "ArrowLeft" && total > 1) onMove(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onMove, total]);

  const facts: [string, string][] = [
    ["Aspect", output.width && output.height ? `${output.aspect} · ${output.width}×${output.height}` : output.aspect],
    ...(isVideo && length ? [["Length", length] as [string, string]] : []),
    ["Model", modelDetail(item)],
    ...(card.job ? [["Cost", card.job.provider === "openai"
      ? `${card.job.costUsd != null ? fmtUsd(card.job.costUsd) : `≈${fmtUsd(card.job.estUsd ?? 0)}`} at OpenAI`
      : `${card.job.costCredits ?? card.job.costEstimate} Higgsfield credits`] as [string, string]] : []),
    ...(isVideo ? [["Brand", item.request.video?.useBrand ? "Look, name and rules added" : "None (as written)"] as [string, string]] : []),
    ["Made", when(output.createdAt)],
    ...(item.request.styleId ? [["Template", templateLabel(item.request.styleId)] as [string, string]] : []),
  ];

  return (
    <PanelPortal>
      <div className="fixed inset-0 z-[70] flex bg-scrim/80 p-2 md:p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div role="dialog" aria-modal="true" aria-label="Result" className="page-in flex min-h-0 w-full flex-col overflow-hidden rounded-dialog bg-card shadow-pop md:flex-row">
          <div className="relative grid min-h-0 flex-1 place-items-center bg-console p-3 md:p-6">
            {isVideo ? (
              // crossOrigin: "Use this frame as a reference" reads the frame on screen from a canvas.
              <video key={output.id} ref={playerRef} src={output.url} poster={output.posterUrl ?? undefined} crossOrigin="anonymous" controls autoPlay playsInline className="max-h-full max-w-full object-contain" aria-label={item.request.prompt.slice(0, 120)} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={output.url} alt={item.request.prompt.slice(0, 120)} className="max-h-full max-w-full object-contain" />
            )}
            {total > 1 && (
              <>
                <button type="button" onClick={() => onMove(-1)} aria-label="Previous" className="absolute top-1/2 left-3 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"><IconChevronLeft className="size-4" /></button>
                <button type="button" onClick={() => onMove(1)} aria-label="Next" className="absolute top-1/2 right-3 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"><IconChevronRight className="size-4" /></button>
                <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-2 text-[11px] leading-5 text-white/80 tabular-nums">{index + 1} / {total}</span>
              </>
            )}
          </div>
          <aside className="flex max-h-[45dvh] w-full shrink-0 flex-col gap-4 overflow-y-auto p-4 md:max-h-none md:w-[320px]">
            <div className="flex items-start justify-between gap-2">
              <h2 className="pt-0.5 text-title font-medium">Result</h2>
              <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="grid size-7 place-items-center rounded-control text-muted transition hover:bg-hover hover:text-ink"><IconX className="size-4" /></button>
            </div>
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-label">Prompt</span>
              <p className="text-xs leading-relaxed whitespace-pre-wrap text-ink">{item.request.prompt}</p>
            </div>
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-label">{isVideo ? "Reference images" : "Reference and your images"}</span>
              <Inputs item={item} size="md" />
            </div>
            <dl className="grid gap-1 text-xs">
              {facts.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right text-ink">{v}</dd></div>)}
            </dl>
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-label">Review</span>
              <OutputBadges output={output} />
              <p className="text-xs text-muted">{output.approval === "approved" ? "Approved: Launch can use it." : output.approval === "rejected" ? "Rejected in the Studio." : "Approve it in the Studio (after QA) and Launch can use it."}</p>
            </div>
            <div className="mt-auto grid gap-1.5">
              <ButtonLink href={reviewUrl} size="sm" variant="outline"><IconCheckCircle />{output.approval === "pending" ? "Review in Studio" : "Open in Studio"}</ButtonLink>
              <Button size="sm" disabled={acting} onClick={() => onUseAsReference(playerRef.current)} title={isVideo ? "Pause on the frame you want: it's added to the form as an image" : undefined}>
                {acting ? <Gear className="size-3.5" /> : <IconImage />}{isVideo ? "Use this frame as a reference" : "Use as reference"}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onEdit(item)}><IconPencil />Edit and regenerate</Button>
              <div className="grid grid-cols-2 gap-1.5">
                <a href={downloadUrl(output)} download className="inline-flex h-7 items-center justify-center gap-1.5 rounded-control border border-line bg-raised px-2.5 text-xs font-medium text-ink transition hover:border-ink/20 [&_svg]:size-3.5"><IconDownload />Download</a>
                <Button size="sm" variant="danger" onClick={onDelete}><IconTrash />Delete</Button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </PanelPortal>
  );
}
