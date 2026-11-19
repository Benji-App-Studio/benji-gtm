// Research → Ads: pulls competitors' PAID ads for a workspace (a product) and keeps them fresh.
//
// Sources, cheapest first:
// - Meta Ad Library API (`ads_archive`, free): commercial ads only for ads delivered to the EU/EEA
//   and the UK, text only (no media). Needs META_AD_LIBRARY_TOKEN.
// - Meta Ad Library via an Apify scraper (paid per ad): every active ad in any country, with media,
//   start date, platforms and the "N ads use this creative" count. Only when the user confirmed the cost.
// - An import of the Meta Ads MCP's `ads_library_search` output (free, newest 50 per query, no media).
// - An import of the local Ad Library scraper's file (scripts/meta-ad-library, free): one advertiser's
//   ads with media, Meta's impressions order and the creative's measured size.
// - Google Ads Transparency Center via an Apify scraper (paid per ad): one advertiser's search, YouTube,
//   Shopping, Maps and Play ads in any country, by advertiser id, website or name.
// - TikTok: a brand's own ads only where they ran in Europe, from the Commercial Content API (by
//   application) or TikTok's Ad Library through Apify (paid); or Creative Center "Top Ads" through Apify
//   (by keyword and country, never by brand).
// Which sources run is the owner's choice in Settings > Research sources (`install.settings.research`,
// _shared/research-sources.ts), each only with its key saved; the older environment switches
// RESEARCH_TIKTOK and RESEARCH_META_APIFY_ACTOR still win where set. plan.ts decides what a collection
// does and what it costs at most; the studio shows that before anything paid starts.
//
// Pulls are logged in `ad_pulls`; an Apify pull stays "running" until a `poll` finds its run finished:
// the Research page polls while it's open, and the `research-pulls` cron watchdog calls `poll-tick`
// (with the worker secret) while any pull runs, so it also finishes with the page closed. A finished
// pull queues its ads' media files like an import does.
// `decode` asks the AI judge to read one ad like an organic post (format, hook, each line's job). `decode-new`
// reads every new ad in the background (the studio asks after an import or a pull, and when the
// Research page opens): one run at a time per product, restarting itself through `decode-tick` while
// ads are left. A video the scan transcribed is read from what's said, not only its copy.
// `scan` asks OpenAI to read one ad's image and text for the Recreate tool: what is brand-specific, the
// on-image text, the style, and copy in the same style for our product. A video is read as a video: key
// frames the browser took from the stored copy (kept in `ad-media` under <product>/scan-frames/), its
// audio through OpenAI's speech-to-text, and from both a shot list, the hook, pacing and voiceover.
// `template-analyze` asks OpenAI to read an ad uploaded to a product's Playground template library
// (product_templates): its layout, on-image text slots, the brands to keep out and what it's for
// (best for, angle, the product kinds it fits, how to adapt it) (templates.ts).
// Media: an import queues every creative file of its ads (`paid_ad_media`); the `media-tick` worker
// (woken by the import, by itself while work is left, and by the `research-media` cron watchdog) copies
// them from the Ad Library's expiring links into the `ad-media` bucket. `media-status` counts them and
// `media-clear` deletes them (files and rows); `competitor-delete` takes a competitor off the list with its
// ads, their files and its import history.
import { createClient } from "@supabase/supabase-js";
import {
  AD_FORMATS, adToReel, creativeKey, daysRunning, formatSeed, fromGoogleAd, fromMetaApi, fromMetaLibrary, fromMetaMcp, fromTikTokEuAd, fromTikTokLibrary, fromTikTokTopAd,
  GOOGLE_APIFY_ACTOR, googleAdsInput, META_APIFY_ACTORS, metaAdLibraryUrl, metaApifyInput, TIKTOK_APIFY_ACTORS, TIKTOK_LIBRARY, tiktokEuInput, tiktokTopAdsInput,
  tiktokLibraryQuery, tiktokTokenBody, type AdSource, type PaidAd,
} from "../radar/engine/adlibrary.ts";
import { apifyRunLimits, LIMITS, makePlan as planFor, pageIdFrom, planAnswer, runEstimate } from "./plan.ts";
import { giveUpPulls, NO_APIFY_MESSAGE } from "./pulls.ts";
import { claimPatch, DECODE_MAX_ATTEMPTS, drainLanes, successPatch } from "./decode_retry.ts";
import { onSources, readResearch, resolveSources, type ResolvedSources, tiktokSwitch } from "../_shared/research-sources.ts";
import { apifyClient, isActive } from "../radar/engine/apify.ts";
import { decoder } from "../radar/engine/decode.ts";
import { LIBRARY } from "../radar/engine/formats.ts";
import { creativeChanges, type CreativeFields } from "./versions.ts";
import { cleanTemplateAnalysis, DEFAULT_TEMPLATE_NAME, isOwnTemplateUpload, responseJson, TEMPLATE_SCHEMA, TEMPLATE_SYSTEM } from "./templates.ts";
import type { ProjectWorkflow } from "../radar/engine/types.ts";
import {
  allowedMediaUrl, extensionFor, failureFor, MEDIA_BUCKET, MEDIA_EXPIRED, MEDIA_MAX_BYTES, mediaFiles, mediaMime, mediaPath, retryDelaySeconds, sha256Hex, urlKey,
  type MediaKind,
} from "./media.ts";
import { cleanAdMedia, MERGE_COLUMNS, mergeAdRow, scanTranscript, scanVideo } from "./rows.ts";
import { accountError, type Judge, JudgeError, keyRefusal } from "../_shared/ai/judge.ts";
import { modelOverrides, resolveModels, TIMED_TRANSCRIBE_MODELS } from "../_shared/ai/models.ts";
import { createJudge, judgeAvailability } from "../_shared/ai/provider.ts";
import { createAuth, HttpError } from "../_shared/auth.ts";
import { addKeyMessage, createKeys, sameSecret } from "../_shared/keys.ts";
import { mediaTimings, resolveLimits, storageQuotaBytes, tooBigNote, uploadMaxBytes, withinWallClock, workWindowMs } from "../_shared/limits.ts";
import { fits, storageErrorText, storageRoom } from "../_shared/storage.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    return keys.default ?? Object.values(keys)[0];
  } catch {
    throw new Error("No service key in the environment.");
  }
}

const db = createClient(SUPABASE_URL, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/research`;
/** Our storage's host: its public files are the only media links besides Meta's and TikTok's CDNs we accept. */
const STORAGE_HOST = new URL(SUPABASE_URL).host;
/** A media link we may save, download or read (media.ts). */
const allowedMedia = (url: unknown) => allowedMediaUrl(url, STORAGE_HOST);

/** Ads kept per watchlist entry and source in one pull (plan.ts). */
const PER_WATCH_LIMIT = LIMITS.meta;
const META_API_PAGES = LIMITS.metaApiPages;
/** Creative Center top ads read per TikTok watchlist entry. */
const TOP_ADS_LIMIT = LIMITS.tiktokTopAds;

class UserError extends Error {}
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 400);

// MARK: Keys and switches

/** Every key comes from the shared reader (edge function secret first, then Vault). */
const secrets = createKeys(db);
const auth = createAuth(db);

/** API keys: from the shared reader. */
const KEY_NAMES = ["META_AD_LIBRARY_TOKEN", "APIFY_TOKEN", "TIKTOK_RESEARCH_CLIENT_KEY", "TIKTOK_RESEARCH_CLIENT_SECRET", "OPENAI_API_KEY"] as const;
/** Plain switches (no secret in them): edge function environment only. */
const SWITCH_NAMES = ["RESEARCH_TIKTOK", "RESEARCH_META_APIFY_ACTOR"] as const;
type Keys = Partial<Record<(typeof KEY_NAMES)[number] | (typeof SWITCH_NAMES)[number], string>>;

/** The keys and switches this function uses, as one object. */
async function keys(): Promise<Keys> {
  const found: Keys = {};
  for (const name of KEY_NAMES) {
    const value = await secrets.get(name);
    if (value) found[name] = value;
  }
  for (const name of SWITCH_NAMES) {
    const value = Deno.env.get(name)?.trim();
    if (value) found[name] = value;
  }
  return found;
}

/** The install's settings; undefined on an install from before setup existed (no install row). */
const installSettings = async () => (await auth.install())?.settings;

/** What decides which AI answers: the keys and the install's settings (_shared/ai/provider.ts). */
const aiChoice = async () => ({ keys: secrets, settings: await installSettings() });

/** The judge that reads ads: OpenAI, or TypeSafe when Settings choose it. A missing key reads as it is. */
async function aiJudge(): Promise<Judge> {
  try {
    return await createJudge(await aiChoice());
  } catch (error) {
    if (error instanceof JudgeError && error.kind === "config") throw new UserError(`Ads can't be read yet. ${error.message}`);
    throw error;
  }
}

/** The model for each step: an environment variable or stored key, else Settings > Models, else the default. */
const models = async () => resolveModels((await installSettings())?.models, await modelOverrides(secrets));

/**
 * What the Supabase plan allows (_shared/limits.ts): Settings > Limits, an environment variable when
 * set, and the numbers this function always used on an install with no install row.
 */
const planLimits = async () => resolveLimits(await auth.install(), (name) => Deno.env.get(name));

/** The media worker's secret: Vault only (RESEARCH_WORKER_SECRET, generated in the database). */
async function workerSecret(): Promise<string | null> {
  return (await secrets.get("RESEARCH_WORKER_SECRET")) ?? null;
}

/**
 * Which sources a pull uses (_shared/research-sources.ts): Settings > Research sources, each only with
 * its keys saved; RESEARCH_TIKTOK and RESEARCH_META_APIFY_ACTOR win where they are set.
 */
async function sourcesFor(k: Keys): Promise<ResolvedSources> {
  return resolveSources(readResearch((await installSettings())?.research), (name) => Boolean(k[name as keyof Keys]), {
    RESEARCH_TIKTOK: k.RESEARCH_TIKTOK, RESEARCH_META_APIFY_ACTOR: k.RESEARCH_META_APIFY_ACTOR,
  });
}
/** The older name for TikTok's mode, which health still reports: the library, Top Ads, or off. */
const tiktokMode = (r: ResolvedSources, k: Keys) =>
  tiktokSwitch(k) ?? (r.sources.tiktokLibrary.on || r.sources.tiktokEu.on ? "library" : r.sources.tiktokTopAds.on ? "creative_center" : "off");
/** The Meta actor's key in META_APIFY_ACTORS: the community actor ($0.75 per 1,000 ads) or Apify's own ($5.80). */
const metaActorKey = (r: ResolvedSources): keyof typeof META_APIFY_ACTORS => (r.metaActor === "official" ? "official" : "curious");

// MARK: HTTP

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/** The signed-in caller's user id; 403 unless this install lets them in. */
async function signedInUser(req: Request): Promise<string> {
  return (await auth.member(req)).id;
}

async function requireWorker(req: Request) {
  const secret = await workerSecret();
  if (!secret || !sameSecret(req.headers.get("x-research-worker") ?? "", secret)) throw new HttpError(403, "Forbidden");
}

async function body(req: Request): Promise<Record<string, any>> {
  try { return await req.json(); } catch { return {}; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const route = new URL(req.url).pathname.replace(/\/+$/, "").split("/").pop();
  try {
    // Health is booleans only, so the studio's status panel can read it without a session.
    if (route === "health") return json(await health());
    if (route === "media-tick") {
      await requireWorker(req);
      EdgeRuntime.waitUntil(drainMedia().catch((error) => console.error("media-tick", error)));
      return json({ accepted: true }, 202);
    }
    if (route === "decode-tick") {
      await requireWorker(req);
      const input = await body(req);
      const user = String(input.user ?? ""), productId = String(input.productId ?? "");
      if (!/^[0-9a-f-]{36}$/.test(user) || !/^[0-9a-f-]{36}$/.test(productId)) throw new HttpError(400, "Which product?");
      EdgeRuntime.waitUntil(drainDecodes(user, productId).catch((error) => console.error("decode-tick", errorText(error))));
      return json({ accepted: true }, 202);
    }
    if (route === "poll-tick") {
      await requireWorker(req);
      EdgeRuntime.waitUntil(pollAll().catch((error) => console.error("poll-tick", errorText(error))));
      return json({ accepted: true }, 202);
    }
    const user = await signedInUser(req);
    const input = req.method === "POST" ? await body(req) : {};
    switch (route) {
      case "plan": return json(await plan(user, String(input.productId ?? ""), watchIds(input.watchIds)));
      case "pull": return json(await pull(user, String(input.productId ?? ""), Boolean(input.spend), watchIds(input.watchIds)));
      case "poll": return json(await poll(user, String(input.productId ?? "")));
      case "import": return json(await importMcp(user, String(input.productId ?? ""), input));
      case "import-local": return json(await importLocal(user, String(input.productId ?? ""), input));
      case "decode": return json(await decode(user, String(input.adId ?? "")));
      case "decode-new": return json(await decodeNew(user, String(input.productId ?? "")));
      case "scan": return json(await scan(user, String(input.adId ?? ""), input.force === true, input.frames, input.duration));
      case "template-analyze": {
        const result = await templateAnalyze(user, String(input.productId ?? ""), String(input.templateId ?? ""), input.wait === true);
        return json(result, result.status === "analyzing" ? 202 : 200);
      }
      case "media-status": return json(await mediaStatus(user, String(input.productId ?? "")));
      case "media-preview": return json(await mediaPreview(user, String(input.productId ?? ""), input));
      case "media-clear": return json(await mediaClear(user, String(input.productId ?? ""), typeof input.pageId === "string" ? input.pageId : null));
      case "competitor-delete": return json(await competitorDelete(user, String(input.productId ?? ""), String(input.watchId ?? "")));
      default: return json({ error: "Not found" }, 404);
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof UserError) return json({ error: error.message }, 400);
    // A refused AI key reads as itself ("OpenAI refused the key: … Check Settings > API keys.").
    const refused = accountError(error);
    if (refused) return json({ error: refused.message }, 400);
    console.error(error);
    return json({ error: `Something went wrong: ${errorText(error)}` }, 500);
  }
});

/** The competitors a plan or pull is for (watchlist ids), or null for every followed one. */
function watchIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id)).slice(0, 200);
  return ids.length ? ids : null;
}

async function health() {
  const k = await keys();
  const resolved = await sourcesFor(k);
  const ai = await judgeAvailability(await aiChoice());
  return {
    metaApi: Boolean(k.META_AD_LIBRARY_TOKEN),
    apify: Boolean(k.APIFY_TOKEN),
    // The name the app has always read for "the AI that reads ads is connected": true with an OpenAI
    // key, or a TypeSafe key when that provider is chosen.
    jev: ai.ok,
    ai: ai.ok,
    aiProvider: ai.ok ? ai.provider : null,
    limits: await planLimits(),
    openai: Boolean(k.OPENAI_API_KEY),
    tiktok: tiktokMode(resolved, k),
    tiktokLibrary: Boolean(k.TIKTOK_RESEARCH_CLIENT_KEY && k.TIKTOK_RESEARCH_CLIENT_SECRET),
    // Which collection sources are on now, and the Meta actor (Settings > Research sources).
    sources: onSources(resolved),
    metaActor: resolved.metaActor,
    mediaWorker: Boolean(await workerSecret()),
  };
}

