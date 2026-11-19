import { isResponse, requireUser } from "@/lib/server/auth";
import { listWorkspaces } from "@/lib/workspace";

/** The signed-in user's workspaces (one per product), for the switcher. */
export async function GET() {
  const session = await requireUser();
  if (isResponse(session)) return session;
  try {
    return Response.json(await listWorkspaces(session.supabase));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
