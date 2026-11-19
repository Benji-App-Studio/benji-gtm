"use client";
// A new batch, in five steps: where it starts from, what to make and where it goes, the brief, how many
// variants, and Create. A kind this install can't make yet (no key for it, or it needs the desktop
// runner) is shown locked with where to set it up, and is left out of the batch. Everything else has a default and sits in "More options" (batch-options.tsx).
// An optional awareness level (awareness-picker.tsx, lib/awareness.ts) aims the batch at one rung of the
// ladder and warns when it repeats a recent batch's level, format and hook.
// The estimate updates as you type; Create asks for confirmation with the cost first. Image ads (GPT
// Image 2.5) are made via Higgsfield or via OpenAI, picked next to Create (the product's remembered
// choice to start): Higgsfield costs credits, OpenAI dollars, and the dialog shows which.
//
// "Start from" is one control for every way in:
// - a blank brief;
// - a format (format-start.tsx): a winning format's recipe at an angle fills the brief, kind and placement;
// - a Playground template (template-start.tsx): opens it on the Playground, where remakes are made;
// - Research, when the page opens prefilled from it, read once on mount:
//   - the Recreate sheet: `?from=recreate` with the handoff in sessionStorage (lib/recreate.ts HANDOFF_KEY):
//     brief, placement, kind, carousel cards, references, logo and the must-avoid list the check uses;
//   - a link with `?placement=<id>&kind=<image|ai_video|ugc_video>&brief=<text>` (and `format=carousel`);
//   - Our ads → "More like our winners": `?from=winners` with the handoff in sessionStorage (lib/winners.ts
//     WINNERS_KEY): a brief from what our long-runners share, their images and their offer wording.
// `?start=format` (with `&card=<id>`) or `?start=template` opens on that start.
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CAROUSEL_PLACEMENTS, PLACEMENT_IDS, PLACEMENTS, type PlacementId } from "@/lib/meta-formats";
import { DEFAULT_REQUEST, KIND_LABEL, KINDS, LIMITS, parsePosts, planBatch, PRICES_CHECKED, requestFromJob, type BatchRequest, type CreativeKind, type ProductReference } from "@/lib/creative-plan";
import type { StudioOverview } from "@/lib/creative-types";
import { ASSET_KIND_LABEL, peopleWarning, PRODUCT_REFERENCES, type AssetKind } from "@/lib/product-assets";
import { HANDOFF_KEY, readHandoff, requestFromHandoff, type RecreateHandoff } from "@/lib/recreate";
import { readWinners, requestFromWinners, WINNER_KIND_LABEL, WINNERS_KEY, type WinnersHandoff } from "@/lib/winners";
import { defaultLogo, logoCandidates, positionWhere } from "@/lib/logo-overlay";
import { fmtUsd, OPENAI_IMAGE_PRICING, planCostLabel } from "@/lib/image-provider";
import { ImageProviderPicker } from "../image-provider-picker";
import { ask, Facts, notice } from "../dialog";
import { IconLock } from "../icons";
import { PlaybookTip } from "../playbook-tip";
import type { ImageTile } from "../research/product-image-picker";
import { Badge, Button, Card, cx, Field, inputClass, Segmented, Spinner } from "../ui";
import { nearDuplicate } from "@/lib/awareness";
import { AwarenessPicker } from "./awareness-picker";
import { BatchOptions, optionsSummary } from "./batch-options";
import { availableProvider, FeatureLock, RunnerLock, type Features } from "./features";
import { FormatStart, type FormatPick } from "./format-start";
import { PlacementPicker } from "./placement-picker";
import { TemplateStart } from "./template-start";
import { readStored } from "@/lib/storage-keys";

const chip = (on: boolean) => cx("inline-flex h-7 items-center gap-1.5 rounded-control border px-2.5 text-sm transition-colors disabled:pointer-events-none disabled:opacity-55 [&_svg]:size-3.5",
  on ? "border-accent bg-accent-soft font-medium text-ink" : "border-hairline bg-raised text-ink hover:bg-hover");

/**
 * Why a kind can't be made in this install yet (shown in place of making it), or null. UGC videos are
 * only made by the desktop runner; images and AI videos need a key, or the runner, which makes them too.
 * Posts are drawn from templates and need nothing.
 */
