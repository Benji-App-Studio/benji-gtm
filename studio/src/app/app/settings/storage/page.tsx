import type { Metadata } from "next";
import { StorageSettings } from "@/components/settings/storage";

export const metadata: Metadata = { title: "Storage" };

export default function StorageSettingsPage() {
  return <StorageSettings />;
}
