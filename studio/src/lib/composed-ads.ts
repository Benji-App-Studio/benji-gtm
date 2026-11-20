// Composed ads: the /static-ads-paper method in the Studio. The image model makes a text-free plate
// (the scene and the product, with the copy zones left empty); then the words are set on it in the
// brand's own fonts (lib/server/compose.ts), so they're spelled right, sized to mobile floors and
// editable afterwards for free. Each ratio has its own layout (never a crop of another): 4:5 and 1:1
// inside a feed margin, 9:16 re-laid out inside Meta's safe zone (meta-formats.ts: 14%–65% of the
// height, 6% sides) with bigger type. The same copy and layout family go to every ratio of a batch.
// Each canvas also has a logo slot (our real logo file, placed after) and a product box, where the
// product's real cut-out can be composited instead of the model drawing it.
// Pure TypeScript: layouts, copy, the plate prompt, the text fitting (given a measure function) and
// where the logo and the product go.

import { PLACEMENTS, type Aspect } from "./meta-formats";
import { fill, m } from "./i18n/translate";

export type TextRole = "eyebrow" | "headline" | "subhead" | "offer" | "cta" | "legal";
export type FontUse = "headline" | "body" | "legal";

/** The words of one composed ad. Only the headline is required. */
export interface ComposedCopy {
  eyebrow?: string;
  headline: string;
  subhead?: string;
  /** One of the brand system's offers, word for word. */
  offer?: string;
  cta?: string;
  legal?: string;
}

/** "Use the real product": the product image's transparent cut-out (product_assets.cutout_url) and its label. */
export interface ComposedProduct { url: string; label?: string }
export function cleanComposedProduct(raw: unknown): ComposedProduct | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const url = typeof r.url === "string" && /^https:\/\/\S+$/i.test(r.url) && r.url.length <= 2000 ? r.url : null;
  if (!url) return null;
  const label = typeof r.label === "string" ? r.label.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  return { url, ...(label ? { label } : {}) };
}

export const COPY_LIMITS: Record<TextRole, number> = { eyebrow: 40, headline: 90, subhead: 140, offer: 60, cta: 28, legal: 220 };

/** [left, top, right, bottom] as fractions of the canvas. */
export type Box = [number, number, number, number];

export interface TextSlot {
  role: TextRole;
  box: Box;
  align: "left" | "center" | "right";
  valign: "top" | "center" | "bottom";
  /** Pixels at the canvas width of 1080. */
  size: number;
  font: FontUse;
  lineHeight: number;
  uppercase?: boolean;
  /** Letter spacing in em. */
  tracking?: number;
  maxLines: number;
  /** A filled pill behind the text (CTA buttons, offer badges). */
  pill?: "accent" | "ink";
}

export interface CanvasLayout {
  width: number;
  height: number;
  /** Where the product sits on the plate (and where the real product cut-out goes, when the batch uses it). */
  product: Box;
  /** Where our real logo file goes when the batch places it: fitted inside the box, aligned like the copy. */
  logo: { box: Box; align: "left" | "center" };
  slots: TextSlot[];
  /** This canvas's type floors (px at 1080 wide) where they're above TYPE_FLOOR: 9:16 reads from further away. */
  floors?: Partial<Record<TextRole, number>>;
}

export interface ComposedLayout {
  id: string;
  name: string;
  description: string;
  /** What the plate's empty areas should look like (for the prompt). */
  plateNote: string;
  canvases: Partial<Record<Aspect, CanvasLayout>>;
}

/**
 * Type floors at 1080 px wide (static-ads-paper's mobile delivery): a line set smaller than this fails
 * the layout instead of shrinking further. Shorten the copy then. A canvas can raise them (`floors`).
 */
export const TYPE_FLOOR: Record<TextRole, number> = { eyebrow: 28, headline: 72, subhead: 30, offer: 34, cta: 34, legal: 20 };

/**
 * 9:16 is a re-layout, not the 4:5 shrunk: its copy is set bigger (seen full screen, at arm's length)
 * and never below a 100 px headline and 34 px body at 1080 wide.
 */
export const FLOORS_916: Partial<Record<TextRole, number>> = { headline: 100, subhead: 34, offer: 34, cta: 34 };
const SIZES_916: Record<TextRole, number> = { eyebrow: 30, headline: 112, subhead: 40, offer: 40, cta: 40, legal: 22 };

/** Feed margins (px of the 1080-wide canvas): Meta covers nothing on 4:5 and 1:1, but Instagram can crop the edges. */
export const FEED_MARGIN_PX: Partial<Record<Aspect, number>> = { "4:5": 60, "1:1": 54 };
const CANVAS_SIZE: Partial<Record<Aspect, [number, number]>> = { "4:5": [1080, 1350], "1:1": [1080, 1080], "9:16": [1080, 1920] };

