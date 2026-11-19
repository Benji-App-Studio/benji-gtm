"use client";
// Research → "Make this for <app>": one sheet over a competitor's ad that makes the same kind of ad for the
// student's own app, three ways, in this order:
//   1. Ready-made prompt (always there, no key): GPT Image / ChatGPT, Higgsfield and a general variant,
//      each with Copy prompt; the reference image and the brand kit to download; Improve with AI when the
//      OpenAI key is set (its cost shown first; a rewrite that breaks the brand rules is refused).
//   2. Generate here: one image through the same pipeline as the Studio and the Playground, with their ad
//      as the style reference and our logo and screens after it, on a provider that has a key, at a size
//      it supports, the estimated cost on the button. Results arrive here as they finish (Realtime) and
//      in the Studio. A failed job can be retried (price first) or switched to the other provider.
//   3. Send to Studio: the existing handoff, for a full batch of angles and sizes.
// The pure part (prompts, cost, request, handoff) is lib/make-for-app.ts.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { featureState } from "@/lib/capabilities";
import { repoFileUrl } from "@/lib/brand-config";
import type { ImageQuality, ImageResolution } from "@/lib/creative-plan";
import { fmtUsd, otherProvider, PROVIDER_NAME, providerOfJob, type ImageProvider, type OpenAiImagePlan } from "@/lib/image-provider";
import { useInstall } from "@/lib/install/use-install";
import {
  appFromBrand, brandGaps, buildPrompts, generatePlan, improveCostUsd, makeCost, makeHandoff, makeReferenceCount, makeRequest, providerErrorText, providerSizes, sizeAllowed,
  VARIANT_HOW, VARIANT_LABEL, type PromptVariant,
} from "@/lib/make-for-app";
import type { Aspect } from "@/lib/meta-formats";
import type { ProductAsset } from "@/lib/product-assets";
import { HANDOFF_KEY, sourceFromAd } from "@/lib/recreate";
import type { CreativeMedia, RankedAdRow, ResearchBrand } from "@/lib/research";
import { createClient } from "@/lib/supabase/client";
import { refreshStorage } from "@/lib/use-storage";
import { workspaceHref } from "@/lib/workspace-schema";
import { ask, Facts, notice } from "../dialog";
import { IconCheck, IconDownload, IconExternal, IconLock, IconX } from "../icons";
import { MODAL, MODAL_OVERLAY, PanelPortal } from "../panel-portal";
import { StorageNotice, useStorageGuard } from "../storage-notice";
import { confirmRetry } from "../studio/retry-confirm";
import { Badge, Button, ButtonLink, cx, Gear, inputClass, Segmented, Spinner } from "../ui";
import { CopyButton, downloadFile, fileName } from "./copy-ad";

const GUIDE = repoFileUrl("docs/RECREATE-ADS.md");
const QUALITY_LABEL: Record<ImageQuality, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };

interface Job { id: string; status: string; error: string | null; params: Record<string, unknown>; aspect: string; variant: number; model: string; cost_estimate: number }
interface Made { id: string; job_id: string | null; url: string; thumbnail_url: string | null; kind: string; aspect: string }

function Section({ n, title, hint, children }: { n: number; title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid min-w-0 gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0" aria-labelledby={`make-${n}`}>
      <div className="flex items-start gap-2.5">
        <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-on-ink">{n}</span>
        <div className="min-w-0">
          <h3 id={`make-${n}`} className="text-sm font-medium">{title}</h3>
          {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
        </div>
      </div>
      <div className="grid min-w-0 gap-3 pl-[30px] max-sm:pl-0">{children}</div>
    </section>
  );
}

/** Copies text; where the clipboard API is refused (an embedded browser, no permission), the older select-and-copy way. */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) throw new Error("The browser didn't allow copying.");
  }
}

/** Whether a link loads as an image here (a saved copy always does; an Ad Library preview link may have expired). */
function useLoads(url: string | null): boolean | null {
  const [state, setState] = useState<{ url: string | null; ok: boolean | null }>({ url, ok: null });
  if (state.url !== url) setState({ url, ok: null });
  useEffect(() => {
    if (!url) return;
    const img = new Image();
    img.onload = () => setState({ url, ok: true });
    img.onerror = () => setState({ url, ok: false });
    img.src = url;
  }, [url]);
  return url ? state.ok : false;
}

