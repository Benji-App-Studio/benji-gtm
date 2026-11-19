// A/B ad copy for a creative (POST /api/studio/creatives/[id]/copy, and "Write copy for all" in the
// Studio gallery). The route builds the request here, the `creatives` edge function asks OpenAI (it
// holds the key; core/copy.ts), and the answer is finished here before it's saved:
// - A, creator voice: lowercase, at most 100 characters, like a person posting (with the @handle and
//   #ad when the brand voice says so);
// - B, brand voice: the brand's own voice, rules and offer wording.
// Both follow every brand rule the image prompts state (lib/brand-rules.ts: banned words, "Say X, never
// Y", required phrases, the closed offers, verified facts, forbidden claims), read the words already on
// the creative (QA's OCR) and the brief, and do the awareness level's job. Substitutions are applied
// again to the answer, so a slip never reaches Meta.
// The description is never written by the model: it's the brand's description disclaimers, plus
// "AI-generated imagery." when the creative was made by a model (AI people or a generated scene).
// The first variant (A) becomes the creative's headline, primary text and description; the gallery's
// switcher picks another. Pure TypeScript: the server route and the Node tests share it.
import { cleanAwareness } from "./awareness";
import { brandRules, rulesBlock, type RulesBrand } from "./brand-rules";
import type { BrandSubstitution, BrandSystem } from "./brand-system";
import type { AwarenessLevel, CopyVariant, CopyVoice } from "./creative-types";

export const COPY_LIMITS = { creatorPrimary: 100, primary: 600, headline: 80, description: 300, brief: 1200, textSeen: 30, instructions: 8000, input: 8000 };

/** Added to the description of anything a model made. */
export const AI_IMAGERY_LINE = "AI-generated imagery.";

/** What each awareness level's copy has to do (lib/awareness.ts has the levels and what the image or video must do). */
export const AWARENESS_COPY: Record<AwarenessLevel, { name: string; job: string }> = {
  1: { name: "Unaware", job: "they don't know they have the problem yet: open on a relatable moment or story in their words; the product comes late and softly" },
  2: { name: "Problem aware", job: "they feel the problem: name it in their words, make it sting a little, then show there's a way out" },
  3: { name: "Solution aware", job: "they know fixes exist: show why this kind of fix, and ours, beats what they've tried" },
  4: { name: "Product aware", job: "they know us: proof (a verified fact, a real review) and the answer to their main doubt" },
  5: { name: "Most aware", job: "they're ready: the offer, word for word, and one clear call to action" },
};

/** Creatives a model made (AI people, generated scenes): images and videos from a job, not rendered posts. */
export function isAiGenerated(c: { style: string; model?: string | null; job_id?: string | null }): boolean {
  return ["image", "ugc_video", "ai_video"].includes(c.style) && Boolean(c.model || c.job_id);
}

/** The description every variant carries: the brand's disclaimers, then the AI line when a model made it. */
export function defaultDescription(sys: Pick<BrandSystem, "descriptionDisclaimers"> | null | undefined, aiGenerated: boolean): string {
  const lines = [...(sys?.descriptionDisclaimers ?? []).map((l) => l.trim()).filter(Boolean)];
  if (aiGenerated && !lines.some((l) => l.toLowerCase().includes("ai-generated"))) lines.push(AI_IMAGERY_LINE);
  return clip(lines.map((l) => (/[.!?]$/.test(l) ? l : `${l}.`)).join(" "), COPY_LIMITS.description);
}

export interface CopyRequestInput {
  appName: string;
  /** The merged brand (lib/brand.ts MergedBrand: kit.appName, forbiddenClaims, system, profile). */
  brand: RulesBrand;
  /** The batch's brief, and the prompt the creative was made from. */
  brief?: string | null;
  prompt?: string | null;
  /** The words QA read on the creative. */
  textSeen?: string[] | null;
  awarenessLevel?: number | null;
  /** The call to action Launch will use ("Download"). */
  cta?: string | null;
  kind: "image" | "video" | "post";
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : text);
const one = (text: string | null | undefined, max: number) => clip((text ?? "").replace(/\s+/g, " ").trim(), max);