// MARK: Workspace and watchlist

interface WatchRow {
  id: string; user_id: string; product_id: string; name: string; network: "meta" | "tiktok" | "google";
  page_id: string | null; page_url: string | null; search_terms: string | null; tiktok_advertiser_id: string | null;
  countries: string[]; enabled: boolean;
  /** The competitor's site (Google ads by domain), Google advertiser id (AR…) and TikTok business name (migration 20261119140000). */
  website?: string | null; google_advertiser_id?: string | null; tiktok_business_name?: string | null;
  /** Our own Page: its ads are saved as ours (Research → Our ads). */
  is_own?: boolean;
}

async function ownProduct(user: string, productId: string) {
  if (!/^[0-9a-f-]{36}$/.test(productId)) throw new HttpError(400, "Which workspace?");
  const { data } = await db.from("products").select("id, user_id, name, description").eq("id", productId).eq("user_id", user).maybeSingle();
  if (!data) throw new HttpError(404, "This workspace doesn't exist.");
  return data as { id: string; user_id: string; name: string; description: string };
}

async function watchlist(productId: string, withPaused = false): Promise<WatchRow[]> {
  let query = db.from("ad_watchlist").select("*").eq("product_id", productId);
  if (!withPaused) query = query.eq("enabled", true);
  const { data } = await query;
  return (data ?? []) as WatchRow[];
}

/** What a pull would do with the current sources and watchlist, and the most it could cost (plan.ts). */
async function makePlan(productId: string, k: Keys, ids: string[] | null) {
  const resolved = await sourcesFor(k);
  const p = planFor(await watchlist(productId, Boolean(ids)), resolved, { watchIds: ids });
  if (p.metaApify.length && !k.APIFY_TOKEN) p.notes.push(`US and other non-EU ads can't be pulled yet. ${addKeyMessage("APIFY_TOKEN")}`);
  return { p, resolved };
}

async function plan(user: string, productId: string, ids: string[] | null) {
  await ownProduct(user, productId);
  const { p, resolved } = await makePlan(productId, await keys(), ids);
  return { ...planAnswer(p), sourcesOn: onSources(resolved), metaActor: resolved.metaActor };
}

// MARK: Saving ads

function toRow(ad: PaidAd, o: { user: string; productId: string; watch?: WatchRow | null }) {
  const now = new Date().toISOString();
  return {
    user_id: o.user, product_id: o.productId, watch_id: o.watch?.id ?? null,
    network: ad.network, source: ad.source, ad_id: ad.adId, page_id: ad.pageId, page_name: ad.pageName.slice(0, 200),
    competitor: (o.watch?.name ?? ad.competitor ?? ad.pageName).slice(0, 120),
    started_at: ad.startedAt, stopped_at: ad.stoppedAt, active: ad.active, placements: ad.placements, media_type: ad.mediaType,
    body: ad.body.slice(0, 5000), headline: ad.headline.slice(0, 500), description: ad.description.slice(0, 1000), cta: ad.cta.slice(0, 80),
    link_url: ad.linkUrl, media: ad.media.slice(0, 10), thumb: ad.thumb, snapshot_url: ad.snapshotUrl,
    countries: ad.countries, languages: ad.languages, collation_id: ad.collationId, variants: ad.variants,
    creative_key: creativeKey(ad).slice(0, 400), reach: ad.reach, metrics: ad.metrics ?? null, last_seen_at: now,
    library: ad.library ?? null,
  };
}

/** The stored columns an edit check reads (versions.ts), a replaced version keeps, and a merge (rows.ts) reads. */
const STORED_COLUMNS = [...new Set([
  ..."id, network, ad_id, media_type, body, headline, description, cta, link_url, media, thumb, first_seen_at, last_seen_at, creative_changed_at".split(", "),
  ...MERGE_COLUMNS.split(", "),
])].join(", ");
type StoredVersion = CreativeFields & { id: string; network: string; ad_id: string; thumb: string | null; first_seen_at: string; last_seen_at: string; creative_changed_at: string | null } & Record<string, any>;

/**
 * Upserts ads (a re-pull refreshes them; `first_seen_at`, decodes, scans, library hand-offs and `hidden`
 * are kept). `extra` adds columns only some sources have (the local scraper's impressions rank and
 * measured creative). Each ad is merged with the stored one first (rows.ts): a poorer source never
 * empties what a richer one saved. Media links other than Meta's, Instagram's and TikTok's CDNs (or our
 * storage) are dropped. An ad we already have whose copy, link or media changed (an edit to a running
 * ad) keeps its replaced version in paid_ad_versions and gets `creative_changed_at`; see versions.ts.
 */
async function save(ads: PaidAd[], o: { user: string; productId: string; watchFor: (ad: PaidAd) => WatchRow | null; extra?: (ad: PaidAd) => Record<string, unknown>; stats?: { edited: number } }) {
  type Row = ReturnType<typeof toRow> & { is_own?: boolean; is_video?: boolean; creative_changed_at?: string | null } & Record<string, unknown>;
  const rows = new Map<string, Row>();
  for (const raw of ads) {
    const ad = cleanAdMedia(raw, STORAGE_HOST);
    const watch = o.watchFor(ad);
    // Ours when its watchlist Page is ours (an import can say so itself, in `extra`).
    rows.set(`${ad.network}:${ad.adId}`, { ...toRow(ad, { ...o, watch }), is_own: Boolean(watch?.is_own), ...o.extra?.(ad) });
  }
  const incoming = [...rows.values()];

  // Edits: compare with what's stored. Every row carries creative_changed_at (the stored value when
  // unchanged) and is_video, because an upsert sets a column missing from some rows to null.
  const stored = new Map<string, StoredVersion>();
  const ids = [...new Set(incoming.map((r) => r.ad_id))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("paid_ads").select(STORED_COLUMNS).eq("product_id", o.productId).in("ad_id", ids.slice(i, i + 200));
    if (error) throw new Error(`Couldn't read the saved ads: ${error.message}`);
    for (const row of (data ?? []) as unknown as StoredVersion[]) stored.set(`${row.network}:${row.ad_id}`, row);
  }
  const all: Row[] = incoming.map((row) => mergeAdRow(stored.get(`${row.network}:${row.ad_id}`), row));
  const now = new Date().toISOString();
  const versions: Record<string, unknown>[] = [];
  for (const row of all) {
    const was = stored.get(`${row.network}:${row.ad_id}`);
    if (!was) { row.creative_changed_at = null; continue; }
    const changed = creativeChanges(was, row as unknown as CreativeFields);
    row.creative_changed_at = changed.length ? now : was.creative_changed_at;
    if (!changed.length) continue;
    versions.push({
      user_id: o.user, product_id: o.productId, paid_ad_id: was.id, changed,
      body: was.body, headline: was.headline, description: was.description, cta: was.cta, link_url: was.link_url,
      media: was.media ?? [], thumb: was.thumb, seen_from: was.creative_changed_at ?? was.first_seen_at, seen_until: was.last_seen_at, replaced_at: now,
    });
  }

  for (let i = 0; i < all.length; i += 200) {
    const { error } = await db.from("paid_ads").upsert(all.slice(i, i + 200), { onConflict: "product_id,network,ad_id" });
    if (error) throw new Error(`Couldn't save ads: ${error.message}`);
  }
  if (o.stats) o.stats.edited += versions.length;
  // The replaced versions. Losing them doesn't undo the import (the ads are saved and stamped).
  for (let i = 0; i < versions.length; i += 200) {
    const { error } = await db.from("paid_ad_versions").insert(versions.slice(i, i + 200));
    if (error) console.error("paid_ad_versions", error.message);
  }
  return all.length;
}

/** After a complete pull of a watch entry's active ads, the ones it no longer returned have stopped. */
async function retireMissing(watchId: string, network: string, seenIds: string[], since: string) {
  const { data } = await db.from("paid_ads").select("id, ad_id, last_seen_at").eq("watch_id", watchId).eq("network", network).eq("active", true).lt("last_seen_at", since);
  const gone = (data ?? []).filter((row) => !seenIds.includes(row.ad_id));
  if (gone.length) await db.from("paid_ads").update({ active: false, stopped_at: since }).in("id", gone.map((row) => row.id));
}

/** Matches a scraped ad to the watchlist entry it was pulled for: by Page id, then by name. */
function matcher(list: WatchRow[]) {
  return (ad: PaidAd) => {
    const byPage = list.find((w) => w.page_id && w.page_id === ad.pageId);
    if (byPage) return byPage;
    const page = ad.pageName.toLowerCase();
    return list.find((w) => page.includes(w.name.toLowerCase()) || (w.search_terms && page.includes(w.search_terms.toLowerCase()))) ?? null;
  };
}

// MARK: Pull

async function logPull(user: string, productId: string, source: AdSource, fields: Record<string, unknown>) {
  const { data } = await db.from("ad_pulls").insert({ user_id: user, product_id: productId, source, ...fields }).select("id").single();
  return data?.id as string | undefined;
}

/**
 * Pulls every enabled watchlist entry (or the competitors in `ids`). Free sources run now; paid ones
 * (Apify) only with `spend`, which the studio sends after the user confirmed the estimate. Apify pulls
 * finish in `poll`. Answers each source's result and the ids of the pulls it logged, so the studio can
 * follow them to the end.
 */
async function pull(user: string, productId: string, spend: boolean, ids: string[] | null = null) {
  await ownProduct(user, productId);
  const k = await keys();
  const { p, resolved } = await makePlan(productId, k, ids);
  const paidCount = p.metaApify.length + p.google.length + p.tiktokEu.length + p.tiktokTopAds.length;
  if (!p.metaApi.length && !p.tiktokLibrary.length && !paidCount) {
    throw new UserError(p.notes[0] ?? p.skipped[0]?.reason ?? "Nothing to collect: turn on a source in Settings > Research sources, or add a competitor.");
  }
  const results: { source: AdSource; watch?: string; ads?: number; started?: boolean; error?: string }[] = [];
  const pullIds: string[] = [];
  const logged = async (source: AdSource, fields: Record<string, unknown>) => {
    const id = await logPull(user, productId, source, fields);
    if (id) pullIds.push(id);
  };

  // Meta Ad Library API: one request chain per entry, EU/UK countries only.
  for (const { watch, countries } of p.metaApi) {
    const since = new Date().toISOString();
    try {
      const ads: PaidAd[] = [];
      let url: string | null = metaAdLibraryUrl({ pageIds: watch.page_id ? [watch.page_id] : undefined, searchTerms: watch.page_id ? undefined : watch.search_terms ?? watch.name, countries, limit: PER_WATCH_LIMIT });
      let complete = true;
      for (let page = 0; url && page < META_API_PAGES; page++) {
        const sep = url.includes("?") ? "&" : "?";
        const response: Response = await fetch(url.includes("access_token=") ? url : `${url}${sep}access_token=${encodeURIComponent(k.META_AD_LIBRARY_TOKEN!)}`, { signal: AbortSignal.timeout(20_000) });
        const data: Record<string, any> = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error?.message ? `Meta: ${String(data.error.message).slice(0, 200)}` : `Meta ${response.status}`);
        for (const raw of data.data ?? []) {
          const ad = fromMetaApi(raw, { countries });
          if (ad) ads.push({ ...ad, competitor: watch.name });
        }
        url = data.paging?.next ?? null;
        if (url && page === META_API_PAGES - 1) complete = false;
      }
      const saved = await save(ads, { user, productId, watchFor: () => watch });
      if (complete && watch.page_id) await retireMissing(watch.id, "meta", ads.map((a) => a.adId), since);
      await logged("meta_api", { status: "done", ads: saved, input: { watch: watch.id, name: watch.name, countries }, finished_at: new Date().toISOString() });
      results.push({ source: "meta_api", watch: watch.id, ads: saved });
    } catch (error) {
      await logged("meta_api", { status: "error", error: errorText(error), input: { watch: watch.id, name: watch.name, countries }, finished_at: new Date().toISOString() });
      results.push({ source: "meta_api", watch: watch.id, error: errorText(error) });
    }
  }

  // TikTok Commercial Content API (ads shown in Europe), when its keys are saved and it's on.
  if (p.tiktokLibrary.length) {
    try {
      if (!k.TIKTOK_RESEARCH_CLIENT_KEY || !k.TIKTOK_RESEARCH_CLIENT_SECRET) throw new Error("TikTok's Commercial Content API isn't connected. Add your TikTok research client key and secret in Settings > API keys.");
      const tokenResponse = await fetch(TIKTOK_LIBRARY.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: tiktokTokenBody(k.TIKTOK_RESEARCH_CLIENT_KEY, k.TIKTOK_RESEARCH_CLIENT_SECRET) });
      const token = (await tokenResponse.json().catch(() => ({})))?.access_token;
      if (!token) throw new Error("TikTok didn't issue a token. Check the Commercial Content API keys and approval.");
      for (const target of p.tiktokLibrary) {
        const { watch } = target;
        try {
          const response = await fetch(`${TIKTOK_LIBRARY.adQuery}?fields=${TIKTOK_LIBRARY.fields}`, {
            method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(tiktokLibraryQuery({ advertiserIds: target.businessId ? [target.businessId] : undefined, searchTerm: target.businessId ? undefined : target.name, country: target.country ?? undefined, max: LIMITS.tiktokLibrary })),
            signal: AbortSignal.timeout(20_000),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data?.error?.code && data.error.code !== "ok") throw new Error(`TikTok: ${String(data?.error?.message ?? response.status).slice(0, 200)}`);
          const ads = (data?.data?.ads ?? []).flatMap((raw: Record<string, unknown>) => { const ad = fromTikTokLibrary(raw, watch.name); return ad ? [ad] : []; });
          const saved = await save(ads, { user, productId, watchFor: () => watch });
          await logged("tiktok_library", { status: "done", ads: saved, input: { watch: watch.id, name: watch.name, country: target.country ?? "ALL" }, finished_at: new Date().toISOString() });
          results.push({ source: "tiktok_library", watch: watch.id, ads: saved });
        } catch (error) {
          await logged("tiktok_library", { status: "error", error: errorText(error), input: { watch: watch.id, name: watch.name }, finished_at: new Date().toISOString() });
          results.push({ source: "tiktok_library", watch: watch.id, error: errorText(error) });
        }
      }
    } catch (error) {
      await logged("tiktok_library", { status: "error", error: errorText(error), finished_at: new Date().toISOString() });
      results.push({ source: "tiktok_library", error: errorText(error) });
    }
  }

  // Paid scrapes start only after the user confirmed the cost.
  if (spend && paidCount) {
    if (!k.APIFY_TOKEN) throw new UserError(`Apify isn't connected. ${addKeyMessage("APIFY_TOKEN")}`);
    const apify = apifyClient(k.APIFY_TOKEN);
    /** Starts one Apify run and logs it as a running pull (the poll finishes it). */
    // Every run starts with Apify's own timeout and a charge cap a small margin above the estimate the
    // person confirmed (plan.ts apifyRunLimits), so a run the app stops following still ends.
    const start = async (source: AdSource, actor: string, input: Record<string, unknown>, extra: Record<string, unknown>, estimate: { usd: number; maxAds: number }, watch?: string) => {
      try {
        const run = await apify.start(actor, input, apifyRunLimits(estimate));
        await logged(source, { apify_run_id: run.id, input: { actor, ...extra } });
        results.push({ source, watch, started: true });
      } catch (error) {
        await logged(source, { status: "error", error: errorText(error), input: { actor, ...extra }, finished_at: new Date().toISOString() });
        results.push({ source, watch, error: errorText(error) });
      }
    };
    if (p.metaApify.length) {
      const actor = metaActorKey(resolved);
      const input = metaApifyInput({ urls: p.metaApify.map((x) => x.url), limitPerUrl: PER_WATCH_LIMIT, actor });
      await start("meta_apify", META_APIFY_ACTORS[actor], input, { urls: p.metaApify.map((x) => ({ watch: x.watch.id, url: x.url })) }, runEstimate(resolved, "metaApify", p.metaApify.length));
    }
    // Google and TikTok's European library: one run per competitor, so each ad is filed under the one it was collected for.
    for (const g of p.google) {
      const input = googleAdsInput({ advertiserId: g.advertiserId, domain: g.domain, name: g.name, country: g.country, max: LIMITS.google });
      await start("google_apify", GOOGLE_APIFY_ACTOR, input, { watch: g.watch.id, by: g.by }, runEstimate(resolved, "google"), g.watch.id);
    }
    for (const t of p.tiktokEu) {
      const input = tiktokEuInput({ businessId: t.businessId, name: t.name, country: t.country, max: LIMITS.tiktokEu });
      await start("tiktok_apify", TIKTOK_APIFY_ACTORS.library, input, { watch: t.watch.id, by: t.by }, runEstimate(resolved, "tiktokEu"), t.watch.id);
    }
    for (const t of p.tiktokTopAds) {
      // Creative Center's best ads for the entry's keyword in its first country, over 30 days.
      const input = tiktokTopAdsInput({ country: t.country, periodDays: 30, keyword: t.keyword, max: TOP_ADS_LIMIT });
      await start("tiktok_creative_center", TIKTOK_APIFY_ACTORS.topAds, input, { watch: t.watch.id, ...input }, runEstimate(resolved, "tiktokTopAds"), t.watch.id);
    }
  }
  return { results, pullIds, pendingPaid: !spend && paidCount > 0, usd: p.usd, skipped: p.skipped };
}

