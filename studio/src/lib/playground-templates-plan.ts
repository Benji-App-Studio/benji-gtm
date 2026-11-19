// Playground templates → the creative pipeline. An analysed custom template (lib/playground-templates.ts)
// is remade as a clean, brand-neutral template image: one GPT Image 2.5 job (high, 2k; via Higgsfield, or via OpenAI when picked) with
// the uploaded original as its only image, in a batch tagged settings.source = "playground-template" and
// planned here (creative-batches planFor routes it), never with the Studio's or the Playground's prompt.
// Also: rows of public.product_templates read into the contract's ProductTemplate, defensively, and
// what a template is for (its guidance) matched against the current product (templateFit).
// Plain TypeScript with relative imports, safe in the browser, on the server and in the Node tests.
import { brandRules, ruleLines } from "./brand-rules";
import { ASPECTS, cleanMustAvoid, DEFAULT_REQUEST, jobCost, totals, type Aspect, type BatchRequest, type ImageQuality, type ImageResolution, type Plan, type PlannedJob } from "./creative-plan";
import { forProvider, normalizeImageProvider, type ImageProvider } from "./image-provider";
import { isHttpsUrl, PLAYGROUND_MODEL, RUNNER_MAX_IMAGES, type PlaygroundVariant } from "./playground-plan";
import {
  TEMPLATE_FITS, TEMPLATE_SOURCE, type ImportGroup, type ProductFitKind, type ProductTemplate, type TemplateAnalysis, type TemplateField, type TemplateFit, type TemplateGuidance,
  type TemplateKind, type TemplateStatus,
} from "./playground-templates";

/** What a remake batch keeps in creative_batches.settings.template. */
export interface TemplateRemakeSettings {
  templateId: string;
  name: string;
  /** The uploaded original (public https), the job's only image. */
  sourceUrl: string;
  aspect: Aspect;
  /** The original's brands, product names, handles and seals (analysis.brands): never in the result. */
  mustAvoid: string[];
  options: { quality: ImageQuality; resolution: ImageResolution; variant: PlaygroundVariant };
  /** Who makes it: Higgsfield (default) or OpenAI, GPT Image 2.5 either way (lib/image-provider.ts). */
  provider?: ImageProvider;
  /** The text slots the read found, so the remake sets each one word for word instead of guessing at a blurry original. */
  text?: { label: string; example: string }[];
}

export const TEMPLATE_REMAKE_OPTIONS: TemplateRemakeSettings["options"] = { quality: "high", resolution: "2k", variant: "flare" };

/** The remake instruction, word for word; the must-avoid line follows it. */
export const TEMPLATE_REMAKE_PROMPT =
  "Recreate the reference image as a clean, high-resolution ad template: exactly the same layout, composition, proportions, typography style and weights, colours, icon style, lighting and background. " +
  "Sharp detail, perfectly legible text. " +
  "Replace every brand name, logo, wordmark and product label with a neutral unbranded placeholder reading \"BRAND\"; keep the product's shape and colour. " +
  "If (and only if) the reference shows certification seals, replace them with plain generic circular badges. " +
  "Keep people realistic but not identifiable copies. " +
  "Keep the on-image text, swapping brand names for BRAND. " +
  "Do not add anything that isn't in the reference.";

/**
 * A remake is brand-neutral by design (lib/brand-rules.ts `neutral`): no look, voice, offers or claims,
 * only the original's names to leave out ("BRAND", the placeholder, is allowed), which QA checks too (Plan.qa).
 */
const remakeRules = (mustAvoid: string[]) => brandRules({ appName: "" }, { neutral: true, mustAvoid: cleanMustAvoid(mustAvoid).filter((b) => b.toLowerCase() !== "brand") });

