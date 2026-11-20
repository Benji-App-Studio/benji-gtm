import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/password-recovery";
import { getTranslator } from "@/lib/i18n/server";
import { captchaConfig } from "@/lib/install/captcha";
import { getInstallConfig } from "@/lib/install/config";
import { localModePage } from "@/lib/server/owner-session";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Reset your password"), robots: { index: false } };
}

/** "Forgot your password?" online: a reset link by email. A copy in local mode resets with an access token. */
export default async function ForgotPassword() {
  if (!getInstallConfig()) redirect("/setup");
  if (await localModePage()) redirect("/reset-password");
  return <Suspense><ForgotPasswordForm captcha={captchaConfig()} /></Suspense>;
}
