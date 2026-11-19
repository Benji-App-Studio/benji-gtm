import type { Metadata } from "next";
import { KeysSettings } from "@/components/settings/keys";

export const metadata: Metadata = { title: "API keys" };

export default function KeysSettingsPage() {
  return <KeysSettings />;
}
