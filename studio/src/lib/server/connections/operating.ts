import "server-only";
import { verifyRemote } from "./remote";
import type { Verifier } from "./verifier";

/**
 * Confirms, with Mixpanel's Query API, that this install's service account (MIXPANEL_SERVICE_ACCOUNT) can
 * read `workspace.connections.mixpanel.projectId` in its data residency, and that the install event is
 * there. Runs in the metrics edge function, which holds the secret.
 */
export const verifyMixpanel: Verifier = async (ctx) => {
  if (!ctx.workspace.connections.mixpanel?.projectId) return { ok: false, message: "Add the Mixpanel project ID first." };
  return verifyRemote(ctx, "mixpanel", "Mixpanel");
};

/**
 * Confirms, with Superwall's API, that this install's organization key (SUPERWALL_API_KEY) finds
 * `workspace.connections.superwall.applicationId` and can query its paywall analytics.
 */
export const verifySuperwall: Verifier = async (ctx) => {
  if (!ctx.workspace.connections.superwall?.applicationId) return { ok: false, message: "Add the Superwall application ID first." };
  return verifyRemote(ctx, "superwall", "Superwall");
};