function kindLock(kind: CreativeKind, features: Features): ReactNode {
  if (!features.install) return null;
  if (kind === "ugc_video") return features.runner ? null : <RunnerLock>{KIND_LABEL.ugc_video} needs the desktop runner</RunnerLock>;
  if (features.runner) return null;
  const state = kind === "ai_video" ? features.locked("studio.video") : kind === "image" ? features.locked("studio.images") : null;
  return state ? <FeatureLock state={state} /> : null;
}
const fmtCredits = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(2));

type Start = "blank" | "format" | "template" | "research";

const PREFILL_KINDS: CreativeKind[] = ["image", "ai_video", "ugc_video"];
const kindLabel = (kind: string) => ASSET_KIND_LABEL[kind as AssetKind] ?? kind.replace("_", " ");

/** A request prefilled from the page's query (Research → "Recreate in Studio"), or null when there's nothing to use. */
function fromQuery(params: URLSearchParams | null): BatchRequest | null {
  if (!params) return null;
  const placement = params.get("placement") as PlacementId | null;
  const kind = params.get("kind") as CreativeKind | null;
  const brief = params.get("brief")?.trim().slice(0, LIMITS.briefChars) ?? "";
  const next: BatchRequest = { ...DEFAULT_REQUEST };
  if (placement && PLACEMENT_IDS.includes(placement)) next.placements = [placement];
  if (kind && PREFILL_KINDS.includes(kind)) next.kinds = [kind];
  if (brief) next.brief = brief;
  if (params.get("format") === "carousel" && next.kinds.length === 1 && next.kinds[0] === "image") {
    next.format = "carousel";
    if (!next.placements?.every((id) => CAROUSEL_PLACEMENTS.includes(id))) next.placements = ["square"];
  }
  return next.placements !== DEFAULT_REQUEST.placements || next.kinds !== DEFAULT_REQUEST.kinds || next.brief ? next : null;
}

/** A format's recipe as a request: its model, prompt and settings (requestFromJob), on the placements of its sizes. */
function fromFormat({ card, recipe }: FormatPick, variants: number): BatchRequest {
  const next = requestFromJob({ productId: card.productId, formatCardId: card.persisted ? card.id : null, model: recipe.model, prompt: recipe.prompt, params: recipe.params });
  const placements = [...new Set(next.aspects.map((a) => PLACEMENTS.find((p) => p.aspect === a)?.id).filter((id): id is PlacementId => Boolean(id)))];
  return { ...next, placements: placements.length ? placements : next.placements, variants };
}

