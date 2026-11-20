// Reading Apple's free, keyless App Store endpoints for the first run and "New app" (app/api/onboarding):
// one app's listing (name, icon, category, screenshots) from the lookup API, and competitor suggestions.
// The Market page reads the same endpoints in the insight function (supabase/functions/insight/market_core.ts).
// Plain TypeScript (its only import is the identity marker m()): the route and the Node tests share it
// (app-store.test.ts).
//
// How competitor suggestions are found (rankSimilar). The category's top chart alone gave weak picks (for
// AllTrails: Flo, Planet Fitness, Oura, the biggest apps in Health & Fitness), so the App Store's own
// search comes first:
//   1. Search terms from the listing: the words after the app's name in its title ("AllTrails: Hike, Bike
//      & Run" → "Hike Bike Run"), and the two words its description uses most ("trails hiking"), leaving out
//      common words and the app's own name (searchTerms, keywords).
//   2. Each term is searched in the app's storefront (the iTunes Search API, searchUrl). Apple ranks apps
//      that people find with those words, which is close to "people who look for this also look at".
//   3. Every app found is scored: how high it ranks in each search (more for appearing in both), the same
//      primary category (+), a shared secondary category (a little), how many of the app's own keywords
//      its title and description use, and how many ratings it has (an app with almost none is a clone or
//      a tiny side project: pushed down). The app itself and others by the same developer are left out.
//   4. The category's top chart fills any room left, but when the searches found enough, a chart app whose
//      summary shares no keyword with the app is dropped (that's how Flo got in).
// When the AI key is connected, the AI's own suggestions are shown first (lib/server/onboarding.ts).
import { m } from "./i18n/translate";

export interface StoreListing {
  storeId: string;
  name: string;
  developer: string | null;
  iconUrl: string | null;
  category: string | null;
  genreId: string | null;
  description: string | null;
  screenshots: string[];
  url: string;
  price: string | null;
  rating: number | null;
  /** Every category the app is listed in (the primary one first, usually). */
  genreIds?: string[];
}

const genreIdsOf = (value: unknown): string[] => (Array.isArray(value) ? value.map(String).filter((g) => /^\d{3,6}$/.test(g)).slice(0, 6) : []);

export interface SimilarApp {
  storeId: string; name: string; developer: string | null; iconUrl: string | null;
  /** Search results only: the primary category, every category, how many ratings, and the description. */
  genreId?: string | null; genreIds?: string[]; ratingCount?: number | null; description?: string | null;
  /** Chart entries only: the store's short summary of the app. */
  summary?: string | null;
}

export const lookupUrl = (storeId: string, country: string) => `https://itunes.apple.com/lookup?id=${encodeURIComponent(storeId)}&country=${encodeURIComponent(country)}&entity=software`;
/** The App Store's search for apps: the apps people find with these words, in the app's storefront. */
export const searchUrl = (term: string, country: string, limit = 25) =>
  `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${encodeURIComponent(country)}&entity=software&limit=${Math.min(50, Math.max(5, limit))}`;
export const genreChartUrl = (genreId: string, country: string, limit = 25) =>
  `https://itunes.apple.com/${encodeURIComponent(country)}/rss/topfreeapplications/limit=${Math.min(100, Math.max(10, limit))}/genre=${encodeURIComponent(genreId)}/json`;

const str = (value: unknown, max = 300): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
const https = (value: unknown): string | null => {
  const text = str(value, 1000);
  return text && /^https:\/\//i.test(text) ? text : null;
};

