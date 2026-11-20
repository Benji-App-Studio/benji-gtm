// Shapes shared by the studio's server and pages. Projects mirror the engine's src/projects.ts;
// report data mirrors what the engine's build step writes to data.json.
// Labels shown in the UI are marked with m() and rendered with t(label) (lib/i18n).
import { m } from "./i18n/translate";

export type Platform = "instagram" | "tiktok" | "youtube" | "x" | "linkedin";
export const PLATFORMS: Platform[] = ["instagram", "tiktok", "youtube", "x", "linkedin"];
export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube Shorts", x: "X", linkedin: "LinkedIn",
};
/** Channels whose collectors have run against real data; the rest are marked beta. */
export const PLATFORM_BETA: Record<Platform, boolean> = { instagram: false, tiktok: true, youtube: true, x: true, linkedin: true };

export type ProjectStatus = "draft" | "discovering" | "review" | "analyzing" | "ready" | "error";

/** What a project analyses: a founder's competitors (found for them), one account, or a brand campaign. */
export type ProjectType = "competitors" | "account" | "campaign";
export const TYPE_COPY: Record<ProjectType, {
  label: string; blurb: string;
  /** Capitalized singular and plural, for a column or a stat. */
  one: string; many: string;
  /** Whole sentences per kind (word order differs by language). */
  pick: string; change: string; review: string;
}> = {
  competitors: {
    label: m("My competitors"), blurb: m("Starts from your app's profile: finds your competitors and what wins for them on each channel."),
    one: m("Competitor"), many: m("Competitors"), pick: m("Pick the competitors for {name}"), change: m("Change competitors and settings"), review: m("Review competitors"),
  },
  account: {
    label: m("One account"), blurb: m("Every post from one account across its channels, optionally side by side with others."),
    one: m("Account"), many: m("Accounts"), pick: m("Pick the accounts for {name}"), change: m("Change accounts and settings"), review: m("Review accounts"),
  },
  campaign: {
    label: m("A brand campaign"), blurb: m("Many creators posting for one brand: the best UGC, the creators worth rebooking and how the brand shows up."),
    one: m("Creator"), many: m("Creators"), pick: m("Pick the creators for {name}"), change: m("Change creators and settings"), review: m("Review creators"),
  },
};

export interface Candidate {
  id: string;
  name: string;
  handles: Partial<Record<Platform, string>>;
  bio: string;
  followers: number | null;
  verified: boolean;
  website: string | null;
  kind: string;
  kindConfidence: number;
  similarity: number;
  source: "search" | "you" | "ai";
  foundBy: string[];
  selected: boolean;
}

export interface Project {
  id: string;
  /** Absent on projects made before types existed: those are competitor projects. */
  type?: ProjectType;
  name: string;
  description: string;
  website?: string;
  category: string;
  answers: Record<string, string>;
  keywords: string[];
  platforms: Platform[];
  sinceDays: number;
  limitPerAccount: number;
  /** Campaigns: the brand and the words that mark a post as part of the campaign. */
  brand?: string;
  mentions?: string[];
  /** Partnership detection (campaigns: the brand's creators; competitors: each one's creator program). */
  partners?: boolean;
  brandInstagram?: string;
  status: ProjectStatus;
  message?: string;
  candidates: Candidate[];
  createdAt: string;
  updatedAt: string;
  demo?: boolean;
}

/** What starting an analysis would collect and roughly cost. */
export interface Estimate { posts: number; usd: number; commentsUsd?: number; partnersUsd?: number; competitors: number; niche?: boolean }

/** A run's live progress, written by the backend and streamed to the page. */
export interface RunProgress {
  stage?: "collect" | "expand" | "comments" | "decode" | "finish" | "done";
  steps?: { key: string; label: string; status: "pending" | "running" | "done" | "failed"; count: number | null; error: string | null }[];
  total?: number | null;
  decoded?: number;
  apifyUsd?: number;
}

export interface RunStatus {
  phase: "idle" | "collecting" | "discovering" | "decoding" | "done" | "error";
  total: number;
  decoded: number;
  jevInputTokens: number;
  apifyUsd: number;
  collectedAt?: string;
  message?: string;
}

export interface ScriptLine { text: string; start?: number; role: string | null; visual?: string | null }

export interface Post {
  id: string;
  platform: Platform;
  url: string;
  owner: string;
  account: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
  shares: number | null;
  saves: number | null;
  followers: number | null;
  likesPer1k: number;
  engagementPer1k: number;
  durationSec: number | null;
  postedAt: string | null;
  thumb: string | null;
  multiple: number;
  outlier: number | null;
  viewsPerDay: number | null;
  viewsPerFollower: number | null;
  format: string | null;
  formatConfidence: number | null;
  hookType: string | null;
  buyerIntent: number | null;
  onTopic: number | null;
  hasCta: boolean;
  brandMoment: { sentence: number; of: number; start: number | null } | null;
  script: ScriptLine[];
  /** Comments Jev read, each with its audience theme (absent on older reports). */
  commentList?: { text: string; theme: string | null }[];
  hashtags?: string[];
  /** Found by the niche search rather than from a studied account. */
  niche?: boolean;
  /** Found through a brand's partnership signals: that brand's name. */
  partnerOf?: string | null;
  paidPartnership?: boolean;
  coauthors?: string[];
  taggedUsers?: string[];
  mentions?: string[];
  score: number;
  reasons: string[];
}