/**
 * What the edge function sends OpenAI: `instructions` (who writes, the two voices, every brand rule)
 * and `input` (this creative: what's on it, the brief, the awareness level). Plain text, capped.
 */
export function copyRequest(o: CopyRequestInput): { instructions: string; input: string } {
  const rules = brandRules(o.brand, { brief: o.brief ?? "" });
  const sys = rules.system;
  const v = sys?.voice;
  const voiceLines = [
    v?.oneLine ? `- Brand voice: ${one(v.oneLine, 300)}` : "",
    v?.rules.length ? `- Voice rules: ${v.rules.slice(0, 6).map((r) => one(r, 160)).join("; ")}` : "",
    v?.use.length ? `- Words the brand likes: ${v.use.slice(0, 12).join(", ")}` : "",
    v?.signatureLines.length ? `- Signature lines (may be used as written): ${v.signatureLines.slice(0, 4).map((l) => `"${one(l, 100)}"`).join("; ")}` : "",
    v?.examples.length ? `- Example copy in the brand voice: ${v.examples.slice(0, 3).map((l) => `"${one(l, 200)}"`).join("; ")}` : "",
    v?.dos.length ? `- Do: ${v.dos.slice(0, 5).map((l) => one(l, 140)).join("; ")}` : "",
    v?.donts.length ? `- Don't: ${v.donts.slice(0, 5).map((l) => one(l, 140)).join("; ")}` : "",
  ].filter(Boolean);
  const instructions = [
    `You write Meta (Facebook and Instagram) ad copy for "${o.appName}". Write two versions for one ad:`,
    `- A (creator voice): sounds like a real person posting about it, not a brand. All lowercase, first person, casual, at most ${COPY_LIMITS.creatorPrimary} characters of primary text. If the brand voice mentions a creator @handle or #ad, include them.`,
    "- B (brand voice): the brand's own voice below; primary text of 1–3 short sentences.",
    "Each has primary_text (above the ad) and headline (under it, at most 40 characters, the hook or the offer). No hashtags except #ad, no emojis unless the brand voice uses them.",
    "The copy must agree with what's on the ad itself; never contradict it. Don't repeat the on-image words verbatim in both versions.",
    "Never write disclaimers such as \"Results vary\": they go in the description, which is written separately.",
    "Never invent a price, discount, number, rating, review or timeline. Use only the offers and facts given, word for word.",
    voiceLines.length ? ["BRAND VOICE:", ...voiceLines].join("\n") : "",
    rulesBlock(rules),
  ].filter(Boolean).join("\n\n");
  const lvl = cleanAwareness(o.awarenessLevel);
  const seen = (o.textSeen ?? []).map((t) => one(t, 200)).filter(Boolean).slice(0, COPY_LIMITS.textSeen);
  const input = [
    `Ad type: ${o.kind === "video" ? "video" : o.kind === "post" ? "a social post rendered as an image" : "static image"}.`,
    seen.length ? `Words on the ad (read off the image, as written):\n${seen.map((t) => `- ${t}`).join("\n")}` : "Words on the ad: not read yet.",
    o.brief?.trim() ? `Brief: ${one(o.brief, COPY_LIMITS.brief)}` : "",
    o.prompt?.trim() && o.prompt.trim() !== o.brief?.trim() ? `How it was made (the generation prompt, for context only): ${one(o.prompt, 900)}` : "",
    lvl ? `Awareness level ${lvl} (${AWARENESS_COPY[lvl].name}): ${AWARENESS_COPY[lvl].job}.` : "",
    o.cta?.trim() ? `Call-to-action button: ${one(o.cta, 40)}.` : "",
  ].filter(Boolean).join("\n\n");
  return { instructions: clip(instructions, COPY_LIMITS.instructions), input: clip(input, COPY_LIMITS.input) };
}

