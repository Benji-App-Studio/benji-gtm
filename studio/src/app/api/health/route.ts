import { radar, relay } from "@/lib/server/radar";

/** Whether the backend's keys are set (in Supabase), never their values. */
export async function GET() {
  return relay(await radar(null, "health"));
}
