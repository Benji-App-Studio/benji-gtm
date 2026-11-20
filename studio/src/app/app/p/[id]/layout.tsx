import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";

/** One analysis is a client page: its tab title is set here. */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Analysis") };
}

export default function Layout({ children }: LayoutProps<"/app/p/[id]">) {
  return children;
}
