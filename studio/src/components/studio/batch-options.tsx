"use client";
// The Studio form's "More options": everything with a sensible default, out of the way until wanted.
// The ad format (single or carousel), the brand and product profile, each kind's model settings (UGC
// video, AI video, image ads and composed copy) and the reference images. `optionsSummary` is the
// one line the closed disclosure shows, so what will be used is never hidden.
import { brandSystemSummary, copyBlock, lookBlock, type BrandSystem } from "@/lib/brand-system";
import { COPY_LIMITS, LAYOUTS, layoutById, layoutRoles, unplacedCopy, unplacedNote, type ComposedCopy, type ComposedProduct } from "@/lib/composed-ads";
import { useMemo, useState } from "react";
import { DEFAULT_REQUEST, SETUP_MODES, VIDEO_MODES, type BatchRequest, type CreativeKind, type ImageQuality, type ImageResolution, type VideoResolution } from "@/lib/creative-plan";
import type { StudioOverview } from "@/lib/creative-types";
import { defaultLogo, LOGO_POSITIONS, logoCandidates, type LogoCandidate, type LogoPosition, type LogoSettings } from "@/lib/logo-overlay";
import { cutoutChoices } from "@/lib/product-assets";
import { profileBrief, type ProductProfile } from "@/lib/product-insight";
import { ProductImagePicker, type ImageTile } from "../research/product-image-picker";
import { cx, Field, inputClass } from "../ui";
import { AdFormatPicker } from "./placement-picker";

const IMAGE_MODEL_LABEL: Record<BatchRequest["image"]["model"], string> = { gpt_image_2_5: "GPT Image 2.5", marketing_studio_image: "Marketing Studio Image" };

/** What the closed "More options" says will be used: the settings of the kinds picked, the brand and any picks. */
export function optionsSummary(req: BatchRequest, workspace: StudioOverview["workspace"]): string {
  const has = (k: CreativeKind) => req.kinds.includes(k);
  const ai = { ...DEFAULT_REQUEST.aiVideo!, ...req.aiVideo };
  const parts: string[] = [];
  if (req.format === "carousel") parts.push(`carousel of ${req.cards ?? 3}`);
  if (has("ugc_video")) parts.push(`UGC ${VIDEO_MODES.find((m) => m.id === req.video.mode)?.label ?? req.video.mode}, ${req.video.duration}s, ${req.video.resolution}`);
  if (has("ai_video")) parts.push(`AI video ${ai.duration}s, ${ai.resolution}`);
  if (has("image")) parts.push(`${IMAGE_MODEL_LABEL[req.image.model]}${req.image.model === "gpt_image_2_5" ? `${req.image.provider === "openai" ? " via OpenAI" : ""} ${req.image.quality}` : ""}, ${req.image.resolution}${req.image.composed ? ", copy set in your fonts" : ""}${req.image.composed?.product ? ", real product" : ""}`);
  if (has("image") && req.logo?.overlay) parts.push("real logo placed");
  if (req.productReferences?.length) parts.push(`${req.productReferences.length} reference image${req.productReferences.length === 1 ? "" : "s"}`);
  if (req.brandInBrief) parts.push("brand from the Research brief");
  else {
    if (workspace.brandSystem) parts.push(req.useBrandSystem === false ? "brand off" : "brand on");
    if (workspace.profile) parts.push(req.useProfile === false ? "profile off" : "profile on");
  }
  return parts.join(" · ");
}

