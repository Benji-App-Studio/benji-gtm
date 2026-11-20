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
  buildHandoff, CLOSENESS, composePrompt, defaultInputs, defaultKind, defaultSwaps, detectKind, FLAG_LABEL, FLAG_WHERE, SWAP_LABEL, swapDecisions, FLAG_WHY, HANDOFF_KEY, inputWarnings, isResolved, keepItems, kindLabel, leaksIn,
  mergeScanFlags, PROMPT_MAX, scanAd, sourceFromAd, targetFor, theirCaptions, theirScript, unresolved, VIDEO_LENGTHS,
  type BrandForRecreate, type Closeness, type ComposeInput, type Decision, type Decisions, type Flag, type KeepId, type RecreateInputs, type RecreateKind, type RecreateSwap,
} from "@/lib/recreate";
import { MEDIA_LABEL, SHOT_LABEL, sizeLine, staleReads, type AdScan, type AdVideoScan, type CreativeMedia, type RankedAdRow, type ResearchAvatar, type ResearchBrand } from "@/lib/research";
import { featureState, type FeatureState } from "@/lib/capabilities";
import { useInstall } from "@/lib/install/use-install";
import { runnerOffered } from "../studio/features";
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
import { appSettingsHref } from "@/lib/nav-model";
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";
import { sentenceGap } from "@/lib/i18n/join";
import { rich } from "../rich";

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
  const { t, intl } = useT();
  const link = (label: string) => <button type="button" className="rounded-xs text-accent hover:underline" onClick={onRead}>{label}</button>;
  // Without the AI's key the sheet still works from the ad's own text; reading it is what's locked.
  const keys = new Intl.ListFormat(intl, { type: "conjunction" }).format(locked?.missingKeys ?? []);
  if (locked) return <LockedNote state={locked}>{scannedAt ? t("Reading it again needs {keys}", { keys }) : t("Reading their ad needs {keys}", { keys })}</LockedNote>;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
      {scanning ? <><Spinner className="size-3.5" /> {stage ?? t("Reading their ad…")}</>
        : error ? <><span className="text-warn">{error}</span> {link(t("Try again"))}</>
          : scannedAt ? <>{posterOnly ? t("Read {date} (the poster frame only)", { date: new Date(scannedAt).toLocaleDateString(intl, { day: "numeric", month: "short" }) }) : t("Read {date}", { date: new Date(scannedAt).toLocaleDateString(intl, { day: "numeric", month: "short" }) })} · {link(posterOnly ? t("Read the whole video") : t("Rescan"))}</>
            : <>{stale ? t("The last read is of an earlier version of this ad") : t("Not read yet")} · {link(t("Read the ad"))}</>}
    </p>
  );
}

/** "Their text: rewrite it in your words" under a field that starts with their wording. */
function TheirsHint({ same }: { same: boolean }) {
  const { t } = useT();
  return <span className={cx(same && "text-caution-ink")}>{same ? t("Still their exact words: rewrite them in yours (the prompt asks for a rewrite until you do).") : t("Prefilled with their text; yours now.")}</span>;
}

/** One flagged detail. `auto` names where a decision nobody made came from ("Suggested", "From the swaps"). */
function FlagRow({ flag, decision, auto, draft, onDraft, onDecide }: { flag: Flag; decision: Decision | undefined; auto?: string; draft: string; onDraft: (text: string) => void; onDecide: (d: Decision) => void }) {
  const { t, intl } = useT();
  const done = isResolved(flag, decision);
  const replaceBad = decision?.action === "replace" && !done;
  const placeholder = flag.kind === "phone" ? t("No phone number: remove it") : flag.kind === "url" ? t("Your link, or remove it") : flag.kind === "price" ? t("Your own offer, e.g. a 3-day free trial") : t("Replace with…");
  return (
    <li className={cx("grid gap-2 rounded-inner border bg-raised p-3", done ? "border-line" : "border-caution/40")}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Badge tone={done ? "win" : "caution"}>{t(FLAG_LABEL[flag.kind])}</Badge>
        <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{flag.text}</span>
        <span className="text-xs text-muted">{t("in {places}", { places: new Intl.ListFormat(intl, { style: "narrow", type: "unit" }).format(flag.where.map((w) => (/^card \d+$/.test(w) ? t("card {n}", { n: Number(w.slice(5)) }) : FLAG_WHERE.has(w) ? t(w) : w))) })}</span>
        {flag.source === "ai" && <Badge tone="accent">{t("Found by AI")}</Badge>}
        {decision && auto && <Badge>{auto}</Badge>}
      </div>
      <p className="text-xs text-muted">{flag.why || t(FLAG_WHY[flag.kind])}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={cx(inputClass, "min-w-40 flex-1")} value={draft} placeholder={placeholder} aria-label={t("Replacement for {text}", { text: flag.text })}
          onChange={(e) => { onDraft(e.target.value); if (decision?.action === "replace") onDecide({ action: "replace", with: e.target.value }); }}
        />
        <Button size="sm" variant={decision?.action === "replace" ? "primary" : "secondary"} aria-pressed={decision?.action === "replace"} onClick={() => onDecide({ action: "replace", with: draft })}>{t("Replace")}</Button>
        <Button size="sm" variant={decision?.action === "remove" ? "primary" : "secondary"} aria-pressed={decision?.action === "remove"} onClick={() => onDecide({ action: "remove" })}>{t("Remove")}</Button>
        {flag.canKeep && <Button size="sm" variant={decision?.action === "keep" ? "primary" : "ghost"} aria-pressed={decision?.action === "keep"} onClick={() => onDecide({ action: "keep" })} title={t("Not theirs or not a claim: leave it")}>{t("Keep")}</Button>}
      </div>
      {replaceBad && <p className="text-xs text-warn">{t("Write a replacement that isn't their text, or remove it.")}</p>}
      {!decision && flag.suggested === "replace" && flag.suggestion && <p className="text-xs text-muted">{flag.source === "ai" ? t("Suggested: replace with {text} (from the read).", { text: flag.suggestion }) : t("Suggested: replace with {text} (from your Brand).", { text: flag.suggestion })}</p>}
    </li>
  );
}

