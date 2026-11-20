import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";
import { AllAnalyses } from "@/components/social-posts";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("All analyses") };
}

/** All analyses of social posts, for every app and the ones that name none. `?type=` keeps one kind. */
export default function AllAnalysesPage() {
  return <AllAnalyses />;
}