/**
 * The live zone of an aspect (fractions): Meta's safe zone from meta-formats.ts where the placement has
 * one (9:16: 14% top, 35% bottom, 6% sides, so 14%–65% of the height), else the feed margin.
 */
export function liveZone(aspect: Aspect): Box | null {
  const placement = PLACEMENTS.find((p) => p.aspect === aspect && p.safe);
  if (placement?.safe) { const s = placement.safe; return [s.sides, s.top, 1 - s.sides, 1 - s.bottom]; }
  const margin = FEED_MARGIN_PX[aspect], size = CANVAS_SIZE[aspect];
  if (margin === undefined || !size) return null;
  return [margin / size[0], margin / size[1], 1 - margin / size[0], 1 - margin / size[1]];
}

/** Where every slot, the logo and the product must stay, per aspect. */
export const SAFE: Partial<Record<Aspect, { live: Box }>> = Object.fromEntries(
  (["4:5", "1:1", "9:16"] as Aspect[]).map((a) => [a, { live: liveZone(a)! }]),
);

const slot = (role: TextRole, box: Box, o: Partial<TextSlot> = {}): TextSlot => ({
  role, box, align: "center", valign: "center",
  size: { eyebrow: 30, headline: 92, subhead: 36, offer: 38, cta: 38, legal: 22 }[role],
  font: role === "headline" ? "headline" : role === "legal" ? "legal" : "body",
  lineHeight: role === "headline" ? 1.06 : 1.2,
  maxLines: { eyebrow: 1, headline: 3, subhead: 2, offer: 2, cta: 1, legal: 2 }[role],
  ...(role === "eyebrow" ? { uppercase: true, tracking: 0.08 } : {}),
  ...(role === "cta" ? { pill: "ink" as const } : {}),
  ...(role === "offer" ? { pill: "accent" as const } : {}),
  ...o,
});
/** A 9:16 slot: the bigger 9:16 sizes. */
const tall = (role: TextRole, box: Box, o: Partial<TextSlot> = {}) => slot(role, box, { size: SIZES_916[role], ...o });
const logoAt = (box: Box, align: "left" | "center" = "center") => ({ box, align });

