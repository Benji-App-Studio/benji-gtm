// A project run's collection, as a plan of independent Apify scrapes: every chosen competitor on every
// channel it has a handle for (batched where the owner identifies the competitor), plus the niche's
// best posts around the project's keywords. The edge worker runs the plan in parallel; the CLI runs
// it in order. Either way the results come together in `assemble`.
import { commentsInput, COMMENT_ACTORS, pickForComments } from "./comments.ts";
import {
  ACTORS, dedupe, instagramHashtagInput, instagramReel, instagramReelsInput, linkedinInput, linkedinReels, mentioning,
  tiktokInput, tiktokReels, xInput, xReels, youtubeInput, youtubeReels, type RawInstagram,
} from "./collectors.ts";
import { INSTAGRAM_SCRAPER, ownPostsInput, taggedFeedInput } from "./partners.ts";
import { clean, PLATFORMS, type Platform, type ProjectWorkflow, type Reel } from "./types.ts";

export interface ScrapeSpec {
  key: string;
  actor: string;
  input: unknown;
  /** Shown in progress: "Instagram · 8 competitors". */
  label: string;
  platform: Platform;
  /** The competitor a per-account scrape belongs to, or the niche keyword. */
  account?: string;
  keyword?: string;
  /** Partnership scrapes: the brand whose creators this finds. */
  partnerOf?: string;
}

const NICHE_KEYWORDS = 6;
const NICHE_POOL = 30;

const platformsOf = (w: ProjectWorkflow) => new Set<Platform>(w.platforms?.length ? w.platforms : ["instagram"]);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Every scrape the first stage needs. */
export function planCollection(w: ProjectWorkflow): ScrapeSpec[] {
  const platforms = platformsOf(w);
  const transcripts = w.transcripts ?? true;
  const since = w.sinceDays, limit = w.limitPerAccount;
  const noun = w.accountNoun ?? (w.brand ? "creator" : "competitor");
  const handles = (platform: Platform) => w.competitors.flatMap((c) => (c[platform] ? [c[platform]!] : []));
  const specs: ScrapeSpec[] = [];
  if (platforms.has("instagram") && handles("instagram").length) {
    specs.push({ key: "ig", platform: "instagram", actor: ACTORS.instagramReels, label: `Instagram · ${plural(handles("instagram").length, noun)}`,
      input: instagramReelsInput({ usernames: handles("instagram").map(clean), limit, sinceDays: since, transcripts }) });
  }
  if (platforms.has("tiktok") && handles("tiktok").length) {
    specs.push({ key: "tt", platform: "tiktok", actor: ACTORS.tiktok, label: `TikTok · ${plural(handles("tiktok").length, noun)}`,
      input: tiktokInput({ profiles: handles("tiktok"), limit, transcripts, sinceDays: since }) });
  }
  w.competitors.forEach((c, i) => {
    if (platforms.has("youtube") && c.youtube) specs.push({ key: `yt:${i}`, platform: "youtube", actor: ACTORS.youtube, account: c.name, label: `YouTube · ${c.name}`, input: youtubeInput({ channels: [c.youtube], limit, sinceDays: since }) });
    if (platforms.has("x") && c.x) specs.push({ key: `x:${i}`, platform: "x", actor: ACTORS.x, account: c.name, label: `X · ${c.name}`, input: xInput({ handles: [c.x], limit, sinceDays: since }) });
    if (platforms.has("linkedin") && c.linkedin) specs.push({ key: `li:${i}`, platform: "linkedin", actor: ACTORS.linkedin, account: c.name, label: `LinkedIn · ${c.name}`, input: linkedinInput({ companies: [c.linkedin], limit, sinceDays: since }) });
  });
  // The niche: the best posts around the project's keywords, from anyone (the fallback when there are
  // no competitors, and context alongside them when there are).
  (w.keywords ?? []).slice(0, NICHE_KEYWORDS).forEach((keyword, i) => {
    if (platforms.has("instagram")) specs.push({ key: `niche-ig:${i}`, platform: "instagram", actor: ACTORS.instagramHashtags, keyword, label: `Instagram niche · “${keyword}”`, input: instagramHashtagInput(keyword, NICHE_POOL) });
    if (platforms.has("tiktok")) specs.push({ key: `niche-tt:${i}`, platform: "tiktok", actor: ACTORS.tiktok, keyword, label: `TikTok niche · “${keyword}”`, input: tiktokInput({ searches: [keyword], limit: NICHE_POOL, transcripts, sinceDays: since }) });
  });
  // Partnerships: each brand's tagged feed (creators who tag it), and its own posts for collab co-authors.
  (w.partners?.brands ?? []).forEach((brand, i) => {
    specs.push({ key: `partner-tag:${i}`, platform: "instagram", actor: INSTAGRAM_SCRAPER, partnerOf: brand.name, label: `Partners · posts tagging @${clean(brand.instagram)}`, input: taggedFeedInput(brand.instagram, w.partners!.tagged, since) });
    if (w.partners!.ownPosts) specs.push({ key: `partner-own:${i}`, platform: "instagram", actor: INSTAGRAM_SCRAPER, partnerOf: brand.name, label: `Partners · @${clean(brand.instagram)}'s collab posts`, input: ownPostsInput(brand.instagram, w.partners!.ownPosts, since) });
  });
  return specs;
}

