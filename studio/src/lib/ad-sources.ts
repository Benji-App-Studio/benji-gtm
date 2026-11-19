// The ad sources as people see them: what each covers in one honest line, what it costs, which key it
// needs, and what it finds a competitor by; the cleaning of what people paste for a competitor (a Facebook
// Page link, a website or a Google advertiser link, a TikTok business name or link); and the plain
// sentence a collection ends with. Plain TypeScript, safe in the browser and on the server.
import type { Feature } from "./capabilities";
import { keySpec } from "./install/key-catalog";
import type { InstallState } from "./install/types";
import {
  DEFAULT_RESEARCH, metaPrice, PRICES, PRICES_CHECKED, readResearch, resolveSources, SOURCE_IDS, SOURCE_KEYS,
  type MetaActor, type ResolvedSources, type SourceId,
} from "./research-sources";
import { UI_LOCALE } from "./ui-locale";

export { DEFAULT_RESEARCH, PRICES_CHECKED, SOURCE_IDS, type MetaActor, type ResolvedSources, type SourceId };

export type SourceNetwork = "meta" | "google" | "tiktok";

export interface SourceInfo {
  id: SourceId;
  label: string;
  network: SourceNetwork;
  /** What it covers, in one honest line. */
  covers: string;
  /** What it finds a competitor by. */
  finds: string;
  /** Free (an official API) or billed per ad by Apify. */
  free: boolean;
}

export const SOURCES: SourceInfo[] = [
  {
    id: "metaApify", label: "Meta ads", network: "meta", free: false,
    covers: "Every active ad in any country, with images and videos, read from Meta's public Ad Library.",
    finds: "its Facebook Page, else its name",
  },
  {
    id: "google", label: "Google ads", network: "google", free: false,
    covers: "Search, YouTube, Shopping, Maps and Play ads in any country, from Google's Ads Transparency Center (the last 12 months).",
    finds: "its Google advertiser id, else its website, else its name",
  },
  {
    id: "metaApi", label: "Meta's official API", network: "meta", free: true,
    covers: "Free, but only ads shown in the EU and the UK (and political ads elsewhere), as text without images or videos.",
    finds: "its Facebook Page, else its name",
  },
  {
    id: "tiktokLibrary", label: "TikTok's official API", network: "tiktok", free: true,
    covers: "Free: a brand's ads shown in Europe (EU, UK, Switzerland). TikTok grants access by application and often refuses it.",
    finds: "its TikTok business id, else its business name",
  },
  {
    id: "tiktokEu", label: "TikTok ads in Europe", network: "tiktok", free: false,
    covers: "A brand's ads shown in Europe (EU, UK, Switzerland), with videos. TikTok lists no brand's US-only ads anywhere.",
    finds: "its TikTok business id, else its business name",
  },
  {
    id: "tiktokTopAds", label: "TikTok Top Ads", network: "tiktok", free: false,
    covers: "TikTok's best-performing ads by country and keyword. Not one brand's ads, so it doesn't show a competitor's own.",
    finds: "a keyword (the name on its TikTok entry), not the brand itself",
  },
];

export const sourceInfo = (id: SourceId) => SOURCES.find((s) => s.id === id)!;

/** The keys a source needs, as people know them ("Apify"), with each one's guide. */
export const sourceKeys = (id: SourceId) => SOURCE_KEYS[id].map((name) => ({ name, label: keySpec(name)?.label ?? name, guide: keySpec(name)?.guide ?? null }));

/** "$1.10", "$0.075", "under $0.01", "Free". */
export function usd(amount: number): string {
  if (!amount) return "Free";
  if (amount < 0.01) return "under $0.01";
  // Small prices keep their third decimal ($0.075), so a per-100 price isn't rounded away.
  if (amount < 0.1) return `$${amount.toFixed(3).replace(/0$/, "")}`;
  return `$${amount.toFixed(2)}`;
}

/** What 100 ads cost on a source, as a short line ("$0.08 per 100 ads"). */
export function pricePer100(id: SourceId, actor: MetaActor = "community"): string {
  const price = id === "metaApify" ? metaPrice(actor) : PRICES[id];
  return price.per100 ? `${usd(price.per100)} per 100 ads` : "Free";
}

