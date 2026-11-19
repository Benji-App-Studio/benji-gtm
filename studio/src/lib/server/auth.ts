import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getInstallConfig } from "@/lib/install/config";
import { createClient } from "@/lib/supabase/server";

export interface Session { supabase: SupabaseClient; user: { id: string; email?: string } }

/**
 * The signed-in user for an API route, or a 401 response to return. The session's JWT is checked
 * locally against the project's signing keys, so this costs no round trip to Supabase.
 */
export async function requireUser(): Promise<Session | Response> {
  if (!getInstallConfig()) return Response.json({ error: "This install isn't set up yet. Open /setup to connect a Supabase project." }, { status: 503 });
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims?.sub;
  if (!id) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  return { supabase, user: { id, email: data.claims.email as string | undefined } };
}

export const isResponse = (value: unknown): value is Response => value instanceof Response;
