import type { Metadata } from "next";
import { Suspense } from "react";
import { OnlineForgotHelp } from "@/components/account-pieces";
import { AuthForm } from "@/components/auth-form";
import { LocalLogin } from "@/components/local-login";
import { getInstallConfig, projectRef } from "@/lib/install/config";
import { isLoginReason, safeNext } from "@/lib/install/local-auth";
import { signupOpen } from "@/lib/install/signup";
import { localModePage } from "@/lib/server/owner-session";

export const metadata: Metadata = { title: "Log in" };
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
  return (
    <>
      <Suspense><AuthForm mode="login" signupOpen={signupOpen()} /></Suspense>
      <OnlineForgotHelp />
    </>
  );
}
