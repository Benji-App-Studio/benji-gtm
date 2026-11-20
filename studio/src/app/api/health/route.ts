import { isResponse, requireUser } from "@/lib/server/auth";
import { radar, relay } from "@/lib/server/radar";

/**
 * Whether the backend's keys are set (in Supabase), never their values. Sent with the session when there
 * is one: in accounts mode the answer is about the caller's own keys (without one it is only
 * `{ ok, mode }`); install and legacy mode answer the same either way.
 */
export async function GET() {
  const session = await requireUser();
  return relay(await radar(isResponse(session) ? null : session, "health"));
}
