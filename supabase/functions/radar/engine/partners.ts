// Partnerships: which creators post for a brand, and how we know. Four public signals, strongest
// first: a collab post (the brand is a co-author), Instagram's paid-partnership label, a bio that
// declares the tie ("athlete @brand", "ambassador", a personal discount code), and the brand tagged
// or @mentioned in the post. A brand's tagged feed finds creators nobody named; Jev reads the bios.
import type { AiProvider, Judge } from "../../_shared/ai/judge.ts";
import { noul } from "../../_shared/ai/questions.ts";
import { thresholdsFor } from "../../_shared/ai/thresholds.ts";
import { clean, type PartnerBrand, type Profile, type Reel } from "./types.ts";

/** Apify's own Instagram scraper: a profile's tagged feed, its posts, or its details (bio). */
export const INSTAGRAM_SCRAPER = "apify~instagram-scraper";
/** Apify prices seen per item, for estimates. */
export const PARTNER_PRICE = { post: 0.0022, profile: 0.0012 } as const;

const profileUrl = (handle: string) => `https://www.instagram.com/${clean(handle)}/`;
const newerThan = (sinceDays?: number) => (sinceDays ? { onlyPostsNewerThan: `${sinceDays} days` } : {});

export const taggedFeedInput = (handle: string, limit: number, sinceDays?: number) =>
  ({ directUrls: [profileUrl(handle)], resultsType: "mentions", resultsLimit: limit, ...newerThan(sinceDays) });
export const ownPostsInput = (handle: string, limit: number, sinceDays?: number) =>
  ({ directUrls: [profileUrl(handle)], resultsType: "posts", resultsLimit: limit, ...newerThan(sinceDays) });
export const profilesInput = (handles: string[]) =>
  ({ directUrls: handles.map(profileUrl), resultsType: "details", resultsLimit: 1 });

export function profileFrom(item: any): Profile | null {
  const username = String(item?.username ?? "").toLowerCase();
  if (!username) return null;
  return {
    username, fullName: String(item.fullName ?? ""), biography: String(item.biography ?? ""),
    followers: typeof item.followersCount === "number" ? item.followersCount : null,
    verified: Boolean(item.verified), externalUrl: item.externalUrl ?? null,
  };
}

const lower = (handle: string) => clean(handle).toLowerCase();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Which of a brand's signals a post carries. `linked` is true when any does. */
export function postSignals(reel: Reel, brand: PartnerBrand) {
  const handle = lower(brand.instagram);
  const own = lower(reel.owner) === handle;
  const coauthors = (reel.coauthors ?? []).filter((c) => c !== handle);
  const collab = own ? coauthors.length > 0 : (reel.coauthors ?? []).includes(handle);
  const tagged = !own && (reel.taggedUsers ?? []).includes(handle);
  const mentioned = !own && ((reel.mentions ?? []).includes(handle) || new RegExp(`@${escape(handle)}(?![\\w.])`, "i").test(reel.caption));
  const linked = collab || tagged || mentioned;
  return { collab, tagged, mentioned, paid: Boolean(reel.paidPartnership) && (linked || own), linked };
}

/** The creators behind a brand-linked post: its author, or for the brand's own collab post, its co-authors. */
export function creatorsOf(reel: Reel, brand: PartnerBrand): string[] {
  const handle = lower(brand.instagram);
  return lower(reel.owner) === handle ? (reel.coauthors ?? []).filter((c) => c !== handle) : [lower(reel.owner)];
}

/** Creators whose bios are worth reading, most-linked first: everyone linked to a brand, plus `extra`. */
export function bioCandidates(posts: Reel[], brands: PartnerBrand[], extra: string[], cap: number): string[] {
  const brandHandles = new Set(brands.map((b) => lower(b.instagram)));
  const counts = new Map<string, number>();
  for (const reel of posts) {
    for (const brand of brands) {
      if (!postSignals(reel, brand).linked) continue;
      for (const creator of creatorsOf(reel, brand)) if (!brandHandles.has(creator)) counts.set(creator, (counts.get(creator) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([creator]) => creator);
  return [...new Set([...extra.map(lower).filter((h) => h && !brandHandles.has(h)), ...ranked])].slice(0, cap);
}

/** Whether a bio names the brand at all (its handle, or its name as a word). Only these go to Jev. */
export function bioNames(bio: string, brand: PartnerBrand): boolean {
  if (!bio) return false;
  const handle = lower(brand.instagram);
  if (new RegExp(`@${escape(handle)}(?![\\w.])`, "i").test(bio)) return true;
  const name = brand.name.trim();
  return name.length >= 3 && new RegExp(`(^|[^\\w])${escape(name)}([^\\w]|$)`, "i").test(bio);
}

export const verdictKey = (brand: PartnerBrand, creator: string) => `${lower(brand.instagram)}|${lower(creator)}`;

/** Jev reads each bio that names a brand: does it declare a working tie? Returns a probability per brand and creator. */
export async function judgeBios(client: Judge, profiles: Profile[], brands: PartnerBrand[]): Promise<Record<string, number>> {
  const checks = profiles.flatMap((profile) => brands.filter((brand) => bioNames(profile.biography, brand)).map((brand) => ({ profile, brand })));
  const verdicts: Record<string, number> = {};
  const queue = [...checks];
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let check = queue.shift(); check; check = queue.shift()) {
      try {
        const { answers } = await client.systemOne({
          state: { brand: `${check.brand.name} (@${lower(check.brand.instagram)} on Instagram)`, creator: `@${check.profile.username}`, bio: check.profile.biography.slice(0, 600) },
          questions: {
            tie: noul(
              "Does the creator's `bio` say they work with, for or represent `brand`: as an athlete, ambassador, partner, team member or employee, or with a personal discount or affiliate code for it?",
              { true: "The bio declares an ongoing tie to the brand (role, team, partnership, or a discount or affiliate code).", false: "The bio only mentions the brand in passing, praises it, or names it for another reason; no declared tie." },
            ),
          },
        });
        verdicts[verdictKey(check.brand, check.profile.username)] = (answers.tie as { noul: number }).noul;
      } catch {
        // An unread bio just means no bio signal for that creator.
      }
    }
  }));
  return verdicts;
}

