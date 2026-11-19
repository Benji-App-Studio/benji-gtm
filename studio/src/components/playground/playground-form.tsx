"use client";
// The Playground form. Image mode: a reference image (drop, upload or pick), the person's own images,
// what to change, and the output options. Video mode: the shot described in the person's words, optional
// reference images (one can be the start frame), length, aspect and versions, the rest under "More
// options". Images are GPT Image 2.5 via Higgsfield (default) or via OpenAI, picked next to Generate and
// remembered for the product. Generating asks the API for the plan, shows the cost (Higgsfield credits
// or OpenAI dollars) in a confirm dialog and only then starts the batch at that confirmed price; nothing
// is ever spent without that click.
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { PRICES_CHECKED, type ImageQuality, type ImageResolution } from "@/lib/creative-plan";
import { DEFAULT_PLAYGROUND_VIDEO, PLAYGROUND_MAX_INPUTS, PLAYGROUND_VIDEO, type PlaygroundMode, type PlaygroundRequest, type PlaygroundVideo } from "@/lib/playground";
import { showOriginal, thumbUrl } from "@/lib/thumb";
import {
  PLAYGROUND_PROMPT, PLAYGROUND_QUALITIES, PLAYGROUND_RESOLUTIONS, PLAYGROUND_VIDEO_RESOLUTIONS, planPlayground, playgroundVideoImages,
  type PlaygroundOptions, type PlaygroundOverview, type PlaygroundVariant,
} from "@/lib/playground-plan";
import { VIDEO_PROMPT_TIPS } from "@/lib/playground-video";
import { costLabel, fmtUsd, gptImageLabel, OPENAI_IMAGE_PRICING, PROVIDER_NAME, type ImageProvider } from "@/lib/image-provider";
import { ask, Facts, notice } from "../dialog";
import { ImageProviderPicker, providerCostRow } from "../image-provider-picker";
import { IconImage, IconPlay, IconPlus, IconUpload, IconVideo, IconX } from "../icons";
import { availableProvider, FeatureLock, type Features } from "../studio/features";
import { Button, cx, inputClass, Segmented, SelectPill, Spinner, Toggle } from "../ui";
import { ImagePicker, type PickSource, type PickTile } from "./image-picker";
import { imageFiles, uploadPlaygroundImage } from "./upload";
import { StorageNotice, useStorageGuard } from "../storage-notice";

export const fmtCredits = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(2));
const QUALITY_LABEL: Record<ImageQuality, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
export const VARIANT_LABEL: Record<PlaygroundVariant, string> = { flare: "Flare", sunburst: "Sunburst" };
/** A video's settings in one line ("Seedance 2.5 · 720p · 7 s · sound on"). */
export const videoModelLabel = (v: PlaygroundVideo) => `Seedance 2.5 · ${v.resolution} · ${v.duration} s · sound ${v.audio ? "on" : "off"}`;
const VIDEO_DURATIONS = Array.from({ length: PLAYGROUND_VIDEO.maxDuration - PLAYGROUND_VIDEO.minDuration + 1 }, (_, i) => PLAYGROUND_VIDEO.minDuration + i);

function Label({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-h-5 items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted">{children}</span>
      {aside && <span className="text-xs text-faint">{aside}</span>}
    </div>
  );
}

/** A box that takes dropped image files; `active` while something is dragged over it. */
function useDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const handlers = {
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); },
    onDrop: (e: DragEvent) => { e.preventDefault(); setOver(false); const files = imageFiles(e.dataTransfer.files); if (files.length) onFiles(files); },
  };
  return { over, handlers };
}

