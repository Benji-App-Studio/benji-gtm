import { getTranslator } from "@/lib/i18n/server";
import { writeStoredOwner } from "@/lib/install/config";
import { isResponse, requireUser } from "@/lib/server/auth";
import { changeOwnPassword } from "@/lib/server/owner-flows";
import { NO_STORE, localModeRequest, refuse } from "@/lib/server/provision/request-access";

/**
 * Settings > Account > Change password, through the person's own session. On a copy in local mode the
 * owner's stored sign-in is updated too, so the app keeps signing them in by itself.
 */
export async function POST(request: Request) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { t } = await getTranslator();
  // Browsers send Origin on this POST: it must be this app, so another site can't change the password.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try { if (new URL(origin).host !== host) return refuse(403, t("Open Settings in the app and try again.")); } catch { return refuse(403, t("Open Settings in the app and try again.")); }
  }
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  const { data: member } = await session.supabase.from("install_members").select("role").eq("user_id", session.user.id).maybeSingle<{ role: string }>();
  const answer = await changeOwnPassword(
    { password, email: session.user.email ?? null, local: localModeRequest(request), role: member?.role ?? null },
    { updatePassword: async (secret) => session.supabase.auth.updateUser({ password: secret }), remember: writeStoredOwner },
  );
  return Response.json(answer.body, { status: answer.status, headers: NO_STORE });
}
