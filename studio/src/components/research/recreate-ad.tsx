"use client";
// Research → "Recreate this ad": a sheet over the ad drawer that copies a competitor ad's style,
// structure and pattern for our app, never its brand or assets. Everything brand-specific in their ad is
// flagged and needs a decision; every input can be overridden; "Closeness" sets how much of their ad the
// prompt keeps; the AI scan (run as the sheet opens, when the AI is connected) reads the image for logos, words, numbers and faces and
// suggests copy in their style. The prompt is composed (and editable) and goes to the Studio with a
// must-avoid list for QA. The logic is in lib/recreate.ts.
// The sheet shows five decisions: what to make, closeness, the swaps (Exact) or the copy, the flags still
// open, and Send. Everything else (their ad's reading, your brand details, images, custom instructions,
// the prompt) is defaulted and folded under "More options". Flags take their suggested decision unless the
// person picks another, so they only confirm; decided ones fold into "N details handled — review".
// The scan's fit check (does our product make the same promise?) and the suggested product images are
// advice only: nothing is blocked, nothing is picked and nothing reaches the prompt until the user clicks.
// Video ads: the scan takes key frames from the saved copy here in the browser (lib/video-frames.ts) and
// the server transcribes the audio; the sheet then shows the hook, shots and transcript, the voiceover
// field starts from what they say, and AI videos can send the key frames to Higgsfield as references.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cleanStyleReferences, STYLE_REFERENCES, type ProductReference } from "@/lib/creative-plan";
import { DEFAULT_LOGO_POSITION, LOGO_POSITIONS, logoCandidates, type LogoCandidate, type LogoPosition } from "@/lib/logo-overlay";
import type { Placement } from "@/lib/meta-formats";
import { ASSET_KIND_LABEL, FIT_LABEL, PRODUCT_REFERENCES, SELLS_LABEL, suggestAssets, type AdFit, type ProductAsset } from "@/lib/product-assets";
import {
  buildHandoff, CLOSENESS, composePrompt, defaultInputs, defaultKind, defaultSwaps, detectKind, FLAG_LABEL, SWAP_LABEL, swapDecisions, FLAG_WHY, HANDOFF_KEY, inputWarnings, isResolved, keepItems, kindLabel, leaksIn,
  mergeScanFlags, PROMPT_MAX, scanAd, sourceFromAd, targetFor, theirCaptions, theirScript, unresolved, VIDEO_LENGTHS,
  type BrandForRecreate, type Closeness, type ComposeInput, type Decision, type Decisions, type Flag, type KeepId, type RecreateInputs, type RecreateKind, type RecreateSwap,
} from "@/lib/recreate";
import { MEDIA_LABEL, SHOT_LABEL, sizeLine, staleReads, type AdScan, type AdVideoScan, type CreativeMedia, type RankedAdRow, type ResearchAvatar, type ResearchBrand } from "@/lib/research";
import { featureState, type FeatureState } from "@/lib/capabilities";
import { useInstall } from "@/lib/install/use-install";
import { videoFrames } from "@/lib/video-frames";
import { IconCheck, IconChevronDown, IconX } from "../icons";
import { PlaybookTip } from "../playbook-tip";
import { uploadProductAsset } from "../product/upload-asset";
import { FitDot, guessSells } from "./fit";
import { LockedNote } from "./gates";
import { ProductImagePicker } from "./product-image-picker";
import { PlacementSketch } from "../studio/placement-picker";
import { Badge, Button, cx, Field, inputClass, Segmented, Spinner } from "../ui";
import { MODAL, MODAL_OVERLAY, PanelPortal } from "../panel-portal";
import { UI_LOCALE } from "@/lib/ui-locale";

const HEX = /^#[0-9a-f]{6}$/i;

function Section({ title, hint, children, className }: { title: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    // min-w-0 on the children: a wide row (the Closeness control) scrolls inside instead of widening the sheet.
    <section className={cx("grid min-w-0 gap-3 border-t border-line pt-4 [&>*]:min-w-0", className)}>
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Every flag nobody decided takes its suggested decision when that settles it; the rest stay open for the person. */
function preDecide(flags: Flag[], decisions: Decisions): Decisions {
  const out: Decisions = { ...decisions };
  for (const f of flags) {
    if (out[f.id]) continue;
    const d: Decision = f.suggested === "replace" && f.suggestion.trim() ? { action: "replace", with: f.suggestion } : { action: "remove" };
    if (isResolved(f, d)) out[f.id] = d;
  }
  return out;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One line under the badges: the read that runs as the sheet opens, and a small link to read it again. */
function ReadStatus({ scanning, stage, error, scannedAt, stale, posterOnly, onRead, locked }: {
  scanning: boolean; stage: string | null; error: string | null; scannedAt: string | null; stale: boolean; posterOnly: boolean; onRead: () => void; locked: FeatureState | null;
}) {
  const link = (label: string) => <button type="button" className="rounded-xs text-accent hover:underline" onClick={onRead}>{label}</button>;
  // Without the AI's key the sheet still works from the ad's own text; reading it is what's locked.
  if (locked) return <LockedNote state={locked}>{scannedAt ? "Reading it again" : "Reading their ad"} needs {locked.missingKeys.join(" and ")}</LockedNote>;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
      {scanning ? <><Spinner className="size-3.5" /> {stage ?? "Reading their ad…"}</>
        : error ? <><span className="text-warn">{error}</span> {link("Try again")}</>
          : scannedAt ? <>Read {new Date(scannedAt).toLocaleDateString(UI_LOCALE, { day: "numeric", month: "short" })}{posterOnly ? " (the poster frame only)" : ""} · {link(posterOnly ? "Read the whole video" : "Rescan")}</>
            : <>{stale ? "The last read is of an earlier version of this ad" : "Not read yet"} · {link("Read the ad")}</>}
    </p>
  );
}

/** "Their text: rewrite it in your words" under a field that starts with their wording. */
const TheirsHint = ({ same }: { same: boolean }) => (
  <span className={cx(same && "text-caution-ink")}>{same ? "Still their exact words: rewrite them in yours (the prompt asks for a rewrite until you do)." : "Prefilled with their text; yours now."}</span>
);

/** One flagged detail. `auto` names where a decision nobody made came from ("Suggested", "From the swaps"). */
function FlagRow({ flag, decision, auto, draft, onDraft, onDecide }: { flag: Flag; decision: Decision | undefined; auto?: string; draft: string; onDraft: (text: string) => void; onDecide: (d: Decision) => void }) {
  const done = isResolved(flag, decision);
  const replaceBad = decision?.action === "replace" && !done;
  const placeholder = flag.kind === "phone" ? "No phone number: remove it" : flag.kind === "url" ? "Your link, or remove it" : flag.kind === "price" ? "Your own offer, e.g. a 3-day free trial" : "Replace with…";
  return (
    <li className={cx("grid gap-2 rounded-inner border bg-raised p-3", done ? "border-line" : "border-caution/40")}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Badge tone={done ? "win" : "caution"}>{FLAG_LABEL[flag.kind]}</Badge>
        <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{flag.text}</span>
        <span className="text-xs text-muted">in {flag.where.join(", ")}</span>
        {flag.source === "ai" && <Badge tone="accent">Found by AI</Badge>}
        {decision && auto && <Badge>{auto}</Badge>}
      </div>
      <p className="text-xs text-muted">{flag.why || FLAG_WHY[flag.kind]}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={cx(inputClass, "min-w-40 flex-1")} value={draft} placeholder={placeholder} aria-label={`Replacement for ${flag.text}`}
          onChange={(e) => { onDraft(e.target.value); if (decision?.action === "replace") onDecide({ action: "replace", with: e.target.value }); }}
        />
        <Button size="sm" variant={decision?.action === "replace" ? "primary" : "secondary"} aria-pressed={decision?.action === "replace"} onClick={() => onDecide({ action: "replace", with: draft })}>Replace</Button>
        <Button size="sm" variant={decision?.action === "remove" ? "primary" : "secondary"} aria-pressed={decision?.action === "remove"} onClick={() => onDecide({ action: "remove" })}>Remove</Button>
        {flag.canKeep && <Button size="sm" variant={decision?.action === "keep" ? "primary" : "ghost"} aria-pressed={decision?.action === "keep"} onClick={() => onDecide({ action: "keep" })} title="Not theirs or not a claim: leave it">Keep</Button>}
      </div>
      {replaceBad && <p className="text-xs text-warn">Write a replacement that isn&apos;t their text, or remove it.</p>}
      {!decision && flag.suggested === "replace" && flag.suggestion && <p className="text-xs text-muted">Suggested: replace with {flag.suggestion}{flag.source === "ai" ? " (from the read)" : " (from your Brand)"}.</p>}
    </li>
  );
}

function ColorChips({ colors, onChange }: { colors: string[]; onChange: (colors: string[]) => void }) {
  const [add, setAdd] = useState("");
  const value = add.trim().startsWith("#") ? add.trim() : `#${add.trim()}`;
  const ok = HEX.test(value) && !colors.some((c) => c.toLowerCase() === value.toLowerCase());
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {colors.map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raised py-0.5 pr-1 pl-1.5 text-xs">
          <span className="size-3.5 rounded-full border border-ink/10" style={{ background: c }} />{c}
          <button type="button" onClick={() => onChange(colors.filter((x) => x !== c))} aria-label={`Remove ${c}`} className="grid size-5 place-items-center rounded-full text-faint hover:bg-hover hover:text-ink"><IconX className="size-3" /></button>
        </span>
      ))}
      <input className={cx(inputClass, "h-7 w-28! px-2.5 py-1 text-xs")} value={add} placeholder="#5BA8E0" aria-label="Add a colour" onChange={(e) => setAdd(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && ok) { e.preventDefault(); onChange([...colors, value.toUpperCase()]); setAdd(""); } }} />
      <Button size="sm" variant="ghost" disabled={!ok} onClick={() => { onChange([...colors, value.toUpperCase()]); setAdd(""); }}>Add</Button>
    </div>
  );
}

