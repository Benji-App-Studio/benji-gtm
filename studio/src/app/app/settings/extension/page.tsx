import type { Metadata } from "next";
import { ExtensionSettings } from "@/components/settings/extension";

export const metadata: Metadata = { title: "Ad Library extension" };

export default function ExtensionSettingsPage() {
  return <ExtensionSettings />;
}