/** The exact prompt Higgsfield gets for a remake. */
export function templateRemakePrompt(mustAvoid: string[], text: { label: string; example: string }[] = []): string {
  return [TEMPLATE_REMAKE_PROMPT, remakeTextLines(text), ruleLines(remakeRules(mustAvoid)).mustAvoid].filter(Boolean).join("\n");
}

/**
 * The on-image text to set, word for word, slot by slot (a small or blurry original is otherwise
 * guessed at, and comes back as garbled letters). Slots the read couldn't make out are left to the reference.
 */
export function remakeTextLines(text: { label: string; example: string }[]): string {
  const lines = text
    .map((t) => ({ label: t.label.replace(/\s*\((partially )?illegible\)\s*/gi, "").trim(), example: t.example.trim() }))
    .filter((t) => t.example && !/\[illegible\]/i.test(t.example))
    .slice(0, 16)
    .map((t) => `- ${t.label.slice(0, 60)}: "${t.example.replace(/\s*\n\s*/g, " ").slice(0, 220)}"`);
  return lines.length ? `Set this text exactly, each in its place in the reference, crisp and correctly spelled:\n${lines.join("\n")}` : "";
}

/** What a remake costs and its one job (the confirm dialog shows this; createBatch runs it). */
export function planTemplateRemake(settings: TemplateRemakeSettings): Plan {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isHttpsUrl(settings.sourceUrl)) errors.push("The uploaded image is missing; upload it again.");
  const aspect: Aspect = ASPECTS.includes(settings.aspect) ? settings.aspect : "4:5";
  const provider = normalizeImageProvider(settings.provider);
  if (aspect === "4:5" && provider === "higgsfield") warnings.push("On the Higgsfield API, 4:5 is made in 3:4 (Meta trims it to 4:5); the desktop runner makes 4:5.");
  const images = isHttpsUrl(settings.sourceUrl) ? [settings.sourceUrl] : [];
  const params: Record<string, unknown> = {
    aspect_ratio: aspect, resolution: TEMPLATE_REMAKE_OPTIONS.resolution, quality: TEMPLATE_REMAKE_OPTIONS.quality, variant: TEMPLATE_REMAKE_OPTIONS.variant, use_screenshots: false,
    ...(images.length ? { image_refs: images, style_refs: images } : {}),
  };
  const job: PlannedJob = forProvider({
    kind: "image", model: PLAYGROUND_MODEL, prompt: templateRemakePrompt(settings.mustAvoid, settings.text), params, aspect, variant: 1,
    backend: images.length > RUNNER_MAX_IMAGES ? "api" : "auto", costEstimate: jobCost(PLAYGROUND_MODEL, params),
  }, provider);
  return { ...totals([job]), warnings, errors, qa: remakeRules(settings.mustAvoid).qa };
}

/** Why a template can't be remade now, or null. */
export function remakeProblem(t: Pick<ProductTemplate, "kind" | "status" | "sourceUrl" | "analysis">): string | null {
  if (t.kind !== "custom") return "Starters are ready as they are.";
  if (t.status === "analyzing") return "It's still being read; try again in a moment.";
  if (t.status === "generating") return "It's already being made.";
  if (t.status === "ready") return "It's already made. Upload the ad again for a new version.";
  if (!t.analysis) return "It hasn't been read yet.";
  if (!isHttpsUrl(t.sourceUrl)) return "The uploaded image is missing; upload it again.";
  return null;
}

/** The remake's settings for a template (call remakeProblem first), made by `provider` (Higgsfield unless given). */
export function templateRemakeSettings(t: Pick<ProductTemplate, "id" | "name" | "sourceUrl" | "analysis">, provider?: unknown): TemplateRemakeSettings {
  return {
    provider: normalizeImageProvider(provider),
    templateId: t.id,
    name: t.name.slice(0, 120),
    sourceUrl: t.sourceUrl ?? "",
    aspect: t.analysis && ASPECTS.includes(t.analysis.aspect) ? t.analysis.aspect : "4:5",
    mustAvoid: cleanMustAvoid(t.analysis?.brands ?? []).filter((b) => b.toLowerCase() !== "brand"),
    options: { ...TEMPLATE_REMAKE_OPTIONS },
    text: (t.analysis?.fields ?? []).map((f) => ({ label: f.label, example: f.example })),
  };
}

