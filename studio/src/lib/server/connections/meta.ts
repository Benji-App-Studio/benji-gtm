import "server-only";
import { verifyRemote } from "./remote";
import type { Verifier } from "./verifier";

/**
 * Confirms, with the Marketing API, that this install's system-user token can read the ad account and (when
 * set) the Page in `workspace.connections.meta`. Read-only calls in the metrics edge function, which
 * holds the token; a clear message when META_SYSTEM_USER_TOKEN isn't set.
 */
export const verifyMeta: Verifier = async (ctx) => {
  if (!ctx.workspace.connections.meta?.adAccountId) return { ok: false, message: "Add the ad account ID first." };
  return verifyRemote(ctx, "meta", "Meta");
};
