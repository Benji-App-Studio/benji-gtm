// The "Send to Meta" rules: what a campaign, ad set and ad may be set to, the defaults the playbook
// picks, and every validation, in plain words. Pure and import-free, so the studio's sheet and the
// launch function check exactly the same things.
//
// KEEP IN SYNC: studio/src/lib/launch/rules.ts is a byte-for-byte copy (a Deno test checks it).
//
// The field surface mirrors Meta's official Ads MCP (ads_create_campaign / ads_create_ad_set /
// ads_create_creative / ads_update_entity), implemented against the Graph Marketing API in
// pipeline.ts. Money here is in major units (dollars, rupees); pipeline.ts converts with toMinor.

// MARK: Objectives and performance goals

export const META_OBJECTIVES = [
  "OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_APP_PROMOTION",
] as const;
export type MetaObjective = (typeof META_OBJECTIVES)[number];

export const OBJECTIVE_INFO: Record<MetaObjective, { label: string; hint: string }> = {
  OUTCOME_AWARENESS: { label: "Awareness", hint: "Show the ad to as many people as possible. Nobody is asked to do anything." },
  OUTCOME_TRAFFIC: { label: "Traffic", hint: "Send people to a website or app page." },
  OUTCOME_ENGAGEMENT: { label: "Engagement", hint: "Video views, post likes and comments. Good for warming up a new ad account." },
  OUTCOME_LEADS: { label: "Leads", hint: "Collect sign-ups on your website." },
  OUTCOME_SALES: { label: "Sales", hint: "Purchases or trials on your website (needs a pixel)." },
  OUTCOME_APP_PROMOTION: { label: "App promotion", hint: "Installs, or trials and purchases inside the app." },
};

/** Performance goals each objective allows, the default first (the table Meta's Ads MCP enforces). */
export const OBJECTIVE_GOALS: Record<MetaObjective, readonly string[]> = {
  OUTCOME_AWARENESS: ["REACH", "IMPRESSIONS", "AD_RECALL_LIFT", "THRUPLAY", "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS"],
  OUTCOME_TRAFFIC: ["LINK_CLICKS", "LANDING_PAGE_VIEWS", "OFFSITE_CONVERSIONS", "IMPRESSIONS", "POST_ENGAGEMENT", "REACH", "CONVERSATIONS", "THRUPLAY", "VISIT_INSTAGRAM_PROFILE", "PROFILE_VISIT", "QUALITY_CALL", "REMINDERS_SET"],
  OUTCOME_ENGAGEMENT: ["THRUPLAY", "POST_ENGAGEMENT", "EVENT_RESPONSES", "PAGE_LIKES", "IMPRESSIONS", "REACH", "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS", "LINK_CLICKS", "CONVERSATIONS", "OFFSITE_CONVERSIONS", "LANDING_PAGE_VIEWS", "QUALITY_CALL"],
  OUTCOME_LEADS: ["OFFSITE_CONVERSIONS", "LEAD_GENERATION", "QUALITY_LEAD", "LANDING_PAGE_VIEWS", "LINK_CLICKS", "IMPRESSIONS", "REACH", "VALUE", "CONVERSATIONS", "QUALITY_CALL"],
  OUTCOME_SALES: ["OFFSITE_CONVERSIONS", "VALUE", "LANDING_PAGE_VIEWS", "IMPRESSIONS", "POST_ENGAGEMENT", "REACH", "LINK_CLICKS", "CONVERSATIONS"],
  OUTCOME_APP_PROMOTION: ["APP_INSTALLS", "OFFSITE_CONVERSIONS", "IMPRESSIONS", "LINK_CLICKS", "REACH", "VALUE"],
};

export const GOAL_INFO: Record<string, { label: string; hint: string }> = {
  REACH: { label: "Reach", hint: "As many different people as possible." },
  IMPRESSIONS: { label: "Impressions", hint: "As many showings as possible, repeats included." },
  AD_RECALL_LIFT: { label: "Ad recall lift", hint: "People likely to remember the ad." },
  THRUPLAY: { label: "ThruPlay", hint: "Video watched to the end (or 15 seconds)." },
  TWO_SECOND_CONTINUOUS_VIDEO_VIEWS: { label: "2-second video views", hint: "At least 2 seconds of the video in a row." },
  LINK_CLICKS: { label: "Link clicks", hint: "Clicks on the ad's link." },
  LANDING_PAGE_VIEWS: { label: "Landing page views", hint: "Clicks where the page actually loaded (needs a pixel)." },
  OFFSITE_CONVERSIONS: { label: "Conversions", hint: "A tracked event: a purchase, trial or sign-up." },
  POST_ENGAGEMENT: { label: "Post engagement", hint: "Likes, comments and shares." },
  CONVERSATIONS: { label: "Conversations", hint: "Messages to your business." },
  VISIT_INSTAGRAM_PROFILE: { label: "Instagram profile visits", hint: "Visits to your Instagram profile." },
  PROFILE_VISIT: { label: "Profile visits", hint: "Visits to your Facebook Page or Instagram profile." },
  QUALITY_CALL: { label: "Calls", hint: "Phone calls to your business." },
  REMINDERS_SET: { label: "Reminders", hint: "People setting a reminder for an event." },
  EVENT_RESPONSES: { label: "Event responses", hint: "RSVPs to a Facebook event." },
  PAGE_LIKES: { label: "Page likes", hint: "Follows of your Facebook Page." },
  LEAD_GENERATION: { label: "Leads (instant form)", hint: "A form inside Facebook or Instagram." },
  QUALITY_LEAD: { label: "Conversion leads", hint: "Leads likely to become customers." },
  VALUE: { label: "Conversion value", hint: "The highest purchase value (ROAS)." },
  APP_INSTALLS: { label: "App installs", hint: "Installs of the app." },
};

/** Billing events beyond IMPRESSIONS (which every goal accepts), only in their valid pairing. */
export const BILLING_PAIRS: Record<string, readonly string[]> = {
  LINK_CLICKS: ["LINK_CLICKS"],
  THRUPLAY: ["THRUPLAY"],
  PAGE_LIKES: ["PAGE_LIKES"],
  POST_ENGAGEMENT: ["POST_ENGAGEMENT"],
  APP_INSTALLS: ["APP_INSTALLS"],
};
export const billingFor = (goal: string): string[] => ["IMPRESSIONS", ...(BILLING_PAIRS[goal] ?? [])];

