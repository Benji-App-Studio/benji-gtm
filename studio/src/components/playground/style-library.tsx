"use client";
// A starter template's detail (lib/ad-styles.ts, one of the 15 proven Meta ad formats a product added to
// its Library), plus the pieces the custom-template form shares with it. Fill it in for the product
// (pre-filled from the product profile), choose which product images to attach, and "Use this template"
// hands a ready PlaygroundRequest to the Playground form, which shows it for edits and confirms the cost
// before anything is generated. Nothing here calls an AI or spends credits.
//
// Product context: fetched from the same APIs the Product and Formats pages use (/api/products/:id for
// the kind and category, /api/w/:id/app for the brand name, competitors and AI profile). Pass `context`
// to supply it directly instead (e.g. a harness or a page that already has the product loaded).
// Both forms open with "What it's for" (WhatItsFor): the template's guidance and whether it fits this
// product (lib/playground-templates-plan.ts templateFit). Advice only: the person can always use it.
import { useMemo, useState, type ReactNode } from "react";
import { buildStylePrompt, defaultFieldsFor, namedCompetitors, onImageLength, STYLE_PROMPT_MAX, validateStyleFields, type AdStyle, type StyleContext, type StyleField } from "@/lib/ad-styles";
import { useCached } from "@/lib/client-cache";
import type { ProductRow } from "@/lib/db";
import type { AppContext } from "@/lib/formats/types";
import type { Aspect } from "@/lib/meta-formats";
import { PLAYGROUND_MAX_INPUTS, type PlaygroundRequest } from "@/lib/playground";
import type { ProductFitKind, TemplateGuidance } from "@/lib/playground-templates";
import { angleLabel, templateFit, type ProductSignals } from "@/lib/playground-templates-plan";
import { profileOf } from "@/lib/product-insight";
import { insertReview, reviewSlot, reviewsOf, verbatimReviewIds, type AppStoreReview } from "@/lib/reviews";
import { ReviewPicker } from "./review-picker";
import { showOriginal } from "@/lib/thumb";
import { readBrandKit } from "@/lib/workspace-schema";
import { IconAlert, IconCheck, IconChevronDown, IconChevronLeft } from "../icons";
import { Badge, Button, cx, inputClass, Segmented, Thumb } from "../ui";
import { UI_LOCALE } from "@/lib/ui-locale";

/** The workspace's product images (public URLs) the person can attach to a template; `kind` is the image's AssetKind, when known. */
export type ProductImage = { url: string; label: string | null; kind?: string | null };
/** Hands a filled-in request to the Playground form, which shows it for edits before generating. */
export type OnUse = (request: PlaygroundRequest) => void;

const isObject = <T,>(v: unknown, key: string): v is T => Boolean(v && typeof v === "object" && key in v);

/** The prompt context from the product row and the workspace's app context (either may be missing). */
function contextOf(app: AppContext | undefined, product: ProductRow | undefined): StyleContext | null {
  if (!app && !product) return null;
  const kitName = product ? readBrandKit(product.brand_kit, product.name).appName : "";
  return {
    appName: app?.brandKit.appName || kitName || app?.name || product?.name || "",
    productDescription: app?.description ?? product?.description,
    category: product?.category_label || product?.insight?.category || undefined,
    // The product's one competitor list (lib/server/competitors.ts via /api/w/:id/app); the product row's
    // mirror of it only while the app context is missing.
    competitors: app ? app.competitorNames : (product?.known_competitors ?? []),
    kind: product?.kind,
    profile: app?.profile ?? profileOf(product?.insight),
    reviews: reviewsOf(product?.insight),
  };
}

/** The prompt context, and what the product is for the fit line (its kind, App Store link and screenshots; add the image kinds). */
export function useStyleContext(productId: string, override?: StyleContext): { ctx: StyleContext | null; loading: boolean; signals: ProductSignals } {
  const [product] = useCached<ProductRow | { error: string }>(`/api/products/${productId}`);
  const [app] = useCached<{ app?: AppContext; error?: string }>(`/api/w/${productId}/app`);
  const row = isObject<ProductRow>(product, "id") ? product : undefined;
  const ctx = useMemo(() => override ?? contextOf(app?.app, row), [override, app, row]);
  const signals = useMemo((): ProductSignals => {
    const kit = app?.app?.brandKit ?? (row ? readBrandKit(row.brand_kit, row.name) : undefined);
    return { kind: override?.kind ?? row?.kind, appStoreUrl: kit?.appStoreUrl, screenshots: kit?.screenshotUrls.length ?? 0 };
  }, [override, app, row]);
  return { ctx, loading: !override && (product === undefined || app === undefined), signals };
}

