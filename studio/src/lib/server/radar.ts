import "server-only";
// The studio holds no API keys: everything that needs one (the AI, Apify) runs in the `radar`
// Supabase edge function. API routes call it as the signed-in user.
import type { Session } from "./auth";
import { callFunction, relay as relayResult, type FunctionResult } from "./functions";

export type RadarResult<T> = FunctionResult<T>;

export function radar<T = Record<string, unknown>>(session: Session | null, route: string, body?: unknown): Promise<RadarResult<T>> {
  return callFunction<T>("radar", session, route, {
    body,
    messages: {
      badAnswer: (status) => `The analysis backend answered ${status}. Try again in a moment.`,
      unreachable: "Couldn't reach the analysis backend. Try again in a moment.",
    },
  });
}

/** Passes the edge function's answer (or its error) straight back to the page. */
export const relay = relayResult;