export const LAYOUTS: ComposedLayout[] = [
  {
    id: "headline-top", name: m("Headline on top"),
    description: m("A big headline over the product, the CTA under it: the most common static ad."),
    plateNote: "a calm, even background in the top third and along the bottom edge",
    canvases: {
      "4:5": { width: 1080, height: 1350, product: [0.18, 0.37, 0.82, 0.8], logo: logoAt([0.4, 0.045, 0.6, 0.088]), slots: [
        slot("eyebrow", [0.1, 0.092, 0.9, 0.12]), slot("headline", [0.08, 0.122, 0.92, 0.297]), slot("subhead", [0.12, 0.297, 0.88, 0.357]),
        slot("offer", [0.6, 0.37, 0.94, 0.47]), slot("cta", [0.2, 0.825, 0.8, 0.885]), slot("legal", [0.07, 0.905, 0.93, 0.955]),
      ] },
      "1:1": { width: 1080, height: 1080, product: [0.24, 0.37, 0.76, 0.8], logo: logoAt([0.4, 0.05, 0.6, 0.095]), slots: [
        slot("eyebrow", [0.1, 0.1, 0.9, 0.135]), slot("headline", [0.08, 0.138, 0.92, 0.29], { size: 84, maxLines: 2 }), slot("subhead", [0.12, 0.29, 0.88, 0.355]),
        slot("offer", [0.6, 0.37, 0.95, 0.48]), slot("cta", [0.2, 0.82, 0.8, 0.885]), slot("legal", [0.07, 0.9, 0.93, 0.95]),
      ] },
      "9:16": { width: 1080, height: 1920, product: [0.22, 0.415, 0.78, 0.556], logo: logoAt([0.4, 0.142, 0.6, 0.168]), floors: FLOORS_916, slots: [
        tall("eyebrow", [0.08, 0.17, 0.92, 0.19]), tall("headline", [0.08, 0.192, 0.92, 0.36]), tall("subhead", [0.08, 0.362, 0.92, 0.41]),
        tall("offer", [0.56, 0.414, 0.94, 0.5]), tall("cta", [0.14, 0.562, 0.86, 0.606]), tall("legal", [0.08, 0.61, 0.92, 0.648]),
      ] },
    },
  },
  {
    id: "side-headline", name: m("Headline beside the product"),
    description: m("Copy on the left, the product on the right (stacked in 9:16): editorial, calm."),
    plateNote: "a calm, even background over the whole left half (in 9:16, the top third)",
    canvases: {
      "4:5": { width: 1080, height: 1350, product: [0.5, 0.12, 0.94, 0.86], logo: logoAt([0.07, 0.06, 0.32, 0.1], "left"), slots: [
        slot("eyebrow", [0.07, 0.14, 0.5, 0.17], { align: "left" }), slot("headline", [0.07, 0.18, 0.5, 0.52], { align: "left", valign: "top", size: 84, maxLines: 4 }),
        slot("subhead", [0.07, 0.53, 0.48, 0.64], { align: "left", valign: "top", maxLines: 3 }), slot("offer", [0.07, 0.645, 0.48, 0.73], { align: "left" }),
        slot("cta", [0.07, 0.74, 0.49, 0.8], { align: "left" }), slot("legal", [0.07, 0.905, 0.93, 0.955], { align: "left" }),
      ] },
      "1:1": { width: 1080, height: 1080, product: [0.5, 0.1, 0.95, 0.9], logo: logoAt([0.07, 0.055, 0.32, 0.1], "left"), slots: [
        slot("eyebrow", [0.07, 0.12, 0.5, 0.16], { align: "left" }), slot("headline", [0.07, 0.17, 0.5, 0.52], { align: "left", valign: "top", size: 80, maxLines: 4 }),
        slot("subhead", [0.07, 0.53, 0.48, 0.65], { align: "left", valign: "top", maxLines: 3 }), slot("offer", [0.07, 0.655, 0.48, 0.755], { align: "left" }),
        slot("cta", [0.07, 0.76, 0.49, 0.83], { align: "left" }), slot("legal", [0.07, 0.9, 0.93, 0.95], { align: "left" }),
      ] },
      "9:16": { width: 1080, height: 1920, product: [0.3, 0.462, 0.92, 0.556], logo: logoAt([0.08, 0.142, 0.34, 0.168], "left"), floors: FLOORS_916, slots: [
        tall("eyebrow", [0.08, 0.17, 0.92, 0.19], { align: "left" }), tall("headline", [0.08, 0.192, 0.92, 0.36], { align: "left", valign: "top" }),
        tall("subhead", [0.08, 0.362, 0.92, 0.41], { align: "left", valign: "top" }), tall("offer", [0.08, 0.414, 0.6, 0.458], { align: "left" }),
        tall("cta", [0.08, 0.562, 0.72, 0.606], { align: "left" }), tall("legal", [0.08, 0.61, 0.92, 0.648], { align: "left" }),
      ] },
    },
  },
  {
    id: "offer-badge", name: m("Offer badge"),
    description: m("Headline, the product with one of your offers as a badge beside it, the CTA under it."),
    plateNote: "a calm, even background in the top third, beside the product and along the bottom edge",
    canvases: {
      "4:5": { width: 1080, height: 1350, product: [0.16, 0.34, 0.7, 0.8], logo: logoAt([0.4, 0.045, 0.6, 0.088]), slots: [
        slot("headline", [0.08, 0.092, 0.92, 0.267]), slot("subhead", [0.12, 0.267, 0.88, 0.327]),
        slot("offer", [0.6, 0.4, 0.94, 0.52], { size: 40, pill: "accent" }), slot("cta", [0.2, 0.83, 0.8, 0.89]), slot("legal", [0.07, 0.905, 0.93, 0.955]),
      ] },
      "1:1": { width: 1080, height: 1080, product: [0.18, 0.35, 0.68, 0.8], logo: logoAt([0.4, 0.05, 0.6, 0.095]), slots: [
        slot("headline", [0.08, 0.1, 0.92, 0.27], { size: 84, maxLines: 2 }), slot("subhead", [0.12, 0.27, 0.88, 0.335]),
        slot("offer", [0.6, 0.42, 0.95, 0.54], { size: 40 }), slot("cta", [0.2, 0.825, 0.8, 0.89]), slot("legal", [0.07, 0.9, 0.93, 0.95]),
      ] },
      "9:16": { width: 1080, height: 1920, product: [0.08, 0.398, 0.6, 0.556], logo: logoAt([0.4, 0.142, 0.6, 0.168]), floors: FLOORS_916, slots: [
        tall("headline", [0.08, 0.172, 0.92, 0.34]), tall("subhead", [0.08, 0.342, 0.92, 0.39]),
        tall("offer", [0.56, 0.43, 0.94, 0.53], { size: 44 }), tall("cta", [0.14, 0.562, 0.86, 0.606]), tall("legal", [0.08, 0.61, 0.92, 0.648]),
      ] },
    },
  },
];

const EPS = 1e-6;
const inside = ([l, t, r, b]: Box, [L, T, R, B]: Box) => l >= L - EPS && t >= T - EPS && r <= R + EPS && b <= B + EPS;
const overlaps = ([l, t, r, b]: Box, [ol, ot, or, ob]: Box) => l < or - EPS && ol < r - EPS && t < ob - EPS && ot < b - EPS;

