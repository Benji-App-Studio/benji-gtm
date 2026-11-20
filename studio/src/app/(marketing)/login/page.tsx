import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { getTranslator } from "@/lib/i18n/server";
import { LocalLogin } from "@/components/local-login";
import { getInstallConfig, projectRef } from "@/lib/install/config";
import { isLoginReason, safeNext } from "@/lib/install/local-auth";
import { captchaConfig } from "@/lib/install/captcha";
import { signupOpen } from "@/lib/install/signup";
import { showGoogle } from "@/lib/auth/flows";
import { authProviders, googleClientId } from "@/lib/server/auth-providers";
import { localModePage } from "@/lib/server/owner-session";
import { startEmail } from "@/lib/server/start-email";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Log in") };
}
export const dynamic = "force-dynamic";

/**
 * Online copy: the normal login. Local copy: the app signs its owner in by itself, so this page shows
 * only when that couldn't happen (the proxy sends `reason`), and explains what to do next.
 */
export default async function Login({ searchParams }: PageProps<"/login">) {
  if (await localModePage()) {
    const params = await searchParams;
    const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);
    const reason = one(params.reason);
    const config = getInstallConfig();
    return <LocalLogin reason={isLoginReason(reason) ? reason : "no-owner"} next={safeNext(one(params.next))} projectRef={config ? projectRef(config.supabaseUrl) : null} />;
  }
  const [providers, email] = await Promise.all([authProviders(), startEmail()]);
  const open = await signupOpen();
  return <Suspense><AuthForm mode="login" signupOpen={open} google={showGoogle(providers, open)} googleClientId={googleClientId()} initialEmail={email} captcha={captchaConfig()} /></Suspense>;
}