export const goalsFor = (objective: MetaObjective): readonly string[] => OBJECTIVE_GOALS[objective] ?? [];

/** The Launch settings objective → the campaign objective it means. */
export const objectiveFromSettings = (objective: string): MetaObjective =>
  objective === "app_promotion" ? "OUTCOME_APP_PROMOTION" : "OUTCOME_TRAFFIC";

// MARK: Destinations

export const DESTINATION_INFO: Record<string, string> = {
  WEBSITE: "Website", APP: "App", MESSENGER: "Messenger", WHATSAPP: "WhatsApp", INSTAGRAM_DIRECT: "Instagram Direct",
  PHONE_CALL: "Phone call", ON_AD: "Instant form", ON_POST: "The ad's post", ON_PAGE: "Your Page", ON_VIDEO: "The ad's video",
  ON_EVENT: "A Facebook event", INSTAGRAM_PROFILE: "Instagram profile", FACEBOOK_PAGE: "Facebook Page",
};

/**
 * Where an ad set may send people for this objective and goal, the default first. `required` means
 * Meta rejects the goal without one; an empty list means the field is left out.
 */
export function destinationsFor(objective: MetaObjective, goal: string): { options: string[]; required: boolean } {
  if (objective === "OUTCOME_APP_PROMOTION" || objective === "OUTCOME_AWARENESS") return { options: [], required: false };
  if (goal === "CONVERSATIONS") return { options: objective === "OUTCOME_LEADS" ? ["WHATSAPP"] : ["MESSENGER", "WHATSAPP", "INSTAGRAM_DIRECT"], required: true };
  if (objective === "OUTCOME_ENGAGEMENT") {
    const pinned: Record<string, string> = { POST_ENGAGEMENT: "ON_POST", PAGE_LIKES: "ON_PAGE", THRUPLAY: "ON_VIDEO", TWO_SECOND_CONTINUOUS_VIDEO_VIEWS: "ON_VIDEO", EVENT_RESPONSES: "ON_EVENT" };
    if (pinned[goal]) return { options: [pinned[goal]], required: true };
  }
  if (goal === "VISIT_INSTAGRAM_PROFILE") return { options: ["INSTAGRAM_PROFILE"], required: true };
  if (goal === "PROFILE_VISIT") return { options: ["FACEBOOK_PAGE", "INSTAGRAM_PROFILE"], required: true };
  if (goal === "QUALITY_CALL") return { options: ["PHONE_CALL"], required: true };
  if (goal === "LEAD_GENERATION" || goal === "QUALITY_LEAD") return { options: ["ON_AD"], required: true };
  if (goal === "REMINDERS_SET") return { options: [], required: false };
  return { options: ["WEBSITE"], required: false };
}

/** Destinations whose ads need something this sheet doesn't build (a lead form, a message flow, an existing post…). */
export const UNSUPPORTED_AD_DESTINATIONS: Record<string, string> = {
  ON_AD: "Instant-form lead ads need a lead form, which this sheet doesn't build. Use website conversions, or make the ad in Ads Manager.",
  MESSENGER: "Message ads need a chat greeting, which this sheet doesn't build. Make them in Ads Manager.",
  WHATSAPP: "WhatsApp ads need a chat greeting, which this sheet doesn't build. Make them in Ads Manager.",
  INSTAGRAM_DIRECT: "Instagram Direct ads need a chat greeting, which this sheet doesn't build. Make them in Ads Manager.",
  ON_POST: "Post engagement ads promote an existing Page post, which this sheet doesn't pick. Make them in Ads Manager.",
  PHONE_CALL: "Call ads need a phone number on the button, which this sheet doesn't set. Make them in Ads Manager.",
  ON_EVENT: "Event ads promote a Facebook event, which this sheet doesn't pick. Make them in Ads Manager.",
};

// MARK: What the ad set promotes

export const PIXEL_EVENTS = ["PURCHASE", "START_TRIAL", "SUBSCRIBE", "COMPLETE_REGISTRATION", "LEAD", "ADD_TO_CART", "INITIATED_CHECKOUT", "ADD_PAYMENT_INFO", "CONTENT_VIEW", "SEARCH", "CONTACT", "OTHER"] as const;
export const APP_EVENTS = ["START_TRIAL", "PURCHASE", "SUBSCRIBE", "COMPLETE_REGISTRATION", "ADD_TO_CART", "ADD_PAYMENT_INFO", "LEVEL_ACHIEVED", "ACHIEVEMENT_UNLOCKED", "CONTENT_VIEW", "OTHER"] as const;

export interface PromotedObject {
  pixelId?: string;
  customEventType?: string;
  customConversionId?: string;
  applicationId?: string;
  objectStoreUrl?: string;
  pageId?: string;
}

export type PromotedNeed = "app" | "app_event" | "pixel_event" | "page" | null;

/** What promoted_object the goal needs (and whether Meta rejects the ad set without it). */
export function promotedNeed(objective: MetaObjective, goal: string, destination?: string | null): { need: PromotedNeed; required: boolean } {
  if (objective === "OUTCOME_APP_PROMOTION") {
    if (goal === "OFFSITE_CONVERSIONS" || goal === "VALUE") return { need: "app_event", required: true };
    return { need: "app", required: true };
  }
  if (goal === "OFFSITE_CONVERSIONS" || goal === "VALUE") return { need: "pixel_event", required: true };
  if (objective === "OUTCOME_SALES" && (destination ?? "WEBSITE") === "WEBSITE") return { need: "pixel_event", required: true };
  if (["LEAD_GENERATION", "QUALITY_LEAD", "PAGE_LIKES", "CONVERSATIONS"].includes(goal)) return { need: "page", required: true };
  if (destination && ["ON_POST", "ON_PAGE", "ON_VIDEO", "ON_EVENT", "MESSENGER", "WHATSAPP", "INSTAGRAM_DIRECT", "FACEBOOK_PAGE"].includes(destination)) return { need: "page", required: true };
  return { need: null, required: false };
}

// MARK: Bidding

