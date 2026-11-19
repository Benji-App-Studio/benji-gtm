import "server-only";
// What starting an analysis would collect and roughly cost, shown before the user confirms. The work
// itself runs in the `radar` edge function (see lib/server/radar.ts).
import type { ProjectRow } from "@/lib/db";
import type { Platform } from "@/lib/types";

/** Apify prices seen on the free plan, per post (Instagram includes its transcript). An estimate. */
const PRICE: Record<Platform, number> = { instagram: 0.0026 + 0.057, tiktok: 0.0017, youtube: 0.0024, x: 0.0004, linkedin: 0.0015 };
const NICHE_TOP = 40;
/** The comments pass: this many most-viewed posts per channel, this many comments each. */
const COMMENTS = { top: 20, perPost: 25 };
/** Apify comment scrapers' prices per comment (channels without one get no extra comments). */
const COMMENT_PRICE: Partial<Record<Platform, number>> = { instagram: 0.0019, tiktok: 0.005, youtube: 0.0009 };
/** Partnership detection: Instagram's scraper per post and per profile, and how much each run reads. */
const PARTNER = { post: 0.0022, profile: 0.0012, campaign: { tagged: 60, ownPosts: 30, bios: 40, detail: 20 }, competitors: { tagged: 30, bios: 40, detail: 10 } };

/** Niche content runs when asked for, and always for a competitor project with nobody picked. */
const nicheOn = (row: ProjectRow) => row.type === "competitors" && Boolean(row.settings.keywords?.length) &&
  (Boolean(row.settings.includeNiche) || !row.candidates.some((c) => c.selected));

export function estimate(row: ProjectRow) {
  const s = row.settings;
  const chosen = row.candidates.filter((c) => c.selected);
  let posts = 0, usd = 0;
  const perPlatform: Partial<Record<Platform, number>> = {};
  for (const candidate of chosen) {
    for (const platform of s.platforms ?? []) {
      if (!candidate.handles[platform]) continue;
      posts += s.limitPerAccount;
      usd += s.limitPerAccount * PRICE[platform];
      perPlatform[platform] = (perPlatform[platform] ?? 0) + s.limitPerAccount;
    }
  }
  const niche = nicheOn(row);
  if (niche) {
    const keywords = Math.min(6, s.keywords?.length ?? 0);
    if (s.platforms.includes("instagram")) { posts += NICHE_TOP; usd += keywords * 30 * 0.0019 + NICHE_TOP * PRICE.instagram; perPlatform.instagram = (perPlatform.instagram ?? 0) + NICHE_TOP; }
    if (s.platforms.includes("tiktok")) { posts += NICHE_TOP; usd += keywords * 30 * PRICE.tiktok; perPlatform.tiktok = (perPlatform.tiktok ?? 0) + NICHE_TOP; }
  }
  let commentsUsd = 0;
  if (s.readComments !== false) {
    for (const [platform, count] of Object.entries(perPlatform) as [Platform, number][]) {
      const price = COMMENT_PRICE[platform];
      if (price) commentsUsd += Math.min(COMMENTS.top, count) * COMMENTS.perPost * price;
    }
  }
  let partnersUsd = 0;
  if (s.partners && row.type === "campaign" && s.brandInstagram) {
    const p = PARTNER.campaign;
    partnersUsd = (p.tagged + p.ownPosts) * PARTNER.post + p.bios * PARTNER.profile + p.detail * PRICE.instagram;
    posts += p.detail;
  } else if (s.partners && row.type === "competitors") {
    const brands = chosen.filter((c) => c.handles.instagram).length;
    if (brands) {
      const p = PARTNER.competitors;
      partnersUsd = brands * p.tagged * PARTNER.post + p.bios * PARTNER.profile + p.detail * PRICE.instagram;
      posts += p.detail;
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return { posts, usd: round(usd + commentsUsd + partnersUsd), commentsUsd: round(commentsUsd), partnersUsd: round(partnersUsd), competitors: chosen.length, niche };
}