/**
 * What breaks a layout's safe zones (empty when it's safe): a slot, the logo or the product box outside
 * the aspect's live zone (liveZone: Meta's for 9:16, the feed margin for 4:5 and 1:1), slots overlapping
 * each other or the logo, and the product box under any copy but the offer badge (which may sit on it).
 */
export function unsafeSlots(layout: ComposedLayout): string[] {
  const out: string[] = [];
  for (const [aspect, canvas] of Object.entries(layout.canvases) as [Aspect, CanvasLayout][]) {
    const zone = SAFE[aspect];
    if (!zone) continue;
    const at = `${layout.id} ${aspect}`;
    if (!inside(canvas.logo.box, zone.live)) out.push(`${at} logo: outside the live zone`);
    if (!inside(canvas.product, zone.live)) out.push(`${at} product: outside the live zone`);
    if (overlaps(canvas.logo.box, canvas.product)) out.push(`${at} logo overlaps the product`);
    for (const s of canvas.slots) {
      if (!inside(s.box, zone.live)) out.push(`${at} ${s.role}: outside the live zone`);
      if (overlaps(s.box, canvas.logo.box)) out.push(`${at} ${s.role} overlaps the logo`);
      if (s.role !== "offer" && overlaps(s.box, canvas.product)) out.push(`${at} ${s.role} overlaps the product`);
      for (const o of canvas.slots) {
        if (o === s || o.role < s.role) continue;
        if (overlaps(s.box, o.box)) out.push(`${at} ${s.role} overlaps ${o.role}`);
      }
    }
  }
  return out;
}

/** A slot's type floor on a canvas (px at 1080 wide). */
export const floorOf = (canvas: Pick<CanvasLayout, "floors">, role: TextRole) => Math.max(TYPE_FLOOR[role], canvas.floors?.[role] ?? 0);

export const layoutById = (id: unknown) => LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];
export const COMPOSED_ASPECTS: Aspect[] = ["4:5", "1:1", "9:16"];

/** The copy made safe: trimmed, within limits, the headline required. Null without a headline. */
export function cleanCopy(raw: unknown): ComposedCopy | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const field = (k: TextRole) => (typeof r[k] === "string" ? (r[k] as string).replace(/\s+/g, " ").trim().slice(0, COPY_LIMITS[k]) : "");
  const headline = field("headline");
  if (!headline) return null;
  const out: ComposedCopy = { headline };
  for (const k of ["eyebrow", "subhead", "offer", "cta", "legal"] as const) if (field(k)) out[k] = field(k);
  return out;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const describe = ([l, t, r, b]: Box) => `${pct(l)}–${pct(r)} of the width and ${pct(t)}–${pct(b)} of the height`;

/**
 * The plate prompt: the scene with the product in its zone and every copy zone left as empty, even
 * background. The brand look (when there is one) opens the prompt; it always ends with no typography.
 */
export function platePrompt(o: {
  brief: string; layout: ComposedLayout; aspect: Aspect; look?: string; appName: string; productNote?: string;
  /** Our real logo is placed in the layout's logo slot afterwards: keep it empty too. */
  logo?: boolean;
  /** The product's real cut-out is composited into the product box afterwards: the model leaves it empty. */
  realProduct?: boolean;
}): string {
  const canvas = o.layout.canvases[o.aspect] ?? o.layout.canvases["4:5"]!;
  const zones = [...canvas.slots.map((s) => `${s.role} at ${describe(s.box)}`), ...(o.logo ? [`logo at ${describe(canvas.logo.box)}`] : [])];
  const product = o.realProduct
    ? `the area at ${describe(canvas.product)} is where our real product photo is placed afterwards: leave it as an empty, uncluttered surface (a tabletop, shelf or floor in the scene's light) with nothing standing on it, so the product can rest there with its own shadow. Draw no product, bottle, jar, box or packaging anywhere.`
    : `the product sits within ${describe(canvas.product)}, fully visible, at a natural, modest scale.`;
  return [
    o.look ?? "",
    `SCENE: ${o.brief.trim()}`,
    o.realProduct ? "" : o.productNote ?? "",
    `COMPOSITION (${o.aspect}): ${product} Keep ${o.layout.plateNote}: the copy${o.logo ? " and our logo are" : " is"} added afterwards in these zones, so they stay completely empty, even background with no objects, shadows or texture changes: ${zones.join("; ")}.`,
    `An advertising photograph for "${o.appName}".`,
    o.realProduct
      ? "Absolutely no typography anywhere: no words, letters, numbers, logos, watermarks, captions, UI or placeholder text, and no lines or bars that stand in for text."
      : "Absolutely no typography anywhere except the printed product packaging: no words, letters, numbers, logos, watermarks, captions, UI or placeholder text, and no lines or bars that stand in for text.",
  ].filter(Boolean).join("\n");
}