export const BID_STRATEGIES = ["LOWEST_COST_WITHOUT_CAP", "COST_CAP", "LOWEST_COST_WITH_BID_CAP", "LOWEST_COST_WITH_MIN_ROAS"] as const;
export type BidStrategy = (typeof BID_STRATEGIES)[number];
export const BID_INFO: Record<BidStrategy, { label: string; hint: string }> = {
  LOWEST_COST_WITHOUT_CAP: { label: "Highest volume", hint: "Meta gets as many results as the budget allows. The playbook's default." },
  COST_CAP: { label: "Cost per result goal", hint: "Keeps the average cost per result near an amount you set." },
  LOWEST_COST_WITH_BID_CAP: { label: "Bid cap", hint: "Never bids more than an amount you set in any auction." },
  LOWEST_COST_WITH_MIN_ROAS: { label: "ROAS goal", hint: "Keeps return on ad spend above a floor (needs purchase values)." },
};

// MARK: Calls to action

export const CTA_LABEL: Record<string, string> = {
  INSTALL_MOBILE_APP: "Install now", INSTALL_APP: "Install app", USE_APP: "Use app", USE_MOBILE_APP: "Use mobile app", DOWNLOAD: "Download",
  PLAY_GAME: "Play game", UPDATE_APP: "Update app", LEARN_MORE: "Learn more", SIGN_UP: "Sign up", SUBSCRIBE: "Subscribe",
  GET_STARTED: "Get started", SEE_MORE: "See more", FIND_OUT_MORE: "Find out more", VISIT_WEBSITE: "Visit website", GET_DETAILS: "Get details",
  OPEN_LINK: "Open link", NO_BUTTON: "No button", SHOP_NOW: "Shop now", BUY_NOW: "Buy now", ORDER_NOW: "Order now", GET_OFFER: "Get offer",
  VIEW_PRODUCT: "View product", ADD_TO_CART: "Add to cart", BOOK_NOW: "Book now", APPLY_NOW: "Apply now", GET_QUOTE: "Get quote",
  CONTACT_US: "Contact us", INQUIRE_NOW: "Inquire now", WATCH_MORE: "Watch more", WATCH_VIDEO: "Watch video", LISTEN_NOW: "Listen now",
};

/** Calls to action Meta accepts for each objective, the default first. */
export const OBJECTIVE_CTAS: Record<MetaObjective, readonly string[]> = {
  OUTCOME_APP_PROMOTION: ["INSTALL_MOBILE_APP", "DOWNLOAD", "USE_APP", "INSTALL_APP", "USE_MOBILE_APP", "PLAY_GAME", "SIGN_UP", "SUBSCRIBE", "LEARN_MORE", "GET_OFFER", "SHOP_NOW", "BOOK_NOW", "ORDER_NOW", "WATCH_MORE", "LISTEN_NOW", "UPDATE_APP"],
  OUTCOME_TRAFFIC: ["LEARN_MORE", "SIGN_UP", "SUBSCRIBE", "DOWNLOAD", "GET_OFFER", "SHOP_NOW", "BUY_NOW", "ORDER_NOW", "BOOK_NOW", "GET_STARTED", "SEE_MORE", "VISIT_WEBSITE", "FIND_OUT_MORE", "GET_DETAILS", "OPEN_LINK", "APPLY_NOW", "GET_QUOTE", "CONTACT_US", "WATCH_MORE", "LISTEN_NOW"],
  OUTCOME_SALES: ["SHOP_NOW", "SIGN_UP", "SUBSCRIBE", "BUY_NOW", "ORDER_NOW", "GET_OFFER", "LEARN_MORE", "BOOK_NOW", "DOWNLOAD", "GET_STARTED", "ADD_TO_CART", "VIEW_PRODUCT", "SEE_MORE", "CONTACT_US", "APPLY_NOW"],
  OUTCOME_LEADS: ["SIGN_UP", "APPLY_NOW", "GET_QUOTE", "SUBSCRIBE", "LEARN_MORE", "DOWNLOAD", "GET_OFFER", "BOOK_NOW", "CONTACT_US", "INQUIRE_NOW", "GET_STARTED"],
  OUTCOME_ENGAGEMENT: ["LEARN_MORE", "WATCH_MORE", "SEE_MORE", "SIGN_UP", "SHOP_NOW", "GET_OFFER", "DOWNLOAD", "BOOK_NOW", "SUBSCRIBE", "LISTEN_NOW", "NO_BUTTON"],
  OUTCOME_AWARENESS: ["LEARN_MORE", "SEE_MORE", "WATCH_MORE", "SHOP_NOW", "SIGN_UP", "DOWNLOAD", "SUBSCRIBE", "GET_OFFER", "BOOK_NOW", "LISTEN_NOW", "NO_BUTTON"],
};

export const ctasFor = (objective: MetaObjective): readonly string[] => OBJECTIVE_CTAS[objective] ?? OBJECTIVE_CTAS.OUTCOME_TRAFFIC;

/** A creative's CTA text ("Download free", "Install now", "SIGN_UP") → a CTA Meta accepts for the objective. */
export function ctaFor(text: string | null | undefined, objective: MetaObjective): string {
  const allowed = ctasFor(objective);
  const app = objective === "OUTCOME_APP_PROMOTION";
  const t = (text ?? "").trim().toUpperCase().replace(/[^A-Z]+/g, "_").replace(/^_+|_+$/g, "");
  if (allowed.includes(t)) return t;
  const s = t.replace(/_/g, " ");
  const pick = (v: string) => (allowed.includes(v) ? v : allowed[0]);
  if (/INSTALL|GET THE APP|GET APP/.test(s)) return pick(app ? "INSTALL_MOBILE_APP" : "DOWNLOAD");
  if (/DOWNLOAD/.test(s)) return pick("DOWNLOAD");
  if (/SIGN ?UP|JOIN|REGISTER|START|TRY/.test(s)) return pick("SIGN_UP");
  if (/SUBSCRIBE/.test(s)) return pick("SUBSCRIBE");
  if (/SHOP|BUY/.test(s)) return pick("SHOP_NOW");
  if (/OPEN|USE/.test(s) && app) return pick("USE_APP");
  return allowed[0];
}

// MARK: Placements

