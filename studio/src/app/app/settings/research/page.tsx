import type { Metadata } from "next";
import { ResearchSourcesSettings } from "@/components/settings/research-sources";

export const metadata: Metadata = { title: "Research sources" };

export default function ResearchSourcesSettingsPage() {
  return <ResearchSourcesSettings />;
}
