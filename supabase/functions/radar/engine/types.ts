// Shapes shared by the engine, the `radar` edge function and the command-line tools. Nothing here
// touches a runtime API, so it runs the same under Deno (Supabase Edge Functions) and Node (CLI).

export type Platform = "instagram" | "tiktok" | "youtube" | "x" | "linkedin";
export const PLATFORMS: Platform[] = ["instagram", "tiktok", "youtube", "x", "linkedin"];

/** Jev's list price: input tokens only, output is free. */
export const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

// MARK: Workflows

/** Another account to compare against, by its handle on each platform. */
export interface CompareAccount {
  label: string;
  instagram?: string;
  tiktok?: string;
  youtube?: string;
}

/** Every reel from one account, read top to bottom. */
export interface AccountWorkflow {
  mode: "account";
  title: string;
  /** Transcribe speech (Apify charges per minute); without it, formats come from captions only. */
  transcripts?: boolean;
  /** Platforms to collect; Instagram only when absent. */
  platforms?: Platform[];
  /** The Instagram handle. */
  handle: string;
  tiktok?: string;
  youtube?: string;
  /** Other accounts shown side by side with this one. */
  compareWith?: CompareAccount[];
  limit: number;
}

/** Many creators posting for one brand, like a UGC deal. */
export interface CampaignWorkflow {
  mode: "campaign";
  title: string;
  transcripts?: boolean;
  platforms?: Platform[];
  brand: string;
  /** Instagram creator handles. */
  handles: string[];
  tiktokHandles?: string[];
  youtubeChannels?: string[];
  /** Words that mark a reel as part of the campaign (caption or transcript). */
  mentions: string[];
  limitPerHandle: number;
}

/** The niche around a product: top reels for its topics plus named competitor accounts. */
export interface CompetitorsWorkflow {
  mode: "competitors";
  title: string;
  transcripts?: boolean;
  platforms?: Platform[];
  tiktokAccounts?: string[];
  youtubeChannels?: string[];
  product: string;
  productDescription: string;
  keywords: string[];
  /** Competitor accounts: every reel up to `limitPerAccount` is kept, whatever its views. */
  accounts: string[];
  limitPerKeyword: number;
  limitPerAccount: number;
  /** How many of the best-performing reels get transcribed and decoded. */
  decodeTop: number;
}

/** A competitor to analyse, by its handle on each channel it distributes on. */
export interface Competitor {
  name: string;
  instagram?: string;
  tiktok?: string;
  youtube?: string;
  x?: string;
  /** A LinkedIn company or profile URL, or a company slug. */
  linkedin?: string;
}

/** A project run: a founder's product and the competitors (or accounts) chosen for it. */
export interface ProjectWorkflow {
  mode: "project";
  title: string;
  transcripts?: boolean;
  platforms?: Platform[];
  product: string;
  productDescription: string;
  competitors: Competitor[];
  /** A brand campaign: the brand, and the words that mark a post as part of it. */
  brand?: string;
  mentions?: string[];
  /** Niche search terms: the top posts around them are analysed too (on their own when there are no competitors). */
  keywords?: string[];
  /** Who buys the product, so niche posts aimed at the same people count as on-topic. */
  audience?: string;
  /** How many of the niche's best posts per platform to decode. */
  nicheTop?: number;
  /** A comments pass for the most-viewed posts per platform (more comments → better intent and audience insights). */
  comments?: { top: number; perPost: number };
  /** What the studied accounts are called in progress labels: competitor, account or creator. */
  accountNoun?: string;
  /**
   * Partnership detection: for each brand, the creators who post for it (collab posts, the brand
   * tagged or @mentioned, the paid-partnership label, or a bio that declares the tie).
   */
  partners?: PartnerConfig;
  /** Only posts from the last this many days. */
  sinceDays: number;
  limitPerAccount: number;
}

export type Workflow = AccountWorkflow | CampaignWorkflow | CompetitorsWorkflow | ProjectWorkflow;

// MARK: Data

export interface Segment {
  text: string;
  /** Seconds from the start, when the transcript has timings. */
  start?: number;
}

