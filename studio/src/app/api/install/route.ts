import { isResponse, requireUser } from "@/lib/server/auth";
import { bundledMigration } from "@/lib/server/bundled-migrations";
import { callFunction, relay } from "@/lib/server/functions";
import type { InstallState } from "@/lib/install/types";
import { updateCheck } from "@/lib/install/update-needed";

/**
 * This install as the signed-in person may see it: their role, the settings, and which keys are set
 * (never a key's value). Adds `updateNeeded` and `schema`: whether this copy of the app carries
 * database changes the project doesn't have yet ("Apply the update" on /setup was skipped).
 */
export async function GET() {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const result = await callFunction<InstallState>("install", session, "capabilities", {
    messages: { notDeployed: "The install backend isn't deployed yet. Open /setup and run the update." },
  });
  if (!result.ok) return relay(result);
  const { schemaVersion, ...state } = result.data;
  return relay({ ...result, data: { ...state, ...updateCheck(schemaVersion, bundledMigration(), state.owned) } });
}