/** Finishes the workspace's Apify pulls whose runs are done (the Research page asks while it's open). */
async function poll(user: string, productId: string) {
  await ownProduct(user, productId);
  const { data: running } = await db.from("ad_pulls").select("*").eq("product_id", productId).eq("status", "running").not("apify_run_id", "is", null);
  if (!running?.length) return { running: 0 };
  const k = await keys();
  // Without a token the pulls fail now with what to add (pulls.ts), instead of staying "running".
  const live = await giveUpPulls(running as PullRow[], pullEnds(k.APIFY_TOKEN));
  if (!k.APIFY_TOKEN) throw new UserError(NO_APIFY_MESSAGE);
  return { running: await finishPulls(k.APIFY_TOKEN, productId, live) };
}

/** A pull claimed by a poll that then stopped (a crashed invocation) can be claimed again after this. */
const PULL_CLAIM_MS = 10 * 60_000;

/** How pulls.ts ends a pull: aborting its run at Apify (with the token) and writing the end while it is still running. */
const pullEnds = (token: string | undefined) => ({
  hasToken: Boolean(token),
  abort: (runId: string) => (token ? apifyClient(token).abort(runId) : Promise.resolve(false)),
  settle: async (id: string, patch: Record<string, unknown>) => { await db.from("ad_pulls").update(patch).eq("id", id).eq("status", "running"); },
});

/**
 * The `research-pulls` cron watchdog's call (with the worker secret): finishes every workspace's Apify
 * pulls whose runs are done, so a pull completes with the Research page closed. A pull past the give-up
 * time is stopped at Apify and marked failed; without an Apify token every running pull fails at once.
 */
async function pollAll() {
  const { data: running } = await db.from("ad_pulls").select("*").eq("status", "running").not("apify_run_id", "is", null).order("started_at").limit(50);
  if (!running?.length) return { running: 0 };
  const k = await keys();
  const live = await giveUpPulls(running as PullRow[], pullEnds(k.APIFY_TOKEN));
  if (!k.APIFY_TOKEN || !live.length) return { running: 0 };
  const byProduct = new Map<string, PullRow[]>();
  for (const row of live) byProduct.set(row.product_id, [...(byProduct.get(row.product_id) ?? []), row]);
  let still = 0;
  for (const [productId, rows] of byProduct) {
    still += await finishPulls(k.APIFY_TOKEN, productId, rows).catch((error) => {
      console.error("poll-tick", productId, errorText(error));
      return rows.length;
    });
  }
  return { running: still };
}

/** One item of a finished Apify run, read the way its source writes it. */
function mapItem(source: AdSource, raw: Record<string, any>, competitor: string | null): PaidAd | null {
  if (source === "tiktok_creative_center") return fromTikTokTopAd(raw);
  if (source === "google_apify") return fromGoogleAd(raw, competitor);
  if (source === "tiktok_apify") return fromTikTokEuAd(raw, competitor);
  return fromMetaLibrary(raw);
}

interface PullRow { id: string; user_id: string; product_id: string; source: AdSource; apify_run_id: string; input: Record<string, any> | null; finished_at: string | null; started_at: string | null }

/**
 * Reads the ads of each finished run and saves them, then queues their media files for storage. A pull
 * is claimed first (its finished_at is stamped while it is still running), so the page's poll and the
 * watchdog never save one twice. Returns how many are still running.
 */
async function finishPulls(apifyToken: string, productId: string, running: PullRow[]): Promise<number> {
  const apify = apifyClient(apifyToken);
  const list = await watchlist(productId, true);
  const match = matcher(list);
  let still = 0;
  for (const row of running) {
    const user = row.user_id;
    try {
      const run = await apify.get(row.apify_run_id);
      if (isActive(run.status)) { still++; continue; }
      const stale = new Date(Date.now() - PULL_CLAIM_MS).toISOString();
      const { data: claimed } = await db.from("ad_pulls").update({ finished_at: new Date().toISOString() })
        .eq("id", row.id).eq("status", "running").or(`finished_at.is.null,finished_at.lt.${stale}`).select("id");
      if (!claimed?.length) continue;
      if (run.status !== "SUCCEEDED") throw new Error(`The scrape ended ${run.status.toLowerCase()}${run.statusMessage ? `: ${run.statusMessage}` : ""}`);
      const items = await apify.items<Record<string, unknown>>(run.defaultDatasetId);
      const files: QueuedFile[] = [];
      const pulledFor = list.find((w) => w.id === row.input?.watch);
      const ads = items.flatMap((raw) => {
        const ad = mapItem(row.source, raw as Record<string, any>, pulledFor?.name ?? null);
        if (!ad) return [];
        for (const file of mediaFiles({ raw: row.source === "meta_apify" ? raw : null, media: ad.media, thumb: ad.thumb })) files.push({ ...file, pageId: ad.pageId });
        return [ad];
      });
      const saved = await save(ads, { user, productId, watchFor: pulledFor ? () => pulledFor : match });
      await db.from("ad_pulls").update({ status: "done", ads: saved, usd: Number(run.usageTotalUsd ?? 0), finished_at: new Date().toISOString() }).eq("id", row.id);
      // Like an import: the files go to storage in the background, before Meta's links expire.
      // A failure here doesn't undo the pull.
      try {
        const media = await enqueueMedia(user, productId, files);
        if (media.queued) EdgeRuntime.waitUntil(wakeMedia());
      } catch (error) {
        console.error("enqueue media", errorText(error));
      }
    } catch (error) {
      await db.from("ad_pulls").update({ status: "error", error: errorText(error), finished_at: new Date().toISOString() }).eq("id", row.id);
    }
  }
  return still;
}

/**
 * Saves ads from the Meta Ads MCP's `ads_library_search` (free; newest 50 per query, no media or
 * end dates). `payload` is the tool's raw answer; `watchId` ties them to a watchlist entry.
 */
async function importMcp(user: string, productId: string, input: Record<string, any>) {
  await ownProduct(user, productId);
  const countries = (Array.isArray(input.countries) ? input.countries : []).map((c: unknown) => String(c).toUpperCase().slice(0, 2));
  const ads = fromMetaMcp(input.payload, countries);
  if (!ads.length) throw new UserError("No ads found in that answer.");
  const list = await watchlist(productId);
  const watch = list.find((w) => w.id === input.watchId) ?? null;
  const saved = await save(ads, { user, productId, watchFor: watch ? () => watch : matcher(list) });
  await logPull(user, productId, "meta_mcp", { status: "done", ads: saved, input: { countries, watch: watch?.name ?? null }, finished_at: new Date().toISOString() });
  return { ads: saved };
}

// MARK: Local scraper import

const LOCAL_SCHEMA = "radar.meta-ad-library/v1";
/** Ads one request saves at most (the studio sends a big file in batches of a few hundred). */
const LOCAL_MAX_REQUEST_ADS = 1000;
/** Library IDs a batched import's last batch may list (a sanity limit; the biggest advertisers run ~9,000 ads). */
const LOCAL_MAX_FILE_ADS = 20_000;
/** A batched import's later batches must come within this long of its first one. */
const LOCAL_IMPORT_WINDOW_MS = 24 * 3_600_000;
const LOCAL_MEDIA_TYPES: Record<string, PaidAd["mediaType"]> = { VIDEO: "video", IMAGE: "image", CAROUSEL: "carousel", DCO: "dco" };
const LOCAL_PLACEMENTS = ["stories_reels", "feed_vertical", "square", "landscape"];

const text = (value: unknown, max = 500) => (typeof value === "string" ? value.trim().slice(0, max) : typeof value === "number" ? String(value) : "");
const positive = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);
const httpUrl = (value: unknown) => (typeof value === "string" && /^https:\/\//.test(value) ? value.slice(0, 2000) : null);

/** The scraper's measured creative, kept small and typed: card count, nearest placement, each media's size (links on allowed hosts only). */
function localCreative(creative: Record<string, any> | null | undefined, nearest: unknown) {
  const media = (Array.isArray(creative?.media) ? creative!.media : []).slice(0, 20).flatMap((m: Record<string, any>) => {
    const url = httpUrl(m?.url);
    if (!url || !allowedMedia(url) || (m.type !== "video" && m.type !== "image")) return [];
    const width = positive(m.width), height = positive(m.height), duration = positive(m.duration_sec);
    const poster = httpUrl(m.thumbnail_url);
    return [{
      type: m.type, url, thumbnail_url: poster && allowedMedia(poster) ? poster : null,
      width: width && Math.round(width), height: height && Math.round(height),
      duration_sec: duration && Math.round(duration * 10) / 10, aspect: text(m.aspect, 12) || null,
    }];
  });
  const cards = positive(creative?.card_count);
  const placement = LOCAL_PLACEMENTS.includes(String(nearest)) ? String(nearest) : null;
  return { card_count: cards ? Math.round(cards) : null, nearest_placement: placement, media };
}

/** The scraper's `run_safety` block, validated and kept small (counts, at most 8 overrides and 10 warnings). */
function localRunSafety(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const count = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.min(Math.round(x), 100_000) : null);
  const list = (x: unknown, n: number, max: number) => (Array.isArray(x) ? x : []).map((item) => text(item, max)).filter(Boolean).slice(0, n);
  return {
    runs_today: count(v.runs_today) ?? 0,
    minutes_since_previous_run: count(v.minutes_since_previous_run),
    concurrent_runs: count(v.concurrent_runs) ?? 0,
    overrides: list(v.overrides, 8, 40),
    warnings: list(v.warnings, 10, 300),
  };
}

/** A scraper item without `raw`: its normalized fields, spelled the way `fromMetaLibrary` reads the Ad Library. */
function localAsRaw(item: Record<string, any>, advertiser: Record<string, any>): Record<string, any> {
  const media: Record<string, any>[] = Array.isArray(item.creative?.media) ? item.creative.media : [];
  return {
    ad_archive_id: item.library_id, collation_id: item.collation_id, collation_count: item.collation_count,
    is_active: /^active$/i.test(text(item.status)), start_date: item.start_date, end_date: item.end_date,
    publisher_platform: item.platforms, page_id: advertiser.page_id, page_name: advertiser.page_name,
    snapshot: {
      display_format: item.display_format || item.creative_type, body: { text: text(item.primary_text, 5000) },
      title: item.headline, link_description: item.description, cta_text: item.cta, link_url: item.destination_url,
      videos: media.filter((m) => m?.type === "video").map((m) => ({ video_hd_url: m.url, video_preview_image_url: m.thumbnail_url })),
      images: media.filter((m) => m?.type === "image").map((m) => ({ original_image_url: m.url })),
    },
  };
}

/**
 * One request of a batched import (the studio splits a big file; each request carries the file's header
 * and a slice of its ads). Batches go one after another; `since` is what the first one answered,
 * `ids` (last batch only) every Library ID in the file, `saved` how many ads the earlier batches saved,
 * `attempt` 1 or 2 (the studio retries a failed batch once).
 */
interface ImportBatch { id: string; index: number; count: number; since: string | null; ids: string[] | null; saved: number; truncated: boolean; attempt: number }

function importBatch(value: unknown): ImportBatch | null {
  if (value == null) return null;
  const v = (typeof value === "object" ? value : {}) as Record<string, unknown>;
  const int = (x: unknown, min: number, max: number) => (typeof x === "number" && Number.isInteger(x) && x >= min && x <= max ? x : null);
  const id = typeof v.id === "string" && /^[\w-]{8,64}$/.test(v.id) ? v.id : null;
  const count = int(v.count, 1, 1000);
  const index = int(v.index, 0, 999);
  if (!id || count === null || index === null || index >= count) throw new UserError("That import's batch is malformed. Reload the page and import the file again.");
  // The first batch's answer, sent back: a real time, not ahead of now nor older than the import window.
  const at = typeof v.since === "string" ? Date.parse(v.since) : NaN;
  const since = !Number.isNaN(at) && at <= Date.now() + 60_000 && Date.now() - at <= LOCAL_IMPORT_WINDOW_MS ? new Date(at).toISOString() : null;
  const ids = Array.isArray(v.ids) ? v.ids.map((x) => text(x, 64)).filter(Boolean) : null;
  return { id, index, count, since, ids, saved: int(v.saved, 0, 1_000_000) ?? 0, truncated: v.truncated === true, attempt: int(v.attempt, 1, 9) ?? 1 };
}

