import { NextResponse, type NextRequest } from "next/server";
import { sameSiteRedirect, sessionEndedRedirect } from "@/lib/auth/session-gate";
import { createClient } from "@/lib/supabase/server";

/**
 * A session that outlived its account (deleted, or ended elsewhere while the browser kept an unexpired
 * token): the layouts send it here (lib/auth/session-gate.ts). Only a session whose user Supabase no
 * longer knows is cleared, so a link to this page can't sign anyone out; a live one goes back to the app.
 * ?then=goodbye (the account deletion page, when a call answered 401 part way): an account Supabase says
 * is gone was deleted by a call whose answer the page never got, so it ends on the goodbye page.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const alive = Boolean(data?.user);
  // Supabase's own answer that the account behind the token is gone (not an expired or ended session).
  const gone = !alive && (error as { code?: string } | null)?.code === "user_not_found";
  const afterDeletion = gone && request.nextUrl.searchParams.get("then") === "goodbye";
  const response = sameSiteRedirect(NextResponse, sessionEndedRedirect(alive, afterDeletion));
  if (alive) return response;
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  // Whatever signOut couldn't clear (it had nothing to end on the server): the session's cookies go too.
  for (const cookie of request.cookies.getAll()) {
    if (/^sb-.+-auth-token(\.\d+)?$/.test(cookie.name)) response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
  }
  // Lists kept in the browser for fast reloads belong to the account that is gone.
  response.headers.set("Clear-Site-Data", '"storage"');
  response.headers.set("Cache-Control", "no-store");
  return response;
}
