import "server-only";
// The `research` edge function (paid-ads pulls and decodes), called as the signed-in user, like radar().
import type { Session } from "./auth";
import { callFunction } from "./functions";
import type { RadarResult } from "./radar";

export function research<T = Record<string, unknown>>(session: Session, route: string, body?: unknown, timeoutMs = 60_000): Promise<RadarResult<T>> {
  return callFunction<T>("research", session, route, {
    body: body ?? {},
    timeoutMs,
    messages: {
      notDeployed: "The research backend isn't deployed yet.",
      badAnswer: (status) => `Research answered ${status}. Try again in a moment.`,
      unreachable: "Couldn't reach the research backend. Try again in a moment.",
    },
  });
}

export type ReadNew = { pending?: number; running?: boolean; error?: string };

/**
 * Starts reading the product's new ads in the background (the function's `decode-new`: one run at a
 * time per product, so asking twice is harmless). Asked after an import or a pull lands, and by the
 * Research page when it opens with unread ads; it never fails the caller.
 */
export function readNewAds(session: Session, productId: string) {
  return research<ReadNew>(session, "decode-new", { productId }, 8000);
}
