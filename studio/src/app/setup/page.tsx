import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ButtonLink, Card } from "@/components/ui";
import { APP_NAME } from "@/lib/brand-config";
import { getTranslator } from "@/lib/i18n/server";
import { getInstallConfig } from "@/lib/install/config";
import { accountsMode } from "@/lib/install/mode";
import { setupAccess } from "@/lib/install/setup-access";
import { localModePage } from "@/lib/server/owner-session";
import { staffViewer } from "@/lib/server/staff";
import { isLocalRequest } from "@/lib/server/provision/guard";
import { createClient } from "@/lib/supabase/server";
import { SetupChecklist } from "./setup-checklist";
import { Updates } from "./updates";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Setup") };
}

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
  // Accounts mode (the public service): no install of anyone's here. Staff see the Updates view; everyone else goes to the front page.
  const accounts = config ? await accountsMode(config) : false;
  const access = setupAccess({ accounts, staff: accounts ? await staffViewer() : false });
  if (access.view === "redirect") redirect(access.to);
  const step = (await searchParams).step;
  const head = await headers();
  const local = isLocalRequest({ host: head.get("host"), origin: null, forwardedFor: head.get("x-forwarded-for") });
  const who = access.view === "updates" ? "owner" : config ? await viewer() : null;
  const finishing = who === "owner" && step === "keys";
  const localMode = config ? await localModePage() : false;
  const { t } = await getTranslator();

  return (
    <div className="mx-auto w-full max-w-[748px] px-4 pt-10 pb-16 sm:px-6 md:pt-16">
      <p className="eyebrow">{config && !finishing ? t("Your install") : t("Welcome to {app}", { app: APP_NAME })}</p>
      <h1 className="mt-1 text-display font-semibold">{config && !finishing ? t("Setup") : t("Set up {app}", { app: APP_NAME })}</h1>
      <p className="mt-1 mb-8 text-sm text-muted">
        {config && !finishing
          ? t("{app} is connected to your Supabase project.", { app: APP_NAME })
          : t("Six short steps, about ten minutes. You don't need to write any code. Everything you create here belongs to you.")}
      </p>

      {!config && !local && (
        <Notice title={t("Open this page on the computer that runs the app")}>
          <p className="text-sm text-muted">{t("For your safety, setup only works in a browser on the same computer the app is running on. On that computer, open the address the start command printed. It begins with http://localhost.")}</p>
        </Notice>
      )}
      {!config && local && <SetupChecklist appName={APP_NAME} start="project" />}

      {who === "signed-out" && localMode && (
        <Notice title={t("Setup is finished")}>
          <p className="text-sm text-muted">{t("Open {app}: on this computer it signs you in by itself. If it can't, it says why and what to do.", { app: APP_NAME })}</p>
          <ButtonLink href="/app">{t("Open {app}", { app: APP_NAME })}</ButtonLink>
        </Notice>
      )}
      {who === "signed-out" && !localMode && (
        <Notice title={t("Setup is finished")}>
          <p className="text-sm text-muted">{t("Sign in to use {app}. The owner can also come back here to install updates.", { app: APP_NAME })}</p>
          <ButtonLink href={`/login?next=${encodeURIComponent("/setup")}`}>{t("Sign in")}</ButtonLink>
        </Notice>
      )}
      {who === "member" && (
        <Notice title={t("Only the owner can change the setup")}>
          <p className="text-sm text-muted">{t("This install is already set up. Ask its owner if something needs updating.")}</p>
          <ButtonLink href="/app/w" variant="secondary">{t("Back to the app")}</ButtonLink>
        </Notice>
      )}
      {who === "owner" && finishing && <SetupChecklist appName={APP_NAME} start="keys" />}
      {who === "owner" && !finishing && <Updates appName={APP_NAME} />}
    </div>
  );
}
