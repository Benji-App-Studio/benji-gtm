// What a collection would do: which competitor goes to which source, how many ads that reads at most
// and what it costs at most, and what is skipped and why. Pure (no database, no environment), so
// plan_test.ts checks it with plain objects; index.ts runs it against the watchlist and the keys.
import { adLibraryUrl, META_API_COMMERCIAL_COUNTRIES } from "../radar/engine/adlibrary.ts";
import { chargeCap } from "../radar/engine/apify.ts";
import { metaPrice, PRICES, type ResolvedSources, SOURCE_NAMES, type SourceId, TIKTOK_LIBRARY_COUNTRIES } from "../_shared/research-sources.ts";

/** Ads read per competitor and source in one collection, at most. */
export const LIMITS = { meta: 200, metaApiPages: 5, google: 100, tiktokEu: 100, tiktokLibrary: 50, tiktokTopAds: 50 } as const;

export interface PlanWatch {
  id: string; name: string; network: "meta" | "tiktok" | "google";
  page_id: string | null; page_url: string | null; search_terms: string | null; tiktok_advertiser_id: string | null;
  countries: string[]; enabled: boolean; is_own?: boolean;
  website?: string | null; google_advertiser_id?: string | null; tiktok_business_name?: string | null;
}

/** How a competitor is found on a source: its exact id, its website, or a search for its name. */
export type MatchBy = "id" | "website" | "name";

export interface Plan<W extends PlanWatch = PlanWatch> {
  metaApi: { watch: W; countries: string[] }[];
  metaApify: { watch: W; url: string }[];
  google: { watch: W; advertiserId: string | null; domain: string | null; name: string; country: string | null; by: MatchBy }[];
  tiktokLibrary: { watch: W; businessId: string | null; name: string; country: string | null; by: MatchBy }[];
  tiktokEu: { watch: W; businessId: string | null; name: string; country: string | null; by: MatchBy }[];
  tiktokTopAds: { watch: W; keyword: string; country: string }[];
  /** One line per source that runs: competitors, ads at most, cost at most. */
  sources: { id: SourceId; label: string; paid: boolean; competitors: number; maxAds: number; usd: number }[];
  /** A competitor a source can't collect (or collects only partly), with the reason in plain words. */
  skipped: { watchId: string; name: string; source: SourceId | "tiktok"; reason: string }[];
  /** Ads the paid sources read at most, and what that costs at most (USD). */
  paidAds: number;
  usd: number;
  notes: string[];
}

/** One competitor per name, like public.competitor_key and studio/src/lib/competitors.ts. */
export const competitorKey = (name: string) => name.trim().replace(/^@+/, "").replace(/\s+/g, " ").toLowerCase();

/** A Page id from a facebook.com URL that carries one (`?id=`, `view_all_page_id=`, `/profile.php?id=`). */
export const pageIdFrom = (url: string | null) => url?.match(/(?:view_all_page_id|[?&]id)=(\d{5,})/)?.[1] ?? null;