export const PLATFORMS = ["facebook", "instagram", "messenger", "audience_network", "threads"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABEL: Record<Platform, string> = { facebook: "Facebook", instagram: "Instagram", messenger: "Messenger", audience_network: "Audience Network", threads: "Threads" };

export const POSITIONS: Record<Platform, readonly string[]> = {
  facebook: ["feed", "profile_feed", "marketplace", "video_feeds", "right_hand_column", "story", "facebook_reels", "facebook_reels_overlay", "instream_video", "search", "biz_disco_feed", "notification"],
  instagram: ["stream", "profile_feed", "explore", "explore_home", "story", "reels", "profile_reels", "ig_search"],
  messenger: ["messenger_home", "story"],
  audience_network: ["classic", "rewarded_video"],
  threads: ["threads_stream"],
};

export const POSITION_LABEL: Record<string, string> = {
  feed: "Feed", profile_feed: "Profile feed", marketplace: "Marketplace", video_feeds: "Video feeds", right_hand_column: "Right column",
  story: "Stories", facebook_reels: "Reels", facebook_reels_overlay: "Ads on Reels", instream_video: "In-stream video", search: "Search results",
  biz_disco_feed: "Business Explore", notification: "Notifications", stream: "Feed", explore: "Explore", explore_home: "Explore home",
  reels: "Reels", profile_reels: "Profile reels", ig_search: "Search results", messenger_home: "Inbox", classic: "Native, banner and interstitial",
  rewarded_video: "Rewarded video", threads_stream: "Feed",
};

/** Where an ad set shows (manual placements) or, in a placement customisation, where one asset is used. */
export interface PlacementRule {
  publisher_platforms: Platform[];
  facebook_positions?: string[];
  instagram_positions?: string[];
  messenger_positions?: string[];
  audience_network_positions?: string[];
  threads_positions?: string[];
}

const positionKey = (p: Platform) => `${p}_positions` as const;

/** What's wrong with a placement rule (empty when fine). */
export function placementErrors(rule: PlacementRule, objective?: MetaObjective): string[] {
  const out: string[] = [];
  const platforms = rule.publisher_platforms ?? [];
  if (!platforms.length) out.push("Pick at least one platform.");
  for (const p of platforms) if (!PLATFORMS.includes(p)) out.push(`Unknown platform: ${p}.`);
  for (const p of PLATFORMS) {
    const positions = rule[positionKey(p)] ?? [];
    if (positions.length && !platforms.includes(p)) out.push(`${PLATFORM_LABEL[p]} positions are set but ${PLATFORM_LABEL[p]} isn't picked.`);
    for (const pos of positions) if (!POSITIONS[p].includes(pos)) out.push(`${PLATFORM_LABEL[p]} has no "${pos}" placement.`);
  }
  if (objective === "OUTCOME_APP_PROMOTION" && platforms.includes("threads")) out.push("Threads isn't available for App promotion.");
  return out;
}

/** Whether two placement rules could serve the same placement. */
export function rulesOverlap(a: PlacementRule, b: PlacementRule): boolean {
  for (const p of a.publisher_platforms ?? []) {
    if (!(b.publisher_platforms ?? []).includes(p)) continue;
    const pa = a[positionKey(p)] ?? [];
    const pb = b[positionKey(p)] ?? [];
    if (!pa.length || !pb.length || pa.some((x) => pb.includes(x))) return true;
  }
  return false;
}

/** Presets for placement customisation: a 4:5 for feeds and a 9:16 for Stories and Reels. */
export const FEEDS_RULE: PlacementRule = { publisher_platforms: ["facebook", "instagram"], facebook_positions: ["feed", "profile_feed", "marketplace", "video_feeds", "search"], instagram_positions: ["stream", "profile_feed", "explore", "explore_home", "ig_search"] };
export const VERTICAL_RULE: PlacementRule = { publisher_platforms: ["facebook", "instagram", "messenger"], facebook_positions: ["story", "facebook_reels"], instagram_positions: ["story", "reels", "profile_reels"], messenger_positions: ["story"] };

// MARK: Places

/** EU member states: targeting any of them needs the Digital Services Act beneficiary and payor. */
export const EU_COUNTRIES = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"] as const;

export const SPECIAL_AD_CATEGORIES = ["HOUSING", "EMPLOYMENT", "FINANCIAL_PRODUCTS_SERVICES", "ISSUES_ELECTIONS_POLITICS"] as const;

// MARK: Specs (what the sheet sends)

export type BudgetMode = "CBO" | "ABO";

export interface CampaignSpec {
  name: string;
  objective: MetaObjective;
  /** CBO: the campaign holds the budget and the bid strategy. ABO: each ad set has its own. */
  budgetMode: BudgetMode;
  dailyBudget?: number | null;
  lifetimeBudget?: number | null;
  bidStrategy?: BidStrategy | null;
  /** Most the campaign may ever spend. */
  spendCap?: number | null;
  startTime?: string | null;
  stopTime?: string | null;
  specialAdCategories?: string[];
  specialAdCountries?: string[];
  /** SKAdNetwork attribution for iOS app campaigns. */
  skadnetwork?: boolean;
}

export interface GeoPick {
  key: string;
  name: string;
  type: "country" | "region" | "city";
  /** The country the region or city is in (for the EU check). */
  countryCode?: string;
  radius?: number | null;
  distanceUnit?: "mile" | "kilometer";
}

export interface Named { id: string; name: string }

export interface TargetingSpec {
  locations: GeoPick[];
  excludedLocations?: GeoPick[];
  ageMin: number;
  ageMax: number;
  genders: "all" | "men" | "women";
  locales?: { key: number; name: string }[];
  audiences?: Named[];
  excludedAudiences?: Named[];
  /** Only ids from Meta's interest search. */
  interests?: Named[];
  /** Advantage+ audience: Meta may go beyond the age and interests (they become suggestions). */
  advantageAudience: boolean;
  /** "advantage" leaves every placement field out (Advantage+ placements). */
  placements: "advantage" | PlacementRule;
}

export interface ScheduleBlock { days: number[]; startMinute: number; endMinute: number }

export interface AdSetSpec {
  name: string;
  optimizationGoal: string;
  billingEvent: string;
  destinationType?: string | null;
  promotedObject?: PromotedObject;
  dailyBudget?: number | null;
  lifetimeBudget?: number | null;
  bidStrategy?: BidStrategy | null;
  bidAmount?: number | null;
  /** Minimum ROAS, as a multiple (2 = 2.00×). */
  roasFloor?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  /** Day-parting (lifetime budgets only). Days 0 = Sunday … 6; minutes from midnight in the account's time zone. */
  schedule?: ScheduleBlock[];
  /** For reach goals: at most `impressions` showings per person every `days` days. */
  frequencyCap?: { impressions: number; days: number } | null;
  /** Leave out for Meta's default (7-day click, 1-day view). */
  attribution?: { clickDays: 1 | 7; viewDays: 0 | 1; engagedViewDays?: 0 | 1 } | null;
  dsaBeneficiary?: string | null;
  dsaPayor?: string | null;
  targeting: TargetingSpec;
}

/** The parent campaign, from a new spec or Meta's listing. */
export interface ParentCampaign {
  objective: MetaObjective;
  budgetMode: BudgetMode;
  /** The campaign's budget is a lifetime budget (CBO). */
  lifetime?: boolean;
  bidStrategy?: string | null;
  specialAdCategories?: string[];
}

export type AdFormat = "single" | "carousel" | "placements";
export type AiDisclosure = "OPT_IN" | "OPT_OUT";

export interface AdCreativeRef { id: string; kind: "image" | "video"; aspect?: string }

export interface AdSpec {
  /** single: one ad per creative. carousel: one ad, a card per creative. placements: one ad, an asset per placement. */
  format: AdFormat;
  creatives: AdCreativeRef[];
  pageId: string;
  instagramId?: string | null;
  primaryText: string;
  headline: string;
  description?: string | null;
  cta: string;
  link: string;
  displayLink?: string | null;
  urlTags?: string | null;
  advantageCreative: boolean;
  /** Required, no default: the person sending says whether the media was made with AI. */
  aiDisclosure: AiDisclosure | null;
  /** Carousel: one card per creative, in order; copy falls back to the shared headline and link. */
  cards?: { creativeId: string; headline?: string; description?: string; link?: string }[];
  /** Placement customisation: exactly one entry with rule null (the fallback). */
  placements?: { creativeId: string; rule: PlacementRule | null }[];
  /** Single format: per-creative copy over the shared copy. */
  perCreative?: Record<string, { primaryText?: string; headline?: string; description?: string }>;
}

// MARK: Defaults (the playbook's)

export interface DefaultsInput {
  objective: MetaObjective;
  stage: "TEST" | "SCALE";
  countries: string[];
  appId?: string;
  appStoreUrl?: string;
  pixelId?: string;
  pageId?: string;
  optimizeFor?: "install" | "trial" | "purchase";
  testingBudget?: number | null;
  scalingBudget?: number | null;
  appName?: string;
}

/** Testing is ABO (budgets on the ad sets), scaling is CBO (budget on the campaign). */
export function defaultCampaign(name: string, d: DefaultsInput): CampaignSpec {
  const cbo = d.stage === "SCALE";
  return {
    name, objective: d.objective, budgetMode: cbo ? "CBO" : "ABO",
    dailyBudget: cbo ? d.scalingBudget ?? 50 : null, lifetimeBudget: null,
    bidStrategy: cbo ? "LOWEST_COST_WITHOUT_CAP" : null, spendCap: null, startTime: null, stopTime: null,
    specialAdCategories: [], specialAdCountries: [], skadnetwork: d.objective === "OUTCOME_APP_PROMOTION",
  };
}

/** The deepest event the connections allow (trial or purchase over install; conversions over clicks). */
export function defaultGoal(d: Pick<DefaultsInput, "objective" | "optimizeFor" | "pixelId">): { goal: string; event?: string } {
  switch (d.objective) {
    case "OUTCOME_APP_PROMOTION":
      return d.optimizeFor === "trial" ? { goal: "OFFSITE_CONVERSIONS", event: "START_TRIAL" }
        : d.optimizeFor === "purchase" ? { goal: "OFFSITE_CONVERSIONS", event: "PURCHASE" } : { goal: "APP_INSTALLS" };
    case "OUTCOME_SALES": return { goal: "OFFSITE_CONVERSIONS", event: d.optimizeFor === "trial" ? "START_TRIAL" : "PURCHASE" };
    case "OUTCOME_LEADS": return d.pixelId ? { goal: "OFFSITE_CONVERSIONS", event: "LEAD" } : { goal: "LINK_CLICKS" };
    case "OUTCOME_TRAFFIC": return { goal: d.pixelId ? "LANDING_PAGE_VIEWS" : "LINK_CLICKS" };
    case "OUTCOME_ENGAGEMENT": return { goal: "THRUPLAY" };
    default: return { goal: "REACH" };
  }
}

/** The promoted object a goal needs, filled from the workspace's connections. */
export function defaultPromoted(objective: MetaObjective, goal: string, destination: string | null | undefined, d: Pick<DefaultsInput, "appId" | "appStoreUrl" | "pixelId" | "pageId">, event?: string): PromotedObject | undefined {
  const { need } = promotedNeed(objective, goal, destination);
  if (need === "app") return { applicationId: d.appId, objectStoreUrl: d.appStoreUrl };
  if (need === "app_event") return { applicationId: d.appId, objectStoreUrl: d.appStoreUrl, customEventType: event ?? "START_TRIAL" };
  if (need === "pixel_event") return { pixelId: d.pixelId, customEventType: event ?? (objective === "OUTCOME_LEADS" ? "LEAD" : "PURCHASE") };
  if (need === "page") return { pageId: d.pageId };
  if (goal === "LANDING_PAGE_VIEWS" && d.pixelId) return { pixelId: d.pixelId };
  return undefined;
}

/** A broad ad set: the workspace's countries, 18–65, Advantage+ audience and placements, the deepest event. */
export function defaultAdSet(name: string, d: DefaultsInput, parent: ParentCampaign): AdSetSpec {
  const { goal, event } = defaultGoal({ objective: parent.objective, optimizeFor: d.optimizeFor, pixelId: d.pixelId });
  const destination = destinationsFor(parent.objective, goal).options[0] ?? null;
  const abo = parent.budgetMode === "ABO";
  return {
    name, optimizationGoal: goal, billingEvent: "IMPRESSIONS", destinationType: destination,
    promotedObject: defaultPromoted(parent.objective, goal, destination, d, event),
    dailyBudget: abo ? d.testingBudget ?? 20 : null, lifetimeBudget: null,
    bidStrategy: abo ? "LOWEST_COST_WITHOUT_CAP" : null, bidAmount: null, roasFloor: null,
    startTime: null, endTime: null, schedule: [], frequencyCap: null, attribution: null,
    dsaBeneficiary: d.appName ?? null, dsaPayor: d.appName ?? null,
    targeting: {
      locations: (d.countries.length ? d.countries : ["US"]).map((c) => ({ key: c, name: c, type: "country" as const, countryCode: c })),
      excludedLocations: [], ageMin: 18, ageMax: 65, genders: "all", locales: [], audiences: [], excludedAudiences: [], interests: [],
      advantageAudience: true, placements: "advantage",
    },
  };
}

// MARK: Validation

const positive = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0;
const has = (n: unknown) => n !== null && n !== undefined && n !== "";
const time = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);
export const META_ID = /^\d{5,25}$/;
const INTEREST_ID = /^\d{6,25}$/;