/** The batch the creative pipeline runs for a remake (createBatch plans it with planTemplateRemake). */
export function templateRemakeRequest(settings: TemplateRemakeSettings): BatchRequest {
  return {
    ...DEFAULT_REQUEST,
    brief: `Template remake: ${settings.name}`,
    kinds: ["image"],
    variants: 1,
    aspects: [settings.aspect],
    placements: [],
    format: "single",
    image: { model: PLAYGROUND_MODEL, quality: settings.options.quality, resolution: settings.options.resolution, useScreenshots: false, provider: normalizeImageProvider(settings.provider) },
    reddit: [],
    tweets: [],
    mustAvoid: settings.mustAvoid,
    styleReferences: [settings.sourceUrl],
    productReferences: [],
    referencesInBrief: true,
    useProfile: false,
    source: TEMPLATE_SOURCE,
    template: settings,
  };
}

/** A saved batch's remake settings, or null if it isn't a template remake. */
export function templateRemakeFromSettings(settings: unknown): TemplateRemakeSettings | null {
  const s = (settings ?? {}) as { source?: unknown; template?: Partial<TemplateRemakeSettings> };
  if (s.source !== TEMPLATE_SOURCE || !s.template || typeof s.template.templateId !== "string") return null;
  const t = s.template;
  return {
    templateId: t.templateId!, name: typeof t.name === "string" ? t.name : "", sourceUrl: isHttpsUrl(t.sourceUrl) ? t.sourceUrl : "",
    aspect: ASPECTS.includes(t.aspect as Aspect) ? t.aspect! : "4:5", mustAvoid: cleanMustAvoid(t.mustAvoid), options: { ...TEMPLATE_REMAKE_OPTIONS }, provider: normalizeImageProvider(t.provider),
    ...(Array.isArray(t.text) ? { text: t.text.filter((x) => x && typeof x.label === "string" && typeof x.example === "string").slice(0, 16).map((x) => ({ label: x.label.slice(0, 80), example: x.example.slice(0, 400) })) } : {}),
  };
}

// MARK: Rows

export const TEMPLATE_COLUMNS = "id, product_id, kind, starter_id, name, status, source_url, source_path, template_url, template_path, thumb_url, analysis, batch_id, error, imported_from_product_id, created_at, updated_at";

export interface TemplateRow {
  id: string; product_id: string; kind: TemplateKind; starter_id: string | null; name: string; status: TemplateStatus;
  source_url: string | null; source_path: string | null; template_url: string | null; template_path: string | null; thumb_url: string | null;
  analysis: unknown; batch_id: string | null; error: string | null; imported_from_product_id: string | null; created_at: string; updated_at: string;
}

const STATUSES: TemplateStatus[] = ["analyzing", "analyzed", "generating", "ready", "failed"];
const GROUPS: TemplateAnalysis["group"][] = ["social", "proof", "hero"];
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** A stored analysis (jsonb) read defensively; null when there's none or it isn't one. */
export function normalizeTemplateAnalysis(raw: unknown): TemplateAnalysis | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  const fields: TemplateField[] = (Array.isArray(a.fields) ? a.fields : []).filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === "object").slice(0, 12).map((f, i) => ({
    key: text(f.key, 40) || `text_${i + 1}`,
    label: text(f.label, 60) || `Text ${i + 1}`,
    example: text(f.example, 400),
    maxLength: Math.min(220, Math.max(12, Math.round(Number(f.maxLength)) || 12)),
    multiline: f.multiline === true,
    sensitive: f.sensitive === true,
  }));
  return {
    name: text(a.name, 60),
    tagline: text(a.tagline, 240),
    layout: text(a.layout, 900),
    aspect: ASPECTS.includes(a.aspect as Aspect) ? (a.aspect as Aspect) : "4:5",
    fields,
    brands: cleanMustAvoid(a.brands),
    productSlot: text(a.productSlot, 160),
    hasPeople: a.hasPeople === true,
    group: GROUPS.includes(a.group as TemplateAnalysis["group"]) ? (a.group as TemplateAnalysis["group"]) : "hero",
    ...normalizeGuidance(a),
  };
}