export function BatchOptions({ req, set, overview, tiles, picks, onPickRefs, picksChanged }: {
  req: BatchRequest;
  set: (patch: Partial<BatchRequest>) => void;
  overview: StudioOverview;
  /** Reference images to choose from, and the urls picked. */
  tiles: ImageTile[];
  picks: string[];
  onPickRefs: (keys: string[]) => void;
  /** Recreate's brief describes other images than the ones picked now. */
  picksChanged: boolean;
}) {
  const { workspace, catalog } = overview;
  const has = (k: CreativeKind) => req.kinds.includes(k);
  const logos = useMemo(() => logoCandidates(workspace.assets ?? [], workspace.iconUrl), [workspace.assets, workspace.iconUrl]);
  const cutouts = useMemo(() => cutoutChoices(workspace.assets ?? []), [workspace.assets]);
  const setup = SETUP_MODES.includes(req.video.mode);
  const aiVideo = { ...DEFAULT_REQUEST.aiVideo!, ...req.aiVideo };

  return (
    <div className="grid gap-4 pt-2">
      {has("image") && (
        <AdFormatPicker format={req.format ?? "single"} onFormat={(format) => set({ format })} cards={req.cards ?? 3} onCards={(cards) => set({ cards })} />
      )}

      <fieldset className="grid gap-3 border-t border-line pt-4">
        <legend className="eyebrow mb-1">Brand</legend>
        {req.brandInBrief ? (
          <p className="text-xs text-muted">This Research brief already carries your brand: its look, voice, offers, words to avoid and forbidden claims. The Studio adds nothing of its own, and every one of those rules is checked.</p>
        ) : <>
          <ProfileToggle productId={workspace.id} profile={workspace.profile ?? null} on={req.useProfile !== false} onChange={(on) => set({ useProfile: on })} />
          <BrandSystemToggle productId={workspace.id} system={workspace.brandSystem ?? null} on={req.useBrandSystem !== false} onChange={(on) => set({ useBrandSystem: on })} />
        </>}
      </fieldset>

      {has("ugc_video") && (
        <fieldset className="grid gap-3 border-t border-line pt-4">
          <legend className="eyebrow mb-1">UGC video · Marketing Studio · made by the desktop runner</legend>
          <div className="grid gap-3 @xl:grid-cols-2 @3xl:grid-cols-4">
            <Field label="Mode">
              <select className={inputClass} value={req.video.mode} onChange={(e) => set({ video: { ...req.video, mode: e.target.value as BatchRequest["video"]["mode"] } })}>
                {VIDEO_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}: {m.hint}</option>)}
              </select>
            </Field>
            <Field label="Length">
              <select className={inputClass} value={req.video.duration} onChange={(e) => set({ video: { ...req.video, duration: Number(e.target.value) } })}>
                {[5, 10, 15, 20, 30].map((s) => <option key={s} value={s}>{s} seconds</option>)}
              </select>
            </Field>
            <Field label="Resolution">
              <select className={inputClass} value={req.video.resolution} onChange={(e) => set({ video: { ...req.video, resolution: e.target.value as VideoResolution } })}>
                {["480p", "720p", "1080p"].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Product from">
              <select className={inputClass} value={req.video.product} onChange={(e) => set({ video: { ...req.video, product: e.target.value as BatchRequest["video"]["product"] } })}>
                <option value="app_store" disabled={!workspace.appStoreUrl}>App Store page{workspace.appStoreUrl ? "" : " (none yet)"}</option>
                <option value="screenshots" disabled={!workspace.screenshots}>Brand screenshots ({workspace.screenshots})</option>
                <option value="none">The brief only</option>
              </select>
            </Field>
            <Field label="Presenter" hint={catalog.avatars.length ? undefined : "The desktop runner fills this list with Higgsfield's presenters when it starts."}>
              <select className={inputClass} value={req.video.avatar?.id ?? ""} onChange={(e) => {
                const a = catalog.avatars.find((x) => x.id === e.target.value);
                set({ video: { ...req.video, avatar: a ? { id: a.id, type: a.type === "custom" ? "custom" : "preset", name: a.name } : null } });
              }}>
                <option value="">Higgsfield picks one</option>
                {catalog.avatars.map((a) => <option key={a.id} value={a.id}>{a.name}{a.gender ? ` (${a.gender})` : ""}</option>)}
              </select>
            </Field>
            <Field label="Hook" hint={setup ? undefined : "Not used in this mode."}>
              <select className={inputClass} disabled={!setup} value={req.video.hookId ?? ""} onChange={(e) => set({ video: { ...req.video, hookId: e.target.value || null } })}>
                <option value="">None</option>
                {catalog.hooks.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </Field>
            <Field label="Setting" hint={setup ? undefined : "Not used in this mode."}>
              <select className={inputClass} disabled={!setup} value={req.video.settingId ?? ""} onChange={(e) => set({ video: { ...req.video, settingId: e.target.value || null } })}>
                <option value="">None</option>
                {catalog.settings.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="accent-ink" checked={req.video.generateAudio} onChange={(e) => set({ video: { ...req.video, generateAudio: e.target.checked } })} /> Voice and sound
            </label>
          </div>
        </fieldset>
      )}

      {has("ai_video") && (
        <fieldset className="grid gap-3 border-t border-line pt-4">
          <legend className="eyebrow mb-1">AI video · Seedance 2.5 · made by Higgsfield</legend>
          <p className="-mt-1 text-xs text-muted">A clip made from the brief, with the app&apos;s screenshots as references so the screens look like the real app. No presenter avatar; for a talking presenter use AI UGC video.</p>
          <div className="grid gap-3 @xl:grid-cols-2 @3xl:grid-cols-4">
            <Field label="Length">
              <select className={inputClass} value={aiVideo.duration} onChange={(e) => set({ aiVideo: { ...aiVideo, duration: Number(e.target.value) } })}>
                {[5, 8, 10, 15, 20, 30].map((s) => <option key={s} value={s}>{s} seconds</option>)}
              </select>
            </Field>
            <Field label="Resolution">
              <select className={inputClass} value={aiVideo.resolution} onChange={(e) => set({ aiVideo: { ...aiVideo, resolution: e.target.value as VideoResolution } })}>
                {["480p", "720p", "1080p"].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="accent-ink" checked={aiVideo.useScreenshots} disabled={!workspace.screenshots} onChange={(e) => set({ aiVideo: { ...aiVideo, useScreenshots: e.target.checked } })} /> Use the {workspace.screenshots} screenshot{workspace.screenshots === 1 ? "" : "s"}
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="accent-ink" checked={aiVideo.generateAudio} onChange={(e) => set({ aiVideo: { ...aiVideo, generateAudio: e.target.checked } })} /> Sound
            </label>
          </div>
        </fieldset>
      )}

      {has("image") && (
        <fieldset className="grid gap-3 border-t border-line pt-4">
          <legend className="eyebrow mb-1">Image ads</legend>
          <div className="grid gap-3 @xl:grid-cols-2 @3xl:grid-cols-4">
            <Field label="Model">
              <select className={inputClass} value={req.image.model} onChange={(e) => set({ image: { ...req.image, model: e.target.value as BatchRequest["image"]["model"] } })}>
                {Object.entries(IMAGE_MODEL_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </Field>
            {req.image.model === "gpt_image_2_5" && (
              <Field label="Quality">
                <select className={inputClass} value={req.image.quality} onChange={(e) => set({ image: { ...req.image, quality: e.target.value as ImageQuality } })}>
                  {["low", "medium", "high", "xhigh", "max"].map((q) => <option key={q} value={q}>{q}</option>)}
                </select>
              </Field>
            )}
            <Field label="Resolution">
              <select className={inputClass} value={req.image.resolution} onChange={(e) => set({ image: { ...req.image, resolution: e.target.value as ImageResolution } })}>
                {["1k", "2k", "4k"].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="accent-ink" disabled={!workspace.screenshots} checked={req.image.useScreenshots && workspace.screenshots > 0} onChange={(e) => set({ image: { ...req.image, useScreenshots: e.target.checked } })} /> Use the app&apos;s screenshots
            </label>
          </div>
          <LogoOption value={req.logo ?? null} candidates={logos} composed={Boolean(req.image.composed) && req.format !== "carousel"} productId={workspace.id} onChange={(logo) => set({ logo })} />
          <ComposedOptions value={req.image.composed ?? null} system={workspace.brandSystem ?? null} productId={workspace.id} cutouts={cutouts}
            onChange={(composed) => set({ image: { ...req.image, composed } })} />
        </fieldset>
      )}

      {(has("image") || has("ai_video")) && (
        <fieldset className="grid gap-3 border-t border-line pt-4">
          <legend className="eyebrow mb-1">Reference images · optional</legend>
          <p className="-mt-1 text-xs text-muted">Your product&apos;s own images for image ads and AI videos: they go to Higgsfield before the screenshots, and the scene is rebuilt around them, not pasted on.</p>
          <ProductImagePicker productId={workspace.id} tiles={tiles} picked={picks} onChange={onPickRefs} />
          {picksChanged && <p className="text-xs text-caution-ink">The brief&apos;s OUR IMAGES line describes the images picked in Recreate: edit it to match your new picks.</p>}
        </fieldset>
      )}
    </div>
  );
}

/**
 * "Place the real logo": our exact logo file on every image creative after it's made (composed ads: in
 * their layout's logo slot), never drawn by the model. On by default when there's a logo; which file,
 * and for ordinary images which corner. A Recreate logo also goes to the model as a labelled reference.
 */
function LogoOption({ value, candidates, composed, productId, onChange }: { value: LogoSettings | null; candidates: LogoCandidate[]; composed: boolean; productId: string; onChange: (logo: LogoSettings | null) => void }) {
  if (!value && !candidates.length) {
    return <p className="text-xs text-muted">No logo yet: add your logo under <a href={`/app/w/${productId}/brand?tab=assets`} className="text-accent hover:underline">Brand &gt; Assets</a> (kind Logo) or an app icon in the brand kit, and the real file is placed on every image instead of letting the model draw one.</p>;
  }
  const on = Boolean(value?.overlay);
  const current = value ?? defaultLogo(candidates)!;
  const files = candidates.some((c) => c.url === current.url) ? candidates : [{ url: current.url, label: current.label || "Our logo", source: "asset" as const }, ...candidates];
  const turn = (next: boolean) => onChange(next ? { ...current, overlay: current.overlay ?? "top_left" } : current.reference ? { ...current, overlay: null } : null);
  return (
    <div className="grid gap-3 rounded-inner border border-line bg-raised p-3">
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" checked={on} onChange={(e) => turn(e.target.checked)} />
        <span>
          <span className="font-medium">Place the real logo</span>{" "}
          <span className="text-xs text-muted">The exact file goes on every finished image, inside Meta&apos;s safe area{composed ? " (composed ads: in their layout's logo slot)" : ""}. The model is told not to draw a logo of its own, so no look-alike marks.</span>
        </span>
      </label>
      {on && (
        <div className="grid gap-2 @xl:grid-cols-2">
          <Field label="Logo file">
            <select className={inputClass} value={current.url} onChange={(e) => { const c = files.find((f) => f.url === e.target.value); if (c) onChange({ ...current, url: c.url, label: c.label }); }}>
              {files.map((c) => <option key={c.url} value={c.url}>{c.label}</option>)}
            </select>
          </Field>
          {!composed && (
            <Field label="Where">
              <select className={inputClass} value={current.overlay ?? "top_left"} onChange={(e) => onChange({ ...current, overlay: e.target.value as LogoPosition })}>
                {LOGO_POSITIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Field>
          )}
        </div>
      )}
    </div>
  );
}

type ComposedValue = { layout: string; copy: ComposedCopy; product?: ComposedProduct | null };

/**
 * Composed ads: a text-free plate with the copy set afterwards in the brand's fonts. The layout, the
 * words (the offer only from the brand system's list), what the plate is asked to leave empty, and
 * "Use the real product": a product cut-out composited into the layout's product box.
 */
function ComposedOptions({ value, system, productId, cutouts, onChange }: { value: ComposedValue | null; system: BrandSystem | null; productId: string; cutouts: { id: string; url: string; label: string }[]; onChange: (v: ComposedValue | null) => void }) {
  const on = Boolean(value);
  const v = value ?? { layout: LAYOUTS[0].id, copy: { headline: "" } };
  const setCopy = (patch: Partial<ComposedCopy>) => onChange({ ...v, copy: { ...v.copy, ...patch } });
  const fonts = system?.fonts.filter((f) => f.url).length ?? 0;
  const offers = system?.offers ?? [];
  // Only the fields the picked layout sets (the Offer badge layout has no eyebrow); words left in a
  // field it doesn't have are named, since they wouldn't be on the ad.
  const layout = layoutById(v.layout);
  const roles = layoutRoles(layout);
  const unplaced = unplacedCopy(v.copy, layout);
  return (
    <div className="grid gap-3 rounded-inner border border-line bg-raised p-3">
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" checked={on} onChange={(e) => onChange(e.target.checked ? v : null)} />
        <span>
          <span className="font-medium">Composed ads: set the copy in your fonts</span>{" "}
          <span className="text-xs text-muted">The model makes the scene and product with the copy zones empty; your words are then set on it exactly, at mobile-readable sizes, inside Meta&apos;s safe zones (4:5, 1:1 and 9:16 each laid out on its own). Editable afterwards for free, with an SVG and layers file.{fonts ? "" : " No font files on the Brand page yet: they're set in Inter until you add them."}</span>
        </span>
      </label>
      {on && (
        <>
          <div className="grid gap-2 @xl:grid-cols-3">
            {LAYOUTS.map((l) => (
              <button key={l.id} type="button" aria-pressed={v.layout === l.id} onClick={() => onChange({ ...v, layout: l.id })}
                className={cx("grid gap-0.5 rounded-inner border p-2.5 text-left text-xs", v.layout === l.id ? "border-ink bg-card" : "border-line bg-card/60 hover:border-ink/40")}>
                <span className="font-medium text-ink">{l.name}</span><span className="text-muted">{l.description}</span>
              </button>
            ))}
          </div>
          <div className="grid gap-2 @xl:grid-cols-2">
            <Field label="Headline" hint={`${v.copy.headline.length}/${COPY_LIMITS.headline}. Short reads big: 3–7 words.`}><input className={inputClass} value={v.copy.headline} maxLength={COPY_LIMITS.headline} onChange={(e) => setCopy({ headline: e.target.value })} placeholder={system?.voice.signatureLines[0] ?? "One small habit. Every single day."} /></Field>
            {roles.includes("subhead") && <Field label="Subhead · optional"><input className={inputClass} value={v.copy.subhead ?? ""} maxLength={COPY_LIMITS.subhead} onChange={(e) => setCopy({ subhead: e.target.value })} /></Field>}
            {roles.includes("eyebrow") && <Field label="Eyebrow · optional"><input className={inputClass} value={v.copy.eyebrow ?? ""} maxLength={COPY_LIMITS.eyebrow} onChange={(e) => setCopy({ eyebrow: e.target.value })} /></Field>}
            {roles.includes("cta") && <Field label="Button · optional"><input className={inputClass} value={v.copy.cta ?? ""} maxLength={COPY_LIMITS.cta} onChange={(e) => setCopy({ cta: e.target.value })} placeholder="Start your free scan" /></Field>}
            {roles.includes("offer") && <Field label="Offer · optional" hint={offers.length ? "Only your own offers (Brand page)." : system ? "No offers on the Brand page: none can be shown." : "Add your offers on the Brand page first."}>
              <select className={inputClass} value={v.copy.offer ?? ""} disabled={!offers.length} onChange={(e) => setCopy({ offer: e.target.value || undefined })}>
                <option value="">No offer</option>
                {offers.map((o) => <option key={o.id} value={o.wording || o.name}>{o.wording || o.name}</option>)}
              </select>
            </Field>}
            {roles.includes("legal") && <Field label="Legal line · optional"><input className={inputClass} value={v.copy.legal ?? ""} maxLength={COPY_LIMITS.legal} onChange={(e) => setCopy({ legal: e.target.value })} placeholder="Results vary." /></Field>}
          </div>
          {unplaced.length > 0 && (
            <p className="text-xs text-caution-ink">
              {unplacedNote(layout, unplaced)}{" "}
              <button type="button" className="text-accent hover:underline" onClick={() => setCopy(Object.fromEntries(unplaced.map((r) => [r, undefined])))}>Clear {unplaced.length === 1 ? "it" : "them"}</button>
            </p>
          )}
          <div className="grid gap-2 border-t border-line pt-3">
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" disabled={!cutouts.length} checked={Boolean(v.product)}
                onChange={(e) => onChange({ ...v, product: e.target.checked && cutouts[0] ? { url: cutouts[0].url, label: cutouts[0].label } : null })} />
              <span>
                <span className="font-medium">Use the real product</span>{" "}
                <span className="text-xs text-muted">{cutouts.length
                  ? "Your product's cut-out goes into the layout's product box with a soft floor shadow; the model leaves that spot empty, so labels are never misspelled or redrawn."
                  : <>No cut-outs yet: under <a href={`/app/w/${productId}/brand?tab=assets`} className="text-accent hover:underline">Brand &gt; Assets</a>, use &ldquo;Make cut-out&rdquo; on a product or packaging image.</>}</span>
              </span>
            </label>
            {v.product && cutouts.length > 1 && (
              <Field label="Product">
                <select className={inputClass} value={v.product.url} onChange={(e) => { const c = cutouts.find((x) => x.url === e.target.value); if (c) onChange({ ...v, product: { url: c.url, label: c.label } }); }}>
                  {cutouts.map((c) => <option key={c.id} value={c.url}>{c.label}</option>)}
                </select>
              </Field>
            )}
          </div>
          {!system && <p className="text-xs text-muted">Tip: <a href={`/app/w/${productId}/brand`} className="text-accent hover:underline">import your brand</a> so the plate follows your look and the copy uses your fonts and offers.</p>}
        </>
      )}
    </div>
  );
}

/** The brand system's line: what it adds to every prompt, with a way to see it and to leave it out. */
function BrandSystemToggle({ productId, system, on, onChange }: { productId: string; system: BrandSystem | null; on: boolean; onChange: (on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  if (!system) {
    return <p className="text-xs text-muted">Nothing on the Brand page yet: <a href={`/app/w/${productId}/brand`} className="text-accent hover:underline">fill it in there</a> and every prompt gets your look, voice, avatars and the only offers allowed.</p>;
  }
  return (
    <div className="grid gap-2 rounded-inner border border-line bg-raised p-3 text-xs">
      <label className="flex items-start gap-2.5">
        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" checked={on} onChange={(e) => onChange(e.target.checked)} />
        <span>
          <span className="font-medium text-ink">Use the brand</span>{" "}
          <span className="text-muted">({brandSystemSummary(system).join(", ")}). The look opens every prompt, each variant speaks to the next avatar, and only your offers may appear (the check fails any other).</span>{" "}
          <button type="button" className="text-accent hover:underline" onClick={() => setOpen(!open)}>{open ? "Hide" : "See what's added"}</button>
        </span>
      </label>
      {open && <pre className="max-h-56 overflow-y-auto rounded-md bg-canvas p-2.5 font-mono text-[11px] whitespace-pre-wrap text-muted">{[lookBlock(system), copyBlock(system, { variant: 1, kind: "image" })].filter(Boolean).join("\n\n")}</pre>}
    </div>
  );
}

/** "Use the AI product profile": what it adds to every AI prompt, and a switch to leave it out. */
function ProfileToggle({ productId, profile, on, onChange }: { productId: string; profile: ProductProfile | null; on: boolean; onChange: (on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  if (!profile) {
    return <p className="text-xs text-muted">No AI product profile yet: add your website or App Store link under <a href={`/app/w/${productId}/brand?tab=product`} className="text-accent hover:underline">Brand &gt; Product</a> and the prompts get who it&apos;s for, the promise, proof and your look.</p>;
  }
  return (
    <div className="grid gap-2 rounded-inner border border-line bg-raised p-3 text-xs">
      <label className="flex items-start gap-2.5">
        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-ink" checked={on} onChange={(e) => onChange(e.target.checked)} />
        <span>
          <span className="font-medium text-ink">Use the AI product profile</span>{" "}
          <span className="text-muted">Every AI prompt gets who it&apos;s for and their pain, the promise, proof it may state, your look, and claims to avoid (checked too).</span>{" "}
          <button type="button" className="text-accent hover:underline" onClick={() => setOpen(!open)}>{open ? "Hide" : "See what's added"}</button>
        </span>
      </label>
      {open && <pre className="max-h-56 overflow-y-auto rounded-md bg-canvas p-2.5 font-mono text-[11px] whitespace-pre-wrap text-muted">{profileBrief(profile, { kind: "video" })}</pre>}
    </div>
  );
}