/** The countries a targeting spec reaches (countries, and the countries of regions and cities). */
export const targetedCountries = (t: TargetingSpec) => [...new Set(t.locations.map((l) => (l.type === "country" ? l.key : l.countryCode ?? "").toUpperCase()).filter(Boolean))];
export const targetsEu = (t: TargetingSpec) => targetedCountries(t).some((c) => (EU_COUNTRIES as readonly string[]).includes(c));

export function validateCampaign(c: CampaignSpec): string[] {
  const out: string[] = [];
  if (!c.name?.trim()) out.push("Give the campaign a name.");
  if (!META_OBJECTIVES.includes(c.objective)) out.push("Pick the campaign's objective.");
  const budgets = [c.dailyBudget, c.lifetimeBudget].filter(has);
  if (c.budgetMode === "CBO") {
    if (budgets.length !== 1) out.push("A campaign budget (CBO) needs either a daily or a lifetime budget, not both.");
    for (const b of budgets) if (!positive(b)) out.push("Budgets must be more than zero.");
    if (has(c.lifetimeBudget) && !c.stopTime) out.push("A lifetime budget needs an end date.");
    if (c.bidStrategy && !BID_STRATEGIES.includes(c.bidStrategy)) out.push("Pick a bid strategy.");
  } else if (c.budgetMode === "ABO") {
    if (budgets.length || c.bidStrategy) out.push("With ad set budgets (ABO) the campaign has no budget or bid strategy: each ad set carries its own.");
  } else {
    out.push("Choose where the budget lives: on the campaign (CBO) or on each ad set (ABO).");
  }
  if (has(c.spendCap) && !positive(c.spendCap)) out.push("The spending limit must be more than zero.");
  if (c.startTime && Number.isNaN(time(c.startTime))) out.push("The start date isn't a date.");
  if (c.stopTime && Number.isNaN(time(c.stopTime))) out.push("The end date isn't a date.");
  if (c.startTime && c.stopTime && time(c.stopTime) <= time(c.startTime)) out.push("The campaign must end after it starts.");
  const special = c.specialAdCategories ?? [];
  for (const s of special) if (!(SPECIAL_AD_CATEGORIES as readonly string[]).includes(s)) out.push(`Unknown special ad category: ${s}.`);
  if (special.length && !(c.specialAdCountries ?? []).length) out.push("Special ad categories need the countries the ads run in.");
  for (const cc of c.specialAdCountries ?? []) if (!/^[A-Z]{2}$/.test(cc)) out.push("Countries are two-letter codes (US, GB).");
  if (c.skadnetwork && c.objective !== "OUTCOME_APP_PROMOTION") out.push("SKAdNetwork attribution only applies to App promotion campaigns.");
  return out;
}

