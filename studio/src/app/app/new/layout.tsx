import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";

/** A new analysis is a client page: its tab title is set here. */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("New analysis") };
}

export default function Layout({ children }: LayoutProps<"/app/new">) {
  return children;
}