function ColorChips({ colors, onChange }: { colors: string[]; onChange: (colors: string[]) => void }) {
  const { t } = useT();
  const [add, setAdd] = useState("");
  const value = add.trim().startsWith("#") ? add.trim() : `#${add.trim()}`;
  const ok = HEX.test(value) && !colors.some((c) => c.toLowerCase() === value.toLowerCase());
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {colors.map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raised py-0.5 pr-1 pl-1.5 text-xs">
          <span className="size-3.5 rounded-full border border-ink/10" style={{ background: c }} />{c}
          <button type="button" onClick={() => onChange(colors.filter((x) => x !== c))} aria-label={t("Remove {name}", { name: c })} className="grid size-5 place-items-center rounded-full text-faint hover:bg-hover hover:text-ink"><IconX className="size-3" /></button>
        </span>
      ))}
      <input className={cx(inputClass, "h-7 w-28! px-2.5 py-1 text-xs")} value={add} placeholder="#5BA8E0" aria-label={t("Add a colour")} onChange={(e) => setAdd(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && ok) { e.preventDefault(); onChange([...colors, value.toUpperCase()]); setAdd(""); } }} />
      <Button size="sm" variant="ghost" disabled={!ok} onClick={() => { onChange([...colors, value.toUpperCase()]); setAdd(""); }}>{t("Add")}</Button>
    </div>
  );
}

/** Style notes from the AI scan, as label/value rows. */
const STYLE_ROWS: [keyof AdScan["style"], string][] = [["layout", m("Layout")], ["typography", m("Typography")], ["colours", m("Colours (yours replace them)")], ["text_density", m("Text")], ["vibe", m("Vibe")]];
/** The scan's on-image text roles (a closed list in lib/research.ts) in the page's language; an unknown role shows as it came. */
const TEXT_ROLE: Record<string, string> = { headline: m("Headline"), body: m("Body text"), cta: "CTA", price: m("Price"), legal: m("Fine print"), other: m("Other") };

