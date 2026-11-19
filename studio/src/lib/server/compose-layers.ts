// Composed ads' picture layers, before the copy is set (lib/server/compose.tsx): the product's real
// cut-out in the layout's product box, resting on a soft floor shadow (the plate left that spot empty),
// and our real logo file in the logo slot (lib/composed-ads.ts says where). sharp, on images made here.
// No "server-only" import: the Node tests call it too.
import sharp, { type OverlayOptions } from "sharp";
import { logoRect, productPlacement, type CanvasLayout, type ProductPlacement, type Rect } from "../composed-ads";
import { preparedLogo } from "./logo-overlay";

/** A soft floor shadow: a dark ellipse, blurred, as an RGBA PNG and where its top-left goes. */
export async function floorShadow(s: ProductPlacement["shadow"]): Promise<{ png: Buffer; left: number; top: number; width: number; height: number }> {
  const pad = s.blur * 3;
  const w = Math.max(1, 2 * (s.rx + pad)), h = Math.max(1, 2 * (s.ry + pad));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><ellipse cx="${w / 2}" cy="${h / 2}" rx="${s.rx}" ry="${s.ry}" fill="#000" fill-opacity="${s.opacity}"/></svg>`;
  const png = await sharp(Buffer.from(svg)).blur(Math.max(0.3, s.blur)).png().toBuffer();
  return { png, left: s.cx - w / 2, top: s.cy - h / 2, width: w, height: h };
}

/** The product cut-out: transparent edges trimmed, so it sits on the box's floor (any file sharp reads). */
export async function trimmedCutout(bytes: Uint8Array): Promise<{ png: Buffer; aspect: number }> {
  const base = sharp(bytes).rotate().ensureAlpha();
  const png = await base.clone().trim({ threshold: 4 }).png().toBuffer().catch(() => base.png().toBuffer());
  const meta = await sharp(png).metadata();
  if (!meta.width || !meta.height) throw new Error("Couldn't read the product cut-out.");
  return { png, aspect: meta.width / meta.height };
}

/** Clips a layer to the canvas (sharp refuses layers that hang off it). */
async function clipped(png: Buffer, left: number, top: number, W: number, H: number): Promise<OverlayOptions | null> {
  const meta = await sharp(png).metadata();
  const w = meta.width ?? 0, h = meta.height ?? 0;
  const l = Math.round(left), t = Math.round(top);
  const x0 = Math.max(0, -l), y0 = Math.max(0, -t), x1 = Math.min(w, W - l), y1 = Math.min(h, H - t);
  if (x1 <= x0 || y1 <= y0) return null;
  const input = x0 || y0 || x1 < w || y1 < h ? await sharp(png).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).png().toBuffer() : png;
  return { input, left: l + x0, top: t + y0 };
}

export interface Layered {
  /** The plate with the product and the logo in place (JPEG, the canvas size). */
  plate: Buffer;
  product: { png: Buffer; shadow: Awaited<ReturnType<typeof floorShadow>>; place: ProductPlacement } | null;
  logo: { png: Buffer; rect: Rect } | null;
}

/** Puts the real product (on its floor shadow) and our logo on `bare` (already the canvas size). */
export async function layerPlate(bare: Buffer, canvas: CanvasLayout, o: { logo?: Uint8Array | null; product?: Uint8Array | null }): Promise<Layered> {
  const { width: W, height: H } = canvas;
  const overlays: OverlayOptions[] = [];
  let product: Layered["product"] = null;
  if (o.product) {
    const cut = await trimmedCutout(o.product);
    const place = productPlacement(canvas, cut.aspect);
    const png = await sharp(cut.png).resize(place.width, place.height, { fit: "fill" }).png().toBuffer();
    const shadow = await floorShadow(place.shadow);
    product = { png, shadow, place };
    for (const layer of [await clipped(shadow.png, shadow.left, shadow.top, W, H), await clipped(png, place.left, place.top, W, H)]) if (layer) overlays.push(layer);
  }
  let logo: Layered["logo"] = null;
  if (o.logo) {
    const meta = await sharp(o.logo).metadata();
    if (!meta.width || !meta.height) throw new Error("Couldn't read the logo file.");
    const rect = logoRect(canvas, meta.width / meta.height);
    const png = await preparedLogo(o.logo, Math.max(1, rect.width), Math.max(1, rect.height));
    logo = { png, rect };
    const layer = await clipped(png, rect.left, rect.top, W, H);
    if (layer) overlays.push(layer);
  }
  const plate = overlays.length ? await sharp(bare).composite(overlays).jpeg({ quality: 92 }).toBuffer() : bare;
  return { plate, product, logo };
}
