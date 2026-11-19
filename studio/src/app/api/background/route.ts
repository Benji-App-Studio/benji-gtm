import { isResponse, requireUser } from "@/lib/server/auth";
import { getBackgroundTasks } from "@/lib/server/background";

/** What's running in the background right now (media saving, Studio batches, Launch uploads, analyses). */
export async function GET() {
  const session = await requireUser();
  if (isResponse(session)) return session;
  return Response.json({ tasks: await getBackgroundTasks(session.supabase) }, { headers: { "Cache-Control": "no-store" } });
}
