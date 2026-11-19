// Twin of supabase/functions/_shared/research-sources.ts: which research sources exist, what each needs
// and costs, and which are on (the owner's choice in Settings > Research sources, the defaults that follow
// the keys, and the older environment switches that still win). Everything below this comment must stay
// identical to that file; studio/src/lib/ad-sources.test.ts fails when they drift apart.

export const SOURCE_IDS = ["metaApify", "google", "metaApi", "tiktokLibrary", "tiktokEu", "tiktokTopAds"] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

/** Which Apify actor reads Meta's Ad Library: the cheaper community one or Apify's own. */
export type MetaActor = "community" | "official";

/** What is stored: each source on, off, or null for "automatic" (follows its key), and the Meta actor. */
export interface ResearchSettings {
  metaApify: boolean | null;
  metaActor: MetaActor;
  google: boolean | null;
  metaApi: boolean | null;
  tiktokLibrary: boolean | null;
  tiktokEu: boolean | null;
  tiktokTopAds: boolean | null;
}

export const DEFAULT_RESEARCH: ResearchSettings = {
  metaApify: null, metaActor: "community", google: null, metaApi: null, tiktokLibrary: null, tiktokEu: null, tiktokTopAds: null,
};

/** The keys a source needs; every one must be saved. */
export const SOURCE_KEYS: Record<SourceId, string[]> = {
  metaApify: ["APIFY_TOKEN"],
  google: ["APIFY_TOKEN"],
  metaApi: ["META_AD_LIBRARY_TOKEN"],
  tiktokLibrary: ["TIKTOK_RESEARCH_CLIENT_KEY", "TIKTOK_RESEARCH_CLIENT_SECRET"],
  tiktokEu: ["APIFY_TOKEN"],
  tiktokTopAds: ["APIFY_TOKEN"],
};

/** Whether a source is on when nothing is chosen and its key is saved. */
const ON_BY_DEFAULT: Record<SourceId, boolean> = {
  metaApify: true, google: true, metaApi: true, tiktokLibrary: true, tiktokEu: false, tiktokTopAds: false,
};

/** Apify actors behind the paid sources (checked on the Apify Store on 19 November 2026). */
export const ACTORS = {
  /** curious_coder: input `urls` + `count` / `limitPerSource`; Meta's own snake_case JSON out. */
  metaCommunity: "curious_coder~facebook-ads-library-scraper",
  /** Apify's own: input `startUrls` + `resultsLimit` (per URL); camelCase out. */
  metaOfficial: "apify~facebook-ads-scraper",
  /** scrapesage: Google Ads Transparency Center by domain, advertiser id or name. */
  google: "scrapesage~google-ads-transparency-scraper",
  /** s-r: TikTok's Ad Library (ads shown in Europe) by advertiser name or business id. */
  tiktokEu: "s-r~tiktok-ads-library",
  /** azzouzana: TikTok Creative Center "Top Ads" by country, industry and keyword (not by brand). */
  tiktokTopAds: "azzouzana~tiktok-creative-center-top-ads-scraper",
} as const;

/**
 * What a source costs, in US dollars, from each actor's pricing on the Apify Store (free plan) on
 * 19 November 2026: per ad, per run started, and the price per 100 ads people see in Settings.
 */
export interface SourcePrice { perAd: number; perRun: number; per100: number; note: string | null }
export const PRICES_CHECKED = "2026-11-19";
export const PRICES: Record<SourceId | "metaApifyOfficial", SourcePrice> = {
  metaApify: { perAd: 0.00075, perRun: 0.00005, per100: 0.075, note: null },
  metaApifyOfficial: { perAd: 0.0058, perRun: 0, per100: 0.58, note: "$0.34 per 100 on Apify's Business plan." },
  // $0.002 per ad, plus $0.002 for each ad whose text Google's preview holds (search and Shopping ads).
  google: { perAd: 0.004, perRun: 0, per100: 0.4, note: "$0.20 per 100 ads, plus $0.20 per 100 text ads for their words." },
  metaApi: { perAd: 0, perRun: 0, per100: 0, note: null },
  tiktokLibrary: { perAd: 0, perRun: 0, per100: 0, note: null },
  tiktokEu: { perAd: 0.003, perRun: 0, per100: 0.3, note: null },
  tiktokTopAds: { perAd: 0.001, perRun: 0.005, per100: 0.1, note: "Plus $0.005 per search." },
};

/** The price of the Meta source with the chosen actor. */
export const metaPrice = (actor: MetaActor): SourcePrice => (actor === "official" ? PRICES.metaApifyOfficial : PRICES.metaApify);

/** Where TikTok's ad library holds a brand's ads: the EU and EEA, the UK and Switzerland. */
export const TIKTOK_LIBRARY_COUNTRIES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH",
];