export interface PartnerCreator {
  handle: string;
  account: string;
  followers: number | null;
  verified: boolean;
  bio: string | null;
  /** How many of the creator's posts carry each signal; `bio` is Jev's confidence that the bio declares the tie. */
  signals: { collab: number; paid: number; tagged: number; mentioned: number; bio: number | null };
  /** Confirmed: a collab, the paid label or a declared bio. Likely: tags or mentions only. */
  strength: "confirmed" | "likely";
  posts: number;
  bestPost: string | null;
  bestViews: number;
  profileUrl: string;
}

export interface PartnerProgram {
  brand: string;
  handle: string;
  creators: PartnerCreator[];
  /** Brand-linked posts found (any format, including images). */
  posts: number;
}

/** Whether a bio verdict counts as a declared tie, for the judge that gave it (`judge.provider`; left out: TypeSafe, as before). */
export const bioDeclares = (probability: number, provider?: AiProvider) => probability >= thresholdsFor(provider).partners.bioDeclared;

/**
 * Every brand's creators, from all the posts seen in a run, their profiles and the judge's bio verdicts.
 * `provider` is the judge that read the bios (`judge.provider`): its thresholds decide what a verdict
 * means (_shared/ai/thresholds.ts). Left out, the TypeSafe values apply, as before.
 */
export function partnerPrograms(posts: Reel[], brands: PartnerBrand[], profiles: Profile[], verdicts: Record<string, number>, provider?: AiProvider): PartnerProgram[] {
  const at = thresholdsFor(provider).partners;
  const byHandle = new Map(profiles.map((p) => [p.username, p]));
  const brandHandles = new Set(brands.map((b) => lower(b.instagram)));
  const unique = [...new Map(posts.map((p) => [p.id, p])).values()];
  return brands.map((brand) => {
    const found = new Map<string, { signals: PartnerCreator["signals"]; posts: Reel[] }>();
    const entry = (creator: string) => {
      if (!found.has(creator)) found.set(creator, { signals: { collab: 0, paid: 0, tagged: 0, mentioned: 0, bio: null }, posts: [] });
      return found.get(creator)!;
    };
    let linkedPosts = 0;
    for (const reel of unique) {
      const s = postSignals(reel, brand);
      if (!s.linked && !s.paid) continue;
      const creators = creatorsOf(reel, brand).filter((c) => !brandHandles.has(c));
      if (!creators.length) continue;
      linkedPosts++;
      for (const creator of creators) {
        const e = entry(creator);
        if (s.collab) e.signals.collab++;
        if (s.paid) e.signals.paid++;
        if (s.tagged) e.signals.tagged++;
        if (s.mentioned) e.signals.mentioned++;
        e.posts.push(reel);
      }
    }
    // A declared bio counts even when the creator's posts never tag the brand.
    for (const [key, probability] of Object.entries(verdicts)) {
      const [brandHandle, creator] = key.split("|");
      if (brandHandle !== lower(brand.instagram) || brandHandles.has(creator)) continue;
      if (probability >= at.bioDeclared || found.has(creator)) {
        const e = entry(creator);
        e.signals.bio = probability;
        if (!e.posts.length) e.posts.push(...unique.filter((r) => lower(r.owner) === creator));
      }
    }
    const creators = [...found.entries()].map(([handle, e]): PartnerCreator => {
      const profile = byHandle.get(handle);
      const best = [...e.posts].sort((a, b) => b.views - a.views)[0];
      const confirmed = e.signals.collab > 0 || e.signals.paid > 0 || (e.signals.bio ?? 0) >= at.bioConfirmed;
      return {
        handle, account: `@${handle}`, followers: profile?.followers ?? null, verified: profile?.verified ?? false,
        bio: profile && bioNames(profile.biography, brand) ? profile.biography.slice(0, 280) : null,
        signals: e.signals, strength: confirmed ? "confirmed" : "likely", posts: e.posts.length,
        bestPost: best?.id ?? null, bestViews: best?.views ?? 0, profileUrl: `https://www.instagram.com/${handle}/`,
      };
    }).sort((a, b) => Number(b.strength === "confirmed") - Number(a.strength === "confirmed")
      || (b.signals.collab + b.signals.paid + b.signals.tagged + b.signals.mentioned) - (a.signals.collab + a.signals.paid + a.signals.tagged + a.signals.mentioned)
      || (b.followers ?? 0) - (a.followers ?? 0));
    return { brand: brand.name, handle: lower(brand.instagram), creators, posts: linkedPosts };
  });
}

/** A campaign keeps a post when it's linked to the brand, labelled paid, names the brand, or comes from a bio-declared partner. */
export function campaignKeeps(reel: Reel, brands: PartnerBrand[], words: string[], bioPartners: Set<string>): boolean {
  if (reel.paidPartnership || bioPartners.has(lower(reel.owner))) return true;
  if (brands.some((brand) => postSignals(reel, brand).linked)) return true;
  const text = `${reel.caption} ${reel.transcript.map((s) => s.text).join(" ")}`.toLowerCase();
  return words.some((word) => text.includes(word.toLowerCase()));
}
