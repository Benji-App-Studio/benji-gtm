// OCR on the server: an OpenAI vision model reads the lines of text off a server-made image (the
// Higgsfield API path), so QA's text checks (app name, blocked and competitor names, offers, banned
// words, claims) see what's actually on screen instead of "not read". Same Responses API call shape
// as the research function's ad scan. It returns the runner's OcrResult shape with `engine: "openai"`;
// sizes, contrast and legibility are the model's estimates (macOS Vision on the runner measures them),
// so core/qa.ts never fails a creative on them alone. It also returns where each line is (a normalised
// box, for the 9:16 safe-zone check), where faces are (text over a face), and the words it judges
// misspelled, product labels included (the spelling check). Every addition is optional on the result,
// so older reads still parse. A second call (readLogo) compares a logo drawn on the image with the
// brand's real logo file. Plain TypeScript with fetch injected: Deno tests run it with no network.
import { MODEL_DEFAULTS } from "../../_shared/ai/models.ts";
import { addKeyMessage } from "../../_shared/keys.ts";
import type { LogoRead, Misspelling, NormBox, OcrLine, OcrResult } from "./types.ts";

/** The vision model when the caller names none (every model default lives in _shared/ai/models.ts). */
export const OCR_DEFAULT_MODEL = MODEL_DEFAULTS.vision;
/** Lines kept per image; ads carry far fewer. */
export const OCR_MAX_LINES = 60;
/** Faces and misspellings kept per image. */
export const OCR_MAX_FACES = 12;
export const OCR_MAX_MISSPELLINGS = 20;
/** Images bigger than this aren't sent. */
export const OCR_MAX_BYTES = 15 * 1024 * 1024;

/** The model's contrast and legibility levels as the numbers QA's readability thresholds use. */
const CONTRAST: Record<string, number> = { high: 10, medium: 4.5, low: 2, very_low: 1.3 };
const LEGIBILITY: Record<string, number> = { clear: 0.95, distorted: 0.6, garbled: 0.2 };

const OCR_SYSTEM = [
  "You are an OCR engine. Read every line of text visible in the image, top to bottom, exactly as written:",
  "keep the spelling (including misspellings and garbled letters), capitals, numbers, prices and punctuation.",
  "Do not correct, translate, summarise or describe anything, and do not add text that isn't there.",
  "Include small print, buttons, logos with letters, and text inside drawn phone screens.",
  "For each line, estimate: height_frac, the height of its capital letters as a share of the image height (0.01 is tiny, 0.05 a normal headline);",
  "contrast against what is behind it (high, medium, low, very_low); and legibility (clear; distorted if letters are malformed but readable; garbled if it isn't real words);",
  "and its box: x and y of its top-left corner, w and h, all as shares of the image width and height (0 to 1, origin top-left).",
  "Then list misspellings: every word anywhere in the image that is misspelled or garbled, including on product labels, packaging and drawn screens,",
  "with the word exactly as written and the correct spelling as suggestion (for example a label reading \"Nacinamide\" → \"Niacinamide\"). Brand and product names you don't know are not misspellings.",
  "Then list faces: the box of every human face, in the same units.",
  "If there is no text, return empty lists.",
].join(" ");

const BOX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y", "w", "h"],
  properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
} as const;

const OCR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lines", "misspellings", "faces"],
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "height_frac", "contrast", "legibility", "box"],
        properties: {
          text: { type: "string" },
          height_frac: { type: "number" },
          contrast: { type: "string", enum: Object.keys(CONTRAST) },
          legibility: { type: "string", enum: Object.keys(LEGIBILITY) },
          box: BOX_SCHEMA,
        },
      },
    },
    misspellings: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["text", "suggestion"], properties: { text: { type: "string" }, suggestion: { type: "string" } } },
    },
    faces: { type: "array", items: BOX_SCHEMA },
  },
} as const;

