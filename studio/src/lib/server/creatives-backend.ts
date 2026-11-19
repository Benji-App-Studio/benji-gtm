import "server-only";
// The `creatives` edge function holds the keys (the AI, Higgsfield, Drive); API routes call it as the
// signed-in user, like the radar function.
import type { Session } from "./auth";
import { callFunction, type FunctionResult } from "./functions";

export type BackendResult<T> = FunctionResult<T>;

export function creativesBackend<T = Record<string, unknown>>(session: Session, route: string, body?: unknown, o: { timeoutMs?: number } = {}): Promise<BackendResult<T>> {
  return callFunction<T>("creatives", session, route, {
    body,
    timeoutMs: o.timeoutMs,
    messages: {
      badAnswer: (status) => `The creatives backend answered ${status}.`,
      unreachable: "Couldn't reach the creatives backend. Try again in a moment.",
    },
  });
}