/**
 * A product_templates row as the contract's ProductTemplate. `productNames` (id → name, the person's
 * products) names the product an imported template came from; without it, or once that product is gone, null.
 */
export function templateFromRow(row: TemplateRow, productNames?: ReadonlyMap<string, string>): ProductTemplate {
  return {
    id: row.id,
    productId: row.product_id,
    kind: row.kind === "starter" ? "starter" : "custom",
    starterId: row.starter_id,
    name: row.name,
    status: STATUSES.includes(row.status) ? row.status : "failed",
    sourceUrl: row.source_url,
    templateUrl: row.template_url,
    thumbUrl: row.thumb_url,
    analysis: normalizeTemplateAnalysis(row.analysis),
    batchId: row.batch_id,
    error: row.error,
    createdAt: row.created_at,
    importedFrom: (row.imported_from_product_id && productNames?.get(row.imported_from_product_id)) || null,
  };
}

// MARK: What it's for
// Every template says what it's for (TemplateGuidance) so the person can tell if it suits their product
// before using it. The fit line compares its `fits` with what the product is; it never blocks.

export const GUIDANCE_LIMITS = { bestFor: 240, angle: 40, adaptTip: 240 };
const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max).trim() : "");

/** Known kinds only, once each, in TEMPLATE_FITS order. */
export function cleanFits(raw: unknown): TemplateFit[] {
  const given = new Set((Array.isArray(raw) ? raw : []).map((v) => (typeof v === "string" ? v.trim().toLowerCase() : "")));
  return TEMPLATE_FITS.filter((f) => given.has(f));
}

/** A stored guidance read defensively: one-line text, clipped; only the parts that are there. */
export function normalizeGuidance(raw: Record<string, unknown>): TemplateGuidance {
  const bestFor = line(raw.bestFor, GUIDANCE_LIMITS.bestFor);
  const angle = line(raw.angle, GUIDANCE_LIMITS.angle).toLowerCase();
  const fits = cleanFits(raw.fits);
  const adaptTip = line(raw.adaptTip, GUIDANCE_LIMITS.adaptTip);
  return { ...(bestFor ? { bestFor } : {}), ...(angle ? { angle } : {}), ...(fits.length ? { fits } : {}), ...(adaptTip ? { adaptTip } : {}) };
}