/** The Responses API request for one image (a data URL or an https URL). */
export function ocrRequestBody(model: string, imageUrl: string) {
  return {
    model,
    reasoning: { effort: "low" },
    input: [
      { role: "system", content: OCR_SYSTEM },
      { role: "user", content: [{ type: "input_text", text: "Read the text in this ad image." }, { type: "input_image", image_url: imageUrl }] },
    ],
    text: { format: { type: "json_schema", name: "ocr_lines", strict: true, schema: OCR_SCHEMA } },
  };
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** A box made safe: numbers inside the image, a real width and height; null when it isn't one. */
export function cleanBox(raw: unknown): NormBox | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const [x, y, w, h] = [b.x, b.y, b.w, b.h].map(Number);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  const left = Math.min(1, Math.max(0, x)), top = Math.min(1, Math.max(0, y));
  const width = Math.min(1 - left, Math.max(0, w)), height = Math.min(1 - top, Math.max(0, h));
  if (width <= 0 || height <= 0) return null;
  return { x: round4(left), y: round4(top), w: round4(width), h: round4(height) };
}

/** The model's lines, cleaned: trimmed, de-duplicated, sizes clamped, at most OCR_MAX_LINES. */
export function cleanLines(raw: unknown): OcrLine[] {
  const list = Array.isArray((raw as { lines?: unknown })?.lines) ? (raw as { lines: unknown[] }).lines : [];
  const out: OcrLine[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const line = item as Record<string, unknown>;
    const text = typeof line.text === "string" ? line.text.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    const height = Number(line.height_frac);
    const box = cleanBox(line.box);
    out.push({
      text,
      heightFrac: Number.isFinite(height) ? round4(Math.min(1, Math.max(0.002, height))) : 0.03,
      contrast: CONTRAST[String(line.contrast)] ?? CONTRAST.medium,
      confidence: LEGIBILITY[String(line.legibility)] ?? LEGIBILITY.clear,
      ...(box ? { box } : {}),
    });
    if (out.length >= OCR_MAX_LINES) break;
  }
  return out;
}

/** The model's misspellings, cleaned: real corrections only, de-duplicated, at most OCR_MAX_MISSPELLINGS. */
export function cleanMisspellings(raw: unknown): Misspelling[] {
  const list = Array.isArray((raw as { misspellings?: unknown })?.misspellings) ? (raw as { misspellings: unknown[] }).misspellings : [];
  const out: Misspelling[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const m = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const text = typeof m.text === "string" ? m.text.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    const suggestion = typeof m.suggestion === "string" ? m.suggestion.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    if (!text || !suggestion || text.toLowerCase() === suggestion.toLowerCase() || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push({ text, suggestion });
    if (out.length >= OCR_MAX_MISSPELLINGS) break;
  }
  return out;
}

/** The model's face boxes, cleaned, at most OCR_MAX_FACES. */
export const cleanFaces = (raw: unknown): NormBox[] =>
  (Array.isArray((raw as { faces?: unknown })?.faces) ? (raw as { faces: unknown[] }).faces : []).map(cleanBox).filter((b): b is NormBox => Boolean(b)).slice(0, OCR_MAX_FACES);

/** A Responses API answer's JSON. Throws with a readable reason on an error, a refusal or bad JSON. */
function answerJson(data: unknown, ok: boolean, status: number, what: string): unknown {
  const body = (data ?? {}) as Record<string, any>;
  if (!ok) throw new Error(`OpenAI: ${String(body?.error?.message ?? `error ${status}`).slice(0, 200)}`);
  const parts = (Array.isArray(body.output) ? body.output : []).flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []));
  const refusal = parts.find((part: any) => part?.type === "refusal")?.refusal;
  if (refusal) throw new Error(`OpenAI declined to ${what}: ${String(refusal).slice(0, 160)}`);
  const text = body.output_text ?? parts.find((part: any) => part?.type === "output_text")?.text;
  if (typeof text !== "string") throw new Error("OpenAI sent no answer.");
  try { return JSON.parse(text); } catch { throw new Error("OpenAI's answer wasn't readable JSON."); }
}