/** A note on a price ("$0.20 per 100 ads, plus …"), or null. */
export const priceNote = (id: SourceId, actor: MetaActor = "community") => (id === "metaApify" ? metaPrice(actor).note : PRICES[id].note);

/** Which sources are on for this install, the way the research function decides it. Null when the install can't be read. */
export function installSources(install: InstallState | null | undefined): ResolvedSources | null {
  if (!install) return null;
  return resolveSources(readResearch(install.research), (name) => Boolean(install.keys[name]?.set), {
    RESEARCH_TIKTOK: install.researchEnv?.tiktok ?? null, RESEARCH_META_APIFY_ACTOR: install.researchEnv?.metaActor ?? null,
  });
}

// MARK: What people paste for a competitor

export type Cleaned<T> = { ok: true; value: T; shown: string } | { ok: false; error: string } | { ok: true; value: null; shown: "" };

const EMPTY = { ok: true as const, value: null, shown: "" as const };

/** A Facebook Page: its numeric id (typed, or in an Ad Library or profile link), else a facebook.com Page link. */
export function cleanMetaPage(input: string): Cleaned<{ pageId: string | null; pageUrl: string | null }> {
  const value = input.trim();
  if (!value) return EMPTY;
  const id = /^\d{5,30}$/.test(value) ? value : value.match(/(?:view_all_page_id|[?&]id)=(\d{5,30})/)?.[1];
  if (id) return { ok: true, value: { pageId: id, pageUrl: null }, shown: `Page ${id}` };
  const url = value.match(/^(?:https?:\/\/)?(?:www\.|m\.|web\.)?facebook\.com\/([^?#\s]+)/i);
  if (url && !/^ads\/library\/?$/i.test(url[1])) {
    const page = `https://www.facebook.com/${url[1].replace(/\/+$/, "")}`;
    return { ok: true, value: { pageId: null, pageUrl: page }, shown: page.replace("https://www.", "") };
  }
  return { ok: false, error: "Paste the Page's link (facebook.com/…), its Ad Library link, or its numeric Page id." };
}

/** A host name from a website or a link ("https://www.notion.so/pricing" → "notion.so"), or null. */
export function domainOf(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (!value || /\s/.test(value)) return null;
  try {
    const host = new URL(/^[a-z]+:\/\//.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && !/^\d+(\.\d+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

/** Google: an advertiser id (AR…, typed or in a Transparency Center link), else a website's domain. */
export function cleanGoogle(input: string): Cleaned<{ advertiserId: string | null; website: string | null }> {
  const value = input.trim();
  if (!value) return EMPTY;
  const id = value.match(/\b(AR\d{10,30})\b/)?.[1];
  if (id) return { ok: true, value: { advertiserId: id, website: null }, shown: `Advertiser ${id}` };
  if (/adstransparency\.google\.com/i.test(value)) {
    const domain = value.match(/[?&]domain=([^&#]+)/i)?.[1];
    const host = domain ? domainOf(decodeURIComponent(domain)) : null;
    if (host) return { ok: true, value: { advertiserId: null, website: host }, shown: `Website ${host}` };
    return { ok: false, error: "That Transparency Center link has no advertiser in it. Open the advertiser's page and copy its link (it has AR… in it)." };
  }
  const host = domainOf(value);
  if (host) return { ok: true, value: { advertiserId: null, website: host }, shown: `Website ${host}` };
  return { ok: false, error: "Paste the competitor's website (like notion.so) or its advertiser link from adstransparency.google.com." };
}

/** TikTok: a business id (typed, or in a library.tiktok.com link), else the business name as the Ad Library shows it. */
export function cleanTikTok(input: string): Cleaned<{ businessId: string | null; businessName: string | null }> {
  const value = input.trim();
  if (!value) return EMPTY;
  const id = /^\d{5,30}$/.test(value) ? value : value.match(/(?:adv_biz_ids?|business_id|adv_id)=(\d{5,30})/)?.[1];
  if (id) return { ok: true, value: { businessId: id, businessName: null }, shown: `Business ${id}` };
  if (/^https?:\/\//i.test(value)) {
    const handle = value.match(/tiktok\.com\/@([\w.]{2,40})/i)?.[1];
    if (handle) return { ok: true, value: { businessId: null, businessName: handle }, shown: `Name “${handle}” (from the profile link; the Ad Library may name the business differently)` };
    return { ok: false, error: "Paste the advertiser's name as TikTok's Ad Library shows it, or a library.tiktok.com link with its business id." };
  }
  const name = value.replace(/^@+/, "").replace(/\s+/g, " ").slice(0, 120);
  return { ok: true, value: { businessId: null, businessName: name }, shown: `Name “${name}”` };
}

// MARK: How a collection ended

export interface PullLike { id: string; source: string; status: "running" | "done" | "error"; ads: number; error: string | null }
export interface SkipLike { watchId: string; source: string; reason: string }

const NETWORK_OF: Record<string, SourceNetwork> = {
  meta_api: "meta", meta_apify: "meta", meta_mcp: "meta", meta_local: "meta",
  google_apify: "google", tiktok_library: "tiktok", tiktok_creative_center: "tiktok", tiktok_apify: "tiktok",
};
const NETWORK_NAME: Record<SourceNetwork, string> = { meta: "Meta", google: "Google", tiktok: "TikTok" };

/** The network a pull or an ad's source belongs to. */
export const networkOfSource = (source: string): SourceNetwork | null => NETWORK_OF[source] ?? null;

/**
 * The sentence a collection ends with: ads per network, a source that failed in its own words, and
 * TikTok's honest answer when nothing came from it ("41 Meta ads, 12 Google ads, TikTok: …").
 * `europeOnly` says the plan warned that TikTok only lists a brand's ads shown in Europe.
 */
export function collectSummary(pulls: PullLike[], o: { europeOnly?: boolean; tiktokPlanned?: boolean } = {}): string {
  const parts: string[] = [];
  for (const network of ["meta", "google", "tiktok"] as SourceNetwork[]) {
    const mine = pulls.filter((p) => NETWORK_OF[p.source] === network);
    const name = NETWORK_NAME[network];
    if (!mine.length) {
      if (network === "tiktok" && o.tiktokPlanned === false && o.europeOnly) parts.push("TikTok: only ads shown in Europe are listed");
      continue;
    }
    const ads = mine.filter((p) => p.status === "done").reduce((n, p) => n + p.ads, 0);
    const failed = mine.filter((p) => p.status === "error");
    if (ads > 0 || !failed.length) {
      if (network === "tiktok" && ads === 0) parts.push(o.europeOnly ? "TikTok: not available for this brand outside Europe" : "TikTok: no ads found");
      else parts.push(`${ads.toLocaleString(UI_LOCALE)} ${name} ad${ads === 1 ? "" : "s"}`);
    }
    if (failed.length) parts.push(`${name}: ${failed[0].error ?? "failed"}`);
  }
  return parts.length ? parts.join(", ") : "No ads came in.";
}

/** Which networks a competitor's ads came from ("Meta", "Google"), in a fixed order. */
export function networksFound(ads: { source: string; network?: string }[]): string[] {
  const seen = new Set(ads.map((ad) => NETWORK_OF[ad.source] ?? ad.network).filter(Boolean));
  return (["meta", "google", "tiktok"] as SourceNetwork[]).filter((n) => seen.has(n)).map((n) => NETWORK_NAME[n]);
}

/** The guide this page links to. */
export const COLLECTING_GUIDE = "docs/COLLECTING-ADS.md";

/** The feature (lib/capabilities.ts) behind each source, for its locked state. */
export const SOURCE_FEATURE = {
  metaApify: "research.collect", google: "research.google", metaApi: "research.metaApi",
  tiktokLibrary: "research.tiktokLibrary", tiktokEu: "research.tiktokEu", tiktokTopAds: "research.tiktokTopAds",
} as const satisfies Record<SourceId, Feature>;
