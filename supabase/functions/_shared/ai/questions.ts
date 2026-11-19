// Builders for the three kinds of question a judge answers. They produce the same objects the
// TypeSafe SDK's `noul`, `choice` and `score` do, so the engine no longer imports the SDK to ask.
import type { ChoiceCriteria, ChoiceQuestion, Entry, NoulQuestion, Question, Questions, ScoreCriteria, ScoreQuestion } from "./judge.ts";

export type { Question, Questions };

/** A yes/no question, with optional descriptions of what yes and no mean. */
export const noul = (instructions: Entry = null, criteria?: NoulQuestion["criteria"]): NoulQuestion => ({ type: "noul", instructions, criteria });

/** A question that picks one label. `criteria` maps each label to what it means. */
export function choice<const T extends ChoiceCriteria>(instructions: Entry, criteria: T): ChoiceQuestion<T> {
  if (Array.isArray(criteria)) throw new TypeError("Choice criteria must be a map of labels to descriptions, not a list.");
  return { type: "choice", instructions, criteria };
}

/** A question that rates on a rubric. `criteria` lists what each score means, from zero up. */
export function score<const T extends ScoreCriteria>(instructions: Entry, criteria: T): ScoreQuestion<T> {
  if (!Array.isArray(criteria)) throw new TypeError("Score criteria must be a list of descriptions indexed by score from zero, not a map.");
  return { type: "score", instructions, criteria };
}

/** Rejects what no provider can answer: no questions, a choice with no labels, a score with fewer than two levels. */
export function validateQuestions(questions: Questions): void {
  const names = Object.keys(questions ?? {});
  if (!names.length) throw new TypeError("A judge needs at least one question.");
  for (const name of names) {
    const question = questions[name];
    if (question?.type === "noul") continue;
    if (question?.type === "choice") {
      if (!question.criteria || Array.isArray(question.criteria) || !Object.keys(question.criteria).length) throw new TypeError(`Question "${name}": a choice needs at least one label.`);
      continue;
    }
    if (question?.type === "score") {
      if (!Array.isArray(question.criteria) || question.criteria.length < 2) throw new TypeError(`Question "${name}": a score needs a list of at least two levels.`);
      continue;
    }
    throw new TypeError(`Question "${name}" has an unknown type.`);
  }
}
