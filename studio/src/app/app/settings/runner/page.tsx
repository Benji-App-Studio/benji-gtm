import type { Metadata } from "next";
import { RunnerSettings } from "@/components/settings/runner";

export const metadata: Metadata = { title: "Desktop runner" };

export default function RunnerSettingsPage() {
  return <RunnerSettings />;
}
