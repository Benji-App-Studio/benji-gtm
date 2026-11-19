import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const response = NextResponse.redirect(new URL("/", request.nextUrl.origin), { status: 303 });
  // Lists kept in the browser for fast reloads (IndexedDB, lib/client-cache.ts) go with the session.
  response.headers.set("Clear-Site-Data", '"storage"');
  return response;
}
