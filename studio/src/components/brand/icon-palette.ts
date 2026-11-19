"use client";
// A few distinct colours read from the app icon, offered as palette suggestions on the Brand page
// (Storage serves images with open CORS, so the browser can read the pixels).
import { useEffect, useState } from "react";

export function useIconPalette(url?: string) {
  const [palette, setPalette] = useState<{ url: string; colors: string[] } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    paletteFrom(url).then((colors) => { if (live) setPalette({ url, colors }); }).catch(() => {});
    return () => { live = false; };
  }, [url]);
  return palette && palette.url === url ? palette.colors : [];
}

async function paletteFrom(url: string): Promise<string[]> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  context.drawImage(image, 0, 0, size, size);
  const { data } = context.getImageData(0, 0, size, size);
  // Pixels into coarse buckets; each bucket's average colour, most common first; then drop near-duplicates.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = (data[i] >> 5) * 64 + (data[i + 1] >> 5) * 8 + (data[i + 2] >> 5);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++; bucket.r += data[i]; bucket.g += data[i + 1]; bucket.b += data[i + 2];
    buckets.set(key, bucket);
  }
  const picked: [number, number, number][] = [];
  for (const b of [...buckets.values()].sort((x, y) => y.n - x.n)) {
    if (b.n < 4) break;
    const rgb: [number, number, number] = [b.r / b.n, b.g / b.n, b.b / b.n];
    if (picked.every((p) => Math.hypot(p[0] - rgb[0], p[1] - rgb[1], p[2] - rgb[2]) > 90)) picked.push(rgb);
    if (picked.length === 5) break;
  }
  return picked.map((rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase());
}
