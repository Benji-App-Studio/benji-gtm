// Every model default in one place, and the one rule for which model a step uses:
// an environment variable (or the same name stored as a key) wins, then the install's
// Settings > Models (`install.settings.models`), then the default here.
//
// The defaults are the names the functions already used as literals; nothing here is new.
// Plain TypeScript, no runtime APIs and no imports: a function that only needs model names (insight)
// loads this file alone, without the judge or the TypeSafe SDK.

/** What each step runs on when nothing overrides it. */
export const MODEL_DEFAULTS = {
  /** Text reasoning with OpenAI: competitor search, product insight, sorting. */
  text: "gpt-6.1-sol",
  /** Reading images: OCR, the logo check, the ad scan. */
  vision: "gpt-6.1-sol",
  /** Speech to text. The only one that returns segment timings (see TIMED_TRANSCRIBE_MODELS). */
  transcribe: "whisper-1",
  /** Image generation: the everyday model, and the one for precise edits. */
  image: "gpt-image-2.5-flare",
  imageEdit: "gpt-image-2.5-sunburst",
} as const;

/** Transcription models that answer with timed segments (`verbose_json`); others answer with plain text. */
export const TIMED_TRANSCRIBE_MODELS: readonly string[] = ["whisper-1"];

/** The environment variables (or stored keys) that override a model, as before. */
export const MODEL_ENV = {
  /** Text, and (as it always did) vision, ad copy and the judge unless they have their own. */
  text: "OPENAI_MODEL",
  copy: "OPENAI_COPY_MODEL",
  transcribe: "OPENAI_TRANSCRIBE_MODEL",
  /** New with the OpenAI judge: lets the high-volume yes/no, choice and score questions run on another model. */
  judge: "OPENAI_JUDGE_MODEL",
} as const;
export const MODEL_ENV_NAMES: readonly string[] = Object.values(MODEL_ENV);

/** `install.settings.models`: any of these, all optional. */
export interface ModelSettings {
  text?: string | null;
  vision?: string | null;
  transcribe?: string | null;
  image?: string | null;
  imageEdit?: string | null;
  /** Ad copy; follows `text` when not set. */
  copy?: string | null;
  /** The OpenAI judge; follows `text` when not set. */
  judge?: string | null;
}

export interface Models {
  text: string;
  vision: string;
  transcribe: string;
  image: string;
  imageEdit: string;
  copy: string;
  judge: string;
}

/** A lookup by variable name, or the values themselves. */
export type ModelEnv = ((name: string) => string | undefined) | Record<string, string | undefined | null>;

/**
 * How keys are read. `Keys` from `_shared/keys.ts` is one of these (environment first, then Vault);
 * only `get` is used, so this file needs no import.
 */
export interface KeyReader {
  get(name: string): Promise<string | undefined>;
}

/** Model names set as environment variables or stored keys, for `resolveModels`. A read that fails is no override. */
export async function modelOverrides(keys: KeyReader): Promise<Record<string, string | undefined>> {
  const values = await Promise.all(MODEL_ENV_NAMES.map((name) => keys.get(name).catch(() => undefined)));
  return Object.fromEntries(MODEL_ENV_NAMES.map((name, index) => [name, values[index]]));
}

const clean = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/**
 * The model for every step.
 *
 * `settings` is `install.settings.models` as stored (a `ModelSettings`; absent on an older install). `env` is the environment, or
 * values read through the key reader (`modelOverrides` above), so a model name stored as a key
 * overrides too, as OPENAI_MODEL and OPENAI_TRANSCRIBE_MODEL always could.
 *
 * OPENAI_MODEL keeps its reach: it sets text, vision, ad copy (unless OPENAI_COPY_MODEL) and the judge
 * (unless OPENAI_JUDGE_MODEL). Without it, vision takes its own setting and never follows `text`
 * (a text-only model can't read images); ad copy and the judge follow `text`.
 */
export function resolveModels(settings?: ModelSettings | null | unknown, env: ModelEnv = {}): Models {
  const read = (name: string) => clean(typeof env === "function" ? env(name) : env[name]);
  // Settings come from the database as plain JSON: anything that isn't a model name is ignored.
  const set = (settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {}) as Record<string, unknown>;
  const main = read(MODEL_ENV.text);
  const text = main ?? clean(set.text) ?? MODEL_DEFAULTS.text;
  return {
    text,
    vision: main ?? clean(set.vision) ?? MODEL_DEFAULTS.vision,
    transcribe: read(MODEL_ENV.transcribe) ?? clean(set.transcribe) ?? MODEL_DEFAULTS.transcribe,
    image: clean(set.image) ?? MODEL_DEFAULTS.image,
    imageEdit: clean(set.imageEdit) ?? MODEL_DEFAULTS.imageEdit,
    copy: read(MODEL_ENV.copy) ?? main ?? clean(set.copy) ?? text,
    judge: read(MODEL_ENV.judge) ?? main ?? clean(set.judge) ?? text,
  };
}