/** Each substitution applied: whole words, case-insensitive, the replacement capitalised like the word it replaces. */
export function applySubstitutions(text: string, subs: BrandSubstitution[] | null | undefined): string {
  let out = text;
  for (const s of subs ?? []) {
    if (!s.avoid.trim() || !s.use.trim()) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${s.avoid.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu");
    out = out.replace(pattern, (found) => (found[0] === found[0].toUpperCase() && found[0] !== found[0].toLowerCase() ? s.use.charAt(0).toUpperCase() + s.use.slice(1) : s.use));
  }
  return out;
}

/**
 * A creator-voice line: lowercase and at most 100 characters, cut before the @handles and #ad so those
 * always stay at the end.
 */
export function creatorLine(text: string): string {
  const lower = text.toLowerCase().trim();
  const tags = [...new Set(lower.match(/(?<![\w@#])(?:@[\w.]+|#ad)\b/g) ?? [])].join(" ");
  if (lower.length <= COPY_LIMITS.creatorPrimary) return lower;
  const body = lower.replace(/(?<![\w@#])(?:@[\w.]+|#ad)\b/g, "").replace(/\s+/g, " ").trim();
  const room = COPY_LIMITS.creatorPrimary - (tags ? tags.length + 1 : 0);
  return [clip(body, Math.max(20, room)), tags].filter(Boolean).join(" ").slice(0, COPY_LIMITS.creatorPrimary);
}

/**
 * The model's answer finished: A lowercased and cut to 100 characters, B as written; substitutions
 * applied; every variant carries the default description. Missing or empty variants are dropped.
 */
export function finishCopy(raw: unknown, o: { system: BrandSystem | null; aiGenerated: boolean }): CopyVariant[] {
  const list = Array.isArray((raw as { variants?: unknown })?.variants) ? (raw as { variants: unknown[] }).variants : Array.isArray(raw) ? raw : [];
  const description = defaultDescription(o.system, o.aiGenerated);
  const subs = o.system?.voice.substitutions ?? [];
  const out: CopyVariant[] = [];
  for (const item of list) {
    const x = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const label = typeof x.label === "string" && /^[A-Z]$/.test(x.label.trim().toUpperCase()) ? x.label.trim().toUpperCase() : String.fromCharCode(65 + out.length);
    const voice: CopyVoice = x.voice === "brand" || x.voice === "creator" ? x.voice : label === "A" ? "creator" : "brand";
    let primary = applySubstitutions(one(typeof x.primary_text === "string" ? x.primary_text : "", COPY_LIMITS.primary), subs);
    let headline = applySubstitutions(one(typeof x.headline === "string" ? x.headline : "", COPY_LIMITS.headline), subs);
    if (voice === "creator") {
      primary = creatorLine(primary);
      headline = headline.toLowerCase();
    }
    if (!primary || out.some((v) => v.label === label)) continue;
    out.push({ label, voice, primary_text: primary, headline, description });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label)).slice(0, 4);
}

/** Stored copy variants made safe (creatives.copy_variants). */
export function cleanCopyVariants(raw: unknown): CopyVariant[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const x = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const label = typeof x.label === "string" ? x.label.trim().slice(0, 4) : "";
    if (!label) return [];
    return [{
      label, voice: x.voice === "creator" ? "creator" as const : "brand" as const,
      primary_text: typeof x.primary_text === "string" ? x.primary_text.slice(0, 2200) : "",
      headline: typeof x.headline === "string" ? x.headline.slice(0, 255) : "",
      description: typeof x.description === "string" ? x.description.slice(0, 1000) : "",
    }];
  }).slice(0, 6);
}

/** Which variant the creative's own copy is now (its headline, primary text and description match), or null. */
export function chosenVariant(c: { headline: string | null; primary_text: string | null; description?: string | null; copy_variants?: CopyVariant[] | null }): string | null {
  const v = (c.copy_variants ?? []).find((x) => x.primary_text === (c.primary_text ?? "") && x.headline === (c.headline ?? "") && x.description === (c.description ?? ""));
  return v?.label ?? null;
}