export function validateTargeting(t: TargetingSpec, parent: ParentCampaign): string[] {
  const out: string[] = [];
  if (!t.locations?.length) out.push("Pick at least one country, region or city.");
  for (const l of [...(t.locations ?? []), ...(t.excludedLocations ?? [])]) {
    if (l.type === "country" && !/^[A-Z]{2}$/.test(l.key)) out.push(`"${l.name}" isn't a country code.`);
    if (l.type !== "country" && !/^\d+$/.test(l.key)) out.push(`"${l.name}" must come from the location search.`);
    if (l.type === "city" && has(l.radius)) {
      const max = l.distanceUnit === "kilometer" ? 80 : 50;
      if (!positive(l.radius) || Number(l.radius) > max) out.push(`The radius around ${l.name} is 1–${max} ${l.distanceUnit === "kilometer" ? "km" : "miles"}.`);
    }
  }
  if (!(Number.isInteger(t.ageMin) && Number.isInteger(t.ageMax)) || t.ageMin < 13 || t.ageMax > 65 || t.ageMin > t.ageMax) out.push("Ages run from 13 to 65, youngest first.");
  for (const i of t.interests ?? []) if (!INTEREST_ID.test(String(i.id))) out.push(`"${i.name}" isn't from Meta's interest search; pick interests from the search results.`);
  for (const a of [...(t.audiences ?? []), ...(t.excludedAudiences ?? [])]) if (!META_ID.test(String(a.id))) out.push(`"${a.name}" isn't one of the account's audiences.`);
  for (const l of t.locales ?? []) if (!Number.isInteger(l.key)) out.push(`"${l.name}" must come from the language search.`);
  if (t.placements !== "advantage") out.push(...placementErrors(t.placements, parent.objective));
  if ((parent.specialAdCategories ?? []).length) {
    if (t.ageMin !== 18 || t.ageMax !== 65) out.push("Special ad categories target everyone 18–65: age limits aren't allowed.");
    if (t.genders !== "all") out.push("Special ad categories can't target by gender.");
  }
  return out;
}