export interface Reel {
  id: string;
  platform: Platform;
  url: string;
  owner: string;
  /** The account this reel is compared under (single-account comparisons); otherwise the owner. */
  account?: string;
  followers: number | null;
  shares: number | null;
  saves: number | null;
  caption: string;
  hashtags: string[];
  views: number;
  likes: number;
  comments: number;
  durationSec: number | null;
  postedAt: string | null;
  thumb: string | null;
  paidPartnership: boolean;
  /** Where it was found: a keyword, an account or a campaign handle. */
  source: string;
  transcript: Segment[];
  /** Comments, when the platform or the comments pass returns them: Jev reads them for buying intent. */
  topComments?: string[];
  /** Found by a niche keyword search rather than from a named account. */
  niche?: boolean;
  /** Instagram: the post's co-authors (collab posts), tagged accounts and @mentions, lowercased. */
  coauthors?: string[];
  taggedUsers?: string[];
  mentions?: string[];
  /** Found through a brand's partnership signals (its tagged feed or collab posts): that brand's name. */
  partnerOf?: string;
}

export interface PartnerBrand {
  name: string;
  /** The brand's Instagram handle, without @. */
  instagram: string;
}

export interface PartnerConfig {
  brands: PartnerBrand[];
  /** Posts to read from each brand's tagged feed. */
  tagged: number;
  /** Also read the brand's own posts for collab co-authors (competitors' own reels are collected anyway). */
  ownPosts: number;
  /** At most this many creators' bios are checked. */
  bios: number;
  /** Partner reels that get a full scrape with transcripts (the best by views). */
  detail: number;
}

/** A creator's public profile, for bio checks. */
export interface Profile {
  username: string;
  fullName: string;
  biography: string;
  followers: number | null;
  verified: boolean;
  externalUrl: string | null;
}

export type Role = "hook" | "setup" | "product" | "method" | "benefit" | "proof" | "cta" | "other";

export interface Decoded {
  id: string;
  format: string;
  formatConfidence: number;
  formatProbabilities: Record<string, number>;
  /** Each sentence's job, and (video) what is most likely on screen while it's said. */
  roles: { text: string; start?: number; role: Role; confidence: number; visual?: string }[];
  hookType: string | null;
  /** Each comment Jev read, with the audience theme it falls under. */
  comments: { text: string; theme: string }[];
  /** How strongly the comments show people wanting to buy or try what's shown (null without comments). */
  buyerIntent: number | null;
  /** How likely it names a product (null for paid ads, which always do). */
  mentionsProduct: number | null;
  /** Niche posts only: how likely the reel is about the niche at all (keyword search pulls in strays). */
  onTopic: number | null;
  inputTokens: number;
}

export interface Format {
  id: string;
  name: string;
  description: string;
}

export interface Status {
  phase: "idle" | "collecting" | "discovering" | "decoding" | "done" | "error";
  total: number;
  decoded: number;
  jevInputTokens: number;
  apifyUsd: number;
  startedAt: string;
  updatedAt: string;
  collectedAt?: string;
  message?: string;
}

// MARK: Competitor discovery

export interface Candidate {
  id: string;
  name: string;
  /** Handles per channel; discovery fills Instagram and TikTok, bios add the rest, the founder can edit. */
  handles: Partial<Record<Platform, string>>;
  bio: string;
  followers: number | null;
  verified: boolean;
  website: string | null;
  /** Jev's read: direct competitor, adjacent brand, creator, media, retailer or unrelated. */
  kind: string;
  kindConfidence: number;
  /** 0–4: how close to the founder's product. */
  similarity: number;
  source: "search" | "you" | "ai";
  foundBy: string[];
  selected: boolean;
}

/** What competitor discovery needs to know about the founder's product. */
export interface DiscoveryProject {
  name: string;
  description: string;
  website?: string;
  category: string;
  answers: Record<string, string>;
  keywords: string[];
  platforms: Platform[];
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const clean = (handle: string) => handle.trim().replace(/^@/, "");