/**
 * Saves one advertiser's ads from the local Ad Library scraper's file (schema radar.meta-ad-library/v1).
 * Matches the advertiser's Page to a watchlist entry (or adds one with `createWatch`), keeps Meta's
 * impressions order and the measured creative, and after a complete scrape of the Page marks its ads
 * that were live here but absent from the file as stopped.
 *
 * A big file comes in batches (`input.batch`, see ImportBatch); a request without one is the whole file,
 * as older studios send it. Per file, not per batch: the watchlist entry is added or updated by the first
 * batch only; only the last batch marks ads as stopped, against every Library ID in the file and only
 * among ads this import didn't touch (last seen before the first batch began); the run is logged once,
 * by the last batch (or by a batch that failed for good).
 */
async function importLocal(user: string, productId: string, input: Record<string, any>) {
  await ownProduct(user, productId);
  const file = input.file as Record<string, any> | null;
  if (!file || typeof file !== "object") throw new UserError("Choose the scraper's .json file.");
  if (file.schema !== LOCAL_SCHEMA) throw new UserError(`That isn't a file from the local scraper (expected "${LOCAL_SCHEMA}").`);
  const advertiser: Record<string, any> = file.advertiser && typeof file.advertiser === "object" ? file.advertiser : {};
  const pageId = /^\d{3,30}$/.test(text(advertiser.page_id, 40)) ? text(advertiser.page_id, 40) : null;
  const pageName = text(advertiser.page_name, 120);
  const items: Record<string, any>[] = (Array.isArray(file.ads) ? file.ads : []).filter((a: unknown) => a && typeof a === "object");
  if (!items.length) throw new UserError("The file has no ads.");
  const truncated = items.length > LOCAL_MAX_REQUEST_ADS;
  const batch = importBatch(input.batch);
  const first = !batch || batch.index === 0;
  const last = !batch || batch.index === batch.count - 1;
  // "Our ads": the import says these are the product's own ads (else they're a competitor's).
  const own = input.own === true;

  // The watchlist entry: the one picked, else the one for this Page (or with this name), else a new one.
  const { data: entries } = await db.from("ad_watchlist").select("*").eq("product_id", productId).eq("network", "meta");
  const all = (entries ?? []) as WatchRow[];
  let watch = all.find((w) => w.id === input.watchId)
    ?? (pageId ? all.find((w) => w.page_id === pageId || pageIdFrom(w.page_url) === pageId) : undefined)
    ?? (pageName ? all.find((w) => w.name.toLowerCase() === pageName.toLowerCase()) : undefined)
    ?? null;
  let watchCreated = false;
  if (first && watch && ((pageId && !watch.page_id) || Boolean(watch.is_own) !== own)) {
    await db.from("ad_watchlist").update({ ...(pageId && !watch.page_id ? { page_id: pageId } : {}), is_own: own }).eq("id", watch.id);
    watch = { ...watch, page_id: watch.page_id ?? pageId, is_own: own };
  }
  const pageUrl = httpUrl(advertiser.page_url)?.match(/^https:\/\/(www\.|m\.)?facebook\.com\//) ? httpUrl(advertiser.page_url) : null;
  if (first && !watch && input.createWatch === true && (pageId || pageUrl)) {
    const country = (() => { try { return new URL(String(file.input_url)).searchParams.get("country")?.toUpperCase() ?? ""; } catch { return ""; } })();
    const { data, error } = await db.from("ad_watchlist").insert({
      user_id: user, product_id: productId, name: pageName || `Page ${pageId}`, network: "meta", page_id: pageId, page_url: pageUrl,
      countries: /^[A-Z]{2}$/.test(country) ? [country] : ["US"], is_own: own,
    }).select().single();
    if (error) throw new Error(`Couldn't add ${pageName || "the advertiser"} to the watchlist: ${error.message}`);
    watch = data as WatchRow;
    watchCreated = true;
  }
  const competitor = watch?.name ?? (pageName || null);

  const ads: PaidAd[] = [];
  const extras = new Map<string, Record<string, unknown>>();
  const files: QueuedFile[] = [];
  for (const item of items.slice(0, LOCAL_MAX_REQUEST_ADS)) {
    const raw = item.raw && typeof item.raw === "object" ? item.raw : null;
    let ad = raw ? fromMetaLibrary(raw, { source: "meta_local", competitor }) : null;
    ad ??= fromMetaLibrary(localAsRaw(item, advertiser), { source: "meta_local", competitor });
    if (!ad || extras.has(ad.adId)) continue;
    // The scraper's own reading wins where Meta's JSON is ambiguous (a DCO ad has several cards, not a carousel).
    const kind = LOCAL_MEDIA_TYPES[text(item.creative_type).toUpperCase()];
    ad = {
      ...ad,
      pageId: ad.pageId ?? pageId,
      pageName: ad.pageName === "Unknown advertiser" && pageName ? pageName : ad.pageName,
      ...(kind ? { mediaType: kind } : {}),
    };
    ads.push(ad);
    const rank = positive(item.impressions_rank);
    const creative = localCreative(item.creative, item.nearest_placement);
    extras.set(ad.adId, { impressions_rank: rank ? Math.round(rank) : null, creative, is_own: own });
    for (const file of mediaFiles({ creative, raw, media: ad.media, thumb: ad.thumb })) files.push({ ...file, pageId: ad.pageId });
  }
  if (!ads.length) throw new UserError("None of the file's ads had a Library ID.");

  // What the Research page's "Scraper safety" card reads: when the run started, how it ended, its safety block.
  // A batched file is complete when its last batch says so, with every Library ID and none of it cut.
  const fileIds = batch?.ids ?? null;
  const whole = !batch || (last && !batch.truncated && fileIds !== null && fileIds.length > 0 && fileIds.length <= LOCAL_MAX_FILE_ADS);
  const meta = {
    page_id: pageId, page_name: pageName || null, scraped_at: text(file.scraped_at, 40) || null, complete: file.complete === true && !truncated && whole,
    stopped_reason: text(file.stopped_reason, 300) || null, run_safety: localRunSafety(file.run_safety),
    ...(batch ? { import: { id: batch.id, batches: batch.count } } : {}),
  };
  try {
    // Which ads are new here, for the summary.
    const known = new Set<string>();
    const ids = ads.map((a) => a.adId);
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from("paid_ads").select("ad_id").eq("product_id", productId).eq("network", "meta").in("ad_id", ids.slice(i, i + 200));
      for (const row of data ?? []) known.add(row.ad_id);
    }
    const now = new Date().toISOString();
    // When this import began: every ad it saves (in any batch) is last seen at or after it.
    const since = first ? now : batch!.since;
    const stats = { edited: 0 };
    const saved = await save(ads, { user, productId, watchFor: () => watch, extra: (ad) => extras.get(ad.adId) ?? {}, stats });

    // A complete scrape of the Page's ads (every format): the ones it no longer shows have stopped.
    // Only the last batch looks, and only at ads this import didn't save that aren't in the file either.
    let retired = 0;
    const scope = (() => { try { return new URL(String(file.input_url)).searchParams; } catch { return null; } })();
    const wholePage = scope && (scope.get("media_type") ?? "all") === "all" && (scope.get("view_all_page_id") === pageId || scope.get("search_type") === "page");
    if (last && meta.complete && pageId && wholePage && since) {
      const seen = new Set([...ids, ...(fileIds ?? [])]);
      const { data } = await db.from("paid_ads").select("id, ad_id").eq("product_id", productId).eq("network", "meta").eq("page_id", pageId).eq("active", true).lt("last_seen_at", since);
      const gone = (data ?? []).filter((row) => !seen.has(row.ad_id)).map((row) => row.id);
      for (let i = 0; i < gone.length; i += 200) await db.from("paid_ads").update({ active: false, stopped_at: now }).in("id", gone.slice(i, i + 200));
      retired = gone.length;
    }
    if (last) await logPull(user, productId, "meta_local", { status: "done", ads: saved + (batch?.saved ?? 0), input: meta, finished_at: new Date().toISOString() });
    const created = ads.filter((a) => !known.has(a.adId)).length;
    // The ads are in; their files go to storage in the background. A failure here doesn't undo the import.
    // A worker keeps going while files wait, so a batched import wakes one now and then, not every batch.
    let media: { queued: number; stored: number; error?: string } = { queued: 0, stored: 0 };
    try {
      const holdId = typeof input.holdId === "string" && /^[0-9a-f-]{36}$/.test(input.holdId) ? input.holdId : null;
      const { data: hold } = holdId ? await db.from("research_media_holds").select("holds").eq("hold_id", holdId).eq("user_id", user).maybeSingle() : { data: null };
      media = await enqueueMedia(user, productId, files, (hold?.holds as Record<string, string> | undefined) ?? null);
      if (media.queued && (first || last || batch!.index % 5 === 0)) EdgeRuntime.waitUntil(wakeMedia());
    } catch (error) {
      console.error("enqueue media", error);
      media = { queued: 0, stored: 0, error: errorText(error) };
    }
    return {
      ads: saved, created, updated: saved - created, edited: stats.edited, retired, watchId: watch?.id ?? null, watchCreated, truncated,
      mediaQueued: media.queued, mediaStored: media.stored, ...(media.error ? { mediaError: media.error } : {}),
      ...(batch ? { since, batch: { id: batch.id, index: batch.index, count: batch.count, last } } : {}),
    };
  } catch (error) {
    // A batch the studio will retry isn't logged; the run is logged once when it fails for good.
    if (!batch || batch.attempt >= 2) {
      await logPull(user, productId, "meta_local", { status: "error", error: errorText(error), input: meta, finished_at: new Date().toISOString() });
    }
    throw error;
  }
}

// MARK: Decode

/** Ads decoded at once (radar's runs use 8 for organic posts). */
const DECODE_LANES = 6;
/** A run stops claiming ads after this and, if any are left, starts the next run itself. */
const DECODE_RUN_MS = 60_000;
/** An ad claimed this long ago and still not decoded (its run stopped) can be claimed again; a failed try waits per decode_retry.ts. */
const DECODE_CLAIM_MS = 15 * 60_000;
/** Claims newer than this mean a run for the product is going now, so a kick doesn't start another. */
const DECODE_BUSY_MS = 90_000;

/**
 * The AI judge reads one ad like an organic post: its format (organic + ad formats), hook type and each line's
 * job. A video the AI scan has heard is read from its transcript (`script`), with the ad copy as the
 * caption; otherwise from the copy alone (`source` says which).
 */
async function decodeRow(client: Judge, product: { name: string; description: string }, row: Record<string, any>) {
  const ad: PaidAd = {
    adId: row.ad_id, network: row.network, source: row.source, pageId: row.page_id, pageName: row.page_name, competitor: row.competitor,
    startedAt: row.started_at, stoppedAt: row.stopped_at, active: row.active, placements: row.placements, mediaType: row.media_type,
    body: row.body, headline: row.headline, description: row.description, cta: row.cta, linkUrl: row.link_url, media: row.media,
    thumb: row.thumb, snapshotUrl: row.snapshot_url, countries: row.countries, languages: row.languages, collationId: row.collation_id,
    variants: row.variants, reach: row.reach, metrics: row.metrics,
  };
  const heard = scanTranscript(row.scan);
  if (!ad.body && !ad.headline && !heard.length) throw new UserError("This ad has no copy to read yet. Pull it with the scraper to get its text.");
  const days = daysRunning(ad);
  const seconds = Number(row.scan?.video?.duration_sec);
  const reel = { ...adToReel({ ...ad, daysRunning: days }, heard), durationSec: Number.isFinite(seconds) && seconds > 0 ? seconds : null };
  const workflow: ProjectWorkflow = {
    mode: "project", title: product.name, product: product.name, productDescription: product.description,
    competitors: [], sinceDays: 90, limitPerAccount: 1,
  };
  const read = await decoder(client, workflow, [...LIBRARY, ...AD_FORMATS], { ad: true }).decode(reel);
  const decoded = { ...read, source: heard.length ? "transcript" : "copy" };
  const seed = formatSeed({ ...ad, daysRunning: days, groupSize: row.variants }, decoded);
  const decodedAt = new Date().toISOString();
  await db.from("paid_ads").update({ decoded, decoded_at: decodedAt, library_seed: seed, ...successPatch() }).eq("id", row.id);
  return { decoded, seed, decodedAt };
}

/**
 * Reads one ad now: the drawer's "Read again", or after the scan heard its video. A failure is kept on
 * the ad (decode_error) for the page, without using up one of the background reader's tries.
 */
async function decode(user: string, adRowId: string) {
  if (!/^[0-9a-f-]{36}$/.test(adRowId)) throw new HttpError(400, "Which ad?");
  const { data: row } = await db.from("paid_ads").select("*").eq("id", adRowId).eq("user_id", user).maybeSingle();
  if (!row) throw new HttpError(404, "This ad doesn't exist.");
  const client = await aiJudge();
  try {
    return await decodeRow(client, await ownProduct(user, row.product_id), row);
  } catch (error) {
    const message = accountError(error)?.message ?? errorText(error);
    await db.from("paid_ads").update({ decode_error: message.slice(0, 300) }).eq("id", row.id).is("decoded", null);
    throw error;
  }
}

/**
 * The product's ads still to read: shown, never decoded, with copy, and not out of tries (an ad the AI
 * failed on DECODE_MAX_ATTEMPTS times keeps its decode_error and is left for the person's "Read again").
 */
function unread(user: string, productId: string, columns = "id") {
  return db.from("paid_ads").select(columns, { count: "exact" }).eq("user_id", user).eq("product_id", productId).eq("hidden", false)
    .is("decoded", null).or('body.neq."",headline.neq.""').lt("decode_attempts", DECODE_MAX_ATTEMPTS);
}

/**
 * Starts reading the product's new ads in the background (the studio asks after an import or a pull,
 * and when the Research page opens with unread ads). One run at a time per product; `pending` counts
 * the ads left to read.
 */
async function decodeNew(user: string, productId: string) {
  await ownProduct(user, productId);
  const ai = await judgeAvailability(await aiChoice());
  if (!ai.ok) return { pending: 0, running: false, error: `Ads can't be read yet. ${ai.message}` };
  const { count } = await unread(user, productId).limit(1);
  const pending = count ?? 0;
  if (!pending) return { pending, running: false };
  const busySince = new Date(Date.now() - DECODE_BUSY_MS).toISOString();
  const { count: busy } = await unread(user, productId).gt("decoded_at", busySince).limit(1);
  if (!busy) EdgeRuntime.waitUntil(drainDecodes(user, productId).catch((error) => console.error("decode-new", errorText(error))));
  return { pending, running: true };
}

/**
 * One run: DECODE_LANES lanes each claim an unread ad (longest-running first) and read it, until
 * DECODE_RUN_MS has passed; then, if ads are left, the next run starts itself. A claim is `decoded_at`
 * set while `decoded` is still null, so two runs never read the same ad, and it counts as a try. A
 * failed try keeps its error and waits (15 min, then 1 h); after three the ad is left unread with its
 * error (decode_retry.ts). A refused AI key stops the run without using up tries.
 */
