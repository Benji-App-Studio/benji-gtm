import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { APP_NAME } from "@/lib/brand-config";
import { getInstallConfig, projectRef } from "@/lib/install/config";
import { safeNext } from "@/lib/install/local-auth";
import { localModePage } from "@/lib/server/owner-session";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

/**
 * "Forgot your password?" without email. On the computer the app runs on, a Supabase access token sets a
 * new password. An online copy can't do that (it never holds a way into the project), so it says where to go.
 */
export default async function ResetPassword({ searchParams }: PageProps<"/reset-password">) {
  const config = getInstallConfig();
  if (!config) redirect("/setup");
  const next = (await searchParams).next;
  if (await localModePage()) {
    return <ResetPasswordForm appName={APP_NAME} next={safeNext(typeof next === "string" ? next : null)} projectRef={projectRef(config.supabaseUrl)} />;
  }
  return (
    <div>
      <h1 className="text-center text-display font-semibold">Reset your password on your Mac</h1>
      <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm text-ink">
        <li>Open {APP_NAME} on your Mac, the one where you set it up. It signs you in by itself.</li>
        <li>Go to <b>Settings &gt; Account</b> and change your password there. Then sign in here with the new one.</li>
      </ol>
      <p className="mt-4 text-sm text-muted">If that Mac isn&apos;t available, start the app from your copy of the code on any Mac and follow its setup page. It connects your project again and lets you choose a new password with a Supabase access token. No email is needed.</p>
      <p className="mt-6 text-center text-sm"><Link href="/login" className="rounded-xs font-medium text-accent hover:underline">Back to log in</Link></p>
    </div>
  );
}
