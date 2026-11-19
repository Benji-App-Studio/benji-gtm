// Measuring a judge against recorded cases, to set its thresholds (thresholds.ts) from evidence.
// The command line around this is scripts/ai-calibration.ts; nothing here touches the network except
// through the judge it is handed. Plain TypeScript.
//
// A case is one judge call that was recorded: the state, the questions, and for each question a
// reference answer. The reference is either what a person decided (yes/no as true/false, the right
// label, the right score) or what the reference provider answered (TypeSafe's probability, label,
// score: `recordCases` below writes those).
import type { AiProvider, Entry, Judge, JudgeRequest, JudgeResult, Questions } from "./judge.ts";
import { THRESHOLDS, type Thresholds } from "./thresholds.ts";

export interface CalibrationCase {
  id?: string;
  /**
   * Which decision the case feeds, so its thresholds can be suggested:
   * "qa" (policy checks, and `missing_…` pitch questions), "partners" (the bio `tie` question),
   * "discover" (the `similarity` score). Anything else is measured but suggests nothing.
   */
  area?: string;
  state: Entry;
  questions: Questions;
  /** By question name. yes/no: true/false or a probability; choice: the label; score: the score. Questions without one are skipped. */
  reference: Record<string, boolean | number | string>;
}

/** One question answered by the judge under test, next to its reference. */
export type Observation =
  | { kind: "noul"; area: string; name: string; p: number; reference: boolean | number }
  | { kind: "choice"; area: string; name: string; choice: string; confidence: number; reference: string }
  | { kind: "score"; area: string; name: string; score: number; reference: number };

/** Wraps a judge so every call it answers is handed to `sink` as a case, its own answers the reference. */
export function recordCases(judge: Judge, sink: (recorded: CalibrationCase) => void | Promise<void>, area?: string): Judge {
  return {
    ...(judge.provider ? { provider: judge.provider } : {}),
    async systemOne<const Q extends Questions>(input: JudgeRequest<Q>): Promise<JudgeResult<Q>> {
      const result = await judge.systemOne(input);
      const reference: CalibrationCase["reference"] = {};
      for (const [name, answer] of Object.entries(result.answers as unknown as Record<string, Record<string, unknown>>)) {
        const value = input.questions[name]?.type === "noul" ? answer?.noul : input.questions[name]?.type === "choice" ? answer?.choice : answer?.score;
        if (typeof value === "number" || typeof value === "string") reference[name] = value;
      }
      // Recording never breaks the call it watches.
      try { await sink({ ...(area ? { area } : {}), state: input.state, questions: input.questions, reference }); } catch { /* the answer still goes back */ }
      return result;
    },
  };
}

/** The questions of a case that have a usable reference, paired with the judge's answers to them. */
export function observe(recorded: CalibrationCase, answers: Record<string, unknown>): Observation[] {
  const area = recorded.area ?? "other";
  const out: Observation[] = [];
  for (const [name, question] of Object.entries(recorded.questions)) {
    const reference = recorded.reference?.[name];
    const answer = (answers[name] ?? {}) as Record<string, unknown>;
    if (question.type === "noul" && (typeof reference === "boolean" || typeof reference === "number") && typeof answer.noul === "number") {
      out.push({ kind: "noul", area, name, p: answer.noul, reference });
    } else if (question.type === "choice" && typeof reference === "string" && typeof answer.choice === "string") {
      out.push({ kind: "choice", area, name, choice: answer.choice, confidence: Number(answer.confidence) || 0, reference });
    } else if (question.type === "score" && typeof reference === "number" && typeof answer.score === "number") {
      out.push({ kind: "score", area, name, score: answer.score, reference });
    }
  }
  return out;
}

export interface RunOptions {
  /** Cases judged at once. Default 4. */
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

/** Asks `judge` every case's questions. A case that fails is listed, not fatal. */
export async function runCases(judge: Judge, cases: CalibrationCase[], options: RunOptions = {}) {
  const observations: Observation[] = [];
  const failed: { id: string; error: string }[] = [];
  const tokens = { input: 0, output: 0 };
  let model = "", done = 0;
  const queue = cases.map((recorded, index) => ({ recorded, id: recorded.id ?? `case ${index + 1}` }));
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 4) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const asked = Object.fromEntries(Object.entries(next.recorded.questions).filter(([name]) => next!.recorded.reference?.[name] !== undefined));
      try {
        if (!Object.keys(asked).length) throw new Error("No question has a reference answer.");
        const result = await judge.systemOne({ state: next.recorded.state, questions: asked });
        observations.push(...observe({ ...next.recorded, questions: asked }, result.answers as Record<string, unknown>));
        tokens.input += result.usage?.input_tokens ?? 0;
        tokens.output += result.usage?.output_tokens ?? 0;
        model ||= result.model;
      } catch (error) {
        failed.push({ id: next.id, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) });
      }
      options.onProgress?.(++done, cases.length);
    }
  }));
  return { observations, failed, tokens, model };
}

// MARK: Agreement

