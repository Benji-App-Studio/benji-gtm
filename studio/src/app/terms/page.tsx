import type { Metadata } from "next";
import { LegalPage, legalMetadata } from "@/components/legal-page";

export const dynamic = "force-dynamic";

export function generateMetadata(): Promise<Metadata> {
  return legalMetadata("terms");
}

/** The Terms of Service (studio/content/legal/terms.*.md; a draft until lib/legal.ts LEGAL_FINAL). */
export default function Terms() {
  return <LegalPage doc="terms" />;
}
