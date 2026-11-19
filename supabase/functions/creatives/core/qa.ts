// QA for one creative, before a person approves it. Cheap checks run first in code (the app name and
// its spelling, competitor and blocked names, text size and contrast, obvious claim phrases); then Jev
// answers the judgment calls in one request (wrong app, competitors, personal attributes, fake
// testimonials, fake UI, the category's claim rules and the workspace's forbidden claims). Each
// check maps to POLICY.md rule IDs. Jev reads text, not pixels: the text is what we put in the
// creative (template copy), what OCR read off it (the runner's macOS Vision, or OpenAI vision on the
// server for images, core/ocr.ts) and the brief it was made from.
// Static generation v2 (docs/STATIC_GEN_V2.md, WS2) adds checks for what manual QA caught
// Wave 4: misspelled words against the text we asked for (spelling), text in Meta's 9:16 unsafe zones
// (safe_zone), a redrawn logo (logo), numbers no verified fact backs (facts), the brand's wording rules
// (wording), people without confirmed consent or who may be minors (people), statics missing part of
// the pitch (completeness), and the ad copy Launch sends (primary text, headline, description, A/B
// variants: ad_copy). Each runs only when its part of the frozen context is there, so older batches
// are checked as before.
import type { Judge } from "../../_shared/ai/judge.ts";
import { noul, type Questions } from "../../_shared/ai/questions.ts";
import { THRESHOLDS, thresholdsFor } from "../../_shared/ai/thresholds.ts";
import type { AdCopy, CheckVerdict, CopyVariant, KnownCopy, NormBox, OcrLine, PolicyProfile, QaCheck, QaContext, QaInput, QaReport, QaViolation, Verdict } from "./types.ts";

/** The judge QA asks (_shared/ai): OpenAI, or TypeSafe's Jev, which this code was first written for and still names. */
export type Jev = Judge;

/**
 * The judge's probability at or above which a check fails, and at or above which it warns. These are
 * the TypeSafe values; runQa uses the ones for the judge it is given (_shared/ai/thresholds.ts).
 */
export const FAIL_AT = THRESHOLDS.typesafe.qa.failAt;
export const WARN_AT = THRESHOLDS.typesafe.qa.warnAt;

/** Readability thresholds (shares of the image height, WCAG contrast ratios). */
export const READABILITY = { tinyHeadline: 0.015, smallLine: 0.02, smallShare: 0.5, lowContrast: 2.5, lowContrastShare: 0.4, unreadableHeadline: 1.6, garbled: 0.5 };

/**
 * Meta's 9:16 safe zone (studio/src/lib/meta-formats.ts stories_reels): text stays out of the top 14%,
 * the bottom 35% and 6% each side. `slack` forgives a box edge that grazes a line (shares of the image);
 * text smaller than `smallText` (UI inside a drawn phone, fine print) in the unsafe area warns instead
 * of failing; text covering at least `faceOverlap` of its box with a face warns.
 */
export const SAFE_ZONE = { top: 0.14, bottom: 0.35, sides: 0.06, slack: 0.01, smallText: 0.015, faceOverlap: 0.2 };

/**
 * Spelling against the intended text: words of at least `minLength` letters are compared; one edit
 * counts as a misspelling, two from `longWord` letters on. A word must share its first letter with the
 * intended one unless it is at least `anyStart` letters long.
 */
export const SPELLING = { minLength: 5, longWord: 9, anyStart: 7 };

/** The judge's probability at or above which a part of a static's pitch counts as missing (a warning). The TypeSafe value, as above. */
export const MISSING_AT = THRESHOLDS.typesafe.qa.missingAt;

const RANK: Record<CheckVerdict, number> = { skipped: 0, pass: 1, warn: 2, fail: 3 };
export const worst = (verdicts: CheckVerdict[]): Verdict => {
  const top = verdicts.reduce<CheckVerdict>((a, b) => (RANK[b] > RANK[a] ? b : a), "pass");
  return top === "skipped" ? "pass" : top;
};

// MARK: Text

export const normalise = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const collapse = (text: string) => normalise(text).replace(/ /g, "");

/** Does `text` contain `name` as whole words (or, for longer names, written as one word)? */
export function mentions(text: string, name: string): boolean {
  const n = normalise(name);
  if (!n) return false;
  const t = ` ${normalise(text)} `;
  if (t.includes(` ${n} `)) return true;
  const c = n.replace(/ /g, "");
  return c.length >= 5 && n.includes(" ") && ` ${t.replace(/ /g, "")} `.includes(c);
}

export function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = next;
    }
  }
  return row[b.length];
}

/** Words in `text` that look like a misspelling of `name` (AI-drawn text often garbles it). */
export function misspellings(text: string, name: string): string[] {
  const target = collapse(name);
  if (target.length < 5) return [];
  const words = normalise(text).split(" ").filter(Boolean);
  const candidates = new Set<string>([...words, ...words.slice(1).map((w, i) => words[i] + w)]);
  const allowed = target.length >= 12 ? 2 : 1;
  return [...candidates].filter((w) => w !== target && Math.abs(w.length - target.length) <= allowed && levenshtein(w, target) <= allowed);
}

/**
 * The brand's own rules inside a brief ("NEVER INCLUDE: …", "Never claim: …", "Words we never use: …",
 * "Offers: …", "We do NOT offer: …"): they name exactly what must not appear, so the brief's checks
 * (competitors, blocked names, phrases, prices) and Jev skip them. Bullets ("- ") count too.
 */
const BRIEF_RULE = /^\s*(?:[-*•]\s*)?(?:never\b|words we never use\b|offers\s*:|we do not offer\b|avoid\s*:|must avoid\s*:)/i;
/**
 * The Studio's own description of the product inside a prompt (studio/src/lib/product-insight.ts
 * profileBrief: the "ABOUT THE PRODUCT" head and its "- What it is:", "- For:", "- Look:" and "- Voice:"
 * lines). They describe the app from its website ("…for people seeking treatment for acne"), not what
 * the creative says, and the app's description already reaches Jev as `app_description`; read as the
 * brief they made every health creative "claim treatment" and named generic words as competitors.
 * The "- Promise:" and "- Proof" lines stay: the creative may say those.
 */
const BRIEF_CONTEXT = /^\s*(?:ABOUT THE PRODUCT\b|-\s*(?:What it is|For|Look|Voice)\s*:)/;
export const stripBriefRules = (brief: string) => brief.split("\n").filter((line) => !BRIEF_RULE.test(line) && !BRIEF_CONTEXT.test(line)).join("\n").trim();

/**
 * The words we placed on this creative ourselves: the frozen intended text (Style Library quotes,
 * template slots, the batch's composed copy) plus what a composed ad was last set with (copy.composed,
 * which "Edit text" can change after the batch froze its context) and the headline and body we know.
 */
export function placedText(input: QaInput, ctx: Pick<QaContext, "intendedText">): string[] {
  const copy = input.copy ?? {};
  const composed = copy.composed?.copy && typeof copy.composed.copy === "object" ? Object.values(copy.composed.copy) : [];
  return [...(ctx.intendedText ?? []), ...composed, copy.headline, copy.body]
    .filter((t): t is string => typeof t === "string" && Boolean(t.trim()));
}

/**
 * Generated media no OCR read (no OCR result, or `engine: "none"`: a server-made video, or a read that failed): what's on screen
 * is unknown, so text checks can't pass it. Social-post templates are rendered from known copy.
 */
