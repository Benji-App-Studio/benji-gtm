import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getInstallConfig } from "@/lib/install/config";
import { createClient } from "@/lib/supabase/server";

/** The link in the confirmation email: confirms the address, signs the user in and continues. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  // No project connected yet: there is nothing to confirm against, so start at setup.
  if (!getInstallConfig()) return NextResponse.redirect(new URL("/setup", url.origin));
  // Only a path inside this app: "//host" and "/\\host" would send the person to another site.
  const wanted = url.searchParams.get("next") ?? "";
  const next = /^\/(?![/\\])/.test(wanted) ? wanted : "/onboarding";
  const supabase = await createClient();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type }) : { error: new Error("Missing code") };
  return NextResponse.redirect(new URL(error ? "/login?error=confirm" : next, url.origin));
}