/** Style notes from the AI scan, as label/value rows. */
const STYLE_ROWS: [keyof AdScan["style"], string][] = [["layout", "Layout"], ["typography", "Typography"], ["colours", "Colours (yours replace them)"], ["text_density", "Text"], ["vibe", "Vibe"]];

/** The scan's fit check: what their ad sells, whether we can make the same promise, and a way to adapt it. Advice only. */
function FitPanel({ fit, scanned, applied, onUse }: { fit: AdFit | undefined; scanned: boolean; applied: boolean; onUse: () => void }) {
  if (!fit) {
    return <p className="text-xs text-muted">{scanned ? "Read the ad again" : "Read the ad"} to check whether it fits what you sell (advice only).</p>;
  }
  const calm = fit.level === "fits";
  return (
    <section className={cx("grid gap-1.5 rounded-inner border px-3 py-2.5 text-xs", calm ? "border-line bg-raised" : "border-caution/30 bg-caution-soft/50")} aria-label="Fit with your offer">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <FitDot level={fit.level} className="size-2" />
        <span className={cx("text-sm font-medium", !calm && "text-caution-ink")}>{FIT_LABEL[fit.level]}</span>
        <span className="text-muted">· AI advice; you decide</span>
      </p>
      <p><span className="text-muted">Their ad sells </span>{SELLS_LABEL[fit.ad_sells]}{fit.subject ? `: ${fit.subject}` : ""}.</p>
      {fit.reason && <p className="text-muted [overflow-wrap:anywhere]">{fit.reason}</p>}
      {fit.adaptation && (
        <div className="mt-0.5 flex flex-wrap items-start gap-x-3 gap-y-2">
          <p className="min-w-48 flex-1 [overflow-wrap:anywhere]"><span className="font-medium">A way to make it yours: </span>{fit.adaptation}</p>
          {applied
            ? <span className="inline-flex h-7 shrink-0 items-center gap-1 text-muted"><IconCheck className="size-3.5 text-win" />In Custom instructions</span>
            : <Button size="sm" variant="secondary" onClick={onUse} title="Adds it to Custom instructions, where you can edit or remove it">Use this adaptation</Button>}
        </div>
      )}
    </section>
  );
}

