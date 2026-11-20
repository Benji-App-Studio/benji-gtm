import { ButtonLink, columnClass, EmptyState, Page } from "@/components/ui";
import { getTranslator } from "@/lib/i18n/server";

/**
 * A link inside the app that leads nowhere: an app that was deleted, or an address that was mistyped.
 * Drawn inside the app's frame (the sidebar stays), instead of the framework's bare black 404 page.
 */
export default async function AppNotFound() {
  const { t } = await getTranslator();
  return (
    <Page className={`${columnClass} pt-16`}>
      <EmptyState title={t("This page isn't here")} body={t("The app or page this link pointed to doesn't exist. It may have been deleted, or the link is wrong.")}
        action={<ButtonLink href="/app" variant="secondary">{t("Back to Home")}</ButtonLink>} />
    </Page>
  );
}
