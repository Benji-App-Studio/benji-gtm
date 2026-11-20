import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UpdatePasswordExpired, UpdatePasswordForm } from "@/components/password-recovery";
import { getTranslator } from "@/lib/i18n/server";
import { getInstallConfig } from "@/lib/install/config";
import { localModePage } from "@/lib/server/owner-session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Choose a new password"), robots: { index: false } };
}

/**
 * Where the password-reset email lands, after /auth/confirm has signed the person in with its link.
 * No session means the link didn't work: say so and offer a new one.
 */
export default async function UpdatePassword() {
  if (!getInstallConfig()) redirect("/setup");
  if (await localModePage()) redirect("/reset-password");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return <UpdatePasswordExpired />;
  return <UpdatePasswordForm email={(data.claims.email as string | undefined) ?? null} />;
}
