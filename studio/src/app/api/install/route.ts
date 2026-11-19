import { isResponse, requireUser } from "@/lib/server/auth";
import { callFunction, relay } from "@/lib/server/functions";
import type { InstallState } from "@/lib/install/types";

/** This install as the signed-in person may see it: their role, the settings, and which keys are set (never a key's value). */
export async function GET() {
  const session = await requireUser();
  if (isResponse(session)) return session;
  return relay(await callFunction<InstallState>("install", session, "capabilities", {
    messages: { notDeployed: "The install backend isn't deployed yet. Open /setup and run the update." },
  }));
}
