import type { Metadata } from "next";
import { EntryFrame } from "@/components/entry-frame";
import { buttonClass } from "@/components/ui";
import { getTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("Page not found"), robots: { index: false } };
}

/**
 * An address outside the app that no page answers (the app's own one is app/app/not-found.tsx): the entry
 * frame the sign-in pages use, in the viewer's language, with the way home and to sign in, instead of
 * the framework's bare English 404 page.
 */
export default async function NotFound() {
  const { t } = await getTranslator();
  return (
    <EntryFrame>
      <div className="text-center">
        <p className="text-xs font-medium text-muted tabular-nums">404</p>
        <h1 className="mt-2 text-display font-semibold">{t("This page isn't here")}</h1>
        <p className="mt-2 text-sm text-muted">{t("The link may be mistyped, or the page has moved.")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {/* Plain links: a full page load, so the home page and sign-in check the session on the server. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className={buttonClass("primary")}>{t("Go to the home page")}</a>
          <a href="/login" className={buttonClass("secondary")}>{t("Log in")}</a>
        </div>
      </div>
    </EntryFrame>
  );
}
