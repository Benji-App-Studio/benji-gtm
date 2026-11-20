import { NextResponse, type NextRequest } from "next/server";
import { sameSiteRedirect } from "@/lib/auth/session-gate";
import { localModeRequest } from "@/lib/server/provision/request-access";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  // A copy in local mode signs its owner in by itself, so there is nothing to sign out of: back to the app.
  if (localModeRequest(request)) return sameSiteRedirect(NextResponse, "/app");
  const supabase = await createClient();
  await supabase.auth.signOut();
  // A relative address: the browser stays on the host it is on (request.nextUrl.origin can name the
  // server's own bind address behind a proxy, which has none of this site's cookies).
  const response = sameSiteRedirect(NextResponse, "/");
  // Lists kept in the browser for fast reloads (IndexedDB, lib/client-cache.ts) go with the session.
  response.headers.set("Clear-Site-Data", '"storage"');
  return response;
}