export function BatchForm({ productId, overview, features, onStarted }: { productId: string; overview: StudioOverview; features: Features; onStarted: () => void }) {
  const params = useSearchParams();
  // Read once: later changes to the URL don't overwrite what the user typed.
  const [prefill] = useState(() => fromQuery(params));
  const fromRecreate = params?.get("from") === "recreate";
  const fromWinners = params?.get("from") === "winners";
  const [linkedCard] = useState(() => params?.get("card") ?? null);
  const [start, setStart] = useState<Start>(() => {
    if (prefill || fromRecreate || fromWinners) return "research";
    const asked = params?.get("start");
    return asked === "format" || asked === "template" ? asked : "blank";
  });
  // The product's remembered image provider is where every start begins (Higgsfield unless changed).
  // "Place the real logo" starts on when there's a logo (Product page logo or brand kit icon).
  const defaults = useMemo<BatchRequest>(() => ({
    ...DEFAULT_REQUEST, image: { ...DEFAULT_REQUEST.image, provider: overview.workspace.imageProvider ?? "higgsfield" },
    logo: defaultLogo(logoCandidates(overview.workspace.assets ?? [], overview.workspace.iconUrl)),
  }), [overview.workspace.imageProvider, overview.workspace.assets, overview.workspace.iconUrl]);
  const [asked, setReq] = useState<BatchRequest>(() => prefill ? { ...prefill, image: { ...prefill.image, provider: overview.workspace.imageProvider ?? "higgsfield" }, logo: defaults.logo } : defaults);
  // What will really be made: the kinds asked for that this install can make, on an image provider that has a key.
  const locks = useMemo(() => Object.fromEntries(KINDS.map((k) => [k, kindLock(k, features)])) as Record<CreativeKind, ReactNode>, [features]);
  const req = useMemo<BatchRequest>(() => {
    const kinds = asked.kinds.filter((k) => !locks[k]);
    const provider = availableProvider(asked.image.provider ?? "higgsfield", features.imageProviders);
    return kinds.length === asked.kinds.length && provider === (asked.image.provider ?? "higgsfield") ? asked : { ...asked, kinds, image: { ...asked.image, provider } };
  }, [asked, locks, features.imageProviders]);
  const lockedKinds = KINDS.filter((k) => locks[k]);
  const aiLock = features.locked("ai");
  const [recreate, setRecreate] = useState<RecreateHandoff | null>(null);
  // Research → Recreate: the handoff is in sessionStorage, which only the browser has, so it's read after mount.
  useEffect(() => {
    if (!fromRecreate) return;
    const restore = async () => {
      let raw: string | null = null;
      try { raw = readStored(sessionStorage, HANDOFF_KEY); } catch { /* private mode */ }
      const handoff = readHandoff(raw);
      if (!handoff) {
        // Nothing to restore (another tab, or it expired): a query prefill still stands, else start blank.
        if (!prefill) setStart("blank");
        return;
      }
      setRecreate(handoff);
      setReq(requestFromHandoff(handoff, defaults));
    };
    restore();
  }, [fromRecreate, prefill, defaults]);
  const [winners, setWinners] = useState<WinnersHandoff | null>(null);
  // Our ads → "More like our winners": also in sessionStorage, read after mount.
  useEffect(() => {
    if (!fromWinners) return;
    const restore = async () => {
      let raw: string | null = null;
      try { raw = readStored(sessionStorage, WINNERS_KEY); } catch { /* private mode */ }
      const handoff = readWinners(raw);
      if (!handoff) { if (!prefill) setStart("blank"); return; }
      setWinners(handoff);
      setReq(requestFromWinners(handoff, defaults));
    };
    restore();
  }, [fromWinners, prefill, defaults]);
  const [redditText, setRedditText] = useState("");
  const [tweetText, setTweetText] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<BatchRequest>) => setReq((r) => ({ ...r, ...patch }));
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const { workspace } = overview;

  const full: BatchRequest = useMemo(() => ({ ...req, reddit: parsePosts(redditText, true), tweets: parsePosts(tweetText, false) }), [req, redditText, tweetText]);
  const plan = useMemo(() => planBatch(full, {
    appName: workspace.appName, screenshotUrls: Array.from({ length: workspace.screenshots }, () => "screenshot"), appStoreUrl: workspace.appStoreUrl ?? undefined,
    profile: workspace.profile ?? null, system: workspace.brandSystem ?? null,
  }), [full, workspace.appName, workspace.screenshots, workspace.appStoreUrl, workspace.profile, workspace.brandSystem]);
  // The same awareness level, format and hook as a recent batch: Meta would treat them as one ad.
  const duplicate = useMemo(() => nearDuplicate(full, overview.batches), [full, overview.batches]);
  const has = (k: CreativeKind) => req.kinds.includes(k);
  const apiOn = Boolean(overview.backend?.higgsfieldApi);
  const posts = has("reddit") || has("tweet");
  const aiKinds = has("ugc_video") || has("ai_video") || has("image");
  // Reference images: the product's own images, plus any picked in Recreate that aren't in the list (keyed by url).
  const picks = req.productReferences ?? [];
  const tiles: ImageTile[] = useMemo(() => {
    const own = (workspace.assets ?? []).filter((a) => !a.hidden).map((a) => ({ key: a.url, url: a.url, label: a.label ?? ASSET_KIND_LABEL[a.kind], kindLabel: ASSET_KIND_LABEL[a.kind] }));
    const extra = (req.productReferences ?? []).filter((r) => !own.some((t) => t.key === r.url)).map((r) => ({ key: r.url, url: r.url, label: r.label || kindLabel(r.kind), kindLabel: kindLabel(r.kind) }));
    return [...extra, ...own];
  }, [workspace.assets, req.productReferences]);
  const pickRefs = (keys: string[]) => {
    const refs: ProductReference[] = keys.map((k) => tiles.find((t) => t.key === k)).filter((t): t is ImageTile => Boolean(t))
      .map((t) => ({ url: t.url, label: t.label, kind: (workspace.assets ?? []).find((a) => a.url === t.url)?.kind ?? picks.find((r) => r.url === t.url)?.kind ?? "other" }));
    set({ productReferences: refs.slice(0, PRODUCT_REFERENCES) });
  };
  // People among the picks who aren't cleared for ads (consent not confirmed, or maybe a minor): said
  // before Create; QA asks a person to check each creative that uses them.
  const peopleNote = useMemo(() => peopleWarning((workspace.assets ?? []).filter((a) => (req.productReferences ?? []).some((r) => r.url === a.url))), [workspace.assets, req.productReferences]);
  // From Recreate the brief already describes the images picked there (OUR IMAGES); changing them here doesn't rewrite it.
  const recreatePicks = (recreate?.productReferences ?? []).map((r) => r.url).join("\n");
  const picksChanged = Boolean(req.referencesInBrief) && picks.map((r) => r.url).join("\n") !== recreatePicks;

  /** Switching start: leaving Research drops everything it filled in; leaving a format unlinks its card. */
  const changeStart = (next: Start) => {
    if (next === start) return;
    if (start === "research") {
      setRecreate(null);
      setWinners(null);
      setReq((r) => ({ ...defaults, variants: r.variants }));
    } else if (start === "format") set({ formatCardId: null });
    setStart(next);
  };
  const pickFormat = (pick: FormatPick | null) => setReq((r) => (pick ? { ...fromFormat(pick, r.variants), logo: r.logo } : { ...r, formatCardId: null }));
  const setKinds = (kinds: CreativeKind[]) => set({ kinds, ...(kinds.includes("image") ? {} : { format: "single" as const }) });

  async function create() {
    if (plan.errors.length) return notice(plan.errors[0], "Not ready yet");
    const viaOpenAi = Boolean(plan.usd);
    const rows: [string, React.ReactNode][] = KINDS.filter((k) => plan.byKind[k]).map((k) => [KIND_LABEL[k], `${plan.byKind[k]!.jobs} × · ${[plan.byKind[k]!.credits || !plan.byKind[k]!.usd ? `${fmtCredits(plan.byKind[k]!.credits)} credits` : "", plan.byKind[k]!.usd ? `≈${fmtUsd(plan.byKind[k]!.usd!)} at OpenAI` : ""].filter(Boolean).join(" + ")}`]);
    if (has("image") && req.image.model === "gpt_image_2_5") rows.push(["Image model", `GPT Image 2.5 · via ${viaOpenAi ? "OpenAI" : "Higgsfield"}`]);
    // Posts alone are drawn from templates: nothing is generated, so there is no service to price.
    const free = !aiKinds && !plan.credits && !plan.usd;
    if (free) rows.push(["Cost", <span key="f" className="text-base text-ink">Free</span>]);
    else if (plan.credits || !viaOpenAi) rows.push(["Estimated Higgsfield cost", <span key="c" className="text-base text-ink">{fmtCredits(plan.credits)} credits</span>]);
    if (viaOpenAi) rows.push(["Estimated OpenAI cost", <span key="u" className="text-base text-ink">≈ {fmtUsd(plan.usd!)}</span>]);
    const checked = aiLock ? "They can't be checked or approved until the AI is connected (Settings > API keys)." : "Every creative is checked before you can approve it.";
    const ok = await ask({
      title: `Make ${plan.jobs.length} creative${plan.jobs.length === 1 ? "" : "s"}?`,
      body: <Facts rows={rows} note={<>
        {peopleNote && <span className="block text-caution-ink">{peopleNote}</span>}
        {plan.warnings.map((w) => <span key={w} className="block">{w}</span>)}
        {free
          ? <span className="block">Posts are drawn now from templates, for free. {checked}</span>
          : <span className="block">Prices from Higgsfield&apos;s cost check on {PRICES_CHECKED}. Each job&apos;s live price is checked again before it runs, and one that costs much more is refused. UGC videos are made by the desktop runner; AI videos by Higgsfield; {viaOpenAi ? <>images by OpenAI&apos;s Images API, billed by OpenAI in dollars (estimated from its published prices, checked {OPENAI_IMAGE_PRICING.checked})</> : "images by Higgsfield"}; posts are drawn now, for free. {checked}</span>}
      </>} />,
      confirm: plan.credits || plan.usd ? `Spend ${planCostLabel(plan)}` : "Make them",
    });
    if (!ok) return;
    setBusy(true);
    const response = await fetch(`/api/studio/${productId}/batches`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request: full, confirmedCredits: plan.credits, confirmedUsd: plan.usd ?? 0 }) });
    const data = await response.json().catch(() => ({ error: "Couldn't start the batch. Try again." }));
    setBusy(false);
    if (!response.ok) return notice(data.error);
    onStarted();
  }

  const starts: { value: Start; label: string }[] = [
    ...(start === "research" ? [{ value: "research" as const, label: "From Research" }] : []),
    { value: "blank", label: "Blank brief" },
    { value: "format", label: "A format" },
    { value: "template", label: "A Playground template" },
  ];
  const summary = optionsSummary(req, workspace);

  return (
    <Card className="overflow-hidden">
      <div className={cx("grid gap-5 p-5", start !== "template" && "@4xl:grid-cols-[minmax(0,1fr)_280px]")}>
        <div className="grid min-w-0 content-start gap-5">
          <section className="grid gap-3">
            <span className="text-sm font-medium">Start from</span>
            <Segmented label="Start from" options={starts} value={start} onChange={changeStart} className="w-fit" />
            {start === "research" && recreate && <RecreateSummary recreate={recreate} appName={workspace.appName} />}
            {start === "research" && winners && <WinnersSummary winners={winners} />}
            {start === "research" && prefill && !recreate && !winners && (
              <div className="grid gap-2">
                <p className="text-sm text-muted"><Badge tone="accent">From Research</Badge> <span className="ml-1">Prefilled from a competitor&apos;s ad: its placement, the kind of creative and a brief built from its format, hook and copy. Make the brief yours before you create.</span></p>
                <PlaybookTip id="copy-why-not-assets" />
              </div>
            )}
            {start === "research" && !prefill && !recreate && !winners && <p className="text-sm text-muted"><Spinner className="size-3" /> Reading what Research sent…</p>}
            {start === "format" && <FormatStart productId={productId} initialCardId={linkedCard} onPick={pickFormat} />}
            {start === "template" && <TemplateStart productId={productId} />}
          </section>

          {start !== "template" && <>
            <section className="grid gap-4">
              <div className="grid gap-2">
                <span className="text-sm font-medium">Make</span>
                <div className="flex flex-wrap gap-2">
                  {KINDS.map((k) => <button key={k} type="button" className={chip(has(k))} aria-pressed={has(k)} disabled={Boolean(locks[k])} onClick={() => setKinds(toggle(req.kinds, k))}>{locks[k] ? <IconLock /> : null}{KIND_LABEL[k]}</button>)}
                </div>
                {lockedKinds.length > 0 && <div className="flex flex-wrap gap-1.5">{lockedKinds.map((k) => <span key={k} className="contents">{locks[k]}</span>)}</div>}
              </div>
              <PlacementPicker value={req.placements ?? []} onChange={(placements) => set({ placements })} format={req.format ?? "single"} videoToo={has("ugc_video") || has("ai_video")} />
            </section>

            {aiKinds && (
              <Field label="Brief" hint={start === "format" ? "Written from the format at the angle you picked. Edit it freely; picking again rewrites it." : `What the AI creatives should show and say. "${workspace.appName}" is spelled out for the model.`}>
                <textarea className={cx(inputClass, "min-h-28")} value={req.brief} maxLength={LIMITS.briefChars} onChange={(e) => set({ brief: e.target.value })} placeholder="Someone explains how the app keeps a daily habit going, then shows the streak screen." />
              </Field>
            )}

            {posts && (
              <div className="grid gap-3 @3xl:grid-cols-2">
                {has("reddit") && (
                  <div className="grid gap-3">
                    <Field label="Reddit-style posts" hint={`One post per block; separate posts with a line of ---. The first paragraph is the title. Posted as ${workspace.appName}.`}>
                      <textarea className={cx(inputClass, "min-h-36 font-mono")} value={redditText} onChange={(e) => setRedditText(e.target.value)} placeholder={"How I finally kept a habit past week two\n\nI used to start over every Monday…\n---\nAnother post"} />
                    </Field>
                    <Field label="Community line"><input className={inputClass} value={req.community ?? ""} maxLength={60} onChange={(e) => set({ community: e.target.value })} placeholder="r/productivity" /></Field>
                  </div>
                )}
                {has("tweet") && (
                  <Field label="Tweet-style posts" hint={`One post per block; separate posts with a line of ---. Posted as ${workspace.appName}.`}>
                    <textarea className={cx(inputClass, "min-h-36 font-mono")} value={tweetText} onChange={(e) => setTweetText(e.target.value)} placeholder={"One habit, every day. Acme does the reminding.\n---\nAnother tweet"} />
                  </Field>
                )}
              </div>
            )}

            <AwarenessPicker value={req.awarenessLevel} onChange={(awarenessLevel) => set({ awarenessLevel })} duplicate={duplicate} />

            {aiKinds && (
              <Field label="Variants" hint={`Of each kind, for each placement${req.format === "carousel" ? " (a carousel makes this many sets)" : ""}. Posts make one per block of copy.`}>
                <select className={cx(inputClass, "max-w-28")} value={req.variants} onChange={(e) => set({ variants: Number(e.target.value) })}>
                  {Array.from({ length: LIMITS.variants }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
            )}

            <section className="border-t border-line pt-4">
              <button type="button" className="flex w-full items-baseline gap-2 text-left" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
                <span aria-hidden className={cx("inline-block text-muted transition-transform", moreOpen && "rotate-90")}>›</span>
                <span className="text-sm font-medium">More options</span>
                {!moreOpen && summary && <span className="min-w-0 truncate text-xs text-muted">{summary}</span>}
              </button>
              {moreOpen && <BatchOptions req={req} set={set} overview={overview} tiles={tiles} picks={picks.map((r) => r.url)} onPickRefs={pickRefs} picksChanged={picksChanged} />}
            </section>
          </>}
        </div>

        {start !== "template" && (
          <aside className="@4xl:border-l @4xl:border-line @4xl:pl-5">
            <p className="text-xs font-medium text-faint">Estimate</p>
            {plan.usd && !plan.credits
              ? <p className="mt-1.5 text-figure font-medium tabular-nums">≈{fmtUsd(plan.usd)}<span className="ml-1 text-sm font-normal tracking-normal text-muted">at OpenAI</span></p>
              : <p className="mt-1.5 text-figure font-medium tabular-nums">{fmtCredits(plan.credits)}<span className="ml-1 text-sm font-normal tracking-normal text-muted">credits</span></p>}
            {plan.usd && plan.credits ? <p className="mt-1 text-sm tabular-nums">+ ≈{fmtUsd(plan.usd)} <span className="text-muted">at OpenAI</span></p> : null}
            <p className="mt-1 text-xs text-muted">{plan.jobs.length} creative{plan.jobs.length === 1 ? "" : "s"}{aiKinds ? ` · prices checked ${plan.usd ? OPENAI_IMAGE_PRICING.checked : PRICES_CHECKED}` : plan.jobs.length ? " · posts are free" : ""}</p>
            <ul className="mt-4 grid gap-1.5 text-sm">
              {KINDS.filter((k) => plan.byKind[k]).map((k) => (
                <li key={k} className="flex justify-between gap-2"><span>{KIND_LABEL[k]} × {plan.byKind[k]!.jobs}</span><span className="tabular-nums text-muted">{plan.byKind[k]!.usd && !plan.byKind[k]!.credits ? `≈${fmtUsd(plan.byKind[k]!.usd!)}` : fmtCredits(plan.byKind[k]!.credits)}</span></li>
              ))}
            </ul>
            {(plan.errors.length > 0 || plan.warnings.length > 0 || peopleNote) && (
              <ul className="mt-4 grid gap-1.5 text-xs">
                {plan.errors.map((e) => <li key={e} className="text-warn">{e}</li>)}
                {peopleNote && <li className="text-caution-ink">{peopleNote}</li>}
                {plan.warnings.map((w) => <li key={w} className="text-muted">{w}</li>)}
              </ul>
            )}
            {has("image") && req.image.model === "gpt_image_2_5" && (
              <ImageProviderPicker value={req.image.provider ?? "higgsfield"} onChange={(provider) => set({ image: { ...req.image, provider } })} productId={productId}
                openaiReady={overview.backend ? overview.backend.openaiImages ?? null : null} plan={overview.backend?.openaiImagePlan} quality={req.image.quality} resolution={req.image.resolution} compact className="mt-4" />
            )}
            <Button className="mt-4 w-full" disabled={busy || plan.errors.length > 0} onClick={create}>{busy ? <><Spinner className="size-3" /> Starting…</> : plan.jobs.length ? `Create ${plan.jobs.length} creative${plan.jobs.length === 1 ? "" : "s"}` : "Create"}</Button>
            {aiLock && req.kinds.length > 0 && <FeatureLock state={aiLock} className="mt-3">Creatives can&apos;t be checked or approved until the AI is connected</FeatureLock>}
            {/* An install whose keys can't be read: the backend's own health check says what will wait. */}
            {!features.install && overview.backend && !overview.backend.runner && has("ugc_video") && <p className="mt-3 text-xs text-muted">UGC videos wait in the queue until the desktop runner is set up and running.</p>}
            {!features.install && overview.backend && !apiOn && (has("ai_video") || (has("image") && req.image.provider !== "openai" && !overview.backend.runner)) && <p className="mt-3 text-xs text-muted">{has("ai_video") ? "AI videos" : "Images"} wait in the queue until a Higgsfield key is added in Settings &gt; API keys.</p>}
          </aside>
        )}
      </div>
    </Card>
  );
}

/** What "More like our winners" sent: how many of our ads, what goes along, and the offer wording to keep. */
function WinnersSummary({ winners }: { winners: WinnersHandoff }) {
  const k = WINNER_KIND_LABEL[winners.kind];
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted"><Badge tone="accent">More like our winners</Badge> <span className="ml-1">The brief sums up what {winners.adIds.length === 1 ? `our top ${k.one}` : `our top ${winners.adIds.length} ${k.many}`}{winners.pageName ? ` on ${winners.pageName}` : ""} share. {winners.styleReferences.length ? `${winners.styleReferences.length} of their ${winners.kind === "video" ? "frames" : "images"} go along as style references.` : "None of their images could be sent, so the brief carries the structure alone."} Write a new hook: a clone of a live winner&apos;s line competes with it.</span></p>
      {winners.offers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">Their offer wording:</span>
          {winners.offers.map((o) => <Badge key={o}>{o}</Badge>)}
        </div>
      )}
    </div>
  );
}

