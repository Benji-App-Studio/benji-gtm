// The awareness ladder (the meta-awareness-ladder skill): five levels a Meta ad can work at, from a
// viewer who doesn't know they have the problem to one ready to buy. One deliberate ad per level beats
// many variants at one level: Meta treats near-duplicates as one ad, and they starve each other.
// A Studio batch can be aimed at a level (`creative_batches.awareness_level`, copied onto each of its
// `creatives`): the level's job goes into the prompt, the gallery counts creatives per level and nudges
// toward the empty ones, and the batch form warns when a new batch repeats an existing one's level,
// format and hook. Advice only: nothing is blocked. Plain TypeScript (browser, API routes, Node tests).

import { m } from "./i18n/translate";

export type AwarenessLevel = 1 | 2 | 3 | 4 | 5;

export interface AwarenessInfo {
  level: AwarenessLevel;
  /** For folders and slugs: "problem-aware". */
  id: string;
  label: string;
  /** What the viewer knows. */
  knows: string;
  /** What the ad sells. */
  sells: string;
  /** The formula the level's ads follow (the batch form's hint). */
  formula: string;
  /** What the prompt asks of the creative. */
  job: string;
}

export const AWARENESS: AwarenessInfo[] = [
  {
    level: 1, id: "unaware", label: m("Unaware"), knows: m("Doesn't know they have the problem, or hasn't named it"), sells: m("the problem"),
    formula: m("Story → pain → (product or offer lightly, or not at all)"),
    job: "Lead with a story or a relatable moment that names the feeling before anything is sold. The product appears lightly or not at all, never in the opening beat: no logo up front, no feature list, no price.",
  },
  {
    level: 2, id: "problem-aware", label: m("Problem-aware"), knows: m("Feels the pain, doesn't know a fix exists"), sells: m("the category, not the brand yet"),
    formula: m("Problem → agitate → bridge to a type of solution"),
    job: "Name the pain sharply and make it felt, then bridge to the kind of fix that exists. Don't jump to brand features or the offer before the pain lands.",
  },
  {
    level: 3, id: "solution-aware", label: m("Solution-aware"), knows: m("Knows solutions exist and is comparing approaches"), sells: m("the mechanism"),
    formula: m("How it works, and why this way beats the other ways"),
    job: "Show how it works: the unique mechanism, and why this approach beats the alternatives the viewer is weighing.",
  },
  {
    level: 4, id: "product-aware", label: m("Product-aware"), knows: m("Knows the brand, weighing it against rivals"), sells: m("why us"),
    formula: m("Comparison, proof, reviews, the differentiator"),
    job: "Prove why us: real reviews or ratings, a comparison with the old way (no rival logos), the differentiator, made to look distinct.",
  },
  {
    level: 5, id: "most-aware", label: m("Most aware"), knows: m("Ready to buy, needs a reason to act now"), sells: m("the offer"),
    formula: m("Price ladder, bundle, deadline, guarantee. No education."),
    job: "Sell the offer only: the price, the deal, the guarantee or the reason to act now, word for word from the brand's offers. No education.",
  },
];

export const AWARENESS_LEVELS: AwarenessLevel[] = [1, 2, 3, 4, 5];

/** A level from anything (a request, a row, a query value), or null. */
export function cleanAwareness(value: unknown): AwarenessLevel | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5 ? n as AwarenessLevel : null;
}

export const awarenessInfo = (level: AwarenessLevel) => AWARENESS[level - 1];

/** "L3 Solution-aware". */
export const awarenessLabel = (level: AwarenessLevel) => `L${level} ${awarenessInfo(level).label}`;

/** The prompt's line for a level: who the viewer is and the job the creative must do. */
export function awarenessLine(level: AwarenessLevel): string {
  const a = awarenessInfo(level);
  return `AWARENESS LEVEL ${level} of 5 (${a.label.toLowerCase()}): the viewer ${a.knows.charAt(0).toLowerCase()}${a.knows.slice(1)}. This ad sells ${a.sells}. Formula: ${a.formula} ${a.job}`;
}

/** A folder name for exports: "L2-problem-aware". */
export const awarenessFolder = (level: AwarenessLevel) => `L${level}-${awarenessInfo(level).id}`;

