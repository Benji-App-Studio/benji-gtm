import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { APP_NAME } from "@/lib/brand-config";
import { getInstallConfig, projectRef } from "@/lib/install/config";
import { getTranslator } from "@/lib/i18n/server";
import { safeNext } from "@/lib/install/local-auth";
import { localModePage } from "@/lib/server/owner-session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Choose a new password"), robots: { index: false } };
}
export const dynamic = "force-dynamic";

/**
 * "Forgot your password?" without email, on the computer the app runs on: a Supabase access token sets a
 * new password. An online copy resets by email instead (/forgot-password).
 */
export default async function ResetPassword({ searchParams }: PageProps<"/reset-password">) {
  const config = getInstallConfig();
  if (!config) redirect("/setup");
  const next = (await searchParams).next;
  if (await localModePage()) {
    return <ResetPasswordForm appName={APP_NAME} next={safeNext(typeof next === "string" ? next : null)} projectRef={projectRef(config.supabaseUrl)} />;
  }
  // Online, the reset goes by email.
  redirect("/forgot-password");
}
