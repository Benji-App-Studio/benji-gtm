import type { Metadata } from "next";
import { LegalPage, legalMetadata } from "@/components/legal-page";

export const dynamic = "force-dynamic";

export function generateMetadata(): Promise<Metadata> {
  return legalMetadata("privacy");
}

/** The Privacy Policy (studio/content/legal/privacy.*.md; a draft until lib/legal.ts LEGAL_FINAL). */
export default function Privacy() {
  return <LegalPage doc="privacy" />;
}
