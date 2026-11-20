import { NextResponse, type NextRequest } from "next/server";
import { sameSiteRedirect } from "@/lib/auth/session-gate";
import { confirmStep } from "@/lib/auth/flows";
import { getInstallConfig } from "@/lib/install/config";
import { afterSignIn } from "@/lib/server/after-sign-in";
import { createClient } from "@/lib/supabase/server";

/**
 * Where every sign-in link comes back to: the confirmation email, the password-reset email and Google.
 * A `code` (the PKCE flow: Google, and emails sent from this browser) or a `token_hash` (an email
 * template that links here directly, which works in any browser) signs the person in; then they go to
 * `next`, a path inside this app only. What happens is decided by `confirmStep` (lib/auth/flows.ts).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  // No project connected yet: there is nothing to confirm against, so start at setup.
  if (!getInstallConfig()) return sameSiteRedirect(NextResponse, "/setup");
  const params = url.searchParams;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const step = confirmStep({
    next: params.get("next"), code: params.get("code"), tokenHash: params.get("token_hash"), type: params.get("type"),
    error: params.get("error"), errorCode: params.get("error_code"), via: params.get("via"), switchAccount: params.get("switch") === "1",
  }, Boolean(claims?.claims?.sub));
  // Relative, so the browser stays on the host the link opened (where the session cookies were just set).
  const go = (to: string) => sameSiteRedirect(NextResponse, to);

  if (step.action === "fail" || step.action === "ask") return go(step.to);
  if (step.action === "exchange") {
    if ((await supabase.auth.exchangeCodeForSession(step.code)).error) return go(step.failTo);
  } else {
    // The person chose to leave the account they were signed in to (on /switch-account).
    if (step.signOutFirst) await supabase.auth.signOut({ scope: "local" });
    if ((await supabase.auth.verifyOtp({ token_hash: step.tokenHash, type: step.type })).error) return go(step.failTo);
  }
  await afterSignIn(supabase);
  return go(step.then);
}
