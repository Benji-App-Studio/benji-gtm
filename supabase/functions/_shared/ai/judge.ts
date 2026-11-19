// The one AI interface the engine and QA depend on: a judge answers named questions about a block of
// text (the `state`). Three kinds of question: yes/no (`noul`), pick one label (`choice`) and rate on
// a rubric (`score`). Every answer is a probability, never prose.
//
// Two implementations: OpenAI (openai-judge.ts, the default) and TypeSafe's Jev (typesafe-judge.ts).
// The shapes here are the ones the TypeSafe SDK uses, so a TypeSafe client is itself a Judge and the
// tests' hand-written fakes ({ systemOne }) keep working. Plain TypeScript: Deno and Node both load it.

/** A JSON-compatible value. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
/** Text, a JSON object or array, or null: what a state, an instruction or a criterion may be. */
export type Entry = string | { [key: string]: JsonValue } | JsonValue[] | null;

/** Yes or no, with optional descriptions of what each means. */
export interface NoulQuestion {
  type: "noul";
  instructions?: Entry;
  criteria?: { true?: Entry; false?: Entry } | null;
}
/** Labels mapped to what each means (null: no description). */
export type ChoiceCriteria = { [label: string]: Entry };
/** Pick one label. */
export interface ChoiceQuestion<T extends ChoiceCriteria = ChoiceCriteria> {
  type: "choice";
  instructions?: Entry;
  criteria: T;
}
/** At least two descriptions, indexed by score from zero. */
export type ScoreCriteria = readonly [Entry, Entry, ...Entry[]];
/** Rate on an ordered rubric. */
export interface ScoreQuestion<T extends ScoreCriteria = ScoreCriteria> {
  type: "score";
  instructions?: Entry;
  criteria: T;
}
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
/** Questions keyed by the name their answer comes back under. */
export interface Questions { [name: string]: Question }

/** The probability of yes, from 0 to 1. */
export interface NoulAnswer { readonly noul: number }
/** The chosen label, the probability given to it, and the probability of every label (they sum to 1). */
export interface ChoiceAnswer<T extends ChoiceCriteria = ChoiceCriteria> {
  readonly choice: keyof T & string;
  readonly confidence: number;
  readonly probabilities: { readonly [label in keyof T]: number };
}
/** The expected score (it may fall between rubric levels), a confidence, and the probability of every level. */
export interface ScoreAnswer {
  readonly score: number;
  readonly confidence: number;
  readonly probabilities: { readonly [level: string]: number };
}
export type AnswerFor<Q extends Question> = Q extends NoulQuestion ? NoulAnswer
  : Q extends ScoreQuestion ? ScoreAnswer
  : Q extends ChoiceQuestion<infer T> ? ChoiceAnswer<T>
  : never;

export interface Usage { readonly input_tokens: number; readonly output_tokens: number }

export interface JudgeRequest<Q extends Questions = Questions> {
  /** What is being judged. */
  state: Entry;
  /** At least one question. */
  questions: Q;
}
export interface JudgeResult<Q extends Questions = Questions> {
  /** The model that answered. */
  readonly model: string;
  readonly answers: { readonly [K in keyof Q]: AnswerFor<Q[K]> };
  /** Tokens used, summed over every request the answer took. */
  readonly usage: Usage;
}

export type AiProvider = "openai" | "typesafe";

export interface Judge {
  /** Answers every question about `state`. Rejects when the provider can't be reached or its answer can't be trusted. */
  systemOne<const Q extends Questions>(input: JudgeRequest<Q>): PromiseLike<JudgeResult<Q>>;
  /**
   * Which provider answers. Thresholds on the probabilities depend on it (thresholds.ts); a judge that
   * doesn't say (a test fake, a bare TypeSafe client) is read as TypeSafe, the provider they were tuned on.
   */
  readonly provider?: AiProvider;
}

/** Why a judge couldn't answer. `config`: a key or setting is missing (the message says what to do). */
export type JudgeErrorKind = "config" | "http" | "timeout" | "output";

export class JudgeError extends Error {
  readonly kind: JudgeErrorKind;
  readonly provider: AiProvider;
  /** The HTTP status, when the provider answered with an error. */
  readonly status?: number;
  constructor(kind: JudgeErrorKind, provider: AiProvider, message: string, status?: number) {
    super(message);
    this.name = "JudgeError";
    this.kind = kind;
    this.provider = provider;
    if (status !== undefined) this.status = status;
  }
}