const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
/** A reference as a probability: a person's yes is 1, their no is 0. */
const asProbability = (reference: boolean | number) => (typeof reference === "boolean" ? Number(reference) : reference);

export interface Agreement {
  noul: {
    n: number;
    /** Share on the same side of 50% as the reference. */
    sameSide: number;
    /** Mean distance from the reference probability (a person's verdict counts as 0 or 1). */
    meanAbsError: number;
    /** Share of answers at or beyond 5% and 95%, and share between 35% and 65%: how piled-up the probabilities are. */
    atExtremes: number;
    inMiddle: number;
    /** Answers per tenth, 0–10% first. */
    histogram: number[];
  };
  choice: {
    n: number;
    /** Share that picked the reference label. */
    accuracy: number;
    meanConfidence: number;
    /** Mean confidence minus accuracy: above 0, the judge is surer than it is right. */
    overconfidence: number;
  };
  score: {
    n: number;
    meanAbsError: number;
    /** Share within half a level of the reference. */
    withinHalf: number;
  };
}

export function agreement(observations: Observation[]): Agreement {
  const nouls = observations.filter((o) => o.kind === "noul");
  const choices = observations.filter((o) => o.kind === "choice");
  const scores = observations.filter((o) => o.kind === "score");
  const histogram = Array.from({ length: 10 }, () => 0);
  for (const o of nouls) histogram[Math.min(9, Math.max(0, Math.floor(o.p * 10)))]++;
  const accuracy = mean(choices.map((o) => Number(o.choice === o.reference)));
  const confidence = mean(choices.map((o) => o.confidence));
  return {
    noul: {
      n: nouls.length,
      sameSide: round(mean(nouls.map((o) => Number((o.p >= 0.5) === (asProbability(o.reference) >= 0.5))))),
      meanAbsError: round(mean(nouls.map((o) => Math.abs(o.p - asProbability(o.reference))))),
      atExtremes: round(mean(nouls.map((o) => Number(o.p <= 0.05 || o.p >= 0.95)))),
      inMiddle: round(mean(nouls.map((o) => Number(o.p > 0.35 && o.p < 0.65)))),
      histogram,
    },
    choice: { n: choices.length, accuracy: round(accuracy), meanConfidence: round(confidence), overconfidence: round(confidence - accuracy) },
    score: {
      n: scores.length,
      meanAbsError: round(mean(scores.map((o) => Math.abs(o.score - o.reference)))),
      withinHalf: round(mean(scores.map((o) => Number(Math.abs(o.score - o.reference) <= 0.5)))),
    },
  };
}

// MARK: Suggested thresholds

/** Fewer decisions than this, or only one kind of outcome among them, and no threshold is suggested. */
export const MIN_DECISIONS = 20;

/** Below this share of matching decisions, a suggested line is flagged as weak. */
export const WEAK_BELOW = 0.8;

export interface Suggestion {
  /** The threshold to use for the judge under test; null when the cases can't say. */
  value: number | null;
  /** Share of the cases where it reaches the same decision as the reference. */
  agreement?: number;
  n: number;
  /** Why there is no value, or why not to trust it. */
  note?: string;
}

/**
 * The threshold on `value` that best reproduces the reference's decisions (`positive`). Among equally
 * good ones, the one closest to `prefer` (the reference provider's own threshold) wins.
 */
export function matchThreshold(points: { value: number; positive: boolean }[], grid: number[], prefer: number): Suggestion {
  const short = enough(points);
  if (short) return short;
  let best = { value: prefer, agreement: -1 };
  for (const candidate of grid) {
    const agrees = mean(points.map((point) => Number((point.value >= candidate) === point.positive)));
    if (agrees > best.agreement + 1e-9 || (Math.abs(agrees - best.agreement) <= 1e-9 && Math.abs(candidate - prefer) < Math.abs(best.value - prefer))) best = { value: candidate, agreement: agrees };
  }
  return { value: round(best.value, 2), agreement: round(best.agreement), n: points.length, ...(best.agreement < WEAK_BELOW ? { note: `Weak: even the best line decides differently from the reference ${Math.round((1 - best.agreement) * 100)}% of the time. A threshold won't fix that; look at the prompt or the model.` } : {}) };
}

/** The lowest and highest lines a person's verdicts support, for a fail line and a warn line. */
export const MIN_PRECISION = 0.9;
export const MIN_RECALL = 0.95;

function enough(points: { positive: boolean }[]): Suggestion | null {
  const positives = points.filter((point) => point.positive).length;
  if (points.length < MIN_DECISIONS) return { value: null, n: points.length, note: `Needs at least ${MIN_DECISIONS} reference answers (has ${points.length}).` };
  if (!positives || positives === points.length) return { value: null, n: points.length, note: `Every reference answer is the same (${positives ? "all yes" : "all no"}), so no line can be drawn.` };
  return null;
}

