import type { Metadata } from "next";
import { ModelsSettings } from "@/components/settings/models";

export const metadata: Metadata = { title: "AI models" };

export default function ModelsSettingsPage() {
  return <ModelsSettings />;
}
