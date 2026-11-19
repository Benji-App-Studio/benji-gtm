// Meta ad formats and placements the studio can make creatives for: what each is, where Meta shows
// it, its size, the areas Meta covers with its own interface, and the lines added to every Higgsfield
// prompt so the model makes it for that slot. From Meta's Ads Guide and Business Help Center
// (sources in SOURCES, checked on SPECS_CHECKED). Plain TypeScript with no imports: the browser,
// the API routes and the Node tests share it.

export const SPECS_CHECKED = "2026-10-02";

/** The aspect ratios the studio makes. 16:9 is the nearest Higgsfield makes to Meta's 1.91:1. */
export type Aspect = "9:16" | "4:5" | "1:1" | "16:9";

export type PlacementId = "feed_vertical" | "square" | "stories_reels" | "landscape";

/** Fractions of the frame Meta covers with its own interface; keep text, logos and faces out of them. */
export interface SafeZone { top: number; bottom: number; sides: number }

export interface Placement {
  id: PlacementId;
  label: string;
  /** One line: what this slot is. */
  summary: string;
  aspect: Aspect;
  /** Recommended upload size, in pixels. */
  size: [number, number];
  /** Where Meta shows it. */
  where: string[];
  safe: SafeZone | null;
  /** Video length Meta recommends for this slot, in seconds. */
  videoSeconds: { recommended: string; max: string };
  /** How the preview draws Meta's interface around the creative. */
  chrome: "feed" | "fullscreen" | "landscape";
  /** Short notes shown on the card. */
  notes: string[];
  /** Added to the prompt of every creative made for this slot. */
  prompt: string;
  /** Video too, or images only. */
  video: boolean;
}

export const PLACEMENTS: Placement[] = [
  {
    id: "feed_vertical",
    label: "Feed · vertical",
    summary: "The tallest a feed ad gets: Meta's recommended ratio for Facebook and Instagram feed images.",
    aspect: "4:5",
    size: [1440, 1800],
    where: ["Facebook Feed", "Instagram Feed (images)", "Instagram Explore (images)", "Facebook Groups and video feeds"],
    safe: null,
    videoSeconds: { recommended: "15 s or less", max: "Facebook Feed 241 min · Instagram 60 min" },
    chrome: "feed",
    notes: ["Facebook Feed recommends 4:5 for images and video", "Text: primary 50–150 characters (Instagram 125), headline 27"],
    prompt: [
      "Meta ad for the Facebook and Instagram Feed: vertical 4:5, 1440 × 1800 px.",
      "Fill the whole frame edge to edge: no borders, no letterboxing, no fake feed interface, buttons or captions (Meta adds the page name above and the text and call-to-action button below).",
      "Keep the subject and any words away from the bottom and side edges, which Instagram can cover.",
    ].join(" "),
    video: true,
  },
  {
    id: "square",
    label: "Square",
    summary: "The ratio Marketplace, search, the right column and carousel cards use.",
    aspect: "1:1",
    size: [1440, 1440],
    where: ["Carousel cards", "Facebook Marketplace", "Search results", "Right column (desktop)", "In-stream video", "Business Explore"],
    safe: null,
    videoSeconds: { recommended: "15 s or less", max: "241 min" },
    chrome: "feed",
    notes: ["At least 1080 × 1080; Meta asks for 1200 × 1200 on Marketplace and the right column", "Text: primary 125, headline 40"],
    prompt: [
      "Meta ad, square 1:1, 1440 × 1440 px, for carousels, Marketplace, search and the right column.",
      "Fill the whole frame; no borders, no fake interface, buttons or captions (Meta adds them around the ad).",
      "It is often shown small (the right column is a thumbnail): one clear subject, high contrast, at most a few large words.",
    ].join(" "),
    video: true,
  },
  {
    id: "stories_reels",
    label: "Stories & Reels",
    summary: "Full-screen vertical, for Stories and Reels, and Meta's choice for Instagram Feed and Explore video.",
    aspect: "9:16",
    size: [1440, 2560],
    where: ["Instagram and Facebook Stories", "Instagram and Facebook Reels", "Instagram Feed and Explore (video)", "Messenger Stories", "Audience Network"],
    // Meta's safe zone for every 9:16 ad: 14% top, 35% bottom, 6% each side (40% bottom with disclaimers).
    safe: { top: 0.14, bottom: 0.35, sides: 0.06 },
    videoSeconds: { recommended: "15 s or less (Stories split into cards after 15 s)", max: "Instagram Reels 15 min · Facebook Stories 3 min" },
    chrome: "fullscreen",
    notes: ["Keep the top 14%, bottom 35% and 6% at the sides free of text and logos", "Text: Instagram Reels primary 44 characters; Stories 125 and headline 40"],
    prompt: [
      "Meta ad for Stories and Reels: full-screen vertical 9:16, 1440 × 2560 px.",
      "Meta covers the top 14% with the profile, the bottom 35% with the caption and call-to-action button, and 6% at each side with icons:",
      "keep every word, logo, app screen and face inside the middle area. Fill the frame edge to edge; don't draw Meta's interface.",
    ].join(" "),
    video: true,
  },
  {
    id: "landscape",
    label: "Landscape",
    summary: "Wide, for in-stream video, search and the right column. Made at 16:9 (search and the right column trim to 1.91:1).",
    aspect: "16:9",
    size: [1920, 1080],
    where: ["Facebook in-stream video", "Search results", "Right column (desktop)", "Threads"],
    safe: null,
    videoSeconds: { recommended: "15 s or less (plays in full; skippable after 5 s)", max: "In-stream 10 min on mobile, 15 s on desktop" },
    chrome: "landscape",
    notes: ["Least screen on phones: use it for reach, not as the main creative", "Keep the subject centred; 1.91:1 trims the top and bottom"],
    prompt: [
      "Meta ad, landscape 16:9, 1920 × 1080 px, for in-stream video, search and the right column; Meta may trim it to 1.91:1, so keep the subject and any words in the centre, away from the top and bottom edges.",
      "Fill the frame; no borders and no fake interface.",
    ].join(" "),
    video: true,
  },
];

