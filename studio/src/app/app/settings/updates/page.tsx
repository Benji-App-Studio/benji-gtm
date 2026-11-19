import type { Metadata } from "next";
import { UpdatesSettings } from "@/components/settings/updates";

export const metadata: Metadata = { title: "Updates" };

export default function UpdatesSettingsPage() {
  return <UpdatesSettings />;
}