/** A style's example image; until the file exists (or if it fails to load), a quiet empty tile instead of a broken image. */
export function StyleThumb({ src, alt, className, fallbackClassName, fallback = "" }: { src: string; alt: string; className?: string; fallbackClassName?: string; fallback?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return <div role="img" aria-label={alt} className={cx("grid place-items-center bg-control text-xs text-faint", className, fallbackClassName)}>{fallback}</div>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" decoding="async" className={cx("object-cover", className)}
      // A resized copy (lib/thumb.ts) that Storage couldn't make falls back to the original first.
      onError={(e) => { if (!showOriginal(e.currentTarget)) setFailed(src); }}
      // An image that failed before hydration never fires onError: catch it here.
      ref={(el) => { if (el?.complete && el.naturalWidth === 0 && !showOriginal(el)) setFailed(src); }} />
  );
}

// MARK: One style

/**
 * A starter's form. `title` is the name it has in this product's Library (the person may have renamed it);
 * `productKind` is what the product is, for the fit line (null when unknown).
 */
export function StyleDetail({ style, title, ctx, loading, productKind = null, productImages, onUse, onBack, productId }: {
  style: AdStyle; title?: string; ctx: StyleContext | null; loading: boolean; productKind?: ProductFitKind | null; productImages: ProductImage[]; onUse: OnUse; onBack: () => void;
  /** For the review picker's "Fetch reviews". */
  productId?: string;
}) {
  // Only what the person changed is state; the rest follows the product profile as it loads.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string[] | null>(null);
  const [aspect, setAspect] = useState<Aspect>(style.aspect);
  const [tried, setTried] = useState(false);

  const context: StyleContext = ctx ?? { appName: "" };
  const fields = { ...defaultFieldsFor(style, context), ...edits };
  const available = new Set(productImages.map((p) => p.url));
  const chosen = (picked ?? (style.needsImages && productImages[0] ? [productImages[0].url] : [])).filter((u) => available.has(u));
  const inputs = chosen.map((url) => ({ url, label: productImages.find((p) => p.url === url)?.label ?? null }));

  const errors = validateStyleFields(style, fields);
  const noName = !loading && !context.appName;
  const errorCount = Object.keys(errors).length;
  const built = buildStylePrompt(style, fields, context, { inputs, aspect });
  const rivals = namedCompetitors(style, fields, context);
  const textLength = onImageLength(style, fields);
  // Review-style styles: a real App Store review, word for word, with its id on the request while it stays verbatim.
  const slot = reviewSlot(style.fields);
  const [review, setReview] = useState<AppStoreReview | null>(null);
  const reviewIds = verbatimReviewIds(fields, slot, review);

  const set = (key: string, value: string) => setEdits((e) => ({ ...e, [key]: value }));
  const toggle = (url: string) => setPicked(chosen.includes(url) ? chosen.filter((u) => u !== url) : chosen.length < PLAYGROUND_MAX_INPUTS ? [...chosen, url] : chosen);
  const use = () => {
    setTried(true);
    if (errorCount || noName || loading || built.overBy) return;
    onUse(reviewIds.length ? { ...built.request, reviewIds } : built.request);
  };
  const shownError = (f: StyleField) => {
    const e = errors[f.key];
    return e && (tried || e !== "Required") ? e : undefined;
  };

  // The plain fields above the table (if any) and those after it in the style's order (e.g. a footnote under the stats).
  const firstCell = style.fields.findIndex((f) => f.cell);
  const plainBefore = style.fields.filter((f, i) => !f.cell && (firstCell < 0 || i < firstCell));
  const plainAfter = firstCell < 0 ? [] : style.fields.filter((f, i) => !f.cell && i > firstCell);
  const cells = style.fields.filter((f) => f.cell);
  const fieldGrid = (list: StyleField[]) => list.length > 0 && (
    <div className="grid gap-x-3 gap-y-3 @lg:grid-cols-2">
      {list.map((f) => (
        <FieldInput key={f.key} field={f} value={fields[f.key] ?? ""} error={shownError(f)} onChange={(v) => set(f.key, v)}
          className={wideKeys(list).has(f.key) ? "@lg:col-span-2" : undefined} />
      ))}
    </div>
  );

  return (
    <div>
      <DetailHeader title={title || style.name} aspect={aspect} onBack={onBack} />
      <WhatItsFor guidance={style} productKind={productKind} productName={context.appName} />

      <div className="grid gap-4 @3xl:grid-cols-[232px_minmax(0,1fr)]">
        <aside className="flex gap-3 @3xl:flex-col">
          <a href={style.referenceImage} target="_blank" rel="noreferrer" className="block w-24 shrink-0 overflow-hidden rounded-small border border-line bg-control @3xl:w-full" title="Open the example">
            <StyleThumb src={style.referenceImage} alt={`${style.name} example`} className="w-full" fallbackClassName="aspect-[4/5]" />
          </a>
          <div className="min-w-0 space-y-3">
            <Note title="Why it works">{style.why}</Note>
            <Note title="Runs best">{style.audience}</Note>
            <p className="text-xs leading-4 text-faint">The example is another brand&apos;s ad, used only for its layout. Its brand is replaced with yours and kept out of the result.</p>
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          {style.caution && <p className="rounded-inner bg-caution-soft px-3 py-2 text-xs text-caution-ink">{style.caution}</p>}
          {slot && (
            <ReviewPicker reviews={context.reviews ?? []} maxLength={style.fields.find((f) => f.key === slot.text)?.maxLength ?? 160} picked={reviewIds.length ? review : null} productId={productId}
              onPick={(r) => { setReview(r); setEdits((e) => insertReview(e, slot, r)); }} />
          )}

          {fieldGrid(plainBefore)}
          {cells.length > 0 && style.table && <FieldTable table={style.table} cells={cells} fields={fields} errors={tried ? errors : {}} set={set} />}
          {fieldGrid(plainAfter)}

          {style.aspects.length > 1 && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted">Ratio</span>
              <Segmented label="Ratio" value={aspect} onChange={setAspect} options={style.aspects.map((a) => ({ value: a, label: a }))} />
            </div>
          )}

          <ProductImagePicker productImages={productImages} chosen={chosen} onToggle={toggle} hint={style.imageHint}
            empty={`No product images yet. Add photos or app screens under Brand > Assets${style.needsImages ? ", or the model will have to imagine your product" : ""}.`} />

          {style.textBudget && textLength > style.textBudget && (
            <p className="text-xs text-caution-ink">{textLength} characters on the image; over ~{style.textBudget} may not fit the {aspect} safe area. Shorter reads better too.</p>
          )}
          {rivals.length > 0 && (
            <p className="text-xs text-caution-ink">Your text names {rivals.join(", ")}. Ads that name competitors are often rejected; it&apos;s kept as you wrote it.</p>
          )}

          <PromptPreview prompt={built.prompt} overBy={built.overBy} mustAvoid={built.request.mustAvoid} />

          <FormFooter warn={Boolean((tried && errorCount) || noName || built.overBy)} canReset={Object.keys(edits).length > 0}
            onReset={() => { setEdits({}); setTried(false); }} onUse={use} disabled={loading || noName}>
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

// MARK: Shared with the custom-template form

/** "‹ Library / Name  4:5" above a template's form. */
export function DetailHeader({ title, aspect, onBack }: { title: string; aspect: Aspect; onBack: () => void }) {
  return (
    <div className="mb-3 flex min-w-0 items-center gap-2">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2"><IconChevronLeft />Library</Button>
      <span className="text-faint">/</span>
      <span className="min-w-0 truncate text-sm font-medium text-ink" title={title}>{title}</span>
      <Badge className="shrink-0 tabular-nums">{aspect}</Badge>
    </div>
  );
}

/**
 * "What it's for" at the top of a template's form: what it suits, its angle, and whether it fits this
 * product (green) or how to adapt it (amber). Advice only, never a block. Nothing when there's no guidance.
 */
export function WhatItsFor({ guidance, productKind, productName }: { guidance: TemplateGuidance | null | undefined; productKind: ProductFitKind | null; productName: string }) {
  const fit = templateFit(guidance, productKind, productName);
  if (!guidance?.bestFor && !guidance?.angle && !fit) return null;
  return (
    <section aria-label="What it's for" className="mb-4 rounded-inner border border-line bg-raised px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-medium text-muted">What it&apos;s for</span>
        {guidance?.angle && <Badge>{angleLabel(guidance.angle)}</Badge>}
      </div>
      {guidance?.bestFor && <p className="mt-1 text-caption text-muted">{guidance.bestFor}</p>}
      {fit && (
        <p className={cx("mt-2 flex items-start gap-1.5 rounded-control px-2 py-1.5 text-caption [&_svg]:mt-[3px] [&_svg]:size-3 [&_svg]:shrink-0",
          fit.fit === "good" ? "bg-win-soft text-win" : "bg-caution-soft text-caution-ink")}>
          {fit.fit === "good" ? <IconCheck /> : <IconAlert />}
          <span>{fit.text}{fit.fit === "adapt" && <> {fit.tip}</>}</span>
        </p>
      )}
    </section>
  );
}

/** The product images to attach, as a grid of toggles (in the order they go to Higgsfield). */
export function ProductImagePicker({ productImages, chosen, onToggle, hint, empty }: { productImages: ProductImage[]; chosen: string[]; onToggle: (url: string) => void; hint: string; empty: string }) {
  // Folded away until opened (a product can have 100+ images); what's attached stays in view.
  const [open, setOpen] = useState(false);
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-muted">Your images</span>
        <span className="text-xs text-faint tabular-nums">{chosen.length} of {Math.min(PLAYGROUND_MAX_INPUTS, productImages.length)} attached</span>
      </div>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
      {productImages.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
            className="inline-flex h-7 items-center gap-1.5 rounded-control border border-hairline bg-raised px-2.5 text-xs font-medium text-ink transition hover:bg-hover">
            <IconChevronDown className={cx("size-3.5 transition", !open && "-rotate-90")} />
            {open ? "Hide images" : `Show ${productImages.length} image${productImages.length === 1 ? "" : "s"}`}
          </button>
          {!open && chosen.map((url) => (
            <button key={url} type="button" onClick={() => setOpen(true)} className="relative size-8 overflow-hidden rounded-md border border-accent">
              <Thumb src={url} size={64} alt="" className="size-full" />
            </button>
          ))}
        </div>
      )}
      {productImages.length && !open ? null : productImages.length ? (
        <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(60px,1fr))] gap-2">
          {productImages.map((img) => {
            const on = chosen.includes(img.url);
            const full = !on && chosen.length >= PLAYGROUND_MAX_INPUTS;
            return (
              <button key={img.url} type="button" onClick={() => onToggle(img.url)} disabled={full} aria-pressed={on} title={img.label ?? "Product image"}
                className={cx("relative aspect-square overflow-hidden rounded-control border bg-control transition disabled:opacity-40",
                  on ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-ink/20")}>
                <Thumb src={img.url} size={160} alt={img.label ?? "Product image"} className="size-full" />
                {on && <span className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-accent text-on-ink [&_svg]:size-2.5"><IconCheck /></span>}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 rounded-inner border border-dashed border-line px-3 py-2.5 text-xs text-muted">{empty}</p>
      )}
    </section>
  );
}

/** The exact prompt the template builds, folded away, with its length against the Playground's limit. */
export function PromptPreview({ prompt, overBy, mustAvoid }: { prompt: string; overBy: number; mustAvoid?: string[] }) {
  return (
    <details className="group rounded-inner border border-line bg-raised">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-muted [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5"><IconChevronDown className="size-3.5 -rotate-90 transition group-open:rotate-0" />Prompt preview</span>
        <span className={cx("font-normal tabular-nums", overBy ? "text-warn" : "text-faint")}>{prompt.length.toLocaleString(UI_LOCALE)} / {STYLE_PROMPT_MAX.toLocaleString(UI_LOCALE)}</span>
      </summary>
      <div className="border-t border-line px-3 py-2.5">
        <pre className="max-h-72 overflow-auto font-mono text-[11px] leading-[1.55] whitespace-pre-wrap text-label">{prompt}</pre>
        {mustAvoid?.length ? <p className="mt-2 text-xs text-muted">Kept out of the result: {mustAvoid.join(", ")}</p> : null}
      </div>
    </details>
  );
}

/** The status line and "Use this template" under a template's form. */
export function FormFooter({ warn, canReset, onReset, onUse, disabled, children }: { warn: boolean; canReset: boolean; onReset: () => void; onUse: () => void; disabled: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
      <p className={cx("text-xs", warn ? "text-warn" : "text-muted")}>{children}</p>
      <div className="flex items-center gap-2">
        {canReset && <Button variant="ghost" size="sm" onClick={onReset}>Reset</Button>}
        <Button onClick={onUse} disabled={disabled}>Use this template</Button>
      </div>
    </div>
  );
}

/** Short fields sit two to a row; a short field with no partner, and every multiline one, takes the full row. */
export function wideKeys(list: StyleField[]): Set<string> {
  const wide = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    if (list[i].multiline) { wide.add(list[i].key); continue; }
    if (list[i + 1] && !list[i + 1].multiline) { i++; continue; }
    wide.add(list[i].key);
  }
  return wide;
}

export function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted">{title}</p>
      <p className="mt-0.5 text-caption text-muted">{children}</p>
    </div>
  );
}

export function FieldInput({ field, value, error, onChange, className }: { field: StyleField; value: string; error?: string; onChange: (value: string) => void; className?: string }) {
  const id = `style-field-${field.key}`;
  const over = value.trim().length > field.maxLength;
  return (
    <div className={cx("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex h-[18px] items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-muted">{field.label}</label>
        {!field.options && <span className={cx("text-xs tabular-nums", over ? "text-warn" : "text-faint")}>{value.trim().length}/{field.maxLength}</span>}
      </div>
      {field.options ? (
        <Segmented label={field.label} value={value} onChange={onChange} options={field.options} className="self-start" />
      ) : field.multiline ? (
        <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} rows={field.maxLength > 300 ? 4 : 2}
          className={cx(inputClass, "resize-y leading-[1.45]", error && "border-warn/60")} />
      ) : (
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className={cx(inputClass, error && "border-warn/60")} />
      )}
      {error ? <p className="text-xs text-warn">{error}</p> : field.hint ? <p className="text-xs text-muted">{field.hint}</p> : null}
    </div>
  );
}

/** A style's list fields as a compact table: one row per item (a reason, a bubble, a stat…), one input per column. */
function FieldTable({ table, cells, fields, errors, set }: {
  table: NonNullable<AdStyle["table"]>; cells: StyleField[]; fields: Record<string, string>; errors: Record<string, string>; set: (key: string, value: string) => void;
}) {
  const rows = [...new Set(cells.map((c) => c.cell!.row))];
  const at = (row: number, col: string) => cells.find((c) => c.cell!.row === row && c.cell!.col === col);
  const head = "truncate text-xs font-medium text-faint";
  const template = table.columns.map((c) => (c.px ? `${c.px}px` : `minmax(0,${c.fr ?? 1}fr)`)).join(" ");
  return (
    <section>
      <div className="grid gap-x-2 gap-y-1.5" style={{ gridTemplateColumns: template }}>
        {table.columns.map((c) => {
          const label = (c.labelFrom && fields[c.labelFrom]) || c.label;
          return <span key={c.col} className={cx(head, c.center && "text-center")} title={label}>{label}</span>;
        })}
        {rows.map((row) => table.columns.map((c) => {
          const f = at(row, c.col);
          if (!f) return <span key={`${row}-${c.col}`} />;
          return (
            <input key={f.key} aria-label={f.label} value={fields[f.key] ?? ""} placeholder={f.placeholder} maxLength={f.maxLength + 20}
              onChange={(e) => set(f.key, e.target.value)}
              className={cx(inputClass, c.center && "text-center", errors[f.key] && "border-warn/60")} />
          );
        }))}
      </div>
      {Object.keys(errors).some((k) => cells.some((c) => c.key === k))
        ? <p className="mt-1 text-xs text-warn">{table.note}</p>
        : cells.some((c) => c.evidence) && <p className="mt-1 text-xs text-muted">{table.note}</p>}
    </section>
  );
}