// MARK: Coverage

export interface Coverage {
  counts: Record<AwarenessLevel, number>;
  /** Creatives without a level. */
  unset: number;
  /** Levels with nothing yet (only when some creative has a level). */
  empty: AwarenessLevel[];
  /** One line toward the first empty level, or null. */
  nudge: string | null;
}

/** Creatives per level (rejected ones left out by the caller), and a nudge toward the first level with none. */
export function awarenessCoverage(levels: (number | null | undefined)[]): Coverage {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<AwarenessLevel, number>;
  let unset = 0;
  for (const value of levels) {
    const level = cleanAwareness(value);
    if (level) counts[level]++;
    else unset++;
  }
  const any = AWARENESS_LEVELS.some((l) => counts[l] > 0);
  const empty = any ? AWARENESS_LEVELS.filter((l) => counts[l] === 0) : [];
  const first = empty[0];
  const nudge = first
    ? `Nothing at ${awarenessLabel(first)} yet${empty.length > 1 ? ` (nor ${empty.slice(1).map((l) => `L${l}`).join(", ")})` : ""}: it sells ${awarenessInfo(first).sells} (${awarenessInfo(first).formula.replace(/\.$/, "")}). One deliberate ad per level beats more variants at one level.`
    : null;
  return { counts, unset, empty, nudge };
}

// MARK: Near-duplicates

/** What a batch is, for the near-duplicate check: its level, its format and its hook. */
export interface BatchSignature { level: AwarenessLevel | null; format: string; hook: string }

interface SignatureInput {
  brief: string;
  kinds?: string[];
  format?: string | null;
  awarenessLevel?: number | null;
  image?: { composed?: { layout?: string; copy?: { headline?: string } } | null } | null;
}

/** The hook: a composed ad's headline, else the brief's first sentence. */
export function hookOf(input: Pick<SignatureInput, "brief" | "image">): string {
  const headline = input.image?.composed?.copy?.headline?.trim();
  if (headline) return headline.slice(0, 160);
  const first = input.brief.trim().split(/\n+/)[0] ?? "";
  return (first.split(/(?<=[.!?])\s+/)[0] ?? first).slice(0, 160);
}

export function batchSignature(input: SignatureInput): BatchSignature {
  const kinds = [...new Set(input.kinds ?? [])].sort().join("+") || "none";
  const composed = input.image?.composed?.layout ? `:composed` : "";
  return { level: cleanAwareness(input.awarenessLevel), format: `${kinds}${input.format === "carousel" ? ":carousel" : composed}`, hook: hookOf(input) };
}

const STOP = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "your", "you", "our", "is", "it", "this", "that", "at", "by", "from", "as", "be", "are", "i", "my", "me"]);
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));

/** How alike two hooks are (0–1): shared words over all words, ignoring case, punctuation and filler. */
export function hookSimilarity(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

/** Hooks at least this alike count as the same idea. */
export const NEAR_DUPLICATE = 0.6;

export interface ExistingBatch { id: string; brief: string; created_at: string; settings: Record<string, unknown> }

/**
 * The newest existing batch a planned one repeats: the same awareness level, the same format and a
 * hook at least NEAR_DUPLICATE alike. Null when the planned batch has no level or nothing matches.
 */
export function nearDuplicate(planned: SignatureInput, batches: ExistingBatch[]): (ExistingBatch & { hook: string }) | null {
  const mine = batchSignature(planned);
  if (!mine.level || !mine.hook.trim()) return null;
  for (const batch of [...batches].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
    const s = batch.settings ?? {};
    const theirs = batchSignature({
      brief: batch.brief ?? "", kinds: Array.isArray(s.kinds) ? s.kinds as string[] : [], format: typeof s.format === "string" ? s.format : null,
      awarenessLevel: s.awarenessLevel as number | null | undefined, image: (s.image ?? null) as SignatureInput["image"],
    });
    if (theirs.level === mine.level && theirs.format === mine.format && hookSimilarity(theirs.hook, mine.hook) >= NEAR_DUPLICATE) return { ...batch, hook: theirs.hook };
  }
  return null;
}
