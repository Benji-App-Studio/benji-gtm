// A product's own Playground template library. Nothing here is global: every template belongs to one
// product (workspace), so switching product shows that product's library, empty for a new one.
// Two kinds:
// - "starter": one of the built-in styles (lib/ad-styles.ts AD_STYLES) the person added to this
//   product's library. Free; it uses the style's own fields and prompt builder.
// - "custom": an ad image the person uploaded. The research function reads it (OpenAI vision: layout,
//   on-image text slots, brands to keep out); then, after the person confirms the credits, Higgsfield
//   remakes it as a clean, brand-neutral template image (the creative pipeline, batch
//   settings.source = "playground-template"). Its fields come from the analysis.
// A ready template can be imported from another of the person's products: a starter is added as usual;
// a custom one becomes a new row here pointing at the same (brand-neutral) files, free, marked with the
// product it came from. It's filled in for this product's brand like any other.
// Table: public.product_templates (migrations 20261003800000, 20261005800000).
import type { Aspect } from "./meta-formats";

export type TemplateKind = "starter" | "custom";

/** Where a custom template is: read → ready to remake → remaking → ready (or failed at either step). */
export type TemplateStatus = "analyzing" | "analyzed" | "generating" | "ready" | "failed";

/** One editable text slot found on the uploaded ad (a headline, a stat, a review, a label…). */
export interface TemplateField {
  key: string;
  label: string;
  /** What the reference ad says there (with its brand swapped for "BRAND"); the default the person edits. */
  example: string;
  maxLength: number;
  multiline: boolean;
  /** Stats, reviews, ratings, certifications, before/after: must be the person's own, real and sourced. */
  sensitive: boolean;
}

/** The product kinds a template suits: a physical product, an app (or software), a service, or an offer (promo- or discount-led). */
export const TEMPLATE_FITS = ["physical", "app", "service", "offer"] as const;
export type TemplateFit = (typeof TEMPLATE_FITS)[number];
/** What the current product is, for the fit line. An offer is a way to sell, never a kind of product. */
export type ProductFitKind = Exclude<TemplateFit, "offer">;

/**
 * What a template is for, so the person can tell whether it suits their product before using it (they
 * can always use it anyway). A custom template's comes from the read; a starter's from AD_STYLES. All
 * optional: templates read before this existed have none.
 */
export interface TemplateGuidance {
  /** One sentence: the products it suits ("Physical products with a price advantage over a premium rival…"). */
  bestFor?: string;
  /** The persuasion mechanism in a few words ("price comparison", "social proof", "curiosity"…). */
  angle?: string;
  /** The product kinds it suits best, in TEMPLATE_FITS order. */
  fits?: TemplateFit[];
  /** One sentence on adapting it to a product kind it doesn't naturally fit. */
  adaptTip?: string;
}

/** What the research function read from an uploaded ad. */
export interface TemplateAnalysis extends TemplateGuidance {
  name: string;
  /** One line on why this format works on Meta. */
  tagline: string;
  /** The layout, precisely: zones, typography, colours, product placement, UI elements, background. */
  layout: string;
  aspect: Aspect;
  fields: TemplateField[];
  /** Brand names, product names, handles and seals in the original: always kept out of results. */
  brands: string[];
  /** What the template expects from the person's images ("a bottle in hand", "an app screen"…). */
  productSlot: string;
  hasPeople: boolean;
  group: "social" | "proof" | "hero";
}

export interface ProductTemplate {
  id: string;
  productId: string;
  kind: TemplateKind;
  /** For starters: the AD_STYLES id. */
  starterId: string | null;
  name: string;
  status: TemplateStatus;
  /** The uploaded original (custom only). */
  sourceUrl: string | null;
  /** The clean template image: the starter's /ad-styles image, or the Higgsfield remake once ready. */
  templateUrl: string | null;
  thumbUrl: string | null;
  analysis: TemplateAnalysis | null;
  /** The remake's creative batch, while or after generating. */
  batchId: string | null;
  error: string | null;
  createdAt: string;
  /** The other product it was imported from (its name today), or null: made here, or that product is gone. */
  importedFrom: string | null;
}

/** A ready template in another of the person's products, as the import picker lists it. */
export interface ImportableTemplate extends ProductTemplate {
  /** Already in this product's Library (the same starter, or a copy of the same template image). */
  added: boolean;
}

/** One of the person's other products and its ready templates, newest first. */
export interface ImportGroup {
  productId: string;
  productName: string;
  templates: ImportableTemplate[];
}

/**
 * API: /api/playground/[productId]/templates
 *   GET                                  → { templates: ProductTemplate[] } (this product's only)
 *   GET ?scope=others                    → { groups: ImportGroup[] } (the person's other products' ready templates)
 *   POST { action: "add-starter", starterId }        → { template }
 *   POST { action: "upload", file (multipart) }      → { template } (status "analyzing"; analysis runs)
 *   POST { action: "plan-remake", templateId }       → { credits, warnings }
 *   POST { action: "remake", templateId, confirmedCredits } → { template } (status "generating")
 *   POST { action: "import", templateId }            → { template } (a ready template of another of the person's products; free, idempotent)
 *   PATCH { templateId, name }                       → { template }
 *   DELETE { templateId }                            → { ok } (row + uploaded/remade files no other template still uses)
 */
export const TEMPLATE_SOURCE = "playground-template";
export const MAX_CUSTOM_TEMPLATES = 60;