/**
 * Everything a read returns: the lines, and (when the answer has them) the misspellings and faces. An
 * answer without those keys (an older prompt) gives lines only, so faces are "not looked for", not "none".
 */
export function parseOcrRead(data: unknown, ok = true, status = 200): Pick<OcrResult, "lines" | "faces" | "misspellings"> {
  const parsed = answerJson(data, ok, status, "read the image");
  const has = (key: string) => Boolean(parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>)[key]));
  const misspellings = cleanMisspellings(parsed);
  return {
    lines: cleanLines(parsed),
    ...(has("faces") ? { faces: cleanFaces(parsed) } : {}),
    ...(misspellings.length ? { misspellings } : {}),
  };
}

/** The lines out of a Responses API answer. Throws with a readable reason on an error, a refusal or bad JSON. */
export function parseOcrResponse(data: unknown, ok = true, status = 200): OcrLine[] {
  return parseOcrRead(data, ok, status).lines;
}

/** Bytes as a data URL for the Responses API. */
export function dataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

export interface ReadImageOptions {
  apiKey: string | undefined;
  model?: string;
  bytes: Uint8Array;
  mime: string;
  /** The storage path read (kept on the result, so a replaced file is read again). */
  source: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Reads one image's text. Never throws: a missing key, an unsupported file or any OpenAI failure comes
 * back as `engine: "none"` with the reason in `error` (QA then treats the text as unread, as before).
 */
export async function readImageText(options: ReadImageOptions): Promise<OcrResult> {
  const { apiKey, bytes, mime, source } = options;
  const model = options.model || OCR_DEFAULT_MODEL;
  const unread = (error: string): OcrResult => ({ engine: "none", frames: 0, lines: [], error: error.slice(0, 300), source });
  if (!apiKey) return unread(`OpenAI isn't connected, so on-screen text wasn't read. ${addKeyMessage("OPENAI_API_KEY")}`);
  if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) return unread(`Only PNG, JPEG, WebP or GIF images are read (this is ${mime}).`);
  if (bytes.byteLength > OCR_MAX_BYTES) return unread("The image is over 15 MB, so its text wasn't read.");
  try {
    const response = await (options.fetchImpl ?? fetch)("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(ocrRequestBody(model, dataUrl(bytes, mime))),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    });
    const data = await response.json().catch(() => ({}));
    const read = parseOcrRead(data, response.ok, response.status);
    return { engine: "openai", frames: 1, ...read, model, source };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return unread(`OCR failed: ${/abort|timed? ?out/i.test(message) ? "OpenAI didn't answer in time." : message}`);
  }
}

/**
 * Whether QA should read this creative's text on the server first: images only (server-made videos
 * have no frames here), never the social-post templates (rendered from known copy), and only when
 * nothing was read yet or the server's read was of a file that has since been replaced.
 */
export function needsServerOcr(creative: { kind: string; style: string; storage_path: string | null; ocr: OcrResult | null }): boolean {
  if (creative.kind !== "image" || creative.style === "reddit" || creative.style === "tweet" || !creative.storage_path) return false;
  const ocr = creative.ocr;
  if (!ocr || ocr.engine === "none") return true;
  return ocr.engine === "openai" && ocr.source !== creative.storage_path;
}

// MARK: Logo

const LOGO_SYSTEM = [
  "You check brand logos on ad images. Image 1 is an ad. Image 2 is the brand's real logo file.",
  "Say whether image 1 shows a logo mark (a symbol, an app icon or a wordmark presented as a logo; plain text in a headline is not a logo).",
  "If it does, say whether it is the real logo from image 2 exactly: the same shape, letters and colours. Answer no when it looks redrawn, re-lettered, simplified or altered (AI image models often redraw logos);",
  "unsure when it is too small or blurred to tell. In note, one short sentence on what differs or why you are unsure.",
].join(" ");

const LOGO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["visible", "matches", "note"],
  properties: { visible: { type: "boolean" }, matches: { type: "string", enum: ["yes", "no", "unsure"] }, note: { type: "string" } },
} as const;

