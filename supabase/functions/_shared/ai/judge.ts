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

/**
 * Why a judge couldn't answer. `config`: a key or setting is missing (the message says what to do).
 * `account`: the provider refused the key itself (revoked, wrong, out of credit, billing): nothing
 * else will work until the person fixes it, so callers stop and say so instead of skipping items.
 */
export type JudgeErrorKind = "config" | "account" | "http" | "timeout" | "output";

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

// MARK: Refused keys

const PROVIDER_NAME: Record<AiProvider, string> = { openai: "OpenAI", typesafe: "TypeSafe" };

/** The sentence for a refused key: "OpenAI refused the key: <reason> Check Settings > API keys." */
export function refusedKeyMessage(provider: AiProvider, detail: string): string {
  const reason = detail.replace(/\s+/g, " ").trim().slice(0, 200) || "no reason given";
  return `${PROVIDER_NAME[provider]} refused the key: ${/[.!?]$/.test(reason) ? reason : `${reason}.`} Check Settings > API keys.`;
}

const ACCOUNT_CODES = /^(insufficient_quota|invalid_api_key|account_deactivated|billing_hard_limit_reached|billing_not_active|access_terminated|unauthorized)$/i;
const ACCOUNT_TEXT = /insufficient[_ ]quota|exceeded your current quota|billing|incorrect api key|invalid api key|api key (is )?(invalid|revoked|expired|disabled)|account (is )?(deactivated|disabled|suspended)|out of credit/i;

/**
 * A provider's error answer that means the key itself is refused: 401, 402 or 403, or a quota or
 * billing error (OpenAI's out-of-credit answer is a 429 with code `insufficient_quota`). Null for
 * anything else (a busy 429, a bad request, a server error), which is about one request, not the key.
 */
export function keyRefusal(provider: AiProvider, status: number, body: unknown): JudgeError | null {
  const error = (body && typeof body === "object" ? (body as { error?: unknown }).error : undefined) as { code?: unknown; type?: unknown; message?: unknown } | string | undefined;
  const code = typeof error === "object" && error ? String(error.code ?? error.type ?? "") : "";
  const message = typeof error === "string" ? error : typeof error === "object" && error ? String(error.message ?? "") : "";
  const refused = status === 401 || status === 402 || status === 403 || ACCOUNT_CODES.test(code) || (status === 429 && ACCOUNT_TEXT.test(message));
  if (!refused) return null;
  return new JudgeError("account", provider, refusedKeyMessage(provider, message || code || `error ${status}`), status);
}

/**
 * Whether a thrown error means the AI key is refused (an `account` JudgeError, or any error carrying
 * such a status or message, e.g. from the TypeSafe SDK). Answers that error as an `account` JudgeError,
 * or null. Callers that skip a failed item use it so a dead key never reads as "nothing found".
 */
export function accountError(error: unknown, provider: AiProvider = "openai"): JudgeError | null {
  if (error instanceof JudgeError) {
    if (error.kind === "account") return error;
    if (error.kind === "config") return null;
    if (error.status !== undefined) {
      const refused = keyRefusal(error.provider, error.status, { error: { message: error.message.replace(/^(OpenAI|TypeSafe): /, "") } });
      if (refused) return refused;
    }
    return null;
  }
  if (!error || typeof error !== "object") return null;
  const e = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown };
  const status = Number(e.status ?? e.statusCode);
  const message = String(e.message ?? "");
  const refused = Number.isFinite(status) ? keyRefusal(provider, status, { error: { code: e.code, message } }) : null;
  if (refused) return refused;
  if (ACCOUNT_TEXT.test(message) || (typeof e.code === "string" && ACCOUNT_CODES.test(e.code))) {
    return new JudgeError("account", provider, refusedKeyMessage(provider, message || String(e.code)));
  }
  return null;
}