export function MakeForApp({ productId, ad, brand, assets, measured, media, openaiPlan, onClose, onOpenRecreate }: {
  productId: string;
  ad: RankedAdRow;
  brand?: ResearchBrand;
  assets: ProductAsset[];
  measured: { width?: number | null; height?: number | null; duration?: number | null };
  /** Their media as the drawer shows it (stored copies first), without the ones that failed to load. */
  media: CreativeMedia[];
  openaiPlan?: OpenAiImagePlan | null;
  onClose: () => void;
  /** Opens the detailed Recreate sheet (every flag and option) on the same ad. */
  onOpenRecreate: () => void;
}) {
  const router = useRouter();
  const app = useMemo(() => appFromBrand(brand, assets), [brand, assets]);
  const appName = app.name || "your app";
  const gaps = brandGaps(app);
  const mainGaps = gaps.filter((g) => g.main && g.key !== "name");
  const src = useMemo(() => sourceFromAd(ad, measured), [ad, measured]);
  const video = src.video;
  const [mode, setMode] = useState<"still" | "video">("still");

  // Their image: the stored copy, else the preview link if it still loads. A video's poster stands in for it.
  const first = media[0];
  const candidate = (video ? first?.thumbnail_url ?? ad.thumb : media.find((m) => m.type === "image")?.url ?? ad.thumb) ?? null;
  const loads = useLoads(candidate && /^https:\/\//.test(candidate) ? candidate : null);
  const reference = loads ? candidate : null;

  const gen = useMemo(() => generatePlan(app, reference), [app, reference]);
  const prompts = useMemo(() => buildPrompts(src, app, { mode: video ? mode : undefined, refs: { reference: Boolean(reference) }, generateRefs: gen.refs }), [src, app, video, mode, reference, gen.refs]);
  const [variant, setVariant] = useState<PromptVariant>("gpt");
  const [edits, setEdits] = useState<Partial<Record<PromptVariant, string>>>({});
  const [improved, setImproved] = useState<{ variant: PromptVariant; before: string; note: string } | null>(null);
  const [improving, setImproving] = useState(false);
  const text = edits[variant] ?? prompts[variant];
  const { install } = useInstall();
  const ai = featureState("ai", install);
  const openaiKey = !install || Boolean(install.keys.OPENAI_API_KEY?.set);
  const higgsfieldKey = !install || Boolean(install.keys.HIGGSFIELD_API_KEY?.set);
  const images = featureState("studio.images", install);

  async function improve() {
    const cost = improveCostUsd(text.length);
    const ok = await ask({ title: "Improve this prompt with AI?", confirm: `Spend at most ≈${fmtUsd(cost)} at OpenAI`, body: <Facts rows={[["What", "OpenAI rewrites it more precisely, keeping every fact, colour, font and rule"], ["Estimated OpenAI cost", `at most ≈ ${fmtUsd(cost)}`]]} note="It never adds a claim, number or brand. A rewrite that breaks your brand rules is refused and your prompt stays." /> });
    if (!ok) return;
    setImproving(true);
    const response = await fetch(`/api/products/${productId}/improve-prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: text, mustAvoid: prompts.mustAvoid }) }).catch(() => null);
    const data = await response?.json().catch(() => null) as { prompt?: string; note?: string; error?: string } | null;
    setImproving(false);
    if (!response?.ok || !data?.prompt) return notice(data?.error ?? "OpenAI didn't answer. Try again.");
    setImproved({ variant, before: text, note: data.note ?? "" });
    setEdits((e) => ({ ...e, [variant]: data.prompt }));
  }

  function sendToStudio() {
    const b = prompts.blueprint;
    const handoff = makeHandoff(src, b, b.mode === "video" ? (edits.higgsfield ?? prompts.higgsfield) : (edits.gpt ?? prompts.gpt), prompts.mustAvoid, reference);
    try { sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff)); } catch { /* private mode: the Studio opens without the prefill */ }
    router.push(`${workspaceHref(productId, "studio")}?from=recreate`);
  }

  return (
    <PanelPortal onClose={onClose}>
      <div className={`${MODAL_OVERLAY} z-[45]`} onClick={(e) => { e.stopPropagation(); onClose(); }}>
        <aside className={`${MODAL} max-w-2xl`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Make this for ${appName}`}>
          <div className="sticky top-0 z-10 flex min-h-11 items-center justify-between gap-2 border-b border-line bg-card px-4 py-2">
            <span className="truncate text-sm font-medium">Make this for {appName}</span>
            <button type="button" onClick={onClose} className="grid size-7 shrink-0 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink" aria-label="Close"><IconX className="size-3.5" /></button>
          </div>
          <div className="grid gap-5 p-4">
            <div className="flex gap-3">
              {candidate && loads !== false && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={candidate} alt={`The ad from ${ad.competitor ?? ad.page_name}`} className="h-20 w-auto shrink-0 rounded-small border border-line object-cover" />
              )}
              <div className="grid min-w-0 content-start gap-1 text-xs text-muted">
                <p className="text-sm text-ink">The same kind of ad as {ad.competitor ?? ad.page_name}&apos;s, made for {appName}.</p>
                <p>It keeps their format, layout, hook and message order ({prompts.blueprint.format.toLowerCase()}, {prompts.blueprint.aspect}) and swaps in your product. Their name, logo, people and words are never copied.</p>
                <p>{prompts.blueprint.fromRead ? "Built from the AI's read of their ad." : "Built from the ad's own text and type (read the ad for a closer match)."} <a href={GUIDE} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 rounded-xs text-accent hover:underline">How this works<IconExternal className="size-3" /></a></p>
              </div>
            </div>

            {mainGaps.length > 0 && (
              <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-small border border-caution/30 bg-caution-soft px-3 py-2 text-xs text-caution-ink">
                <span className="min-w-0 flex-[1_1_260px]">Your brand has no {mainGaps.map((g) => g.label).join(" or ")} yet, so the prompt uses plainer wording. You can still continue.</span>
                <Link href={workspaceHref(productId, "brand")} className="shrink-0 rounded-xs font-medium text-accent hover:underline">Add them on Brand</Link>
              </div>
            )}
            {video && (
              <div className="grid gap-1.5">
                <Segmented label="What to make from their video" value={mode} onChange={setMode} options={[{ value: "still", label: "A still image in its style" }, { value: "video", label: "A video prompt" }]} />
                <p className="text-xs text-muted">{mode === "still" ? "One image ad that looks like a frame of their video, from its poster. It is not a video." : "A shot-by-shot prompt for a video tool (Higgsfield's Seedance, Sora, Veo). Generate here makes stills only; for a video, send it to Studio."}</p>
              </div>
            )}
            {!reference && (
              <p className="text-xs text-muted">{loads === null && candidate ? "Checking their image…" : "Their image wasn't saved and its link no longer loads, so there's no reference to download or send: the prompts describe the layout instead."}</p>
            )}

            <Section n={1} title="Ready-made prompt" hint="Paste it into ChatGPT, Higgsfield or another tool. No key needed.">
              <Segmented label="Prompt for" value={variant} onChange={setVariant} options={(Object.keys(VARIANT_LABEL) as PromptVariant[]).map((v) => ({ value: v, label: VARIANT_LABEL[v] }))} />
              <textarea className={cx(inputClass, "min-h-56 font-mono text-xs leading-relaxed")} value={text} aria-label={`${VARIANT_LABEL[variant]} prompt`}
                onChange={(e) => setEdits((all) => ({ ...all, [variant]: e.target.value }))} />
              <p className="text-xs text-muted">{VARIANT_HOW[variant]}</p>
              {improved?.variant === variant && (
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted"><IconCheck className="size-3.5 text-win" />Improved with AI{improved.note ? `: ${improved.note}` : "."}
                  <button type="button" className="rounded-xs text-accent hover:underline" onClick={() => { setEdits((e) => ({ ...e, [variant]: improved.before })); setImproved(null); }}>Undo</button>
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <CopyButton label="Copy prompt" variant="secondary" run={() => copyText(text)} />
                {reference && <CopyButton label="Download reference" icon="download" variant="ghost" run={() => downloadFile(reference, `${fileName(ad)}-reference`)} />}
                <a href={`/api/products/${productId}/brand-kit`} download className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-ink transition-colors hover:bg-hover"><IconDownload className="size-3.5" />Download my brand kit</a>
                {ai.ok && openaiKey && !ai.unknown && (
                  <Button size="sm" variant="ghost" disabled={improving} onClick={improve} title="One short OpenAI request with your key">
                    {improving && <Spinner className="size-3.5" />}Improve with AI<span className="font-normal opacity-60">· ≤{fmtUsd(improveCostUsd(text.length))}</span>
                  </Button>
                )}
              </div>
            </Section>

            <Section n={2} title="Generate here" hint={`One image, made with your own key and saved to Studio, where you can approve, edit or download it.${video ? " From a video ad, this makes a still." : ""}`}>
              {images.ok ? (
                <GenerateHere productId={productId} prompt={prompts.generate} mustAvoid={prompts.mustAvoid} blueprint={prompts.blueprint} reference={reference}
                  gen={gen} screenshots={app.screenshots} openaiKey={openaiKey} higgsfieldKey={higgsfieldKey} openaiPlan={openaiPlan} />
              ) : (
                <div className="grid gap-2 rounded-small border border-line bg-raised p-3 text-xs">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-ink"><IconLock className="size-3.5 text-muted" />Add an image key to generate here</p>
                  <p className="text-muted">OpenAI: one key, the one you may already have for reading ads. Higgsfield: its Marketing Studio ad models, with its own credits.</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <a href={repoFileUrl("docs/keys/openai.md")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-xs font-medium text-accent hover:underline">OpenAI key guide<IconExternal className="size-3" /></a>
                    <a href={repoFileUrl("docs/keys/higgsfield.md")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-xs font-medium text-accent hover:underline">Higgsfield key guide<IconExternal className="size-3" /></a>
                    <ButtonLink href="/app/settings/keys" size="sm" variant="secondary">Settings &gt; API keys</ButtonLink>
                  </div>
                  <p className="text-muted">Until then, copy the prompt above into ChatGPT or Higgsfield.</p>
                </div>
              )}
            </Section>

            <Section n={3} title="Send to Studio" hint="For a full batch: several angles and sizes from the same prompt, made and checked in Studio.">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={sendToStudio}>Send to Studio</Button>
                <Button size="sm" variant="ghost" onClick={onOpenRecreate}>Check every detail first</Button>
              </div>
            </Section>
          </div>
        </aside>
      </div>
    </PanelPortal>
  );
}

function GenerateHere({ productId, prompt, mustAvoid, blueprint, reference, gen, screenshots, openaiKey, higgsfieldKey, openaiPlan }: {
  productId: string; prompt: string; mustAvoid: string[]; blueprint: ReturnType<typeof buildPrompts>["blueprint"]; reference: string | null;
  gen: ReturnType<typeof generatePlan>; screenshots: number; openaiKey: boolean; higgsfieldKey: boolean; openaiPlan?: OpenAiImagePlan | null;
}) {
  const providers = ([higgsfieldKey ? "higgsfield" : null, openaiKey ? "openai" : null].filter(Boolean) as ImageProvider[]);
  const [provider, setProvider] = useState<ImageProvider>(providers.includes("openai") && !providers.includes("higgsfield") ? "openai" : providers[0] ?? "higgsfield");
  const sizes = providerSizes(provider, openaiPlan);
  const [aspect, setAspect] = useState<Aspect>(blueprint.aspect);
  const [resolution, setResolution] = useState<ImageResolution>("2k");
  const [quality, setQuality] = useState<ImageQuality>("medium");
  const okSize = sizeAllowed(provider, openaiPlan, resolution, quality);
  const input = { prompt, blueprint, provider, aspect, resolution, quality, reference, logo: gen.logo, screens: gen.screens, screenshots: gen.screenshots, mustAvoid };
  const request = useMemo(() => makeRequest(input), [prompt, provider, aspect, resolution, quality, reference, gen.logo, gen.screens, gen.screenshots, mustAvoid]); // eslint-disable-line react-hooks/exhaustive-deps
  const local = makeCost({ provider, aspect, resolution, quality, references: makeReferenceCount(input, screenshots), promptChars: prompt.length + 300 });
  // The exact price from the planner (what the batch route charges); the local estimate shows until it answers.
  const [plan, setPlan] = useState<{ key: string; credits: number; usd: number; errors: string[]; warnings: string[] } | null>(null);
  const key = JSON.stringify(request);
  useEffect(() => {
    let live = true;
    fetch(`/api/studio/${productId}/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request }) })
      .then((r) => r.json()).then((d) => { if (live && typeof d.credits === "number") setPlan({ key, credits: d.credits, usd: d.usd ?? 0, errors: d.errors ?? [], warnings: d.warnings ?? [] }); })
      .catch(() => {});
    return () => { live = false; };
  }, [key, productId, request]);
  const exact = plan?.key === key ? plan : null;
  const label = exact ? (provider === "openai" ? `~${fmtUsd(exact.usd)} at OpenAI` : `~${exact.credits} credit${exact.credits === 1 ? "" : "s"} at Higgsfield`) : local.label;
  const storage = useStorageGuard("generate");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);

  async function start() {
    if (!exact || exact.errors.length) return;
    setBusy(true); setError(null);
    const response = await fetch(`/api/studio/${productId}/batches`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request, confirmedCredits: exact.credits, confirmedUsd: exact.usd }) }).catch(() => null);
    const data = await response?.json().catch(() => null) as { batchId?: string; error?: string } | null;
    setBusy(false);
    if (!response?.ok || !data?.batchId) return setError(data?.error ?? "Couldn't start it. Try again.");
    setBatchId(data.batchId);
    void refreshStorage();
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-2">
        {providers.length > 1 ? (
          <Segmented label="Provider" value={provider} onChange={setProvider} options={providers.map((p) => ({ value: p, label: PROVIDER_NAME[p] }))} />
        ) : <Badge>{PROVIDER_NAME[provider]}</Badge>}
        <select className={cx(inputClass, "h-7 w-auto! py-1 text-xs")} aria-label="Aspect ratio" value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)}>
          {sizes.aspects.map((a) => <option key={a} value={a}>{a}{a === blueprint.aspect ? " (as theirs)" : ""}</option>)}
        </select>
        <select className={cx(inputClass, "h-7 w-auto! py-1 text-xs")} aria-label="Resolution" value={resolution} onChange={(e) => setResolution(e.target.value as ImageResolution)}>
          {sizes.resolutions.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
        </select>
        <select className={cx(inputClass, "h-7 w-auto! py-1 text-xs")} aria-label="Quality" value={quality} onChange={(e) => setQuality(e.target.value as ImageQuality)}>
          {sizes.qualities.map((q) => <option key={q} value={q} disabled={!sizeAllowed(provider, openaiPlan, resolution, q)}>{QUALITY_LABEL[q]}</option>)}
        </select>
      </div>
      {provider === "higgsfield" && aspect === "4:5" && <p className="text-xs text-muted">Higgsfield&apos;s API makes 4:5 as 3:4; Meta trims it to 4:5.</p>}
      {!okSize && <p className="text-xs text-warn">This quality at {resolution.toUpperCase()} takes longer than your Supabase plan allows one run. Pick a lower quality or resolution.</p>}
      {exact?.errors[0] && <p className="text-xs text-warn">{exact.errors[0]}</p>}
      <StorageNotice action="generate" />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !exact || Boolean(exact.errors.length) || !okSize || storage.block} onClick={start}>
          {busy && <Spinner className="size-3.5" />}{batchId ? "Generate another" : "Generate"}<span className="font-normal opacity-70">· {label}</span>
        </Button>
        <span className="text-xs text-muted">{reference ? "Their ad goes as the layout reference" : "No reference image"}{gen.logo ? ", your logo after it" : ""}{gen.refs.screens ? `, ${gen.refs.screens} app screen${gen.refs.screens === 1 ? "" : "s"}` : ""}.</span>
      </div>
      {error && <p role="alert" className="text-xs text-warn">{error}</p>}
      {batchId && <Results key={batchId} productId={productId} batchId={batchId} openaiKey={openaiKey} higgsfieldKey={higgsfieldKey} />}
    </div>
  );
}

/** What "Generate here" started, live: each job's status, its image when it's ready, and a way on when it fails. */
function Results({ productId, batchId, openaiKey, higgsfieldKey }: { productId: string; batchId: string; openaiKey: boolean; higgsfieldKey: boolean }) {
  const [data, setData] = useState<{ jobs: Job[]; creatives: Made[] } | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const soon = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(() => {
    fetch(`/api/studio/${productId}/batches?id=${batchId}`, { cache: "no-store" }).then((r) => r.json()).then((d) => { if (Array.isArray(d.jobs)) setData(d); }).catch(() => {});
  }, [productId, batchId]);
  useEffect(() => {
    load();
    const later = () => { if (soon.current) clearTimeout(soon.current); soon.current = setTimeout(load, 400); };
    const channel = supabase.channel(`make-${batchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "creative_jobs", filter: `batch_id=eq.${batchId}` }, later)
      .on("postgres_changes", { event: "*", schema: "public", table: "creatives", filter: `batch_id=eq.${batchId}` }, later)
      .subscribe();
    // A slow fallback, in case Realtime isn't reachable.
    const poll = setInterval(load, 15_000);
    return () => { supabase.removeChannel(channel); clearInterval(poll); if (soon.current) clearTimeout(soon.current); };
  }, [batchId, load, supabase]);

  const post = (id: string, body: Record<string, unknown>) => fetch(`/api/studio/jobs/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({ error: "The server didn't answer. Try again." })) }));

  async function retry(job: Job) {
    const provider = providerOfJob(job.params);
    if (!(await confirmRetry({ provider, credits: Number(job.cost_estimate) || 0, usd: Number(job.params.est_usd) || 0, what: `Image · ${job.aspect}` }))) return;
    setActing(job.id);
    const done = await post(job.id, { action: "retry" });
    setActing(null);
    if (!done.ok) return notice(done.data.error);
    load();
  }

  async function switchProvider(job: Job) {
    const to = otherProvider(providerOfJob(job.params));
    setActing(job.id);
    const planned = await post(job.id, { action: "plan-switch", provider: to });
    setActing(null);
    if (!planned.ok) return notice(planned.data.error ?? "Couldn't check the price. Try again.");
    const { credits, usd } = planned.data as { credits: number; usd: number };
    const ok = await ask({ title: `Make it with ${PROVIDER_NAME[to]}?`, confirm: to === "openai" ? `Spend ≈${fmtUsd(usd)} at OpenAI` : `Spend ~${credits} credits`,
      body: <Facts rows={[["Model", `GPT Image 2.5 · via ${PROVIDER_NAME[to]}`], to === "openai" ? ["Estimated OpenAI cost", `≈ ${fmtUsd(usd)}`] : ["Estimated Higgsfield cost", `${credits} credits`]]} note="The same prompt and images on the other provider." /> });
    if (!ok) return;
    setActing(job.id);
    const made = await post(job.id, { action: "switch", provider: to, confirmedCredits: credits, confirmedUsd: usd });
    setActing(null);
    if (!made.ok) return notice(made.data.error ?? "Couldn't queue it. Try again.");
    load();
  }

  if (!data) return <p className="flex items-center gap-1.5 text-xs text-muted"><Spinner className="size-3.5" />Starting…</p>;
  return (
    <ul className="grid gap-2" aria-live="polite">
      {data.jobs.map((job) => {
        const made = data.creatives.filter((c) => c.job_id === job.id);
        const provider = providerOfJob(job.params);
        const other = otherProvider(provider);
        const canSwitch = job.model === "gpt_image_2_5" && (other === "openai" ? openaiKey : higgsfieldKey);
        const urls = Array.isArray(job.params.result_urls) ? (job.params.result_urls as string[]).filter((u) => /^https:\/\//.test(u)) : [];
        return (
          <li key={job.id} className="grid gap-2 rounded-small border border-line bg-raised p-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={job.status === "done" ? "win" : job.status === "failed" ? "warn" : job.status === "cancelled" ? "neutral" : "accent"}>
                {["queued", "running", "finalizing"].includes(job.status) && <Gear className="size-3" />}
                {job.status === "done" ? "Ready" : job.status === "failed" ? "Failed" : job.status === "cancelled" ? "Cancelled" : job.status === "queued" ? "Waiting" : "Making it"}
              </Badge>
              <span className="text-muted">{PROVIDER_NAME[provider]} · {job.aspect}</span>
              {job.status === "done" && <Link href={workspaceHref(productId, "studio")} className="ml-auto rounded-xs font-medium text-accent hover:underline">Open in Studio</Link>}
            </div>
            {made.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {made.map((c) => (
                  <a key={c.id} href={c.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-small border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.thumbnail_url ?? c.url} alt={`Made for your app, ${c.aspect}`} className="h-40 w-auto object-cover" />
                  </a>
                ))}
              </div>
            )}
            {job.status === "failed" && (
              <>
                <p className="text-warn">{providerErrorText(job.error, provider)}</p>
                {urls.length > 0 && <p className="text-muted">The finished file is still at {PROVIDER_NAME[provider]}: <a href={urls[0]} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">download it</a> (the link may expire).</p>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={acting === job.id} onClick={() => retry(job)}>Retry</Button>
                  {canSwitch && <Button size="sm" variant="ghost" disabled={acting === job.id} onClick={() => switchProvider(job)}>Try with {PROVIDER_NAME[other]} instead</Button>}
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
