import "server-only";
import { verifyRemote } from "./remote";
import type { Verifier } from "./verifier";

/**
 * Confirms, with AppStack's Export API, that this install's key for `workspace.connections.appstack.appId`
 * (APPSTACK_API_KEY_<APP>, else APPSTACK_API_KEY) can read its attribution. Runs in the metrics edge
 * function, which holds the key; a clear message when it isn't set.
 */
export const verifyAppStack: Verifier = async (ctx) => {
  if (!ctx.workspace.connections.appstack?.appId) return { ok: false, message: "Add the AppStack app ID first." };
  return verifyRemote(ctx, "appstack", "AppStack");
};