/** Partner scrapes keep image posts too: they count as partnership signals, though only videos are analysed. */
function partnerPosts(spec: Pick<ScrapeSpec, "key" | "partnerOf">, items: RawInstagram[], w: ProjectWorkflow): Reel[] {
  const brand = w.partners?.brands.find((b) => b.name === spec.partnerOf);
  const handle = brand ? clean(brand.instagram).toLowerCase() : "";
  return items.flatMap((raw) => {
    const reel = instagramReel(raw, "", true);
    if (!reel) return [];
    // The brand's own collab post belongs to its co-author; its other posts aren't creator content.
    const own = reel.owner.toLowerCase() === handle;
    const creator = own ? (reel.coauthors ?? []).find((c) => c !== handle) : reel.owner.toLowerCase();
    return creator ? [{ ...reel, partnerOf: spec.partnerOf, account: `@${creator}` }] : [];
  });
}

/** A finished scrape's items as reels. */
export async function reelsFrom(spec: Pick<ScrapeSpec, "key" | "account" | "keyword" | "partnerOf">, items: any[], w: ProjectWorkflow): Promise<Reel[]> {
  const transcripts = w.transcripts ?? true;
  const kind = spec.key.split(":")[0];
  const tag = (reels: Reel[]) => (spec.account ? reels.map((reel) => ({ ...reel, account: spec.account })) : reels);
  switch (kind) {
    case "ig": case "niche-ig-detail": case "partner-detail": return (items as RawInstagram[]).flatMap((raw) => instagramReel(raw, "") ?? []);
    case "partner-tag": case "partner-own": return partnerPosts(spec, items as RawInstagram[], w);
    case "niche-ig": return (items as RawInstagram[]).flatMap((raw) => instagramReel(raw, spec.keyword ?? "") ?? []);
    case "tt": return tiktokReels(items, { transcripts, source: () => "" });
    case "niche-tt": return tiktokReels(items, { transcripts, source: () => spec.keyword ?? "" });
    case "yt": return tag(youtubeReels(items, () => ""));
    case "x": return tag(xReels(items, { limit: w.limitPerAccount, source: () => "" }));
    case "li": return tag(linkedinReels(items, () => ""));
    default: return [];
  }
}

/** Instagram's niche search returns no transcripts: the best of its pool get a second, detailed scrape. */
export function nicheInstagramBest(w: ProjectWorkflow, outputs: Record<string, Reel[]>): Reel[] {
  const knownIds = new Set(Object.entries(outputs).filter(([key]) => !key.startsWith("niche")).flatMap(([, reels]) => reels.map((r) => r.id)));
  const pool = Object.entries(outputs).filter(([key]) => key.startsWith("niche-ig:")).flatMap(([, reels]) => reels);
  return dedupe(pool).filter((reel) => !knownIds.has(reel.id)).sort((a, b) => b.views - a.views).slice(0, w.nicheTop ?? 40);
}

export function planNicheDetail(w: ProjectWorkflow, best: Reel[]): ScrapeSpec | null {
  if (!best.length) return null;
  return { key: "niche-ig-detail", platform: "instagram", actor: ACTORS.instagramReels, label: `Instagram niche · transcripts for the top ${best.length}`,
    input: instagramReelsInput({ usernames: best.map((reel) => reel.url), limit: 1, transcripts: w.transcripts ?? true }) };
}