/** What Research's Recreate sheet sent: whose ad, which references and logo go along, and what must never appear. */
function RecreateSummary({ recreate, appName }: { recreate: RecreateHandoff; appName: string }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted"><Badge tone="accent">Recreating {recreate.reference.pageName}&apos;s ad</Badge> <span className="ml-1">The brief copies its style, structure and pattern for {appName}. {recreate.styleReferences?.length ? <>{recreate.kind === "ai_video" ? `${recreate.styleReferences.length} key frame${recreate.styleReferences.length === 1 ? "" : "s"} of their video go` : "Their image goes"} to Higgsfield as the {recreate.kind === "ai_video" ? "shot and framing" : "layout and style"} reference, then {recreate.productReferences?.length ? "the images you picked and " : ""}your screenshots.</> : recreate.productReferences?.length ? <>Their media isn&apos;t used; the images you picked and your brand screenshots are the references.</> : <>Their media isn&apos;t used; only your brand screenshots are references.</>}</span></p>
      {recreate.exact && recreate.kind === "image" && <p className="text-xs text-muted">Exact: the brief edits their ad and is sent as written, with nothing of the Studio&apos;s own added.</p>}
      {recreate.logo && (
        <p className="text-xs text-muted">
          Our logo{recreate.logo.label ? ` (${recreate.logo.label})` : ""} goes to Higgsfield right after their image, labelled as ours{recreate.logo.overlay ? <>; the real file is then placed in the {positionWhere(recreate.logo.overlay)} of each finished image, inside Meta&apos;s safe area</> : ""}.
        </p>
      )}
      {recreate.mustAvoid.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">Never in the creatives (checked in their on-screen text):</span>
          {recreate.mustAvoid.map((item) => <Badge key={item} tone="warn">{item}</Badge>)}
        </div>
      )}
      <p className="text-xs text-muted">Its kind, placement, variants, lengths and references are filled in below and under More options. Picking another start clears them.</p>
      <PlaybookTip id="copy-why-not-assets" />
    </div>
  );
}
