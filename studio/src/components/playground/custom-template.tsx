"use client";
// A custom template's form: a template this product made from an ad the person uploaded (its fields come
// from the analysis in lib/playground-templates.ts). Fill in the text slots, pick product images and a
// ratio, and "Use this template" hands a ready PlaygroundRequest to the Playground form, which shows it
// for edits and confirms the cost before anything is generated. Nothing here calls an AI or spends credits.
// It opens with "What it's for" from the read (best for, angle, fit with this product), when it has one.
import { useState } from "react";
import { SAFE_ZONE_916, STYLE_PROMPT_MAX, type StyleContext, type StyleField } from "@/lib/ad-styles";
import type { Aspect } from "@/lib/meta-formats";
import { PLAYGROUND_MAX_INPUTS, type PlaygroundRequest } from "@/lib/playground";
import type { ProductFitKind, ProductTemplate, TemplateAnalysis, TemplateField } from "@/lib/playground-templates";
import { cx, Segmented } from "../ui";
import { insertReview, reviewSlot, verbatimReviewIds, type AppStoreReview } from "@/lib/reviews";
import { ReviewPicker } from "./review-picker";
import { DetailHeader, FieldInput, FormFooter, Note, ProductImagePicker, PromptPreview, StyleThumb, WhatItsFor, wideKeys, type OnUse, type ProductImage } from "./style-library";

// MARK: The prompt

const clean = (s: string | undefined | null) => (s ?? "").trim().replace(/\s+/g, " ");
const q = (s: string) => `"${clean(s)}"`;
const cutWords = (s: string, max: number) => (s.length > max ? `${s.slice(0, max).replace(/\s+\S*$/, "")}…` : s);
const TEXT_RULE = "TEXT ON THE IMAGE, exactly as written (letter for letter; nothing added or reworded; no other words):";
/** Below this, the layout line says too little to help: it's dropped instead of cut. */
const MIN_LAYOUT = 80;

/** The same wording the starters use for evidence (lib/ad-styles.ts), for the slots the analysis marked sensitive. */
export const SENSITIVE_CAUTION = "Stats, reviews and ratings must be your own: real, sourced numbers (your user data or a published study) and a real customer's words, used with their permission. Made-up or rounded-up stats and invented reviews break Meta's ad policies and consumer-protection law.";
const SENSITIVE_HINT = "Your own, real and sourced. Never estimated or invented.";

/** The ratios a template offers: its own, plus the nearest feed or Stories shape it can reflow into. */
export function templateAspects(aspect: Aspect): Aspect[] {
  const more: Record<Aspect, Aspect[]> = { "1:1": ["4:5"], "4:5": ["9:16"], "9:16": ["4:5"], "16:9": [] };
  return [aspect, ...more[aspect]];
}

/** Starting values: the reference's own text, its "BRAND" placeholder swapped for ours, to edit; sensitive slots start empty. */
export const defaultTemplateFields = (fields: TemplateField[], appName = ""): Record<string, string> =>
  Object.fromEntries(fields.map((f) => [f.key, f.sensitive ? "" : appName.trim() ? f.example.replace(/\bBRAND\b/g, appName.trim()) : f.example]));

/** Problems by key: sensitive slots are required, and every slot has a length limit. */
export function validateTemplateFields(fields: TemplateField[], values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = clean(values[f.key]);
    if (f.sensitive && !v) errors[f.key] = "Required";
    else if (v.length > f.maxLength) errors[f.key] = `${v.length}/${f.maxLength} characters`;
  }
  return errors;
}

export interface BuiltTemplate { prompt: string; overBy: number; request: PlaygroundRequest }

/**
 * The full image prompt for a filled-in custom template, and the Playground request built from it. The
 * reference is the clean template image (image 1); the person's images follow. Every on-image word is
 * quoted as typed; the original ad's brands go to mustAvoid and are never named. Stays under the
 * Playground's limit by cutting the layout description first (then dropping it).
 */