/** The Responses API request comparing an ad (a data URL or an https URL) with the real logo (https). */
export function logoRequestBody(model: string, imageUrl: string, logoUrl: string) {
  return {
    model,
    reasoning: { effort: "low" },
    input: [
      { role: "system", content: LOGO_SYSTEM },
      { role: "user", content: [{ type: "input_text", text: "Image 1: the ad. Image 2: our real logo." }, { type: "input_image", image_url: imageUrl }, { type: "input_image", image_url: logoUrl }] },
    ],
    text: { format: { type: "json_schema", name: "logo_check", strict: true, schema: LOGO_SCHEMA } },
  };
}

/** The comparison out of a Responses API answer. Throws with a readable reason on an error, a refusal or bad JSON. */
export function parseLogoResponse(data: unknown, ok = true, status = 200): Pick<LogoRead, "visible" | "matches" | "note"> {
  const parsed = (answerJson(data, ok, status, "compare the logo") ?? {}) as Record<string, unknown>;
  const matches = parsed.matches === "yes" || parsed.matches === "no" ? parsed.matches : "unsure";
  const note = typeof parsed.note === "string" ? parsed.note.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return { visible: parsed.visible === true, matches, ...(note ? { note } : {}) };
}

export interface ReadLogoOptions extends ReadImageOptions {
  /** The real logo (public https). */
  logoUrl: string;
}

/**
 * Compares the logo drawn on one image with the real logo. Never throws: a missing key or any failure
 * comes back with `error` set (QA then says the logo wasn't compared).
 */
export async function readLogo(options: ReadLogoOptions): Promise<LogoRead> {
  const { apiKey, bytes, mime, source, logoUrl } = options;
  const model = options.model || OCR_DEFAULT_MODEL;
  const failed = (error: string): LogoRead => ({ visible: false, matches: "unsure", logoUrl, source, error: error.slice(0, 300) });
  if (!apiKey) return failed(`OpenAI isn't connected, so the logo wasn't compared. ${addKeyMessage("OPENAI_API_KEY")}`);
  if (!/^https:\/\/\S+$/i.test(logoUrl)) return failed("The real logo has no public https link.");
  if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) return failed(`Only PNG, JPEG, WebP or GIF images are compared (this is ${mime}).`);
  if (bytes.byteLength > OCR_MAX_BYTES) return failed("The image is over 15 MB, so its logo wasn't compared.");
  try {
    const response = await (options.fetchImpl ?? fetch)("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(logoRequestBody(model, dataUrl(bytes, mime), logoUrl)),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    });
    const data = await response.json().catch(() => ({}));
    return { ...parseLogoResponse(data, response.ok, response.status), logoUrl, source, model };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failed(`Logo check failed: ${/abort|timed? ?out/i.test(message) ? "OpenAI didn't answer in time." : message}`);
  }
}

/**
 * Whether QA should compare this creative's logo with the real one first: images only (never the
 * social-post templates), when the batch has a real logo, we didn't place it ourselves, and it wasn't
 * compared yet for this file and this logo (a failed comparison is tried again).
 */
export function needsLogoRead(creative: { kind: string; style: string; storage_path: string | null; ocr: OcrResult | null }, logoUrl: string | undefined, logoPlaced: boolean): boolean {
  if (!logoUrl || logoPlaced || creative.kind !== "image" || creative.style === "reddit" || creative.style === "tweet" || !creative.storage_path) return false;
  const read = creative.ocr?.logo;
  return !read || Boolean(read.error) || read.logoUrl !== logoUrl || read.source !== creative.storage_path;
}
