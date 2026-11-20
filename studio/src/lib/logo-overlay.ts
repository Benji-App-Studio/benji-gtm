// Our logo on image creatives. Image models can't redraw a logo faithfully (they invent a look-alike
// mark), so a creative gets our real logo two ways:
//   1. As a labelled reference image, right after the competitor's ad (Recreate), so a mark that
//      appears inside the scene (an app screen's header, say) copies ours instead of being invented.
//   2. Placed on the finished image (the Studio's "Place the real logo" and Recreate; on by default when
//      there is a logo): the exact file, composited after generation (lib/server/logo-overlay.ts) at a
//      corner inside Meta's safe area, for every image job. The prompt asks the model to leave that
//      corner clear and draw no logo of its own. Composed ads place it in their layout's logo slot.
// Plain TypeScript with no runtime APIs: the browser, the API routes and the Node tests share it.
import { placementById, type Placement, type PlacementId } from "./meta-formats";
import type { ProductAsset } from "./product-assets";
import { m } from "./i18n/translate";

export type LogoPosition = "top_left" | "top_right" | "bottom_left" | "bottom_right" | "bottom_center";
export const LOGO_POSITIONS: { id: LogoPosition; label: string; where: string }[] = [
  { id: "top_left", label: m("Top left"), where: m("top-left corner") },
  { id: "top_right", label: m("Top right"), where: m("top-right corner") },
  { id: "bottom_left", label: m("Bottom left"), where: m("bottom-left corner") },
  { id: "bottom_right", label: m("Bottom right"), where: m("bottom-right corner") },
  { id: "bottom_center", label: m("Bottom centre"), where: m("bottom centre") },
];
export const DEFAULT_LOGO_POSITION: LogoPosition = "top_left";
const isPosition = (v: unknown): v is LogoPosition => LOGO_POSITIONS.some((p) => p.id === v);
export const positionWhere = (p: LogoPosition) => LOGO_POSITIONS.find((x) => x.id === p)!.where;

/** The logo a batch uses, as the Recreate sheet chose it (BatchRequest.logo). */
export interface LogoSettings {
  url: string;
  label: string;
  /** Send it to Higgsfield as a labelled reference image (image creatives). */
  reference: boolean;
  /** Place the real file on each finished image, here; null: don't. */
  overlay: LogoPosition | null;
  /** The brief already says which attached image is the logo (Recreate): the planner adds no line of its own. */
  inBrief?: boolean;
}

/** Logo settings made safe: an https link, a short label, a known position. Null when there's no usable logo. */
export function cleanLogo(value: unknown): LogoSettings | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const url = typeof v.url === "string" && /^https:\/\/\S+$/i.test(v.url) && v.url.length <= 2000 ? v.url : null;
  if (!url) return null;
  const overlay = isPosition(v.overlay) ? v.overlay : null;
  const reference = v.reference !== false;
  if (!reference && !overlay) return null;
  return {
    url, reference, overlay,
    label: typeof v.label === "string" ? v.label.replace(/\s+/g, " ").trim().slice(0, 80) : "",
    ...(v.inBrief === true ? { inBrief: true } : {}),
  };
}

/** What an image job carries for its logo: `logo_ref` (sent to Higgsfield after the style references) and `logo_overlay` (placed afterwards). */
export interface LogoOverlayParam { url: string; position: LogoPosition; placement?: PlacementId }
export function logoParams(logo: LogoSettings | null | undefined, placement?: PlacementId): Record<string, unknown> {
  if (!logo) return {};
  return {
    ...(logo.reference ? { logo_ref: logo.url } : {}),
    ...(logo.overlay ? { logo_overlay: { url: logo.url, position: logo.overlay, ...(placement ? { placement } : {}) } satisfies LogoOverlayParam } : {}),
  };
}

