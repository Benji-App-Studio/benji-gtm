// A/B ad copy from OpenAI (the studio's POST /api/studio/creatives/[id]/copy). The studio builds the
// instructions and the input from the brand's rules and the creative (studio/src/lib/creative-copy.ts)
// and finishes the answer (lowercase creator voice, substitutions, the description); this function
// holds the key and makes the one Responses API call, with a fixed JSON schema: two variants, A in the
// creator's voice and B in the brand's, each a primary text and a headline. Plain TypeScript with fetch
// injected: Deno tests run it with no network.
import { addKeyMessage } from "../../_shared/keys.ts";
import { adCopyRule, toUiLocale, type UiLocale } from "../../_shared/language.ts";
import { OCR_DEFAULT_MODEL } from "./ocr.ts";

/** What the studio may send: plain text, capped. */
export const COPY_INPUT_MAX = 10_000;

export interface RawCopyVariant { label: string; voice: "creator" | "brand"; primary_text: string; headline: string }

const COPY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["variants"],
  properties: {
    variants: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "voice", "primary_text", "headline"],
        properties: {
          label: { type: "string", enum: ["A", "B"] },
          voice: { type: "string", enum: ["creator", "brand"] },
          primary_text: { type: "string" },
          headline: { type: "string" },
        },
      },
    },
  },
} as const;

/**
 * The language the copy is written in: the one the request names (`copyLanguage`: the ad's audience),
 * else the person's (the page's language), else English. The studio's instructions are written in English.
 */
export function copyLanguage(requested: unknown, person: UiLocale | null | undefined): UiLocale {
  return toUiLocale(requested) ?? person ?? "en";
}

/** The studio's instructions with the language rule for the copy (unchanged for English). The rule goes first so a long brief can't cut it off. */
export function copyInstructions(instructions: string, language: UiLocale): string {
  const rule = adCopyRule(language).trim();
  return rule ? `${rule}\n\n${instructions}` : instructions;
}

/** The Responses API request: the studio's instructions as the system message, its input as the user's. */
export function copyRequestBody(model: string, instructions: string, input: string) {
  return {
    model,
    reasoning: { effort: "low" },
    input: [
      { role: "system", content: instructions.slice(0, COPY_INPUT_MAX) },
      { role: "user", content: [{ type: "input_text", text: `${input.slice(0, COPY_INPUT_MAX)}\n\nWrite variant A (creator voice) and variant B (brand voice).` }] },
    ],
    text: { format: { type: "json_schema", name: "ad_copy", strict: true, schema: COPY_SCHEMA } },
  };
}

/** The variants out of a Responses API answer, trimmed. Throws with a readable reason on an error, a refusal or bad JSON. */
export function parseCopyResponse(data: unknown, ok = true, status = 200): RawCopyVariant[] {
  const body = (data ?? {}) as Record<string, any>;
  if (!ok) throw new Error(`OpenAI: ${String(body?.error?.message ?? `error ${status}`).slice(0, 200)}`);
  const parts = (Array.isArray(body.output) ? body.output : []).flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []));
  const refusal = parts.find((part: any) => part?.type === "refusal")?.refusal;
  if (refusal) throw new Error(`OpenAI declined to write the copy: ${String(refusal).slice(0, 160)}`);
  const text = body.output_text ?? parts.find((part: any) => part?.type === "output_text")?.text;
  if (typeof text !== "string") throw new Error("OpenAI sent no answer.");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("OpenAI's answer wasn't readable JSON."); }
  const list = Array.isArray((parsed as { variants?: unknown })?.variants) ? (parsed as { variants: unknown[] }).variants : [];
  const out: RawCopyVariant[] = [];
  for (const item of list) {
    const x = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const label = x.label === "A" || x.label === "B" ? x.label : null;
    const primary = typeof x.primary_text === "string" ? x.primary_text.replace(/\s+/g, " ").trim().slice(0, 2000) : "";
    if (!label || !primary || out.some((v) => v.label === label)) continue;
    out.push({
      label, voice: x.voice === "creator" || x.voice === "brand" ? x.voice : label === "A" ? "creator" : "brand",
      primary_text: primary, headline: typeof x.headline === "string" ? x.headline.replace(/\s+/g, " ").trim().slice(0, 255) : "",
    });
  }
  if (!out.length) throw new Error("OpenAI wrote no copy.");
  return out;
}

export interface WriteCopyOptions {
  apiKey: string | undefined;
  model?: string;
  instructions: string;
  input: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** One call to OpenAI. Throws a readable error (no key, a timeout, OpenAI's own message). */
export async function writeCopy(o: WriteCopyOptions): Promise<{ variants: RawCopyVariant[]; model: string }> {
  if (!o.apiKey) throw new Error(`OpenAI isn't connected. ${addKeyMessage("OPENAI_API_KEY")}`);
  if (!o.instructions.trim() || !o.input.trim()) throw new Error("Nothing to write copy from.");
  const model = o.model || OCR_DEFAULT_MODEL;
  try {
    const response = await (o.fetchImpl ?? fetch)("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${o.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(copyRequestBody(model, o.instructions, o.input)),
      signal: AbortSignal.timeout(o.timeoutMs ?? 50_000),
    });
    const data = await response.json().catch(() => ({}));
    return { variants: parseCopyResponse(data, response.ok, response.status), model };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(/abort|timed? ?out/i.test(message) ? "OpenAI didn't answer in time. Try again." : message);
  }
}
