// The signed-in person's language, saved on their profile (profiles.locale) so it follows them to
// another browser (proxy.ts sets the cookie from it, lib/i18n/saved-locale.ts). The page itself renders
// from the cookie, which the browser sets at the same time. Saving is best effort: before the migration
// that adds the column, the answer says so and the cookie alone keeps the choice.
import { getTranslator } from "@/lib/i18n/server";
import { localeFromBody } from "@/lib/i18n/saved-locale";
import { isLocale } from "@/lib/i18n/locales";
import { isResponse, requireUser } from "@/lib/server/auth";

export async function GET() {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { data, error } = await session.supabase.from("profiles").select("locale").eq("id", session.user.id).maybeSingle<{ locale: string | null }>();
  if (error) return Response.json({ locale: null, saved: false });
  return Response.json({ locale: isLocale(data?.locale) ? data.locale : null, saved: true });
}

export async function PUT(request: Request) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const locale = localeFromBody(await request.json().catch(() => null));
  if (!locale) return Response.json({ error: (await getTranslator()).t("Choose one of the languages listed.") }, { status: 400 });
  const { error } = await session.supabase.from("profiles").update({ locale }).eq("id", session.user.id);
  // The sign-in emails (reset password, email change) read the language from user metadata. Best effort.
  await session.supabase.auth.updateUser({ data: { locale } }).catch(() => null);
  // No column yet (an older database): the cookie still keeps the choice in this browser.
  if (error) return Response.json({ locale, saved: false });
  return Response.json({ locale, saved: true });
}