export function PlaygroundForm({ productId, overview, features, request, options, onRequest, onOptions, sources, onStarted }: {
  productId: string;
  overview: PlaygroundOverview;
  /** What this install can make: generating needs a key for images or for video (or the desktop runner). */
  features: Features;
  request: PlaygroundRequest;
  options: PlaygroundOptions;
  onRequest: (next: PlaygroundRequest) => void;
  onOptions: (next: PlaygroundOptions) => void;
  sources: Record<PickSource, PickTile[]>;
  onStarted: () => void;
}) {
  // Generating saves the new creatives: a warning at 95% of storage, refused when it's full.
  const storageGuard = useStorageGuard("generate");
  const [uploading, setUploading] = useState<"reference" | "inputs" | null>(null);
  const [picking, setPicking] = useState<"reference" | "inputs" | null>(null);
  const [busy, setBusy] = useState(false);
  const refInput = useRef<HTMLInputElement>(null);
  const inputsInput = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<PlaygroundRequest>) => onRequest({ ...request, ...patch });
  const mode: PlaygroundMode = request.mode === "video" ? "video" : "image";
  const isVideo = mode === "video";
  const video = request.video ?? DEFAULT_PLAYGROUND_VIDEO;
  const setVideo = (patch: Partial<PlaygroundVideo>) => set({ video: { ...video, ...patch } });
  const brand = { appName: overview.workspace?.appName ?? "", tagline: overview.workspace?.tagline, forbiddenClaims: overview.workspace?.forbiddenClaims };
  const plan = planPlayground(request, options, brand);
  const room = PLAYGROUND_MAX_INPUTS - request.inputUrls.length;
  const firstInput = request.referenceUrl ? 2 : 1;
  // A video numbers its images in the order it sends them: the start frame first.
  const videoOrder = isVideo ? playgroundVideoImages({ inputUrls: request.inputUrls, video }) : [];
  const imageNumber = (url: string, i: number) => (isVideo ? videoOrder.indexOf(url) + 1 : firstInput + i);
  const perVersion = plan.jobs[0]?.costEstimate ?? 0;
  // Video is Seedance, Higgsfield's alone; images go via the picked provider (one that has a key).
  const provider: ImageProvider = isVideo ? "higgsfield" : availableProvider(options.provider, features.imageProviders);
  // The desktop runner makes both through its own Higgsfield sign-in, so nothing is locked where it is set up.
  const lock = features.runner ? null : features.locked(isVideo ? "studio.video" : "studio.images");

  /** Image ⇄ video. A video has no style reference, so the reference joins the images (first); 9:16 and at most 2 versions to start. */
  function switchMode(next: PlaygroundMode) {
    if (next === mode) return;
    if (next === "image") return set({ mode: "image" });
    const inputs = request.referenceUrl ? [request.referenceUrl, ...request.inputUrls.filter((u) => u !== request.referenceUrl)].slice(0, PLAYGROUND_MAX_INPUTS) : request.inputUrls;
    set({
      mode: "video", referenceUrl: null, inputUrls: inputs, styleId: null, styleFields: null,
      aspect: request.video ? request.aspect : "9:16", count: Math.min(request.count, PLAYGROUND_VIDEO.maxCount) as PlaygroundRequest["count"], video,
    });
  }

  async function upload(slot: "reference" | "inputs", files: File[]) {
    const list = slot === "reference" ? files.slice(0, 1) : files.slice(0, Math.max(0, room));
    if (!list.length) return notice(`You can add up to ${PLAYGROUND_MAX_INPUTS} of your own images.`, "That's the limit");
    setUploading(slot);
    const urls: string[] = [];
    try {
      for (const file of list) urls.push(await uploadPlaygroundImage(productId, file));
    } catch (e) {
      await notice(e instanceof Error ? e.message : "Couldn't upload the image. Try again.");
    }
    setUploading(null);
    if (!urls.length) return;
    if (slot === "reference") set({ referenceUrl: urls[0] });
    else set({ inputUrls: [...request.inputUrls, ...urls].slice(0, PLAYGROUND_MAX_INPUTS) });
  }
  const refDrop = useDrop((files) => upload("reference", files));
  const inputsDrop = useDrop((files) => upload("inputs", files));

  async function generate() {
    if (plan.errors.length) return notice(plan.errors[0], "Not ready yet");
    setBusy(true);
    const planned = await fetch(`/api/playground/${productId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "plan", request, options }) })
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({ error: "The server didn't answer. Try again." })) }));
    setBusy(false);
    if (!planned.ok) return notice(planned.data.error);
    const p = planned.data as { credits: number; usd?: number; provider?: ImageProvider; openaiModel?: string | null; jobs: number; backend: string; warnings: string[]; errors: string[]; prompt: string };
    const via: ImageProvider = p.provider === "openai" ? "openai" : "higgsfield";
    if (p.errors.length) return notice(p.errors[0], "Not ready yet");
    const images = isVideo
      ? (request.inputUrls.length ? `${request.inputUrls.length}${video.startFrame ? " (image 1 opens the video)" : ""}` : "None (prompt only)")
      : [request.referenceUrl ? "1 reference" : null, request.inputUrls.length ? `${request.inputUrls.length} of yours` : null].filter(Boolean).join(" + ") || "None (prompt only)";
    const cost = providerCostRow(via, { credits: p.credits, usd: p.usd });
    const ok = await ask({
      title: `Make ${p.jobs} ${isVideo ? "video" : "image"}${p.jobs === 1 ? "" : "s"}?`,
      body: (
        <div className="grid gap-3">
          <Facts rows={isVideo ? [
            ["Model", videoModelLabel(video)],
            ["Aspect", request.aspect === "4:5" ? "4:5 (made in 3:4)" : request.aspect],
            ["Images sent", images],
            ["Brand", video.useBrand ? "Look, name and rules added" : "None: the prompt as written"],
            cost,
          ] : [
            ["Model", `${gptImageLabel(via)} · ${VARIANT_LABEL[options.variant]} · ${QUALITY_LABEL[options.quality].toLowerCase()} · ${options.resolution}`],
            ...(via === "openai" && p.openaiModel ? [["OpenAI model", p.openaiModel] as [string, ReactNode]] : []),
            ["Aspect", request.aspect],
            ["Images sent", images],
            cost,
          ]} note={<>
            {p.warnings.map((w) => <span key={w} className="block">{w}</span>)}
            {via === "openai"
              ? <span className="block">Made by OpenAI&apos;s Images API with this product&apos;s server key, billed by OpenAI in dollars (no Higgsfield credits). Estimated from OpenAI&apos;s published prices, checked {OPENAI_IMAGE_PRICING.checked}; reference images add an estimated input cost. Results are saved to this product&apos;s storage and checked like any other.</span>
              : <span className="block">Prices from Higgsfield&apos;s cost check on {PRICES_CHECKED}. Each job&apos;s live price is checked again before it runs, and one that costs much more is refused. Results are saved to this product&apos;s storage.</span>}
            {isVideo && <span className="block">Seedance takes a few minutes per clip. Credits are refunded when a generation is blocked.</span>}
          </>} />
          <details className="rounded-inner bg-card px-3 py-2 text-xs">
            <summary className="cursor-pointer text-muted">The prompt {PROVIDER_NAME[via]} gets</summary>
            <pre className="mt-2 max-h-48 overflow-y-auto font-sans text-xs whitespace-pre-wrap text-ink">{p.prompt}</pre>
          </details>
        </div>
      ),
      confirm: via === "openai" ? `Spend ≈${fmtUsd(p.usd ?? 0)} at OpenAI` : `Spend ~${fmtCredits(p.credits)} credits`,
    });
    if (!ok) return;
    setBusy(true);
    const response = await fetch(`/api/playground/${productId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", request, options, confirmedCredits: p.credits, confirmedUsd: p.usd ?? 0 }) });
    const data = await response.json().catch(() => ({ error: "Couldn't start. Try again." }));
    setBusy(false);
    if (!response.ok) return notice(data.error);
    onStarted();
  }

  return (
    <div className="grid gap-4">
      <Segmented label="What to make" value={mode} onChange={switchMode} className="w-full [&>button]:flex-1"
        options={[{ value: "image", label: <span className="inline-flex items-center gap-1.5 [&_svg]:size-3.5"><IconImage />Image</span> }, { value: "video", label: <span className="inline-flex items-center gap-1.5 [&_svg]:size-3.5"><IconVideo />Video</span> }]} />

      {/* Reference (images only: a video's images are all references) */}
      {!isVideo && <div className="grid gap-1.5">
        <Label aside="optional · its exact style is kept">Reference</Label>
        <div
          {...refDrop.handlers}
          className={cx("group relative overflow-hidden rounded-inner border bg-raised transition", refDrop.over ? "border-accent ring-2 ring-accent/30" : request.referenceUrl ? "border-line" : "border-dashed border-ink/20 hover:border-ink/35")}
        >
          {request.referenceUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={request.referenceUrl} alt="Reference" className="h-44 w-full bg-canvas object-contain" />
              <div className="absolute top-2 right-2 flex gap-1 opacity-100 transition @4xl:opacity-0 @4xl:group-hover:opacity-100 @4xl:group-focus-within:opacity-100">
                <Button size="sm" variant="white" onClick={() => refInput.current?.click()}>Replace</Button>
                <Button size="sm" variant="white" onClick={() => setPicking("reference")}>Pick</Button>
                <Button size="sm" variant="white" aria-label="Remove the reference" onClick={() => set({ referenceUrl: null })}><IconX /></Button>
              </div>
              <span className="absolute bottom-2 left-2 rounded-full bg-card/90 px-1.5 text-[10.5px] leading-[18px] font-medium text-label">Image 1</span>
            </>
          ) : (
            <div className="flex h-36 flex-col items-center justify-center gap-2.5 px-4 text-center">
              <span className="text-faint"><IconImage className="size-5" /></span>
              <p className="text-xs text-muted">Drop a reference ad here. Without one, the prompt alone makes it.</p>
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => refInput.current?.click()}><IconUpload />Upload</Button>
                <Button size="sm" variant="secondary" onClick={() => setPicking("reference")}>Pick from…</Button>
              </div>
            </div>
          )}
          {uploading === "reference" && <div className="absolute inset-0 grid place-items-center bg-card/70"><Spinner className="size-5 text-muted" /></div>}
          <input ref={refInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { upload("reference", imageFiles(e.target.files)); e.target.value = ""; }} />
        </div>
      </div>}

      {/* Your images */}
      <div className="grid gap-1.5">
        <Label aside={`${isVideo ? "optional · " : ""}${request.inputUrls.length} of ${PLAYGROUND_MAX_INPUTS}`}>{isVideo ? "Reference images" : "Your images"}</Label>
        <div {...inputsDrop.handlers} className={cx("flex flex-wrap items-center gap-1.5 rounded-inner p-0.5 transition", inputsDrop.over && "bg-accent-soft ring-2 ring-accent/30")}>
          {request.inputUrls.map((url, i) => {
            const n = imageNumber(url, i);
            const start = isVideo && video.startFrame === url;
            return (
              <div key={url} className={cx("group/tile relative size-14 overflow-hidden rounded-small border bg-canvas", start ? "border-accent ring-2 ring-accent/40" : "border-line")} title={start ? `Image ${n}: the start frame` : `Image ${n}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbUrl(url, 160, 160)} alt={`Your image ${i + 1}`} decoding="async" onError={(e) => showOriginal(e.currentTarget)} className="size-full object-cover" />
                <span className={cx("absolute bottom-0.5 left-0.5 rounded px-1 text-[10px] leading-3.5 font-medium tabular-nums", start ? "bg-accent text-on-ink" : "bg-card/90 text-label")}>{start ? `${n} · start` : n}</span>
                {isVideo && (
                  <button type="button" onClick={() => setVideo({ startFrame: start ? null : url })} aria-pressed={start} aria-label={start ? `Stop opening the video on image ${n}` : `Open the video on image ${n}`}
                    title={start ? "The video opens on this image. Click to make it a plain reference." : "Open the video on this image (its first frame)"}
                    className={cx("absolute top-0.5 left-0.5 grid size-5 place-items-center rounded-full shadow-raised transition focus:opacity-100", start ? "bg-accent text-on-ink" : "bg-card/95 text-ink opacity-100 @4xl:opacity-0 @4xl:group-hover/tile:opacity-100")}><IconPlay className="size-2.5" /></button>
                )}
                <button type="button" onClick={() => set({ inputUrls: request.inputUrls.filter((u) => u !== url), ...(start ? { video: { ...video, startFrame: null } } : {}) })} aria-label={`Remove image ${n}`}
                  className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-card/95 text-ink opacity-100 shadow-raised transition @4xl:opacity-0 @4xl:group-hover/tile:opacity-100 focus:opacity-100"><IconX className="size-3" /></button>
              </div>
            );
          })}
          {room > 0 && (
            <button type="button" onClick={() => inputsInput.current?.click()} disabled={uploading === "inputs"} aria-label="Upload your images"
              className="grid size-14 place-items-center rounded-small border border-dashed border-ink/20 text-muted transition hover:border-ink/35 hover:text-ink">
              {uploading === "inputs" ? <Spinner className="size-4" /> : <IconPlus className="size-4" />}
            </button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setPicking("inputs")} disabled={room <= 0 && !request.inputUrls.length}>Pick from…</Button>
          <input ref={inputsInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { upload("inputs", imageFiles(e.target.files)); e.target.value = ""; }} />
        </div>
        <p className="text-xs text-faint">{isVideo
          ? <>A person, a product, a place: name them in the prompt as image 1, image 2… Press <IconPlay className="inline size-2.5 align-baseline" /> on one to open the video on it.</>
          : <>Product shots, app screens, a logo: they stand in for the reference&apos;s product and brand.</>}</p>
      </div>

      {/* Prompt */}
      <div className="grid gap-1.5">
        <Label aside={request.prompt.length > PLAYGROUND_PROMPT.max * 0.8 ? `${request.prompt.length} / ${PLAYGROUND_PROMPT.max}` : undefined}>{isVideo ? "Describe the shot" : "What should change?"}</Label>
        {request.styleId && (
          <p className="flex items-center justify-between gap-2 rounded-inner bg-accent-soft px-2.5 py-1.5 text-xs text-accent">
            <span className="min-w-0">From the Library: Higgsfield gets this prompt as written.</span>
            <button type="button" onClick={() => set({ styleId: null, styleFields: null, reviewIds: [] })} className="shrink-0 font-medium underline-offset-2 hover:underline" title="Treat it as a list of changes to the reference instead">Detach</button>
          </p>
        )}
        <textarea
          value={request.prompt} onChange={(e) => set({ prompt: e.target.value.slice(0, PLAYGROUND_PROMPT.max) })} rows={5} aria-label={isVideo ? "Describe the shot" : "What should change?"}
          placeholder={isVideo ? "Describe the shot: who, what happens, camera position and lighting" : "e.g. Put our bottle in her hand, change the review text to \"Finally a habit tracker that works\", keep everything else."}
          className={cx(inputClass, "min-h-28 resize-y leading-relaxed")}
        />
        {isVideo && (
          <details className="group rounded-inner bg-control/60 px-2.5 py-1.5 text-xs text-muted">
            <summary className="cursor-pointer font-medium text-label select-none">Prompt tips</summary>
            <ul className="mt-1.5 grid list-disc gap-1 pl-4 leading-relaxed">{VIDEO_PROMPT_TIPS.map((tip) => <li key={tip}>{tip}</li>)}</ul>
          </details>
        )}
      </div>

      {isVideo ? (
        <VideoOptions request={request} video={video} perVersion={perVersion} onRequest={set} onVideo={setVideo} />
      ) : (
      <div className="grid gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted">Aspect</span>
          <Segmented label="Aspect" value={request.aspect} onChange={(aspect) => set({ aspect })} options={(["1:1", "4:5", "9:16", "16:9"] as const).map((a) => ({ value: a, label: a }))} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted">Versions</span>
          <Segmented label="Versions" value={String(request.count)} onChange={(n) => set({ count: Number(n) as PlaygroundRequest["count"] })} options={["1", "2", "3", "4"].map((n) => ({ value: n, label: <span className="inline-block w-4 tabular-nums">{n}</span> }))} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted">Model</span>
          <div className="flex flex-wrap justify-end gap-1.5">
            <SelectPill label="Quality" value={options.quality} onChange={(q) => onOptions({ ...options, quality: q as ImageQuality })} options={PLAYGROUND_QUALITIES.map((q) => ({ value: q, label: QUALITY_LABEL[q] }))} />
            <SelectPill label="Resolution" value={options.resolution} onChange={(r) => onOptions({ ...options, resolution: r as ImageResolution })} options={PLAYGROUND_RESOLUTIONS.map((r) => ({ value: r, label: r.toUpperCase() }))} />
            <Segmented label="GPT Image 2.5 variant" value={options.variant} onChange={(variant) => onOptions({ ...options, variant })} options={(["flare", "sunburst"] as const).map((v) => ({ value: v, label: VARIANT_LABEL[v] }))} />
          </div>
        </div>
        <label className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted">Never show</span>
          <input
            className={cx(inputClass, "max-w-[260px] flex-1")} placeholder="Names or words, comma-separated"
            defaultValue={(request.mustAvoid ?? []).join(", ")} key={(request.mustAvoid ?? []).join("|")}
            onBlur={(e) => set({ mustAvoid: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          />
        </label>
      </div>
      )}

      <div className="grid gap-1.5 border-t border-line pt-4">
        {!isVideo && !lock && (
          <ImageProviderPicker value={options.provider} onChange={(next) => onOptions({ ...options, provider: next })} productId={productId}
            openaiReady={overview.backend ? overview.backend.openaiImages : null} plan={overview.backend?.openaiImagePlan} quality={options.quality} resolution={options.resolution} className="mb-1.5" />
        )}
        {lock ? <FeatureLock state={lock} /> : <>
          <StorageNotice action="generate" className="mb-1.5" />
          <Button onClick={generate} disabled={busy || uploading !== null || plan.errors.length > 0 || storageGuard.block} className="w-full">
            {busy ? <><Spinner className="size-3.5" />Checking the price…</> : <>
              {isVideo ? `Generate ${request.count > 1 ? `${request.count} videos` : "video"}` : `Generate ${request.count > 1 ? `${request.count} versions` : ""}`}
              <span className="font-normal opacity-60">· {provider === "openai" ? costLabel("openai", { usd: plan.usd }) : costLabel("higgsfield", { credits: plan.credits })}</span>
            </>}
          </Button>
          <p className="text-center text-xs text-faint">You confirm the price before anything is spent.</p>
        </>}
      </div>

      {picking && (
        <ImagePicker
          title={picking === "reference" ? "Pick a reference" : "Pick your images"}
          sources={sources}
          initial={picking === "reference" ? (sources.research.length ? "research" : "results") : "product"}
          max={picking === "reference" ? 1 : PLAYGROUND_MAX_INPUTS}
          picked={picking === "inputs" ? request.inputUrls : undefined}
          onPick={(urls) => { if (picking === "reference") set({ referenceUrl: urls[0] ?? null }); else set({ inputUrls: urls }); setPicking(null); }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

/** Video mode's options: length, aspect and versions up front (with the price per version), the rest under "More options". */
function VideoOptions({ request, video, perVersion, onRequest, onVideo }: {
  request: PlaygroundRequest;
  video: PlaygroundVideo;
  perVersion: number;
  onRequest: (patch: Partial<PlaygroundRequest>) => void;
  onVideo: (patch: Partial<PlaygroundVideo>) => void;
}) {
  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">Length</span>
        <SelectPill label="Length" value={String(video.duration)} onChange={(d) => onVideo({ duration: Number(d) })} options={VIDEO_DURATIONS.map((d) => ({ value: String(d), label: `${d} s` }))} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">Aspect</span>
        <Segmented label="Aspect" value={request.aspect} onChange={(aspect) => onRequest({ aspect })} options={(["9:16", "1:1", "4:5", "16:9"] as const).map((a) => ({ value: a, label: a }))} />
      </div>
      {request.aspect === "4:5" && <p className="-mt-1 text-right text-xs text-faint">Seedance makes 4:5 in 3:4 (Meta trims it to 4:5).</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">Versions</span>
        <Segmented label="Versions" value={String(request.count)} onChange={(n) => onRequest({ count: Number(n) as PlaygroundRequest["count"] })} options={["1", "2"].map((n) => ({ value: n, label: <span className="inline-block w-4 tabular-nums">{n}</span> }))} />
      </div>
      <details className="group rounded-inner border border-line px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted select-none">More options <span className="font-normal text-faint">· {video.resolution} · sound {video.audio ? "on" : "off"}{video.useBrand ? " · brand" : ""}</span></summary>
        <div className="mt-2.5 grid gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted">Resolution</span>
            <Segmented label="Resolution" value={video.resolution} onChange={(resolution) => onVideo({ resolution })} options={PLAYGROUND_VIDEO_RESOLUTIONS.map((r) => ({ value: r, label: r }))} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted">Sound <span className="font-normal text-faint">(voices, ambience)</span></span>
            <Toggle label="Sound" checked={video.audio} onChange={(audio) => onVideo({ audio })} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="grid text-xs font-medium text-muted">Use my brand<span className="font-normal text-faint">Adds your brand&apos;s look, name and rules. Off: the prompt goes as written.</span></span>
            <Toggle label="Use my brand" checked={video.useBrand} onChange={(useBrand) => onVideo({ useBrand })} />
          </div>
          <label className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted">Never show</span>
            <input
              className={cx(inputClass, "max-w-[220px] flex-1")} placeholder="Names or words, comma-separated"
              defaultValue={(request.mustAvoid ?? []).join(", ")} key={(request.mustAvoid ?? []).join("|")}
              onBlur={(e) => onRequest({ mustAvoid: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            />
          </label>
        </div>
      </details>
      <p className="text-xs text-faint">{videoModelLabel(video)}: ~{fmtCredits(perVersion)} credits a version. Seedance takes a few minutes per clip.</p>
    </div>
  );
}