export function buildTemplatePrompt(template: ProductTemplate, analysis: TemplateAnalysis, values: Record<string, string>, ctx: StyleContext,
  opts: { inputs?: ProductImage[]; aspect?: Aspect; count?: PlaygroundRequest["count"] } = {}): BuiltTemplate {
  const name = clean(ctx.appName);
  const inputs = (opts.inputs ?? []).slice(0, PLAYGROUND_MAX_INPUTS);
  const aspect = opts.aspect && templateAspects(analysis.aspect).includes(opts.aspect) ? opts.aspect : analysis.aspect;
  const filled = Object.fromEntries(analysis.fields.map((f) => [f.key, clean(values[f.key])]));
  const slots = analysis.fields.filter((f) => filled[f.key]);
  const slot = clean(analysis.productSlot) || "the product";
  const range = inputs.length === 1 ? "Image 2" : `Images 2–${inputs.length + 1}`;

  const lines = (layout: string) => [
    `New Meta ad for ${q(name)} in the exact format of the reference image (${clean(template.name) || clean(analysis.name)}, ${aspect}): copy its layout, proportions, typography and UI, but none of its brand, product, people or words.`,
    layout ? `LAYOUT: ${layout}` : "",
    aspect !== analysis.aspect ? `The output is ${aspect}: extend or reflow the same design to fit; never squash, stretch or crop off text.` : "",
    ...(slots.length ? [TEXT_RULE, ...slots.map((f) => `- ${clean(f.label)}: ${q(filled[f.key])}`)] : ["No words on the image."]),
    inputs.length
      ? `${range}: our product (${slot}); keep exactly as they look.`
      : `No product images attached: show ${slot} simply, with no readable label and no other brand.`,
    aspect === "9:16" ? SAFE_ZONE_916 : "",
    `The only brand is ${q(name)}. Photorealistic, crisp legible text.`,
  ].filter(Boolean).join("\n");

  const layout = clean(analysis.layout);
  let prompt = lines(layout);
  if (prompt.length > STYLE_PROMPT_MAX) {
    const room = STYLE_PROMPT_MAX - lines("").length - "LAYOUT: \n".length;
    prompt = lines(room >= MIN_LAYOUT ? cutWords(layout, room - 1) : "");
  }

  const typed = Object.values(filled).join(" \n ").toLowerCase();
  const mustAvoid = [...new Set([...analysis.brands, ...(ctx.competitors ?? [])].map(clean).filter((b) => b && !typed.includes(b.toLowerCase())))];
  return {
    prompt,
    overBy: Math.max(0, prompt.length - STYLE_PROMPT_MAX),
    request: {
      prompt,
      referenceUrl: template.templateUrl,
      inputUrls: inputs.map((x) => x.url),
      aspect,
      count: opts.count ?? 2,
      styleId: `custom:${template.id}`,
      styleFields: filled,
      mustAvoid,
    },
  };
}

// MARK: The form

/** A TemplateField in the starters' field shape, so both forms share one input. */
const asStyleField = (f: TemplateField): StyleField => ({
  key: f.key, label: f.label, maxLength: f.maxLength, multiline: f.multiline, onImage: true, required: f.sensitive, evidence: f.sensitive, default: "",
  placeholder: f.sensitive ? "Your own, real and sourced" : f.example,
  hint: f.sensitive ? SENSITIVE_HINT : undefined,
});

