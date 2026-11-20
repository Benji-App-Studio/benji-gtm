import type { Metadata } from "next";
import { NewAppFlow } from "@/components/onboarding/new-app";
import { getTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("New app") };
}

/**
 * New app: the same three steps as the first run (app link, AI key when none is connected, competitors),
 * after a check of the plan's app limit. The full profile is on the new app's App settings › Profile.
 */
export default function NewProduct() {
  return <NewAppFlow />;
}
