// Which judge an install uses, and the one place it is made.
//
//   TypeSafe  when Settings say so (`aiProvider: "typesafe"`) and its key is set.
//   OpenAI    otherwise: the default, so an install needs only an OpenAI key.
//   Legacy    an install with no settings at all (set up before the install row existed) that has a
//             TypeSafe key keeps using TypeSafe, so nothing about it changes.
//
// A missing key is a JudgeError of kind "config" whose message says what to add and where (the shared
// wording of _shared/keys.ts).
import { type AiProvider, type Judge, JudgeError } from "./judge.ts";
import { type KeyReader, modelOverrides, type ModelSettings, resolveModels } from "./models.ts";
import { openaiJudge } from "./openai-judge.ts";
import { typesafeJudge } from "./typesafe-judge.ts";
import { addKeyMessage } from "../keys.ts";

export { type KeyReader, modelOverrides };

/** The part of `install.settings` that concerns AI. */
export interface AiSettings {
  aiProvider?: unknown;
  /** A `ModelSettings`, as stored. */
  models?: ModelSettings | null | unknown;
}

export interface JudgeChoice {
  keys: KeyReader;
  /** `install.settings`; null or undefined when the install has no settings at all (an older install). */
  settings?: AiSettings | null;
}

export interface CreateJudgeOptions extends JudgeChoice {
  fetch?: typeof fetch;
  /** For each request to the provider. Default: 30 s on TypeSafe, 60 s on OpenAI (it answers slower). */
  timeoutMs?: number;
}

export const OPENAI_KEY = "OPENAI_API_KEY";
export const TYPESAFE_KEY = "TYPESAFE_API_KEY";

/** The provider this install judges with and its key. Throws a "config" JudgeError when the key it needs isn't set. */
export async function chooseProvider(o: JudgeChoice): Promise<{ provider: AiProvider; apiKey: string }> {
  const wantsTypesafe = o.settings?.aiProvider === "typesafe";
  const legacy = o.settings == null;
  const typesafeKey = wantsTypesafe || legacy ? await o.keys.get(TYPESAFE_KEY) : undefined;
  if (typesafeKey) return { provider: "typesafe", apiKey: typesafeKey };
  const openaiKey = await o.keys.get(OPENAI_KEY);
  if (openaiKey) return { provider: "openai", apiKey: openaiKey };
  if (wantsTypesafe) {
    throw new JudgeError("config", "typesafe", `The AI isn't connected: TypeSafe is the provider chosen in Settings. ${addKeyMessage(TYPESAFE_KEY)}`);
  }
  throw new JudgeError("config", "openai", `The AI isn't connected. ${addKeyMessage(OPENAI_KEY)}`);
}

/** Whether a judge can be made, without throwing: for a function's health answer or a check before starting a long run. */
export async function judgeAvailability(o: JudgeChoice): Promise<{ ok: true; provider: AiProvider } | { ok: false; message: string }> {
  try {
    return { ok: true, provider: (await chooseProvider(o)).provider };
  } catch (error) {
    if (error instanceof JudgeError && error.kind === "config") return { ok: false, message: error.message };
    throw error;
  }
}

/** The judge for this install. Throws a "config" JudgeError when the key it needs isn't set. */
export async function createJudge(o: CreateJudgeOptions): Promise<Judge> {
  const { provider, apiKey } = await chooseProvider(o);
  const shared = { apiKey, ...(o.fetch ? { fetch: o.fetch } : {}), ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) };
  if (provider === "typesafe") return typesafeJudge(shared);
  const models = resolveModels(o.settings?.models, await modelOverrides(o.keys));
  return openaiJudge({ ...shared, model: models.judge });
}