export const placementById = (id: string) => PLACEMENTS.find((p) => p.id === id);
export const PLACEMENT_IDS = PLACEMENTS.map((p) => p.id);

/** The placement whose aspect ratio is closest to a creative's size (by ratio, on a log scale). */
export function nearestPlacement(width: number, height: number): Placement | undefined {
  if (!(width > 0 && height > 0)) return undefined;
  const ratio = width / height;
  const distance = (p: Placement) => Math.abs(Math.log(ratio / (p.size[0] / p.size[1])));
  return [...PLACEMENTS].sort((a, b) => distance(a) - distance(b))[0];
}

/** Lines added to every video prompt, from Meta's creative best practices for mobile video. */
export const VIDEO_BEST_PRACTICE =
  "Hook in the first 3 seconds and show the app and its name early; keep it to about 15 seconds. Design for sound off as well as on: put the key point on screen and caption speech; music with a voice-over works best with sound on.";

/** Meta's guidance for app ads, added to every prompt. */
export const APP_BEST_PRACTICE =
  "Show what the app does: the app's own screen on a phone and one key number beat lots of text.";

// MARK: Formats

export type AdFormatId = "single" | "carousel";

export interface AdFormat {
  id: AdFormatId | "collection" | "instant_experience" | "flexible";
  label: string;
  summary: string;
  /** Made here (true) or put together in Ads Manager from creatives made here (false). */
  makesHere: boolean;
  note: string;
}

export const AD_FORMATS: AdFormat[] = [
  { id: "single", label: "Single image or video", summary: "One creative per ad.", makesHere: true, note: "Every placement above." },
  { id: "carousel", label: "Carousel", summary: "2–10 swipeable cards, each with its own headline and link.", makesHere: true,
    note: "Square cards (4:5 works for image-only Instagram carousels) that read as one story: the first card hooks, the middle ones show one feature each, the last asks to download. Meta suggests carousels for showing several app features." },
  { id: "flexible", label: "Flexible format", summary: "Up to 10 images and videos in one ad; Meta shows each person a single image, video or carousel.", makesHere: false,
    note: "Works with app promotion. Make a mix of square, 4:5 and 9:16 creatives here, then add them to one ad in Ads Manager" },
  { id: "collection", label: "Collection", summary: "A cover image or video above a grid of products.", makesHere: false,
    note: "Not available for app promotion" },
  { id: "instant_experience", label: "Instant Experience", summary: "A full-screen page that opens when the ad is tapped.", makesHere: false,
    note: "Built in Ads Manager from images and videos made here." },
];

export const CAROUSEL = { minCards: 2, maxCards: 10, defaultCards: 3 };
/** Carousel cards: square or 4:5. */
export const CAROUSEL_PLACEMENTS: PlacementId[] = ["square", "feed_vertical"];

export function carouselPrompt(card: number, cards: number) {
  const role = card === 1 ? "This card hooks: the problem or the promise, in a few large words." : card === cards ? "This last card asks to download the app, with the app's name." : "This card shows one point or one app screen.";
  return [
    `Card ${card} of ${cards} in a swipeable Meta carousel ad. All cards share one visual style, colour palette and typography, so they read as one sequence when swiped.`,
    role,
    "Don't draw arrows, page dots or swipe hints; Meta adds its own.",
  ].join(" ");
}

/** Advantage+ app campaigns take up to 50 creatives; Meta suggests refreshing them 2–4 times a month. */
export const VOLUME_TIP = "Advantage+ app campaigns take up to 50 images and videos; Meta suggests fresh creatives 2–4 times a month.";

export const SOURCES = [
  { label: "Meta Ads Guide", url: "https://www.facebook.com/business/ads-guide/update" },
  { label: "Aspect ratios by placement", url: "https://www.facebook.com/business/help/682655495435254" },
  { label: "Safe zones for 9:16 ads", url: "https://www.facebook.com/business/help/980593475366490" },
  { label: "Video length by placement", url: "https://www.facebook.com/business/help/817989058548892" },
  { label: "Text length guidance", url: "https://www.facebook.com/business/help/223409425500940" },
  { label: "Carousel ads", url: "https://www.facebook.com/business/help/1114358518575630" },
  { label: "Advantage+ app campaigns", url: "https://www.facebook.com/business/ads/meta-advantage-plus/app-campaigns" },
  { label: "App ads best practices", url: "https://developers.facebook.com/docs/app-ads/resources/best-practices" },
];
