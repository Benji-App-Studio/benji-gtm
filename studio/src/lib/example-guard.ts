// The example app's rules (components/example): it is read-only, and it stays inside /example. Every
// request the page makes is sorted here before it leaves the browser: the app's own reads are answered
// from sample data, every write is refused (whatever the address), and only plain reads of other
// addresses (pictures, fonts) go out. Links into the real app are turned into the example's own pages, or
// refused. Plain TypeScript with no imports; tested in example-guard.test.ts.

/** The example app's id: the sample data's main app (components/preview/sample.ts APP_A). */
export const EXAMPLE_APP_ID = "11111111-1111-4111-8111-111111111111";

export type ExampleRequest = "sample" | "block" | "pass";

/** A beacon (navigator.sendBeacon) always posts: refused, whatever its address. */
export const exampleBeacon = (): false => false;

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/** What happens to one request from an example page. `origin` is the page's own. */
export function exampleRequest(method: string | undefined, url: string, origin: string): ExampleRequest {
  const verb = (method ?? "GET").toUpperCase();
  let target: URL;
  try { target = new URL(url, origin); } catch { return "block"; }
  const own = target.origin === origin;
  if (own && (target.pathname === "/api" || target.pathname.startsWith("/api/"))) return READS.has(verb) ? "sample" : "block";
  // Anything that would change something, anywhere (the database, storage, another service): refused.
  if (!READS.has(verb)) return "block";
  // The app's own pages and files, and other sites' pictures: read as usual.
  return "pass";
}

/**
 * The example's pages: the part after /app/w/<id>/ (and after /example/), and the tab each one lights.
 * One list, so a route rename is one edit here (the routes are lib/nav-model.ts's). "research/app-store/<id>"
 * pages light Research. `apps` is All apps (/app/apps).
 */
export const EXAMPLE_VIEWS: Record<string, ExampleTab> = {
  "": "", research: "research", "research/app-store": "research", "research/social": "research",
  studio: "studio", "studio/remix": "studio", "studio/templates": "studio",
  launch: "launch", "launch/ads": "launch", measure: "measure", settings: "settings", apps: "",
};
export type ExampleTab = "" | "research" | "studio" | "launch" | "measure" | "settings";
const PAGES = Object.keys(EXAMPLE_VIEWS).filter(Boolean);
const APP_STORE_APP = /^research\/app-store\/[0-9a-f-]{36}$/i;
/** Old page names, still accepted (bookmarks, links from before the navigation changed). */
const OLD_VIEWS: Record<string, string> = { market: "research/app-store", playground: "studio/remix", brand: "settings" };
const oldView = (view: string): string => {
  const app = view.match(/^market\/([0-9a-f-]{36})$/i);
  return app ? `research/app-store/${app[1]}` : OLD_VIEWS[view] ?? view;
};

/** The tab an example view lights. */
export const exampleTab = (view: string): ExampleTab => (APP_STORE_APP.test(view) ? "research" : EXAMPLE_VIEWS[view] ?? "");

/**
 * Where a link on an example page goes: an address inside /example for the example app's pages (and All
 * apps), the link itself for another site or for /example, and null for anything else in the app (it is
 * the real app, which the example never opens by a click).
 */
export function exampleHref(href: string, origin: string): string | null {
  let target: URL;
  try { target = new URL(href, origin); } catch { return null; }
  if (target.origin !== origin) return href;
  const path = target.pathname.replace(/\/+$/, "") || "/";
  const tail = `${target.search}${target.hash}`;
  if (path === "/example" || path.startsWith("/example/")) return `${path}${tail}`;
  if (path === "/app/apps") return `/example/apps${tail}`;
  const prefix = `/app/w/${EXAMPLE_APP_ID}`;
  if (path === prefix) return `/example${tail}`;
  if (path.startsWith(`${prefix}/`)) {
    const rest = oldView(path.slice(prefix.length + 1));
    const known = PAGES.includes(rest) || APP_STORE_APP.test(rest);
    // The old Brand page's ?tab= names map onto App settings' tabs.
    const query = rest === "settings" && path.endsWith("/brand") ? brandQuery(target.search) : target.search;
    return known ? `/example/${rest}${query}${target.hash}` : null;
  }
  // The app's other pages (settings, other apps, sign-out) and its API are the real app's.
  if (path === "/app" || path.startsWith("/app/") || path.startsWith("/api/") || path.startsWith("/auth/")) return null;
  return `${path}${tail}`;
}

/** /brand?tab=product (the old Brand page) is App settings' Profile; its other tabs keep their names. */
function brandQuery(search: string): string {
  const query = new URLSearchParams(search);
  const tab = query.get("tab");
  if (tab === "product") query.set("tab", "profile");
  else if (!tab) query.set("tab", "brand");
  const text = query.toString();
  return text ? `?${text}` : "";
}

/** The view an /example address shows: "" (Home), "research", "research/app-store/<id>"…; old names are mapped, unknown ones show Home. */
export function exampleView(segments: string[] | undefined): string {
  const view = oldView((segments ?? []).join("/"));
  if (!view) return "";
  return PAGES.includes(view) || APP_STORE_APP.test(view) ? view : "";
}
