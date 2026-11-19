// Local media work on the runner's Mac: download results, read video length and size (ffprobe), take
// a poster frame and sample frames (ffmpeg), and read on-screen text with macOS Vision (ocr.swift,
// compiled once into ~/.cache/creative-runner). All free and offline.
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { imageSize } from "../../supabase/functions/creatives/core/media.ts";
import type { OcrLine, OcrResult } from "../../supabase/functions/creatives/core/types.ts";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, "fixtures");
/** What the runner can rebuild: the compiled OCR helper and the Marketing Studio product ids. */
export const CACHE = join(homedir(), ".cache", "creative-runner");
/** Where the same files were kept before; the runner copies them to CACHE once (runner.ts adoptEarlierCache). */
export const EARLIER_CACHE = join(homedir(), ".cache", "radar-creative-runner");

/** Downloads `url` to `file`. Fixture URLs (cdn.example.com/fixture/…) copy the local fixture instead. */
export async function download(url: string, file: string): Promise<void> {
  mkdirSync(dirname(file), { recursive: true });
  const fixture = /^https:\/\/cdn\.example\.com\/fixture\/(.+)$/.exec(url)?.[1];
  if (fixture) { copyFileSync(join(FIXTURES, basename(fixture)), file); return; }
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url.slice(0, 120)}`);
  writeFileSync(file, new Uint8Array(await response.arrayBuffer()));
}

export function mimeOf(file: string): string {
  const head = readFileSync(file).subarray(0, 12);
  if (head[0] === 0x89 && head[1] === 0x50) return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8) return "image/jpeg";
  if (head.subarray(0, 4).toString() === "RIFF" && head.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (head.subarray(4, 8).toString() === "ftyp") return head.subarray(8, 10).toString() === "qt" ? "video/quicktime" : "video/mp4";
  return "application/octet-stream";
}

export async function probe(file: string): Promise<{ width?: number; height?: number; durationSec?: number }> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file]);
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0] ?? {};
  const duration = Number(data.format?.duration);
  return { width: stream.width, height: stream.height, ...(Number.isFinite(duration) ? { durationSec: Math.round(duration * 100) / 100 } : {}) };
}

export function imageDimensions(file: string) {
  return imageSize(new Uint8Array(readFileSync(file))) ?? undefined;
}

/** A JPEG poster at `at` seconds (Meta needs a thumbnail for every video). */
export async function poster(video: string, out: string, at = 1): Promise<string> {
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(at), "-i", video, "-frames:v", "1", "-q:v", "3", out]);
  if (!existsSync(out)) await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", video, "-frames:v", "1", "-q:v", "3", out]);
  return out;
}

/** `count` frames spread over the video (skipping the very first and last moments), for OCR. */
export async function sampleFrames(video: string, dir: string, durationSec: number, count = 6): Promise<{ file: string; at: number }[]> {
  mkdirSync(dir, { recursive: true });
  const span = Math.max(0.1, durationSec - 0.6);
  const times = Array.from({ length: count }, (_, i) => Math.round((0.3 + (span * i) / Math.max(1, count - 1)) * 10) / 10);
  const frames = [];
  for (const at of times) {
    const file = join(dir, `frame-${String(at).replace(".", "_")}.png`);
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(at), "-i", video, "-frames:v", "1", file]).catch(() => undefined);
    if (existsSync(file)) frames.push({ file, at });
  }
  return frames;
}

let building: Promise<string> | null = null;

/** The compiled OCR helper (built once, rebuilt when ocr.swift changes; one build at a time). */
export function ocrBinary(): Promise<string> {
  if (process.env.CREATIVE_RUNNER_OCR_BIN) return Promise.resolve(process.env.CREATIVE_RUNNER_OCR_BIN);
  building ??= (async () => {
    const source = join(HERE, "ocr.swift");
    const binary = join(CACHE, "ocr");
    if (!existsSync(binary) || statSync(binary).mtimeMs < statSync(source).mtimeMs) {
      mkdirSync(CACHE, { recursive: true });
      const partial = `${binary}.${process.pid}.tmp`;
      await run("swiftc", ["-O", source, "-o", partial], { timeout: 300_000 });
      renameSync(partial, binary);
    }
    return binary;
  })().catch((error) => { building = null; throw error; });
  return building;
}

/** One image's read as ocr.swift prints it: boxes are normalised with the origin top-left. */
export interface VisionBox { x: number; y: number; w: number; h: number }
export interface VisionResult { path: string; width: number; height: number; lines: ({ text: string; confidence: number; heightFrac: number; contrast: number } & Partial<VisionBox>)[]; faces?: VisionBox[]; error?: string | null }

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const boxOf = (b: Partial<VisionBox>) => ([b.x, b.y, b.w, b.h].every((n) => typeof n === "number" && Number.isFinite(n)) && b.w! > 0 && b.h! > 0 ? { x: round4(b.x!), y: round4(b.y!), w: round4(b.w!), h: round4(b.h!) } : null);

/**
 * ocr.swift's results as an OcrResult: lines with their boxes (for QA's 9:16 safe-zone check) and the
 * faces Vision found (text over a face), each with the second its frame was taken at for videos.
 */
export function visionToOcr(results: VisionResult[], images: { at?: number }[]): OcrResult {
  const lines: OcrLine[] = [];
  const faces: NonNullable<OcrResult["faces"]> = [];
  const errors: string[] = [];
  let lookedForFaces = false;
  results.forEach((r, i) => {
    const at = images[i]?.at !== undefined ? { at: images[i].at } : {};
    if (r.error) errors.push(r.error);
    for (const l of r.lines) {
      const box = boxOf(l);
      lines.push({ text: l.text, confidence: Math.round(l.confidence * 100) / 100, heightFrac: round4(l.heightFrac), contrast: l.contrast, ...at, ...(box ? { box: { ...box, ...at } } : {}) });
    }
    if (Array.isArray(r.faces)) {
      lookedForFaces = true;
      for (const f of r.faces) { const box = boxOf(f); if (box) faces.push({ ...box, ...at }); }
    }
  });
  return { engine: "vision", frames: images.length, lines, ...(lookedForFaces ? { faces } : {}), ...(errors.length && !lines.length ? { error: errors[0].slice(0, 200) } : {}) };
}

/** Reads the text in images (or video frames, with the second each was taken at). */
export async function ocr(images: { file: string; at?: number }[]): Promise<OcrResult> {
  if (!images.length) return { engine: "vision", frames: 0, lines: [] };
  try {
    const { stdout } = await run(await ocrBinary(), images.map((i) => i.file), { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
    const results = stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line) as VisionResult);
    return visionToOcr(results, images);
  } catch (error) {
    return { engine: "none", frames: images.length, lines: [], error: `OCR failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}` };
  }
}