/** A bare host name from a website the competitor has saved ("https://www.notion.so/pricing" → "notion.so"). */
export function domainOf(website: string | null | undefined): string | null {
  const value = (website ?? "").trim().toLowerCase();
  if (!value) return null;
  try {
    const host = new URL(/^[a-z]+:\/\//.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

const money = (n: number) => Math.round(n * 100) / 100;
const upper = (countries: string[]) => (countries.length ? countries : ["US"]).map((c) => c.toUpperCase());
const SETTINGS = "Settings > Research sources";
const why = (resolved: ResolvedSources, id: SourceId) =>
  resolved.sources[id].reason === "needs_key" ? `needs ${resolved.sources[id].missingKeys.includes("APIFY_TOKEN") ? "the Apify key" : "its key"}` : `is off in ${SETTINGS}`;

/**
 * The plan for the enabled competitors (all, or those in `watchIds` and the other entries with the same
 * name, so one competitor's Meta and TikTok entries go together), with the sources that are on.
 */
export function makePlan<W extends PlanWatch>(all: W[], resolved: ResolvedSources, o: { watchIds?: string[] | null } = {}): Plan<W> {
  const on = (id: SourceId) => resolved.sources[id].on;
  const p: Plan<W> = { metaApi: [], metaApify: [], google: [], tiktokLibrary: [], tiktokEu: [], tiktokTopAds: [], sources: [], skipped: [], paidAds: 0, usd: 0, notes: [] };
  let list = all.filter((w) => w.enabled);
  if (o.watchIds?.length) {
    const keys = new Set(all.filter((w) => o.watchIds!.includes(w.id)).map((w) => competitorKey(w.name)));
    list = all.filter((w) => keys.has(competitorKey(w.name)) && (w.enabled || o.watchIds!.includes(w.id)));
  }
  if (!list.length) {
    p.notes.push(o.watchIds?.length ? "That competitor isn't on the list any more." : "Add competitors to the list and follow them first.");
    return finish(p, resolved);
  }

  // One competitor can have a Meta entry and a TikTok entry: group them by name.
  const groups = new Map<string, W[]>();
  for (const w of list) groups.set(competitorKey(w.name), [...(groups.get(competitorKey(w.name)) ?? []), w]);

  for (const rows of groups.values()) {
    const main = rows.find((w) => w.network === "meta") ?? rows[0];
    const countries = upper(main.countries);
    const skip = (source: SourceId | "tiktok", reason: string) => p.skipped.push({ watchId: main.id, name: main.name, source, reason });

    // Meta: each Meta entry (a brand can follow several Pages).
    for (const watch of rows.filter((w) => w.network === "meta")) {
      const wc = upper(watch.countries);
      const pageId = watch.page_id ?? pageIdFrom(watch.page_url);
      const apiCountries = wc.filter((c) => META_API_COMMERCIAL_COUNTRIES.includes(c));
      if (on("metaApi") && apiCountries.length && (pageId || watch.search_terms)) p.metaApi.push({ watch: { ...watch, page_id: pageId }, countries: apiCountries });
      // Outside the EU/UK the official API has no commercial ads: the public Ad Library pages are the only source.
      const others = wc.filter((c) => !META_API_COMMERCIAL_COUNTRIES.includes(c));
      const scrape = others.length ? others : on("metaApi") ? [] : wc;
      if (!scrape.length) continue;
      if (!on("metaApify")) {
        skip("metaApify", `Meta ads in ${scrape.join(", ")}: ${SOURCE_NAMES.metaApify} ${why(resolved, "metaApify")}.`);
        continue;
      }
      const country = scrape.length === 1 ? scrape[0] : "ALL";
      const url = pageId ? adLibraryUrl({ pageId, country })
        : watch.page_url?.includes("/ads/library") ? watch.page_url
        : adLibraryUrl({ searchTerms: watch.search_terms ?? watch.name, country });
      p.metaApify.push({ watch, url });
    }

    // Google: once per competitor, by advertiser id, else its website, else its name.
    if (on("google")) {
      const advertiserId = rows.map((w) => w.google_advertiser_id).find(Boolean) ?? null;
      const domain = domainOf(rows.map((w) => w.website).find(Boolean));
      const by: MatchBy = advertiserId ? "id" : domain ? "website" : "name";
      p.google.push({ watch: main, advertiserId, domain, name: main.search_terms || main.name, country: countries.length === 1 ? countries[0] : null, by });
    }

    // TikTok: its TikTok entry if it has one, else the competitor's main entry (by business id or name).
    const tt = rows.find((w) => w.network === "tiktok") ?? main;
    const businessId = rows.map((w) => w.tiktok_advertiser_id).find(Boolean) ?? null;
    const ttName = rows.map((w) => w.tiktok_business_name).find(Boolean) || tt.search_terms || tt.name;
    const ttBy: MatchBy = businessId ? "id" : "name";
    const europe = upper(tt.countries).filter((c) => TIKTOK_LIBRARY_COUNTRIES.includes(c));
    // Europe only: the competitor's first European country, else every European country.
    const euCountry = europe[0] ?? null;
    if (on("tiktokLibrary")) p.tiktokLibrary.push({ watch: tt, businessId, name: ttName, country: euCountry, by: ttBy });
    if (on("tiktokEu")) p.tiktokEu.push({ watch: tt, businessId, name: ttName, country: euCountry, by: ttBy });
    if ((on("tiktokLibrary") || on("tiktokEu")) && !europe.length) {
      skip("tiktok", "TikTok lists a brand's ads only where they ran in Europe, so only its European ads can come in.");
    }
    if (on("tiktokTopAds") && tt.network === "tiktok") p.tiktokTopAds.push({ watch: tt, keyword: tt.search_terms ?? tt.name, country: upper(tt.countries)[0] });
    if (!on("tiktokLibrary") && !on("tiktokEu") && tt.network === "tiktok") skip("tiktok", "No TikTok source that finds a brand's own ads is on.");
  }
  return finish(p, resolved);
}

/**
 * What one Apify run costs at most, as the plan shows it before the person confirms: the Meta run (all
 * its pages at once), and one Google, TikTok-EU or Top Ads run per competitor.
 */
export function runEstimate(resolved: ResolvedSources, source: "metaApify" | "google" | "tiktokEu" | "tiktokTopAds", urls = 1): { usd: number; maxAds: number } {
  if (source === "metaApify") {
    const meta = metaPrice(resolved.metaActor), maxAds = urls * LIMITS.meta;
    return { usd: maxAds * meta.perAd + (urls ? meta.perRun : 0), maxAds };
  }
  if (source === "google") return { usd: LIMITS.google * PRICES.google.perAd, maxAds: LIMITS.google };
  if (source === "tiktokEu") return { usd: LIMITS.tiktokEu * PRICES.tiktokEu.perAd, maxAds: LIMITS.tiktokEu };
  return { usd: LIMITS.tiktokTopAds * PRICES.tiktokTopAds.perAd + PRICES.tiktokTopAds.perRun, maxAds: LIMITS.tiktokTopAds };
}

/** Apify stops a research run after this long, even when nobody polls it (it normally takes minutes). */
export const APIFY_RUN_TIMEOUT_SECS = 2 * 3600;

/**
 * The limits a research run starts with (radar/engine/apify.ts RunLimits): the timeout, a charge cap a
 * small margin above the run's estimate, and the most ads the plan counted.
 */
export function apifyRunLimits(estimate: { usd: number; maxAds: number }) {
  return { timeoutSecs: APIFY_RUN_TIMEOUT_SECS, maxTotalChargeUsd: chargeCap(estimate.usd), maxItems: estimate.maxAds };
}

function finish<W extends PlanWatch>(p: Plan<W>, resolved: ResolvedSources): Plan<W> {
  const line = (id: SourceId, competitors: number, maxAds: number, usd: number, paid: boolean) => {
    if (competitors) p.sources.push({ id, label: SOURCE_NAMES[id], paid, competitors, maxAds, usd: money(usd) });
  };
  if (p.metaApify.length) {
    const run = runEstimate(resolved, "metaApify", p.metaApify.length);
    line("metaApify", p.metaApify.length, run.maxAds, run.usd, true);
  }
  const each = (source: "google" | "tiktokEu" | "tiktokTopAds", n: number) => {
    const run = runEstimate(resolved, source);
    line(source, n, n * run.maxAds, n * run.usd, true);
  };
  each("google", p.google.length);
  line("metaApi", p.metaApi.length, p.metaApi.length * LIMITS.meta * LIMITS.metaApiPages, 0, false);
  line("tiktokLibrary", p.tiktokLibrary.length, p.tiktokLibrary.length * LIMITS.tiktokLibrary, 0, false);
  each("tiktokEu", p.tiktokEu.length);
  each("tiktokTopAds", p.tiktokTopAds.length);
  const paid = p.sources.filter((s) => s.paid);
  p.paidAds = paid.reduce((n, s) => n + s.maxAds, 0);
  p.usd = money(paid.reduce((n, s) => n + s.usd, 0));
  if (p.google.some((g) => g.by === "name")) p.notes.push("Google ads are matched by name for competitors without a website or Google advertiser id; add one for exact results.");
  return p;
}

/** The plan as the studio gets it: counts per source, without the watchlist rows. */
export function planAnswer(p: Plan) {
  const free = p.metaApi.length + p.tiktokLibrary.length;
  const paid = p.metaApify.length + p.google.length + p.tiktokEu.length + p.tiktokTopAds.length;
  return { free, paid, paidAds: p.paidAds, usd: p.usd, notes: p.notes, sources: p.sources, skipped: p.skipped };
}
