import "server-only";
import { verifyRemote } from "./remote";
import type { Verifier } from "./verifier";

/**
 * Confirms, with RevenueCat's API (the project's overview metrics), that
 * `workspace.connections.revenuecat.projectId` exists and this install's key can read it. Runs in the metrics
 * edge function, which holds REVENUECAT_API_KEY; a clear message when it isn't set.
 */
export const verifyRevenueCat: Verifier = async (ctx) => {
  if (!ctx.workspace.connections.revenuecat?.projectId) return { ok: false, message: "Add the RevenueCat project ID first." };
  return verifyRemote(ctx, "revenuecat", "RevenueCat");
};
