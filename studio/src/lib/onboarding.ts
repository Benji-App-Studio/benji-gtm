// The three-step first run (components/onboarding): which kind of link was typed, a name guessed from it,
// what each step needs before Continue works, and the competitor list it ends with. Plain TypeScript with
// no imports: the browser, the API route (app/api/onboarding) and the Node tests share it
// (onboarding.test.ts).

export type LinkKind = "app_store" | "google_play" | "website";

export interface DetectedLink {
  kind: LinkKind;
  /** The link as saved: https, no tracking fragment. */
  url: string;
  /** App Store: the numeric id from ".../id1234567890". */
  storeId?: string;
  /** App Store: the two-letter storefront in the path ("us"), when there is one. */
  country?: string;
  /** Google Play: the package name from "?id=com.example.app". */
  packageId?: string;
  host: string;
}

const APPLE_HOSTS = new Set(["apps.apple.com", "itunes.apple.com"]);
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/**
 * What a typed link is: an App Store listing, a Google Play listing or a website. Accepts it with or
 * without https:// ("apps.apple.com/us/app/x/id123", "volt.drinks"). Null for anything that isn't a web
 * address (an email, words, another scheme).
 */
export function detectLink(input: string): DetectedLink | null {
  const text = input.trim();
  if (!text || /\s/.test(text) || text.includes("@") && !/^https?:\/\//i.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try { url = new URL(withScheme); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!HOST.test(host)) return null;
  url.hash = "";
  if (APPLE_HOSTS.has(host)) {
    const storeId = url.pathname.match(/\/id(\d{5,15})(?:\/|$)/)?.[1] ?? url.searchParams.get("id")?.match(/^\d{5,15}$/)?.[0];
    if (storeId) {
      const country = url.pathname.match(/^\/([a-z]{2})\//i)?.[1]?.toLowerCase();
      return { kind: "app_store", url: `https://apps.apple.com${country ? `/${country}` : ""}/app/id${storeId}`, storeId, country, host };
    }
  }
  if (host === "play.google.com") {
    const packageId = url.searchParams.get("id")?.match(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/)?.[0];
    if (packageId) return { kind: "google_play", url: `https://play.google.com/store/apps/details?id=${packageId}`, packageId, host };
  }
  url.protocol = "https:";
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return { kind: "website", url: `https://${url.host.replace(/^www\./i, "")}${path}${url.search}`, host };
}

/** A name to start from when only a link was typed: "volt.drinks" → "Volt", "com.acme.habits" → "Habits". Empty for a store link with no name in it. */
export function nameFromLink(link: DetectedLink | null): string {
  if (!link) return "";
  if (link.kind === "google_play") return titleCase(link.packageId?.split(".").pop() ?? "");
  if (link.kind === "app_store") {
    // apps.apple.com/us/app/<slug>/id123: the slug is in the typed link only, not the cleaned one.
    return "";
  }
  const labels = link.host.split(".");
  const main = labels.length > 2 && labels[labels.length - 2].length <= 3 ? labels[labels.length - 3] : labels[labels.length - 2];
  return titleCase(main ?? "");
}

/** The app's name from the slug of a typed App Store link ("…/app/habit-tracker-pro/id123" → "Habit Tracker Pro"), else "". */
export function nameFromStoreSlug(input: string): string {
  const slug = input.match(/\/app\/([^/?#]+)\/id\d+/i)?.[1];
  if (!slug) return "";
  try { return titleCase(decodeURIComponent(slug).replace(/-/g, " ")); } catch { return ""; }
}

const titleCase = (text: string) => text.replace(/[-_]+/g, " ").trim().replace(/\s+/g, " ").replace(/(^|\s)\S/g, (c) => c.toUpperCase()).slice(0, 120);

// MARK: The steps

export type AppStepProblem = "name" | "link";

/** Step 1: a name is needed; the link is optional, but when one is typed it must be a web address. */
export function appStepProblem(name: string, link: string): AppStepProblem | null {
  if (!name.trim() || name.trim().length > 120) return "name";
  if (link.trim() && !detectLink(link)) return "link";
  return null;
}

/** The kind of product a link says it is, for the product row (the AI refines it later). */
export const kindFromLink = (link: DetectedLink | null): "mobile_app" | "other" => (link && link.kind !== "website" ? "mobile_app" : "other");

/** The product fields step 1 saves: the website column for a site, the links list for a store listing. */
export function linkFields(link: DetectedLink | null): { website: string | null; links: string[] } {
  if (!link) return { website: null, links: [] };
  return link.kind === "website" ? { website: link.url, links: [] } : { website: null, links: [link.url] };
}

export const MAX_COMPETITORS = 5;

/** The key a competitor is compared by: "@Peak Finder " and "peak finder" are one. */
export const competitorKey = (name: string) => name.trim().replace(/^@+/, "").replace(/\s+/g, " ").toLowerCase();

/** A typed competitor as it is saved: trimmed, no leading @ on a handle, at most 120 characters. Empty when nothing is left. */
export function cleanCompetitor(input: string): string {
  const text = input.trim().replace(/\s+/g, " ");
  if (!text) return "";
  return (/^https?:\/\//i.test(text) ? text : text.replace(/^@+/, "")).slice(0, 120);
}

/** The step's list: cleaned, each once (case doesn't matter), at most five, in the order picked. */
export function competitorList(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = cleanCompetitor(raw);
    const key = competitorKey(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length === MAX_COMPETITORS) break;
  }
  return out;
}

/** Adds or removes one name, keeping the list within five. Returns the list unchanged when it's full. */
export function toggleCompetitor(list: string[], name: string): string[] {
  const key = competitorKey(name);
  if (list.some((n) => competitorKey(n) === key)) return list.filter((n) => competitorKey(n) !== key);
  return list.length >= MAX_COMPETITORS ? list : competitorList([...list, name]);
}

/** Suggestions to show: none already picked, none that is the app itself, each once. */
export function freshSuggestions(suggestions: string[], picked: string[], own: string): string[] {
  const taken = new Set([...picked.map(competitorKey), competitorKey(own)]);
  const seen = new Set<string>();
  return suggestions.filter((s) => {
    const key = competitorKey(s);
    if (!key || taken.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The list rows to follow when the first run finishes: competitors (not own Pages) whose name was picked. */
export function idsToFollow(rows: { id: string; name: string; is_own?: boolean | null }[], picked: string[]): string[] {
  const keys = new Set(picked.map(competitorKey));
  return rows.filter((r) => !r.is_own && keys.has(competitorKey(r.name))).map((r) => r.id);
}

/** Whether step 1's link differs from what the saved app has (a new link is looked up and read again). */
export function linkChanged(saved: { website?: string | null; links?: string[] | null }, link: DetectedLink | null): boolean {
  const next = linkFields(link);
  return (saved.website ?? null) !== next.website || JSON.stringify(saved.links ?? []) !== JSON.stringify(next.links);
}

/**
 * The brand kit after step 1: what's there stays (colours, voice, a logo uploaded by hand), the app name
 * follows the name typed, and an App Store listing fills its icon, screenshots and store link.
 */
export function mergeBrandKit(saved: unknown, name: string, listing: { iconUrl: string | null; screenshots: string[]; url: string } | null): Record<string, unknown> {
  const kit = saved && typeof saved === "object" && !Array.isArray(saved) ? { ...(saved as Record<string, unknown>) } : {};
  kit.appName = name;
  if (!Array.isArray(kit.colors)) kit.colors = [];
  if (!Array.isArray(kit.screenshotUrls)) kit.screenshotUrls = [];
  if (listing) {
    if (listing.iconUrl) kit.iconUrl = listing.iconUrl;
    if (listing.screenshots.length) kit.screenshotUrls = listing.screenshots;
    kit.appStoreUrl = listing.url;
  }
  return kit;
}

/**
 * The app name once a link's lookup answers: the suggestion when the field is empty or still holds the
 * previous suggestion; null (leave it) when the person typed their own name, even while Apple answered.
 */
export function nameAfterLookup(current: string, previousSuggestion: string, suggested: string): string | null {
  if (!suggested) return null;
  return !current.trim() || current === previousSuggestion ? suggested : null;
}

// MARK: Which steps, and room for another app

/**
 * The two runs of the three steps: `first` is the first run after sign-up (app/onboarding), `new` is "New
 * app" from inside the app (app/app/product/new) for a second, third… app. Both ask for the app, then the
 * AI key, then competitors; "New app" leaves the key step out when an AI key is already connected.
 */
export type FlowMode = "first" | "new";
export type FlowStep = "app" | "key" | "competitors";

export function flowSteps(mode: FlowMode, aiKeyReady: boolean): FlowStep[] {
  return mode === "new" && aiKeyReady ? ["app", "competitors"] : ["app", "key", "competitors"];
}

/** A run's mode from a request body: anything but "new" is the first run (older clients send none). */
export const flowMode = (value: unknown): FlowMode => (value === "new" ? "new" : "first");

/**
 * Whether the plan has room for another app, checked BEFORE "New app" starts (the database refuses the
 * insert anyway: lib/db-errors.ts). `plan` is accounts mode's plan (null elsewhere: no cap); `appCount`
 * is how many apps the list shows, used when it is higher than the plan's own count (a fresh one).
 */
export function appLimit(plan: { limits: { maxApps: number }; usage: { apps: number } } | null | undefined, appCount: number): { reached: boolean; max: number | null } {
  const max = plan?.limits?.maxApps;
  if (!plan || typeof max !== "number" || !Number.isFinite(max) || max < 0) return { reached: false, max: null };
  const used = Math.max(Number(plan.usage?.apps) || 0, appCount);
  return { reached: used >= max, max };
}

// MARK: Research's "Get ads" panel

export type AdsRoute = "collect" | "metaApi" | "extension";

/**
 * The best way this account has to bring in competitors' ads: collecting with Apify (any country, one
 * click), else Meta's Ad Library API (free, ads shown in the EU and the UK), else the free Chrome
 * extension. `on` says which collectors are ready (their keys set and switched on).
 */
export function adsRoute(on: { collect: boolean; metaApi: boolean }): AdsRoute {
  return on.collect ? "collect" : on.metaApi ? "metaApi" : "extension";
}

/**
 * Whether a finished AI read of the app's links should fill the profile by itself: only for a profile
 * nobody has filled in yet (made by the three-step start, which asks for a name and a link only) and
 * that the AI's profile hasn't been applied to before. Anything typed by hand is never replaced silently.
 */
export function shouldFillProfile(product: {
  audience?: string | null; stage?: string | null; category_label?: string | null; insight_applied_at?: string | null; insight_backup?: unknown;
  insight?: { summary?: string } | null; insight_status?: string | null;
}): boolean {
  if (product.insight_status !== "done" || !product.insight?.summary) return false;
  if (product.insight_applied_at || product.insight_backup) return false;
  return !product.audience?.trim() && !product.stage && !product.category_label?.trim();
}
