// Places our real logo file on a finished image creative (sharp, i.e. libvips: fast, native, the same
// library Next.js uses for images). Where it goes comes from lib/logo-overlay.ts (logoBox). A logo with
// no transparency (an App Store icon is a flat square) gets app-icon rounded corners; every logo gets a
// soft shadow so it reads on light and dark backgrounds. The output keeps the creative's size and format.
// No "server-only" import: the Node tests and the local test script call it too.
import sharp from "sharp";
import { logoBox, type LogoBox, type LogoPosition } from "../logo-overlay";
import type { PlacementId } from "../meta-formats";

export interface Placed { bytes: Uint8Array; mime: string; width: number; height: number; box: LogoBox }

const MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", webp: "image/webp" };

/** The logo at `width` × `height`, as RGBA PNG: transparent logos as they are, flat ones with rounded corners. */
export async function preparedLogo(logo: Uint8Array, width: number, height: number): Promise<Buffer> {
  const meta = await sharp(logo).metadata();
  const resized = sharp(logo, { density: 384 }).resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha();
  if (meta.hasAlpha || meta.format === "svg") return resized.png().toBuffer();
  // A flat square (an App Store icon): round it like iOS does (radius ≈ 22.4% of the side).
  const r = Math.round(Math.min(width, height) * 0.224);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
  return resized.composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

/** A soft drop shadow from the logo's own shape, `pad` pixels bigger on each side. */
async function shadowOf(logoPng: Buffer, width: number, height: number, pad: number, sigma: number): Promise<Buffer> {
  const { data } = await sharp(logoPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc((width + 2 * pad) * (height + 2 * pad) * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[((y + pad) * (width + 2 * pad) + (x + pad)) * 4 + 3] = Math.round(data[(y * width + x) * 4 + 3] * 0.3);
    }
  }
  return sharp(out, { raw: { width: width + 2 * pad, height: height + 2 * pad, channels: 4 } }).blur(sigma).png().toBuffer();
}

/** Puts `logo` on `image` at `position`, inside the placement's safe area. */
export async function placeLogo(image: Uint8Array, logo: Uint8Array, o: { position: LogoPosition; placement?: PlacementId; scale?: number }): Promise<Placed> {
  const base = sharp(image);
  const meta = await base.metadata();
  if (!meta.width || !meta.height) throw new Error("Couldn't read the creative's size.");
  const logoMeta = await sharp(logo).metadata();
  if (!logoMeta.width || !logoMeta.height) throw new Error("Couldn't read the logo file.");
  const box = logoBox({ width: meta.width, height: meta.height, position: o.position, placement: o.placement, logoAspect: logoMeta.width / logoMeta.height, scale: o.scale });
  const mark = await preparedLogo(logo, box.width, box.height);
  const sigma = Math.max(1, box.height * 0.035);
  const pad = Math.ceil(sigma * 3);
  const shadow = await shadowOf(mark, box.width, box.height, pad, sigma);
  const drop = Math.round(box.height * 0.02);
  const layered = base.composite([
    { input: shadow, left: Math.max(0, box.left - pad), top: Math.max(0, box.top - pad + drop) },
    { input: mark, left: box.left, top: box.top },
  ]);
  const format = meta.format ?? "png";
  const encoded = format === "jpeg" ? layered.jpeg({ quality: 92, mozjpeg: true })
    : format === "webp" ? layered.webp({ quality: 92 })
    : layered.png({ compressionLevel: 6, adaptiveFiltering: true }); // about the original's size, in well under a second
  const bytes = new Uint8Array(await encoded.toBuffer());
  return { bytes, mime: MIME[format] ?? "image/png", width: meta.width, height: meta.height, box };
}
