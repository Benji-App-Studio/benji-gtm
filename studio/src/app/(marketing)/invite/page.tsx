import type { Metadata } from "next";
import { InviteForm } from "@/components/auth-form";
import { getTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Choose your password"), robots: { index: false } };
}

/** Where the invite link from Settings > Members lands: the new member chooses a password and is signed in. */
export default function Invite() {
  return <InviteForm />;
}
