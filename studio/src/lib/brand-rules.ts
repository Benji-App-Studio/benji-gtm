// One brand-rules builder. Every prompt builder (the Studio's planBatch, the Playground, Recreate's
// composePrompt, format recipes via planBatch, composed plates) reads the brand's rules from here, and
// createBatch freezes the QA context from the same result, so QA checks exactly what the prompt said:
// - look: the brand system's prompt modifier and packaging (lookBlock);
// - about: the AI product profile (profileBrief), when the request uses it;
// - copy: the voice, the variant's avatar and the facts of the products the brief names (copyBlock);
// - rules (what QA checks): words the brand never uses, its wording ("Say 'licensed provider', never
//   'dermatologist'"; phrases that must come with a word), the closed offer list, the verified facts
//   (the only numbers a creative may show), forbidden claims and the must-avoid names (a recreated
//   ad's brand, links, handles…).
// `brandRules` works out what is in force for a request (kind-independent: it's also the QA context);
// `brandBlocks` renders it for one kind of prompt:
// - image / video: every block (look, about, copy, rules), sized for the kind;
// - plate (a composed ad's text-free photo): the look and what the product is; no words are drawn, so
//   no copy or rules (the copy set on it afterwards is the person's own, and QA still checks it);
// - post (Reddit/tweet-style posts): no prompt at all; QA still checks the person's copy.
// A request whose brief already states the rules (Recreate composes its brief with these same rules:
// `brandInBrief`) gets no blocks from the planner, and QA still knows every rule. A brand-neutral request
// (template remakes) has no brand rules at all, only its must-avoid names.
// Pure TypeScript with relative imports: the browser, the server and the Node tests share it.
import { copyBlock, hasBrandSystem, lookBlock, offerRules, offersLine, productsIn, verifiedFacts, type BrandProduct, type BrandSubstitution, type BrandSystem, type RequiredPhrase } from "./brand-system";
import { profileBrief, type ProductProfile } from "./product-insight";

export type RulesKind = "image" | "video" | "plate" | "post";

/** How many forbidden claims and banned words a prompt states (and QA checks: the same lists). */
export const RULE_LIMITS = { claims: 20, avoidWords: 20, substitutions: 20, requiredPhrases: 12, facts: 30, factsInPrompt: 8 };
export const MUST_AVOID = { items: 30, chars: 80 };

/** The merged brand (lib/brand.ts MergedBrand: kit.appName, kit.forbiddenClaims, system, profile). */
export interface RulesBrand {
  appName: string;
  /** Kit ∪ voice ∪ AI profile claims to avoid (mergeBrand). */
  forbiddenClaims?: string[] | null;
  system?: BrandSystem | null;
  profile?: ProductProfile | null;
}

/** What of the request decides the rules (a BatchRequest fits). */
export interface RulesRequest {
  /** Products of the brand system the brief names get their facts and packaging. */
  brief?: string;
  /** Names and words that must never appear (Recreate's their-brand list, a Playground reference's brands). */
  mustAvoid?: string[];
  /** The brand system's look, voice, avatars and offers. On unless false. */
  useBrandSystem?: boolean;
  /** The AI product profile in the prompt. On unless false (it only adds words to the prompt; its claims to avoid are always forbidden). */
  useProfile?: boolean;
  /** The brief already states the rules (Recreate): no blocks from the planner, QA still checks them all. */
  brandInBrief?: boolean;
  /** Brand-neutral (template remakes): no brand rules at all, only the must-avoid names. */
  neutral?: boolean;
}

/** The QA context's brand fields (creative-plan qaContext; supabase/functions/creatives core/types.ts QaContext). */
export interface BrandQa {
  forbiddenClaims: string[];
  /** Joins the competitor names in QA (Jev flags any of it in on-screen text). */
  mustAvoid: string[];
  offers?: { allowed: string[]; notOffered: string[] };
  avoidWords?: string[];
  /** Say `use`, never `avoid`: QA fails a creative or its copy that says `avoid`. */
  substitutions?: BrandSubstitution[];
  /** A `when` without its `phrase` gets a warning. */
  requiredPhrases?: RequiredPhrase[];
  /** The verified facts and sourced offers (brand-system verifiedFacts): any other number fails QA. */
  facts?: { label: string; value: string }[];
}