// MARK: Logo and product

export interface Rect { left: number; top: number; width: number; height: number }

/** Where the logo file goes in pixels: fitted inside the canvas's logo slot (keeping its shape), centred or left-aligned like the copy. */
export function logoRect(canvas: CanvasLayout, logoAspect: number): Rect {
  const [l, top0, r, b] = canvas.logo.box;
  const box = { left: l * canvas.width, top: top0 * canvas.height, width: (r - l) * canvas.width, height: (b - top0) * canvas.height };
  const aspect = Number.isFinite(logoAspect) && logoAspect > 0 ? logoAspect : 1;
  const width = Math.min(box.width, box.height * aspect);
  const height = width / aspect;
  const left = canvas.logo.align === "left" ? box.left : box.left + (box.width - width) / 2;
  return { left: Math.round(left), top: Math.round(box.top + (box.height - height) / 2), width: Math.round(width), height: Math.round(height) };
}

/** The real product's cut-out in the product box: fitted with a small inset, centred, resting on the box's floor. */
export interface ProductPlacement extends Rect {
  /** The soft floor shadow under it: an ellipse (centre and radii, px) and its blur. */
  shadow: { cx: number; cy: number; rx: number; ry: number; blur: number; opacity: number };
}
export function productPlacement(canvas: CanvasLayout, productAspect: number): ProductPlacement {
  const [l, t, r, b] = canvas.product;
  const inset = 0.04;
  const boxW = (r - l) * canvas.width, boxH = (b - t) * canvas.height;
  const availW = boxW * (1 - 2 * inset), availH = boxH * (1 - inset);
  const aspect = Number.isFinite(productAspect) && productAspect > 0 ? productAspect : 1;
  const width = Math.min(availW, availH * aspect);
  const height = width / aspect;
  const left = l * canvas.width + (boxW - width) / 2;
  const bottom = b * canvas.height - boxH * inset * 0.5;
  const rx = width * 0.46, ry = Math.max(6, Math.min(width * 0.07, boxH * 0.06));
  return {
    left: Math.round(left), top: Math.round(bottom - height), width: Math.round(width), height: Math.round(height),
    shadow: { cx: Math.round(left + width / 2), cy: Math.round(bottom - ry * 0.25), rx: Math.round(rx), ry: Math.round(ry), blur: Math.max(4, Math.round(ry * 0.6)), opacity: 0.32 },
  };
}

// MARK: Fitting

export type Measure = (text: string, font: FontUse, sizePx: number, tracking: number) => number;

export interface PlacedLine { text: string; x: number; width: number; top: number; baseline: number }
export interface PlacedText {
  role: TextRole;
  font: FontUse;
  size: number;
  lineHeight: number;
  align: TextSlot["align"];
  tracking: number;
  lines: PlacedLine[];
  /** The slot in pixels, and the pill's rectangle when there is one. */
  box: { left: number; top: number; width: number; height: number };
  pill?: { kind: "accent" | "ink"; left: number; top: number; width: number; height: number; radius: number };
}

export interface ComposedPlan { width: number; height: number; texts: PlacedText[]; errors: string[]; warnings: string[] }

/** Words a sentence in the reader's language (a page's or route's `t`); English by default. */
type Words = (text: string, vars?: Record<string, string | number>) => string;
const englishWords: Words = (text, vars) => fill(text, vars);
/** "headline or subhead", in the reader's language. */
const roleList = (roles: TextRole[], t: Words) => roles.map((r) => t(ROLE_LABEL[r]).toLowerCase()).reduce((all, name) => (all ? t("{a} or {b}", { a: all, b: name }) : name), "");
/**
 * The English sentences composing saves with an ad (copy.composed.warnings), so a page can put them back
 * into the reader's language (lib/stored-words.ts). The logo one is written by the compose route.
 */
export const COMPOSE_WORDS = [
  m("No {roles} in this layout: \"{text}\" isn't on the ad."),
  m("{role} set at {px} px to fit; shorter copy reads bigger."),
  m("{role} doesn't fit at the {px} px minimum: shorten \"{text}\"."),
  m("Our logo wasn't placed: {reason}"),
];
const ROLE_LABEL: Record<TextRole, string> = { eyebrow: m("Eyebrow"), headline: m("Headline"), subhead: m("Subhead"), offer: m("Offer"), cta: m("Call to action"), legal: m("Legal line") };
export const COPY_ROLES: TextRole[] = ["eyebrow", "headline", "subhead", "offer", "cta", "legal"];

