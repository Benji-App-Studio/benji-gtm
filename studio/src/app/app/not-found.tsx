import { ButtonLink, EmptyState, Page } from "@/components/ui";

/**
 * A link inside the app that leads nowhere: an app that was deleted, or an address that was mistyped.
 * Drawn inside the app's frame (the sidebar stays), instead of the framework's bare black 404 page.
 */
export default function AppNotFound() {
  return (
    <Page className="max-w-3xl">
      <EmptyState title="This page isn't here" body="The app or page this link pointed to doesn't exist. It may have been deleted, or the link is wrong."
        action={<ButtonLink href="/app" variant="secondary">Back to Home</ButtonLink>} />
    </Page>
  );
}
