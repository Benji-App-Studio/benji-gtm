import { NextResponse, type NextRequest } from "next/server";
import { localModeRequest } from "@/lib/server/provision/request-access";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  // A copy in local mode signs its owner in by itself, so there is nothing to sign out of: back to the app.
  if (localModeRequest(request)) return NextResponse.redirect(new URL("/app", request.nextUrl.origin), { status: 303 });
  const supabase = await createClient();
  await supabase.auth.signOut();
  const response = NextResponse.redirect(new URL("/", request.nextUrl.origin), { status: 303 });
  // Lists kept in the browser for fast reloads (IndexedDB, lib/client-cache.ts) go with the session.
  response.headers.set("Clear-Site-Data", '"storage"');
  return response;
}