/** The text roles a layout sets (on any of its canvases): the Offer badge layout has no eyebrow, for one. */
export function layoutRoles(layout: ComposedLayout): TextRole[] {
  const placed = new Set(Object.values(layout.canvases).flatMap((c) => c?.slots.map((s) => s.role) ?? []));
  return COPY_ROLES.filter((r) => placed.has(r));
}

/** The copy the layout has no slot for, which would silently not be on the ad. */
export function unplacedCopy(copy: ComposedCopy, layout: ComposedLayout): TextRole[] {
  const roles = layoutRoles(layout);
  return COPY_ROLES.filter((r) => copy[r]?.trim() && !roles.includes(r));
}

/** "The Offer badge layout has no eyebrow…": said before credits are spent and on the composed ad. */
/** `t` puts it into the reader's language (English by default). */
export function unplacedNote(layout: ComposedLayout, roles: TextRole[], t: Words = englishWords): string {
  const vars = { layout: t(layout.name), roles: roleList(roles, t) };
  return roles.length === 1
    ? t("The {layout} layout has no {roles}: it isn't on the ad. Pick a layout with one, or move the words into the subhead.", vars)
    : t("The {layout} layout has no {roles}: they aren't on the ad. Pick a layout with them, or move the words into the subhead.", vars);
}

/**
 * A rough measure for checking copy before any font is loaded (the batch form, before credits are
 * spent): 0.53 em a character for headlines, 0.5 em for the rest, a little wider than Inter on
 * mixed-case copy. It errs towards "may not fit" (a warning, not a refusal): the server measures with
 * the real font when it sets the words.
 */
export const estimateMeasure: Measure = (text, font, size, tracking) => {
  const chars = Array.from(text);
  // Chinese, Japanese and Korean characters are set on a square: a full em each.
  const wide = chars.filter((ch) => WIDE.test(ch)).length;
  return (chars.length - wide) * size * (font === "headline" ? 0.53 : 0.5) + wide * size + Math.max(0, chars.length - 1) * tracking * size;
};

// MARK: Chinese, Japanese and Korean