async function drainDecodes(user: string, productId: string) {
  const started = Date.now();
  const client = await aiJudge();
  const product = await ownProduct(user, productId);
  const runMs = workWindowMs(await planLimits(), DECODE_RUN_MS);
  const claim = async (): Promise<(Record<string, any> & { id: string }) | null> => {
    const nowIso = new Date().toISOString();
    // Free: never claimed, or claimed long ago by a run that stopped; and past its wait after a failed try.
    const free = `decoded_at.is.null,decoded_at.lt.${new Date(Date.now() - DECODE_CLAIM_MS).toISOString()}`;
    const due = `decode_retry_at.is.null,decode_retry_at.lte.${nowIso}`;
    const { data: next } = await unread(user, productId, "id, decode_attempts").or(free).or(due)
      .order("started_at", { ascending: true, nullsFirst: false }).order("id").limit(DECODE_LANES * 2);
    if (!next?.length) return null;
    // Another lane may take one first: the update only lands while the ad is still free and on the
    // same try count (decode_retry.ts: a claim is one more try).
    for (const { id, decode_attempts } of next as unknown as { id: string; decode_attempts: number | null }[]) {
      const { data: row } = await db.from("paid_ads").update(claimPatch(decode_attempts))
        .eq("id", id).is("decoded", null).eq("decode_attempts", Number(decode_attempts) || 0).or(free).or(due).select("*").maybeSingle();
      if (row) return row;
    }
    return null;
  };
  const { left, refused } = await drainLanes({
    lanes: DECODE_LANES, runMs, claim,
    read: async (row) => { await decodeRow(client, product, row); },
    record: async (row, patch) => { await db.from("paid_ads").update(patch).eq("id", row.id).is("decoded", null); },
    refused: (error) => accountError(error)?.message ?? null,
  });
  if (refused) console.error("decode stopped: the AI key was refused");
  if (left && Date.now() - started >= runMs) await wakeDecodes(user, productId);
}

async function wakeDecodes(user: string, productId: string) {
  const secret = await workerSecret();
  if (!secret) return;
  try {
    const response = await fetch(`${FUNCTION_URL}/decode-tick`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-research-worker": secret },
      body: JSON.stringify({ user, productId }), signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
  } catch {
    // The next kick (the Research page opening, an import or a pull) picks the rest up.
  }
}

// MARK: Scan (OpenAI reads the ad for the Recreate tool)

const SCAN_FLAG_KINDS = ["brand", "logo", "url", "handle", "phone", "email", "address", "price_or_offer", "claim", "person_face", "testimonial", "other"];
const SCAN_WHERE = ["image", "primary_text", "headline", "description", "link", "voiceover", "video"];
/** Twin of ShotType in studio/src/lib/research.ts. */
const SHOT_TYPES = ["talking_head", "screen_recording", "product_closeup", "demo_hands", "b_roll", "lifestyle", "text_card", "green_screen", "split_screen", "animation", "other"];
const SCAN_ROLES = ["headline", "body", "cta", "price", "legal", "other"];
const str = { type: "string" };
const num = { type: "number" };
/** Twin of SwapElement in studio/src/lib/research.ts. */
const SWAP_ELEMENTS = ["headline", "subhead", "body", "wordmark", "logo", "product", "subject", "label", "cta", "price", "legal", "person", "screen", "other"];

/** A video read as a video: the hook, the shots in order and how it's made (null for images). */
const VIDEO_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["duration_sec", "hook", "shots", "presenter", "voiceover_style", "captions_style", "music_sound", "pacing", "structure", "our_script"],
  properties: {
    duration_sec: { type: ["number", "null"] },
    hook: { type: "object", additionalProperties: false, required: ["seconds", "what_happens", "line"], properties: { seconds: num, what_happens: str, line: str } },
    shots: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["start", "end", "shot_type", "visual", "on_screen_text", "voiceover"],
        properties: { start: num, end: num, shot_type: { type: "string", enum: SHOT_TYPES }, visual: str, on_screen_text: str, voiceover: str },
      },
    },
    presenter: str, voiceover_style: str, captions_style: str, music_sound: str, pacing: str, structure: str, our_script: str,
  },
};

/** The strict JSON schema the scan answers in. */
const FIT_SELLS = ["specific_drug", "product", "service", "app", "education", "other"];
const FIT_LEVELS = ["fits", "partly", "doesnt_fit"];

const SCAN_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["on_image_text", "flags", "style", "copy_suggestions", "video_note", "fit", "video", "swaps", "typography"],
  properties: {
    video: { anyOf: [VIDEO_SCHEMA, { type: "null" }] },
    // Exact recreation: every element that must change for OUR brand (theirs → ours), the rest stays as is.
    swaps: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["element", "theirs", "ours", "style", "keep"],
        properties: { element: { type: "string", enum: SWAP_ELEMENTS }, theirs: str, ours: str, style: str, keep: { type: "boolean" } },
      },
    },
    typography: str,
    // Advice only: the studio shows it as a note and never changes the ad because of it.
    fit: {
      type: "object", additionalProperties: false, required: ["ad_sells", "subject", "level", "reason", "adaptation", "suggested_asset_ids"],
      properties: {
        ad_sells: { type: "string", enum: FIT_SELLS }, subject: str,
        level: { type: "string", enum: FIT_LEVELS }, reason: str, adaptation: str,
        suggested_asset_ids: { type: "array", items: str },
      },
    },
    on_image_text: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["text", "role"], properties: { text: str, role: { type: "string", enum: SCAN_ROLES } } },
    },
    flags: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["kind", "text", "where", "why", "suggestion"],
        properties: { kind: { type: "string", enum: SCAN_FLAG_KINDS }, text: str, where: { type: "string", enum: SCAN_WHERE }, why: str, suggestion: str },
      },
    },
    style: {
      type: "object", additionalProperties: false, required: ["layout", "typography", "colours", "text_density", "vibe"],
      properties: { layout: str, typography: str, colours: str, text_density: str, vibe: str },
    },
    copy_suggestions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["headline", "primary_text", "on_image_text", "note"],
        properties: { headline: str, primary_text: str, on_image_text: { type: "array", items: str }, note: str },
      },
    },
    video_note: { type: ["string", "null"] },
  },
};

const SCAN_SYSTEM = [
  "swaps (for an EXACT recreation: the same ad, element for element, with only brand-specific things changed): list every visible element in reading order that a recreation would touch or must explicitly keep. Text elements (headline, subhead, body, labels like BEFORE/AFTER, cta, price, legal) give `theirs` as the exact words; the brand's name or wordmark is `wordmark` (describe in `style` how it's set: weight, slant, serif or sans, case, colour, e.g. 'heavy black italic serif'); a logo mark is `logo`; their product or packshot is `product`; a visual metaphor or object that carries the message (fruit, a before/after pair, a prop) is `subject`; a person is `person`; an app screen is `screen`. `ours` is the replacement for OUR brand (`our_product`): our name for their name/wordmark; for a product or claim, OUR equivalent from `our_product` (its products, actives, benefits) with the same length, rhythm and tone; for generic words that aren't brand-specific (BEFORE, AFTER, a neutral line) set keep=true and ours = theirs. A subject that works for us as it is (a strawberry metaphor for smoother skin) is kept (keep=true); one that only fits their product gets an equivalent for ours. Never invent claims, numbers, prices or offers: an offer or price we don't have becomes \"\" (removed) unless `our_product` lists one. `style` describes how the element looks (font weight, case, size relative to the canvas, colour, position) so the replacement can be set the same way.",
  "typography: one line describing their type: each text role's typeface style (serif/sans, weight, slant, case, tracking), e.g. 'headline: bold transitional serif, sentence case; body: regular grotesk sans; wordmark: heavy black italic serif'.",
  "You audit a competitor's ad so that a different brand can recreate its style, structure and pattern without copying anything brand-specific.",
  "Read the image and the ad's text fields. Flag every brand-specific detail: their brand or product name, logos, links and domains, @handles and social names, phone numbers, emails, street addresses, prices, discounts, promo codes and offers, specific numbers and claims, testimonials, and any person's face or name. For each flag say where it is, why it must change, and a suggestion: the replacement text for OUR brand (from `our_product`), or an empty string when it should simply be removed. For a face, suggest a different person in a few words.",
  "Transcribe the words on the image in reading order, each with its role.",
  "Describe the style plainly: layout and composition, typography, colours, how much text there is, the vibe.",
  "Write exactly 3 copy suggestions for OUR product that keep their copywriting style, length and rhythm (same kind of hook, same number of lines, similar word count) but use our product's real benefits from `our_product`. When `our_product.profile` is there (read from our own website and store listing), write for its audience and their pains, use its promises and differentiators, borrow its own phrases, and use its proof only exactly as written. Never invent claims, numbers, prices, reviews or offers, and never use anything in `our_product.forbidden_claims` or `our_product.profile.claims_to_avoid`. on_image_text lists the lines to put on the image, in order.",
  "If `media_kind` is video_poster, you only see one still frame of a video: say so in video_note and judge only what is visible. Otherwise video_note is null.",
  "If `media_kind` is video_frames or video_poster, the ad is a VIDEO: the images are frames of it, each labelled with the second it was taken at, and `their_ad.transcript` is its spoken words with timings (speech-to-text; empty when nobody speaks; `their_ad.transcript_note` says why). Read it as a video and fill `video`: duration_sec (from `their_ad.video_seconds` when given); hook: how many seconds the hook lasts, what happens on screen in that time, and the opening line spoken or shown; shots: every distinct shot in order with estimated start and end seconds (use the frame times and the transcript timings; the last shot ends at the video's length), its shot_type, what is visible (framing, action, setting; describe people by kind and look, never who they are), the on-screen text or captions in it (\"\" when none) and the words spoken over it (\"\" when none); presenter (who is on camera and where, by kind; \"\" when nobody); voiceover_style (who speaks, how: first person, energy, pace); captions_style (how captions look and where); music_sound (what you can tell; say when you can't hear it); pacing (number of cuts, how fast); structure (their beats in one line, like 'problem → demo → result → CTA'); our_script: a voiceover for OUR product with the same beats, rhythm and length as theirs, one beat per line, using only real benefits and proof from `our_product` and never anything in its forbidden claims. With only a poster frame, fill `video` from the transcript and the poster and say what you couldn't see in video_note. For images, `video` is null.",
  "For a video, flag brand-specific things you hear in the transcript with where=voiceover and things you see in the frames with where=video; on_image_text lists the on-screen captions in order; copy suggestions keep their post text style (primary_text and headline) and on_image_text holds the captions for our version.",
  "If `their_ad.is_ours` is true, the ad is OUR OWN: don't flag our own brand, links, handles or product as something to replace (flag only claims, numbers, offers and faces worth checking); the copy suggestions are fresh variations of it; fit is about how well it sells what we offer today.",
  "fit (advice for the person, who decides): ad_sells is what their ad promotes: specific_drug (a named medicine or prescription), product (a physical product), service (a membership, consultation or service), app, education (tips, myths, information), or other. subject names it in a few words. level says how well OUR product (`our_product`, its profile and `our_product.assets`) can make the same promise: fits (we offer the same kind of thing), partly (the hook or format works but the payoff must change), doesnt_fit (we don't offer it). reason: one plain sentence. adaptation: one or two sentences on how to keep their hook and structure while the payoff becomes what we actually offer. suggested_asset_ids: up to 3 ids from `our_product.assets` that would work in our version (e.g. our product shot where they show their product, our app screen where they show theirs), only when they really match the ad's need; [] otherwise.",
].join("\n");

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** The AI product profile (products.insight, from the `insight` function) as scan facts; null when there's none. */
function profileFacts(insight: any) {
  if (!insight || typeof insight !== "object" || !insight.summary) return null;
  const list = (x: unknown, n: number, max = 200) => (Array.isArray(x) ? x.slice(0, n).map((v) => clip(v, max)).filter(Boolean) : []);
  const segments = Array.isArray(insight.audience?.segments) ? insight.audience.segments.slice(0, 3) : [];
  return {
    summary: clip(insight.summary, 900), category: clip(insight.category, 80), problem: clip(insight.problem, 400), solution: clip(insight.solution, 400),
    audience: clip(insight.audience?.primary, 200),
    segments: segments.map((s: any) => ({ name: clip(s?.name, 60), pains: list(s?.pains, 3, 160), motivations: list(s?.motivations, 3, 160) })),
    promises: list(insight.value_props, 5), differentiators: list(insight.differentiators, 4),
    features: (Array.isArray(insight.features) ? insight.features.slice(0, 6) : []).map((f: any) => `${clip(f?.name, 60)}: ${clip(f?.benefit, 160)}`),
    proof: list(insight.proof, 4), voice: clip(insight.brand?.tone, 300), phrases: list(insight.messaging?.phrases, 8, 80), ctas: list(insight.messaging?.ctas, 3, 40),
    claims_to_avoid: list(insight.claims_to_avoid, 10, 160),
  };
}

/** The scan's answer, validated and trimmed before it's stored. */
function cleanScan(raw: Record<string, any>) {
  const arr = (x: unknown, n: number) => (Array.isArray(x) ? x.slice(0, n) : []);
  return {
    on_image_text: arr(raw.on_image_text, 30).map((t: any) => ({ text: clip(t?.text, 300), role: SCAN_ROLES.includes(t?.role) ? t.role : "other" })).filter((t) => t.text),
    flags: arr(raw.flags, 40).map((f: any) => ({
      kind: SCAN_FLAG_KINDS.includes(f?.kind) ? f.kind : "other", text: clip(f?.text, 200), where: SCAN_WHERE.includes(f?.where) ? f.where : "image",
      why: clip(f?.why, 300), suggestion: clip(f?.suggestion, 200),
    })).filter((f) => f.text),
    style: {
      layout: clip(raw.style?.layout, 400), typography: clip(raw.style?.typography, 300), colours: clip(raw.style?.colours, 300),
      text_density: clip(raw.style?.text_density, 200), vibe: clip(raw.style?.vibe, 300),
    },
    copy_suggestions: arr(raw.copy_suggestions, 3).map((c: any) => ({
      headline: clip(c?.headline, 200), primary_text: clip(c?.primary_text, 1500),
      on_image_text: arr(c?.on_image_text, 8).map((l: unknown) => clip(l, 200)).filter(Boolean), note: clip(c?.note, 300),
    })),
    video_note: clip(raw.video_note, 400) || null,
    swaps: arr(raw.swaps, 30).map((w: any) => ({
      element: SWAP_ELEMENTS.includes(w?.element) ? w.element : "other", theirs: clip(w?.theirs, 300), ours: clip(w?.ours, 300), style: clip(w?.style, 200), keep: w?.keep === true,
    })).filter((w: { theirs: string }) => w.theirs),
    typography: clip(raw.typography, 400),
    fit: {
      ad_sells: FIT_SELLS.includes(raw.fit?.ad_sells) ? raw.fit.ad_sells : "other",
      subject: clip(raw.fit?.subject, 120), level: FIT_LEVELS.includes(raw.fit?.level) ? raw.fit.level : "partly",
      reason: clip(raw.fit?.reason, 300), adaptation: clip(raw.fit?.adaptation, 500),
      suggested_asset_ids: arr(raw.fit?.suggested_asset_ids, 3).filter((id: unknown) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)),
    },
  };
}

