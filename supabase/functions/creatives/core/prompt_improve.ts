// "Improve with AI" on Research's "Make this for <app>" sheet: OpenAI rewrites a generation prompt so a
// model follows it more precisely. The studio builds the instructions from the brand's rules
// (studio/src/lib/make-for-app.ts improveInstructions) and sends the words that must never appear (their
// brand, the brand's banned words); this function holds the key, makes one Responses API call with a
// fixed JSON schema, and refuses an answer that brings in a blocked word or a new number. Plain
// TypeScript with fetch injected: Deno tests run it with no network.
import { addKeyMessage } from "../../_shared/keys.ts";
import { OCR_DEFAULT_MODEL } from "./ocr.ts";

export const IMPROVE_MAX = 6_000;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["prompt", "note"],
  properties: { prompt: { type: "string" }, note: { type: "string" } },
} as const;

export function improveRequestBody(model: string, instructions: string, prompt: string) {
  return {
    model,
    reasoning: { effort: "low" },
    input: [
      { role: "system", content: instructions.slice(0, IMPROVE_MAX) },
      { role: "user", content: [{ type: "input_text", text: `Rewrite this prompt:\n\n${prompt.slice(0, IMPROVE_MAX)}` }] },
    ],
    text: { format: { type: "json_schema", name: "improved_prompt", strict: true, schema: SCHEMA } },
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** How often a word is used (a blocked word may be named in the rules: only more uses than the original count). */
const uses = (text: string, word: string) => (text.match(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, "giu")) ?? []).length;
/**
 * Numbers that read as a claim: a count of three digits or more ("200,000", "500") that isn't a size in
 * pixels or a year, or a percentage followed by a claim word ("50% faster", "30% off"). Layout numbers
 * ("8% margins", "1080 px") are fine.
 */
export function claimNumbers(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(/(\d[\d.,]*\d|\d)(\s*%)?(\s*(?:px|×|x\s*\d))?\s*([\p{L}]+(?:\s+[\p{L}]+)?)?/gu)) {
    const [, num, pct, px, after = ""] = m;
    if (px) continue;
    if (pct) { if (/^(?:off|faster|more|less|better|cheaper|of|save|savings|discount|users|people|success|accurate|guarantee)/i.test(after.trim())) out.add(`${num}%`); continue; }
    if (num.replace(/\D/g, "").length >= 3 && !/^(?:19|20)\d\d$/.test(num)) out.add(num);
  }
  return out;
}
const numbers = claimNumbers;

/** Why an improved prompt can't be used: a blocked word it brought in, or a number that wasn't there. Empty when it's fine. */
export function improveProblems(original: string, improved: string, blocked: string[]): string[] {
  const out: string[] = [];
  for (const word of blocked) if (word.trim().length >= 2 && uses(improved, word) > uses(original, word)) out.push(`it used "${word}"`);
  const had = numbers(original);
  const added = [...numbers(improved)].filter((n) => !had.has(n));
  if (added.length) out.push(`it added ${added.slice(0, 3).join(", ")}`);
  return out;
}

/** The answer out of a Responses API reply. Throws a readable error on an error, a refusal or bad JSON. */
export function parseImproveResponse(data: unknown, ok = true, status = 200): { prompt: string; note: string } {
  const body = (data ?? {}) as Record<string, any>;
  if (!ok) throw new Error(`OpenAI: ${String(body?.error?.message ?? `error ${status}`).slice(0, 200)}`);
  const parts = (Array.isArray(body.output) ? body.output : []).flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []));
  const refusal = parts.find((part: any) => part?.type === "refusal")?.refusal;
  if (refusal) throw new Error(`OpenAI declined: ${String(refusal).slice(0, 160)}`);
  const text = body.output_text ?? parts.find((part: any) => part?.type === "output_text")?.text;
  if (typeof text !== "string") throw new Error("OpenAI sent no answer.");
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(text); } catch { throw new Error("OpenAI's answer wasn't readable JSON."); }
  const prompt = typeof parsed.prompt === "string" ? parsed.prompt.trim().slice(0, IMPROVE_MAX) : "";
  if (prompt.length < 20) throw new Error("OpenAI sent back an empty prompt.");
  return { prompt, note: typeof parsed.note === "string" ? parsed.note.replace(/\s+/g, " ").trim().slice(0, 300) : "" };
}

export interface ImproveOptions {
  apiKey: string | undefined; model?: string; instructions: string; prompt: string; blocked: string[];
  fetchImpl?: typeof fetch; timeoutMs?: number;
}

/** One call to OpenAI; an answer that breaks the rules is refused (the person keeps their prompt). */
export async function improvePrompt(o: ImproveOptions): Promise<{ prompt: string; note: string; model: string }> {
  if (!o.apiKey) throw new Error(`OpenAI isn't connected. ${addKeyMessage("OPENAI_API_KEY")}`);
  if (o.prompt.trim().length < 20 || !o.instructions.trim()) throw new Error("Nothing to improve.");
  const model = o.model || OCR_DEFAULT_MODEL;
  let out: { prompt: string; note: string };
  try {
    const response = await (o.fetchImpl ?? fetch)("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${o.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(improveRequestBody(model, o.instructions, o.prompt)),
      signal: AbortSignal.timeout(o.timeoutMs ?? 50_000),
    });
    out = parseImproveResponse(await response.json().catch(() => ({})), response.ok, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(/abort|timed? ?out/i.test(message) ? "OpenAI didn't answer in time. Try again." : message);
  }
  const problems = improveProblems(o.prompt, out.prompt, o.blocked);
  if (problems.length) throw new Error(`The rewrite broke your brand rules (${problems.join("; ")}), so your prompt was kept. Try again or edit it by hand.`);
  return { ...out, model };
}
