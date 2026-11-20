import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";
import { AllApps } from "@/components/all-apps";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("All apps") };
}

/** All apps: every app with its key numbers and next step. */
export default function AllAppsPage() {
  return <AllApps />;
}
