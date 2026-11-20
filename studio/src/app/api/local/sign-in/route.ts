import { getTranslator } from "@/lib/i18n/server";
import { writeStoredOwner } from "@/lib/install/config";
import { localSignIn } from "@/lib/server/owner-flows";
import { NO_STORE, localModeRequest, refuse } from "@/lib/server/provision/request-access";
import { createClient } from "@/lib/supabase/server";

/**
 * The one-time login on a copy in local mode, shown only when automatic sign-in couldn't happen (an
 * older install with no stored sign-in, or a password changed elsewhere). On success the sign-in is kept
 * in the local config, so the app signs in by itself from then on. Works in local mode only.
 */
export async function POST(request: Request) {
  if (!localModeRequest(request)) return refuse(403, (await getTranslator()).t("This only works in the app on the computer it runs on."));
  const body = (await request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const supabase = await createClient();
  const answer = await localSignIn({ email, password }, {
    signIn: async (who, secret) => supabase.auth.signInWithPassword({ email: who, password: secret }),
    role: async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return null;
      const { data: member } = await supabase.from("install_members").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
      return member?.role ?? null;
    },
    signOut: async () => { await supabase.auth.signOut(); },
    remember: writeStoredOwner,
  });
  return Response.json(answer.body, { status: answer.status, headers: NO_STORE });
}