/** The first app in a lookup answer, or null. */
export function parseListing(json: unknown): StoreListing | null {
  const results = (json as { results?: unknown } | null)?.results;
  const app = (Array.isArray(results) ? results : []).find((r) => r && typeof r === "object" && ((r as Record<string, unknown>).kind === "software" || (r as Record<string, unknown>).wrapperType === "software")) as Record<string, unknown> | undefined;
  if (!app) return null;
  const storeId = String(app.trackId ?? "").match(/^\d{5,15}$/)?.[0];
  const name = str(app.trackName, 120);
  if (!storeId || !name) return null;
  const screenshots = (Array.isArray(app.screenshotUrls) ? app.screenshotUrls : []).map(https).filter((u): u is string => Boolean(u)).slice(0, 8);
  const rating = typeof app.averageUserRating === "number" && Number.isFinite(app.averageUserRating) ? Math.round(app.averageUserRating * 10) / 10 : null;
  return {
    storeId, name,
    developer: str(app.sellerName, 120) ?? str(app.artistName, 120),
    iconUrl: https(app.artworkUrl512) ?? https(app.artworkUrl100),
    category: str(app.primaryGenreName, 80),
    genreId: String(app.primaryGenreId ?? "").match(/^\d{3,6}$/)?.[0] ?? null,
    genreIds: genreIdsOf(app.genreIds),
    description: str(app.description, 2000),
    screenshots,
    url: https(app.trackViewUrl)?.replace(/\?.*$/, "") ?? `https://apps.apple.com/app/id${storeId}`,
    price: str(app.formattedPrice, 40),
    rating,
  };
}

/** The apps in a chart feed answer, in rank order, each once. */
export function parseChart(json: unknown): SimilarApp[] {
  const entries = (json as { feed?: { entry?: unknown } } | null)?.feed?.entry;
  const list = Array.isArray(entries) ? entries : entries && typeof entries === "object" ? [entries] : [];
  const seen = new Set<string>();
  const out: SimilarApp[] = [];
  for (const raw of list) {
    const e = raw as Record<string, { label?: unknown; attributes?: Record<string, unknown> } | { label?: unknown; attributes?: Record<string, unknown> }[]>;
    const id = (e.id as { attributes?: Record<string, unknown> } | undefined)?.attributes?.["im:id"];
    const storeId = String(id ?? "").match(/^\d{5,15}$/)?.[0];
    const name = str((e["im:name"] as { label?: unknown } | undefined)?.label, 120);
    if (!storeId || !name || seen.has(storeId)) continue;
    seen.add(storeId);
    const images = Array.isArray(e["im:image"]) ? e["im:image"] : [];
    out.push({ storeId, name, developer: str((e["im:artist"] as { label?: unknown } | undefined)?.label, 120), iconUrl: https(images[images.length - 1]?.label), summary: str((e.summary as { label?: unknown } | undefined)?.label, 1500) });
  }
  return out;
}

/** Apps like this one: the chart's apps without the app itself or others by the same developer, at most `limit`. */
export function similarApps(chart: SimilarApp[], own: Pick<StoreListing, "storeId" | "developer">, limit = 8): SimilarApp[] {
  const dev = own.developer?.trim().toLowerCase();
  return chart.filter((a) => a.storeId !== own.storeId && (!dev || a.developer?.trim().toLowerCase() !== dev)).slice(0, limit);
}

/** The apps in a search answer (the same shape as a lookup's), in Apple's order, each once. */
export function parseSearch(json: unknown): SimilarApp[] {
  const results = (json as { results?: unknown } | null)?.results;
  const seen = new Set<string>();
  const out: SimilarApp[] = [];
  for (const raw of Array.isArray(results) ? results : []) {
    const app = raw as Record<string, unknown> | null;
    if (!app || (app.kind !== "software" && app.wrapperType !== "software")) continue;
    const storeId = String(app.trackId ?? "").match(/^\d{5,15}$/)?.[0];
    const name = str(app.trackName, 120);
    if (!storeId || !name || seen.has(storeId)) continue;
    seen.add(storeId);
    out.push({
      storeId, name, developer: str(app.sellerName, 120) ?? str(app.artistName, 120), iconUrl: https(app.artworkUrl100) ?? https(app.artworkUrl512),
      genreId: String(app.primaryGenreId ?? "").match(/^\d{3,6}$/)?.[0] ?? null, genreIds: genreIdsOf(app.genreIds),
      ratingCount: typeof app.userRatingCount === "number" && Number.isFinite(app.userRatingCount) ? app.userRatingCount : null,
      description: str(app.description, 1500),
    });
  }
  return out;
}