/** The scan's fit check: what their ad sells, whether we can make the same promise, and a way to adapt it. Advice only. */
function FitPanel({ fit, scanned, applied, onUse }: { fit: AdFit | undefined; scanned: boolean; applied: boolean; onUse: () => void }) {
  const { t, locale } = useT();
  if (!fit) {
    return <p className="text-xs text-muted">{scanned ? t("Read the ad again to check whether it fits what you sell (advice only).") : t("Read the ad to check whether it fits what you sell (advice only).")}</p>;
  }
  const calm = fit.level === "fits";
  return (
    <section className={cx("grid gap-1.5 rounded-inner border px-3 py-2.5 text-xs", calm ? "border-line bg-raised" : "border-caution/30 bg-caution-soft/50")} aria-label={t("Fit with your offer")}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <FitDot level={fit.level} className="size-2" />
        <span className={cx("text-sm font-medium", !calm && "text-caution-ink")}>{t(FIT_LABEL[fit.level])}</span>
        <span className="text-muted">· {t("AI advice; you decide")}</span>
      </p>
      <p>{fit.subject ? t("Their ad sells {what}: {subject}.", { what: t(SELLS_LABEL[fit.ad_sells]), subject: fit.subject }) : t("Their ad sells {what}.", { what: t(SELLS_LABEL[fit.ad_sells]) })}</p>
      {fit.reason && <p className="text-muted [overflow-wrap:anywhere]">{fit.reason}</p>}
      {fit.adaptation && (
        <div className="mt-0.5 flex flex-wrap items-start gap-x-3 gap-y-2">
          <p className="min-w-48 flex-1 [overflow-wrap:anywhere]"><span className="font-medium">{t("A way to make it yours:")}{sentenceGap(locale)}</span>{fit.adaptation}</p>
          {applied
            ? <span className="inline-flex h-7 shrink-0 items-center gap-1 text-muted"><IconCheck className="size-3.5 text-win" />{t("In Custom instructions")}</span>
            : <Button size="sm" variant="secondary" onClick={onUse} title={t("Adds it to Custom instructions, where you can edit or remove it")}>{t("Use this adaptation")}</Button>}
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
  const { t, locale } = useT();
  return (
    <div className="grid gap-2.5 rounded-inner border border-line bg-raised p-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-14 shrink-0 place-items-center rounded-inner border border-line bg-[repeating-conic-gradient(var(--color-hover)_0_25%,transparent_0_50%)] bg-[length:10px_10px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={chosen.url} alt={t("{name}: the logo these creatives use", { name: chosen.label })} loading="lazy" className="max-h-12 max-w-12 object-contain" />
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <span className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{chosen.label}</span>
          <span className="text-muted">
            {chosen.source === "asset" ? t("From your Product page (Logo)") : t("Your Brand's app icon")}{chosen.width && chosen.height ? ` · ${chosen.width} × ${chosen.height}` : ""}.
            {sentenceGap(locale)}{t("Sent to Higgsfield right after their image, labelled as our logo, so it's copied rather than invented.")}
          </span>
          {logos.length > 1 && (
            <select className={cx(inputClass, "text-xs")} value={chosen.url} aria-label={t("Which logo")} onChange={(e) => onChoose(e.target.value)}>
              {logos.map((l) => <option key={l.url} value={l.url}>{l.label}{l.source === "icon" ? "" : l.width && l.height ? ` (${l.width} × ${l.height})` : ""}</option>)}
            </select>
          )}
        </div>
      </div>
      <label className="flex items-start gap-2.5">
        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" checked={place} onChange={(e) => onPlace(e.target.checked)} />
        <span>
          <span className="font-medium text-ink">{t("Place our logo on the finished image")}</span>{sentenceGap(locale)}
          <span className="text-muted">{t("The exact file, added after generation, inside Meta's safe area (image models can't redraw a logo faithfully). The prompt keeps that spot clear and asks for no logo of its own.")}</span>
        </span>
      </label>
      {place && (
        <select className={cx(inputClass, "w-48! text-xs")} value={position} aria-label={t("Logo position")} onChange={(e) => onPosition(e.target.value as LogoPosition)}>
          {LOGO_POSITIONS.map((p) => <option key={p.id} value={p.id}>{t(p.label)}</option>)}
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
  const { t } = useT();
  const edit = (i: number, patch: Partial<RecreateSwap>) => onChange(swaps.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  const head = fonts.find((f) => f.role === "headline") ?? fonts[0];
  if (!swaps.length) {
    return (
      <p className="rounded-inner border border-line bg-raised px-3 py-2.5 text-xs text-muted">
        {scanning ? <><Spinner /> {t("Reading their ad for what to swap…")}</> : scanned ? t("The scan found nothing brand-specific to swap; their name still becomes yours.") : t("Read the ad (the link at the top) to list what changes: their name and wordmark, product, claims and every line of text.")}
      </p>
    );
  }
  return (
    <div className="grid gap-2">
      <ul className="grid gap-1.5">
        {swaps.map((w, i) => (
          <li key={i} className={cx("grid gap-1.5 rounded-inner border border-line p-2.5 text-xs @xl:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_auto] @xl:items-center", w.keep ? "bg-card opacity-70" : "bg-raised")}>
            <span className="font-medium text-ink">{(SWAP_LABEL[w.element] ? t(SWAP_LABEL[w.element]) : t("Element"))}</span>
            <span className="min-w-0 text-muted [overflow-wrap:anywhere]" title={w.style || undefined}>&ldquo;{w.theirs}&rdquo;{w.style ? <span className="block text-xs text-faint">{w.style}</span> : null}</span>
            <input className={cx(inputClass, "h-7 py-1 text-xs")} value={w.keep ? w.theirs : w.ours} disabled={w.keep} aria-label={t("Ours instead of {text}", { text: w.theirs })} placeholder={t("Empty: remove it")}
              onChange={(e) => edit(i, { ours: e.target.value })} />
            <label className="flex items-center gap-1.5 text-muted">
              <input type="checkbox" className="size-3.5 accent-ink" checked={w.keep} onChange={(e) => edit(i, { keep: e.target.checked, ours: e.target.checked ? w.theirs : w.ours })} /> {t("Keep")}
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        {head ? (head.url ? t("Type: set in your {font}, at their sizes and weights.", { font: head.family }) : t("Type: set in your {font} (no font file: described to the model), at their sizes and weights.", { font: head.family }))
          : typography ? t("Type: their type stays ({typography}). Add your fonts on the Brand page to set it in yours.", { typography }) : t("Type: their type stays. Add your fonts on the Brand page to set it in yours.")}
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
  const { t, tn } = useT();
  const rows: [string, string][] = [[t("Voiceover"), video.voiceover_style], [t("Captions"), video.captions_style], [t("Sound"), video.music_sound], [t("Pacing"), video.pacing], [t("Presenter"), video.presenter], [t("Beats"), video.structure]];
  return (
    <div className="grid gap-2.5 text-xs">
      <p className="font-medium">{t("Their video")}{video.duration_sec ? ` · ${sec(video.duration_sec)} s` : ""}{video.shots.length ? ` · ${tn(video.shots.length, "{n} shot", "{n} shots")}` : ""}</p>
      {video.frames && video.frames.length > 0 && (
        <ul className="flex gap-1.5 overflow-x-auto pb-1">
          {video.frames.map((f) => (
            <li key={f.url} className="relative shrink-0 overflow-hidden rounded-inner bg-canvas">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt={t("Their video at {seconds} s", { seconds: sec(f.at) })} loading="lazy" className="h-20 w-auto object-cover" />
              <span className="absolute bottom-0.5 left-0.5 rounded-xs bg-scrim/70 px-1 text-xs text-white tabular-nums">{sec(f.at)} s</span>
            </li>
          ))}
        </ul>
      )}
      {(video.hook.what_happens || video.hook.line) && (
        <p><span className="text-muted">{t("Hook (first {seconds} s):", { seconds: sec(video.hook.seconds) })} </span>{video.hook.what_happens}{video.hook.line ? ` "${video.hook.line}"` : ""}</p>
      )}
      {video.shots.length > 0 && (
        <ol className="grid gap-1">
          {video.shots.map((x, i) => (
            <li key={i} className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
              <span className="tabular-nums text-muted">{sec(x.start)}–{sec(x.end)} s</span>
              <span className="[overflow-wrap:anywhere]">
                <span className="font-medium">{SHOT_LABEL[x.shot_type] ? t(SHOT_LABEL[x.shot_type]) : t("shot")}</span>{x.visual ? `: ${x.visual}` : ""}
                {x.on_screen_text && <span className="block text-muted">{t("Caption: {text}", { text: x.on_screen_text })}</span>}
                {x.voiceover && <span className="block text-muted">{t("Says: “{text}”", { text: x.voiceover })}</span>}
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
          <summary className="cursor-pointer text-muted hover:text-ink">{tn(video.transcript.length, "Transcript ({n} line, speech-to-text)", "Transcript ({n} lines, speech-to-text)")}</summary>
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
  const { t, tn, intl, locale } = useT();
  const gap = sentenceGap(locale);
  // A Product page logo counts as our icon too (the Logo choice defaults to it when the brand kit has none).
  const firstLogo = assets.find((a) => a.kind === "logo" && !a.hidden)?.url;
  const kit: BrandForRecreate = useMemo(() => ({
    appName: brand?.appName || "Your app", appStoreUrl: brand?.appStoreUrl, iconUrl: brand?.iconUrl || firstLogo, screenshots: brand?.screenshots ?? 0,
    colors: brand?.colors ?? [], tone: brand?.tone, forbiddenClaims: brand?.forbiddenClaims ?? [], profile: brand?.profile ?? null, system: brand?.system ?? null,
  }), [brand, firstLogo]);
  // What the sheet calls the app; the prompt keeps the English fallback.
  const shownApp = brand?.appName || t("Your app");
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
  const suggested = useMemo(() => suggestAssets(allAssets, { fit, sells: fit ? undefined : guessSells(ad), video: target.kind !== "image" }, t), [allAssets, fit, ad, target.kind, t]);
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
  const warnings = inputWarnings(src, target, inputs, t);
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
  const ai = featureState("ai", install, null, { t, intl });
  const aiLocked = ai.ok ? null : ai;

  /** One AI call: reads the still (or a video's poster) and the text. Scanning again replaces the stored scan. */
  async function runScan() {
    setScanning(true);
    setScanError(null);
    // A video: key frames from the saved copy (null when the browser can't read it; the poster is read then).
    let grabbed: Awaited<ReturnType<typeof videoFrames>> = null;
    if (src.video && preview?.type === "video") {
      setScanStage(t("Taking key frames…"));
      grabbed = await videoFrames(preview.url).catch(() => null);
    }
    setScanStage(src.video ? t("Reading the video and its audio…") : null);
    const response = await fetch(`/api/research/ads/${ad.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "scan", force: Boolean(scan) || staleScan, ...(grabbed ? { frames: grabbed.frames, duration: grabbed.duration } : duration ? { duration } : {}) }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { scan?: AdScan; scannedAt?: string; error?: string } | null;
    setScanning(false);
    setScanStage(null);
    if (!response?.ok || !data?.scan) return setScanError(data?.error ?? t("Couldn't reach the scan. Try again."));
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
    const asset = await uploadProductAsset(productId, file, {}, t);
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

  const items = keepItems(src, target, flags, effective, closeness, t);
  const level = CLOSENESS.find((c) => c.id === closeness)!;
  const size = sizeLine({ width: src.width, height: src.height, duration: src.duration });
  const avatarValue = inputs.avatar?.id ?? "";
  const posterOnly = Boolean(src.video && scan && scan.image_source !== "video_frames");
  const flagRow = (f: Flag) => (
    <FlagRow key={f.id} flag={f} decision={effective[f.id]} auto={decisions[f.id] ? undefined : fromSwaps[f.id] ? t("From the swaps") : t("Suggested")}
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
        {tn(scan.copy_suggestions.length, "{n} copy idea in their style, for {app}", "{n} copy ideas in their style, for {app}", { app: shownApp })}
        <span className="font-normal text-muted">· {t("from the read; check every claim")}</span>
      </summary>
      <div className="grid gap-2 border-t border-line p-3 @xl:grid-cols-3">
        {scan.copy_suggestions.map((c, i) => (
          <div key={i} className="grid content-between gap-2 rounded-inner border border-line bg-card p-3 text-xs">
            <div className="grid gap-1">
              {c.headline && <p className="text-sm font-medium">{c.headline}</p>}
              {c.primary_text && <p className="whitespace-pre-line text-muted">{c.primary_text}</p>}
              {c.on_image_text.length > 0 && <p><span className="text-muted">{t("On the image:")}{sentenceGap(locale)}</span>{c.on_image_text.join(" / ")}</p>}
              {c.note && <p className="text-faint">{c.note}</p>}
            </div>
            <Button size="sm" variant="secondary" onClick={() => applySuggestion(c)}>{t("Use this")}</Button>
          </div>
        ))}
      </div>
    </details>
  );
  const headlineField = (
    <Field label={video ? t("Headline") : t("Headline / on-image text")} hint={<TheirsHint same={inputs.headline.trim() !== "" && inputs.headline.trim() === src.headline.trim()} />}>
      <textarea className={cx(inputClass, "min-h-16")} value={inputs.headline} maxLength={300} onChange={(e) => set({ headline: e.target.value })} />
    </Field>
  );
  const primaryField = (
    <Field label={t("Primary text")} hint={<TheirsHint same={inputs.primaryText.trim() !== "" && inputs.primaryText.trim() === src.body.trim()} />}>
      <textarea className={cx(inputClass, "min-h-24")} value={inputs.primaryText} maxLength={2000} onChange={(e) => set({ primaryText: e.target.value })} />
    </Field>
  );

  return (
    <PanelPortal onClose={onClose}>
    <div className={`${MODAL_OVERLAY} z-[45]`} onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <aside className={`${MODAL} max-w-3xl`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("Recreate this ad")}>
        <div className="sticky top-0 z-10 flex min-h-11 items-center justify-between gap-3 border-b border-line bg-card px-4 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("Recreate this ad for {app}", { app: shownApp })}</p>
            <p className="truncate text-xs text-muted">{t("{name}'s ad: its style, structure and pattern, never its brand or assets", { name: src.competitor ?? src.pageName })}</p>
          </div>
          <button onClick={onClose} className="grid size-7 shrink-0 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink" aria-label={t("Close")}><IconX className="size-3.5" /></button>
        </div>

        {/* One column that can shrink: on a phone a long line wrapped in a wide track pushed the sheet's content past its edge. */}
        <div className="grid grid-cols-1 gap-4 p-4">
          {onMake && (
            <p className="text-xs text-muted">{rich(t("Want it quicker? {make} gives a ready-made prompt, one image here, or a Studio batch."), { make: <button type="button" onClick={onMake} className="rounded-xs font-medium text-accent hover:underline">{t("Make this for {app}", { app: shownApp })}</button> })}</p>
          )}
          {/* 1. Their ad, and what to make from it */}
          <section className="grid grid-cols-1 gap-4 @xl:grid-cols-[140px_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-small bg-canvas">
              {preview?.type === "video"
                ? <video src={preview.url} poster={preview.thumbnail_url ?? undefined} muted playsInline controls preload="metadata" className="max-h-56 w-full object-contain" />
                : preview || ad.thumb
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={preview?.url ?? ad.thumb ?? ""} alt="" className="max-h-56 w-full object-contain" />
                  : <div className="grid aspect-[4/5] place-items-center p-3 text-center text-xs text-muted">{t("No preview")}</div>}
            </div>
            <div className="grid content-start gap-3">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="accent">{t(MEDIA_LABEL[src.mediaType])}{target.format !== "single" ? ` · ${tn(target.cards, "{n} card", "{n} cards")}` : ""}</Badge>
                {src.days != null && <Badge>{tn(src.days, "running {n} day", "running {n} days")}</Badge>}
                {src.variants > 1 && <Badge tone="highlight">{tn(src.variants, "{n} variant", "{n} variants")}</Badge>}
              </div>
              <ReadStatus scanning={scanning} stage={scanStage} error={scanError} scannedAt={scan ? scannedAt : null} stale={!scan && staleScan} posterOnly={posterOnly} onRead={runScan} locked={aiLocked} />
              <div className="grid gap-2">
                <span className="text-sm font-medium">{t("What to make")}</span>
                <div className="flex items-center gap-3">
                  <span className="grid w-[72px] shrink-0 place-items-center rounded-inner bg-canvas py-2"><PlacementSketch placement={target.placement} carousel={target.format === "carousel"} /></span>
                  <div className="grid gap-0.5 text-sm">
                    <span className="font-medium">{video ? "" : `${capital(kindLabel(target, t))} · `}{t(target.placement.label)} ({target.placement.aspect})</span>
                    <span className="text-xs tabular-nums text-muted">{size ? t("Theirs: {size}", { size }) : t("Size not measured")} · {t("nearest Meta placement")}</span>
                  </div>
                </div>
                {video && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Segmented label={t("Make it as")} value={kind} onChange={setKind} options={[{ value: "ugc_video", label: t("AI UGC video") }, { value: "ai_video", label: t("AI video") }]} />
                      <select className={cx(inputClass, "h-7 w-auto! py-1 text-xs")} value={inputs.length} aria-label={t("Length")} onChange={(e) => set({ length: Number(e.target.value) })}>
                        {VIDEO_LENGTHS.map((s) => <option key={s} value={s}>{tn(s, "{n} second", "{n} seconds")}</option>)}
                      </select>
                    </div>
                    <p className="text-xs text-muted">
                      {scanning && src.video ? `${t("Reading their video to tell a presenter-to-camera ad from an animated or demo one…")}${gap}` : kindPicked || !detected.reason ? "" : <span className="text-ink">{t(detected.reason)}{gap}</span>}
                      {/* The desktop runner is the platform's for an account other than staff (accounts mode): it isn't offered to them. */}
                      {runnerOffered(install)
                        ? kind === "ugc_video" ? t("A presenter talking to camera, made with Marketing Studio on the desktop runner.") : t("A clip made with Seedance 2.5 (on the Higgsfield API, or the desktop runner when the API isn't set up); no presenter avatar. It can follow their key frames.")
                        : kind === "ugc_video" ? t("A presenter talking to camera, made with Marketing Studio. It isn't available on your plan yet.") : t("A clip made with Seedance 2.5 on the Higgsfield API; no presenter avatar. It can follow their key frames.")}
                      {(src.mediaType === "carousel" || src.mediaType === "dco") && `${gap}${src.mediaType === "dco"
                        ? t("Their ad is a dynamic ad of {n} videos: you get one video (the Studio's variants give you more versions).", { n: src.cardCount })
                        : t("Their ad is a carousel of {n} videos: you get one video (the Studio's variants give you more versions).", { n: src.cardCount })}`}
                    </p>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* 2. How close to their ad */}
          <Section title={t("How close to their ad")} hint={t("{level}: {summary}. Your custom instructions always win.", { level: t(level.label), summary: t(level.summary) })}>
            <Segmented label={t("Closeness to their ad")} value={closeness} onChange={setCloseness} options={CLOSENESS.filter((c) => c.id !== "exact" || (target.kind === "image" && refImages.length > 0)).map((c) => ({ value: c.id, label: t(c.label) }))} />
            {chosenCloseness === "exact" && !exact && target.kind === "image" && (
              <p className="text-xs text-caution-ink">{t("Exact edits their image, so it needs their image as the reference (More options → Their ad). Without it this is Very close.")}</p>
            )}
          </Section>

          {/* 3. What changes (Exact), or the copy (every other level) */}
          {exact ? (
            <Section title={t("What changes")} hint={t("Their ad, element for element. Only these swaps change; nothing from your profile or brand look is added. Edit any line.")}>
              <SwapsEditor swaps={inputs.swaps} scanning={scanning} scanned={Boolean(scan?.swaps)} typography={src.typography} fonts={kit.system?.fonts ?? []}
                onChange={(swaps) => { setSwapsEdited(true); set({ swaps }); }} />
              <p className="text-xs text-muted">
                {logoOn && logoFile ? (placeLogo ? t("Logo: {name}, placed on the finished image", { name: logoFile.label }) : t("Logo: {name}, as a reference", { name: logoFile.label })) : t("No logo of ours")}
                {" · "}{inputs.recolour ? t("your colours replace theirs") : t("their colours stay")}
                {" · "}<button type="button" className="text-accent hover:underline" onClick={() => setMore(true)}>{t("change in More options")}</button>
              </p>
            </Section>
          ) : video ? (
            <Section title={t("Script")} hint={t("What your version says, one beat per line.")}>
              <Field label={t("Voiceover script")} hint={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={cx(inputs.voiceover.trim() === theirScript(src).trim() && inputs.voiceover.trim() !== "" && "text-caution-ink")}>
                    {inputs.voiceover.trim() === theirScript(src).trim() && inputs.voiceover.trim() !== ""
                      ? src.videoScan?.transcript?.length
                        ? t("Still their spoken words (transcript): rewrite each line in yours (the prompt asks for a rewrite until you do).")
                        : t("Still their beats: rewrite each line in yours (the prompt asks for a rewrite until you do).")
                      : t("One beat per line.")}
                  </span>
                  {scan?.video?.our_script && inputs.voiceover.trim() !== scan.video.our_script.trim() && (
                    <button type="button" className="text-accent hover:underline" onClick={() => set({ voiceover: scan.video!.our_script })}>{t("Use the AI's script for {app} (check every claim)", { app: shownApp })}</button>
                  )}
                </span>
              }>
                <textarea className={cx(inputClass, "min-h-28")} value={inputs.voiceover} maxLength={2000} onChange={(e) => set({ voiceover: e.target.value })} />
              </Field>
            </Section>
          ) : (
            <Section title={t("Your copy")} hint={t("Prefilled with their words: rewrite them in yours.")}>
              {headlineField}
              {primaryField}
              <Field label={t("On-image text")} hint={src.onImageText?.length ? <TheirsHint same={inputs.onImageText.trim() === src.onImageText.join("\n").trim()} /> : t("One line each. Read the ad to fill in the words on their image.")}>
                <textarea className={cx(inputClass, "min-h-16")} value={inputs.onImageText} maxLength={800} onChange={(e) => set({ onImageText: e.target.value })} placeholder={t("ONE HABIT A DAY")} />
              </Field>
              {copyIdeas}
            </Section>
          )}

          {/* 4. Their brand details: only the ones still open are shown; the rest are handled and folded away */}
          <Section
            title={open.length ? t("Needs your call · {n}", { n: open.length }) : t("Their brand details")}
            hint={open.length
              ? t("Found in their ad, with no safe default. Replace each with yours or remove it.")
              : flags.length
                ? t("Each one is handled with its suggested choice (yours win). Check them before sending.")
                : t("Nothing brand-specific found in the text. Check the image yourself: logos, words on it, faces.")}
          >
            {needCall.length > 0 && <ul className="grid gap-2">{needCall.map(flagRow)}</ul>}
            {handled.length > 0 && (
              <details className="group rounded-inner border border-line bg-raised">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5 px-3 py-2 text-xs font-medium text-label [&::-webkit-details-marker]:hidden">
                  <IconChevronDown className="size-3.5 -rotate-90 transition group-open:rotate-0" />
                  <IconCheck className="size-3.5 text-win" />
                  {tn(handled.length, "{n} detail handled — review", "{n} details handled — review")}
                  <span className="font-normal text-muted">· {[replaced && t("{n} replaced", { n: replaced }), removed && t("{n} removed", { n: removed }), handled.length - replaced - removed && t("{n} kept", { n: handled.length - replaced - removed })].filter(Boolean).join(", ")}</span>
                </summary>
                <ul className="grid gap-2 border-t border-line p-3">{handled.map(flagRow)}</ul>
              </details>
            )}
            {leaks.length > 0 && <p className="text-xs text-warn">{edited != null
              ? t("Still in the prompt outside “NEVER INCLUDE”: {text}. Change or remove it before sending (you edited the prompt: More options → Prompt).", { text: leaks.map((l) => `"${l}"`).join(", ") })
              : t("Still in the prompt outside “NEVER INCLUDE”: {text}. Change or remove it before sending.", { text: leaks.map((l) => `"${l}"`).join(", ") })}</p>}
          </Section>

          {/* Everything else: defaulted, and one click away */}
          <details open={more} onToggle={(e) => setMore(e.currentTarget.open)} className="group/more rounded-inner border border-line">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2 text-sm font-medium"><IconChevronDown className="size-3.5 -rotate-90 transition group-open/more:rotate-0" />{t("More options")}</span>
              <span className="min-w-0 truncate text-xs text-muted">{exact ? t("Their ad, your name and logo, images, custom instructions, the prompt") : t("Their ad, your brand, images, custom instructions, the prompt")}</span>
            </summary>
            <div className="grid grid-cols-1 gap-4 px-3 pb-3 [&>section:first-child]:border-t-0">
              <Section title={t("Their ad")} hint={t("What the read found, and how their ad guides yours.")}>
                {target.kind === "image" && refImages.length > 0 ? (
                  <label className="flex items-start gap-2.5 rounded-inner bg-accent-soft/60 px-3 py-2 text-xs text-ink">
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" checked={useReference} onChange={(e) => setUseReference(e.target.checked)} />
                    <span>
                      <span className="font-medium">{sentRefs.length > 1 ? t("Use their {n} images as Higgsfield's reference.", { n: sentRefs.length }) : t("Use their image as Higgsfield's reference.")}</span>{gap}
                      {t("Your version follows its layout and style ({level}, set by Closeness) while every brand detail becomes yours; your screenshots go after it. Exact needs it.", { level: locale === "en" ? level.label.toLowerCase() : t(level.label) })}
                      {unsaved > 0 && `${gap}${t("Not saved to storage yet: if the Ad Library link has expired, Higgsfield can't open it.")}`}
                    </span>
                  </label>
                ) : target.kind === "ai_video" && sentFrames.length > 0 ? (
                  <label className="flex items-start gap-2.5 rounded-inner bg-accent-soft/60 px-3 py-2 text-xs text-ink">
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" checked={useFrames} onChange={(e) => setUseFrames(e.target.checked)} />
                    <span>
                      <span className="font-medium">{tn(sentFrames.length, "Use {n} key frame of their video as Higgsfield's reference (at {times}).", "Use {n} key frames of their video as Higgsfield's reference (at {times}).", { times: new Intl.ListFormat(intl, { style: "narrow", type: "unit" }).format(sentFrames.map((f) => `${sec(f.at)} s`)) })}</span>{gap}
                      {t("Seedance follows their shots and framing ({level}, set by Closeness) while every brand detail becomes yours; their video file itself is never sent.", { level: locale === "en" ? level.label.toLowerCase() : t(level.label) })}
                    </span>
                  </label>
                ) : (
                  <p className="rounded-inner bg-accent-soft/60 px-3 py-2 text-xs text-ink">
                    {target.kind === "ugc_video"
                      ? t("UGC videos (Marketing Studio) take no reference images: the prompt describes their video.")
                      : video
                        ? t("Once the whole video is read, its key frames can guide the AI video, and its shots and words go into the prompt. Until then only your Brand screenshots are references.")
                        : t("No image of theirs to use as a reference; the prompt describes it. Only your Brand screenshots are references.")}
                  </p>
                )}
                <FitPanel fit={fit} scanned={Boolean(scan)} applied={adaptationApplied} onUse={applyAdaptation} />
                <div className="grid gap-2 rounded-inner border border-line bg-raised p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {aiLocked
                      ? <LockedNote state={aiLocked}>{t("Needs {keys}", { keys: new Intl.ListFormat(intl, { type: "conjunction" }).format(aiLocked.missingKeys) })}</LockedNote>
                      : <Button size="sm" variant="secondary" onClick={runScan} disabled={scanning}>{scanning ? <><Spinner /> {scanStage ?? t("Reading…")}</> : posterOnly ? t("Read the whole video") : scan || staleScan ? t("Read it again") : t("Read the ad")}</Button>}
                    <p className="min-w-0 flex-1 text-xs text-muted">
                      {src.video
                        ? t("One AI call (it sees their frames and audio): it reads the image and the text for logos, words on the image, numbers and faces, lists what to swap, and suggests copy in their style for {app}.", { app: shownApp })
                        : t("One AI call (it sees their image): it reads the image and the text for logos, words on the image, numbers and faces, lists what to swap, and suggests copy in their style for {app}.", { app: shownApp })}
                      {src.video && ` ${t("For a video it takes key frames from the saved copy and transcribes what they say, then reads the hook, every shot and the pacing. A minute or two.")}`}
                      {posterOnly && !scanning && ` ${t("The last read saw only the poster frame.")}`}
                      {scan && scannedAt && !scanning && ` ${t("Last read {date}.", { date: new Date(scannedAt).toLocaleString(intl) })}`}
                      {!scan && staleScan && !scanning && ` ${t("The last read was of an earlier version of this ad (it was edited since), so it isn't used here.")}`}
                    </p>
                  </div>
                  {scan?.video_note && <p className="text-xs text-muted">{scan.video_note}</p>}
                  {scan?.video && <VideoReading video={scan.video} />}
                  {scan && scan.on_image_text.length > 0 && (
                    <div className="grid gap-1">
                      <p className="text-xs font-medium">{scan.image_source === "video_frames" ? t("Captions in their video") : scan.image_source === "video_poster" ? t("Words on their image (poster frame)") : scan.image_source === "card_1" ? t("Words on their image (card 1)") : t("Words on their image")}</p>
                      <ul className="flex flex-wrap gap-1.5">{scan.on_image_text.map((line, i) => <li key={i}><Badge>{TEXT_ROLE[line.role] ? t(TEXT_ROLE[line.role]) : line.role}: {line.text}</Badge></li>)}</ul>
                    </div>
                  )}
                  {scan && (
                    <dl className="grid gap-1 text-xs">
                      {STYLE_ROWS.filter(([key]) => scan.style[key]).map(([key, label]) => (
                        <div key={key} className="flex gap-2"><dt className="w-36 shrink-0 text-muted">{t(label)}</dt><dd className="min-w-0">{scan.style[key]}</dd></div>
                      ))}
                    </dl>
                  )}
                </div>
                <PlaybookTip id="copy-why-not-assets" />
              </Section>

              {!exact && (
                <Section title={t("Keep from their ad")} hint={t("What makes it work. Untick anything you don't want to copy.")}>
                  <ul className="grid gap-2">
                    {items.map((k) => (
                      <li key={k.id}>
                        <label className={cx("flex items-start gap-2.5 text-sm", k.off && "opacity-50")}>
                          <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" disabled={k.off} checked={!k.off && keep[k.id] !== false} onChange={(e) => setKeep((v) => ({ ...v, [k.id]: e.target.checked }))} />
                          <span className="min-w-0"><span className="font-medium">{k.label}</span>{k.off && <span className="text-xs text-muted"> · {t("not kept at {level}", { level: t(level.label) })}</span>}<span className="block text-xs text-muted [overflow-wrap:anywhere]">{k.detail}</span></span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {scan && closeness !== "loose" && (
                    <p className="text-xs text-muted">{closeness === "balanced" ? t("The read's style notes join KEEP at this closeness (typography and amount of text; never their colours).") : t("The read's style notes join KEEP at this closeness (layout, typography, amount of text and vibe; never their colours).")}</p>
                  )}
                </Section>
              )}

              <Section title={t("Your version")} hint={exact ? t("Only what an exact copy needs: your name, your logo, and whether your colours replace theirs.") : t("Prefilled from your Brand. Every field overrides their ad.")}>
                {exact ? (
                  <div className="grid gap-3">
                    <div className="grid gap-3 @xl:grid-cols-2">
                      <Field label={t("Brand name")}><input className={inputClass} value={inputs.brandName} onChange={(e) => set({ brandName: e.target.value })} /></Field>
                      <Field label={t("Logo")}>
                        <select className={inputClass} value={inputs.logo} onChange={(e) => set({ logo: e.target.value as RecreateInputs["logo"] })}>
                          <option value="icon" disabled={!kit.iconUrl}>{kit.iconUrl ? t("Our logo") : t("Our logo (none on the Brand page)")}</option>
                          <option value="none">{t("No logo (the wordmark swap writes our name)")}</option>
                        </select>
                      </Field>
                    </div>
                    {logoOn && logoFile && (
                      <LogoPanel logos={logos} chosen={logoFile} onChoose={setLogoUrl} place={placeLogo} onPlace={setPlaceLogo} position={logoPosition} onPosition={setLogoPosition} />
                    )}
                    <label className="flex items-start gap-2.5 text-sm">
                      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" checked={inputs.recolour} disabled={!kit.system?.palette.length} onChange={(e) => set({ recolour: e.target.checked })} />
                      <span>{t("Swap their colours for ours")} <span className="block text-xs text-muted">{kit.system?.palette.length ? t("Off: their colours stay, so the ad reads exactly like theirs. On: each of their brand colours becomes one of yours, in the same place.") : t("Add your colours on the Brand page first.")}</span></span>
                    </label>
                  </div>
                ) : (<>
                {kit.profile ? (
                  <label className="flex items-start gap-2.5 rounded-inner border border-line bg-raised px-3 py-2 text-xs">
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" checked={useProfile} onChange={(e) => setUseProfile(e.target.checked)} />
                    <span>
                      <span className="font-medium text-ink">{t("Use the AI product profile")}</span>{gap}
                      <span className="text-muted">{(() => {
                        const audience = kit.profile.audience || t("your audience");
                        const pain = kit.profile.pains[0] ? `${kit.profile.pains[0].charAt(0).toLowerCase()}${kit.profile.pains[0].slice(1).replace(/\.$/, "")}` : "";
                        const proof = kit.profile.proof.length > 0;
                        return pain
                          ? (proof ? t("The prompt speaks to {audience} about {pain}, with your promise, your proof and your look; its claims to avoid join Never say.", { audience, pain }) : t("The prompt speaks to {audience} about {pain}, with your promise and your look; its claims to avoid join Never say.", { audience, pain }))
                          : (proof ? t("The prompt speaks to {audience}, with your promise, your proof and your look; its claims to avoid join Never say.", { audience }) : t("The prompt speaks to {audience}, with your promise and your look; its claims to avoid join Never say.", { audience }));
                      })()}</span>
                    </span>
                  </label>
                ) : (
                  <p className="text-xs text-muted">{rich(t("No AI product profile yet: add your website or App Store link on the {link} so the prompt knows who you sell to, your promise and your proof."), { link: <a href={appSettingsHref(productId, "profile")} className="text-accent hover:underline">{t("Profile tab of App settings")}</a> })}</p>
                )}
                <div className="grid gap-3 @xl:grid-cols-2">
                  <Field label={t("Brand name")}><input className={inputClass} value={inputs.brandName} onChange={(e) => set({ brandName: e.target.value })} /></Field>
                  <Field label={t("Call to action")}><input className={inputClass} value={inputs.cta} maxLength={40} onChange={(e) => set({ cta: e.target.value })} /></Field>
                  <Field label={t("Logo")}>
                    <select className={inputClass} value={inputs.logo} onChange={(e) => set({ logo: e.target.value as RecreateInputs["logo"] })}>
                      <option value="icon" disabled={!kit.iconUrl}>{video ? t("Our app icon") : t("Our logo")}{kit.iconUrl ? "" : ` ${t("(none on the Product page or the Brand page)")}`}</option>
                      <option value="none">{t("No logo")}</option>
                    </select>
                  </Field>
                  <Field label={t("Link or website shown")}>
                    <select className={inputClass} value={inputs.link} onChange={(e) => set({ link: e.target.value as RecreateInputs["link"] })}>
                      <option value="app_store" disabled={!kit.appStoreUrl}>{kit.appStoreUrl ? t("Our App Store link") : t("Our App Store link (none on the Brand page)")}</option>
                      <option value="none">{t("None")}</option>
                    </select>
                  </Field>
                </div>
                {logoOn && logoFile && (
                  <LogoPanel logos={logos} chosen={logoFile} onChoose={setLogoUrl} place={placeLogo} onPlace={setPlaceLogo} position={logoPosition} onPosition={setLogoPosition} />
                )}
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("Brand colours")}</span>
                  <ColorChips colors={inputs.colors} onChange={(colors) => set({ colors })} />
                </div>
                <Field label={t("Vibe")} hint={t("How your version should feel instead of theirs.")}>
                  <input className={inputClass} value={inputs.vibe} maxLength={200} onChange={(e) => set({ vibe: e.target.value })} placeholder={t("Soft green and white, instead of their vibrant yellow")} />
                </Field>
                {video && <>{headlineField}{primaryField}{copyIdeas}</>}
                <Field label={t("Tone")}><textarea className={cx(inputClass, "min-h-14")} value={inputs.tone} maxLength={600} onChange={(e) => set({ tone: e.target.value })} placeholder={t("Calm, precise, friendly")} /></Field>
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("Never say")}</span>
                  {kit.forbiddenClaims?.length
                    ? <div className="flex flex-wrap gap-1.5">{kit.forbiddenClaims.map((c) => <Badge key={c} tone="warn">{c}</Badge>)}</div>
                    : <p className="text-xs text-muted">{t("No forbidden claims yet (Brand page → Voice and claims).")}</p>}
                </div>

                {!video && (
                  <div className="grid gap-3 border-t border-line pt-4">
                    <div className="grid gap-3 @xl:grid-cols-2">
                      <Field label={t("People")}>
                        <select className={inputClass} value={inputs.people} onChange={(e) => set({ people: e.target.value as RecreateInputs["people"] })}>
                          <option value="none">{t("None")}</option>
                          <option value="different">{t("A different person")}</option>
                        </select>
                      </Field>
                      <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
                        <input type="checkbox" className="size-4 accent-ink" disabled={!kit.screenshots} checked={inputs.showProduct && Boolean(kit.screenshots)} onChange={(e) => set({ showProduct: e.target.checked })} />
                        {tn(kit.screenshots ?? 0, "Show the product: the Brand's {n} screenshot", "Show the product: the Brand's {n} screenshots")}
                      </label>
                    </div>
                    {inputs.people === "different" && (
                      <Field label={t("Describe them")} hint={t("Never the same person as in their ad.")}>
                        <input className={inputClass} value={inputs.person} maxLength={240} onChange={(e) => set({ person: e.target.value })} placeholder={t("A woman in her 30s, casual, at her kitchen table")} />
                      </Field>
                    )}
                    <Field label={t("Background and style notes")}>
                      <input className={inputClass} value={inputs.background} maxLength={240} onChange={(e) => set({ background: e.target.value })} placeholder={t("Soft gradient background, lots of white space")} />
                    </Field>
                    {target.format !== "single" && (
                      <div className="grid gap-2">
                        <span className="text-sm font-medium">{target.format === "carousel" ? t("Card headlines") : t("Option headlines")}</span>
                        <div className="grid gap-2 @xl:grid-cols-2">
                          {inputs.cardHeadlines.slice(0, target.cards).map((h, i) => (
                            <input key={i} className={inputClass} value={h} maxLength={120} aria-label={target.format === "carousel" ? t("Card {n} headline", { n: i + 1 }) : t("Option {n} headline", { n: i + 1 })} placeholder={target.format === "carousel" ? t("Card {n}", { n: i + 1 }) : t("Option {n}", { n: i + 1 })}
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
                      <Field label={t("Presenter")} hint={kind === "ugc_video" ? (avatars.length ? t("An avatar, or describe one. A different person from theirs.") : t("The desktop runner syncs the avatars when it starts; describe one meanwhile.")) : t("Optional: a person in the clip, never theirs.")}>
                        <select className={inputClass} value={avatarValue} disabled={kind !== "ugc_video" || !avatars.length} onChange={(e) => {
                          const a = avatars.find((x) => x.id === e.target.value);
                          set({ avatar: a ? { id: a.id, name: a.name, type: a.type } : null });
                        }}>
                          <option value="">{kind === "ugc_video" ? t("Describe one instead") : t("No avatar (AI video)")}</option>
                          {avatars.map((a) => <option key={a.id} value={a.id}>{a.name}{a.gender ? ` (${a.gender})` : ""}</option>)}
                        </select>
                      </Field>
                      <Field label={t("Describe the presenter")}>
                        <input className={inputClass} value={inputs.presenter} maxLength={200} onChange={(e) => set({ presenter: e.target.value })} placeholder={t("A man in his 20s, casual look")} />
                      </Field>
                      <Field label={t("Setting or location")}><input className={inputClass} value={inputs.setting} maxLength={200} onChange={(e) => set({ setting: e.target.value })} placeholder={t("A bright kitchen in the morning")} /></Field>
                      <Field label={t("On-screen captions")}><input className={inputClass} value={inputs.captions} maxLength={200} onChange={(e) => set({ captions: e.target.value })} /></Field>
                      <Field label={t("Music and sound")}><input className={inputClass} value={inputs.music} maxLength={160} onChange={(e) => set({ music: e.target.value })} placeholder={t("Soft lo-fi, no trending track")} /></Field>
                    </div>
                  </div>
                )}
              </>)}
              </Section>

              {showImages && (
                <Section
                  title={t("Your images")}
                  hint={video
                    ? t("Picked images go to Higgsfield as references; the scene is rebuilt around them, not pasted on.")
                    : t("Picked images go to Higgsfield after their ad; the scene is rebuilt around them, not pasted on.")}
                >
                  <ProductImagePicker productId={productId}
                    tiles={suggested.map(({ asset, suggested: s, why }) => ({ key: asset.id, url: asset.url, label: asset.label ?? t(ASSET_KIND_LABEL[asset.kind]), kindLabel: t(ASSET_KIND_LABEL[asset.kind]), suggested: s, why }))}
                    picked={pickedIds} onChange={setPickedIds} onUpload={uploadImage}
                  />
                  {edited != null && picked.length > 0 && <p className="text-xs text-caution-ink">{t("You edited the prompt, so it doesn't describe these images yet: rebuild it from the fields.")}</p>}
                </Section>
              )}

              <Section title={t("Custom instructions")} hint={t("Your preferences. They win over matching their ad.")}>
                <textarea aria-label={t("Custom instructions")} className={cx(inputClass, "min-h-20")} value={inputs.custom} maxLength={800} onChange={(e) => set({ custom: e.target.value })} placeholder={t("Make it feel airier than theirs; show the progress screen, not the settings.")} />
              </Section>

              <Section title={t("Prompt")} hint={edited != null ? t("You edited the prompt: changes to the fields don't reach it until you rebuild it.") : t("Written from everything above. Edit it if you like.")}>
                <textarea className={cx(inputClass, "min-h-72 font-mono text-xs leading-relaxed")} value={prompt} maxLength={PROMPT_MAX} onChange={(e) => setEdited(e.target.value)} aria-label={t("Prompt")} />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span className="tabular-nums">{t("{used} / {max} characters", { used: prompt.length, max: PROMPT_MAX })}</span>
                  {edited != null && <Button size="sm" variant="ghost" onClick={() => setEdited(null)}>{t("Rebuild from the fields")}</Button>}
                </div>
                {warnings.map((w) => <p key={w} className="text-xs text-caution-ink">{w}</p>)}
              </Section>
            </div>
          </details>

          {/* 5. Check and send */}
          {edited != null && (
            <p className="text-xs text-caution-ink">
              {t("You edited the prompt by hand, so changes above don't reach it.")}{gap}
              <button type="button" className="text-accent hover:underline" onClick={() => setEdited(null)}>{t("Rebuild it from the fields")}</button>
            </p>
          )}
          <label className="flex items-start gap-2.5 rounded-inner border border-caution/40 bg-caution-soft px-3 py-2.5 text-caution-ink">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span className="text-sm">
              <span className="font-medium">{t("I've checked every replacement.")}</span>{gap}
              <span className="text-xs leading-relaxed">{t("Higgsfield follows these inputs closely: anything left as theirs (their brand, colours, link, phone number, a real person's likeness, their exact wording) can end up in your ad.")}</span>
            </span>
          </label>

          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-card px-4 py-2.5">
            <div className="mr-auto grid min-w-0 gap-0.5 text-xs text-muted">
              {!ready && <p>{open.length ? tn(open.length, "{n} flagged item to decide", "{n} flagged items to decide") : leaks.length ? t("Their text is still in the prompt") : t("Write the prompt")}</p>}
              {ready && !checked && <p>{t("Tick “I've checked every replacement” to continue")}</p>}
              {fit?.level === "doesnt_fit" && <p className="text-caution-ink">{t("Doesn't fit your offer: you can still make it")}</p>}
            </div>
            <Button variant="secondary" onClick={onClose}>{t("Cancel")}</Button>
            <Button onClick={send} disabled={!ready || !checked}>{t("Send to Studio")}</Button>
          </div>
        </div>
      </aside>
    </div>
    </PanelPortal>
  );
}
