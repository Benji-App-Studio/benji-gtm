import "server-only";
// Server helpers for the owner's session: signing in from a route (the cookies go on the response) and
// knowing, while a page renders, whether this copy is in local mode (lib/install/local-auth.ts).
import { headers } from "next/headers";
import { getInstallConfig } from "@/lib/install/config";
import { classifySignInError, isLocalMode, startedLocalOnly, type SignInErrorLike } from "@/lib/install/local-auth";
import { createClient } from "@/lib/supabase/server";

/** Signs in through the server client, so the session cookies are set on this response. */
export async function serverSignIn(email: string, password: string): Promise<{ ok: true } | { ok: false; error: SignInErrorLike; reason: "signin" | "unreachable" }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { ok: false, error, reason: classifySignInError(error) } : { ok: true };
  } catch {
    return { ok: false, error: { status: 0, message: "network" }, reason: "unreachable" };
  }
}

/** Whether the page being rendered is on a copy in local mode (no login page, no Sign out). */
export async function localModePage(): Promise<boolean> {
  const head = await headers();
  return isLocalMode({ source: getInstallConfig()?.source, startedLocal: startedLocalOnly(), host: head.get("host"), forwardedFor: head.get("x-forwarded-for") });
}

/** The signed-in person's role in this install, or null. */
export async function currentRole(): Promise<{ id: string; email: string | null; role: string | null } | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims?.sub;
  if (!id) return null;
  const { data: member } = await supabase.from("install_members").select("role").eq("user_id", id).maybeSingle<{ role: string }>();
  return { id, email: (data.claims.email as string | undefined) ?? null, role: member?.role ?? null };
}