export interface BrandRules {
  appName: string;
  /** The brand system in force, or null. */
  system: BrandSystem | null;
  /** The AI profile for the prompt, or null. */
  profile: ProductProfile | null;
  /** Products of the brand system the brief names. */
  products: BrandProduct[];
  forbiddenClaims: string[];
  mustAvoid: string[];
  avoidWords: string[];
  substitutions: BrandSubstitution[];
  requiredPhrases: RequiredPhrase[];
  facts: { label: string; value: string }[];
  offers: { allowed: string[]; notOffered: string[] } | null;
  inBrief: boolean;
  /** For QA: exactly the lists above. */
  qa: BrandQa;
}

export interface BrandBlocks {
  /** BRAND LOOK (opens the prompt). */
  look: string;
  /** ABOUT THE PRODUCT (the AI profile). */
  about: string;
  /** BRAND COPY: voice, the variant's avatar, named products' facts. */
  copy: string;
  /** BRAND RULES: banned words, offers, forbidden claims, must-avoid names (what QA checks). */
  rules: string;
}

const EMPTY_BLOCKS: BrandBlocks = { look: "", about: "", copy: "", rules: "" };
const norm = (s: string) => s.trim().toLowerCase();

/** Strings trimmed, without blanks or repeats (case-insensitive), at most `max`. */
function uniq(list: (string | null | undefined)[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const text = (item ?? "").replace(/\s+/g, " ").trim();
    if (!text || seen.has(norm(text))) continue;
    seen.add(norm(text));
    out.push(text);
  }
  return out.slice(0, max);
}

/** A must-avoid list made safe: strings only, trimmed, at most 80 characters each, no duplicates, at most 30. */
export function cleanMustAvoid(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const text = item.replace(/\s+/g, " ").trim().slice(0, MUST_AVOID.chars).trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
    if (out.length >= MUST_AVOID.items) break;
  }
  return out;
}

/** The rules in force for a request: what every prompt of it states and what QA checks. */
export function brandRules(brand: RulesBrand, req: RulesRequest = {}): BrandRules {
  const mustAvoid = cleanMustAvoid(req.mustAvoid).filter((x) => norm(x) !== norm(brand.appName));
  if (req.neutral) {
    return { appName: brand.appName, system: null, profile: null, products: [], forbiddenClaims: [], mustAvoid, avoidWords: [], substitutions: [], requiredPhrases: [], facts: [], offers: null, inBrief: false, qa: { forbiddenClaims: [], mustAvoid } };
  }
  const inBrief = Boolean(req.brandInBrief);
  // A brief that carries the rules was written with the system (Recreate always uses it).
  const system = (inBrief || req.useBrandSystem !== false) && hasBrandSystem(brand.system) ? brand.system : null;
  const profile = req.useProfile !== false ? brand.profile ?? null : null;
  const forbiddenClaims = uniq([...(brand.forbiddenClaims ?? []), ...(brand.profile?.avoid ?? [])], RULE_LIMITS.claims);
  const avoidWords = system ? uniq(system.voice.avoid, RULE_LIMITS.avoidWords).filter((w) => w.length >= 2) : [];
  const offers = offerRules(system);
  const substitutions = (system?.voice.substitutions ?? []).slice(0, RULE_LIMITS.substitutions);
  const requiredPhrases = (system?.voice.requiredPhrases ?? []).slice(0, RULE_LIMITS.requiredPhrases);
  const facts = verifiedFacts(system).slice(0, RULE_LIMITS.facts);
  return {
    appName: brand.appName, system, profile, products: system ? productsIn(system, req.brief ?? "") : [], forbiddenClaims, mustAvoid, avoidWords, substitutions, requiredPhrases, facts, offers, inBrief,
    qa: {
      forbiddenClaims, mustAvoid, ...(offers ? { offers } : {}), ...(avoidWords.length ? { avoidWords } : {}),
      ...(substitutions.length ? { substitutions } : {}), ...(requiredPhrases.length ? { requiredPhrases } : {}), ...(facts.length ? { facts } : {}),
    },
  };
}

