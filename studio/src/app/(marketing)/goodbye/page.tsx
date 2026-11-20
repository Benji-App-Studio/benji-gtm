import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui";
import { APP_NAME } from "@/lib/brand-config";
import { getTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Your account is deleted"), robots: { index: false, follow: false } };
}

/** Where Settings > Account > Delete my account lands once the account is gone (and the session cleared). */
export default async function Goodbye() {
  const { t } = await getTranslator();
  return (
    <div className="text-center">
      <h1 className="text-display font-semibold">{t("Your account is deleted")}</h1>
      <p className="mt-2 text-sm text-muted">{t("Your apps, files, saved keys and data are gone from {app}, and you're signed out.", { app: APP_NAME })}</p>
      <p className="mt-2 text-sm text-muted">{t("Ads already created in your own Meta ad account are still there: manage them in Meta Ads Manager.")}</p>
      <p className="mt-6 text-sm text-muted">{t("Thanks for trying {app}.", { app: APP_NAME })}</p>
      <Link href="/" className={`${buttonClass("secondary")} mt-6`}>{t("Back to the home page")}</Link>
    </div>
  );
}