export interface Ranked { id: string; posts: number; medianViews: number; medianScore: number }

export interface PlaybookChannel {
  platform: Platform;
  posts: number;
  formats: Ranked[];
  hooks: Ranked[];
  lengths: Ranked[];
  examples: { id: string; hook: string; hookType: string | null; account: string; views: number; score: number; format: string | null }[];
  structures: { shape: string; count: number }[];
  ctaWinners: number;
  ctaRest: number;
  intentWinners: number | null;
}

export interface ChannelSummary {
  reels: number;
  medianViews: number;
  hitRate: number;
  medianEngagement: number;
  medianViewsPerDay: number;
  followers: number | null;
  bestReel: string | null;
  topFormat: string | null;
}

export interface Report {
  slug: string;
  title: string;
  subject: string;
  sinceDays: number | null;
  status: RunStatus | null;
  hitMultiple: number;
  kpis: { videos: number; decoded: number; creators: number; platforms: number; sorted: number; formats: number; typicalViews: number; jevUsd: number; apifyUsd: number; totalUsd: number };
  formats: { id: string; name: string; description: string }[];
  channels: {
    platforms: (ChannelSummary & { platform: Platform; accounts: number })[];
    accounts: (ChannelSummary & { platform: Platform; account: string })[];
  };
  playbook: PlaybookChannel[];
  audience?: Audience;
  creators?: Creator[];
  partners?: PartnerProgram[] | null;
  reels: Post[];
}

export interface Audience {
  total: number;
  posts: number;
  themes: { theme: string; count: number; share: number; examples: { text: string; account: string; platform: Platform; postId: string }[] }[];
  byPlatform: Partial<Record<Platform, { total: number; themes: Record<string, number> }>>;
  byAccount: { account: string; total: number; buyShare: number; objectionShare: number; questionShare: number; topTheme: string | null }[];
}

export interface Creator {
  platform: Platform;
  owner: string;
  account: string;
  posts: number;
  medianViews: number;
  bestViews: number;
  hitRate: number;
  medianIntent: number | null;
  followers: number | null;
  viewsPerFollower: number | null;
  bestReel: string;
  topFormat: string | null;
  profileUrl: string;
  score: number;
}

/** A creator who posts for a brand, and the public signals that show it. */
export interface PartnerCreator {
  handle: string;
  account: string;
  followers: number | null;
  verified: boolean;
  bio: string | null;
  signals: { collab: number; paid: number; tagged: number; mentioned: number; bio: number | null };
  strength: "confirmed" | "likely";
  posts: number;
  bestPost: string | null;
  bestViews: number;
  profileUrl: string;
}

export interface PartnerProgram { brand: string; handle: string; creators: PartnerCreator[]; posts: number }

/** What commenters are doing, as Jev sorts each comment. */
export const THEME_LABEL: Record<string, { label: string; hint: string }> = {
  buy_intent: { label: m("Want to buy"), hint: m("asking for the link or price, or saying they bought") },
  how_question: { label: m("How does it work?"), hint: m("questions about using it or getting the result") },
  objection: { label: m("Objections"), hint: m("price, trust, fit or 'it doesn't work for me'") },
  feature_request: { label: m("Wish lists"), hint: m("asking for something it doesn't do yet") },
  relates: { label: m("“This is me”"), hint: m("recognising their own problem or situation") },
  tag_friend: { label: m("Tagging friends"), hint: m("sending it to someone") },
  praise: { label: m("Praise"), hint: m("loving the post or the product") },
  skeptic: { label: m("Skeptics"), hint: m("doubting the claim or calling it an ad") },
  other: { label: m("Other"), hint: m("everything else") },
};

export const VISUAL_LABEL: Record<string, string> = {
  talking_head: m("Talking to camera"), screen_demo: m("Screen recording"), product_shot: m("Product close-up"), text_on_screen: m("Text on screen"),
  broll: m("B-roll / scenery"), proof_shot: m("Proof (results, reviews)"), reaction: m("Reaction"), skit: m("Skit / acted scene"),
};

export const HOOK_LABEL: Record<string, string> = {
  question: m("Question"), bold_claim: m("Bold claim"), number_list: m("Number / list"), story: m("Story"), pov: m("POV / scene"),
  warning: m("Warning"), news: m("News"), how_to: m("How to"), curiosity_gap: m("Curiosity gap"), other: m("Other"),
};

export const ROLE_LABEL: Record<string, string> = {
  hook: m("Hook"), setup: m("Context"), product: m("Product shows up"), method: m("Method"), benefit: m("Benefit"), proof: m("Proof"), cta: m("CTA"), other: m("Other"),
};

/** The beat names the AI prompts use (English, as they always were): the page says "Context", the prompt "Setup". */
export const ROLE_PROMPT_NAME: Record<string, string> = { ...ROLE_LABEL, setup: "Setup" };

export const KIND_LABEL: Record<string, string> = {
  direct_competitor: m("Direct competitor"), adjacent_brand: m("Adjacent brand"), creator: m("Creator"), media_or_community: m("Media / community"),
  retailer_or_marketplace: m("Retailer"), unrelated: m("Unrelated"),
};