/** The best still to read: the first image, a carousel's first card, or a video's poster frame. */
function scanImage(row: Record<string, any>): { url: string; kind: "image" | "card_1" | "video_poster" } | null {
  const media: Record<string, any>[] = row.creative?.media?.length ? row.creative.media : (row.media ?? []);
  const image = media.find((m) => m?.type === "image" && httpUrl(m.url));
  if (image && !scanVideo(row)) return { url: image.url, kind: row.media_type === "carousel" || row.media_type === "dco" ? "card_1" : "image" };
  const video = media.find((m) => m?.type === "video");
  const poster = httpUrl(video?.thumbnail_url) ?? httpUrl(video?.thumb) ?? httpUrl(row.thumb);
  return poster ? { url: poster, kind: "video_poster" } : null;
}

const EXPIRED = "The image link expired: re-run the scraper and import again.";

/**
 * Downloads the still and hands it to OpenAI inline (Ad Library links are signed and expire). Only our
 * stored copy or a link on Meta's, Instagram's or TikTok's CDN is fetched.
 */
async function imageData(url: string): Promise<string> {
  if (!allowedMedia(url)) throw new UserError("This ad's image isn't on Meta's or TikTok's servers, so it can't be read. Re-run the scraper and import again.");
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new UserError(EXPIRED);
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.startsWith("image/")) throw new UserError(EXPIRED);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 15 * 1024 * 1024) throw new UserError("The image is over 15 MB; it can't be scanned.");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type.split(";")[0]};base64,${btoa(binary)}`;
}

// MARK: Scan · video

/** Frames the browser sends (studio/src/lib/video-frames.ts): at most 10, JPEG/PNG/WebP data URLs under 700 KB each. */
const MAX_SCAN_FRAMES = 10;
type ScanFrame = { at: number; data: string };
function cleanFrames(input: unknown): ScanFrame[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_SCAN_FRAMES).map((f: any) => ({ at: Math.max(0, Math.round(Number(f?.at) * 10) / 10), data: typeof f?.data === "string" ? f.data : "" }))
    .filter((f) => Number.isFinite(f.at) && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(f.data) && f.data.length <= 700_000)
    .sort((a, b) => a.at - b.at);
}

/** Keeps the frames in `ad-media` (<product>/scan-frames/<ad>/), so Recreate can send them to Higgsfield as references. */
async function storeFrames(productId: string, adRowId: string, frames: ScanFrame[]): Promise<{ at: number; url: string }[]> {
  const out = await Promise.all(frames.map(async (frame, i) => {
    const [head, b64] = frame.data.split(",", 2);
    const mime = head.slice(5, head.indexOf(";"));
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const path = `${productId}/scan-frames/${adRowId}/${String(i).padStart(2, "0")}-${Math.round(frame.at * 10)}.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`;
    const { error } = await db.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: mime, upsert: true, cacheControl: "3600" });
    return error ? null : { at: frame.at, url: `${db.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl}?v=${Date.now()}` };
  }));
  return out.filter((f): f is { at: number; url: string } => Boolean(f));
}

/** OpenAI's speech-to-text takes files up to 25 MB. */
const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;
type Segment = { start: number; end: number; text: string };

/**
 * Their spoken words with timings, from the stored video (or the Ad Library link while it lasts; only
 * our storage or Meta's, Instagram's or TikTok's CDN). Never throws: a note says why there's none.
 */
async function transcribe(apiKey: string, model: string, url: string): Promise<{ segments: Segment[]; note: string | null; seconds: number | null }> {
  const none = (note: string) => ({ segments: [], note, seconds: null });
  if (!allowedMedia(url)) return none("The video isn't on Meta's or TikTok's servers, so its audio wasn't transcribed.");
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(40_000) });
  } catch {
    return none("The video couldn't be downloaded, so its audio wasn't transcribed.");
  }
  if (!response.ok) return none("The video link expired, so its audio wasn't transcribed: re-run the scraper and import again.");
  if (Number(response.headers.get("content-length")) > TRANSCRIBE_MAX_BYTES) return none("The video is over 25 MB, so its audio wasn't transcribed.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > TRANSCRIBE_MAX_BYTES) return none("The video is over 25 MB, so its audio wasn't transcribed.");
  const mime = (response.headers.get("content-type") ?? "video/mp4").split(";")[0];
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime.startsWith("video/") || mime.startsWith("audio/") ? mime : "video/mp4" }), mime === "video/quicktime" ? "ad.mov" : mime === "video/webm" ? "ad.webm" : "ad.mp4");
  form.append("model", model);
  // Segment timings need verbose_json (only some models give them); the others answer with plain text.
  if (TIMED_TRANSCRIBE_MODELS.includes(model)) { form.append("response_format", "verbose_json"); form.append("timestamp_granularities[]", "segment"); }
  else form.append("response_format", "json");
  let answer: Response;
  try {
    answer = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(60_000) });
  } catch {
    return none("Speech-to-text didn't answer in time.");
  }
  const data = await answer.json().catch(() => ({}));
  // A refused key stops the scan with the key's message; anything else only leaves the audio unheard.
  const refused = keyRefusal("openai", answer.status, data);
  if (!answer.ok && refused) throw new UserError(refused.message);
  if (!answer.ok) return none(`Speech-to-text failed: ${String(data?.error?.message ?? answer.status).slice(0, 200)}`);
  const seconds = Number(data?.duration) > 0 ? Math.round(Number(data.duration) * 10) / 10 : null;
  let segments: Segment[] = (Array.isArray(data?.segments) ? data.segments : []).slice(0, 150)
    .map((x: any) => ({ start: Math.round(Number(x?.start) * 10) / 10 || 0, end: Math.round(Number(x?.end) * 10) / 10 || 0, text: clip(x?.text, 400) }))
    .filter((x: Segment) => x.text);
  if (!segments.length && clip(data?.text, 6000)) segments = [{ start: 0, end: seconds ?? 0, text: clip(data.text, 6000) }];
  return { segments, note: segments.length ? null : "Nobody speaks in it (music or silence).", seconds };
}

/** The scan's reading of a video, validated and trimmed. */
function cleanVideo(raw: any, seconds: number | null) {
  const n = (x: unknown) => (Number.isFinite(Number(x)) ? Math.max(0, Math.round(Number(x) * 10) / 10) : 0);
  const shots = (Array.isArray(raw?.shots) ? raw.shots.slice(0, 40) : []).map((x: any) => ({
    start: n(x?.start), end: n(x?.end), shot_type: SHOT_TYPES.includes(x?.shot_type) ? x.shot_type : "other",
    visual: clip(x?.visual, 300), on_screen_text: clip(x?.on_screen_text, 300), voiceover: clip(x?.voiceover, 400),
  })).filter((x: { visual: string; on_screen_text: string; voiceover: string }) => x.visual || x.on_screen_text || x.voiceover);
  return {
    duration_sec: seconds ?? (Number(raw?.duration_sec) > 0 ? n(raw.duration_sec) : null),
    hook: { seconds: n(raw?.hook?.seconds) || 2, what_happens: clip(raw?.hook?.what_happens, 300), line: clip(raw?.hook?.line, 300) },
    shots,
    presenter: clip(raw?.presenter, 300), voiceover_style: clip(raw?.voiceover_style, 300), captions_style: clip(raw?.captions_style, 300),
    music_sound: clip(raw?.music_sound, 200), pacing: clip(raw?.pacing, 200), structure: clip(raw?.structure, 300), our_script: clip(raw?.our_script, 2000),
  };
}

/**
 * OpenAI reads one ad for the Recreate tool. One call per click: the stored scan comes back unless
 * `force`. Their image goes to OpenAI for reading only. A video ad is read as a video: the key frames
 * the browser took (`frames`; else its poster) plus its audio through speech-to-text.
 */
async function scan(user: string, adRowId: string, force: boolean, framesInput?: unknown, durationInput?: unknown) {
  if (!/^[0-9a-f-]{36}$/.test(adRowId)) throw new HttpError(400, "Which ad?");
  const { data: row } = await db.from("paid_ads").select("*").eq("id", adRowId).eq("user_id", user).maybeSingle();
  if (!row) throw new HttpError(404, "This ad doesn't exist.");
  const videoUrl = scanVideo(row);
  const frames = videoUrl ? cleanFrames(framesInput) : [];
  // A stored scan of a video read from its poster alone is redone when frames come with the request.
  if (row.scan && !force && !(frames.length && row.scan.image_source !== "video_frames")) return { scan: row.scan, scannedAt: row.scanned_at, cached: true };
  const startedAt = Date.now();
  const k = await keys();
  if (!k.OPENAI_API_KEY) throw new UserError(`OpenAI isn't connected. ${addKeyMessage("OPENAI_API_KEY")}`);
  const use = await models();
  const product = await ownProduct(user, row.product_id);
  const [{ data: kitRow }, { data: assetRows }] = await Promise.all([
    db.from("products").select("brand_kit, insight").eq("id", row.product_id).maybeSingle(),
    db.from("product_assets").select("id, kind, label, description, group_name, good_for").eq("product_id", row.product_id).eq("hidden", false).order("created_at").limit(60),
  ]);
  const kit = (kitRow?.brand_kit && typeof kitRow.brand_kit === "object" ? kitRow.brand_kit : {}) as Record<string, any>;
  const still = scanImage(row);
  if (!still && !frames.length) throw new UserError("This ad has no image to read. Re-run the scraper to get its media.");
  // The stored copy when there is one: the Ad Library link may have expired.
  const [image, heard, stored] = await Promise.all([
    frames.length ? Promise.resolve(null) : imageData(await storedUrl(row.product_id, still!.url) ?? still!.url),
    videoUrl ? storedUrl(row.product_id, videoUrl).then((url) => transcribe(k.OPENAI_API_KEY!, use.transcribe, url ?? videoUrl)) : Promise.resolve(null),
    frames.length ? storeFrames(row.product_id, row.id, frames) : Promise.resolve([]),
  ]);
  const mediaKind = frames.length ? "video_frames" : still!.kind;
  const givenSeconds = Number(durationInput) > 0 && Number(durationInput) < 600 ? Math.round(Number(durationInput) * 10) / 10 : null;
  const seconds = givenSeconds ?? heard?.seconds ?? null;
  const model = use.vision;
  const facts = {
    media_kind: mediaKind,
    their_ad: {
      // True when this is our own ad (Research → Our ads), not a competitor's.
      is_ours: row.is_own === true,
      advertiser: row.competitor ?? row.page_name, page_name: row.page_name, creative_type: row.media_type,
      primary_text: clip(row.body, 3000), headline: clip(row.headline, 300), description: clip(row.description, 500), cta: clip(row.cta, 80), link: clip(row.link_url, 300),
      ...(videoUrl ? {
        video_seconds: seconds,
        transcript: (heard?.segments ?? []).map((x) => `[${x.start}–${x.end} s] ${x.text}`).join("\n").slice(0, 8000),
        transcript_note: heard?.note ?? null,
        frames: frames.map((f, i) => ({ frame: i + 1, second: f.at })),
      } : {}),
    },
    our_product: {
      name: clip(kit.appName, 80) || product.name, description: clip(product.description, 1500), tagline: clip(kit.tagline, 200), tone: clip(kit.tone, 1000),
      colors: Array.isArray(kit.colors) ? kit.colors.slice(0, 12) : [], forbidden_claims: Array.isArray(kit.forbiddenClaims) ? kit.forbiddenClaims.slice(0, 50) : [],
      app_store_url: clip(kit.appStoreUrl, 300) || null,
      profile: profileFacts(kitRow?.insight),
      // Our pictures (product shots, app screens…), by id, for the fit's suggestions. Text only; no images are sent.
      assets: ((assetRows ?? []) as Record<string, any>[]).map((a) => ({
        id: a.id, kind: a.kind, label: clip(a.label, 120), description: clip(a.description, 200), group: clip(a.group_name, 80), good_for: Array.isArray(a.good_for) ? a.good_for.slice(0, 5) : [],
      })),
    },
  };
  const pictures = frames.length
    ? frames.flatMap((f, i) => [{ type: "input_text", text: `Frame ${i + 1} of ${frames.length}, at ${f.at} s:` }, { type: "input_image", image_url: f.data }])
    : [{ type: "input_image", image_url: image! }];
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${k.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // A video's key frames plus its transcript at medium effort ran past the timeout (Oct 15 2026): low keeps it inside.
        model, reasoning: { effort: frames.length ? "low" : "medium" },
        input: [
          { role: "system", content: SCAN_SYSTEM },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify(facts, null, 2) }, ...pictures] },
        ],
        text: { format: { type: "json_schema", name: "ad_scan", strict: true, schema: SCAN_SCHEMA } },
      }),
      // Cut to end before the plan's time limit, counting what the download and the transcript already took.
      signal: AbortSignal.timeout(withinWallClock(await planLimits(), videoUrl ? 100_000 : 120_000, Date.now() - startedAt)),
    });
  } catch {
    throw new UserError("OpenAI didn't answer in time. Try again in a moment.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const refused = keyRefusal("openai", response.status, data);
    if (refused) throw new UserError(refused.message);
    const message = String(data?.error?.message ?? `error ${response.status}`);
    if (/download|image_url|invalid image|unsupported image/i.test(message)) throw new UserError(EXPIRED);
    throw new UserError(`OpenAI: ${message.slice(0, 300)}`);
  }
  const parts = (data?.output ?? []).flatMap((item: any) => item.content ?? []);
  const refusal = parts.find((part: any) => part.type === "refusal")?.refusal;
  if (refusal) throw new UserError(`OpenAI declined to read this ad: ${String(refusal).slice(0, 200)}`);
  const text = data?.output_text ?? parts.find((part: any) => part.type === "output_text")?.text;
  let parsed: Record<string, any>;
  try { parsed = JSON.parse(text); } catch { throw new UserError("OpenAI's answer wasn't readable. Try again."); }
  const video = videoUrl
    ? { ...cleanVideo(parsed.video, seconds), transcript: heard?.segments ?? [], transcript_note: heard?.note ?? null, frames: stored }
    : null;
  const result = { ...cleanScan(parsed), model, image_source: mediaKind, video };
  const scannedAt = new Date().toISOString();
  await db.from("paid_ads").update({ scan: result, scanned_at: scannedAt }).eq("id", row.id);
  return { scan: result, scannedAt, cached: false };
}

// MARK: Templates (Playground: OpenAI reads an uploaded ad into a reusable, brand-neutral template)