export const textUnread = (input: QaInput) => input.style !== "reddit" && input.style !== "tweet" && (!input.ocr || input.ocr.engine === "none");
/** Unread, and no copy of ours (a composed headline or body) to check instead. */
const nothingRead = (input: QaInput) => textUnread(input) && !(input.copy?.headline || input.copy?.body);

/** Every distinct piece of text the creative carries, with where it came from. */
export function textOf(input: QaInput): { onScreen: string[]; ocrLines: OcrLine[]; brief: string } {
  const copy: KnownCopy = input.copy ?? {};
  const known = [copy.community, copy.author, copy.headline, copy.body, copy.hook].filter((t): t is string => Boolean(t?.trim()));
  const ocrLines = (input.ocr?.lines ?? []).filter((l) => l.confidence >= 0.3 && l.text.trim().length >= 2);
  const seen = new Set<string>();
  const onScreen: string[] = [];
  for (const line of [...known, ...ocrLines.map((l) => l.text)]) {
    const key = normalise(line);
    if (key && !seen.has(key)) { seen.add(key); onScreen.push(line.trim()); }
  }
  return { onScreen, ocrLines, brief: stripBriefRules(input.prompt ?? "") };
}

// MARK: Checks in code

export function brandCheck(input: QaInput, ctx: QaContext): QaCheck {
  const { onScreen, brief } = textOf(input);
  const all = onScreen.join("\n");
  const blocked = (ctx.blockedNames ?? []).filter((name) => mentions(all, name) || mentions(brief, name));
  const rules = ctx.policy === "immigration_tax" ? ["BW-6"] : ["BRAND"];
  if (blocked.length) return { id: "brand_name", label: "App name", verdict: "fail", rules, reason: `Uses a name the brand must never use: ${blocked.join(", ")}.`, evidence: blocked.join(", ") };
  const names = [ctx.appName, ...(ctx.aliases ?? [])];
  const typos = names.flatMap((name) => misspellings(all, name));
  if (typos.length) return { id: "brand_name", label: "App name", verdict: "fail", rules, reason: `"${ctx.appName}" looks misspelled on screen: ${[...new Set(typos)].join(", ")}.`, evidence: typos[0] };
  if (names.some((name) => mentions(all, name))) return { id: "brand_name", label: "App name", verdict: "pass", rules, reason: `"${ctx.appName}" is on screen and spelled right.` };
  if (textUnread(input)) {
    return { id: "brand_name", label: "App name", verdict: "warn", rules, reason: "Not read: no OCR ran on this creative, so the app name on screen couldn't be checked. Look for it before approving." };
  }
  return { id: "brand_name", label: "App name", verdict: "warn", rules, reason: `"${ctx.appName}" isn't on screen. Fine for a hook-only cut; make sure the end card or caption names it.` };
}

export function competitorNameCheck(input: QaInput, ctx: QaContext): QaCheck {
  const { onScreen, brief } = textOf(input);
  const all = onScreen.join("\n");
  const shown = ctx.competitors.filter((name) => mentions(all, name));
  const asked = ctx.competitors.filter((name) => !shown.includes(name) && mentions(brief, name));
  if (shown.length) return { id: "competitor_names", label: "Competitor names", verdict: "fail", rules: ["IP-2", "IP-5"], reason: `Names a competitor on screen: ${shown.join(", ")}.`, evidence: shown.join(", ") };
  if (asked.length) return { id: "competitor_names", label: "Competitor names", verdict: "warn", rules: ["IP-2", "IP-5"], reason: `The brief names a competitor (${asked.join(", ")}); check the video doesn't say or show it.`, evidence: asked.join(", ") };
  if (nothingRead(input)) return { id: "competitor_names", label: "Competitor names", verdict: "warn", rules: ["IP-2", "IP-5"], reason: "Not read: no OCR ran on this creative, so competitor names on screen couldn't be checked. Look before approving." };
  return { id: "competitor_names", label: "Competitor names", verdict: "pass", rules: ["IP-2", "IP-5"], reason: ctx.competitors.length ? `None of ${ctx.competitors.length} competitors named.` : "No competitor list for this workspace yet; only the AI check applies." };
}

export function readabilityCheck(input: QaInput): QaCheck {
  const base = { id: "readability", label: "Readable text", rules: ["READ"] };
  const copy = input.copy ?? {};
  if (copy.minTextFrac != null) {
    const small = copy.minTextFrac < READABILITY.smallLine;
    const faint = (copy.contrast ?? 21) < 4.5;
    return { ...base, verdict: small || faint ? "warn" : "pass", reason: `Rendered from a template: smallest text ${(copy.minTextFrac * 100).toFixed(1)}% of the height, contrast ${(copy.contrast ?? 21).toFixed(1)}:1.` };
  }
  if (!input.ocr || input.ocr.engine === "none") return { ...base, verdict: "skipped", reason: input.ocr?.error ? `Text wasn't read: ${input.ocr.error}` : "Text wasn't read (no OCR for this creative)." };
  // The server's vision model estimates sizes and contrast (macOS Vision measures them): never a fail on those alone.
  if (input.ocr.engine === "openai") {
    const measured = readabilityCheck({ ...input, ocr: { ...input.ocr, engine: "vision" } });
    return { ...measured, verdict: measured.verdict === "fail" ? "warn" : measured.verdict, reason: `Estimated from a vision model's read: ${measured.reason}` };
  }
  const lines = input.ocr.lines.filter((l) => l.text.trim().length >= 2);
  if (!lines.length) return { ...base, verdict: "pass", reason: input.kind === "video" ? `No on-screen text in ${input.ocr.frames} sampled frames.` : "No on-screen text." };
  const chars = (ls: OcrLine[]) => ls.reduce((n, l) => n + l.text.length, 0);
  const total = chars(lines);
  const headline = lines.reduce((a, b) => (b.heightFrac > a.heightFrac ? b : a));
  const smallShare = chars(lines.filter((l) => l.heightFrac < READABILITY.smallLine)) / total;
  const faintShare = chars(lines.filter((l) => l.contrast < READABILITY.lowContrast)) / total;
  const confidence = lines.reduce((n, l) => n + l.confidence * l.text.length, 0) / total;
  const problems: string[] = [];
  let verdict: Verdict = "pass";
  if (headline.heightFrac < READABILITY.tinyHeadline) { verdict = "fail"; problems.push(`even the largest text ("${headline.text.slice(0, 40)}") is only ${(headline.heightFrac * 100).toFixed(1)}% of the height`); }
  if (headline.contrast < READABILITY.unreadableHeadline) { verdict = "fail"; problems.push(`the main text has almost no contrast (${headline.contrast.toFixed(1)}:1)`); }
  if (smallShare > READABILITY.smallShare) { if (verdict === "pass") verdict = "warn"; problems.push(`${Math.round(smallShare * 100)}% of the text is small for a phone`); }
  if (faintShare > READABILITY.lowContrastShare) { if (verdict === "pass") verdict = "warn"; problems.push(`${Math.round(faintShare * 100)}% of the text has low contrast`); }
  if (confidence < READABILITY.garbled) { if (verdict === "pass") verdict = "warn"; problems.push("the text reads as garbled (AI-drawn letters?)"); }
  return {
    ...base, verdict,
    reason: problems.length ? `${problems.join("; ")}.` : `Largest text ${(headline.heightFrac * 100).toFixed(1)}% of the height at ${headline.contrast.toFixed(1)}:1 contrast.`,
    evidence: headline.text.slice(0, 80),
  };
}