/** Partner videos worth a full scrape with transcripts: the most-viewed, up to the configured number. */
export function planPartnerDetail(w: ProjectWorkflow, outputs: Record<string, Reel[]>): ScrapeSpec | null {
  if (!w.partners?.detail) return null;
  const known = new Set(Object.entries(outputs).filter(([k]) => !k.startsWith("partner")).flatMap(([, reels]) => reels.map((r) => r.id)));
  const best = dedupe(Object.entries(outputs).filter(([k]) => k.startsWith("partner-tag:") || k.startsWith("partner-own:")).flatMap(([, reels]) => reels))
    .filter((r) => r.durationSec != null && r.views > 0 && !known.has(r.id)).sort((a, b) => b.views - a.views).slice(0, w.partners.detail);
  if (!best.length) return null;
  return { key: "partner-detail", platform: "instagram", actor: ACTORS.instagramReels, label: `Partners · transcripts for the top ${best.length}`,
    input: instagramReelsInput({ usernames: best.map((reel) => reel.url), limit: 1, transcripts: w.transcripts ?? true }) };
}

/** Every post a run saw, images included: what partnership signals are counted from. */
export function signalPosts(outputs: Record<string, Reel[]>): Reel[] {
  return Object.entries(outputs).filter(([k]) => !k.startsWith("comments")).flatMap(([, reels]) => reels);
}

/** Everything collected, as the run's posts: tagged with their account, in the window, deduped. */
export function assemble(w: ProjectWorkflow, outputs: Record<string, Reel[]>, igBest: Reel[]): Reel[] {
  const key = (platform: Platform, handle: string) => `${platform}:${clean(handle).toLowerCase()}`;
  const owners = new Map<string, string>();
  for (const competitor of w.competitors) {
    for (const platform of PLATFORMS) {
      const handle = competitor[platform];
      if (handle) owners.set(key(platform, handle), competitor.name);
    }
  }
  const detailedPartners = new Map((outputs["partner-detail"] ?? []).map((reel) => [reel.id, reel]));
  const found: Reel[] = Object.entries(outputs).filter(([k]) => !k.startsWith("niche") && k !== "partner-detail").flatMap(([, reels]) => reels)
    // Partner posts take their transcript from the detailed scrape, keeping who they're for.
    .map((reel) => (reel.partnerOf && detailedPartners.has(reel.id) ? { ...detailedPartners.get(reel.id)!, partnerOf: reel.partnerOf, account: reel.account } : reel));
  const knownIds = new Set(found.map((reel) => reel.id));
  if (igBest.length) {
    const detailed = new Map((outputs["niche-ig-detail"] ?? []).map((reel) => [reel.id, reel]));
    found.push(...igBest.map((reel) => ({ ...(detailed.get(reel.id) ?? reel), source: reel.source, niche: true, account: `@${reel.owner}` })));
  }
  const tiktokPool = Object.entries(outputs).filter(([k]) => k.startsWith("niche-tt:")).flatMap(([, reels]) => reels);
  found.push(...dedupe(tiktokPool).filter((reel) => !knownIds.has(reel.id)).sort((a, b) => b.views - a.views).slice(0, w.nicheTop ?? 40)
    .map((reel) => ({ ...reel, niche: true, account: `@${reel.owner}` })));

  const cutoff = Date.now() - w.sinceDays * 86_400_000;
  let reels: Reel[] = found
    .map((reel) => {
      const account = reel.account ?? owners.get(key(reel.platform, reel.owner)) ?? `@${reel.owner}`;
      return { ...reel, account, source: reel.niche ? reel.source : account };
    })
    // Every actor is asked for the window; this catches any that return older posts anyway.
    .filter((reel) => !reel.postedAt || Date.parse(reel.postedAt) >= cutoff);
  // With partnership detection on, a campaign filters later, once creators' bios have been read.
  if (w.mentions?.length && !w.partners) reels = mentioning(reels, w.mentions);
  return dedupe(reels).filter((reel) => reel.views > 0);
}

/** The comments pass, as one scrape per channel. */
export function planComments(w: ProjectWorkflow, reels: Reel[]): (ScrapeSpec & { postIds: string[] })[] {
  if (!w.comments) return [];
  return pickForComments(reels, w.comments.top).map(({ platform, reels: picked }) => ({
    key: `comments:${platform}`, platform, actor: COMMENT_ACTORS[platform]!, postIds: picked.map((r) => r.id),
    label: `Comments · ${plural(picked.length, "top post")} on ${platform === "instagram" ? "Instagram" : platform === "tiktok" ? "TikTok" : "YouTube"}`,
    input: commentsInput(platform, picked.map((r) => r.url), w.comments!.perPost),
  }));
}