const TEMPLATE_IMAGE_MAX = 10 * 1024 * 1024;

/** An uploaded template image as a data URL for OpenAI (the file is ours, in the public workspace bucket). */
async function templateImage(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new UserError("Couldn't load the uploaded image. Upload it again.");
  }
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!response.ok || !/^image\/(png|jpeg|webp)$/.test(type)) throw new UserError("Couldn't load the uploaded image. Upload it again.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > TEMPLATE_IMAGE_MAX) throw new UserError("The image is over 10 MB.");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

/**
 * Reads one uploaded template (custom, this user's, in this product) and stores the analysis: status
 * "analyzed", or "failed" with the reason. Answers at once (202, status "analyzing") and reads in the
 * background, unless `wait`. Never while the template is being remade or is already made.
 */
async function templateAnalyze(user: string, productId: string, templateId: string, wait: boolean) {
  await ownProduct(user, productId);
  if (!/^[0-9a-f-]{36}$/.test(templateId)) throw new HttpError(400, "Which template?");
  const { data: row } = await db.from("product_templates").select("id, kind, status, name, source_url").eq("id", templateId).eq("product_id", productId).eq("user_id", user).maybeSingle();
  if (!row) throw new HttpError(404, "This template doesn't exist.");
  if (row.kind !== "custom" || !isOwnTemplateUpload(row.source_url, SUPABASE_URL, user, productId)) throw new UserError("Only an uploaded ad can be read.");
  if (row.status === "generating" || row.status === "ready") throw new HttpError(409, "This template is already being made or made.");
  if (row.status !== "analyzing") {
    await db.from("product_templates").update({ status: "analyzing", error: null }).eq("id", row.id).eq("status", row.status);
  }
  const work = readTemplate(row.id, row.source_url as string, row.name === DEFAULT_TEMPLATE_NAME);
  if (!wait) {
    EdgeRuntime.waitUntil(work.catch((error) => console.error("template-analyze", error)));
    return { templateId: row.id, status: "analyzing" as const };
  }
  const result = await work;
  if (result.status === "failed") throw new UserError(result.error);
  return result;
}

async function readTemplate(id: string, sourceUrl: string, rename: boolean): Promise<{ templateId: string; status: "analyzed"; analysis: ReturnType<typeof cleanTemplateAnalysis> } | { templateId: string; status: "failed"; error: string }> {
  try {
    const k = await keys();
    if (!k.OPENAI_API_KEY) throw new UserError(`OpenAI isn't connected. ${addKeyMessage("OPENAI_API_KEY")}`);
    const image = await templateImage(sourceUrl);
    const model = (await models()).vision;
    const timeoutMs = withinWallClock(await planLimits(), 120_000);
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${k.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, reasoning: { effort: "medium" },
          input: [
            { role: "system", content: TEMPLATE_SYSTEM },
            { role: "user", content: [{ type: "input_text", text: "Read this ad image." }, { type: "input_image", image_url: image }] },
          ],
          text: { format: { type: "json_schema", name: "ad_template", strict: true, schema: TEMPLATE_SCHEMA } },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new UserError("OpenAI didn't answer in time. Try again in a moment.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new UserError(keyRefusal("openai", response.status, data)?.message ?? `OpenAI: ${String(data?.error?.message ?? `error ${response.status}`).slice(0, 300)}`);
    const analysis = cleanTemplateAnalysis(responseJson(data));
    // Only while it's still waiting for this read (not deleted, not re-uploaded, not remade meanwhile).
    await db.from("product_templates").update({ analysis, status: "analyzed", error: null, ...(rename ? { name: analysis.name } : {}) }).eq("id", id).eq("status", "analyzing");
    return { templateId: id, status: "analyzed", analysis };
  } catch (error) {
    const message = error instanceof UserError ? error.message : `Couldn't read the image: ${errorText(error)}`;
    await db.from("product_templates").update({ status: "failed", error: message.slice(0, 400) }).eq("id", id).eq("status", "analyzing");
    return { templateId: id, status: "failed", error: message };
  }
}

// MARK: Media (competitors' creative files kept in storage)

interface QueuedFile { url: string; kind: MediaKind; pageId: string | null }
interface MediaRow {
  id: string; user_id: string; product_id: string; page_id: string | null; url_key: string; source_url: string; kind: MediaKind;
  status: "queued" | "downloading" | "done" | "failed"; attempts: number;
}

/**
 * Downloads at once per worker, the most running across workers, and how long a claim holds. 6 at once
 * stored ~2.5 files a second, so 11 competitors' imports (~10,000 files) took over an hour (Oct 15 2026):
 * a backlog now fans out to up to 16 workers (Nov 6 2026: 8 kept a 1,000-ad import waiting ~20 minutes).
 * Each worker still runs 3 lanes, so its memory stays the same.
 */
const MEDIA_LANES = 3;
const MEDIA_MAX_ACTIVE = 48;
/** Files waiting that make a starting worker wake another (fan-out), until MEDIA_MAX_ACTIVE is reached. */
const MEDIA_FAN_OUT_AT = 30;
/** Files up to this size are read into memory and uploaded; bigger ones (or of unknown size) stream through. */
const MEDIA_BUFFER_BYTES = 20 * 1024 * 1024;
const MEDIA_MAX_ATTEMPTS = 3;
const MEDIA_NO_ROOM = "No room left in storage when it was imported: free up space in Settings > Storage (or delete competitors you're done with), then import the same file again.";
/** A file the worker reached when storage had filled up: not stored, the ad and its poster link stay. */
const MEDIA_NO_ROOM_NOW = "Storage was full when this file's turn came: free up space in Settings > Storage, then import the same file again.";

/**
 * The media worker's numbers for this install's Supabase plan (_shared/limits.ts):
 *   claimMs, streamMs, fetchMs, leaseSeconds  its clock, as shares of the plan's wall clock. A claim must
 *     outlast the slowest save (a claim at claimMs plus a streamMs video), or another worker re-claims a
 *     file mid-upload and the third claim marks it "kept stopping": that failed every 35–90 MB video of
 *     the Nov 6 2026 import when the lease was 180 s. With no install row these are 50 s, 300 s, 60 s
 *     and 420 s, as they always were (a 400 s wall clock).
 *   uploadBytes  the plan's upload limit (RESEARCH_MEDIA_UPLOAD_LIMIT_MB overrides it); a bigger file is
 *     left out with `tooBig` as its stored note, and never tried again.
 *   quotaBytes   the plan's storage (RESEARCH_STORAGE_QUOTA_GB overrides it).
 */
async function mediaPlan() {
  const limits = await planLimits();
  const uploadBytes = uploadMaxBytes(limits);
  return { ...mediaTimings(limits), uploadBytes, tooBig: tooBigNote(uploadBytes), quotaBytes: storageQuotaBytes(limits) };
}
/** A worker run's plan, with the room left in storage (checked once at the start, then counted down as files are saved). */
type MediaPlan = Awaited<ReturnType<typeof mediaPlan>> & { room?: { left: number } };
/** The note on a download that ran out of time (tried again, up to MEDIA_MAX_ATTEMPTS). */
const slowNote = (ms: number) => `It didn't finish downloading within ${Math.round(ms / 1000)} s, the time this plan gives a file.`;
const timedOut = (error: unknown) => /abort|timed? ?out/i.test(error instanceof Error ? `${error.name} ${error.message}` : String(error));
/** Storage's "too big" answer (413, "Payload too large", "exceeded the maximum allowed size"). */
const tooLarge = (message: string) => /413|payload too large|maximum allowed size/i.test(message);

/**
 * Queues an import's files (new, failed or still waiting ones; stored ones are skipped). Only links on
 * Meta's, Instagram's or TikTok's CDN: the worker never downloads from anywhere else.
 */
async function enqueueMedia(user: string, productId: string, files: QueuedFile[], holds?: Record<string, string> | null) {
  const rows = new Map<string, { url_key: string; source_url: string; kind: MediaKind; page_id: string | null }>();
  for (const file of files) {
    if (!allowedMedia(file.url)) continue;
    const key = urlKey(file.url);
    if (key && !rows.has(key)) rows.set(key, { url_key: key, source_url: file.url.slice(0, 4000), kind: file.kind, page_id: file.pageId });
  }
  // The import pop-up's decisions: files over the upload limit or past the storage room aren't queued, they're
  // recorded with the reason (a later import of the same file checks again).
  // Storage full (every bucket counts against the plan): nothing is queued; each file is recorded with the
  // reason, so a later import of the same file, after space is freed, queues it again.
  if (rows.size && !(holds && Object.keys(holds).length)) {
    const room = await storageRoom(db, await planLimits()).catch(() => null);
    if (room && !fits(room)) {
      const all = [...rows.keys()];
      holds = Object.fromEntries(all.map((k) => [k, "no_room"]));
    }
  }
  const held = holds ? [...rows.values()].filter((r) => holds![r.url_key]) : [];
  if (held.length) {
    const { tooBig } = await mediaPlan();
    for (const r of held) rows.delete(r.url_key);
    for (let i = 0; i < held.length; i += 500) {
      const { error } = await db.rpc("research_media_hold", { p_user: user, p_product: productId,
        p_files: held.slice(i, i + 500).map((r) => ({ ...r, error: holds![r.url_key] === "too_big" ? tooBig : MEDIA_NO_ROOM })) });
      if (error) throw new Error(`Couldn't record the files left out: ${error.message}`);
    }
  }
  const all = [...rows.values()];
  let queued = 0, stored = 0;
  for (let i = 0; i < all.length; i += 500) {
    const { data, error } = await db.rpc("research_media_enqueue", { p_user: user, p_product: productId, p_files: all.slice(i, i + 500) });
    if (error) throw new Error(`Couldn't queue the media: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as { queued?: number; stored?: number } | null;
    queued += row?.queued ?? 0;
    stored += row?.stored ?? 0;
  }
  return { queued, stored };
}

/** Starts a media worker (another invocation of this function), like the cron watchdog does. */
async function wakeMedia() {
  const secret = await workerSecret();
  if (!secret) return;
  try {
    const response = await fetch(`${FUNCTION_URL}/media-tick`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-research-worker": secret }, body: "{}", signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
  } catch {
    // The watchdog starts one within a minute.
  }
}

/** The stored copy of a link, when the file is in storage. */
async function storedUrl(productId: string, url: string): Promise<string | null> {
  const key = urlKey(url);
  if (!key) return null;
  const { data } = await db.from("paid_ad_media").select("public_url").eq("product_id", productId).eq("url_key", key).eq("status", "done").maybeSingle();
  return (data?.public_url as string | null | undefined) ?? null;
}

/**
 * One worker run: three lanes each claim a file, download it and upload it to storage, until the
 * plan's claim window (mediaPlan) has passed. Then, if files are still waiting, it starts the next run itself so a
 * backlog drains faster than the once-a-minute watchdog.
 */
async function drainMedia() {
  const started = Date.now();
  const base = await mediaPlan();
  const room = await storageRoom(db, await planLimits()).catch(() => null);
  const plan: MediaPlan = { ...base, room: { left: room ? room.roomBytes : Infinity } };
  const { data: active } = await db.rpc("research_media_active");
  if (Number(active ?? 0) >= MEDIA_MAX_ACTIVE) return;
  // A big backlog: wake one more worker before starting, which does the same, until the cap is reached.
  if (Number(active ?? 0) + MEDIA_LANES * 2 <= MEDIA_MAX_ACTIVE) {
    const { count: backlog } = await db.from("paid_ad_media").select("id", { count: "exact", head: true }).eq("status", "queued");
    if ((backlog ?? 0) >= MEDIA_FAN_OUT_AT) void wakeMedia();
  }
  const lane = async () => {
    while (Date.now() - started < plan.claimMs) {
      const { data, error } = await db.rpc("research_media_claim", { p_limit: 1, p_seconds: plan.leaseSeconds });
      if (error) throw new Error(`Couldn't claim media: ${error.message}`);
      const row = ((data ?? []) as MediaRow[])[0];
      if (!row) return;
      await saveMedia(row, plan).catch((e) => finishFailed(row, null, errorText(e)));
    }
  };
  await Promise.all(Array.from({ length: MEDIA_LANES }, lane));
  const now = new Date().toISOString();
  const { data: waiting } = await db.from("paid_ad_media").select("id").eq("status", "queued").or(`lease_until.is.null,lease_until.lt.${now}`).limit(1);
  if (waiting?.length) await wakeMedia();
}

/** Downloads one file from its Ad Library link and puts it in the `ad-media` bucket. */
async function saveMedia(row: MediaRow, plan: MediaPlan) {
  // Queued before imports were limited to the ad CDNs: never fetched.
  if (!allowedMedia(row.source_url)) return finishFailed(row, null, "The link isn't on Meta's, Instagram's or TikTok's servers.", false);
  let response: Response;
  try {
    // The signal also bounds reading the body, which the upload below streams: a video gets minutes.
    response = await fetch(row.source_url, { signal: AbortSignal.timeout(row.kind === "video" ? plan.streamMs : plan.fetchMs) });
  } catch (error) {
    return finishFailed(row, null, timedOut(error) ? slowNote(row.kind === "video" ? plan.streamMs : plan.fetchMs) : errorText(error));
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return finishFailed(row, response.status);
  }
  const mime = mediaMime(response.headers.get("content-type"), row.source_url, row.kind);
  const length = Number(response.headers.get("content-length") ?? NaN);
  if (!mime || !response.body || length > MEDIA_MAX_BYTES) {
    await response.body?.cancel().catch(() => {});
    return finishFailed(row, null, !mime ? "The link didn't return an image or a video." : !response.body ? "The download was empty." : "The file is over 300 MB.", false);
  }
  // Over the plan's upload limit (50 MB on Supabase's free plan): storage would refuse it, so it isn't
  // stored (the ad, its copy and its poster are). It is marked with the reason once; no retries are spent.
  if (length > plan.uploadBytes) {
    await response.body?.cancel().catch(() => {});
    return finishFailed(row, null, plan.tooBig, false);
  }
  // No room left for it (or storage is full and its size is unknown): not stored, never half-saved.
  if (plan.room && (Number.isFinite(length) && length > 0 ? length > plan.room.left : plan.room.left <= 0)) {
    await response.body?.cancel().catch(() => {});
    return finishFailed(row, null, MEDIA_NO_ROOM_NOW, false);
  }
  const path = mediaPath(row.product_id, row.page_id, await sha256Hex(row.url_key), extensionFor(mime, row.source_url));
  let bytes: number;
  if (Number.isFinite(length) && length > 0 && length <= MEDIA_BUFFER_BYTES) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    const { error } = await db.storage.from(MEDIA_BUCKET).upload(path, buffer, { contentType: mime, upsert: true, cacheControl: "31536000" });
    if (error) return finishFailed(row, null, tooLarge(error.message) ? plan.tooBig : storageErrorText(error.message, plan.uploadBytes), !tooLarge(error.message));
    bytes = buffer.byteLength;
  } else {
    // Large or of unknown size: streamed to storage. With a known size (already checked against the limit)
    // the body goes straight through: counting each chunk in JavaScript used up the function's 2 s of CPU
    // on 60-90 MB videos, which killed the worker mid-upload (Nov 6 2026). Unknown sizes are counted and
    // stopped past the plan's upload limit (or 300 MB, the bucket's own, when that is lower).
    const stopAt = Math.min(MEDIA_MAX_BYTES, plan.uploadBytes);
    const overNote = () => (count > MEDIA_MAX_BYTES ? "The file is over 300 MB." : plan.tooBig);
    let count = 0;
    const known = Number.isFinite(length) && length > 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        count += chunk.byteLength;
        if (count > stopAt) controller.error(new Error(overNote()));
        else controller.enqueue(chunk);
      },
    });
    const key = serviceKey();
    const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${MEDIA_BUCKET}/${path}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": mime, "x-upsert": "true", "cache-control": "max-age=31536000", ...(known ? { "content-length": String(length) } : {}) },
      body: known ? response.body : response.body.pipeThrough(counter),
      duplex: "half",
      signal: AbortSignal.timeout(plan.streamMs),
    } as RequestInit & { duplex: "half" }).catch((error) => error as Error);
    if (upload instanceof Error) return finishFailed(row, null, count > stopAt ? overNote() : timedOut(upload) ? slowNote(plan.streamMs) : errorText(upload), count <= stopAt);
    if (!upload.ok) {
      const answer = (await upload.text().catch(() => "")).slice(0, 200);
      const big = upload.status === 413 || tooLarge(answer);
      return finishFailed(row, null, big ? plan.tooBig : `Storage answered ${upload.status}: ${answer}`, !big);
    }
    await upload.body?.cancel().catch(() => {});
    bytes = known ? length : count;
  }
  if (plan.room) plan.room.left -= bytes;
  const publicUrl = db.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  const { data: updated } = await db.from("paid_ad_media")
    .update({ status: "done", storage_path: path, public_url: publicUrl, bytes, mime, error: null, lease_until: null })
    .eq("id", row.id).eq("status", "downloading").select("id");
  if (!updated?.length) {
    // Deleted while it downloaded ("Delete stored media"): don't leave the file behind.
    const { data: still } = await db.from("paid_ad_media").select("id").eq("id", row.id).maybeSingle();
    if (!still) await db.storage.from(MEDIA_BUCKET).remove([path]);
  }
}