// MARK: Reading and checking what is stored

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isActor = (value: unknown): value is MetaActor => value === "community" || value === "official";
export const SOURCE_NAMES: Record<SourceId, string> = {
  metaApify: "Meta ads through Apify", google: "Google ads", metaApi: "Meta's Ad Library API",
  tiktokLibrary: "TikTok's Commercial Content API", tiktokEu: "TikTok ads shown in Europe", tiktokTopAds: "TikTok Top Ads",
};

/** What is stored in `install.settings.research`, with "automatic" for anything unset or unreadable. */
export function readResearch(raw: unknown): ResearchSettings {
  const source = isObject(raw) ? raw : {};
  const out: ResearchSettings = { ...DEFAULT_RESEARCH };
  for (const id of SOURCE_IDS) if (typeof source[id] === "boolean") out[id] = source[id] as boolean;
  if (isActor(source.metaActor)) out.metaActor = source.metaActor;
  return out;
}

export type ResearchPatch = Partial<ResearchSettings>;

/**
 * Checks what the owner sent for `research`: each source true, false or null (back to automatic), and
 * `metaActor`. Answers the fields to merge, or a sentence saying what to fix. Unknown fields are refused.
 */
export function researchPatch(input: unknown): ResearchPatch | string {
  if (!isObject(input)) return "Research sources must be a set of choices.";
  const patch: ResearchPatch = {};
  for (const [field, value] of Object.entries(input)) {
    if (field === "metaActor") {
      if (!isActor(value)) return "Choose the community or the official actor for Meta ads.";
      patch.metaActor = value;
      continue;
    }
    if (!(SOURCE_IDS as readonly string[]).includes(field)) return `Unknown research source: ${field}.`;
    if (value !== null && typeof value !== "boolean") return `${SOURCE_NAMES[field as SourceId]} must be on, off or automatic.`;
    patch[field as SourceId] = value as boolean | null;
  }
  if (!Object.keys(patch).length) return "Send the research sources to change.";
  return patch;
}

/** The stored object with the patch laid over it; null drops a source back to automatic. */
export function mergeResearch(current: unknown, patch: ResearchPatch): Record<string, unknown> {
  const base = isObject(current) ? { ...current } : {};
  for (const [field, value] of Object.entries(patch)) {
    if (value === null) delete base[field]; else base[field] = value;
  }
  return base;
}

// MARK: What is on

/** The older environment switches (plain words, no secrets). */
export interface SourceEnv { RESEARCH_TIKTOK?: string | null; RESEARCH_META_APIFY_ACTOR?: string | null }

/** Why a source is on or off, for Settings and the collect dialog. */
export type SourceReason = "chosen" | "automatic" | "off" | "needs_key" | "environment";
export interface SourceState { on: boolean; reason: SourceReason; missingKeys: string[] }
export interface ResolvedSources { sources: Record<SourceId, SourceState>; metaActor: MetaActor; metaActorFromEnv: boolean }

/** The switches' word for TikTok, or null when it isn't set to something this knows. */
export function tiktokSwitch(env: SourceEnv): "library" | "creative_center" | "off" | null {
  const value = env.RESEARCH_TIKTOK?.trim();
  return value === "library" || value === "creative_center" || value === "off" ? value : null;
}

/**
 * Which sources a pull uses: the environment switch where it is set, else the owner's choice, else the
 * default; and in every case only with the source's keys saved. `hasKey` says whether a key is saved.
 */
export function resolveSources(settings: ResearchSettings, hasKey: (name: string) => boolean, env: SourceEnv = {}): ResolvedSources {
  const tiktok = tiktokSwitch(env);
  const sources = {} as Record<SourceId, SourceState>;
  for (const id of SOURCE_IDS) {
    const missingKeys = SOURCE_KEYS[id].filter((name) => !hasKey(name));
    let wanted: boolean, reason: SourceReason;
    const forced = tiktok && (id === "tiktokLibrary" || id === "tiktokTopAds" || id === "tiktokEu")
      ? tiktok === "off" ? false : id === "tiktokLibrary" ? tiktok === "library" : id === "tiktokTopAds" ? tiktok === "creative_center" : null
      : null;
    if (forced !== null) { wanted = forced; reason = "environment"; }
    else if (settings[id] !== null) { wanted = settings[id] as boolean; reason = wanted ? "chosen" : "off"; }
    else { wanted = ON_BY_DEFAULT[id]; reason = wanted ? "automatic" : "off"; }
    if (wanted && missingKeys.length) sources[id] = { on: false, reason: "needs_key", missingKeys };
    else sources[id] = { on: wanted, reason, missingKeys };
  }
  const envActor = env.RESEARCH_META_APIFY_ACTOR?.trim();
  const fromEnv = envActor === "official" || envActor === "curious" || envActor === "community";
  return { sources, metaActor: fromEnv ? (envActor === "official" ? "official" : "community") : settings.metaActor, metaActorFromEnv: fromEnv };
}

/** The resolved sources as a plain on/off map. */
export const onSources = (resolved: ResolvedSources): Record<SourceId, boolean> =>
  Object.fromEntries(SOURCE_IDS.map((id) => [id, resolved.sources[id].on])) as Record<SourceId, boolean>;
