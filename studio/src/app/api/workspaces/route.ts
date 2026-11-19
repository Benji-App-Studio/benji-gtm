import { isResponse, requireUser } from "@/lib/server/auth";
import { listWorkspaces } from "@/lib/workspace";
import { caughtFailure } from "@/lib/server/errors";

/** The signed-in user's workspaces (one per product), for the switcher. */
export async function GET() {
  const session = await requireUser();
  if (isResponse(session)) return session;
  try {
    return Response.json(await listWorkspaces(session.supabase));
  } catch (error) {
    return caughtFailure("workspaces list", error, "Couldn't load your workspaces. Try again.");
  }
}
