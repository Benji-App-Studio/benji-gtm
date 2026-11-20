import { getTranslator } from "@/lib/i18n/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { callFunction, relay } from "@/lib/server/functions";
import type { KeyState } from "@/lib/install/types";

/**
 * Creates the desktop runner's secret, or replaces it (the old one stops working at once). Owner only:
 * the install function checks. The answer carries the secret itself, this one time; it is never stored
 * or logged by the studio.
 */
export async function POST() {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { t } = await getTranslator();
  return relay(await callFunction<{ secret: string; key: KeyState }>("install", session, "runner-secret/rotate", {
    body: {},
    messages: { notDeployed: t("The install backend isn't deployed yet. Open /setup and run the update.") },
  }));
}
