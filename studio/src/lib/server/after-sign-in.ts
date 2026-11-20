import "server-only";
// What happens right after someone signs in through a link or Google: shared by /auth/confirm (links and
// Google's redirect flow) and /auth/finish (Google's own button). Both steps are best effort and never
// block the sign-in.
import { nameFromMetadata } from "@/lib/auth/flows";
import { metadataLocaleUpdate } from "@/lib/i18n/saved-locale";
import { getLocale } from "@/lib/i18n/server";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function afterSignIn(supabase: Supabase): Promise<void> {
  await fillProfileName(supabase);
  await syncEmailLocale(supabase);
}

/**
 * Supabase's sign-in emails (reset password, magic link, email change) are written in the account's
 * language, read from user metadata `locale` (release/docs/email-templates). Email sign-ups save it with
 * the form. Here: the language saved in Settings (profiles.locale) when there is one; else a Google
 * sign-in (or an account from before) with none gets the page's. Never the browser's over a saved one.
 */
async function syncEmailLocale(supabase: Supabase) {
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const { data: profile } = await supabase.from("profiles").select("locale").eq("id", data.user.id).maybeSingle<{ locale: string | null }>();
    const locale = metadataLocaleUpdate(data.user.user_metadata, await getLocale(), profile?.locale);
    if (locale) await supabase.auth.updateUser({ data: { locale } });
  } catch { /* the emails stay in their earlier language */ }
}

/**
 * The profile gets its name from the sign-up form or Google when the account is made (the
 * handle_new_user trigger reads `full_name`, which Google sends too). If it is still empty and the
 * account now carries a name (e.g. Google linked later), it is filled in.
 */
async function fillProfileName(supabase: Supabase) {
  try {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) return;
    const name = nameFromMetadata(user.user_metadata);
    if (!name) return;
    await supabase.from("profiles").update({ full_name: name }).eq("id", user.id).eq("full_name", "");
  } catch { /* the name can be set later in Settings */ }
}
