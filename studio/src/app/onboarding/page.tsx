import type { Metadata } from "next";
import { OnboardingFlow, type OnboardingDraft } from "@/components/onboarding/onboarding-flow";
import { getTranslator } from "@/lib/i18n/server";
import { readUiState } from "@/lib/server/ui-state";
import { createClient } from "@/lib/supabase/server";
import { DRAFT_KEY } from "@/lib/ui-state";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Set up your first app") };
}

/**
 * The first run in three steps (components/onboarding). The app an earlier visit of this first run saved
 * (profiles.ui_state "onboarding.draft") picks up at the key step; before that column exists, the
 * person's own first app does. The layout sends anyone who has finished to their apps.
 */
export default async function Onboarding() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let draft: OnboardingDraft | null = null;
  if (user) {
    const { state, stored } = await readUiState({ supabase, user });
    const query = supabase.from("products").select("id, name, website, links").eq("user_id", user.id);
    const { data } = stored
      ? (state[DRAFT_KEY] ? await query.eq("id", state[DRAFT_KEY]).limit(1) : { data: null })
      : await query.order("created_at").limit(1);
    const row = data?.[0];
    if (row) draft = { id: row.id, name: row.name, link: (row.links as string[] | null)?.[0] ?? row.website ?? "" };
  }
  return <OnboardingFlow draft={draft} />;
}