export function CustomTemplateDetail({ template, analysis, ctx, loading, productKind = null, productImages, onUse, onBack, productId }: {
  template: ProductTemplate; analysis: TemplateAnalysis; ctx: StyleContext | null; loading: boolean; productKind?: ProductFitKind | null; productImages: ProductImage[]; onUse: OnUse; onBack: () => void;
  /** For the review picker's "Fetch reviews". */
  productId?: string;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string[] | null>(null);
  const [aspect, setAspect] = useState<Aspect>(analysis.aspect);
  const [tried, setTried] = useState(false);

  const context: StyleContext = ctx ?? { appName: "" };
  const values = { ...defaultTemplateFields(analysis.fields, context.appName), ...edits };
  const available = new Set(productImages.map((p) => p.url));
  const chosen = (picked ?? (productImages[0] ? [productImages[0].url] : [])).filter((u) => available.has(u));
  const inputs = chosen.map((url) => ({ url, label: productImages.find((p) => p.url === url)?.label ?? null }));

  const errors = validateTemplateFields(analysis.fields, values);
  const errorCount = Object.keys(errors).length;
  const noName = !loading && !context.appName;
  const built = buildTemplatePrompt(template, analysis, values, context, { inputs, aspect });
  const fields = analysis.fields.map(asStyleField);
  const aspects = templateAspects(analysis.aspect);
  const sensitive = analysis.fields.some((f) => f.sensitive);
  // A review slot on the ad: a real App Store review, word for word, with its id on the request while it stays verbatim.
  const slot = reviewSlot(analysis.fields);
  const [review, setReview] = useState<AppStoreReview | null>(null);
  const reviewIds = verbatimReviewIds(values, slot, review);

  const set = (key: string, value: string) => setEdits((e) => ({ ...e, [key]: value }));
  const toggle = (url: string) => setPicked(chosen.includes(url) ? chosen.filter((u) => u !== url) : chosen.length < PLAYGROUND_MAX_INPUTS ? [...chosen, url] : chosen);
  const use = () => {
    setTried(true);
    if (errorCount || noName || loading || built.overBy || !template.templateUrl) return;
    onUse(reviewIds.length ? { ...built.request, reviewIds } : built.request);
  };
  const shownError = (f: StyleField) => {
    const e = errors[f.key];
    return e && (tried || e !== "Required") ? e : undefined;
  };
  const wide = wideKeys(fields);

  return (
    <div>
      <DetailHeader title={template.name} aspect={aspect} onBack={onBack} />
      <WhatItsFor guidance={analysis} productKind={productKind} productName={context.appName} />

      <div className="grid gap-4 @3xl:grid-cols-[232px_minmax(0,1fr)]">
        <aside className="flex gap-3 @3xl:flex-col">
          <a href={template.templateUrl ?? undefined} target="_blank" rel="noreferrer" className="block w-24 shrink-0 overflow-hidden rounded-small border border-line bg-control @3xl:w-full" title="Open the template">
            <StyleThumb src={template.templateUrl ?? ""} alt={`${template.name} template`} className="w-full" fallbackClassName="aspect-[4/5]" fallback="No image" />
          </a>
          <div className="min-w-0 space-y-3">
            {analysis.tagline && <Note title="Why it works">{analysis.tagline}</Note>}
            <p className="text-xs leading-4 text-faint">
              {template.importedFrom ? `Imported from ${template.importedFrom}: made from an ad uploaded there, used only for its layout.` : "Made from an ad you uploaded, used only for its layout."}{analysis.brands.length ? ` Its brands (${analysis.brands.join(", ")}) are kept out of the result.` : ""}
            </p>
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          {sensitive && <p className="rounded-inner bg-caution-soft px-3 py-2 text-xs text-caution-ink">{SENSITIVE_CAUTION}</p>}
          {slot && (
            <ReviewPicker reviews={context.reviews ?? []} maxLength={analysis.fields.find((f) => f.key === slot.text)?.maxLength ?? 160} picked={reviewIds.length ? review : null} productId={productId}
              onPick={(r) => { setReview(r); setEdits((e) => insertReview(e, slot, r)); }} />
          )}

          {fields.length > 0 ? (
            <div className="grid gap-x-3 gap-y-3 @lg:grid-cols-2">
              {fields.map((f) => (
                <FieldInput key={f.key} field={f} value={values[f.key] ?? ""} error={shownError(f)} onChange={(v) => set(f.key, v)}
                  className={cx(wide.has(f.key) && "@lg:col-span-2")} />
              ))}
            </div>
          ) : <p className="text-xs text-muted">No text on this template: just pick your images.</p>}

          {aspects.length > 1 && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted">Ratio</span>
              <Segmented label="Ratio" value={aspect} onChange={setAspect} options={aspects.map((a) => ({ value: a, label: a }))} />
            </div>
          )}

          <ProductImagePicker productImages={productImages} chosen={chosen} onToggle={toggle}
            hint={`Stands in for the ad's product: ${clean(analysis.productSlot) || "your product"}.`}
            empty="No product images yet. Add photos or app screens under Brand > Assets, or the model will have to imagine your product." />

          <PromptPreview prompt={built.prompt} overBy={built.overBy} mustAvoid={built.request.mustAvoid} />

          <FormFooter warn={Boolean((tried && errorCount) || noName || built.overBy)} canReset={Object.keys(edits).length > 0 || picked !== null || aspect !== analysis.aspect}
            onReset={() => { setEdits({}); setPicked(null); setAspect(analysis.aspect); setTried(false); }} onUse={use} disabled={loading || noName || !template.templateUrl}>
            {noName ? "Add your product's name under Brand > Product first."
              : built.overBy ? `The prompt is ${built.overBy} characters over the Playground's limit; shorten the text.`
              : tried && errorCount ? `Fill in ${errorCount === 1 ? "1 field" : `${errorCount} fields`} first.`
              : loading ? "Loading your product…"
              : `2 versions · ${aspect} · nothing is generated until you confirm in the Playground.`}
          </FormFooter>
        </div>
      </div>
    </div>
  );
}
