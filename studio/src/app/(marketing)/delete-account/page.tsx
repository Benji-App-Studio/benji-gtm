import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FinishDeletion } from "@/components/settings/delete-account";
import { finishDeletionRedirect } from "@/lib/auth/session-gate";
import { getTranslator } from "@/lib/i18n/server";
import { deletionPending } from "@/lib/server/account-deletion";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Finish deleting your account"), robots: { index: false, follow: false } };
}

/**
 * Where the app sends an account whose deletion (Settings > Account > Delete my account) stopped part way:
 * it is locked until the deletion finishes, and this page carries it on. Anyone else goes back to the app.
 */
export default async function FinishDeletionPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const to = finishDeletionRedirect({ signedIn, deletionPending: signedIn && await deletionPending(supabase) });
  if (to) redirect(to);
  return <FinishDeletion />;
}
