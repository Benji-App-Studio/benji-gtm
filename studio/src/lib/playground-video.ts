// Playground video mode's plain-text helpers (no runtime APIs, so the browser, the API and the Node
// tests share them): telling a safety-filter block apart from other failures, the advice shown with
// one, and "Soften and retry", which rewrites the prompt the way that advice says. Seedance's filter
// often blocks innocent clips (a face being washed at a sink came back "nsfw"); the words that tend to
// trip it are a bathroom setting, water "dripping", someone "leaning over", and "body".

/** What a blocked video's card says. */
export const SAFETY_BLOCK_MESSAGE =
  "The model's safety filter blocked this (often a false positive). Try: name a setting other than 'bathroom' (e.g. vanity sink, skincare routine), say the person is fully dressed, frame from the shoulders up, avoid words like 'dripping', 'leans over', 'body'.";

/** The tips under the prompt field in video mode. */
export const VIDEO_PROMPT_TIPS = [
  "If the camera is a phone propped up, describe the camera position ('low static camera on the counter, looking up') rather than saying 'phone' — otherwise the model may also draw a phone in the scene.",
  "Credits are refunded when a generation is blocked.",
];

/**
 * A job error that means Higgsfield's moderation refused the request: the API's "nsfw" status
 * (supabase/functions/creatives/core/jobs.ts afterRequestEnded) or the desktop runner's (classify in
 * scripts/creative-runner/higgsfield.ts). "ip_detected" (a protected brand or character) isn't one.
 */
export function isSafetyBlock(error: string | null | undefined): boolean {
  if (!error) return false;
  return /\bnsfw\b|moderation|safety filter|content (?:policy|filter)/i.test(error);
}

/** Keeps a replacement's first letter in the case of the word it replaces ("Bathroom" → "Vanity…"). */
const keepCase = (match: string, replacement: string) =>
  replacement && /^[A-Z]/.test(match) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;

/** Word swaps, in order (the longer phrases first, so "leans over" goes before any lone word). */
const SWAPS: [RegExp, string][] = [
  [/\b(?:in|at|inside) (?:a|the|her|his|their|my) bathroom\b/gi, "at a vanity sink"],
  [/\bbathroom sinks?\b/gi, "vanity sink"],
  [/\bbathrooms?\b/gi, "vanity sink area"],
  [/\b(?:naked|nude|topless|shirtless|undressed)\b/gi, "fully dressed"],
  [/\bdripping\b/gi, "damp"],
  // "leans over the sink" → "stands at the sink"; "she is leaning over." → "she is standing."
  [/\bleans over\b(?= (?:the|a|an|her|his|their|my|this|that)\b)/gi, "stands at"],
  [/\bleaning over\b(?= (?:the|a|an|her|his|their|my|this|that)\b)/gi, "standing at"],
  [/\bleaned over\b(?= (?:the|a|an|her|his|their|my|this|that)\b)/gi, "stood at"],
  [/\blean over\b(?= (?:the|a|an|her|his|their|my|this|that)\b)/gi, "stand at"],
  [/\bleans over\b/gi, "stands"],
  [/\bleaning over\b/gi, "standing"],
  [/\bleaned over\b/gi, "stood"],
  [/\blean over\b/gi, "stand"],
  [/\bbody wash\b/gi, "face wash"],
  [/\bbody lotion\b/gi, "moisturiser"],
  [/\b(her|his|their) body\b/gi, "$1 posture"],
  [/\b(?:the |a )?bod(?:y|ies)\b/gi, ""],
];

const PERSON = /\b(?:person|woman|women|man|men|girl|boy|guy|lady|she|he|her|him|his|they|them|someone|people|model|actor|actress|presenter|creator|face)\b/i;
export const DRESSED_LINE = "The person is fully dressed in a casual top.";
export const FRAMING_LINE = "Framed from the shoulders up.";

/**
 * The prompt with the safety advice applied: a bathroom becomes a vanity sink, "dripping" becomes
 * "damp", "leans over" becomes "stands at", "body" goes; and when someone is in the shot, a line that
 * they're fully dressed and one framing them from the shoulders up (unless the prompt already says so).
 * Running it twice changes nothing more.
 */
export function softenVideoPrompt(prompt: string): string {
  let text = prompt;
  for (const [pattern, replacement] of SWAPS) {
    text = text.replace(pattern, (match, ...groups) => keepCase(match, replacement.replace("$1", typeof groups[0] === "string" ? groups[0] : "")));
  }
  // Tidy what a removed word leaves behind ("her  is" / "wash ." / ", ,").
  text = text.split("\n").map((line) => line.replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:!?])/g, "$1").replace(/([,;:]){2,}/g, "$1").trimEnd()).join("\n").trim();
  if (!PERSON.test(text)) return text;
  const extra = [
    /\bfully dressed\b/i.test(text) ? "" : DRESSED_LINE,
    /\bshoulders? up\b/i.test(text) ? "" : FRAMING_LINE,
  ].filter(Boolean);
  if (!extra.length) return text;
  return `${/[.!?]$/.test(text) ? text : `${text}.`}\n${extra.join(" ")}`;
}
