// Shapes shared by the studio's server and pages. Projects mirror the engine's src/projects.ts;
// report data mirrors what the engine's build step writes to data.json.

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
export const TYPE_COPY: Record<ProjectType, { label: string; noun: string; nouns: string; blurb: string }> = {
  competitors: { label: "My competitors", noun: "competitor", nouns: "competitors", blurb: "Starts from your app's profile: finds your competitors and what wins for them on each channel." },
  account: { label: "One account", noun: "account", nouns: "accounts", blurb: "Every post from one account across its channels, optionally side by side with others." },
  campaign: { label: "A brand campaign", noun: "creator", nouns: "creators", blurb: "Many creators posting for one brand: the best UGC, the creators worth rebooking and how the brand shows up." },
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
  buy_intent: { label: "Want to buy", hint: "asking for the link or price, or saying they bought" },
  how_question: { label: "How does it work?", hint: "questions about using it or getting the result" },
  objection: { label: "Objections", hint: "price, trust, fit or 'it doesn't work for me'" },
  feature_request: { label: "Wish lists", hint: "asking for something it doesn't do yet" },
  relates: { label: "“This is me”", hint: "recognising their own problem or situation" },
  tag_friend: { label: "Tagging friends", hint: "sending it to someone" },
  praise: { label: "Praise", hint: "loving the post or the product" },
  skeptic: { label: "Skeptics", hint: "doubting the claim or calling it an ad" },
  other: { label: "Other", hint: "everything else" },
};

export const VISUAL_LABEL: Record<string, string> = {
  talking_head: "Talking to camera", screen_demo: "Screen recording", product_shot: "Product close-up", text_on_screen: "Text on screen",
  broll: "B-roll / scenery", proof_shot: "Proof (results, reviews)", reaction: "Reaction", skit: "Skit / acted scene",
};

export const HOOK_LABEL: Record<string, string> = {
  question: "Question", bold_claim: "Bold claim", number_list: "Number / list", story: "Story", pov: "POV / scene",
  warning: "Warning", news: "News", how_to: "How to", curiosity_gap: "Curiosity gap", other: "Other",
};

export const ROLE_LABEL: Record<string, string> = {
  hook: "Hook", setup: "Setup", product: "Product shows up", method: "Method", benefit: "Benefit", proof: "Proof", cta: "CTA", other: "Other",
};

export const KIND_LABEL: Record<string, string> = {
  direct_competitor: "Direct competitor", adjacent_brand: "Adjacent brand", creator: "Creator", media_or_community: "Media / community",
  retailer_or_marketplace: "Retailer", unrelated: "Unrelated",
};