// MARK: Suggestions by keywords

/** Words that say nothing about what an app does (English: the US storefront is the default). */
const STOP = new Set(("about after again also always amazing anywhere apple apps around available back based become best better build "
  + "cancel care change charged choose come comes community complete create daily days device download easily easy even ever every "
  + "everything experience feature features first follow free from full future give great have help helps here home into join just keep "
  + "know learn life like live love made make makes many more most much need never news next only other over part people period personal "
  + "plan plans please plus policy premium privacy really renew renewal right same save simple start stay subscription subscriptions support "
  + "take terms that their them then there these they thing things this those through time today together track tracking under unlimited "
  + "until use used user users using want week what when where which while will with within without world would year years your yours "
  + "account auto purchase confirmation itunes store settings automatically billed price prices trial version update updates").split(" "));

/** A word as it is compared: lower case, a plural's last "s" left off ("trails" and "trail" are one). */
const stem = (word: string) => (word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);

/**
 * The words a text uses most (each once, in its most common spelling), leaving out common words, short
 * words and the words in `exclude` (the app's own name). For the scripts with spaces between words.
 */
export function keywords(text: string, exclude: string[] = [], max = 10): string[] {
  const skip = new Set(exclude.flatMap((e) => e.toLowerCase().match(/\p{L}+/gu) ?? []).map(stem));
  const counts = new Map<string, { n: number; spellings: Map<string, number> }>();
  for (const raw of text.toLowerCase().match(/\p{L}{4,}/gu) ?? []) {
    const key = stem(raw);
    if (STOP.has(raw) || STOP.has(key) || skip.has(key)) continue;
    const entry = counts.get(key) ?? { n: 0, spellings: new Map() };
    entry.n++;
    entry.spellings.set(raw, (entry.spellings.get(raw) ?? 0) + 1);
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)
    .slice(0, max).map((e) => [...e.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0]);
}

/**
 * What to search the App Store for to find apps like this one: the words after the name in its title
 * ("AllTrails: Hike, Bike & Run" → "Hike Bike Run"; the name itself when there are none), and its
 * description's two most used words. At most two.
 */
export function searchTerms(listing: Pick<StoreListing, "name" | "description">): string[] {
  const short = shortAppName(listing.name);
  const rest = listing.name.slice(listing.name.indexOf(short) + short.length).replace(/^[\s:|–—-]+/, "");
  // A title with nothing after the name ("Habit Tracker", "Calm") is searched by the name itself: Apple
  // answers with the apps people find for it, the app's own first.
  const fromTitle = (rest.match(/\p{L}{3,}/gu) ?? []).filter((w) => !STOP.has(w.toLowerCase())).slice(0, 4).join(" ") || short;
  const fromText = keywords(listing.description ?? "", [short], 2).join(" ");
  return [...new Set([fromTitle, fromText].map((term) => term.trim()).filter(Boolean))].slice(0, 2);
}

/** How many of `words` a text uses (compared as keywords are). */
function overlap(text: string, words: Set<string>): number {
  const found = new Set((text.toLowerCase().match(/\p{L}{4,}/gu) ?? []).map(stem).filter((w) => words.has(w)));
  return found.size;
}

/**
 * Competitor suggestions for an app, best first (the method is described at the top of this file):
 * the apps its search terms find, scored, then the category chart's apps that fit, at most `limit`.
 */
