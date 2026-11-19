import type { Metadata } from "next";
import { headers } from "next/headers";
import { ButtonLink, Card } from "@/components/ui";
import { APP_NAME } from "@/lib/brand-config";
import { getInstallConfig } from "@/lib/install/config";
import { localModePage } from "@/lib/server/owner-session";
import { isLocalRequest } from "@/lib/server/provision/guard";
import { createClient } from "@/lib/supabase/server";
import { SetupChecklist } from "./setup-checklist";
import { Updates } from "./updates";

export const metadata: Metadata = { title: "Setup" };

/** Who is looking at /setup once a project is connected: nobody signed in, a member, or the owner. */
async function viewer(): Promise<"signed-out" | "member" | "owner"> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims?.sub;
  if (!id) return "signed-out";
  const { data: member } = await supabase.from("install_members").select("role").eq("user_id", id).maybeSingle<{ role: string }>();
  return member?.role === "owner" ? "owner" : "member";
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </Card>
  );
}

/**
 * The first-run checklist, and afterwards the owner's Updates view. Until a project is connected the
 * checklist is only shown to a browser on the computer the app runs on.
 */
export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  const config = getInstallConfig();
  const step = (await searchParams).step;
  const head = await headers();
  const local = isLocalRequest({ host: head.get("host"), origin: null, forwardedFor: head.get("x-forwarded-for") });
  const who = config ? await viewer() : null;
  const finishing = who === "owner" && step === "keys";
  const localMode = config ? await localModePage() : false;

  return (
    <div className="mx-auto w-full max-w-[748px] px-4 pt-10 pb-16 sm:px-6 md:pt-16">
      <p className="eyebrow">{config && !finishing ? "Your install" : `Welcome to ${APP_NAME}`}</p>
      <h1 className="mt-1 text-display font-semibold">{config && !finishing ? "Setup" : `Set up ${APP_NAME}`}</h1>
      <p className="mt-1 mb-8 text-sm text-muted">
        {config && !finishing
          ? `${APP_NAME} is connected to your Supabase project.`
          : "Six short steps, about ten minutes. You don't need to write any code. Everything you create here belongs to you."}
      </p>

      {!config && !local && (
        <Notice title="Open this page on the computer that runs the app">
          <p className="text-sm text-muted">For your safety, setup only works in a browser on the same computer the app is running on. On that computer, open the address the start command printed. It begins with http://localhost.</p>
        </Notice>
      )}
      {!config && local && <SetupChecklist appName={APP_NAME} start="project" />}

      {who === "signed-out" && localMode && (
        <Notice title="Setup is finished">
          <p className="text-sm text-muted">Open {APP_NAME}: on this computer it signs you in by itself. If it can&apos;t, it says why and what to do.</p>
          <ButtonLink href="/app">Open {APP_NAME}</ButtonLink>
        </Notice>
      )}
      {who === "signed-out" && !localMode && (
        <Notice title="Setup is finished">
          <p className="text-sm text-muted">Sign in to use {APP_NAME}. The owner can also come back here to install updates.</p>
          <ButtonLink href={`/login?next=${encodeURIComponent("/setup")}`}>Sign in</ButtonLink>
        </Notice>
      )}
      {who === "member" && (
        <Notice title="Only the owner can change the setup">
          <p className="text-sm text-muted">This install is already set up. Ask its owner if something needs updating.</p>
          <ButtonLink href="/app/w" variant="secondary">Back to the app</ButtonLink>
        </Notice>
      )}
      {who === "owner" && finishing && <SetupChecklist appName={APP_NAME} start="keys" />}
      {who === "owner" && !finishing && <Updates appName={APP_NAME} />}
    </div>
  );
}