/** "Say "licensed provider", never "dermatologist"; …" for a list of substitutions, "" when there are none. */
export function substitutionsLine(list: BrandSubstitution[]): string {
  return list.length ? `${list.map((x) => `Say "${x.use}", never "${x.avoid}"`).join("; ")}.` : "";
}

/** "Whenever you mention "prescription", also say "if it's right for you"; …", "" when there are none. */
export function requiredPhrasesLine(list: RequiredPhrase[]): string {
  return list.length ? `${list.map((x) => `Whenever you mention "${x.when}", also say "${x.phrase}"`).join("; ")}.` : "";
}

/** The verified facts a prompt may use, as written (the first few; QA knows them all). */
export function factsLine(facts: { label: string; value: string }[], n: number = RULE_LIMITS.factsInPrompt): string {
  return facts.length ? `Numbers: only these verified facts, word for word: ${facts.slice(0, n).map((f) => `${f.label}: "${f.value}"`).join("; ")}. No other price, percentage, rating or count.` : "";
}

/** Each rule as one line (no bullet), "" when there's nothing to say. Builders place them in their own frame. */
export function ruleLines(r: BrandRules): { avoidWords: string; wording: string; required: string; offers: string; facts: string; claims: string; mustAvoid: string } {
  return {
    avoidWords: r.avoidWords.length ? `Never use the words: ${r.avoidWords.map((w) => `"${w}"`).join(", ")}.` : "",
    wording: substitutionsLine(r.substitutions),
    required: requiredPhrasesLine(r.requiredPhrases),
    offers: r.system ? offersLine(r.system).replace(/^-\s?/, "") : "",
    facts: factsLine(r.facts),
    claims: r.forbiddenClaims.length ? `Never claim or imply: ${r.forbiddenClaims.join("; ")}.` : "",
    mustAvoid: r.mustAvoid.length ? `Never show these names or words: ${r.mustAvoid.join(", ")}.` : "",
  };
}

/** The BRAND RULES block (every rule QA checks), or "" when there are none. */
export function rulesBlock(r: BrandRules): string {
  const l = ruleLines(r);
  const lines = [l.avoidWords, l.wording, l.required, l.offers, l.facts, l.claims, l.mustAvoid].filter(Boolean);
  return lines.length ? ["BRAND RULES (QA checks every creative against these):", ...lines.map((x) => `- ${x}`)].join("\n") : "";
}

/** The prompt blocks for one kind of prompt (see the top of this file). `variant` picks the avatar. */
export function brandBlocks(r: BrandRules, kind: RulesKind, o: { variant?: number } = {}): BrandBlocks {
  if (r.inBrief || kind === "post") return EMPTY_BLOCKS;
  const sys = r.system;
  const video = kind === "video";
  const look = sys ? lookBlock(sys, { product: r.products[0] ?? null, max: video ? 700 : 1000 }) : "";
  if (kind === "plate") {
    const about = r.profile ? profileBrief(r.profile, { kind: "image", ...(sys ? { max: 600 } : {}) }).split("\n").filter((l) => /What it is|Look/.test(l)).join("\n") : "";
    return { look, about, copy: "", rules: "" };
  }
  return {
    look,
    about: r.profile ? profileBrief(r.profile, { kind: video ? "video" : "image", ...(sys ? { max: video ? 800 : 600 } : {}) }) : "",
    copy: sys ? copyBlock(sys, { variant: o.variant ?? 1, products: r.products.slice(0, 2), kind: video ? "video" : "image", max: video ? 1300 : 800, rules: false }) : "",
    rules: rulesBlock(r),
  };
}

/** The rules for a request rendered for one kind, and the QA fields that match them. */
export function brandPrompt(brand: RulesBrand, req: RulesRequest, kind: RulesKind, o: { variant?: number } = {}): { blocks: BrandBlocks; qa: BrandQa; rules: BrandRules } {
  const rules = brandRules(brand, req);
  return { blocks: brandBlocks(rules, kind, o), qa: rules.qa, rules };
}