/** The lowest threshold at which at least `minPrecision` of what it flags is truly a yes: a fail line that is rarely wrong. */
export function preciseThreshold(points: { value: number; positive: boolean }[], grid: number[], minPrecision = MIN_PRECISION): Suggestion {
  const short = enough(points);
  if (short) return short;
  for (const candidate of grid) {
    const flagged = points.filter((point) => point.value >= candidate);
    if (flagged.length && mean(flagged.map((point) => Number(point.positive))) >= minPrecision) {
      return { value: round(candidate, 2), agreement: round(mean(points.map((point) => Number((point.value >= candidate) === point.positive)))), n: points.length };
    }
  }
  return { value: null, n: points.length, note: `No threshold is right ${Math.round(minPrecision * 100)}% of the time on these cases.` };
}

/** The highest threshold that still catches at least `minRecall` of the true yeses: a warn line that rarely misses. */
export function sensitiveThreshold(points: { value: number; positive: boolean }[], grid: number[], minRecall = MIN_RECALL): Suggestion {
  const short = enough(points);
  if (short) return short;
  const yeses = points.filter((point) => point.positive);
  for (const candidate of [...grid].reverse()) {
    if (mean(yeses.map((point) => Number(point.value >= candidate))) >= minRecall) {
      return { value: round(candidate, 2), agreement: round(mean(points.map((point) => Number((point.value >= candidate) === point.positive)))), n: points.length };
    }
  }
  return { value: null, n: points.length, note: `No threshold catches ${Math.round(minRecall * 100)}% of the yeses on these cases.` };
}

const steps = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, index) => round(from + index * step, 2));
const PROBABILITY_GRID = steps(0.05, 0.95, 0.05);
const SIMILARITY_GRID = steps(0.5, 3.9, 0.1);

export type Suggested = { qa: Record<keyof Thresholds["qa"], Suggestion>; discover: Record<keyof Thresholds["discover"], Suggestion>; partners: Record<keyof Thresholds["partners"], Suggestion> };

/**
 * A threshold for each decision, from the cases of its area. The reference decides what should have
 * happened: a reference provider's number by that provider's own threshold (the suggestion is then
 * "the line that makes this judge decide like `reference` does"), a person's yes/no as given. When
 * every QA reference is a person's verdict there is no reference line to copy, so the fail line is the
 * lowest that is right 90% of the time and the warn line the highest that still catches 95% of the yeses.
 */
export function suggestThresholds(observations: Observation[], reference: AiProvider = "typesafe"): Suggested {
  const base = THRESHOLDS[reference];
  const nouls = (area: string, pick: (name: string) => boolean) =>
    observations.filter((o): o is Extract<Observation, { kind: "noul" }> => o.kind === "noul" && o.area === area && pick(o.name));
  const line = (points: Extract<Observation, { kind: "noul" }>[], threshold: number) =>
    matchThreshold(points.map((o) => ({ value: o.p, positive: typeof o.reference === "boolean" ? o.reference : o.reference >= threshold })), PROBABILITY_GRID, threshold);
  const points = (list: Extract<Observation, { kind: "noul" }>[]) => list.map((o) => ({ value: o.p, positive: o.reference === true }));
  const policy = nouls("qa", (name) => !name.startsWith("missing_"));
  const byPeople = policy.length > 0 && policy.every((o) => typeof o.reference === "boolean");
  const pitch = nouls("qa", (name) => name.startsWith("missing_"));
  const bios = nouls("partners", () => true);
  const closeness = observations.filter((o): o is Extract<Observation, { kind: "score" }> => o.kind === "score" && o.area === "discover" && o.name === "similarity");
  return {
    qa: {
      failAt: byPeople ? preciseThreshold(points(policy), PROBABILITY_GRID) : line(policy, base.qa.failAt),
      warnAt: byPeople ? sensitiveThreshold(points(policy), PROBABILITY_GRID) : line(policy, base.qa.warnAt),
      missingAt: line(pitch, base.qa.missingAt),
    },
    discover: {
      preselectSimilarity: matchThreshold(closeness.map((o) => ({ value: o.score, positive: o.reference >= base.discover.preselectSimilarity })), SIMILARITY_GRID, base.discover.preselectSimilarity),
    },
    partners: { bioDeclared: line(bios, base.partners.bioDeclared), bioConfirmed: line(bios, base.partners.bioConfirmed) },
  };
}

/** Checks that parsed JSON is a case (or a list of them). Throws a message naming what is wrong. */
export function readCases(parsed: unknown, source: string): CalibrationCase[] {
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map((item, index) => {
    const where = `${source}${list.length > 1 ? ` [${index}]` : ""}`;
    const recorded = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    if (!("state" in recorded)) throw new Error(`${where}: no "state".`);
    if (!recorded.questions || typeof recorded.questions !== "object" || !Object.keys(recorded.questions).length) throw new Error(`${where}: no "questions".`);
    if (!recorded.reference || typeof recorded.reference !== "object") throw new Error(`${where}: no "reference" answers.`);
    return { id: typeof recorded.id === "string" ? recorded.id : where, ...(typeof recorded.area === "string" ? { area: recorded.area } : {}), state: recorded.state as Entry, questions: recorded.questions as Questions, reference: recorded.reference as CalibrationCase["reference"] };
  });
}
