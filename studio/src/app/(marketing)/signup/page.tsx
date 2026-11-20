import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { getTranslator } from "@/lib/i18n/server";
import { captchaConfig } from "@/lib/install/captcha";
import { signupOpen } from "@/lib/install/signup";
import { showGoogle } from "@/lib/auth/flows";
import { authProviders, googleClientId } from "@/lib/server/auth-providers";
import { startEmail } from "@/lib/server/start-email";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Sign up") };
}
export const dynamic = "force-dynamic";

export default async function Signup() {
  // Closed installs have no sign-up page: the owner adds people in Settings > Members; a database in
  // accounts mode is open to everyone (lib/install/signup.ts). (An address typed
  // on the landing page travels in a short-lived cookie, so the login form fills it in too.)
  if (!(await signupOpen())) redirect("/login");
  const [providers, email] = await Promise.all([authProviders(), startEmail()]);
  return <Suspense><AuthForm mode="signup" signupOpen google={showGoogle(providers, true)} googleClientId={googleClientId()} initialEmail={email} refusesSignups={providers.signupDisabled} captcha={captchaConfig()} /></Suspense>;
}