export const FIT_LABEL: Record<TemplateFit, string> = { physical: "Physical", app: "App", service: "Service", offer: "Offer" };
const FIT_PLURAL: Record<TemplateFit, string> = { physical: "physical products", app: "apps", service: "services", offer: "offers" };
const KIND_PHRASE: Record<ProductFitKind, string> = { physical: "a physical product", app: "an app", service: "a service" };
const upperFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** An angle as a label: "price comparison" → "Price comparison". */
export const angleLabel = (angle: string | undefined) => upperFirst((angle ?? "").trim());
const andList = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** A Library card's caption: "Price comparison · Physical, Offer"; null when the template has no guidance. */
export function guidanceCaption(g: TemplateGuidance | null | undefined): string | null {
  const parts = [angleLabel(g?.angle), (g?.fits ?? []).map((f) => FIT_LABEL[f]).join(", ")].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** What the client knows about the product: its kind (Product page), brand kit and image kinds (Product images). */
export interface ProductSignals {
  /** products.kind (lib/db.ts ProductKind). */
  kind?: string | null;
  appStoreUrl?: string | null;
  /** How many app screenshots the brand kit has. */
  screenshots?: number;
  /** The product images' kinds (lib/product-assets.ts AssetKind). */
  imageKinds?: (string | null | undefined)[];
}

const KIND_FIT: Record<string, ProductFitKind> = {
  mobile_app: "app", saas: "app",
  physical_product: "physical", clothing: "physical", food_beverage: "physical",
  restaurant: "service", local_service: "service", creator_education: "service",
};

/**
 * What the product is, for the fit line: the kind picked on the Product page; failing that ("other" or
 * missing), an App Store link or app screenshots mean an app, and product or packaging photos (more of
 * them than app screens) a physical product. Null when nothing says.
 */
export function productKindOf(s: ProductSignals): ProductFitKind | null {
  const picked = s.kind ? KIND_FIT[s.kind] : undefined;
  if (picked) return picked;
  if (s.appStoreUrl || (s.screenshots ?? 0) > 0) return "app";
  const kinds = s.imageKinds ?? [];
  const screens = kinds.filter((k) => k === "app_screen").length;
  const goods = kinds.filter((k) => k === "product" || k === "packaging").length;
  if (goods > screens) return "physical";
  if (screens > 0) return "app";
  return null;
}

export type TemplateFitResult =
  | { fit: "good"; kind: ProductFitKind; text: string }
  | { fit: "adapt"; kind: ProductFitKind; text: string; tip: string };

/**
 * The fit line for this template and this product: "Good fit for <Product>" when its fits include the
 * product's kind, otherwise "Built for <fits>; <Product> is <kind>." with the template's adapt tip.
 * Null when there's nothing to compare (no fits, or the product's kind isn't known). Never a block.
 */
export function templateFit(template: TemplateGuidance | null | undefined, productKind: ProductFitKind | null, productName = ""): TemplateFitResult | null {
  const fits = template?.fits ?? [];
  if (!fits.length || !productKind) return null;
  const name = productName.trim() || "Your product";
  if (fits.includes(productKind)) return { fit: "good", kind: productKind, text: `Good fit for ${name}` };
  return {
    fit: "adapt", kind: productKind,
    text: `Built for ${andList(fits.map((f) => FIT_PLURAL[f]))}; ${name} is ${KIND_PHRASE[productKind]}.`,
    tip: template?.adaptTip?.trim() || "It can still work: swap in your own images and words.",
  };
}

// MARK: Importing from another product
// A ready template of another of the person's products, brought into this one. A starter is added as
// usual. A custom template's image is already brand-neutral (the remake took its brand out), so the copy
// is a new row pointing at the same public files: no new image, no credits. Files are never copied, so a
// file is deleted only once no template row uses it any more (filesToRemove).

/** Why this row can't be imported into `productId`, or null. */
export function importProblem(source: Pick<TemplateRow, "kind" | "status" | "product_id" | "starter_id" | "template_url">, productId: string): string | null {
  if (source.product_id === productId) return "It's already in this product's Library.";
  if (source.status !== "ready") return "Only ready templates can be imported.";
  if (source.kind === "starter") return source.starter_id ? null : "That starter is missing its style.";
  if (!isHttpsUrl(source.template_url)) return "That template has no image yet.";
  return null;
}

/** This product's copy of `source` if it already has one: the same starter, or a custom row with the same template image. */
export function findImported<T extends Pick<TemplateRow, "kind" | "starter_id" | "template_url" | "template_path">>(
  source: Pick<TemplateRow, "kind" | "starter_id" | "template_url" | "template_path">, current: T[],
): T | undefined {
  if (source.kind === "starter") return current.find((r) => r.kind === "starter" && r.starter_id === source.starter_id);
  return current.find((r) => r.kind === "custom" && (
    (Boolean(source.template_path) && r.template_path === source.template_path) || (Boolean(source.template_url) && r.template_url === source.template_url)
  ));
}

/** The new row for a custom template copied into `productId` (call importProblem first). */
export function importedRow(source: TemplateRow, productId: string) {
  return {
    product_id: productId, kind: "custom" as const, starter_id: null, name: source.name.slice(0, TEMPLATE_NAME_MAX) || "Imported template", status: "ready" as const,
    source_url: source.source_url, source_path: source.source_path, template_url: source.template_url, template_path: source.template_path, thumb_url: source.thumb_url,
    analysis: source.analysis, batch_id: null, error: null, imported_from_product_id: source.product_id,
  };
}

/**
 * The picker's list: each of the person's other products (in the order given) with its ready templates,
 * newest first, each marked when this product already has it. Products with none are left out.
 */
export function importGroups(products: { id: string; name: string }[], rows: TemplateRow[], productId: string, current: TemplateRow[]): ImportGroup[] {
  const names = new Map(products.map((p) => [p.id, p.name]));
  return products.filter((p) => p.id !== productId).map((p) => ({
    productId: p.id,
    productName: p.name,
    templates: rows
      .filter((r) => r.product_id === p.id && !importProblem(r, productId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => ({ ...templateFromRow(r, names), added: Boolean(findImported(r, current)) })),
  })).filter((g) => g.templates.length > 0);
}

/**
 * Which of a deleted template's files can go: its uploaded original (`source`) and remade image
 * (`template`), each only if no other template row (another product's copy, or the original a copy came
 * from) still points at it.
 */
export function filesToRemove(row: Pick<TemplateRow, "id" | "source_path" | "template_path">, others: Pick<TemplateRow, "id" | "source_path" | "template_path">[]): { source: boolean; template: boolean } {
  const rest = others.filter((o) => o.id !== row.id);
  const used = (path: string | null) => Boolean(path) && rest.some((o) => o.source_path === path || o.template_path === path);
  return { source: Boolean(row.source_path) && !used(row.source_path), template: Boolean(row.template_path) && !used(row.template_path) };
}

// MARK: Validation (the templates API's checks, here so the Node tests cover them)

export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const TEMPLATE_UPLOAD_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const TEMPLATE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const TEMPLATE_NAME_MAX = 80;

/** The real type of an image from its first bytes (the browser's content type is only a claim). */
export function sniffTemplateImage(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  const sig = (offset: number, ascii: string) => ascii.split("").every((ch, i) => bytes[offset + i] === ch.charCodeAt(0));
  if (bytes.length >= 8 && bytes[0] === 0x89 && sig(1, "PNG") && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && sig(0, "RIFF") && sig(8, "WEBP")) return "image/webp";
  return null;
}

/** Why an uploaded file can't be a template (PNG, JPEG or WebP, at most 10 MB, really that type), or null. */
export function templateUploadProblem(file: { type: string; size: number }, head?: Uint8Array): string | null {
  if (!TEMPLATE_UPLOAD_TYPES[file.type]) return "Use a PNG, JPEG or WebP image.";
  if (!(file.size > 0)) return "That file is empty.";
  if (file.size > TEMPLATE_UPLOAD_MAX_BYTES) return "Keep the image under 10 MB.";
  if (head && sniffTemplateImage(head) !== file.type) return "That file isn't a PNG, JPEG or WebP image.";
  return null;
}

/** A new name, cleaned: one line, 1 to TEMPLATE_NAME_MAX characters. */
export function cleanTemplateName(raw: unknown): { name: string } | { error: string } {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!name) return { error: "Give it a name." };
  if (name.length > TEMPLATE_NAME_MAX) return { error: `Keep the name under ${TEMPLATE_NAME_MAX} characters.` };
  return { name };
}

/** What a remake costs as the confirmed price, or undefined when it wasn't confirmed (a finite, non-negative number). */
export const confirmedCreditsOf = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