/**
 * A download that didn't work: an expired link (403/404/410) or a hopeless file fails for good;
 * anything else waits a minute per attempt and is tried again, up to MEDIA_MAX_ATTEMPTS.
 */
async function finishFailed(row: MediaRow, status: number | null, message?: string, retryable = true) {
  const outcome = failureFor(status);
  const error = (status ? outcome.error : message ?? outcome.error).slice(0, 400);
  const retry = retryable && outcome.retry && row.attempts < MEDIA_MAX_ATTEMPTS;
  await db.from("paid_ad_media").update(retry
    ? { status: "queued", error, lease_until: new Date(Date.now() + retryDelaySeconds(row.attempts) * 1000).toISOString() }
    : { status: "failed", error: status && !outcome.retry ? MEDIA_EXPIRED : error, lease_until: null })
    .eq("id", row.id).eq("status", "downloading");
}

/** Bytes a file's link would download (a HEAD request), or null when the server doesn't say. */
async function linkSize(url: string): Promise<number | null> {
  const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8_000) }).catch(() => null);
  const n = Number(response?.headers.get("content-length"));
  return response?.ok && Number.isFinite(n) && n > 0 ? n : null;
}

/** Guesses for a file whose size the server doesn't give (Meta's typical sizes). */
const SIZE_GUESS: Record<MediaKind, number> = { image: 400_000, poster: 150_000, video: 15_000_000 };

/**
 * The import pop-up's storage check. Given the files an import would store (`files: [{ url, kind }]`), it says
 * how many are already stored, how big the new ones are, which videos are over the upload limit (skipped),
 * how much room is left and how many new files won't fit (left behind: images and posters first, then the
 * smallest videos, until the room runs out). Its decisions are saved under `holdId` for the import to apply.
 */
async function mediaPreview(user: string, productId: string, input: Record<string, any>) {
  await ownProduct(user, productId);
  const holdId = String(input.holdId ?? "");
  if (!/^[0-9a-f-]{36}$/.test(holdId)) throw new HttpError(400, "Which import?");
  const list = (Array.isArray(input.files) ? input.files : []).slice(0, 8000) as { url?: unknown; kind?: unknown }[];
  const byKey = new Map<string, { url: string; kind: MediaKind }>();
  for (const f of list) {
    const url = typeof f?.url === "string" ? f.url : "";
    const kind = (f?.kind === "video" || f?.kind === "poster" ? f.kind : "image") as MediaKind;
    const key = allowedMedia(url) ? urlKey(url) : null;
    if (key && !byKey.has(key)) byKey.set(key, { url, kind });
  }
  const keys = [...byKey.keys()];
  const stored = new Set<string>();
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await db.from("paid_ad_media").select("url_key").eq("product_id", productId).eq("status", "done").in("url_key", keys.slice(i, i + 200));
    for (const row of data ?? []) stored.add(row.url_key as string);
  }
  const fresh = keys.filter((k) => !stored.has(k)).map((k) => ({ key: k, ...byKey.get(k)!, bytes: 0, known: false }));
  // Sizes: HEAD every new file, 48 at a time.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(48, fresh.length) }, async () => {
    for (let i = next++; i < fresh.length; i = next++) {
      const size = await linkSize(fresh[i].url);
      fresh[i].bytes = size ?? SIZE_GUESS[fresh[i].kind];
      fresh[i].known = size !== null;
    }
  }));
  const plan = await mediaPlan();
  const limit = plan.uploadBytes;
  const tooBig = fresh.filter((f) => f.bytes > limit);
  const rest = fresh.filter((f) => f.bytes <= limit)
    .sort((a, b) => (a.kind === "video" ? 1 : 0) - (b.kind === "video" ? 1 : 0) || a.bytes - b.bytes);
  const { data: usedData } = await db.rpc("research_storage_used");
  const used = Number(usedData) || 0;
  const room = Math.max(0, plan.quotaBytes - used);
  let total = 0;
  const fits: typeof rest = [], left: typeof rest = [];
  for (const f of rest) {
    if (total + f.bytes <= room * 0.98) { fits.push(f); total += f.bytes; } else left.push(f);
  }
  const holds: Record<string, string> = {};
  for (const f of tooBig) holds[f.key] = "too_big";
  for (const f of left) holds[f.key] = "no_room";
  await db.from("research_media_holds").upsert({ hold_id: holdId, user_id: user, product_id: productId, holds });
  const sum = (xs: { bytes: number }[]) => xs.reduce((n, x) => n + x.bytes, 0);
  const videos = (xs: { kind: MediaKind }[]) => xs.filter((x) => x.kind === "video").length;
  return {
    files: keys.length, stored: stored.size,
    new: { files: fresh.length, bytes: sum(fresh), unknown: fresh.filter((f) => !f.known).length },
    tooBig: { files: tooBig.length, videos: videos(tooBig), bytes: sum(tooBig), limitBytes: limit },
    fit: { files: fits.length, bytes: total },
    left: { files: left.length, videos: videos(left), bytes: sum(left) },
    storage: { usedBytes: used, quotaBytes: plan.quotaBytes, roomBytes: room },
  };
}

type MediaCounts = { queued: number; downloading: number; done: number; failed: number; bytes: number };
const emptyCounts = (): MediaCounts => ({ queued: 0, downloading: 0, done: 0, failed: 0, bytes: 0 });

/** The workspace's stored media: files by status and bytes stored, in all and per advertiser Page. */
async function mediaStatus(user: string, productId: string) {
  await ownProduct(user, productId);
  const { data, error } = await db.rpc("research_media_counts", { p_product: productId });
  if (error) throw new Error(`Couldn't count the media: ${error.message}`);
  const total = emptyCounts();
  const pages = new Map<string, MediaCounts & { pageId: string | null }>();
  for (const row of (data ?? []) as { page_id: string | null; status: keyof MediaCounts; files: number; bytes: number }[]) {
    const page = pages.get(row.page_id ?? "") ?? { pageId: row.page_id, ...emptyCounts() };
    const files = Number(row.files) || 0;
    if (row.status in total && row.status !== "bytes") {
      total[row.status] += files;
      page[row.status] += files;
    }
    if (row.status === "done") {
      total.bytes += Number(row.bytes) || 0;
      page.bytes += Number(row.bytes) || 0;
    }
    pages.set(row.page_id ?? "", page);
  }
  return { ...total, files: total.queued + total.downloading + total.done + total.failed, pages: [...pages.values()] };
}

/**
 * Deletes the workspace's stored media (one advertiser's with `pageId`): the files in storage and their
 * rows. Ads still in the list fall back to their original (possibly expired) links.
 */
async function mediaClear(user: string, productId: string, pageId: string | null) {
  await ownProduct(user, productId);
  if (pageId !== null && !/^[0-9]{3,30}$/.test(pageId)) throw new HttpError(400, "Which advertiser?");
  const { files, bytes } = await removeMedia(productId, pageId);
  return { files: files + (pageId ? 0 : await clearScanFrames(productId)), bytes };
}

/** Deletes stored media files and their rows: the workspace's, or one advertiser's with `pageId`. */
async function removeMedia(productId: string, pageId: string | null): Promise<{ files: number; bytes: number }> {
  let files = 0, bytes = 0;
  for (let round = 0; round < 200; round++) {
    let query = db.from("paid_ad_media").select("id, storage_path, bytes").eq("product_id", productId);
    if (pageId) query = query.eq("page_id", pageId);
    const { data, error } = await query.limit(1000);
    if (error) throw new Error(`Couldn't read the media: ${error.message}`);
    const rows = (data ?? []) as { id: string; storage_path: string | null; bytes: number | null }[];
    if (!rows.length) break;
    const paths = rows.map((r) => r.storage_path).filter((p): p is string => Boolean(p));
    for (let i = 0; i < paths.length; i += 500) {
      const { error: removeError } = await db.storage.from(MEDIA_BUCKET).remove(paths.slice(i, i + 500));
      if (removeError) throw new Error(`Couldn't delete the files: ${removeError.message}`);
    }
    for (let i = 0; i < rows.length; i += 200) {
      const { error: deleteError } = await db.from("paid_ad_media").delete().in("id", rows.slice(i, i + 200).map((r) => r.id));
      if (deleteError) throw new Error(`Couldn't delete the media rows: ${deleteError.message}`);
    }
    files += rows.length;
    bytes += rows.reduce((sum, r) => sum + (Number(r.bytes) || 0), 0);
  }
  return { files, bytes };
}

/**
 * Takes a competitor (or one of our Pages) off the list with every trace of it: its ads (and their saved
 * versions, by cascade), their stored images and videos and video-scan frames, its scraper import history,
 * and the list entry. Its ads are the ones linked to the entry or posted by its Page.
 */
async function competitorDelete(user: string, productId: string, watchId: string) {
  await ownProduct(user, productId);
  if (!/^[0-9a-f-]{36}$/.test(watchId)) throw new HttpError(400, "Which competitor?");
  const { data: watch } = await db.from("ad_watchlist").select("*").eq("id", watchId).eq("product_id", productId).maybeSingle();
  if (!watch) throw new HttpError(404, "That competitor isn't on the list any more.");
  const w = watch as WatchRow;

  // Its ads: linked to the entry, or from its Page.
  const ads = new Map<string, { id: string; page_id: string | null }>();
  for (const [column, value] of [["watch_id", w.id], ["page_id", w.page_id]] as const) {
    if (!value) continue;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("paid_ads").select("id, page_id").eq("product_id", productId).eq(column, value).order("id").range(from, from + 999);
      if (error) throw new Error(`Couldn't read its ads: ${error.message}`);
      for (const row of (data ?? []) as { id: string; page_id: string | null }[]) ads.set(row.id, row);
      if (!data || data.length < 1000) break;
    }
  }
  const pageIds = [...new Set([w.page_id, ...[...ads.values()].map((a) => a.page_id)].filter((p): p is string => Boolean(p && /^[0-9]{3,30}$/.test(p))))];

  // Stored files first (rows point at them), then the ads, then the history and the entry.
  let files = 0, bytes = 0;
  for (const pageId of pageIds) {
    const removed = await removeMedia(productId, pageId);
    files += removed.files;
    bytes += removed.bytes;
  }
  const ids = [...ads.keys()];
  // Scan frames: one listing of the folder (only scanned ads have one), then those folders 16 at a time.
  // Listing per ad took minutes for a 1,400-ad competitor and the page gave up waiting (Nov 6 2026).
  const idSet = new Set(ids);
  const scanned: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data } = await db.storage.from(MEDIA_BUCKET).list(`${productId}/scan-frames`, { limit: 1000, offset });
    for (const folder of data ?? []) if (idSet.has(folder.name)) scanned.push(folder.name);
    if (!data || data.length < 1000) break;
  }
  for (let i = 0; i < scanned.length; i += 16) {
    const removed = await Promise.all(scanned.slice(i, i + 16).map(async (id) => {
      const root = `${productId}/scan-frames/${id}`;
      const { data: frames } = await db.storage.from(MEDIA_BUCKET).list(root, { limit: 100 });
      const paths = (frames ?? []).map((f) => `${root}/${f.name}`);
      return paths.length && !(await db.storage.from(MEDIA_BUCKET).remove(paths)).error ? paths.length : 0;
    }));
    files += removed.reduce((a, b) => a + b, 0);
  }
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await db.from("paid_ads").delete().in("id", ids.slice(i, i + 200));
    if (error) throw new Error(`Couldn't delete its ads: ${error.message}`);
  }
  let pulls = 0;
  for (const pageId of pageIds) {
    const { data } = await db.from("ad_pulls").delete().eq("product_id", productId).eq("source", "meta_local").eq("input->>page_id", pageId).select("id");
    pulls += data?.length ?? 0;
  }
  const { error } = await db.from("ad_watchlist").delete().eq("id", w.id);
  if (error) throw new Error(`Couldn't take it off the list: ${error.message}`);
  return { deleted: true, ads: ids.length, files, bytes, pulls };
}

/** The video scans' key frames (<product>/scan-frames/<ad>/…), which no paid_ad_media row lists. */
async function clearScanFrames(productId: string): Promise<number> {
  const root = `${productId}/scan-frames`;
  const { data: folders } = await db.storage.from(MEDIA_BUCKET).list(root, { limit: 1000 });
  let removed = 0;
  for (const folder of folders ?? []) {
    const { data: files } = await db.storage.from(MEDIA_BUCKET).list(`${root}/${folder.name}`, { limit: 100 });
    const paths = (files ?? []).map((f) => `${root}/${folder.name}/${f.name}`);
    if (paths.length && !(await db.storage.from(MEDIA_BUCKET).remove(paths)).error) removed += paths.length;
  }
  return removed;
}
