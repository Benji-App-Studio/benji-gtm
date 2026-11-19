// The judge on TypeSafe's Jev: the SDK client behind the Judge interface. Jev's probabilities are
// calibrated, and the thresholds in thresholds.ts were tuned on them.
//
// The only file that imports the SDK. The full npm specifier (the version the functions' lockfiles
// pin) means a function needs no import map entry for it.
import { TypeSafeClient } from "npm:@typesafe-ai/sdk@0.6.0";
import { accountError, type Judge, type JudgeRequest, type JudgeResult, type Questions } from "./judge.ts";

/** The part of a TypeSafe client the judge uses (a `TypeSafeClient`, or a stand-in in tests). */
export interface TypeSafeLike {
  systemOne<const Q extends Questions>(request: JudgeRequest<Q>): PromiseLike<JudgeResult<Q>>;
}

export interface TypeSafeJudgeOptions {
  apiKey: string;
  /** For each attempt (the SDK retries twice). Default 30 s, what the functions always passed. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export const TYPESAFE_TIMEOUT_MS = 30_000;

/**
 * A judge that answers with Jev. Give it a client, or the key to make one with. The client is made on
 * the first question, not here: the SDK reads its optional environment settings when constructed.
 */
export function typesafeJudge(source: TypeSafeLike | TypeSafeJudgeOptions): Judge {
  let client: TypeSafeLike | undefined = "systemOne" in source ? source : undefined;
  const options = source as TypeSafeJudgeOptions;
  return {
    provider: "typesafe",
    systemOne<const Q extends Questions>(input: JudgeRequest<Q>): PromiseLike<JudgeResult<Q>> {
      client ??= new TypeSafeClient({ apiKey: options.apiKey, timeout: options.timeoutMs ?? TYPESAFE_TIMEOUT_MS, ...(options.fetch ? { fetch: options.fetch } : {}) });
      // A refused key comes back as an `account` JudgeError, as from OpenAI (judge.ts accountError).
      return Promise.resolve(client.systemOne(input)).catch((error: unknown) => { throw accountError(error, "typesafe") ?? error; });
    },
  };
}