export function rankSimilar(own: Pick<StoreListing, "storeId" | "developer" | "name" | "description" | "genreId" | "genreIds">, searches: SimilarApp[][], chart: SimilarApp[], limit = 8): SimilarApp[] {
  const dev = own.developer?.trim().toLowerCase();
  const isOwn = (a: SimilarApp) => a.storeId === own.storeId || Boolean(dev && a.developer?.trim().toLowerCase() === dev);
  const words = new Set(keywords(`${own.name} ${own.description ?? ""}`, [shortAppName(own.name)], 10).map(stem));
  const genres = new Set([own.genreId, ...(own.genreIds ?? [])].filter(Boolean) as string[]);
  const found = new Map<string, { app: SimilarApp; score: number; hits: number }>();
  for (const list of searches) {
    list.forEach((app, rank) => {
      if (isOwn(app)) return;
      const entry = found.get(app.storeId) ?? { app, score: 0, hits: 0 };
      entry.score += 1 - rank / Math.max(list.length, 1);
      entry.hits++;
      found.set(app.storeId, entry);
    });
  }
  const scored = [...found.values()].map(({ app, score, hits }) => {
    let total = score + (hits - 1) * 0.5;
    if (own.genreId && app.genreId === own.genreId) total += 1.5;
    else if ((app.genreIds ?? []).some((g) => genres.has(g))) total += 0.5;
    else total -= 0.5;
    total += Math.min(2, overlap(`${app.name} ${app.description ?? ""}`, words)) * 0.4;
    const ratings = app.ratingCount ?? 0;
    total += ratings < 20 ? -1.5 : Math.min(2, Math.log10(ratings + 1) / 3);
    return { app, total };
  }).sort((a, b) => b.total - a.total).map((s) => s.app);

  const out = scored.slice(0, limit);
  const taken = new Set(out.map((a) => a.storeId));
  // Enough found by search: a chart app has to share at least one keyword to come in (one without a summary is kept).
  const strict = out.length >= 3;
  for (const app of chart) {
    if (out.length >= limit) break;
    if (taken.has(app.storeId) || isOwn(app)) continue;
    if (strict && app.summary && overlap(`${app.name} ${app.summary}`, words) === 0) continue;
    taken.add(app.storeId);
    out.push(app);
  }
  return out;
}

// MARK: Categories

/**
 * Apple's primary categories by id, in English as the US store names them: shown with t() so the
 * category reads in the viewer's language (the names each store uses in Taiwan, Japan and Korea).
 * Three names already mean something else in the app's dictionaries ("Reference" is a reference image
 * there), so they carry a "Category: " prefix as their key, which categoryLabel takes off again.
 */
const CATEGORY_PREFIX = "Category: ";
export const APP_STORE_CATEGORIES: Record<string, string> = {
  "6000": m("Category: Business"), "6001": m("Weather"), "6002": m("Utilities"), "6003": m("Travel"), "6004": m("Sports"),
  "6005": m("Social Networking"), "6006": m("Category: Reference"), "6007": m("Productivity"), "6008": m("Photo & Video"), "6009": m("News"),
  "6010": m("Navigation"), "6011": m("Music"), "6012": m("Category: Lifestyle"), "6013": m("Health & Fitness"), "6014": m("Games"),
  "6015": m("Finance"), "6016": m("Entertainment"), "6017": m("Education"), "6018": m("Books"), "6020": m("Medical"),
  "6021": m("Magazines & Newspapers"), "6022": m("Catalogs"), "6023": m("Food & Drink"), "6024": m("Shopping"), "6025": m("Stickers"),
  "6026": m("Developer Tools"), "6027": m("Graphics & Design"),
};

/** A listing's category as a dictionary key: Apple's English name for its id, else the name Apple sent. */
export const categoryName = (listing: Pick<StoreListing, "category" | "genreId">): string | null =>
  (listing.genreId && APP_STORE_CATEGORIES[listing.genreId]) || listing.category;

/** A listing's category in the viewer's language (`t` is the page's translator), or null. */
export function categoryLabel(listing: Pick<StoreListing, "category" | "genreId">, t: (text: string) => string): string | null {
  const key = categoryName(listing);
  return key ? t(key).replace(CATEGORY_PREFIX, "") : null;
}

/** A short, readable app name for a competitor chip: "Calm: Sleep & Meditation" → "Calm". */
export const shortAppName = (name: string) => name.split(/\s+[-–—|:]\s+|:\s/)[0].trim().slice(0, 60) || name.slice(0, 60);