/** A character set on a full-width square: Han, kana, Hangul and CJK punctuation and full-width forms. */
const WIDE = /[ᄀ-ᇿ⺀-⿟　-〿぀-ヿ㄀-ㇿ㈀-䶿一-鿿가-힯豈-﫿︰-﹏＀-￯]|[\u{20000}-\u{3134f}]/u;
/** Characters a line may break between, one at a time: Han and kana (Chinese and Japanese have no spaces). Korean keeps its words. */
const BREAKS_ANYWHERE = /[⺀-⿟぀-ヿ㄀-ㇿ㐀-䶿一-鿿豈-﫿]|[\u{20000}-\u{3134f}]/u;
/** Never at the start of a line (closing punctuation, small kana, the long-vowel mark): they stay with what comes before. */
const NO_LINE_START = /[、。，．,.!?！？：；:;」』）〕］｝〉》】〗〙〛”’)\]}ーゝゞヽヾぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ・…‥％%]/u;
/** Never at the end of a line (opening brackets and quotes): they stay with what comes after. */
const NO_LINE_END = /[「『（〔［｛〈《【〖〘〚“‘([{]/u;

/** Whether the text has any Chinese, Japanese or Korean in it. */
export const hasCjk = (text: string) => WIDE.test(text);

/**
 * The pieces a line may break between: whole words where there are spaces (English, Korean), single
 * characters inside Chinese and Japanese, with each language's line-start and line-end rules kept (no
 * line begins with 。 or 」, none ends with 「). `space` says whether a space goes before the piece.
 */
export function breakUnits(text: string): { text: string; space: boolean }[] {
  const units: { text: string; space: boolean }[] = [];
  for (const [index, word] of text.split(/\s+/).filter(Boolean).entries()) {
    const pieces: string[] = [];
    if (BREAKS_ANYWHERE.test(word) && typeof Intl.Segmenter === "function") {
      // Chinese and Japanese: break between words where the dictionary knows them ("もう" stays whole), else between characters.
      const segmenter = new Intl.Segmenter(/[぀-ヿ]/.test(word) ? "ja" : "zh-Hant", { granularity: "word" });
      for (const { segment } of segmenter.segment(word)) {
        const chars = Array.from(segment);
        // A run the dictionary didn't split, longer than a word usually is, breaks between characters.
        if (chars.length > 6 && BREAKS_ANYWHERE.test(segment)) pieces.push(...chars);
        else pieces.push(segment);
      }
    } else {
      let latin = "";
      for (const ch of Array.from(word)) {
        if (BREAKS_ANYWHERE.test(ch) || (WIDE.test(ch) && (NO_LINE_START.test(ch) || NO_LINE_END.test(ch)))) {
          if (latin) { pieces.push(latin); latin = ""; }
          pieces.push(ch);
        } else latin += ch;
      }
      if (latin) pieces.push(latin);
    }
    // Glue: an opening mark joins the piece after it; a piece that may not start a line joins the one before.
    const glued: string[] = [];
    let carry = "";
    for (const piece of pieces) {
      if (Array.from(piece).length === 1 && NO_LINE_END.test(piece)) { carry += piece; continue; }
      const next = carry + piece;
      carry = "";
      if (glued.length && NO_LINE_START.test(Array.from(next)[0])) glued[glued.length - 1] += next;
      else glued.push(next);
    }
    if (carry) {
      if (glued.length) glued[glued.length - 1] += carry;
      else glued.push(carry);
    }
    glued.forEach((piece, i) => units.push({ text: piece, space: index > 0 && i === 0 }));
  }
  return units;
}

/** What may not fit in the layout at each aspect, by the rough measure: "4:5: Offer doesn't fit…". */
export function fitProblems(copy: ComposedCopy, layout: ComposedLayout, aspects: Aspect[], t: Words = englishWords): string[] {
  return aspects.flatMap((a) => {
    const canvas = layout.canvases[a];
    return canvas ? fitLayout(copy, canvas, estimateMeasure, t).errors.map((e) => `${a}: ${e}`) : [];
  });
}

/**
 * Splits `text` into runs by the font that draws them: the first in `chain` that has the character (the
 * brand font, then its CJK cut, then the symbols font: a brand font or Inter has no ★ and no 日). Spaces
 * belong to the first font, as Satori draws them; a character none has stays with the first too.
 */
export function fontRuns(text: string, chain: ((ch: string) => boolean)[]): { text: string; font: number }[] {
  const runs: { text: string; font: number }[] = [];
  for (const ch of Array.from(text)) {
    const found = /\s/.test(ch) ? 0 : chain.findIndex((has) => has(ch));
    const font = found < 0 ? 0 : found;
    const last = runs[runs.length - 1];
    if (last && last.font === font) last.text += ch;
    else runs.push({ text: ch, font });
  }
  return runs;
}

/** Greedy wrap at one size, between words, and between characters in Chinese and Japanese (breakUnits). */
function wrap(units: { text: string; space: boolean }[], maxWidth: number, width: (t: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const unit of units) {
    const next = line ? `${line}${unit.space ? " " : ""}${unit.text}` : unit.text;
    if (!line || width(next) <= maxWidth) line = next;
    else { lines.push(line); line = unit.text; }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Sets the copy into the layout: each text wrapped and shrunk until it fits its slot (never below its
 * floor); lines placed by alignment; pills sized around their text. Errors name what doesn't fit.
 */
export function fitLayout(copy: ComposedCopy, canvas: CanvasLayout, measure: Measure, t: Words = englishWords): ComposedPlan {
  const scale = canvas.width / 1080;
  const errors: string[] = [];
  const warnings: string[] = [];
  const texts: PlacedText[] = [];
  const slotted = new Set(canvas.slots.map((s) => s.role));
  const dropped = COPY_ROLES.filter((r) => copy[r]?.trim() && !slotted.has(r));
  if (dropped.length) warnings.push(t("No {roles} in this layout: \"{text}\" isn't on the ad.", { roles: roleList(dropped, t), text: copy[dropped[0]]!.slice(0, 40) }));
  for (const s of canvas.slots) {
    const raw = copy[s.role];
    if (!raw) continue;
    const text = s.uppercase ? raw.toUpperCase() : raw;
    // CJK is set square: never tightened, and with a little more leading than Latin display type.
    const cjk = hasCjk(text);
    const tracking = cjk ? Math.max(0, s.tracking ?? 0) : s.tracking ?? (s.role === "headline" ? -0.01 : 0);
    const lineHeight = cjk ? Math.max(s.lineHeight, 1.2) : s.lineHeight;
    const units = breakUnits(text);
    const [l, top0, r, b] = s.box;
    const box = { left: l * canvas.width, top: top0 * canvas.height, width: (r - l) * canvas.width, height: (b - top0) * canvas.height };
    const padX = s.pill ? 0.9 : 0, padY = s.pill ? 0.42 : 0;
    const floor = floorOf(canvas, s.role) * scale;
    let size = s.size * scale;
    let lines: string[] = [];
    let fits = false;
    for (; size >= floor - 0.01; size -= 2 * scale) {
      const innerW = box.width - 2 * padX * size;
      const width = (x: string) => measure(x, s.font, size, tracking);
      lines = wrap(units, innerW, width);
      const tall = (lines.length - 1) * size * lineHeight + size * 1.1 + 2 * padY * size;
      if (lines.length <= s.maxLines && tall <= box.height + 0.5 && lines.every((x) => width(x) <= innerW + 0.5)) {
        fits = true;
        // CJK breaks between any two characters, so a greedy wrap can leave one character alone on the
        // last line ("…不必再手 / 算。"): balance the lines instead, at the narrowest width that keeps their count.
        if (cjk && lines.length > 1) {
          let lo = innerW / 2, hi = innerW;
          for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (wrap(units, mid, width).length === lines.length) hi = mid; else lo = mid; }
          lines = wrap(units, hi, width);
        }
        break;
      }
    }
    if (!fits) {
      size = floor;
      errors.push(t("{role} doesn't fit at the {px} px minimum: shorten \"{text}\".", { role: t(ROLE_LABEL[s.role]), px: String(Math.round(floorOf(canvas, s.role))), text: `${raw.slice(0, 40)}${raw.length > 40 ? "…" : ""}` }));
    } else if (size < s.size * scale * 0.8) warnings.push(t("{role} set at {px} px to fit; shorter copy reads bigger.", { role: t(ROLE_LABEL[s.role]), px: String(Math.round(size / scale)) }));
    const widths = lines.map((x) => measure(x, s.font, size, tracking));
    const blockH = (lines.length - 1) * size * lineHeight + size * 1.1;
    const pillW = s.pill ? Math.min(box.width, Math.max(...widths) + 2 * padX * size) : 0;
    const pillH = s.pill ? blockH + 2 * padY * size : 0;
    const outerH = s.pill ? pillH : blockH;
    const top = s.valign === "top" ? box.top : s.valign === "bottom" ? box.top + box.height - outerH : box.top + (box.height - outerH) / 2;
    const textTop = top + (s.pill ? padY * size : 0);
    const pillLeft = s.align === "left" ? box.left : s.align === "right" ? box.left + box.width - pillW : box.left + (box.width - pillW) / 2;
    const placed: PlacedLine[] = lines.map((line, i) => {
      const w = widths[i];
      const x = s.pill ? pillLeft + (pillW - w) / 2 : s.align === "left" ? box.left : s.align === "right" ? box.left + box.width - w : box.left + (box.width - w) / 2;
      const lineTop = textTop + i * size * lineHeight;
      return { text: line, x, width: w, top: lineTop, baseline: lineTop + size * 0.9 };
    });
    texts.push({
      role: s.role, font: s.font, size, lineHeight, align: s.align, tracking, lines: placed, box,
      ...(s.pill ? { pill: { kind: s.pill, left: pillLeft, top, width: pillW, height: pillH, radius: pillH / 2 } } : {}),
    });
  }
  return { width: canvas.width, height: canvas.height, texts, errors, warnings };
}

// MARK: Colour

/** WCAG relative luminance of "#RRGGBB" or [r, g, b]. */
export function luminance(color: string | [number, number, number]): number {
  const [r, g, b] = typeof color === "string" ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) : color;
  const ch = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
export const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Of the candidate text colours, the one that reads best on a background of luminance `bg`. */
export function bestText(bg: number, candidates: string[]): { color: string; ratio: number } {
  return candidates.map((color) => ({ color, ratio: contrast(luminance(color), bg) })).sort((a, b) => b.ratio - a.ratio)[0];
}

/**
 * Composed-ad job params (creative_jobs.params.composed): the layout and copy, and, when the batch uses
 * them, our real logo file (placed in the logo slot) and the product's cut-out (composited in the product box).
 */
export interface ComposedParams { layout: string; copy: ComposedCopy; logo?: string; product?: string }
const httpsUrl = (v: unknown) => (typeof v === "string" && /^https:\/\/\S+$/i.test(v) && v.length <= 2000 ? v : undefined);
export function composedParam(params: Record<string, unknown> | null | undefined): ComposedParams | null {
  const c = params?.composed as Record<string, unknown> | undefined;
  const copy = cleanCopy(c?.copy);
  if (!c || !copy) return null;
  const logo = httpsUrl(c.logo), product = httpsUrl(c.product);
  return { layout: layoutById(c.layout).id, copy, ...(logo ? { logo } : {}), ...(product ? { product } : {}) };
}

/** Composed creatives that still need their copy set: made by a composed job, not composed yet, and not stopped by copy that didn't fit. */
export function pendingComposed(jobs: { id: string; params: Record<string, unknown> | null }[], creatives: { id: string; kind: string; job_id: string | null; copy: Record<string, unknown> | null }[]): string[] {
  const composing = new Set(jobs.filter((j) => composedParam(j.params)).map((j) => j.id));
  return creatives.filter((c) => c.kind === "image" && c.job_id && composing.has(c.job_id) && !c.copy?.composed && !c.copy?.composeError).map((c) => c.id);
}