/** Which logo the creative uses (shown, so it can be checked before spending) and whether the real file is placed on it. */
function LogoPanel({ logos, chosen, onChoose, place, onPlace, position, onPosition }: {
  logos: LogoCandidate[]; chosen: LogoCandidate; onChoose: (url: string) => void;
  place: boolean; onPlace: (on: boolean) => void; position: LogoPosition; onPosition: (p: LogoPosition) => void;
}) {
  return (
    <div className="grid gap-2.5 rounded-inner border border-line bg-raised p-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-14 shrink-0 place-items-center rounded-inner border border-line bg-[repeating-conic-gradient(var(--color-hover)_0_25%,transparent_0_50%)] bg-[length:10px_10px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={chosen.url} alt={`${chosen.label}: the logo these creatives use`} loading="lazy" className="max-h-12 max-w-12 object-contain" />
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <span className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{chosen.label}</span>
          <span className="text-muted">
            {chosen.source === "asset" ? "From your Product page (Logo)" : "Your Brand's app icon"}{chosen.width && chosen.height ? ` · ${chosen.width} × ${chosen.height}` : ""}.
            {" "}Sent to Higgsfield right after their image, labelled as our logo, so it&apos;s copied rather than invented.
          </span>
          {logos.length > 1 && (
            <select className={cx(inputClass, "text-xs")} value={chosen.url} aria-label="Which logo" onChange={(e) => onChoose(e.target.value)}>
              {logos.map((l) => <option key={l.url} value={l.url}>{l.label}{l.source === "icon" ? "" : l.width && l.height ? ` (${l.width} × ${l.height})` : ""}</option>)}
            </select>
          )}
        </div>
      </div>
      <label className="flex items-start gap-2.5">
        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" checked={place} onChange={(e) => onPlace(e.target.checked)} />
        <span>
          <span className="font-medium text-ink">Place our logo on the finished image</span>{" "}
          <span className="text-muted">The exact file, added after generation, inside Meta&apos;s safe area (image models can&apos;t redraw a logo faithfully). The prompt keeps that spot clear and asks for no logo of its own.</span>
        </span>
      </label>
      {place && (
        <select className={cx(inputClass, "w-48! text-xs")} value={position} aria-label="Logo position" onChange={(e) => onPosition(e.target.value as LogoPosition)}>
          {LOGO_POSITIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      )}
    </div>
  );
}

/**
 * An exact recreation's swaps: theirs → ours, one row per element the scan found (text, wordmark,
 * product, subject…). "Keep" leaves an element as it is; an empty "ours" removes it.
 */
function SwapsEditor({ swaps, onChange, scanning, scanned, typography, fonts }: {
  swaps: RecreateSwap[]; onChange: (swaps: RecreateSwap[]) => void; scanning: boolean; scanned: boolean; typography?: string; fonts: { role: string; family: string; url?: string }[];
}) {
  const edit = (i: number, patch: Partial<RecreateSwap>) => onChange(swaps.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  const head = fonts.find((f) => f.role === "headline") ?? fonts[0];
  if (!swaps.length) {
    return (
      <p className="rounded-inner border border-line bg-raised px-3 py-2.5 text-xs text-muted">
        {scanning ? <><Spinner /> Reading their ad for what to swap…</> : scanned ? "The scan found nothing brand-specific to swap; their name still becomes yours." : "Read the ad (the link at the top) to list what changes: their name and wordmark, product, claims and every line of text."}
      </p>
    );
  }
  return (
    <div className="grid gap-2">
      <ul className="grid gap-1.5">
        {swaps.map((w, i) => (
          <li key={i} className={cx("grid gap-1.5 rounded-inner border border-line p-2.5 text-xs @xl:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_auto] @xl:items-center", w.keep ? "bg-card opacity-70" : "bg-raised")}>
            <span className="font-medium text-ink">{SWAP_LABEL[w.element] ?? "Element"}</span>
            <span className="min-w-0 text-muted [overflow-wrap:anywhere]" title={w.style || undefined}>&ldquo;{w.theirs}&rdquo;{w.style ? <span className="block text-xs text-faint">{w.style}</span> : null}</span>
            <input className={cx(inputClass, "h-7 py-1 text-xs")} value={w.keep ? w.theirs : w.ours} disabled={w.keep} aria-label={`Ours instead of ${w.theirs}`} placeholder="Empty: remove it"
              onChange={(e) => edit(i, { ours: e.target.value })} />
            <label className="flex items-center gap-1.5 text-muted">
              <input type="checkbox" className="size-3.5 accent-ink" checked={w.keep} onChange={(e) => edit(i, { keep: e.target.checked, ours: e.target.checked ? w.theirs : w.ours })} /> Keep
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        Type: {head ? <>set in your {head.family}{head.url ? "" : " (no font file: described to the model)"}, at their sizes and weights.</> : typography ? <>their type stays ({typography}). Add your fonts on the Brand page to set it in yours.</> : "their type stays. Add your fonts on the Brand page to set it in yours."}
      </p>
    </div>
  );
}

/** Up to `n` of the scan's key frames, spread over the video (the first always in). */
function pickFrames(frames: { at: number; url: string }[], n: number) {
  if (frames.length <= n) return frames;
  return Array.from({ length: n }, (_, i) => frames[Math.round((i * (frames.length - 1)) / Math.max(1, n - 1))]);
}

const sec = (x: number) => `${Math.round(x * 10) / 10}`;

/**
 * What the scan read from their video: the hook, the shots, the transcript and how it's made. Research's
 * video breakdown shows the transcript as its script first, so it hides it here.
 */
export function VideoReading({ video, transcript = "collapsed" }: { video: AdVideoScan; transcript?: "collapsed" | "hidden" }) {
  const rows: [string, string][] = [["Voiceover", video.voiceover_style], ["Captions", video.captions_style], ["Sound", video.music_sound], ["Pacing", video.pacing], ["Presenter", video.presenter], ["Beats", video.structure]];
  return (
    <div className="grid gap-2.5 text-xs">
      <p className="font-medium">Their video{video.duration_sec ? ` · ${sec(video.duration_sec)} s` : ""}{video.shots.length ? ` · ${video.shots.length} shots` : ""}</p>
      {video.frames && video.frames.length > 0 && (
        <ul className="flex gap-1.5 overflow-x-auto pb-1">
          {video.frames.map((f) => (
            <li key={f.url} className="relative shrink-0 overflow-hidden rounded-inner bg-canvas">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt={`Their video at ${sec(f.at)} s`} loading="lazy" className="h-20 w-auto object-cover" />
              <span className="absolute bottom-0.5 left-0.5 rounded-xs bg-scrim/70 px-1 text-xs text-white tabular-nums">{sec(f.at)} s</span>
            </li>
          ))}
        </ul>
      )}
      {(video.hook.what_happens || video.hook.line) && (
        <p><span className="text-muted">Hook (first {sec(video.hook.seconds)} s): </span>{video.hook.what_happens}{video.hook.line ? ` "${video.hook.line}"` : ""}</p>
      )}
      {video.shots.length > 0 && (
        <ol className="grid gap-1">
          {video.shots.map((x, i) => (
            <li key={i} className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
              <span className="tabular-nums text-muted">{sec(x.start)}–{sec(x.end)} s</span>
              <span className="[overflow-wrap:anywhere]">
                <span className="font-medium">{SHOT_LABEL[x.shot_type] ?? "shot"}</span>{x.visual ? `: ${x.visual}` : ""}
                {x.on_screen_text && <span className="block text-muted">Caption: {x.on_screen_text}</span>}
                {x.voiceover && <span className="block text-muted">Says: &ldquo;{x.voiceover}&rdquo;</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      <dl className="grid gap-1">
        {rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-20 shrink-0 text-muted">{k}</dt><dd className="min-w-0 [overflow-wrap:anywhere]">{v}</dd></div>)}
      </dl>
      {transcript === "hidden" ? null : video.transcript && video.transcript.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-muted hover:text-ink">Transcript ({video.transcript.length} line{video.transcript.length === 1 ? "" : "s"}, speech-to-text)</summary>
          <ol className="mt-1.5 grid gap-0.5">
            {video.transcript.map((l, i) => <li key={i} className="grid grid-cols-[72px_minmax(0,1fr)] gap-2"><span className="tabular-nums text-muted">{sec(l.start)}–{sec(l.end)} s</span><span>{l.text}</span></li>)}
          </ol>
        </details>
      ) : video.transcript_note ? <p className="text-muted">{video.transcript_note}</p> : null}
    </div>
  );
}

export function RecreateAd({ productId, ad, brand, avatars, placement, measured, preview, references = [], assets = [], onAssetAdded, onClose, onScanned, onMake }: {
  productId: string;
  /** Back to the simpler "Make this for <app>" sheet (a ready-made prompt, one image, or Send to Studio). */
  onMake?: () => void;
  ad: RankedAdRow;
  brand?: ResearchBrand;
  avatars: ResearchAvatar[];
  placement?: Placement;
  measured: { width?: number | null; height?: number | null; duration?: number | null };
  preview: CreativeMedia | null;
  /** Their images (stored copies when saved), for Higgsfield's reference on image ads. */
  references?: string[];
  /** Our product images (Product page), for "Your images". */
  assets?: ProductAsset[];
  /** An image uploaded here: the page keeps it, so reopening the sheet shows it. */
  onAssetAdded?: (asset: ProductAsset) => void;
  onClose: () => void;
  /** The AI scan finished: the page keeps it, so reopening the sheet shows it. */
  onScanned?: (scan: AdScan, scannedAt: string) => void;
}) {
  const router = useRouter();
  // A Product page logo counts as our icon too (the Logo choice defaults to it when the brand kit has none).
  const firstLogo = assets.find((a) => a.kind === "logo" && !a.hidden)?.url;
  const kit: BrandForRecreate = useMemo(() => ({
    appName: brand?.appName || "Your app", appStoreUrl: brand?.appStoreUrl, iconUrl: brand?.iconUrl || firstLogo, screenshots: brand?.screenshots ?? 0,
    colors: brand?.colors ?? [], tone: brand?.tone, forbiddenClaims: brand?.forbiddenClaims ?? [], profile: brand?.profile ?? null, system: brand?.system ?? null,
  }), [brand, firstLogo]);
  const { width, height, duration } = measured;
  // A scan from before the ad was edited reads the earlier version: it isn't used, and the next scan is a fresh one.
  const staleScan = staleReads(ad).scan;
  const [scan, setScan] = useState<AdScan | null>(staleScan ? null : ad.scan ?? null);
  const [scanning, setScanning] = useState(false);
  // Video ads: "Taking key frames…" while the browser reads the saved copy, then "Reading…".
  const [scanStage, setScanStage] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(staleScan ? null : ad.scanned_at ?? null);
  const src = useMemo(() => sourceFromAd(ad, { width, height, duration }, scan), [ad, width, height, duration, scan]);
  const [kind, setKindState] = useState<RecreateKind>(() => defaultKind(src));
  // The detected kind leads until the person picks one themselves.
  const [kindPicked, setKindPicked] = useState(false);
  const setKind = (k: RecreateKind) => { setKindPicked(true); setKindState(k); };
  const detected = useMemo(() => detectKind(src), [src]);
  // An image ad with its own image to follow starts at Exact: their ad, element for element, only the swaps change.
  const [chosenCloseness, setCloseness] = useState<Closeness>(() => (defaultKind(src) === "image" && cleanStyleReferences(references).length ? "exact" : "balanced"));
  const [swapsEdited, setSwapsEdited] = useState(false);
  const target = useMemo(() => targetFor(src, kind, placement?.id), [src, kind, placement?.id]);
  const flags = useMemo(() => mergeScanFlags(scanAd(src, kit), scan, kit), [src, kit, scan]);
  const [decisions, setDecisions] = useState<Decisions>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [keep, setKeep] = useState<Partial<Record<KeepId, boolean>>>({});
  const [inputs, setInputs] = useState<RecreateInputs>(() => defaultInputs(src, targetFor(src, defaultKind(src), placement?.id), kit));
  const [edited, setEdited] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const set = (patch: Partial<RecreateInputs>) => setInputs((v) => ({ ...v, ...patch }));
  // Image ads: their image goes to Higgsfield as the layout and style reference (on by default).
  const [useReference, setUseReference] = useState(true);
  // The AI product profile (Product page): our audience, promise, proof and look in the prompt.
  const [useProfile, setUseProfile] = useState(true);
  const refImages = useMemo(() => cleanStyleReferences(references).slice(0, target.format === "single" ? 1 : target.cards), [references, target.format, target.cards]);
  const unsaved = refImages.filter((u) => !u.includes("/storage/v1/object/public/ad-media/")).length;
  // "Your images": our product images, ordered with the AI's suggestions first. Nothing is picked until the user clicks.
  const [added, setAdded] = useState<ProductAsset[]>([]);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const allAssets = useMemo(() => [...added.filter((a) => !assets.some((b) => b.id === a.id)), ...assets], [added, assets]);
  // Our logo (image ads): the file, sent as a labelled reference, and placed on the finished image (on by default).
  const logos = useMemo(() => logoCandidates(allAssets, brand?.iconUrl), [allAssets, brand?.iconUrl]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const logoFile = logos.find((l) => l.url === logoUrl) ?? logos[0] ?? null;
  const [placeLogo, setPlaceLogo] = useState(true);
  const [logoPosition, setLogoPosition] = useState<LogoPosition>(DEFAULT_LOGO_POSITION);
  const logoOn = target.kind === "image" && inputs.logo === "icon" && Boolean(logoFile);
  // The logo goes right after their image(s): one fewer of theirs, so it stays inside the desktop runner's 4 images.
  const sentRefs = logoOn ? refImages.slice(0, STYLE_REFERENCES - 1) : refImages;
  // AI video: the scan's key frames of their video, as Seedance's references (on by default once scanned).
  const [useFrames, setUseFrames] = useState(true);
  const sentFrames = useMemo(() => pickFrames(scan?.video?.frames ?? [], STYLE_REFERENCES), [scan]);
  const framesOn = target.kind === "ai_video" && useFrames && sentFrames.length > 0;


  const referencing = target.kind === "image" && useReference && sentRefs.length > 0;
  // Exact needs their image as the reference; without it (or for a video) it's Very close.
  const closeness: Closeness = chosenCloseness === "exact" && !referencing ? "very_close" : chosenCloseness;
  const exact = closeness === "exact";
  // Flags a swap covers are decided by it (their brand becomes ours); every other flag takes its suggested
  // decision when that settles it, so the person only confirms. The person's own decisions always win.
  const fromSwaps = useMemo(() => (exact ? swapDecisions(flags, inputs.swaps, inputs.brandName.trim() || kit.appName, decisions) : decisions), [exact, flags, inputs.swaps, inputs.brandName, kit.appName, decisions]);
  const effective = useMemo(() => preDecide(flags, fromSwaps), [flags, fromSwaps]);
  const fit = scan?.fit;
  const showImages = target.kind !== "ugc_video";
  const suggested = useMemo(() => suggestAssets(allAssets, { fit, sells: fit ? undefined : guessSells(ad), video: target.kind !== "image" }), [allAssets, fit, ad, target.kind]);
  const picked = showImages ? pickedIds.map((id) => allAssets.find((a) => a.id === id)).filter((a): a is ProductAsset => Boolean(a)).slice(0, PRODUCT_REFERENCES) : [];
  const productRefs: ProductReference[] = picked.map((a) => ({ url: a.url, label: a.label ?? ASSET_KIND_LABEL[a.kind], kind: a.kind }));
  const ctx: ComposeInput = {
    src, target, keep, flags, decisions: effective, inputs, brand: kit, closeness, useProfile,
    styleReferences: referencing ? sentRefs.length : framesOn ? sentFrames.length : 0, frameTimes: framesOn ? sentFrames.map((f) => f.at) : undefined,
    productImages: productRefs.map((r) => ({ label: r.label, kind: r.kind })),
    logo: logoOn && logoFile ? { url: logoFile.url, label: logoFile.label, reference: true, overlay: placeLogo ? logoPosition : null } : null,
  };
  const composed = composePrompt(ctx);
  const prompt = edited ?? composed.prompt;
  const leaks = edited != null ? leaksIn(edited, flags, effective) : composed.leaks;
  const open = unresolved(flags, effective);
  const warnings = inputWarnings(src, target, inputs);
  const video = target.kind !== "image";
  const ready = open.length === 0 && leaks.length === 0 && prompt.trim().length >= 10;
  // A flag that needed a decision stays in view once decided (it doesn't jump away mid-typing); the rest
  // are "handled" and folded away. Kept up to date during render, React's pattern for derived state.
  const [attention, setAttention] = useState<string[]>([]);
  const newlyOpen = open.filter((f) => !attention.includes(f.id));
  if (newlyOpen.length) setAttention([...attention, ...newlyOpen.map((f) => f.id)]);
  const needCall = flags.filter((f) => attention.includes(f.id) || !isResolved(f, effective[f.id]));
  const handled = flags.filter((f) => !needCall.includes(f));
  // "More options": everything past the five decisions, collapsed until asked for.
  const [more, setMore] = useState(false);

  // What reads their ad needs the AI's key: without it nothing is read on its own, and the buttons say so.
  const { install, loading: installLoading } = useInstall();
  const ai = featureState("ai", install);
  const aiLocked = ai.ok ? null : ai;

  /** One AI call: reads the still (or a video's poster) and the text. Scanning again replaces the stored scan. */
  async function runScan() {
    setScanning(true);
    setScanError(null);
    // A video: key frames from the saved copy (null when the browser can't read it; the poster is read then).
    let grabbed: Awaited<ReturnType<typeof videoFrames>> = null;
    if (src.video && preview?.type === "video") {
      setScanStage("Taking key frames…");
      grabbed = await videoFrames(preview.url).catch(() => null);
    }
    setScanStage(src.video ? "Reading the video and its audio…" : null);
    const response = await fetch(`/api/research/ads/${ad.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "scan", force: Boolean(scan) || staleScan, ...(grabbed ? { frames: grabbed.frames, duration: grabbed.duration } : duration ? { duration } : {}) }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { scan?: AdScan; scannedAt?: string; error?: string } | null;
    setScanning(false);
    setScanStage(null);
    if (!response?.ok || !data?.scan) return setScanError(data?.error ?? "Couldn't reach the scan. Try again.");
    const fresh = data.scan;
    // Fields still holding their old wording follow the new reading (what they say, their captions); edited ones stay.
    const before = { script: theirScript(src), captions: theirCaptions(src) };
    const after = sourceFromAd(ad, { width, height, duration }, fresh);
    setScan(fresh);
    setScannedAt(data.scannedAt ?? new Date().toISOString());
    setInputs((v) => ({
      ...v,
      // Their on-image text goes into the field to rewrite, unless the user already wrote something there.
      ...(v.onImageText.trim() ? {} : { onImageText: fresh.on_image_text.map((t) => t.text).join("\n") }),
      ...(after.video && v.voiceover.trim() === before.script.trim() ? { voiceover: theirScript(after) } : {}),
      ...(after.video && v.captions.trim() === before.captions.trim() ? { captions: theirCaptions(after) } : {}),
      ...(after.video && fresh.video?.duration_sec && !duration ? { length: VIDEO_LENGTHS.reduce((best, s) => (Math.abs(s - fresh.video!.duration_sec!) < Math.abs(best - fresh.video!.duration_sec!) ? s : best), VIDEO_LENGTHS[0]) } : {}),
      // The swaps an exact recreation needs, from the scan (unless the person already edited them).
      ...(swapsEdited ? {} : { swaps: defaultSwaps(after, v.brandName.trim() || kit.appName) }),
    }));
    // What the video turned out to be (a presenter to camera, or animated / demo footage) sets how it's remade.
    if (after.video && !kindPicked) setKindState(defaultKind(after));
    onScanned?.(fresh, data.scannedAt ?? new Date().toISOString());
  }

  // The ad is read as soon as the sheet opens. A video (key frames + speech-to-text): that tells a
  // presenter-to-camera UGC ad from an animated or demo one and fills the shot plan and the script. An
  // image: the swaps an exact recreation needs (scans from before 5 October have none).
  const autoScanned = useRef(false);
  useEffect(() => {
    const needed = src.video ? preview?.type === "video" && scan?.image_source !== "video_frames" : !scan?.swaps;
    if (autoScanned.current || !needed || installLoading || aiLocked) return;
    autoScanned.current = true;
    void runScan();
    // Once per opening (after the install is known); runScan reads the latest state itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installLoading, aiLocked]);

  /** The fit check's adaptation goes into Custom instructions, only on click; the user can edit or remove it there. */
  const adaptation = (fit?.adaptation ?? "").trim();
  const adaptationApplied = Boolean(adaptation) && inputs.custom.includes(adaptation);
  function applyAdaptation() {
    if (!adaptation || adaptationApplied) return;
    set({ custom: `${inputs.custom.trim() ? `${inputs.custom.trimEnd()}\n` : ""}${adaptation}`.slice(0, 800) });
  }

  /** Uploads one of our images from here and picks it (the user's own action). */
  async function uploadImage(file: File) {
    const asset = await uploadProductAsset(productId, file);
    setAdded((list) => [asset, ...list]);
    setPickedIds((ids) => (ids.length < PRODUCT_REFERENCES ? [...ids, asset.id] : ids));
    onAssetAdded?.(asset);
  }

  function applySuggestion(c: AdScan["copy_suggestions"][number]) {
    set({ ...(c.headline ? { headline: c.headline } : {}), ...(c.primary_text ? { primaryText: c.primary_text } : {}), ...(c.on_image_text.length ? { onImageText: c.on_image_text.join("\n") } : {}) });
  }

  function send() {
    if (!ready || !checked) return;
    const handoff = buildHandoff(ctx, prompt, composed.mustAvoid, referencing ? sentRefs : framesOn ? sentFrames.map((f) => f.url) : [], productRefs);
    try { sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff)); } catch { /* private mode: the Studio opens without the prefill */ }
    router.push(`/app/w/${productId}/studio?from=recreate`);
  }

  const items = keepItems(src, target, flags, effective, closeness);
  const level = CLOSENESS.find((c) => c.id === closeness)!;
  const size = sizeLine({ width: src.width, height: src.height, duration: src.duration });
  const avatarValue = inputs.avatar?.id ?? "";
  const posterOnly = Boolean(src.video && scan && scan.image_source !== "video_frames");
  const flagRow = (f: Flag) => (
    <FlagRow key={f.id} flag={f} decision={effective[f.id]} auto={decisions[f.id] ? undefined : fromSwaps[f.id] ? "From the swaps" : "Suggested"}
      draft={drafts[f.id] ?? f.suggestion}
      onDraft={(text) => setDrafts((d) => ({ ...d, [f.id]: text }))}
      onDecide={(d) => setDecisions((all) => ({ ...all, [f.id]: d }))} />
  );
  const replaced = handled.filter((f) => effective[f.id]?.action === "replace").length;
  const removed = handled.filter((f) => effective[f.id]?.action === "remove").length;
  const copyIdeas = scan && scan.copy_suggestions.length > 0 && (
    <details className="group rounded-inner border border-line bg-raised">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium text-label [&::-webkit-details-marker]:hidden">
        <IconChevronDown className="size-3.5 -rotate-90 transition group-open:rotate-0" />
        {scan.copy_suggestions.length} copy idea{scan.copy_suggestions.length === 1 ? "" : "s"} in their style, for {kit.appName}
        <span className="font-normal text-muted">· from the read; check every claim</span>
      </summary>
      <div className="grid gap-2 border-t border-line p-3 @xl:grid-cols-3">
        {scan.copy_suggestions.map((c, i) => (
          <div key={i} className="grid content-between gap-2 rounded-inner border border-line bg-card p-3 text-xs">
            <div className="grid gap-1">
              {c.headline && <p className="text-sm font-medium">{c.headline}</p>}
              {c.primary_text && <p className="whitespace-pre-line text-muted">{c.primary_text}</p>}
              {c.on_image_text.length > 0 && <p><span className="text-muted">On the image: </span>{c.on_image_text.join(" / ")}</p>}
              {c.note && <p className="text-faint">{c.note}</p>}
            </div>
            <Button size="sm" variant="secondary" onClick={() => applySuggestion(c)}>Use this</Button>
          </div>
        ))}
      </div>
    </details>
  );
  const headlineField = (
    <Field label={video ? "Headline" : "Headline / on-image text"} hint={<TheirsHint same={inputs.headline.trim() !== "" && inputs.headline.trim() === src.headline.trim()} />}>
      <textarea className={cx(inputClass, "min-h-16")} value={inputs.headline} maxLength={300} onChange={(e) => set({ headline: e.target.value })} />
    </Field>
  );
  const primaryField = (
    <Field label="Primary text" hint={<TheirsHint same={inputs.primaryText.trim() !== "" && inputs.primaryText.trim() === src.body.trim()} />}>
      <textarea className={cx(inputClass, "min-h-24")} value={inputs.primaryText} maxLength={2000} onChange={(e) => set({ primaryText: e.target.value })} />
    </Field>
  );

  return (
    <PanelPortal onClose={onClose}>
    <div className={`${MODAL_OVERLAY} z-[45]`} onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <aside className={`${MODAL} max-w-3xl`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Recreate this ad">
        <div className="sticky top-0 z-10 flex min-h-11 items-center justify-between gap-3 border-b border-line bg-card px-4 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">Recreate this ad for {kit.appName}</p>
            <p className="truncate text-xs text-muted">{src.competitor ?? src.pageName}&apos;s ad: its style, structure and pattern, never its brand or assets</p>
          </div>
          <button onClick={onClose} className="grid size-7 shrink-0 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink" aria-label="Close"><IconX className="size-3.5" /></button>
        </div>

        {/* One column that can shrink: on a phone a long line wrapped in a wide track pushed the sheet's content past its edge. */}
        <div className="grid grid-cols-1 gap-4 p-4">
          {onMake && (
            <p className="text-xs text-muted">Want it quicker? <button type="button" onClick={onMake} className="rounded-xs font-medium text-accent hover:underline">Make this for {kit.appName}</button> gives a ready-made prompt, one image here, or a Studio batch.</p>
          )}
          {/* 1. Their ad, and what to make from it */}
          <section className="grid grid-cols-1 gap-4 @xl:grid-cols-[140px_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-small bg-canvas">
              {preview?.type === "video"
                ? <video src={preview.url} poster={preview.thumbnail_url ?? undefined} muted playsInline controls preload="metadata" className="max-h-56 w-full object-contain" />
                : preview || ad.thumb
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={preview?.url ?? ad.thumb ?? ""} alt="" className="max-h-56 w-full object-contain" />
                  : <div className="grid aspect-[4/5] place-items-center p-3 text-center text-xs text-muted">No preview</div>}
            </div>
            <div className="grid content-start gap-3">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="accent">{MEDIA_LABEL[src.mediaType]}{target.format !== "single" ? ` · ${target.cards} cards` : ""}</Badge>
                {src.days != null && <Badge>running {src.days} day{src.days === 1 ? "" : "s"}</Badge>}
                {src.variants > 1 && <Badge tone="highlight">{src.variants} variants</Badge>}
              </div>
              <ReadStatus scanning={scanning} stage={scanStage} error={scanError} scannedAt={scan ? scannedAt : null} stale={!scan && staleScan} posterOnly={posterOnly} onRead={runScan} locked={aiLocked} />
              <div className="grid gap-2">
                <span className="text-sm font-medium">What to make</span>
                <div className="flex items-center gap-3">
                  <span className="grid w-[72px] shrink-0 place-items-center rounded-inner bg-canvas py-2"><PlacementSketch placement={target.placement} carousel={target.format === "carousel"} /></span>
                  <div className="grid gap-0.5 text-sm">
                    <span className="font-medium">{video ? "" : `${capital(kindLabel(target))} · `}{target.placement.label} ({target.placement.aspect})</span>
                    <span className="text-xs tabular-nums text-muted">{size ? `Theirs: ${size}` : "Size not measured"} · nearest Meta placement</span>
                  </div>
                </div>
                {video && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Segmented label="Make it as" value={kind} onChange={setKind} options={[{ value: "ugc_video", label: "AI UGC video" }, { value: "ai_video", label: "AI video" }]} />
                      <select className={cx(inputClass, "h-7 w-auto! py-1 text-xs")} value={inputs.length} aria-label="Length" onChange={(e) => set({ length: Number(e.target.value) })}>
                        {VIDEO_LENGTHS.map((s) => <option key={s} value={s}>{s} seconds</option>)}
                      </select>
                    </div>
                    <p className="text-xs text-muted">
                      {scanning && src.video ? "Reading their video to tell a presenter-to-camera ad from an animated or demo one… " : kindPicked ? "" : <span className="text-ink">{detected.reason} </span>}
                      {kind === "ugc_video" ? "A presenter talking to camera, made with Marketing Studio on the desktop runner." : "A clip made with Seedance 2.5 (on the Higgsfield API, or the desktop runner when the API isn't set up); no presenter avatar. It can follow their key frames."}
                      {(src.mediaType === "carousel" || src.mediaType === "dco") && ` Their ad is ${src.mediaType === "dco" ? "a dynamic ad" : "a carousel"} of ${src.cardCount} videos: you get one video (the Studio's variants give you more versions).`}
                    </p>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* 2. How close to their ad */}
          <Section title="How close to their ad" hint={`${level.label}: ${level.summary}. Your custom instructions always win.`}>
            <Segmented label="Closeness to their ad" value={closeness} onChange={setCloseness} options={CLOSENESS.filter((c) => c.id !== "exact" || (target.kind === "image" && refImages.length > 0)).map((c) => ({ value: c.id, label: c.label }))} />
            {chosenCloseness === "exact" && !exact && target.kind === "image" && (
              <p className="text-xs text-caution-ink">Exact edits their image, so it needs their image as the reference (More options → Their ad). Without it this is Very close.</p>
            )}
          </Section>

          {/* 3. What changes (Exact), or the copy (every other level) */}
          {exact ? (
            <Section title="What changes" hint="Their ad, element for element. Only these swaps change; nothing from your profile or brand look is added. Edit any line.">
              <SwapsEditor swaps={inputs.swaps} scanning={scanning} scanned={Boolean(scan?.swaps)} typography={src.typography} fonts={kit.system?.fonts ?? []}
                onChange={(swaps) => { setSwapsEdited(true); set({ swaps }); }} />
              <p className="text-xs text-muted">
                {logoOn && logoFile ? `Logo: ${logoFile.label}${placeLogo ? ", placed on the finished image" : ", as a reference"}` : "No logo of ours"}
                {" · "}{inputs.recolour ? "your colours replace theirs" : "their colours stay"}
                {" · "}<button type="button" className="text-accent hover:underline" onClick={() => setMore(true)}>change in More options</button>
              </p>
            </Section>
          ) : video ? (
            <Section title="Script" hint="What your version says, one beat per line.">
              <Field label="Voiceover script" hint={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={cx(inputs.voiceover.trim() === theirScript(src).trim() && inputs.voiceover.trim() !== "" && "text-caution-ink")}>
                    {inputs.voiceover.trim() === theirScript(src).trim() && inputs.voiceover.trim() !== ""
                      ? `Still their ${src.videoScan?.transcript?.length ? "spoken words (transcript)" : "beats"}: rewrite each line in yours (the prompt asks for a rewrite until you do).`
                      : "One beat per line."}
                  </span>
                  {scan?.video?.our_script && inputs.voiceover.trim() !== scan.video.our_script.trim() && (
                    <button type="button" className="text-accent hover:underline" onClick={() => set({ voiceover: scan.video!.our_script })}>Use the AI&apos;s script for {kit.appName} (check every claim)</button>
                  )}
                </span>
              }>
                <textarea className={cx(inputClass, "min-h-28")} value={inputs.voiceover} maxLength={2000} onChange={(e) => set({ voiceover: e.target.value })} />
              </Field>
            </Section>
          ) : (
            <Section title="Your copy" hint="Prefilled with their words: rewrite them in yours.">
              {headlineField}
              {primaryField}
              <Field label="On-image text" hint={src.onImageText?.length ? <TheirsHint same={inputs.onImageText.trim() === src.onImageText.join("\n").trim()} /> : "One line each. Read the ad to fill in the words on their image."}>
                <textarea className={cx(inputClass, "min-h-16")} value={inputs.onImageText} maxLength={800} onChange={(e) => set({ onImageText: e.target.value })} placeholder="ONE HABIT A DAY" />
              </Field>
              {copyIdeas}
            </Section>
          )}

          {/* 4. Their brand details: only the ones still open are shown; the rest are handled and folded away */}
          <Section
            title={open.length ? `Needs your call · ${open.length}` : "Their brand details"}
            hint={open.length
              ? "Found in their ad, with no safe default. Replace each with yours or remove it."
              : flags.length
                ? "Each one is handled with its suggested choice (yours win). Check them before sending."
                : "Nothing brand-specific found in the text. Check the image yourself: logos, words on it, faces."}
          >
            {needCall.length > 0 && <ul className="grid gap-2">{needCall.map(flagRow)}</ul>}
            {handled.length > 0 && (
              <details className="group rounded-inner border border-line bg-raised">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5 px-3 py-2 text-xs font-medium text-label [&::-webkit-details-marker]:hidden">
                  <IconChevronDown className="size-3.5 -rotate-90 transition group-open:rotate-0" />
                  <IconCheck className="size-3.5 text-win" />
                  {handled.length} detail{handled.length === 1 ? "" : "s"} handled — review
                  <span className="font-normal text-muted">· {[replaced && `${replaced} replaced`, removed && `${removed} removed`, handled.length - replaced - removed && `${handled.length - replaced - removed} kept`].filter(Boolean).join(", ")}</span>
                </summary>
                <ul className="grid gap-2 border-t border-line p-3">{handled.map(flagRow)}</ul>
              </details>
            )}
            {leaks.length > 0 && <p className="text-xs text-warn">Still in the prompt outside &ldquo;NEVER INCLUDE&rdquo;: {leaks.map((l) => `"${l}"`).join(", ")}. Change or remove it before sending{edited != null ? " (you edited the prompt: More options → Prompt)" : ""}.</p>}
          </Section>

          {/* Everything else: defaulted, and one click away */}
          <details open={more} onToggle={(e) => setMore(e.currentTarget.open)} className="group/more rounded-inner border border-line">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2 text-sm font-medium"><IconChevronDown className="size-3.5 -rotate-90 transition group-open/more:rotate-0" />More options</span>
              <span className="min-w-0 truncate text-xs text-muted">Their ad, {exact ? "your name and logo" : "your brand"}, images, custom instructions, the prompt</span>
            </summary>
            <div className="grid grid-cols-1 gap-4 px-3 pb-3 [&>section:first-child]:border-t-0">
              <Section title="Their ad" hint="What the read found, and how their ad guides yours.">
                {target.kind === "image" && refImages.length > 0 ? (
                  <label className="flex items-start gap-2.5 rounded-inner bg-accent-soft/60 px-3 py-2 text-xs text-ink">
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" checked={useReference} onChange={(e) => setUseReference(e.target.checked)} />
                    <span>
                      <span className="font-medium">Use their {sentRefs.length > 1 ? `${sentRefs.length} images` : "image"} as Higgsfield&apos;s reference.</span>{" "}
                      Your version follows its layout and style ({level.label.toLowerCase()}, set by Closeness) while every brand detail becomes yours; your screenshots go after it. Exact needs it.
                      {unsaved > 0 && " Not saved to storage yet: if the Ad Library link has expired, Higgsfield can't open it."}
                    </span>
                  </label>
                ) : target.kind === "ai_video" && sentFrames.length > 0 ? (
                  <label className="flex items-start gap-2.5 rounded-inner bg-accent-soft/60 px-3 py-2 text-xs text-ink">
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" checked={useFrames} onChange={(e) => setUseFrames(e.target.checked)} />
                    <span>
                      <span className="font-medium">Use {sentFrames.length} key frame{sentFrames.length === 1 ? "" : "s"} of their video as Higgsfield&apos;s reference</span>{" "}
                      (at {sentFrames.map((f) => `${sec(f.at)} s`).join(", ")}). Seedance follows their shots and framing ({level.label.toLowerCase()}, set by Closeness) while every brand detail becomes yours; their video file itself is never sent.
                    </span>
                  </label>
                ) : (
                  <p className="rounded-inner bg-accent-soft/60 px-3 py-2 text-xs text-ink">
                    {target.kind === "ugc_video"
                      ? "UGC videos (Marketing Studio) take no reference images: the prompt describes their video."
                      : video
                        ? "Once the whole video is read, its key frames can guide the AI video, and its shots and words go into the prompt. Until then only your Brand screenshots are references."
                        : "No image of theirs to use as a reference; the prompt describes it. Only your Brand screenshots are references."}
                  </p>
                )}
                <FitPanel fit={fit} scanned={Boolean(scan)} applied={adaptationApplied} onUse={applyAdaptation} />
                <div className="grid gap-2 rounded-inner border border-line bg-raised p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {aiLocked
                      ? <LockedNote state={aiLocked}>Needs {aiLocked.missingKeys.join(" and ")}</LockedNote>
                      : <Button size="sm" variant="secondary" onClick={runScan} disabled={scanning}>{scanning ? <><Spinner /> {scanStage ?? "Reading…"}</> : posterOnly ? "Read the whole video" : scan || staleScan ? "Read it again" : "Read the ad"}</Button>}
                    <p className="min-w-0 flex-1 text-xs text-muted">
                      One AI call (it sees their {src.video ? "frames and audio" : "image"}): it reads the image and the text for logos, words on the image, numbers and faces, lists what to swap, and suggests copy in their style for {kit.appName}.
                      {src.video && " For a video it takes key frames from the saved copy and transcribes what they say, then reads the hook, every shot and the pacing. A minute or two."}
                      {posterOnly && !scanning && " The last read saw only the poster frame."}
                      {scan && scannedAt && !scanning && ` Last read ${new Date(scannedAt).toLocaleString(UI_LOCALE)}.`}
                      {!scan && staleScan && !scanning && " The last read was of an earlier version of this ad (it was edited since), so it isn't used here."}
                    </p>
                  </div>
                  {scan?.video_note && <p className="text-xs text-muted">{scan.video_note}</p>}
                  {scan?.video && <VideoReading video={scan.video} />}
                  {scan && scan.on_image_text.length > 0 && (
                    <div className="grid gap-1">
                      <p className="text-xs font-medium">{scan.image_source === "video_frames" ? "Captions in their video" : "Words on their image"}{scan.image_source === "video_poster" ? " (poster frame)" : scan.image_source === "card_1" ? " (card 1)" : ""}</p>
                      <ul className="flex flex-wrap gap-1.5">{scan.on_image_text.map((t, i) => <li key={i}><Badge>{t.role}: {t.text}</Badge></li>)}</ul>
                    </div>
                  )}
                  {scan && (
                    <dl className="grid gap-1 text-xs">
                      {STYLE_ROWS.filter(([key]) => scan.style[key]).map(([key, label]) => (
                        <div key={key} className="flex gap-2"><dt className="w-36 shrink-0 text-muted">{label}</dt><dd className="min-w-0">{scan.style[key]}</dd></div>
                      ))}
                    </dl>
                  )}
                </div>
                <PlaybookTip id="copy-why-not-assets" />
              </Section>

              {!exact && (
                <Section title="Keep from their ad" hint="What makes it work. Untick anything you don't want to copy.">
                  <ul className="grid gap-2">
                    {items.map((k) => (
                      <li key={k.id}>
                        <label className={cx("flex items-start gap-2.5 text-sm", k.off && "opacity-50")}>
                          <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" disabled={k.off} checked={!k.off && keep[k.id] !== false} onChange={(e) => setKeep((v) => ({ ...v, [k.id]: e.target.checked }))} />
                          <span className="min-w-0"><span className="font-medium">{k.label}</span>{k.off && <span className="text-xs text-muted"> · not kept at {level.label}</span>}<span className="block text-xs text-muted [overflow-wrap:anywhere]">{k.detail}</span></span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {scan && closeness !== "loose" && (
                    <p className="text-xs text-muted">The read&apos;s style notes join KEEP at this closeness ({closeness === "balanced" ? "typography and amount of text" : "layout, typography, amount of text and vibe"}; never their colours).</p>
                  )}
                </Section>
              )}

              <Section title="Your version" hint={exact ? "Only what an exact copy needs: your name, your logo, and whether your colours replace theirs." : "Prefilled from your Brand. Every field overrides their ad."}>
                {exact ? (
                  <div className="grid gap-3">
                    <div className="grid gap-3 @xl:grid-cols-2">
                      <Field label="Brand name"><input className={inputClass} value={inputs.brandName} onChange={(e) => set({ brandName: e.target.value })} /></Field>
                      <Field label="Logo">
                        <select className={inputClass} value={inputs.logo} onChange={(e) => set({ logo: e.target.value as RecreateInputs["logo"] })}>
                          <option value="icon" disabled={!kit.iconUrl}>Our logo{kit.iconUrl ? "" : " (none on the Brand page)"}</option>
                          <option value="none">No logo (the wordmark swap writes our name)</option>
                        </select>
                      </Field>
                    </div>
                    {logoOn && logoFile && (
                      <LogoPanel logos={logos} chosen={logoFile} onChoose={setLogoUrl} place={placeLogo} onPlace={setPlaceLogo} position={logoPosition} onPosition={setLogoPosition} />
                    )}
                    <label className="flex items-start gap-2.5 text-sm">
                      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" checked={inputs.recolour} disabled={!kit.system?.palette.length} onChange={(e) => set({ recolour: e.target.checked })} />
                      <span>Swap their colours for ours <span className="block text-xs text-muted">{kit.system?.palette.length ? "Off: their colours stay, so the ad reads exactly like theirs. On: each of their brand colours becomes one of yours, in the same place." : "Add your colours on the Brand page first."}</span></span>
                    </label>
                  </div>
                ) : (<>
                {kit.profile ? (
                  <label className="flex items-start gap-2.5 rounded-inner border border-line bg-raised px-3 py-2 text-xs">
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" checked={useProfile} onChange={(e) => setUseProfile(e.target.checked)} />
                    <span>
                      <span className="font-medium text-ink">Use the AI product profile</span>{" "}
                      <span className="text-muted">The prompt speaks to {kit.profile.audience || "your audience"}{kit.profile.pains[0] ? ` about ${kit.profile.pains[0].charAt(0).toLowerCase()}${kit.profile.pains[0].slice(1).replace(/\.$/, "")}` : ""}, with your promise{kit.profile.proof.length ? ", your proof" : ""} and your look; its claims to avoid join Never say.</span>
                    </span>
                  </label>
                ) : (
                  <p className="text-xs text-muted">No AI product profile yet: add your website or App Store link on the <a href={`/app/w/${productId}/brand?tab=product`} className="text-accent hover:underline">Product page</a> so the prompt knows who you sell to, your promise and your proof.</p>
                )}
                <div className="grid gap-3 @xl:grid-cols-2">
                  <Field label="Brand name"><input className={inputClass} value={inputs.brandName} onChange={(e) => set({ brandName: e.target.value })} /></Field>
                  <Field label="Call to action"><input className={inputClass} value={inputs.cta} maxLength={40} onChange={(e) => set({ cta: e.target.value })} /></Field>
                  <Field label="Logo">
                    <select className={inputClass} value={inputs.logo} onChange={(e) => set({ logo: e.target.value as RecreateInputs["logo"] })}>
                      <option value="icon" disabled={!kit.iconUrl}>{video ? "Our app icon" : "Our logo"}{kit.iconUrl ? "" : " (none on the Product page or the Brand page)"}</option>
                      <option value="none">No logo</option>
                    </select>
                  </Field>
                  <Field label="Link or website shown">
                    <select className={inputClass} value={inputs.link} onChange={(e) => set({ link: e.target.value as RecreateInputs["link"] })}>
                      <option value="app_store" disabled={!kit.appStoreUrl}>Our App Store link{kit.appStoreUrl ? "" : " (none on the Brand page)"}</option>
                      <option value="none">None</option>
                    </select>
                  </Field>
                </div>
                {logoOn && logoFile && (
                  <LogoPanel logos={logos} chosen={logoFile} onChoose={setLogoUrl} place={placeLogo} onPlace={setPlaceLogo} position={logoPosition} onPosition={setLogoPosition} />
                )}
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">Brand colours</span>
                  <ColorChips colors={inputs.colors} onChange={(colors) => set({ colors })} />
                </div>
                <Field label="Vibe" hint="How your version should feel instead of theirs.">
                  <input className={inputClass} value={inputs.vibe} maxLength={200} onChange={(e) => set({ vibe: e.target.value })} placeholder="Soft green and white, instead of their vibrant yellow" />
                </Field>
                {video && <>{headlineField}{primaryField}{copyIdeas}</>}
                <Field label="Tone"><textarea className={cx(inputClass, "min-h-14")} value={inputs.tone} maxLength={600} onChange={(e) => set({ tone: e.target.value })} placeholder="Calm, precise, friendly" /></Field>
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">Never say</span>
                  {kit.forbiddenClaims?.length
                    ? <div className="flex flex-wrap gap-1.5">{kit.forbiddenClaims.map((c) => <Badge key={c} tone="warn">{c}</Badge>)}</div>
                    : <p className="text-xs text-muted">No forbidden claims yet (Brand page → Voice and claims).</p>}
                </div>

                {!video && (
                  <div className="grid gap-3 border-t border-line pt-4">
                    <div className="grid gap-3 @xl:grid-cols-2">
                      <Field label="People">
                        <select className={inputClass} value={inputs.people} onChange={(e) => set({ people: e.target.value as RecreateInputs["people"] })}>
                          <option value="none">None</option>
                          <option value="different">A different person</option>
                        </select>
                      </Field>
                      <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
                        <input type="checkbox" className="size-4 accent-ink" disabled={!kit.screenshots} checked={inputs.showProduct && Boolean(kit.screenshots)} onChange={(e) => set({ showProduct: e.target.checked })} />
                        Show the product: the Brand&apos;s {kit.screenshots} screenshot{kit.screenshots === 1 ? "" : "s"}
                      </label>
                    </div>
                    {inputs.people === "different" && (
                      <Field label="Describe them" hint="Never the same person as in their ad.">
                        <input className={inputClass} value={inputs.person} maxLength={240} onChange={(e) => set({ person: e.target.value })} placeholder="A woman in her 30s, casual, at her kitchen table" />
                      </Field>
                    )}
                    <Field label="Background and style notes">
                      <input className={inputClass} value={inputs.background} maxLength={240} onChange={(e) => set({ background: e.target.value })} placeholder="Soft gradient background, lots of white space" />
                    </Field>
                    {target.format !== "single" && (
                      <div className="grid gap-2">
                        <span className="text-sm font-medium">{target.format === "carousel" ? "Card headlines" : "Option headlines"}</span>
                        <div className="grid gap-2 @xl:grid-cols-2">
                          {inputs.cardHeadlines.slice(0, target.cards).map((h, i) => (
                            <input key={i} className={inputClass} value={h} maxLength={120} aria-label={`${target.format === "carousel" ? "Card" : "Option"} ${i + 1} headline`} placeholder={`${target.format === "carousel" ? "Card" : "Option"} ${i + 1}`}
                              onChange={(e) => set({ cardHeadlines: inputs.cardHeadlines.map((x, j) => (j === i ? e.target.value : x)) })} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {video && (
                  <div className="grid gap-3 border-t border-line pt-4">
                    <div className="grid gap-3 @xl:grid-cols-2">
                      <Field label="Presenter" hint={kind === "ugc_video" ? (avatars.length ? "An avatar, or describe one. A different person from theirs." : "The desktop runner syncs the avatars when it starts; describe one meanwhile.") : "Optional: a person in the clip, never theirs."}>
                        <select className={inputClass} value={avatarValue} disabled={kind !== "ugc_video" || !avatars.length} onChange={(e) => {
                          const a = avatars.find((x) => x.id === e.target.value);
                          set({ avatar: a ? { id: a.id, name: a.name, type: a.type } : null });
                        }}>
                          <option value="">{kind === "ugc_video" ? "Describe one instead" : "No avatar (AI video)"}</option>
                          {avatars.map((a) => <option key={a.id} value={a.id}>{a.name}{a.gender ? ` (${a.gender})` : ""}</option>)}
                        </select>
                      </Field>
                      <Field label="Describe the presenter">
                        <input className={inputClass} value={inputs.presenter} maxLength={200} onChange={(e) => set({ presenter: e.target.value })} placeholder="A man in his 20s, casual look" />
                      </Field>
                      <Field label="Setting or location"><input className={inputClass} value={inputs.setting} maxLength={200} onChange={(e) => set({ setting: e.target.value })} placeholder="A bright kitchen in the morning" /></Field>
                      <Field label="On-screen captions"><input className={inputClass} value={inputs.captions} maxLength={200} onChange={(e) => set({ captions: e.target.value })} /></Field>
                      <Field label="Music and sound"><input className={inputClass} value={inputs.music} maxLength={160} onChange={(e) => set({ music: e.target.value })} placeholder="Soft lo-fi, no trending track" /></Field>
                    </div>
                  </div>
                )}
              </>)}
              </Section>

              {showImages && (
                <Section
                  title="Your images"
                  hint={video
                    ? "Picked images go to Higgsfield as references; the scene is rebuilt around them, not pasted on."
                    : "Picked images go to Higgsfield after their ad; the scene is rebuilt around them, not pasted on."}
                >
                  <ProductImagePicker productId={productId}
                    tiles={suggested.map(({ asset, suggested: s, why }) => ({ key: asset.id, url: asset.url, label: asset.label ?? ASSET_KIND_LABEL[asset.kind], kindLabel: ASSET_KIND_LABEL[asset.kind], suggested: s, why }))}
                    picked={pickedIds} onChange={setPickedIds} onUpload={uploadImage}
                  />
                  {edited != null && picked.length > 0 && <p className="text-xs text-caution-ink">You edited the prompt, so it doesn&apos;t describe these images yet: rebuild it from the fields.</p>}
                </Section>
              )}

              <Section title="Custom instructions" hint="Your preferences. They win over matching their ad.">
                <textarea aria-label="Custom instructions" className={cx(inputClass, "min-h-20")} value={inputs.custom} maxLength={800} onChange={(e) => set({ custom: e.target.value })} placeholder="Make it feel airier than theirs; show the progress screen, not the settings." />
              </Section>

              <Section title="Prompt" hint={edited != null ? "You edited the prompt: changes to the fields don't reach it until you rebuild it." : "Written from everything above. Edit it if you like."}>
                <textarea className={cx(inputClass, "min-h-72 font-mono text-xs leading-relaxed")} value={prompt} maxLength={PROMPT_MAX} onChange={(e) => setEdited(e.target.value)} aria-label="Prompt" />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span className="tabular-nums">{prompt.length.toLocaleString(UI_LOCALE)} / {PROMPT_MAX.toLocaleString(UI_LOCALE)} characters</span>
                  {edited != null && <Button size="sm" variant="ghost" onClick={() => setEdited(null)}>Rebuild from the fields</Button>}
                </div>
                {warnings.map((w) => <p key={w} className="text-xs text-caution-ink">{w}</p>)}
              </Section>
            </div>
          </details>

          {/* 5. Check and send */}
          {edited != null && (
            <p className="text-xs text-caution-ink">
              You edited the prompt by hand, so changes above don&apos;t reach it.{" "}
              <button type="button" className="text-accent hover:underline" onClick={() => setEdited(null)}>Rebuild it from the fields</button>
            </p>
          )}
          <label className="flex items-start gap-2.5 rounded-inner border border-caution/40 bg-caution-soft px-3 py-2.5 text-caution-ink">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span className="text-sm">
              <span className="font-medium">I&apos;ve checked every replacement.</span>{" "}
              <span className="text-xs leading-relaxed">Higgsfield follows these inputs closely: anything left as theirs (their brand, colours, link, phone number, a real person&apos;s likeness, their exact wording) can end up in your ad.</span>
            </span>
          </label>

          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-card px-4 py-2.5">
            <div className="mr-auto grid min-w-0 gap-0.5 text-xs text-muted">
              {!ready && <p>{open.length ? `${open.length} flagged item${open.length === 1 ? "" : "s"} to decide` : leaks.length ? "Their text is still in the prompt" : "Write the prompt"}</p>}
              {ready && !checked && <p>Tick &ldquo;I&apos;ve checked every replacement&rdquo; to continue</p>}
              {fit?.level === "doesnt_fit" && <p className="text-caution-ink">Doesn&apos;t fit your offer: you can still make it</p>}
            </div>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={send} disabled={!ready || !checked}>Send to Studio</Button>
          </div>
        </div>
      </aside>
    </div>
    </PanelPortal>
  );
}