/** A job's `logo_overlay` param, checked; null when the job doesn't place a logo. */
export function overlayParam(params: Record<string, unknown> | null | undefined): LogoOverlayParam | null {
  const v = params?.logo_overlay as Record<string, unknown> | undefined;
  if (!v || typeof v !== "object" || typeof v.url !== "string" || !/^https:\/\//i.test(v.url) || !isPosition(v.position)) return null;
  return { url: v.url, position: v.position, ...(typeof v.placement === "string" && placementById(v.placement) ? { placement: v.placement as PlacementId } : {}) };
}

/**
 * The prompt's lines about our logo, for the attached image numbered `index` (1-based; 0 when it isn't
 * attached). Goes in the head of the prompt (Recreate's reference block), which is never clipped.
 */
export function logoBriefLines(logo: Pick<LogoSettings, "label" | "reference" | "overlay">, index: number): string {
  const name = logo.label ? ` (${logo.label})` : "";
  const sent = logo.reference && index > 0;
  const never = "Never invent a logo, monogram, symbol or wordmark of our own, and never keep or imitate their logo.";
  if (logo.overlay) {
    return [
      sent ? `OUR LOGO: attached image ${index} is our logo${name}, for reference only.` : "OUR LOGO:",
      `Don't draw any logo, app icon or brand mark as a standalone element: our real logo file is placed on the finished image afterwards, in the ${positionWhere(logo.overlay)}.`,
      `Keep the ${positionWhere(logo.overlay)} (about a fifth of the width, inside the safe area) clear of text, faces and key detail.`,
      sent ? `If our mark has to appear inside the scene (an app screen's header, say), copy image ${index} exactly or leave it blank.` : "",
      never,
    ].filter(Boolean).join(" ");
  }
  if (sent) {
    return `OUR LOGO: attached image ${index} is our logo${name}. Any logo or app icon in the creative is this one, reproduced exactly as attached: same shape, colours, proportions and corners, never redrawn, restyled, recoloured or simplified; if it can't be reproduced exactly, leave the logo area empty. ${never}`;
  }
  return `OUR LOGO: none attached, so show no logo or app icon. ${never}`;
}

/** Image creatives still waiting for their logo (ids): the job asks for it and it isn't on, or taken off, yet. */
export function pendingLogos(jobs: { id: string; params: Record<string, unknown> | null }[], creatives: { id: string; kind: string; job_id: string | null; copy: Record<string, unknown> | null }[]): string[] {
  const placing = new Set(jobs.filter((j) => overlayParam(j.params)).map((j) => j.id));
  return creatives.filter((c) => c.kind === "image" && c.job_id && placing.has(c.job_id) && !c.copy?.logo && !c.copy?.logoRemoved).map((c) => c.id);
}

// MARK: Which logo

export interface LogoCandidate { url: string; label: string; source: "asset" | "icon"; width?: number | null; height?: number | null }

const looksTransparent = (url: string) => /\.(png|svg|webp)(\?|$)/i.test(url);

/**
 * Logos we could use, best first: the Product page's "Logo" images (transparent PNG/SVG, square-ish
 * and large first; a wide social card last), then the brand kit's app icon.
 */
export function logoCandidates(assets: Pick<ProductAsset, "url" | "kind" | "label" | "width" | "height" | "hidden" | "created_at">[], iconUrl?: string | null): LogoCandidate[] {
  const score = (a: { url: string; width?: number | null; height?: number | null }) => {
    const aspect = a.width && a.height ? a.width / a.height : 1;
    const skew = Math.abs(Math.log(aspect)); // 0 for square, 0.64 for a 1.9:1 social card
    return (looksTransparent(a.url) ? 0 : 2) + skew * 3 - Math.min(1, (Math.min(a.width ?? 0, a.height ?? 0)) / 1024) * 0.5;
  };
  const logos = assets
    .filter((a) => a.kind === "logo" && !a.hidden && /^https:\/\//i.test(a.url))
    .sort((a, b) => score(a) - score(b) || Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((a): LogoCandidate => ({ url: a.url, label: a.label || m("Our logo"), source: "asset", width: a.width, height: a.height }));
  const icon: LogoCandidate[] = iconUrl && /^https:\/\//i.test(iconUrl) && !logos.some((l) => l.url === iconUrl) ? [{ url: iconUrl, label: m("App icon (brand kit)"), source: "icon" }] : [];
  return [...logos, ...icon];
}

/**
 * The Studio's "Place the real logo" (on by default when there is a logo): the best candidate, placed
 * on every image creative after generation (composed ads: in their layout's logo slot) and not sent to
 * the model, which is told to draw no logo of its own. Null when there's no logo to use.
 */
export function defaultLogo(candidates: LogoCandidate[], position: LogoPosition = DEFAULT_LOGO_POSITION): LogoSettings | null {
  const best = candidates[0];
  return best ? { url: best.url, label: best.label, reference: false, overlay: position } : null;
}

// MARK: Where it goes

export interface LogoBox { left: number; top: number; width: number; height: number }

/** The logo's size: this share of the image's shorter side (a square logo); a wide logo keeps the same area. */
export const LOGO_SCALE = 0.13;

/**
 * Where the logo goes on a `width` × `height` image, in pixels: a margin of 5% of the shorter side,
 * kept inside Meta's safe zone for the placement (9:16: 14% top, 35% bottom, 6% sides; 16:9 trimmed to
 * 1.91:1), and inside what Meta keeps when it crops an image made at another ratio (4:5 made at 3:4).
 */
export function logoBox(o: { width: number; height: number; position: LogoPosition; placement?: PlacementId | Placement; logoAspect?: number; scale?: number }): LogoBox {
  const { width: w, height: h } = o;
  const placement = typeof o.placement === "string" ? placementById(o.placement) : o.placement;
  const short = Math.min(w, h);
  const aspect = o.logoAspect && Number.isFinite(o.logoAspect) && o.logoAspect > 0 ? o.logoAspect : 1;
  const side = short * (o.scale ?? LOGO_SCALE);
  let bh = side / Math.sqrt(aspect);
  let bw = bh * aspect;
  if (bw > w * 0.45) { bw = w * 0.45; bh = bw / aspect; }
  if (bh > h * 0.25) { bh = h * 0.25; bw = bh * aspect; }

  // What Meta crops off each side when the image's ratio differs from the placement's.
  let cropX = 0, cropY = 0;
  if (placement) {
    const [aw, ah] = placement.aspect.split(":").map(Number);
    const target = placement.id === "landscape" ? 1.91 : aw / ah;
    const ratio = w / h;
    if (ratio < target - 0.005) cropY = (1 - ratio / target) / 2;
    else if (ratio > target + 0.005) cropX = (1 - target / ratio) / 2;
  }
  const safe = placement?.safe ?? { top: 0, bottom: 0, sides: 0 };
  const margin = short * 0.05;
  const left0 = w * (cropX + safe.sides) + margin;
  const right0 = w * (1 - cropX - safe.sides) - margin - bw;
  const top0 = h * (cropY + safe.top) + margin;
  const bottom0 = h * (1 - cropY - safe.bottom) - margin - bh;
  const x = o.position === "top_left" || o.position === "bottom_left" ? left0 : o.position === "bottom_center" ? (w - bw) / 2 : right0;
  const y = o.position.startsWith("top") ? top0 : bottom0;
  return { left: Math.round(x), top: Math.round(y), width: Math.round(bw), height: Math.round(bh) };
}