const PHRASES: Record<PolicyProfile, { pattern: RegExp; rule: string; label: string }[]> = {
  immigration_tax: [
    { pattern: /\b(guarantee[sd]?|100% (legal|approved|approval)|never (get )?(deported|fined|banned)|stay legal)\b/i, rule: "BW-1", label: "guaranteed outcome" },
    { pattern: /\b(avoid (paying )?tax(es)?|tax[- ]free|pay (zero|no) tax|visa approv\w*|get (your )?(visa|residency|citizenship|green card))\b/i, rule: "BW-1", label: "promised visa or tax outcome" },
    { pattern: /\b(lawyer[- ]approved|legal advice|tax advice|we('| wi)ll tell you if you owe)\b/i, rule: "BW-2", label: "legal or tax advice" },
    { pattern: /\b(deport\w*|banned for \d+ years?|you('| wi)ll be (fined|banned|deported))\b/i, rule: "BW-4", label: "fear-based threat" },
  ],
  health: [
    { pattern: /\b(cure[sd]?|heal(s|ed)?|treat(s|ed|ment)?|prevent(s|ed)?|diagnos\w*|revers(e|es|ed))\b/i, rule: "NH-1", label: "medical claim" },
    { pattern: /\b(guaranteed results?|results guaranteed|clinically proven|in \d+ (days|weeks))\b/i, rule: "NH-2", label: "guaranteed result or timeframe" },
    { pattern: /\bbefore\s*(and|&|\/)\s*after\b/i, rule: "NH-4", label: "before/after" },
    { pattern: /\b(dr\.?|doctor|dermatologist)\b/i, rule: "NH-5", label: "clinician" },
  ],
  general: [],
};
const PRICE = /(\$|€|£)\s?\d|\b\d+\s?(%|percent) off\b|\bfree trial\b|\b\d+[- ]day trial\b|\bdiscount\b|\bper (month|year)\b|\/(mo|yr)\b/i;

/** Prices, discounts, trials, codes and deadlines in a piece of text. */
const OFFER_BITS = /(?:US)?[$€£¥₹]\s?\d[\d.,]*(?:\s?\/\s?(?:mo|month|yr|year|week|wk|day))?|\b\d{1,3}\s?(?:%|percent)\s?off\b|\b(?:free|\d+[- ]day)\s+trial\b|\b(?:promo|discount|coupon)\s+code\b|\bcode\s+[A-Z0-9]{4,}\b|\b(?:today only|limited[- ]time|ends (?:today|tonight|soon))\b|\b(?:buy one|bogo|half[- ]price)\b/gi;

/**
 * The brand system's closed offer list (ctx.offers): a price, discount, trial, code or deadline on
 * screen that isn't one of the allowed offers' wordings fails; one the brand says it doesn't offer fails.
 */
export function offerCheck(input: QaInput, ctx: QaContext): QaCheck {
  const base = { id: "offers", label: "Only our offers", rules: ["OFFER"] };
  const offers = ctx.offers!;
  const { onScreen } = textOf(input);
  const allowed = offers.allowed.map(normalise).filter(Boolean);
  // A price that is one of the brand's verified facts ("$250+ a visit", "$59/mo") is a fact, not a deal:
  // the facts check holds it to the list; here it isn't a stray offer.
  const factPrices = verifiedNumbers((ctx.facts ?? []).map((f) => f.value)).prices;
  const isFact = (bit: string) => numberClaims(bit).some((c) => c.kind === "price" && factPrices.has(c.value));
  const stray: string[] = [];
  for (const line of onScreen) {
    const n = normalise(line);
    for (const m of line.matchAll(OFFER_BITS)) if (!allowed.some((a) => a.includes(normalise(m[0])) && n.includes(normalise(m[0]))) && !isFact(m[0])) stray.push(m[0].trim());
  }
  const refused = offers.notOffered.filter((x) => x.trim().length >= 4 && onScreen.some((line) => normalise(line).includes(normalise(x))));
  if (refused.length) return { ...base, verdict: "fail", reason: `Shows something the brand doesn't offer: ${refused.join(", ")}.`, evidence: refused[0] };
  if (stray.length) return { ...base, verdict: "fail", reason: `Shows an offer that isn't in the brand's offer list: ${[...new Set(stray)].join(", ")}. Allowed: ${offers.allowed.slice(0, 4).join("; ") || "none"}.`, evidence: stray[0] };
  if (nothingRead(input)) {
    return { ...base, verdict: "warn", reason: "Not read: no OCR ran on this creative, so offers couldn't be checked against the list. Check any price or offer before approving." };
  }
  return { ...base, verdict: "pass", reason: offers.allowed.length ? "No price or offer outside the brand's list." : "No price or offer shown (the brand lists none)." };
}

/** Words the brand's voice never uses (ctx.avoidWords): one on screen warns. */
export function voiceCheck(input: QaInput, ctx: QaContext): QaCheck {
  const { onScreen } = textOf(input);
  const all = normalise(onScreen.join("\n"));
  const used = (ctx.avoidWords ?? []).filter((w) => new RegExp(`(?<![a-z0-9])${normalise(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(all));
  if (used.length) return { id: "voice", label: "Brand voice", rules: ["VOICE"], verdict: "warn", reason: `Uses words the brand never uses: ${used.join(", ")}.`, evidence: used[0] };
  if (nothingRead(input)) return { id: "voice", label: "Brand voice", rules: ["VOICE"], verdict: "warn", reason: "Not read: no OCR ran on this creative, so the brand's banned words couldn't be checked on screen." };
  return { id: "voice", label: "Brand voice", rules: ["VOICE"], verdict: "pass", reason: "None of the brand's banned words on screen." };
}

/** Obvious claim phrases, as a backstop to Jev: a match warns (Jev decides whether it fails). */
export function phraseHits(input: QaInput, ctx: QaContext): { rule: string; label: string; text: string; where: string }[] {
  const { onScreen, brief } = textOf(input);
  const hits: { rule: string; label: string; text: string; where: string }[] = [];
  const scan = (text: string, where: string) => {
    for (const p of PHRASES[ctx.policy]) {
      const m = text.match(p.pattern);
      if (m) hits.push({ rule: p.rule, label: p.label, text: m[0], where });
    }
    ctx.forbiddenClaims.forEach((claim, i) => { if (claim.trim() && normalise(text).includes(normalise(claim))) hits.push({ rule: `WS-${i + 1}`, label: "forbidden claim", text: claim, where }); });
  };
  onScreen.forEach((line) => scan(line, "on screen"));
  if (brief) scan(brief, "brief");
  return hits;
}

// MARK: Ad copy and wording

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does `text` say `phrase` (whole words, any case or accents; a plural "s"/"es" counts)? */
export function says(text: string, phrase: string): boolean {
  const p = normalise(phrase);
  return Boolean(p) && new RegExp(`(?<![a-z0-9])${escapeRe(p)}(?:e?s)?(?![a-z0-9])`).test(normalise(text));
}

const isPost = (input: QaInput) => input.style === "reddit" || input.style === "tweet";

/** The ad's text outside the image, each piece with where it is ("headline", "variant B primary text"…). */
export function adCopyTexts(input: QaInput): { where: string; text: string }[] {
  const copy = input.adCopy;
  if (!copy) return [];
  const out: { where: string; text: string }[] = [];
  const add = (where: string, text: string | null | undefined) => { if (typeof text === "string" && text.trim()) out.push({ where, text: text.trim().slice(0, 3000) }); };
  add("primary text", copy.primaryText);
  add("headline", copy.headline);
  add("description", copy.description);
  (copy.variants ?? []).slice(0, 8).forEach((v, i) => {
    const name = `variant ${(v?.label ?? "").trim().slice(0, 4) || i + 1}`;
    add(`${name} primary text`, v?.primary_text);
    add(`${name} headline`, v?.headline);
    add(`${name} description`, v?.description);
  });
  return out;
}

/** On-screen text and the ad copy, each with where it is. */
const everyText = (input: QaInput) => [...textOf(input).onScreen.map((text) => ({ where: "on screen", text })), ...adCopyTexts(input)];

/**
 * The brand's wording rules (ctx.substitutions, ctx.requiredPhrases) over the image and the ad copy: a
 * word to avoid fails with the one to say instead; a trigger word without its required phrase warns.
 */
export function wordingCheck(input: QaInput, ctx: QaContext): QaCheck {
  const base = { id: "wording", label: "Brand wording", rules: ["WORDING"] };
  const texts = everyText(input);
  // With our real product in the picture, on-image text that isn't ours (none of the words we placed:
  // intended text, composed copy) is its printed packaging ("Personalized nighttime formula" on the
  // bottle), which no wording rule can change: it warns instead of failing.
  const ours = normalise(placedText(input, ctx).join("\n"));
  const notOurs = (t: { where: string; text: string }) => Boolean(input.realProduct) && t.where === "on screen" && Boolean(ours) && !ours.includes(normalise(t.text));
  const wrong: { avoid: string; use: string; note?: string; where: string[]; printed: string[] }[] = [];
  for (const sub of ctx.substitutions ?? []) {
    if (!sub?.avoid?.trim() || !sub.use?.trim()) continue;
    // "custom prescription" mustn't count as saying "prescription" when that's the word to avoid.
    const hits = texts.filter((t) => says(normalise(t.text).replace(new RegExp(`(?<![a-z0-9])${escapeRe(normalise(sub.use))}(?![a-z0-9])`, "g"), " "), sub.avoid));
    const mine = hits.filter((t) => !notOurs(t));
    if (hits.length) wrong.push({ ...sub, where: [...new Set(mine.map((t) => t.where))], printed: hits.filter(notOurs).map((t) => t.text) });
  }
  const placed = wrong.filter((w) => w.where.length);
  if (placed.length) {
    return {
      ...base, verdict: "fail", evidence: placed[0].avoid,
      reason: placed.map((w) => `Say '${w.use}', not '${w.avoid}' (${w.where.join(", ")})${w.note ? `: ${w.note}` : ""}.`).join(" "),
    };
  }
  if (wrong.length) {
    return {
      ...base, verdict: "warn", evidence: wrong[0].avoid,
      reason: wrong.map((w) => `'${w.avoid}' is on the image in text we didn't write ("${w.printed[0].slice(0, 60)}"): fine if it's printed on the real product; if the model wrote it, regenerate.`).join(" "),
    };
  }
  const all = texts.map((t) => t.text).join("\n");
  const missing = (ctx.requiredPhrases ?? []).filter((r) => r?.when?.trim() && r.phrase?.trim() && says(all, r.when) && !says(all, r.phrase));
  if (missing.length) {
    return { ...base, verdict: "warn", evidence: missing[0].when, reason: missing.map((r) => `It says "${r.when}" but not "${r.phrase}" (on screen or in the copy).`).join(" ") };
  }
  if (nothingRead(input) && !adCopyTexts(input).length) return { ...base, verdict: "warn", reason: "Not read: no OCR ran on this creative, so the brand's wording rules couldn't be checked on screen." };
  return { ...base, verdict: "pass", reason: "Follows the brand's wording rules." };
}

/**
 * The ad copy Launch sends (primary text, headline, description, A/B variants): the brand's banned
 * words warn, a forbidden claim fails, the category's claim phrases warn (Jev reads the copy too).
 */
export function adCopyCheck(input: QaInput, ctx: QaContext): QaCheck {
  const base = { id: "ad_copy", label: "Ad copy", rules: ["COPY"] };
  const texts = adCopyTexts(input);
  if (!texts.length) return { ...base, verdict: "skipped", reason: "No ad copy written yet." };
  const claims: string[] = [];
  const banned: string[] = [];
  const phrases: string[] = [];
  for (const t of texts) {
    for (const claim of ctx.forbiddenClaims) if (claim.trim() && normalise(t.text).includes(normalise(claim))) claims.push(`"${claim}" (${t.where})`);
    for (const word of ctx.avoidWords ?? []) if (says(t.text, word)) banned.push(`"${word}" (${t.where})`);
    for (const p of PHRASES[ctx.policy]) { const m = t.text.match(p.pattern); if (m) phrases.push(`"${m[0]}" reads as a ${p.label} (${t.where}, ${p.rule})`); }
  }
  const uniq = (l: string[]) => [...new Set(l)];
  if (claims.length) return { ...base, verdict: "fail", evidence: claims[0], reason: `The copy makes a claim the brand forbids: ${uniq(claims).join("; ")}.` };
  if (banned.length || phrases.length) {
    return {
      ...base, verdict: "warn", evidence: (banned[0] ?? phrases[0]),
      reason: [banned.length ? `Uses words the brand never uses: ${uniq(banned).join(", ")}.` : "", phrases.length ? `${uniq(phrases).join("; ")}.` : ""].filter(Boolean).join(" "),
    };
  }
  return { ...base, verdict: "pass", reason: `${texts.length} piece${texts.length === 1 ? "" : "s"} of copy: no banned words or forbidden claims.` };
}

// MARK: Spelling

/** The words of `text` worth comparing (letters only, at least SPELLING.minLength), keyed by their normalised form. */
function spellWords(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\s+/)) {
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    const key = collapse(word);
    if (key.length >= SPELLING.minLength && /^[a-z]+$/.test(key) && !out.has(key)) out.set(key, word);
  }
  return out;
}

/** The intended word `seen` is a misspelling of, if any. */
function misspelledFrom(seen: string, intended: Map<string, string>): string | null {
  let best: { word: string; d: number } | null = null;
  for (const [key, word] of intended) {
    const allowed = key.length >= SPELLING.longWord ? 2 : 1;
    if (Math.abs(key.length - seen.length) > allowed || (seen[0] !== key[0] && key.length < SPELLING.anyStart)) continue;
    const d = levenshtein(seen, key);
    if (d > 0 && d <= allowed && (!best || d < best.d)) best = { word, d };
  }
  return best?.word ?? null;
}

/** A read line on a real-product creative with two or more words, none of them ours: the product's own label. */
function packaging(input: QaInput, words: Map<string, string>, intended: Map<string, string>): boolean {
  return Boolean(input.realProduct) && words.size >= 2 && ![...words.keys()].some((k) => intended.has(k));
}

/**
 * OCR's words against the text we asked for (ctx.intendedText): a word one edit (two for long words)
 * from an intended word fails as a misspelling. The vision model's own misspellings (product labels
 * included) fail too, unless the word is one we asked for or the brand's name.
 */
export function spellingCheck(input: QaInput, ctx: QaContext): QaCheck {
  const base = { id: "spelling", label: "Spelling", rules: ["SPELL"] };
  if (isPost(input)) return { ...base, verdict: "skipped", reason: "Rendered from our copy." };
  // The batch's frozen words, and the copy a composed ad carries now ("Edit text" may have changed it).
  const intended = spellWords(placedText(input, ctx).join("\n"));
  const names = new Set([ctx.appName, ...(ctx.aliases ?? [])].flatMap((n) => [...spellWords(n).keys(), collapse(n)]));
  const brandTypos = new Set([ctx.appName, ...(ctx.aliases ?? [])].flatMap((n) => misspellings(textOf(input).ocrLines.map((l) => l.text).join("\n"), n)));
  const found: { seen: string; right: string; by: "intended" | "model" }[] = [];
  const seenKeys = new Set<string>();
  for (const line of textOf(input).ocrLines) {
    const words = spellWords(line.text);
    // With our real product in the picture, a line that shares none of our words is its printed packaging
    // ("pores and fight scars" on the label): a real word there isn't a typo of ours ("stars").
    if (packaging(input, words, intended)) continue;
    for (const [key, word] of words) {
      if (intended.has(key) || names.has(key) || brandTypos.has(key) || seenKeys.has(key)) continue;
      const right = misspelledFrom(key, intended);
      if (right) { seenKeys.add(key); found.push({ seen: word, right, by: "intended" }); }
    }
  }
  for (const m of input.ocr?.misspellings ?? []) {
    const key = collapse(m.text);
    if (!key || intended.has(key) || names.has(key) || brandTypos.has(key) || seenKeys.has(key)) continue;
    seenKeys.add(key);
    found.push({ seen: m.text, right: m.suggestion, by: "model" });
  }
  if (found.length) {
    return {
      ...base, verdict: "fail", evidence: found[0].seen,
      reason: found.slice(0, 6).map((f) => `Misspelled: '${f.seen}' (${f.by === "intended" ? "intended" : "should be"} '${f.right}')`).join("; ") + ".",
    };
  }
  if (textUnread(input)) {
    return intended.size ? { ...base, verdict: "warn", reason: "Not read: no OCR ran on this creative, so its words couldn't be compared with the text we asked for. Read it before approving." } : { ...base, verdict: "skipped", reason: "Text wasn't read and there's no intended text to compare." };
  }
  return { ...base, verdict: "pass", reason: intended.size ? `Matches the ${intended.size} intended word${intended.size === 1 ? "" : "s"} we checked; no misspellings found.` : "No misspellings found." };
}

// MARK: Safe zone

/** Applies to 9:16 creatives (and, when the aspect isn't known, a stories or reels batch). */
export const safeZoneApplies = (input: QaInput, ctx: QaContext) => !isPost(input) && (input.aspect ? input.aspect === "9:16" : /stories|reels/.test(ctx.placement ?? ""));

const overlap = (a: NormBox, b: NormBox) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Text in Meta's 9:16 unsafe zones (SAFE_ZONE): the top 14% (profile and close button) or the bottom
 * 35% (caption, CTA) fails; small text there, text in the 6% side margins or text over a face warns.
 */
export function safeZoneCheck(input: QaInput, ctx: QaContext): QaCheck {
  const base = { id: "safe_zone", label: "9:16 safe zone", rules: ["SAFE"] };
  if (!safeZoneApplies(input, ctx)) return { ...base, verdict: "skipped", reason: "Not a 9:16 creative." };
  if (textUnread(input)) return { ...base, verdict: "warn", reason: "Not read: no OCR ran on this creative, so where its text sits couldn't be checked. Keep text out of the top 14% and bottom 35%." };
  const lines = textOf(input).ocrLines;
  if (!lines.length) return { ...base, verdict: "pass", reason: "No on-screen text." };
  const placed = lines.filter((l): l is OcrLine & { box: NormBox } => Boolean(l.box));
  if (!placed.length) return { ...base, verdict: "skipped", reason: "Where the text sits wasn't read (an older read): check the top 14% and bottom 35% yourself." };
  const z = SAFE_ZONE;
  const quote = (l: OcrLine) => `"${l.text.slice(0, 40)}"`;
  const top = placed.filter((l) => l.box.y < z.top - z.slack);
  const bottom = placed.filter((l) => l.box.y + l.box.h > 1 - z.bottom + z.slack);
  const big = (l: OcrLine) => l.heightFrac >= z.smallText;
  const sides = placed.filter((l) => l.box.x < z.sides - z.slack || l.box.x + l.box.w > 1 - z.sides + z.slack);
  const faces = input.ocr?.faces ?? [];
  const onFace = placed.filter((l) => faces.some((f) => (f.at ?? null) === (l.at ?? null) && overlap(l.box, f) >= z.faceOverlap * l.box.w * l.box.h));
  const problems: string[] = [];
  if (top.length) problems.push(`in the top 14%: ${top.slice(0, 3).map(quote).join(", ")}`);
  if (bottom.length) problems.push(`in the bottom 35%: ${bottom.slice(0, 3).map(quote).join(", ")}`);
  if (sides.length) problems.push(`in the 6% side margins: ${sides.slice(0, 3).map(quote).join(", ")}`);
  if (onFace.length) problems.push(`over a face: ${onFace.slice(0, 3).map(quote).join(", ")}`);
  const estimated = input.ocr?.engine === "openai" ? " (positions estimated by a vision model)" : "";
  if (!problems.length) return { ...base, verdict: "pass", reason: `All text inside Meta's 9:16 safe zone${estimated}.` };
  const fails = [...top, ...bottom].some(big);
  const evidence = ([...top, ...bottom].find(big) ?? [...top, ...bottom, ...sides, ...onFace][0]).text.slice(0, 80);
  return {
    ...base, verdict: fails ? "fail" : "warn", evidence,
    reason: `Text ${problems.join("; ")}${estimated}. Meta's interface covers the top 14% and bottom 35% of a 9:16 ad: move the text into the middle.`,
  };
}

// MARK: Logo

/**
 * The real logo (ctx.logoUrl) against what the image shows, when we didn't place the logo ourselves:
 * the vision model's comparison (ocr.logo) warns when the logo looks redrawn or can't be confirmed.
 */
export function logoCheck(input: QaInput, ctx: QaContext): QaCheck {
  const base = { id: "logo", label: "Real logo", rules: ["LOGO"] };
  if (!ctx.logoUrl || input.kind !== "image" || isPost(input)) return { ...base, verdict: "skipped", reason: "No real logo to compare with." };
  if (input.logoPlaced) return { ...base, verdict: "pass", reason: "Our real logo file is placed on it." };
  const read = input.ocr?.logo;
  if (!read || read.error || read.logoUrl !== ctx.logoUrl) return { ...base, verdict: "skipped", reason: `The logo wasn't compared${read?.error ? ` (${read.error})` : ""}: check any logo on it is the real one.` };
  if (!read.visible) return { ...base, verdict: "pass", reason: "No logo mark drawn on the image." };
  if (read.matches === "yes") return { ...base, verdict: "pass", reason: "The logo on it matches the real one." };
  return {
    ...base, verdict: "warn", evidence: read.note,
    reason: `${read.matches === "no" ? "Logo looks redrawn" : "The logo may be redrawn (too small or unclear to confirm)"}: place the real logo.${read.note ? ` ${read.note}` : ""}`,
  };
}

// MARK: Facts

/** Numbers that need provenance: prices, percentages, ratings and counts. */
const NUMBER_CLAIMS: { kind: "price" | "percent" | "rating" | "count"; pattern: RegExp }[] = [
  { kind: "price", pattern: /(?:US)?[$€£¥₹]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m)(?![a-z]))?\+?/gi },
  { kind: "percent", pattern: /\d[\d,]*(?:\.\d+)?\s?%/g },
  { kind: "rating", pattern: /\b\d(?:\.\d)?\s?-?\s?(?:★+|⭐+|stars?\b|out of 5\b)|[★⭐]\s?\d(?:\.\d)?\b|\b\d\.\d\s?\/\s?5\b/gi },
  { kind: "count", pattern: /\b\d[\d,.]*\s?(?:k|m|million|thousand)?\+?\s+(?:users|members|customers|patients|people|reviews|ratings|downloads|subscribers|clients|women|men|families|travell?ers)\b|\b\d[\d,.]*\s?(?:k|m|million|thousand)\+?(?![\w])|\b\d{1,3}(?:,\d{3})+\+|\b\d{3,}\+/gi },
];

/** A number claim's value ("13,000+" and "13K" are both 13000). */
function claimValue(text: string): number | null {
  const m = text.replace(/,(?=\d{3}\b)/g, "").match(/(\d+(?:\.\d+)?)\s?(k|m|million|thousand)?/i);
  if (!m) return null;
  const scale = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6 }[(m[2] ?? "").toLowerCase() as "k"] ?? 1;
  return Number(m[1]) * scale;
}

/** Every number claim in `text`, longest first so "4.9 stars" isn't also read as a count. */
export function numberClaims(text: string): { kind: string; text: string; value: number }[] {
  const out: { kind: string; text: string; value: number; at: number; end: number }[] = [];
  for (const { kind, pattern } of NUMBER_CLAIMS) {
    for (const m of text.matchAll(pattern)) {
      const value = claimValue(m[0]);
      const at = m.index ?? 0, end = at + m[0].length;
      if (value === null || out.some((o) => at < o.end && end > o.at)) continue;
      out.push({ kind, text: m[0].trim(), value, at, end });
    }
  }
  return out.sort((a, b) => a.at - b.at).map(({ kind, text, value }) => ({ kind, text, value }));
}

/** Every number in a verified text, by kind (a price must match a price; ratings and counts any number). */
function verifiedNumbers(texts: string[]) {
  const all = new Set<number>(), prices = new Set<number>(), percents = new Set<number>();
  for (const t of texts) {
    for (const m of t.replace(/,(?=\d{3}\b)/g, "").matchAll(/\d+(?:\.\d+)?\s?(?:k|m|million|thousand)?(?![a-z])/gi)) { const v = claimValue(m[0]); if (v !== null) all.add(v); }
    for (const c of numberClaims(t)) { if (c.kind === "price") prices.add(c.value); if (c.kind === "percent") percents.add(c.value); }
  }
  return { all, prices, percents };
}

/**
 * Prices, percentages, ratings and counts on screen or in the ad copy must be verified: one of the
 * brand's facts (ctx.facts) or an offer's wording. Anything else fails "Unverified number".
 */
export function factsCheck(input: QaInput, ctx: QaContext): QaCheck {
  const base = { id: "facts", label: "Verified numbers", rules: ["FACTS"] };
  const known = verifiedNumbers([...(ctx.facts ?? []).flatMap((f) => [f.value, `${f.label} ${f.value}`]), ...(ctx.offers?.allowed ?? [])]);
  const unverified: string[] = [];
  for (const t of everyText(input)) {
    for (const c of numberClaims(t.text)) {
      const ok = c.kind === "price" ? known.prices.has(c.value) : c.kind === "percent" ? known.percents.has(c.value) : known.all.has(c.value);
      if (!ok) unverified.push(`'${c.text}' (${t.where})`);
    }
  }
  if (unverified.length) {
    // With no verified facts listed yet the brand can't be held to them: warn until someone adds them, then fail.
    const listed = (ctx.facts ?? []).length > 0;
    return {
      ...base, verdict: listed ? "fail" : "warn", evidence: unverified[0],
      reason: `Unverified number: ${[...new Set(unverified)].slice(0, 6).join(", ")}. Use one of the brand's verified facts${(ctx.facts ?? []).length ? ` (${ctx.facts!.slice(0, 3).map((f) => `${f.label}: ${f.value}`).join("; ")})` : " (none are listed yet: add them on the Brand page)"} or an offer's exact wording.`,
    };
  }
  if (nothingRead(input) && !adCopyTexts(input).length) return { ...base, verdict: "warn", reason: "Not read: no OCR ran on this creative, so its numbers couldn't be checked against the verified facts." };
  return { ...base, verdict: "pass", reason: "Every price, percentage, rating and count is a verified fact or an offer (or there are none)." };
}

// MARK: People

/** Person images used as references (ctx.people): consent not confirmed, or a possible minor, warns and goes to a person. */
export function peopleCheck(ctx: QaContext): QaCheck {
  const base = { id: "people", label: "People's consent", rules: ["IP-3", "PR-3"] };
  const people = ctx.people ?? [];
  if (!people.length) return { ...base, verdict: "skipped", reason: "No person images used as references." };
  const unconsented = people.filter((p) => p.consent !== "confirmed");
  const minors = people.filter((p) => p.possibleMinor);
  if (!unconsented.length && !minors.length) return { ...base, verdict: "pass", reason: `Every person image used (${people.length}) has confirmed consent.` };
  const parts = [
    unconsented.length ? `${unconsented.length} person image${unconsented.length === 1 ? " has" : "s have"} no confirmed consent (${[...new Set(unconsented.map((p) => p.consent.replace("_", " ")))].join(", ")})` : "",
    minors.length ? `${minors.length} may show a minor` : "",
  ].filter(Boolean);
  return {
    ...base, verdict: "warn", evidence: [...unconsented, ...minors][0].assetId,
    reason: `${parts.join("; ")}. Confirm the person's written consent on the Product page, and never run a minor's likeness, before approving.`,
  };
}

// MARK: Completeness

/** A static's pitch, as Jev questions: the hook, the product, an offer or CTA (the brand is checked in code). */
export function completenessAsks(input: QaInput): { id: string; part: string; question: ReturnType<typeof noul> }[] {
  if (input.style !== "image" || input.kind !== "image" || nothingRead(input)) return [];
  return [
    { id: "missing_hook", part: "a hook", question: noul("Is the ad missing a hook: a short, prominent headline or opening line that gives the viewer a reason to stop scrolling?") },
    { id: "missing_product", part: "the product or app", question: noul("Does the ad fail to show or name what is being sold (`app`): no product shot, app screen or product name?") },
    { id: "missing_offer_cta", part: "an offer or call to action", question: noul("Does the ad lack both an offer (a price, plan, trial or deal) and a call to action ('Get started', 'Download', 'Shop now', 'Take the quiz')?") },
  ];
}

/**
 * Statics must carry the whole pitch (the founder rejected one-liners): Jev's answers on the hook, the
 * product and the offer or CTA, and the brand (its name on screen, our logo placed, or a logo the vision
 * model saw). Anything missing warns.
 */
export function completenessCheck(input: QaInput, ctx: QaContext, answers: Record<string, unknown>, missingAt = MISSING_AT): QaCheck {
  const base = { id: "completeness", label: "Full pitch", rules: ["PITCH"] };
  const asks = completenessAsks(input);
  if (!asks.length) return { ...base, verdict: "skipped", reason: input.style === "image" && input.kind === "image" ? "Text wasn't read, so the pitch couldn't be checked." : "Only statics are checked for the full pitch." };
  const missing = asks.filter((a) => {
    const p = (answers[a.id] as { noul?: number } | undefined)?.noul;
    return typeof p === "number" && p >= missingAt;
  }).map((a) => a.part);
  const named = [ctx.appName, ...(ctx.aliases ?? [])].some((n) => mentions(textOf(input).onScreen.join("\n"), n));
  if (!named && !input.logoPlaced && !input.ocr?.logo?.visible) missing.push("the brand (its name or logo)");
  if (!missing.length) return { ...base, verdict: "pass", reason: "Hook, product, offer or CTA, and brand are all there." };
  return { ...base, verdict: "warn", evidence: missing[0], reason: `Missing ${missing.join(", ")}. A static has to carry the whole pitch: hook, product, offer or CTA, and the brand.` };
}

// MARK: From the creative row

/** The ad copy Launch sends: primary text, headline, description and the A/B variants (when any). */
export function adCopyOf(row: { headline?: string | null; primary_text?: string | null; description?: string | null; copy_variants?: unknown }): AdCopy {
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  const variants: CopyVariant[] = (Array.isArray(row.copy_variants) ? row.copy_variants : []).filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object").slice(0, 8)
    .map((v) => ({ label: text(v.label) ?? undefined, voice: text(v.voice) ?? undefined, primary_text: text(v.primary_text), headline: text(v.headline), description: text(v.description) }));
  return { primaryText: text(row.primary_text), headline: text(row.headline), description: text(row.description), ...(variants.length ? { variants } : {}) };
}

/** Our real product is in the picture: our product images went to the model as references, or a composed ad has the cut-out. */
export function realProductUsed(params: Record<string, unknown> | null, copy: KnownCopy | null): boolean {
  const refs = params?.product_refs;
  const composed = (copy ?? {}).composed as Record<string, unknown> | null | undefined;
  return (Array.isArray(refs) && refs.length > 0) || Boolean(composed && typeof composed === "object" && composed.product);
}

/** Our real logo is on the image: a logo overlay planned on the job (and not removed), placed, or a composed ad's logo slot. */
export function logoPlaced(params: Record<string, unknown> | null, copy: KnownCopy | null): boolean {
  const c = (copy ?? {}) as Record<string, unknown>;
  const composed = params?.composed as Record<string, unknown> | undefined;
  return Boolean(c.logo) || (Boolean(params?.logo_overlay) && !c.logoRemoved) || Boolean(composed && typeof composed === "object" && composed.logo);
}

// MARK: Jev

interface Ask { id: string; label: string; rules: string[]; question: ReturnType<typeof noul>; fix?: string }

/** The judgment calls for this creative, as Jev questions. */
export function jevQuestions(input: QaInput, ctx: QaContext): Ask[] {
  const asks: Ask[] = [
    { id: "other_app", label: "Right app", rules: ctx.policy === "immigration_tax" ? ["BW-6"] : ["BRAND"], fix: `Name the product "${ctx.appName}" only.`,
      question: noul("Does the ad present an app, product or brand other than `app` as the thing being advertised, or call `app` by a different name?", {
        true: "Another product is the subject of the ad, or the advertised app is called something other than `app`.",
        false: "The ad is about `app` (or names no product at all).",
      }) },
    { id: "competitor", label: "No competitors", rules: ["IP-2", "IP-5"], fix: "Remove the competitor; copy their format, never their name, logo or assets.",
      question: noul("Does the ad name, show or allude to any brand in `competitors`, or another rival app, including comparisons ('better than…', 'unlike other apps')?") },
    { id: "personal_attributes", label: "No personal attributes", rules: ctx.policy === "health" ? ["PA-1", "PA-2", "NH-3"] : ["PA-1", "PA-2"], fix: "Talk about the product and who it's for in general terms, not the viewer's condition or status.",
      question: noul("Does the ad assert or imply something about the viewer's personal attributes (a health or medical condition, body or skin, immigration or visa status, national origin, financial hardship, age, religion, sexuality), including asking about them ('Are you on a work visa?', 'Struggling with acne?')?", {
        true: "It tells or asks the viewer about their own condition, status or identity.",
        false: "It describes the product, or who it's for in general terms ('for people who split the year between countries').",
      }) },
    { id: "testimonial", label: "No fake testimonial", rules: ["PR-2", "PR-3"], fix: "Have the presenter explain or demo the product instead of claiming to be a customer or expert.",
      question: noul("Does the ad present someone as a real customer giving their own review or results with `app` ('I used it and…', named reviews, star ratings from a person), or as a doctor, lawyer, tax adviser or official? A presenter who explains or demonstrates the product is fine.") },
    { id: "fake_ui", label: "No fake UI or news", rules: ["PR-5"], fix: "Make it clearly an ad from the brand's own account.",
      question: noul("Does the ad imitate a news outlet, a government website or document, a system notification or dialog, or an organic post by a real member of the public? A post clearly from `app`'s own account is fine.") },
  ];
  if (ctx.policy === "immigration_tax") {
    asks.push(
      { id: "guaranteed_outcome", label: "No guaranteed outcome", rules: ["BW-1"], fix: "Say what the app does: track your days, see how close you are to a limit.",
        question: noul("Does the ad promise or guarantee a visa, residency, citizenship, tax status, avoided tax, avoided fines or 'staying legal' as a result of using `app`?") },
      { id: "legal_advice", label: "Not legal or tax advice", rules: ["BW-2"], fix: "Explain the rule accurately and add \"Rules change; check official sources\".",
        question: noul("Does the ad offer legal, immigration or tax advice or an expert endorsement (\"we'll tell you if you owe tax\", \"lawyer-approved\"), or state a visa or tax rule wrongly?") },
      { id: "government", label: "No government styling", rules: ["BW-3"], fix: "Drop seals, agency names and official-looking styling.",
        question: noul("Does the ad use or describe government seals, agency names as endorsement, flags as endorsement, or styling that looks official (USCIS, IRS, HMRC, EU, border agencies)?") },
      { id: "fear", label: "No fear tactics", rules: ["BW-4"], fix: "State risks factually, without threats.",
        question: noul("Does the ad use deportation, fines or bans as threats to scare the viewer ('You'll be banned for 5 years!')?") },
      { id: "social_issue", label: "Commercial, not advocacy", rules: ["BW-5", "AI-1"], fix: "Keep it about the product; no views on immigration policy, laws, refugees or politicians.",
        question: noul("Does the ad take a side on or argue about immigration policy, refugees, laws, elections or politicians, rather than just selling a product?", {
          true: "It reads as political or social-issue advocacy (Meta would treat it as a social issue ad).",
          false: "It's commercial: it sells the app and mentions rules only to explain what the app tracks.",
        }) },
    );
  }
  if (ctx.policy === "health") {
    asks.push(
      { id: "medical_claim", label: "No medical claims", rules: ["NH-1"], fix: "Describe the routine or experience, not a medical effect.",
        question: noul("Does the ad claim the product cures, treats, heals, prevents, diagnoses or reverses a condition or disease?") },
      { id: "guaranteed_results", label: "No guaranteed results", rules: ["NH-2"], fix: "Drop guarantees and timeframes; qualify any outcome.",
        question: noul("Does the ad guarantee results or promise an outcome within a timeframe ('clear skin in 7 days', 'results guaranteed')?") },
      { id: "negative_self", label: "No negative self-image", rules: ["NH-4"], fix: "Remove before/after and body- or skin-shaming framing.",
        question: noul("Does the ad use before/after comparisons, or shame the viewer's body, skin or appearance?") },
      { id: "clinician", label: "No fake clinician", rules: ["NH-5"], fix: "Remove the white coat, 'Dr.' and implied credentials.",
        question: noul("Does a presenter appear as or claim to be a doctor, dermatologist, nurse or other medical professional?") },
      { id: "health_policy", label: "Commercial, not advocacy", rules: ["NH-7"], fix: "Keep it about the product.",
        question: noul("Does the ad argue about healthcare policy or access, rather than just selling a product?") },
    );
  }
  ctx.forbiddenClaims.forEach((claim, i) => {
    if (!claim.trim()) return;
    asks.push({ id: `forbidden_${i + 1}`, label: "Workspace rule", rules: [`WS-${i + 1}`], fix: "Remove the claim.",
      question: noul(`Does the ad make this claim, or one with the same meaning: "${claim.slice(0, 300)}"?`) });
  });
  return asks;
}

/** What Jev reads: the app, the rules' context, and every bit of text the creative carries. */
export function jevState(input: QaInput, ctx: QaContext) {
  const { onScreen, brief } = textOf(input);
  return {
    app: ctx.appName,
    ...(ctx.description ? { app_description: ctx.description.slice(0, 400) } : {}),
    ad_format: { ugc_video: "AI-generated UGC-style video with a presenter", ai_video: "AI-generated video ad (Seedance), possibly with people", image: "AI-generated image ad", reddit: "Reddit-post-style image ad from the brand's account", tweet: "Tweet-style image ad from the brand's account" }[input.style],
    on_screen_text: !textUnread(input)
      ? (onScreen.length ? onScreen.join("\n").slice(0, 3000) : "(no text found on screen)")
      : onScreen.length
      ? `${onScreen.join("\n").slice(0, 2800)}\n(Only the text we placed is known: the rest of the picture was not read, no OCR ran.)`
      : "(not read: no OCR ran on this creative, so nothing is known about its on-screen text; do not assume there is none)",
    ...(brief ? { brief: `What the generator was asked to make (the video's script follows it): ${brief.slice(0, 2500)}` } : {}),
    ...(adCopyTexts(input).length ? { ad_copy: `The ad's text outside the image (sent to Meta with it): ${adCopyTexts(input).map((t) => `${t.where}: ${t.text}`).join("\n").slice(0, 2500)}` } : {}),
    competitors: ctx.competitors.length ? ctx.competitors.slice(0, 30) : ["(none listed)"],
  };
}

/** Runs every check. Throws when the judge can't be reached or its answer can't be trusted (the caller marks QA as errored, to retry). */
export async function runQa(input: QaInput, ctx: QaContext, jev: Jev): Promise<QaReport> {
  // Each provider's probabilities mean something different, so each has its own lines.
  const at = thresholdsFor(jev).qa;
  const verdictFor = (p: number): Verdict => (p >= at.failAt ? "fail" : p >= at.warnAt ? "warn" : "pass");
  const checks: QaCheck[] = [
    brandCheck(input, ctx), competitorNameCheck(input, ctx), readabilityCheck(input),
    ...(ctx.offers ? [offerCheck(input, ctx)] : []),
    ...(ctx.avoidWords?.length ? [voiceCheck(input, ctx)] : []),
    // Static generation v2: each only when its part of the context (or of the read) is there.
    ...(!isPost(input) && (ctx.intendedText?.length || input.ocr?.misspellings || input.ocr?.faces) ? [spellingCheck(input, ctx)] : []),
    ...(safeZoneApplies(input, ctx) ? [safeZoneCheck(input, ctx)] : []),
    ...(ctx.logoUrl && input.kind === "image" && !isPost(input) ? [logoCheck(input, ctx)] : []),
    ...(ctx.facts ? [factsCheck(input, ctx)] : []),
    ...(ctx.substitutions?.length || ctx.requiredPhrases?.length ? [wordingCheck(input, ctx)] : []),
    ...(ctx.people?.length ? [peopleCheck(ctx)] : []),
    ...(adCopyTexts(input).length ? [adCopyCheck(input, ctx)] : []),
  ];
  const hits = phraseHits(input, ctx);
  const asks = jevQuestions(input, ctx);
  const pitch = completenessAsks(input);
  const questions: Questions = Object.fromEntries([...asks.map((a) => [a.id, a.question]), ...pitch.map((a) => [a.id, a.question])]);
  const { answers, usage, model } = await jev.systemOne({ state: jevState(input, ctx), questions });
  for (const ask of asks) {
    const p = (answers[ask.id] as { noul?: number } | undefined)?.noul;
    if (typeof p !== "number") { checks.push({ id: ask.id, label: ask.label, rules: ask.rules, verdict: "skipped", reason: "The check gave no answer." }); continue; }
    let verdict = verdictFor(p);
    const hit = hits.find((h) => ask.rules.includes(h.rule));
    // A plain phrase match never lets a check pass outright.
    if (hit && verdict === "pass") verdict = "warn";
    checks.push({
      id: ask.id, label: ask.label, rules: ask.rules, verdict, probability: Math.round(p * 1000) / 1000,
      reason: verdict === "pass" ? "Checked: no problem found." : `${hit ? `"${hit.text}" (${hit.where}) reads as a ${hit.label}. ` : ""}Checked: ${Math.round(p * 100)}% likely to break ${ask.rules.join(", ")}.${ask.fix ? ` Fix: ${ask.fix}` : ""}`,
      ...(hit ? { evidence: hit.text } : {}),
    });
  }
  if (input.style === "image" && input.kind === "image") checks.push(completenessCheck(input, ctx, answers, at.missingAt));
  const verdict = worst(checks.map((c) => c.verdict));
  const violations: QaViolation[] = checks.filter((c) => c.verdict === "fail").flatMap((c) => c.rules.map((rule) => ({
    id: rule, where: hits.find((h) => h.rule === rule)?.where ?? (["readability", "spelling", "safe_zone"].includes(c.id) ? "on screen" : c.id === "ad_copy" ? "copy" : input.kind === "video" ? "video" : "image"),
    text: c.evidence ?? c.reason, ...(asks.find((a) => a.id === c.id)?.fix ? { fix: asks.find((a) => a.id === c.id)!.fix } : {}),
  })));
  const needsHuman = new Set<string>();
  const notes: string[] = [];
  const testimonial = checks.find((c) => c.id === "testimonial");
  if (testimonial && testimonial.verdict !== "pass") needsHuman.add("PR-3");
  if (input.style === "reddit" || input.style === "tweet") {
    needsHuman.add("PR-5");
    notes.push("Social-post style: check it reads as the brand's own post, not a member of the public's.");
  }
  if (PRICE.test([...textOf(input).onScreen, textOf(input).brief].join("\n"))) {
    needsHuman.add(ctx.policy === "immigration_tax" ? "BW-7" : "PRICE");
    notes.push("Mentions a price, trial or discount: check it matches the live paywall.");
  }
  if (checks.find((c) => c.id === "people")?.verdict === "warn") {
    needsHuman.add("IP-3");
    notes.push("A person image used as a reference has no confirmed consent or may show a minor: confirm consent (Product page) before approving.");
  }
  if (textUnread(input)) notes.push("On-screen text wasn't read (no OCR for this creative): QA judged the brief and any copy we placed. Read the creative yourself before approving.");
  if (input.ocr?.engine === "openai") notes.push("On-screen text was read by a vision model on the server: text sizes and contrast are its estimates.");
  if (input.style === "ugc_video" || input.style === "ai_video") {
    notes.push("Spoken words aren't transcribed; QA read the on-screen text and the brief. Listen before approving.");
    notes.push("Realistic AI presenter: turn on the AI-generated label on TikTok (AI-2) and never present them as a customer (PR-2).");
    needsHuman.add("AI-2");
  }
  return {
    verdict, checks, violations, needsHuman: [...needsHuman], notes,
    textSeen: textOf(input).onScreen.slice(0, 60), model, tokens: usage?.input_tokens, ranAt: new Date().toISOString(),
  };
}
