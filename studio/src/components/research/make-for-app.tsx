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
import { useExample } from "@/lib/example-mode";
import { repoFileUrl } from "@/lib/brand-config";
import type { ImageQuality, ImageResolution, SourceAdRef } from "@/lib/creative-plan";
import { fmtUsd, otherProvider, PROVIDER_NAME, providerOfJob, type ImageProvider, type OpenAiImagePlan } from "@/lib/image-provider";
import { useInstall } from "@/lib/install/use-install";
import {
  appFromBrand, brandGaps, buildPrompts, generatePlan, improveCostUsd, makeCost, makeHandoff, makeReferenceCount, makeRequest, providerErrorText, providerSizes, sizeAllowed,
  VARIANT_HOW, VARIANT_LABEL, type AdBlueprint, type PromptVariant,
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
import { appSettingsHref } from "@/lib/nav-model";
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";
import { sentenceGap } from "@/lib/i18n/join";
import { rich } from "../rich";

const GUIDE = repoFileUrl("docs/RECREATE-ADS.md");
const QUALITY_LABEL: Record<ImageQuality, string> = { low: m("Low"), medium: m("Medium"), high: m("High"), xhigh: m("Extra high"), max: m("Max") };

/** The blueprint's format name in the page's language: its m()-marked label translated, else their own name as it is. */
function formatName(blueprint: Pick<AdBlueprint, "format" | "formatText">, t: (text: string, vars?: Record<string, string | number>) => string): string {
  return blueprint.formatText ? t(blueprint.formatText.text, blueprint.formatText.vars) : blueprint.format;
}

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
    if (!ok) throw new Error("copy refused");
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
  const { t, intl, locale } = useT();
  const router = useRouter();
  // The example app's pictures are bundled with the app (same address, http while developing): they count as the real ones would.
  const example = useExample();
  const fetchable = useCallback((url: string) => /^https:\/\//.test(url) || (example && url.startsWith(`${window.location.origin}/`)), [example]);
  const app = useMemo(() => appFromBrand(brand, assets, fetchable), [brand, assets, fetchable]);
  const appName = app.name || t("your app");
  const gaps = brandGaps(app);
  const mainGaps = gaps.filter((g) => g.main && g.key !== "name");
  const src = useMemo(() => sourceFromAd(ad, measured), [ad, measured]);
  const video = src.video;
  const [mode, setMode] = useState<"still" | "video">("still");

  // Their image: the stored copy, else the preview link if it still loads. A video's poster stands in for it.
  const first = media[0];
  const candidate = (video ? first?.thumbnail_url ?? ad.thumb : media.find((m) => m.type === "image")?.url ?? ad.thumb) ?? null;
  const loads = useLoads(candidate && fetchable(candidate) ? candidate : null);
  const reference = loads ? candidate : null;

  const gen = useMemo(() => generatePlan(app, reference), [app, reference]);
  const prompts = useMemo(() => buildPrompts(src, app, { mode: video ? mode : undefined, refs: { reference: Boolean(reference) }, generateRefs: gen.refs }), [src, app, video, mode, reference, gen.refs]);
  const [variant, setVariant] = useState<PromptVariant>("gpt");
  const [edits, setEdits] = useState<Partial<Record<PromptVariant, string>>>({});
  const [improved, setImproved] = useState<{ variant: PromptVariant; before: string; note: string } | null>(null);
  const [improving, setImproving] = useState(false);
  const text = edits[variant] ?? prompts[variant];
  const { install } = useInstall();
  const ai = featureState("ai", install, null, { t, intl });
  const openaiKey = !install || Boolean(install.keys.OPENAI_API_KEY?.set);
  const higgsfieldKey = !install || Boolean(install.keys.HIGGSFIELD_API_KEY?.set);
  const images = featureState("studio.images", install, null, { t, intl });

  async function improve() {
    const cost = improveCostUsd(text.length);
    const ok = await ask({ title: t("Improve this prompt with AI?"), confirm: t("Spend at most ≈{usd} at OpenAI", { usd: fmtUsd(cost, intl) }), body: <Facts rows={[[t("What"), t("OpenAI rewrites it more precisely, keeping every fact, colour, font and rule")], [t("Estimated OpenAI cost"), t("at most ≈ {usd}", { usd: fmtUsd(cost, intl) })]]} note={t("It never adds a claim, number or brand. A rewrite that breaks your brand rules is refused and your prompt stays.")} /> });
    if (!ok) return;
    setImproving(true);
    const response = await fetch(`/api/products/${productId}/improve-prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: text, mustAvoid: prompts.mustAvoid }) }).catch(() => null);
    const data = await response?.json().catch(() => null) as { prompt?: string; note?: string; error?: string } | null;
    setImproving(false);
    if (!response?.ok || !data?.prompt) return notice(data?.error ?? t("OpenAI didn't answer. Try again."));
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
        <aside className={`${MODAL} max-w-2xl`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("Make this for {app}", { app: appName })}>
          <div className="sticky top-0 z-10 flex min-h-11 items-center justify-between gap-2 border-b border-line bg-card px-4 py-2">
            <span className="truncate text-sm font-medium">{t("Make this for {app}", { app: appName })}</span>
            <button type="button" onClick={onClose} className="grid size-7 shrink-0 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink" aria-label={t("Close")}><IconX className="size-3.5" /></button>
          </div>
          <div className="grid gap-5 p-4">
            <div className="flex gap-3">
              {candidate && loads !== false && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={candidate} alt={t("The ad from {name}", { name: ad.competitor ?? ad.page_name })} className="h-20 w-auto shrink-0 rounded-small border border-line object-cover" />
              )}
              <div className="grid min-w-0 content-start gap-1 text-xs text-muted">
                <p className="text-sm text-ink">{t("The same kind of ad as {name}'s, made for {app}.", { name: ad.competitor ?? ad.page_name, app: appName })}</p>
                <p>{t("It keeps their format, layout, hook and message order ({format}, {aspect}) and swaps in your product. Their name, logo, people and words are never copied.", { format: locale === "en" ? prompts.blueprint.format.toLowerCase() : formatName(prompts.blueprint, t), aspect: prompts.blueprint.aspect })}</p>
                <p>{prompts.blueprint.fromRead ? t("Built from the AI's read of their ad.") : t("Built from the ad's own text and type (read the ad for a closer match).")}{sentenceGap(locale)}<a href={GUIDE} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 rounded-xs text-accent hover:underline">{t("How this works")}<IconExternal className="size-3" /></a></p>
              </div>
            </div>

            {mainGaps.length > 0 && (
              <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-small border border-caution/30 bg-caution-soft px-3 py-2 text-xs text-caution-ink">
                <span className="min-w-0 flex-[1_1_260px]">{t("Your brand has no {items} yet, so the prompt uses plainer wording. You can still continue.", { items: new Intl.ListFormat(intl, { type: "disjunction" }).format(mainGaps.map((g) => t(g.label))) })}</span>
                <Link href={appSettingsHref(productId, "brand")} className="shrink-0 rounded-xs font-medium text-accent hover:underline">{t("Add them in App settings")}</Link>
              </div>
            )}
            {video && (
              <div className="grid gap-1.5">
                <Segmented label={t("What to make from their video")} value={mode} onChange={setMode} options={[{ value: "still", label: t("A still image in its style") }, { value: "video", label: t("A video prompt") }]} />
                <p className="text-xs text-muted">{mode === "still" ? t("One image ad that looks like a frame of their video, from its poster. It is not a video.") : t("A shot-by-shot prompt for a video tool (Higgsfield's Seedance, Sora, Veo). Generate here makes stills only; for a video, send it to Studio.")}</p>
              </div>
            )}
            {!reference && (
              <p className="text-xs text-muted">{loads === null && candidate ? t("Checking their image…") : t("Their image wasn't saved and its link no longer loads, so there's no reference to download or send: the prompts describe the layout instead.")}</p>
            )}

            <Section n={1} title={t("Ready-made prompt")} hint={t("Paste it into ChatGPT, Higgsfield or another tool. No key needed.")}>
              <Segmented label={t("Prompt for")} value={variant} onChange={setVariant} options={(Object.keys(VARIANT_LABEL) as PromptVariant[]).map((v) => ({ value: v, label: t(VARIANT_LABEL[v]) }))} />
              <textarea className={cx(inputClass, "min-h-56 font-mono text-xs leading-relaxed")} value={text} aria-label={t("{tool} prompt", { tool: t(VARIANT_LABEL[variant]) })}
                onChange={(e) => setEdits((all) => ({ ...all, [variant]: e.target.value }))} />
              <p className="text-xs text-muted">{t(VARIANT_HOW[variant])}</p>
              {improved?.variant === variant && (
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted"><IconCheck className="size-3.5 text-win" />{improved.note ? t("Improved with AI: {note}", { note: improved.note }) : t("Improved with AI.")}
                  <button type="button" className="rounded-xs text-accent hover:underline" onClick={() => { setEdits((e) => ({ ...e, [variant]: improved.before })); setImproved(null); }}>{t("Undo")}</button>
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <CopyButton label={t("Copy prompt")} variant="secondary" run={() => copyText(text)} />
                {reference && <CopyButton label={t("Download reference")} icon="download" variant="ghost" run={() => downloadFile(reference, `${fileName(ad)}-reference`)} />}
                <a href={`/api/products/${productId}/brand-kit`} download className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-ink transition-colors hover:bg-hover"><IconDownload className="size-3.5" />{t("Download my brand kit")}</a>
                {ai.ok && openaiKey && !ai.unknown && (
                  <Button size="sm" variant="ghost" disabled={improving} onClick={improve} title={t("One short OpenAI request with your key")}>
                    {improving && <Spinner className="size-3.5" />}{t("Improve with AI")}<span className="font-normal opacity-60">· ≤{fmtUsd(improveCostUsd(text.length), intl)}</span>
                  </Button>
                )}
              </div>
            </Section>

            <Section n={2} title={t("Generate here")} hint={video ? t("One image, made with your own key and saved to Studio, where you can approve, edit or download it. From a video ad, this makes a still.") : t("One image, made with your own key and saved to Studio, where you can approve, edit or download it.")}>
              {images.ok ? (
                <GenerateHere productId={productId} prompt={prompts.generate} mustAvoid={prompts.mustAvoid} blueprint={prompts.blueprint} reference={reference} sourceAd={{ adId: src.adId, libraryId: src.libraryId, pageName: src.competitor ?? src.pageName }}
                  gen={gen} screenshots={app.screenshots} openaiKey={openaiKey} higgsfieldKey={higgsfieldKey} openaiPlan={openaiPlan} />
              ) : (
                <div className="grid gap-2 rounded-small border border-line bg-raised p-3 text-xs">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-ink"><IconLock className="size-3.5 text-muted" />{t("Add an image key to generate here")}</p>
                  <p className="text-muted">{t("OpenAI: one key, the one you may already have for reading ads. Higgsfield: its Marketing Studio ad models, with its own credits.")}</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <a href={repoFileUrl("docs/keys/openai.md")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-xs font-medium text-accent hover:underline">{t("OpenAI key guide")}<IconExternal className="size-3" /></a>
                    <a href={repoFileUrl("docs/keys/higgsfield.md")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-xs font-medium text-accent hover:underline">{t("Higgsfield key guide")}<IconExternal className="size-3" /></a>
                    <ButtonLink href="/app/settings/keys" size="sm" variant="secondary">{t("Settings › Your keys")}</ButtonLink>
                  </div>
                  <p className="text-muted">{t("Until then, copy the prompt above into ChatGPT or Higgsfield.")}</p>
                </div>
              )}
            </Section>

            <Section n={3} title={t("Send to Studio")} hint={t("For a full batch: several angles and sizes from the same prompt, made and checked in Studio.")}>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={sendToStudio}>{t("Send to Studio")}</Button>
                <Button size="sm" variant="ghost" onClick={onOpenRecreate}>{t("Check every detail first")}</Button>
              </div>
            </Section>
          </div>
        </aside>
      </div>
    </PanelPortal>
  );
}

function GenerateHere({ productId, prompt, mustAvoid, blueprint, reference, sourceAd, gen, screenshots, openaiKey, higgsfieldKey, openaiPlan }: {
  productId: string; prompt: string; mustAvoid: string[]; blueprint: ReturnType<typeof buildPrompts>["blueprint"]; reference: string | null; sourceAd: SourceAdRef;
  gen: ReturnType<typeof generatePlan>; screenshots: number; openaiKey: boolean; higgsfieldKey: boolean; openaiPlan?: OpenAiImagePlan | null;
}) {
  const { t, tn, intl } = useT();
  const sep = intl.startsWith("ja") || intl.startsWith("zh") ? "、" : ", ";
  const providers = ([higgsfieldKey ? "higgsfield" : null, openaiKey ? "openai" : null].filter(Boolean) as ImageProvider[]);
  const [provider, setProvider] = useState<ImageProvider>(providers.includes("openai") && !providers.includes("higgsfield") ? "openai" : providers[0] ?? "higgsfield");
  const sizes = providerSizes(provider, openaiPlan);
  const [aspect, setAspect] = useState<Aspect>(blueprint.aspect);
  const [resolution, setResolution] = useState<ImageResolution>("2k");
  const [quality, setQuality] = useState<ImageQuality>("medium");
  const okSize = sizeAllowed(provider, openaiPlan, resolution, quality);
  const input = { prompt, blueprint, provider, aspect, resolution, quality, reference, logo: gen.logo, screens: gen.screens, screenshots: gen.screenshots, mustAvoid, sourceAd };
  const request = useMemo(() => makeRequest(input), [prompt, provider, aspect, resolution, quality, reference, gen.logo, gen.screens, gen.screenshots, mustAvoid, sourceAd.adId]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const priced = exact ?? local;
  const label = provider === "openai" ? t("~{usd} at OpenAI", { usd: fmtUsd(priced.usd, intl) }) : tn(priced.credits, "~{n} credit at Higgsfield", "~{n} credits at Higgsfield");
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
    if (!response?.ok || !data?.batchId) return setError(data?.error ?? t("Couldn't start it. Try again."));
    setBatchId(data.batchId);
    void refreshStorage();
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-2">
        {providers.length > 1 ? (
          <Segmented label={t("Provider")} value={provider} onChange={setProvider} options={providers.map((p) => ({ value: p, label: PROVIDER_NAME[p] }))} />
        ) : <Badge>{PROVIDER_NAME[provider]}</Badge>}
        <select className={cx(inputClass, "h-7 w-auto! py-1 text-xs")} aria-label={t("Aspect ratio")} value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)}>
          {sizes.aspects.map((a) => <option key={a} value={a}>{a === blueprint.aspect ? t("{aspect} (as theirs)", { aspect: a }) : a}</option>)}
        </select>
        <select className={cx(inputClass, "h-7 w-auto! py-1 text-xs")} aria-label={t("Resolution")} value={resolution} onChange={(e) => setResolution(e.target.value as ImageResolution)}>
          {sizes.resolutions.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
        </select>
        <select className={cx(inputClass, "h-7 w-auto! py-1 text-xs")} aria-label={t("Quality")} value={quality} onChange={(e) => setQuality(e.target.value as ImageQuality)}>
          {sizes.qualities.map((q) => <option key={q} value={q} disabled={!sizeAllowed(provider, openaiPlan, resolution, q)}>{t(QUALITY_LABEL[q])}</option>)}
        </select>
      </div>
      {provider === "higgsfield" && aspect === "4:5" && <p className="text-xs text-muted">{t("Higgsfield's API makes 4:5 as 3:4; Meta trims it to 4:5.")}</p>}
      {!okSize && <p className="text-xs text-warn">{t("This quality at {resolution} takes longer than your Supabase plan allows one run. Pick a lower quality or resolution.", { resolution: resolution.toUpperCase() })}</p>}
      {exact?.errors[0] && <p className="text-xs text-warn">{exact.errors[0]}</p>}
      <StorageNotice action="generate" />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !exact || Boolean(exact.errors.length) || !okSize || storage.block} onClick={start}>
          {busy && <Spinner className="size-3.5" />}{batchId ? t("Generate another") : t("Generate")}<span className="font-normal opacity-70">· {label}</span>
        </Button>
        <span className="text-xs text-muted">{[reference ? t("Their ad goes as the layout reference") : t("No reference image"), gen.logo ? t("your logo after it") : "", gen.refs.screens ? tn(gen.refs.screens, "{n} app screen", "{n} app screens") : ""].filter(Boolean).join(sep)}</span>
      </div>
      {error && <p role="alert" className="text-xs text-warn">{error}</p>}
      {batchId && <Results key={batchId} productId={productId} batchId={batchId} openaiKey={openaiKey} higgsfieldKey={higgsfieldKey} />}
    </div>
  );
}

/** What "Generate here" started, live: each job's status, its image when it's ready, and a way on when it fails. */
function Results({ productId, batchId, openaiKey, higgsfieldKey }: { productId: string; batchId: string; openaiKey: boolean; higgsfieldKey: boolean }) {
  const { t, intl } = useT();
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
    .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({ error: t("The server didn't answer. Try again.") })) }));

  async function retry(job: Job) {
    const provider = providerOfJob(job.params);
    if (!(await confirmRetry({ provider, credits: Number(job.cost_estimate) || 0, usd: Number(job.params.est_usd) || 0, what: t("Image · {aspect}", { aspect: job.aspect }) }))) return;
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
    if (!planned.ok) return notice(planned.data.error ?? t("Couldn't check the price. Try again."));
    const { credits, usd } = planned.data as { credits: number; usd: number };
    const ok = await ask({ title: t("Make it with {provider}?", { provider: PROVIDER_NAME[to] }), confirm: to === "openai" ? t("Spend ≈{usd} at OpenAI", { usd: fmtUsd(usd, intl) }) : t("Spend ~{n} credits", { n: credits }),
      body: <Facts rows={[[t("Model"), t("GPT Image 2.5 · via {provider}", { provider: PROVIDER_NAME[to] })], to === "openai" ? [t("Estimated OpenAI cost"), `≈ ${fmtUsd(usd, intl)}`] : [t("Estimated Higgsfield cost"), t("{n} credits", { n: credits })]]} note={t("The same prompt and images on the other provider.")} /> });
    if (!ok) return;
    setActing(job.id);
    const made = await post(job.id, { action: "switch", provider: to, confirmedCredits: credits, confirmedUsd: usd });
    setActing(null);
    if (!made.ok) return notice(made.data.error ?? t("Couldn't queue it. Try again."));
    load();
  }

  if (!data) return <p className="flex items-center gap-1.5 text-xs text-muted"><Spinner className="size-3.5" />{t("Starting…")}</p>;
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
                {job.status === "done" ? t("Ready") : job.status === "failed" ? t("Failed") : job.status === "cancelled" ? t("Cancelled") : job.status === "queued" ? t("Waiting") : t("Making it")}
              </Badge>
              <span className="text-muted">{PROVIDER_NAME[provider]} · {job.aspect}</span>
              {job.status === "done" && <Link href={workspaceHref(productId, "studio")} className="ml-auto rounded-xs font-medium text-accent hover:underline">{t("Open in Studio")}</Link>}
            </div>
            {made.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {made.map((c) => (
                  <a key={c.id} href={c.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-small border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.thumbnail_url ?? c.url} alt={t("Made for your app, {aspect}", { aspect: c.aspect })} className="h-40 w-auto object-cover" />
                  </a>
                ))}
              </div>
            )}
            {job.status === "failed" && (
              <>
                <p className="text-warn">{providerErrorText(job.error, provider, t)}</p>
                {urls.length > 0 && <p className="text-muted">{rich(t("The finished file is still at {provider}: {link} (the link may expire)."), { provider: PROVIDER_NAME[provider], link: <a href={urls[0]} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">{t("download it")}</a> })}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={acting === job.id} onClick={() => retry(job)}>{t("Retry")}</Button>
                  {canSwitch && <Button size="sm" variant="ghost" disabled={acting === job.id} onClick={() => switchProvider(job)}>{t("Try with {provider} instead", { provider: PROVIDER_NAME[other] })}</Button>}
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
