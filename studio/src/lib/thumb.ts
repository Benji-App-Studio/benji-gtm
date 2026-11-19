// Display-size copies of our stored images, for grids of small tiles. Product images are kept as they
// were collected (website heroes up to 3840×6822, ~26 megapixels): a grid of 100+ shown as originals had
// the browser decode ~1.5 GB of bitmaps, which it throws away when the tab is hidden and decodes again on
// return (the page stayed blank for a second or two, and scrolling the Recreate sheet stuttered).
// Supabase Storage resizes on its CDN (`/render/image/…`, cached per size, WebP when the browser takes
// it), so tiles fetch a few KB each. Only the display copy changes: what goes to Higgsfield, "Open the
// full image" and the large previews keep the original URL. Safe in the browser.

import { publicInstall, storageBase } from "./install/public";

// The project's address is only known at run time (lib/install), so these are worked out per call.
const objectBase = () => `${storageBase()}/object/public/`;
const renderBase = () => `${storageBase()}/render/image/public/`;
/**
 * Buckets whose images are resized: product images and uploads (`workspace`) and our creatives.
 * Not `ad-media` (competitors' ads, ~1080 px already, and thousands of them: Supabase bills each
 * distinct image it transforms).
 */
const BUCKETS = ["workspace/", "creatives/"];

/**
 * A copy of one of our stored images at `width` CSS-pixel-ready size (pass about 2× the tile for sharp
 * screens). With `height` too, cropped to fill that box from the centre, like `object-cover`; without,
 * the aspect ratio is kept. Any other URL (another host, a local file, another bucket) comes back as it is.
 */
export function thumbUrl(url: string, width: number, height?: number): string {
  // Supabase resizes images on paid plans only; without it every tile would fail once and fall back.
  if (!publicInstall()?.imageTransforms) return url;
  const OBJECT = objectBase();
  if (!url.startsWith(OBJECT)) return url;
  const path = url.slice(OBJECT.length);
  if (!BUCKETS.some((b) => path.startsWith(b)) || path.includes("?")) return url;
  const q = new URLSearchParams({ width: String(Math.round(width)) });
  // Width alone keeps the original's height on Storage (a square came back 640 × 2048, squashed), so
  // without a height the copy is fitted inside a tall box instead, which keeps the aspect ratio.
  q.set("height", String(Math.round(height ?? width * 4)));
  q.set("resize", height ? "cover" : "contain");
  q.set("quality", "70");
  return `${renderBase()}${path}?${q}`;
}

/**
 * For an <img>'s onError: if it was showing a resized copy, show the original instead (Storage refuses
 * to resize files over its limits) and return true; false when there is nothing to fall back to.
 */
export function showOriginal(img: HTMLImageElement): boolean {
  const src = img.getAttribute("src") ?? "";
  const RENDER = renderBase();
  if (!publicInstall() || !src.startsWith(RENDER)) return false;
  img.src = objectBase() + src.slice(RENDER.length).split("?")[0];
  return true;
}
