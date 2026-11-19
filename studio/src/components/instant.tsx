"use client";
// The main views (dashboard, accounts, campaigns) switch in the browser: the link
// updates the URL with the History API (which Next.js keeps in sync) and the view renders straight
// from the client cache, so switching never waits on the server.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { Dashboard } from "./dashboard";
import { WorkflowPage } from "./project-list";
import { ProjectView } from "./project-view";

const VIEWS: Record<string, () => ReactNode> = {
  "/app": () => <Dashboard />,
  "/app/accounts": () => <WorkflowPage type="account" />,
  "/app/campaigns": () => <WorkflowPage type="campaign" />,
};

const PROJECT = /^\/app\/p\/([0-9a-f-]{36})$/;

function viewFor(path: string): (() => ReactNode) | undefined {
  const project = path.match(PROJECT)?.[1];
  return project ? () => <Suspense><ProjectView id={project} /></Suspense> : VIEWS[path];
}

export const isInstant = (href: string) => Boolean(viewFor(href.split("?")[0]));

/** Goes to a main view without a server round trip (other links behave as usual). */
export function goInstant(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (!isInstant(href) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  event.preventDefault();
  if (window.location.pathname + window.location.search !== href) window.history.pushState(null, "", href);
  // From md up the page scrolls inside the app frame's <main>; below, with the window.
  document.getElementById("main")?.scrollTo({ top: 0 });
  window.scrollTo({ top: 0 });
  return true;
}

export function InstantLink({ href, onClick, ...props }: ComponentProps<typeof Link> & { href: string }) {
  return <Link href={href} onClick={(event) => { onClick?.(event); goInstant(event, href); }} {...props} />;
}

/** Renders a main view for its URL (keyed, so it eases in on every switch), otherwise the page. */
export function InstantViews({ children }: { children: ReactNode }) {
  const path = usePathname();
  const view = viewFor(path);
  return view ? <div key={path} className="page-in">{view()}</div> : children;
}
