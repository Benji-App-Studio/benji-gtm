import { NextResponse, type NextRequest } from "next/server";
import { sanitizeNext } from "@/lib/auth/flows";
import { sameSiteRedirect } from "@/lib/auth/session-gate";
import { getInstallConfig } from "@/lib/install/config";
import { afterSignIn } from "@/lib/server/after-sign-in";
import { createClient } from "@/lib/supabase/server";

/**
 * Where Google's own sign-in button sends the browser once Supabase accepted Google's token (the session
 * cookies are already set). Does what /auth/confirm does after a sign-in, then goes to `next`, a path
 * inside this app only. No session: back to the login page with "Google sign-in didn't finish".
 */
export async function GET(request: NextRequest) {
  if (!getInstallConfig()) return sameSiteRedirect(NextResponse, "/setup");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return sameSiteRedirect(NextResponse, "/login?error=oauth");
  await afterSignIn(supabase);
  return sameSiteRedirect(NextResponse, sanitizeNext(request.nextUrl.searchParams.get("next")) ?? "/onboarding");
}