export function validateAdSet(a: AdSetSpec, parent: ParentCampaign, now: Date = new Date()): string[] {
  const out: string[] = [];
  const o = parent.objective;
  if (!a.name?.trim()) out.push("Give the ad set a name.");
  const goals = goalsFor(o);
  if (!goals.includes(a.optimizationGoal)) {
    out.push(`${GOAL_INFO[a.optimizationGoal]?.label ?? a.optimizationGoal} isn't available for ${OBJECTIVE_INFO[o]?.label ?? o} campaigns. Pick one of: ${goals.map((g) => GOAL_INFO[g]?.label ?? g).join(", ")}.`);
  }
  if (!billingFor(a.optimizationGoal).includes(a.billingEvent)) out.push(`You can only pay per impression${BILLING_PAIRS[a.optimizationGoal] ? ` or per ${BILLING_PAIRS[a.optimizationGoal][0].toLowerCase().replace(/_/g, " ")}` : ""} for this goal.`);
  const dest = destinationsFor(o, a.optimizationGoal);
  if (a.destinationType) {
    if (!dest.options.includes(a.destinationType)) out.push(dest.options.length ? `For this goal the ad sends people to: ${dest.options.map((d) => DESTINATION_INFO[d] ?? d).join(" or ")}.` : "This goal doesn't take a destination.");
  } else if (dest.required) {
    out.push(`This goal needs a destination: ${dest.options.map((d) => DESTINATION_INFO[d] ?? d).join(" or ")}.`);
  }
  const need = promotedNeed(o, a.optimizationGoal, a.destinationType);
  const po = a.promotedObject ?? {};
  if (need.need === "app" || need.need === "app_event") {
    if (!po.applicationId || !META_ID.test(po.applicationId)) out.push("This goal needs the Meta app id (Launch settings).");
    if (!po.objectStoreUrl || !/^https:\/\//.test(po.objectStoreUrl)) out.push("This goal needs the App Store link (Launch settings).");
    if (need.need === "app_event" && !po.customEventType) out.push("Pick the app event to optimise for (trial, purchase…).");
  }
  if (need.need === "pixel_event") {
    if (!po.customConversionId && !(po.pixelId && META_ID.test(po.pixelId))) out.push("This goal needs a pixel: connect one in Launch settings, or pick a custom conversion.");
    if (!po.customConversionId && !po.customEventType) out.push("Pick the pixel event to optimise for (purchase, trial…).");
  }
  if (need.need === "page" && !(po.pageId && META_ID.test(po.pageId))) out.push("This goal needs the Facebook Page.");

  const budgets = [a.dailyBudget, a.lifetimeBudget].filter(has);
  const bidding = [a.bidStrategy, a.bidAmount, a.roasFloor].filter(has);
  if (parent.budgetMode === "CBO") {
    if (budgets.length || bidding.length) out.push("Budget and bidding live on the campaign (CBO), so this ad set can't have its own. Remove them, or pick a campaign with ad set budgets.");
  } else {
    if (budgets.length !== 1) out.push("Give the ad set a daily or a lifetime budget (one of them).");
    for (const b of budgets) if (!positive(b)) out.push("Budgets must be more than zero.");
    if (has(a.lifetimeBudget) && !a.endTime) out.push("A lifetime budget needs an end date.");
    const strategy = a.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP";
    if (!BID_STRATEGIES.includes(strategy)) out.push("Pick a bid strategy.");
    if ((strategy === "COST_CAP" || strategy === "LOWEST_COST_WITH_BID_CAP") && !positive(a.bidAmount)) out.push(`${BID_INFO[strategy].label} needs an amount.`);
    if (strategy === "LOWEST_COST_WITH_MIN_ROAS") {
      if (!positive(a.roasFloor)) out.push("A ROAS goal needs the minimum return (for example 1.5).");
      if (a.optimizationGoal !== "VALUE") out.push("A ROAS goal needs the Conversion value goal.");
    }
    if (strategy === "LOWEST_COST_WITHOUT_CAP" && (has(a.bidAmount) || has(a.roasFloor))) out.push("Highest volume bidding takes no amount: remove it or pick a cap.");
  }
  if (a.startTime && Number.isNaN(time(a.startTime))) out.push("The start date isn't a date.");
  if (a.endTime && Number.isNaN(time(a.endTime))) out.push("The end date isn't a date.");
  if (a.startTime && a.endTime && time(a.endTime) <= time(a.startTime)) out.push("The ad set must end after it starts.");
  if (a.endTime && time(a.endTime) <= now.getTime()) out.push("The end date is in the past.");

  if ((a.schedule ?? []).length) {
    const lifetime = has(a.lifetimeBudget) || (parent.budgetMode === "CBO" && parent.lifetime);
    if (!lifetime) out.push("Day-parting (a weekly schedule) only works with a lifetime budget.");
    for (const s of a.schedule ?? []) {
      if (!s.days.length || s.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) out.push("Each schedule block needs days (Sunday to Saturday).");
      if (s.startMinute < 0 || s.endMinute > 1440 || s.startMinute >= s.endMinute || s.startMinute % 60 || s.endMinute % 60) out.push("Schedule blocks run on whole hours, start before end.");
    }
  }
  if (a.frequencyCap) {
    if (a.optimizationGoal !== "REACH") out.push("A frequency cap only works with the Reach goal.");
    const f = a.frequencyCap;
    if (!Number.isInteger(f.impressions) || f.impressions < 1 || f.impressions > 90 || !Number.isInteger(f.days) || f.days < 1 || f.days > 90) out.push("Frequency cap: 1–90 showings every 1–90 days.");
  }
  if (a.attribution) {
    if (![1, 7].includes(a.attribution.clickDays) || ![0, 1].includes(a.attribution.viewDays)) out.push("Attribution: 1 or 7 days after a click, 0 or 1 day after a view.");
  }
  out.push(...validateTargeting(a.targeting, parent));
  if (targetsEu(a.targeting)) {
    if (!a.dsaBeneficiary?.trim()) out.push("Ads shown in the EU need the name of who benefits from them (Digital Services Act).");
    if (!a.dsaPayor?.trim()) out.push("Ads shown in the EU need the name of who pays for them (Digital Services Act).");
  }
  return out;
}

const DOMAIN = /^(?!https?:\/\/)([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;
const URL_TAGS = /^[A-Za-z0-9_.~-]+=[^\s&]*(&[A-Za-z0-9_.~-]+=[^\s&]*)*$/;
const https = (s: string | null | undefined) => { try { return new URL(s ?? "").protocol === "https:"; } catch { return false; } };

/** Validates the ads for the chosen creatives; `destination` is the ad set's destination when known. */
export function validateAd(ad: AdSpec, objective: MetaObjective, destination?: string | null): string[] {
  const out: string[] = [];
  if (destination && UNSUPPORTED_AD_DESTINATIONS[destination]) out.push(UNSUPPORTED_AD_DESTINATIONS[destination]);
  if (ad.aiDisclosure !== "OPT_IN" && ad.aiDisclosure !== "OPT_OUT") out.push("Say whether the media was made or edited with AI. Creatives made in the Studio are AI-generated, so this is usually Yes; Meta asks you to decide.");
  if (!ad.pageId || !META_ID.test(ad.pageId)) out.push("Pick the Facebook Page the ads run from.");
  if (ad.instagramId && !META_ID.test(ad.instagramId)) out.push("Pick the Instagram account from the list.");
  if (!ad.primaryText?.trim()) out.push("Add the primary text (the words above the media).");
  if (!ad.headline?.trim()) out.push("Add a headline.");
  if (!https(ad.link)) out.push("The link must start with https://.");
  if (!ctasFor(objective).includes(ad.cta)) out.push(`"${CTA_LABEL[ad.cta] ?? ad.cta}" isn't a button ${OBJECTIVE_INFO[objective]?.label ?? objective} campaigns can use.`);
  if (ad.displayLink && !DOMAIN.test(ad.displayLink)) out.push("The display link is a domain like acme.app (no https://).");
  if (ad.urlTags && !URL_TAGS.test(ad.urlTags)) out.push("URL parameters look like utm_source=meta&utm_medium=paid (no spaces, no ?).");
  const ids = ad.creatives.map((c) => c.id);
  if (!ids.length) out.push("Pick at least one creative.");
  if (new Set(ids).size !== ids.length) out.push("A creative is picked twice.");
  if (ad.format === "single") {
    if (ids.length > 50) out.push("At most 50 ads at a time (Meta's limit per ad set).");
  } else if (ad.format === "carousel") {
    const cards = ad.cards?.length ? ad.cards : ids.map((creativeId) => ({ creativeId }));
    if (cards.length < 2 || cards.length > 10) out.push("A carousel has 2 to 10 cards.");
    for (const card of cards) if (!ids.includes(card.creativeId)) out.push("Every card must be one of the picked creatives.");
    for (const card of ad.cards ?? []) if (card.link && !https(card.link)) out.push("Card links must start with https://.");
  } else if (ad.format === "placements") {
    const entries = ad.placements ?? [];
    if (entries.length < 2 || entries.length > 10) out.push("Placement customisation uses 2 to 10 versions of the creative.");
    const fallbacks = entries.filter((e) => !e.rule);
    if (fallbacks.length !== 1) out.push("Exactly one version must be the fallback (used everywhere else).");
    const used = entries.map((e) => e.creativeId);
    if (new Set(used).size !== used.length) out.push("Use each creative once: give a creative more placements instead of repeating it.");
    for (const e of entries) {
      if (!ids.includes(e.creativeId)) out.push("Every version must be one of the picked creatives.");
      if (e.rule) for (const m of placementErrors(e.rule, objective)) out.push(m);
    }
    const rules = entries.flatMap((e) => (e.rule ? [e.rule] : []));
    for (let i = 0; i < rules.length; i++) for (let j = i + 1; j < rules.length; j++) {
      if (rulesOverlap(rules[i], rules[j])) { out.push("Two versions cover the same placement: each placement gets one version."); i = rules.length; break; }
    }
  } else {
    out.push("Pick a format: single, carousel or placement customisation.");
  }
  return [...new Set(out)];
}

// MARK: Edits

export interface EditTarget {
  level: "campaign" | "adset";
  /** Campaign: CBO when it has a budget. Ad set: its campaign's mode. */
  budgetMode: BudgetMode;
  dailyBudget?: number | null;
  lifetimeBudget?: number | null;
  bidStrategy?: string | null;
  bidAmount?: number | null;
}

export interface EditChanges {
  name?: string;
  dailyBudget?: number | null;
  lifetimeBudget?: number | null;
  bidStrategy?: BidStrategy | null;
  bidAmount?: number | null;
  roasFloor?: number | null;
  spendCap?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  /** Only ever pauses; Launch never turns anything on. */
  pause?: boolean;
}

/** The playbook's note when a budget rises more than 20% at once (a hint, never a block). */
export function budgetRaiseHint(before: number | null | undefined, after: number | null | undefined): string | null {
  if (!positive(before) || !positive(after)) return null;
  const rise = (Number(after) - Number(before)) / Number(before);
  if (rise <= 0.2) return null;
  return `That's a ${Math.round(rise * 100)}% rise. The playbook raises budgets about 20% every 48 h and judges where the cost per result settles, so Meta's learning isn't reset.`;
}

export function validateEdit(target: EditTarget, c: EditChanges): { errors: string[]; hints: string[] } {
  const errors: string[] = [];
  const hints: string[] = [];
  if (c.name !== undefined && !c.name.trim()) errors.push("The name can't be empty.");
  const budget = has(c.dailyBudget) || has(c.lifetimeBudget);
  const bid = has(c.bidStrategy) || has(c.bidAmount) || has(c.roasFloor);
  const ownsBudget = target.level === "campaign" ? target.budgetMode === "CBO" : target.budgetMode === "ABO";
  if ((budget || bid) && !ownsBudget) {
    errors.push(target.level === "campaign" ? "This campaign uses ad set budgets (ABO): change the budget on its ad sets." : "This ad set's campaign holds the budget (CBO): change it on the campaign.");
  }
  if (has(c.dailyBudget) && has(c.lifetimeBudget)) errors.push("Change the daily or the lifetime budget, not both.");
  if (has(c.dailyBudget) && has(target.lifetimeBudget)) errors.push("This has a lifetime budget; Meta can't switch it to a daily one.");
  if (has(c.lifetimeBudget) && has(target.dailyBudget)) errors.push("This has a daily budget; Meta can't switch it to a lifetime one.");
  for (const b of [c.dailyBudget, c.lifetimeBudget, c.spendCap]) if (has(b) && !positive(b)) errors.push("Amounts must be more than zero.");
  const strategy = c.bidStrategy ?? target.bidStrategy;
  if (has(c.bidStrategy) && !BID_STRATEGIES.includes(c.bidStrategy!)) errors.push("Pick a bid strategy.");
  if (target.level === "adset" && (strategy === "COST_CAP" || strategy === "LOWEST_COST_WITH_BID_CAP") && !positive(c.bidAmount ?? target.bidAmount)) errors.push("This bid strategy needs an amount.");
  if (c.startTime && c.endTime && time(c.endTime) <= time(c.startTime)) errors.push("It must end after it starts.");
  const raise = budgetRaiseHint(target.dailyBudget, c.dailyBudget) ?? budgetRaiseHint(target.lifetimeBudget, c.lifetimeBudget);
  if (raise) hints.push(raise);
  return { errors: [...new Set(errors)], hints };
}
