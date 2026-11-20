// Research → "Recreate this ad": copy a proven competitor ad's STYLE, STRUCTURE and PATTERN for our app,
// never its brand or assets. Pure TypeScript with relative imports only, so the sheet
// (components/research/recreate-ad.tsx), the Studio's batch form and the Node tests
// (scripts/creative-runner/tests/recreate.test.ts) share it.
//
// 1. scanAd() flags everything brand-specific in the ad's text: their brand and page name (and close
//    variants), links and domains, @handles and social names, phone numbers, emails, street addresses,
//    prices / discounts / promo codes, specific numbers and claims, testimonials and people's names.
//    Each flag needs a decision (replace or remove) before anything can be generated.
// 2. composePrompt() writes the brief: RECREATE (type, placement, size), KEEP (what the user ticked),
//    CHANGE (each override), NEVER INCLUDE (their brand, links, handles… and the brand's forbidden
//    claims) and CUSTOM. The brand's rules (look, voice, banned words, offers, forbidden claims) come
//    from lib/brand-rules.ts, the same rules QA checks the batch against, at most 4,000 characters. It applies the decisions to every piece of their text it
//    quotes and reports anything flagged that is still in the prompt (`leaks`).
// 3. The Studio gets a handoff in sessionStorage (HANDOFF_KEY): the brief, placement, kind, cards and the
//    must-avoid list QA checks on-screen text against. Their media URLs are never part of it.
//
// The AI scan (OpenAI reads the ad's image and text; `paid_ads.scan`) adds what only the image shows:
// mergeScanFlags() folds its flags into the text flags, its on-image text and style notes feed the
// prompt, and its copy suggestions can fill the inputs. "Closeness" sets how much the prompt keeps.
// A video ad's scan reads it as a video (key frames + speech-to-text): its transcript becomes the
// voiceover to rewrite, its shots a SHOT PLAN scaled to our length, and for AI video (Seedance) its
// stored key frames can go to Higgsfield as references, like an image ad's own image.
import { PRODUCT_REFERENCES } from "./product-assets";
import type { ProductProfile } from "./product-insight";
import { cleanMustAvoid, cleanProductReferences, cleanSourceAd, cleanStyleReferences, type ProductReference, DEFAULT_REQUEST, LIMITS, type BatchRequest } from "./creative-plan";
import { CAROUSEL, CAROUSEL_PLACEMENTS, placementById, PLACEMENT_IDS, type Placement, type PlacementId } from "./meta-formats";
import { AD_FORMAT_LABEL, MEDIA_LABEL, SHOT_LABEL, type AdDecoded, type AdMediaType, type AdScan, type AdSwap, type AdVideoScan, type RankedAdRow, type SwapElement } from "./research";
import { HOOK_LABEL, ROLE_PROMPT_NAME } from "./types";
import { cleanLogo, logoBriefLines, positionWhere, type LogoPosition, type LogoSettings } from "./logo-overlay";
import { brandRules, ruleLines } from "./brand-rules";
import { paletteLine, type BrandSystem } from "./brand-system";
import { RECREATE_HANDOFF_KEY } from "./storage-keys";
import { fill, m, type Translator } from "./i18n/translate";

/** A translator for the sheet; the prompt and the tests use English (the default). */
type T = Translator["t"];
const english: T = (text, vars) => fill(text, vars);

export const PROMPT_MAX = 4000;
/** sessionStorage key of the handoff. Read it with readStored (lib/storage-keys.ts). */
export const HANDOFF_KEY = RECREATE_HANDOFF_KEY;

// MARK: The ad

/** The parts of a competitor's ad the recreate tool reads. Only text and measurements; no media URLs. */
export interface RecreateSource {
  adId: string;
  libraryId: string;
  pageName: string;
  competitor?: string | null;
  mediaType: AdMediaType;
  /** True when the (first) media is a video. */
  video: boolean;
  body: string;
  headline: string;
  description: string;
  cta: string;
  linkUrl: string | null;
  /** The display link under the image ("SUNNYTRIP.COM"), when known. */
  caption?: string | null;
  /** Each carousel / DCO card's own text, when known. */
  cards?: { title?: string | null; body?: string | null }[];
  /** The words on the image, as the AI scan read them. */
  onImageText?: string[];
  /** Their style, as the AI scan described it. */
  style?: AdScan["style"] | null;
  decoded: AdDecoded | null;
  days: number | null;
  variants: number;
  cardCount: number;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  /** Video ads: the scan's reading of the video (shots, hook, transcript, key frames). */
  videoScan?: AdVideoScan | null;
  /** Exact recreation: what the scan says must change (theirs → ours) and what stays (keep). */
  swaps?: AdSwap[];
  /** Their type, role by role, as the scan read it. */
  typography?: string;
}

/**
 * A video ad: Meta says so, or most of its cards are videos (Meta files a "carousel" or a dynamic ad
 * of videos under carousel / dco; those are recreated as a video, not as image cards). `stored` is the
 * ad's `is_video`, worked out by the same rule when it was saved; it wins when there is one. Twin of
 * isVideoAd in supabase/functions/radar/engine/adlibrary.ts, which the research function's scan uses
 * (scripts/creative-runner/tests/video-ad.test.ts keeps them in step).
 */
export function isVideoAd(mediaType: AdMediaType, media: { type?: string | null }[], stored?: boolean | null): boolean {
  if (typeof stored === "boolean") return stored;
  if (mediaType === "video") return true;
  const videos = media.filter((m) => m?.type === "video").length;
  const images = media.filter((m) => m?.type === "image").length;
  return videos > 0 && videos >= images;
}

/** A Research ad as a recreate source, with the size the drawer measured and the AI scan when there is one. */
export function sourceFromAd(ad: RankedAdRow, measured: { width?: number | null; height?: number | null; duration?: number | null } = {}, scan: AdScan | null | undefined = ad.scan): RecreateSource {
  const media = ad.creative?.media?.length ? ad.creative.media : ad.media;
  return {
    adId: ad.id, libraryId: ad.ad_id, pageName: ad.page_name, competitor: ad.competitor, mediaType: ad.media_type,
    video: isVideoAd(ad.media_type, media, ad.is_video),
    body: ad.body ?? "", headline: ad.headline ?? "", description: ad.description ?? "", cta: ad.cta ?? "", linkUrl: ad.link_url,
    decoded: ad.decoded, days: ad.days, variants: Math.max(ad.variants, ad.groupSize),
    cardCount: Math.max(1, ad.creative?.card_count ?? media.length ?? 1),
    width: measured.width ?? null, height: measured.height ?? null, duration: measured.duration ?? scan?.video?.duration_sec ?? null,
    ...(scan ? { onImageText: scan.on_image_text.map((t) => t.text).filter(Boolean), style: scan.style, videoScan: scan.video ?? null, swaps: scan.swaps ?? [], typography: scan.typography ?? "" } : {}),
  };
}

// MARK: Flags

export type FlagKind = "brand" | "logo" | "url" | "handle" | "phone" | "email" | "address" | "price" | "claim" | "testimonial" | "person" | "other";

export const FLAG_LABEL: Record<FlagKind, string> = {
  brand: m("Their brand"), logo: m("Their logo"), other: m("Other brand detail"), url: m("Link or domain"), handle: m("Handle"), phone: m("Phone number"), email: m("Email"), address: m("Address"),
  price: m("Price, offer or code"), claim: m("Number or claim"), testimonial: m("Testimonial"), person: m("Person's name"),
};

/** Why each kind matters, in one line (shown under the flag). */
export const FLAG_WHY: Record<FlagKind, string> = {
  brand: m("Their name in your ad is trademark trouble and sends people to them."),
  logo: m("Their logo is their trademark; show your app icon or nothing."),
  other: m("Something specific to their brand; make it yours."),
  url: m("A link of theirs would send your clicks to them."),
  handle: m("Their social account, not yours."),
  phone: m("A real number that isn't yours."),
  email: m("A real address that isn't yours."),
  address: m("A real place that isn't yours."),
  price: m("Their offer, not yours: Meta rejects prices or codes you don't honour."),
  claim: m("Their number. Only say what you can prove for your app."),
  testimonial: m("Someone else's review. Only use real reviews of your app, with permission."),
  person: m("A real person's name or likeness; never reuse it."),
};

export interface Flag {
  /** Stable: kind + the normalized text. */
  id: string;
  kind: FlagKind;
  /** As it appears in their ad (first occurrence). */
  text: string;
  /** Which fields it is in: "primary text", "headline", "page name", "image"… */
  where: string[];
  /** What "Replace with" is prefilled with ("" when there's nothing to suggest). */
  suggestion: string;
  /** The decision the sheet highlights first. */
  suggested: "replace" | "remove";
  /** Kinds that are often false alarms (a number, a name) can also be kept as they are. */
  canKeep: boolean;
  /** Found in the ad's text by the rules here, or by the AI scan. */
  source: "text" | "ai";
  /** The AI scan's reason, when it found it. */
  why?: string;
}

export type Decision = { action: "replace"; with: string } | { action: "remove" } | { action: "keep" };
export type Decisions = Record<string, Decision | undefined>;

const KEEPABLE: FlagKind[] = ["price", "claim", "testimonial", "person", "address", "other"];

/** What the sheet can prefill a replacement with, from the brand kit. */
export interface BrandForRecreate {
  appName: string;
  appStoreUrl?: string | null;
  iconUrl?: string | null;
  screenshots?: number;
  colors?: string[];
  tone?: string | null;
  forbiddenClaims?: string[];
  /** The AI product profile: who it's for, the promise, proof, look (ComposeInput.useProfile turns it off). */
  profile?: ProductProfile | null;
  /** The brand system (Brand page): our look, voice and the closed offer list. */
  system?: BrandSystem | null;
}

function suggestionFor(kind: FlagKind, brand: BrandForRecreate): { suggestion: string; suggested: "replace" | "remove" } {
  if (kind === "brand") return { suggestion: brand.appName, suggested: "replace" };
  if (kind === "url") return brand.appStoreUrl ? { suggestion: brand.appStoreUrl, suggested: "replace" } : { suggestion: "", suggested: "remove" };
  if (kind === "logo") return { suggestion: brand.iconUrl ? `the ${brand.appName} app icon` : "", suggested: brand.iconUrl ? "replace" : "remove" };
  return { suggestion: "", suggested: "remove" };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const norm = (s: string) => squash(s).toLowerCase();
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const BRAND_SUFFIX = /\s*\b(?:apps?|inc|llc|ltd|limited|co|corp|official|hq|gmbh|plc)\.?$/i;

/** Their brand as it may be written: the page name, its first part ("Sunny Trip – Travel Planner" → "Sunny Trip"), without "App"/"Inc", run together. */
export function brandVariants(names: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const name = squash((raw ?? "").replace(/[™®©]/g, ""));
    if (!name) continue;
    const first = name.split(/\s+[-–—|:·•]\s+|\s*[|•·]\s*/)[0].trim();
    for (const v of [name, first, first.replace(BRAND_SUFFIX, "").trim(), name.replace(BRAND_SUFFIX, "").trim()]) {
      if (compact(v).length < 3) continue;
      out.add(v);
      const together = v.replace(/[\s\-_.]+/g, "");
      if (together !== v && together.length >= 4) out.add(together);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Matches a brand however it's spaced or cased: "SunnyTrip" finds "Sunny Trip", "sunny-trip", "SUNNYTRIP's". */
export function brandRegex(variant: string, flags = "gi"): RegExp {
  const words = variant.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s\-_.]+/).filter(Boolean).map(escapeRe);
  return new RegExp(`(?<![A-Za-z0-9])${words.join("[\\s\\-_.]*")}(?:['’]s)?(?![A-Za-z0-9])`, flags);
}

const TLDS = "com|net|org|io|co|app|ai|me|ly|link|store|shop|site|online|xyz|info|biz|us|uk|ca|au|de|fr|es|it|nl|eu|in|tv|gg|so|to|dev|page|travel|world|life|club|fit|health|care|today|tech|global|studio|money|finance|bio|fm|vip|pro|live";

interface Detector { kind: FlagKind; re: RegExp; group?: number; valid?: (value: string) => boolean }

const NOT_NAMES = new Set(["Not", "So", "Here", "Back", "Done", "Obsessed", "Finally", "Never", "Always", "Going", "Sure", "Glad", "Happy", "Sorry", "The", "Just", "Still", "Officially", "Free", "Ready", "In", "On", "At", "A", "An", "Now", "Today", "Also", "Very", "Really", "Literally", "Honestly", "Your", "My", "This", "That"]);

/** In order: earlier detectors claim their text, so a phone number inside a link isn't flagged twice. */
const DETECTORS: Detector[] = [
  { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: "url", re: /\bhttps?:\/\/[^\s<>"')\]]+/gi },
  { kind: "url", re: /\bwww\.[^\s<>"')\]]+/gi },
  { kind: "url", re: new RegExp(`\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS})\\b(?:\\/[^\\s<>"')\\]]*)?`, "gi") },
  { kind: "handle", re: /\b(?:instagram|insta|ig|tiktok|tik tok|twitter|facebook|fb|youtube|yt|snapchat|snap|threads|pinterest|linkedin)\s*(?::|–|—|-)\s*@?([A-Za-z0-9_.]{2,30})/gi, group: 1 },
  { kind: "handle", re: /(?<![\w@.])@[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?/g },
  {
    kind: "phone", re: /(?<![\w+])\+?\(?\d[\d\s().-]{6,18}\d(?!\w)/g,
    valid: (v) => {
      const digits = v.replace(/\D/g, "").length;
      return digits >= 8 && digits <= 15 && !/^\d{4}-\d{2}-\d{2}$/.test(v) && (v.startsWith("+") || /[\s().-]/.test(v) || digits >= 10);
    },
  },
  { kind: "price", re: /\b(?:[Cc]ode|CODE|[Cc]oupon|COUPON|[Pp]romo(?:\s?[Cc]ode)?|PROMO(?:\s?CODE)?)\s*[:\-]?\s*["“']?([A-Z0-9][A-Z0-9_-]{2,19})\b/g, group: 1, valid: (v) => /\d/.test(v) || v.length >= 4 },
  { kind: "price", re: /(?:US\$|[$€£¥₹])\s?\d{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{1,2})?(?:\s?(?:\/|per|a)\s?(?:mo|month|yr|year|week|wk|day)\b)?/gi },
  { kind: "price", re: /\b\d{1,3}(?:[,.]\d{3})*(?:[.,]\d{1,2})?\s?(?:USD|EUR|GBP|dollars|euros|pounds|€|£)/gi },
  { kind: "price", re: /\b\d{1,3}\s?%\s?(?:off|discount)\b/gi },
  { kind: "price", re: /\b(?:save|get|take)\s+(?:up\s+to\s+)?\d{1,3}\s?%/gi },
  { kind: "price", re: /\bhalf[- ]price\b|\bBOGO\b|\bbuy one,? get one(?: free)?\b/gi },
  { kind: "price", re: /\b(?:free\s+for\s+\d+\s+days|\d+[- ]day\s+free\s+trial|free\s+trial)\b/gi },
  { kind: "price", re: /\b(?:limited[- ]time\s+(?:offer|deal)|today only|this week only|ends (?:today|tonight|soon))\b/gi },
  { kind: "address", re: /\b\d{1,5}\s+(?:[A-Z][\w'.-]*\s+){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Place|Pl|Square|Sq|Highway|Hwy|Parkway|Pkwy)\b\.?(?:,?\s*(?:Suite|Ste|Unit|Apt|#)\s*\w+)?/g },
  { kind: "address", re: /\bP\.?\s?O\.?\s?Box\s+\d+/gi },
  { kind: "address", re: /\b[A-Z][a-z]+,\s[A-Z]{2}\s\d{5}(?:-\d{4})?\b/g },
  { kind: "claim", re: /\brated\s+[0-5](?:[.,]\d)?(?:\s?\/\s?5)?(?:\s+stars?)?/gi },
  { kind: "claim", re: /\b[0-5](?:[.,]\d)?\s?(?:\/\s?5\s?)?(?:stars?\b|★|⭐)/gi },
  { kind: "claim", re: /\b\d{1,3}(?:[,.\s]\d{3})*(?:[.,]\d+)?\s?(?:k|K|M|million|thousand|billion)?\+?\s+(?:happy\s+|active\s+|satisfied\s+|paying\s+|monthly\s+)?(?:users|people|customers|travell?ers|downloads|installs|members|reviews|ratings|subscribers|students|families|nomads|countries|businesses|clients|patients|teams|companies|creators|readers|parents|players)\b/gi },
  { kind: "claim", re: /\b\d{1,3}(?:[.,]\d)?\s?%/g },
  { kind: "claim", re: /#\s?1\b|\bNo\.?\s?1\b|\bnumber one\b|\b(?:best|top)[- ]rated\b/gi },
  { kind: "claim", re: /\b\d+(?:[.,]\d)?\s?x\s+(?:faster|more|better|cheaper|easier)\b/gi },
  { kind: "claim", re: /\b(?:save|saves|saved)\s+(?:up\s+to\s+)?\d+\s?(?:hours?|hrs?|minutes?|mins?|days?|weeks?)\b/gi },
  { kind: "claim", re: /\bin\s+(?:just\s+|under\s+|less than\s+)?\d+\s?(?:seconds?|secs?|minutes?|mins?)\b/gi },
  { kind: "testimonial", re: /["“]([^"“”\n]{15,240})["”]/g, group: 1 },
  { kind: "testimonial", re: /(?:⭐|★){3,}/g },
  { kind: "person", re: /\b(?:I['’]m|I am|[Mm]y name is|[Mm]eet|[Hh]i,?\s+I['’]m)\s+([A-Z][a-z]{2,15})\b/g, group: 1, valid: (v) => !NOT_NAMES.has(v) },
  { kind: "person", re: /(?:^|\n)[ \t]*[—–-]{1,2}[ \t]*([A-Z][a-z]+(?:[ \t][A-Z][a-z]*\.?)?)(?=[ \t]*(?:,|$|\n))/g, group: 1 },
  { kind: "person", re: /\b([A-Z][a-z]+\s[A-Z]\.)(?=\s|$|,)/g, group: 1, valid: (v) => !NOT_NAMES.has(v.split(" ")[0]) },
  { kind: "person", re: /\b([A-Z][a-z]+),\s?\d{2},?\s+(?:from|in)\s+[A-Z]/g, group: 1 },
  { kind: "person", re: /\bDr\.?\s[A-Z][a-z]+/g },
];

const tidy = (kind: FlagKind, value: string) => {
  let v = value.trim();
  if (kind === "url" || kind === "handle" || kind === "email") v = v.replace(/[.,;:!?…]+$/, "");
  if (kind === "brand") v = v.replace(/['’]s$/, "");
  return v;
};

const bareUrl = (s: string) => norm(s).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
/** The same flag however it's written: a brand by its letters, a phone by its digits, a link without its scheme. */
const flagKey = (kind: FlagKind, text: string) =>
  kind === "brand" || kind === "logo" ? compact(text) : kind === "phone" ? text.replace(/\D/g, "") : kind === "url" ? bareUrl(text) : norm(text);
const flagId = (kind: FlagKind, text: string) => `${kind}:${flagKey(kind, text)}`;

/** The ad's text fields, labelled where they are. */
function fieldsOf(src: RecreateSource): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [
    { where: m("page name"), text: src.pageName },
    { where: m("primary text"), text: src.body },
    { where: m("headline"), text: src.headline },
    { where: m("description"), text: src.description },
    { where: m("display link"), text: src.caption ?? "" },
    { where: m("destination URL"), text: src.linkUrl ?? "" },
  ];
  (src.onImageText ?? []).forEach((line) => out.push({ where: m("image text"), text: line }));
  (src.cards ?? []).forEach((card, i) => out.push({ where: `card ${i + 1}`, text: [card.title, card.body].filter(Boolean).join("\n") }));
  // A video's spoken words and its on-screen captions say brand names, prices and claims too.
  (src.videoScan?.transcript ?? []).forEach((line) => out.push({ where: m("voiceover"), text: line.text }));
  (src.videoScan?.shots ?? []).forEach((shot) => out.push({ where: m("on-screen text"), text: shot.on_screen_text }));
  if (src.competitor && norm(src.competitor) !== norm(src.pageName)) out.push({ where: m("page name"), text: src.competitor });
  return out.filter((f) => f.text.trim());
}

/** Everything brand-specific in the ad's text, each with a suggested decision. Pure; unit-tested. */
export function scanAd(src: RecreateSource, brand: BrandForRecreate): Flag[] {
  const flags = new Map<string, Flag>();
  const brands = brandVariants([src.pageName, src.competitor]).filter((v) => compact(v) !== compact(brand.appName));
  const add = (kind: FlagKind, text: string, where: string) => {
    const id = flagId(kind, text);
    const known = flags.get(id);
    if (known) {
      if (!known.where.includes(where)) known.where.push(where);
      return;
    }
    flags.set(id, { id, kind, text, where: [where], ...suggestionFor(kind, brand), canKeep: KEEPABLE.includes(kind), source: "text" });
  };

  for (const field of fieldsOf(src)) {
    const text = field.text;
    const taken: { start: number; end: number; kind: FlagKind }[] = [];
    const free = (start: number, end: number, ignore: FlagKind[] = []) => !taken.some((t) => start < t.end && end > t.start && !ignore.includes(t.kind));
    for (const d of DETECTORS) {
      for (const m of text.matchAll(d.re)) {
        const whole = m[0];
        const raw = d.group ? m[d.group] : whole;
        if (!raw) continue;
        const value = tidy(d.kind, raw);
        if (!value || (d.valid && !d.valid(value))) continue;
        const start = (m.index ?? 0) + (d.group ? Math.max(0, whole.indexOf(raw)) : 0);
        const end = start + value.length;
        if (!free(start, end)) continue;
        taken.push({ start, end, kind: d.kind });
        add(d.kind, value, field.where);
      }
    }
    // Their brand last, so it isn't flagged again inside their link or handle; inside a quote it still is.
    for (const variant of brands) {
      for (const m of text.matchAll(brandRegex(variant))) {
        const start = m.index ?? 0;
        const value = tidy("brand", m[0]);
        if (!free(start, start + m[0].length, ["testimonial", "person"])) continue;
        taken.push({ start, end: start + m[0].length, kind: "brand" });
        add("brand", value, field.where);
      }
    }
  }
  // The page name is their brand even when it's written nowhere else.
  if (src.pageName.trim() && ![...flags.values()].some((f) => f.kind === "brand")) add("brand", squash(src.pageName), "page name");
  return sortFlags([...flags.values()]);
}

const ORDER: FlagKind[] = ["brand", "logo", "url", "handle", "phone", "email", "address", "price", "claim", "testimonial", "person", "other"];
const sortFlags = (flags: Flag[]) => [...flags].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

const SCAN_KIND: Record<AdScan["flags"][number]["kind"], FlagKind> = {
  brand: "brand", logo: "logo", url: "url", handle: "handle", phone: "phone", email: "email", address: "address",
  price_or_offer: "price", claim: "claim", person_face: "person", testimonial: "testimonial", other: "other",
};
const SCAN_WHERE: Record<AdScan["flags"][number]["where"], string> = {
  image: m("image"), primary_text: "primary text", headline: "headline", description: "description", link: "destination URL",
  voiceover: "voiceover", video: m("video"),
};

/** Every place a flag can be found besides "card N" (fieldsOf and SCAN_WHERE): the screen translates these and nothing else. */
export const FLAG_WHERE: ReadonlySet<string> = new Set([
  "page name", "primary text", "headline", "description", "display link", "destination URL", "image text", "voiceover", "on-screen text", "image", "video",
]);

/** Two findings of one thing: the same kind and the same key, or one key inside the other (a phone in other spacing, a longer link). */
function sameThing(a: Pick<Flag, "kind" | "text">, kind: FlagKind, text: string): boolean {
  if (a.kind !== kind) return false;
  const x = flagKey(a.kind, a.text), y = flagKey(kind, text);
  return Boolean(x && y) && (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))));
}

/**
 * Folds the AI scan's flags into the text flags. A finding the rules already have adds where it was seen
 * (and its suggestion and reason when the rule had none); a new one becomes its own flag, prefilled
 * with the scan's suggestion ("" means remove). The flags passed in aren't changed.
 */
export function mergeScanFlags(flags: Flag[], scan: Pick<AdScan, "flags"> | null | undefined, brand: BrandForRecreate): Flag[] {
  if (!scan?.flags?.length) return flags;
  const out = flags.map((f) => ({ ...f, where: [...f.where] }));
  for (const item of scan.flags) {
    const kind = SCAN_KIND[item.kind] ?? "other";
    const text = squash(String(item.text ?? "")).slice(0, 200);
    if (!text) continue;
    const where = SCAN_WHERE[item.where] ?? "image";
    const suggestion = squash(String(item.suggestion ?? "")).slice(0, 200);
    const known = out.find((f) => sameThing(f, kind, text));
    if (known) {
      if (!known.where.includes(where)) known.where.push(where);
      if (!known.suggestion && suggestion) Object.assign(known, { suggestion, suggested: "replace" });
      if (!known.why && item.why) known.why = item.why;
      continue;
    }
    const base = suggestionFor(kind, brand);
    out.push({
      id: flagId(kind, text), kind, text, where: [where],
      ...(suggestion ? { suggestion, suggested: "replace" as const } : base),
      canKeep: KEEPABLE.includes(kind), source: "ai", ...(item.why ? { why: item.why } : {}),
    });
  }
  return sortFlags(out);
}

/** True when the flag has a usable decision: remove, keep (where allowed), or a replacement that isn't theirs. */
export function isResolved(flag: Flag, decision: Decision | undefined): boolean {
  if (!decision) return false;
  if (decision.action === "remove") return true;
  if (decision.action === "keep") return flag.canKeep;
  const replacement = decision.with.trim();
  return Boolean(replacement) && !contains(replacement, flag);
}

export const unresolved = (flags: Flag[], decisions: Decisions) => flags.filter((f) => !isResolved(f, decisions[f.id]));

/** Does `text` contain the flagged text (a brand however it's spaced, anything else ignoring case and spacing)? */
function contains(text: string, flag: Pick<Flag, "kind" | "text">): boolean {
  if (flag.kind === "brand") return brandRegex(flag.text, "i").test(text);
  if (flag.kind === "logo") return false; // a logo is a picture, not words in the prompt
  return norm(text).includes(norm(flag.text));
}

/** Their text with every decided flag replaced or removed (longest first, so a link goes before the brand inside it). */
export function applyDecisions(text: string, flags: Flag[], decisions: Decisions): string {
  if (!text) return text;
  let out = text;
  const decided = flags.filter((f) => f.kind !== "logo" && decisions[f.id] && decisions[f.id]!.action !== "keep").sort((a, b) => b.text.length - a.text.length);
  for (const flag of decided) {
    const d = decisions[flag.id]!;
    const replacement = d.action === "replace" ? d.with.trim() : "";
    const re = flag.kind === "brand" ? brandRegex(flag.text) : new RegExp(escapeRe(flag.text).replace(/\s+/g, "\\s+"), "gi");
    out = out.replace(re, () => replacement);
  }
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.;:!?])/g, "$1")
    .replace(/\(\s*\)|\[\s*\]|["“]\s*["”]/g, "")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
}

// MARK: What to keep

export type RecreateKind = "image" | "ugc_video" | "ai_video";
export type KeepId = "type" | "layout" | "hook" | "shots" | "beats" | "pacing" | "cta";

export interface RecreateTarget {
  kind: RecreateKind;
  /** single, carousel (N cards) or dynamic (N options, made as variants). */
  format: "single" | "carousel" | "dynamic";
  cards: number;
  placement: Placement;
}

const UGC_FORMATS = ["ai_ugc", "ugc_testimonial", "founder_story", "green_screen", "storytime", "reaction", "day_in_life", "pov_skit"];
const ANIMATED = /\b(cartoon|animat\w*|illustrat\w*|motion graphics?|2d|3d render\w*|cgi|claymation|anime|stop[- ]motion|kinetic type)\b/i;
const PRESENTER_SHOTS = new Set(["talking_head", "green_screen"]);

/**
 * What a video ad is, and so how to remake it: "AI UGC video" (Marketing Studio, a presenter) when a
 * person talks to camera through most of it, "AI video" (Seedance) when it's animated, a cartoon, a
 * screen demo or b-roll. Read from the video scan when there is one, else from Jev's decode; a video
 * nobody has read yet starts as AI video. Images stay images.
 */
export function detectKind(src: RecreateSource): { kind: RecreateKind; reason: string } {
  if (!src.video) return { kind: "image", reason: "" };
  const vs = src.videoScan;
  if (vs?.shots.length) {
    const total = vs.shots.reduce((n, x) => n + Math.max(0.5, x.end - x.start), 0) || 1;
    const share = (test: (t: string) => boolean) => vs.shots.filter((x) => test(x.shot_type)).reduce((n, x) => n + Math.max(0.5, x.end - x.start), 0) / total;
    const animated = share((t) => t === "animation") >= 0.4 || ANIMATED.test([src.style?.vibe, src.style?.layout, vs.structure, ...vs.shots.slice(0, 4).map((x) => x.visual)].join(" "));
    if (animated) return { kind: "ai_video", reason: m("It's animated (cartoon or illustration), so Seedance remakes it as an AI video.") };
    if (share((t) => PRESENTER_SHOTS.has(t)) >= 0.5 && vs.presenter) return { kind: "ugc_video", reason: m("A person talks to camera through most of it, so it's remade as an AI UGC video with a presenter.") };
    return { kind: "ai_video", reason: m("It's mostly demo, product or b-roll shots without a presenter, so it's remade as an AI video.") };
  }
  if (src.decoded && UGC_FORMATS.includes(src.decoded.format)) return { kind: "ugc_video", reason: m("Its copy reads as a UGC format, so it's remade with a presenter.") };
  return { kind: "ai_video", reason: m("Not read yet: AI video until the video scan says whether a presenter talks to camera.") };
}

/** The kind detectKind picks. */
export const defaultKind = (src: RecreateSource): RecreateKind => detectKind(src).kind;

/** The Studio target for an ad: its nearest placement (carousels on a carousel placement), its format and card count. */
export function targetFor(src: RecreateSource, kind: RecreateKind, nearest?: PlacementId | null): RecreateTarget {
  const video = kind !== "image";
  const format = video ? "single" : src.mediaType === "carousel" ? "carousel" : src.mediaType === "dco" ? "dynamic" : "single";
  let id: PlacementId = nearest && PLACEMENT_IDS.includes(nearest) ? nearest : video ? "stories_reels" : format === "carousel" ? "square" : "feed_vertical";
  if (format === "carousel" && !CAROUSEL_PLACEMENTS.includes(id)) id = "square";
  const cards = format === "single" ? 1 : Math.min(CAROUSEL.maxCards, Math.max(CAROUSEL.minCards, src.cardCount));
  return { kind, format, cards, placement: placementById(id)! };
}

export interface KeepItem {
  id: KeepId;
  label: string;
  detail: string;
  /** Not kept at this closeness (shown greyed out). */
  off?: boolean;
}

/** How close the recreate stays to their ad. Every field stays editable; custom instructions always win. */
export type Closeness = "exact" | "loose" | "balanced" | "close" | "very_close";
export const CLOSENESS: { id: Closeness; label: string; summary: string }[] = [
  { id: "exact", label: m("Exact"), summary: m("their ad element for element; only the swaps change (our name and wordmark, product, claims, font)") },
  { id: "loose", label: m("Loose"), summary: m("the same format and placement only; layout and copy are ours to choose") },
  { id: "balanced", label: m("Balanced"), summary: m("the same structure and hook pattern, with our own visuals and words") },
  { id: "close", label: m("Close"), summary: m("the same layout, composition, text placement and copy rhythm, with our brand, colours and people") },
  { id: "very_close", label: m("Very close"), summary: m("mirror the layout, typography style, text length and copywriting style line by line, swapping only the brand-specific details") },
];
const KEPT_AT: Record<Closeness, KeepId[]> = {
  exact: ["type", "layout", "hook", "shots", "beats", "pacing", "cta"],
  loose: ["type"],
  balanced: ["type", "hook", "shots", "beats", "pacing", "cta"],
  close: ["type", "layout", "hook", "shots", "beats", "pacing", "cta"],
  very_close: ["type", "layout", "hook", "shots", "beats", "pacing", "cta"],
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const firstLine = (s: string) => s.split(/\n+/).map((l) => l.trim()).find(Boolean) ?? "";
const roleName = (role: string) => ROLE_PROMPT_NAME[role] ?? role;

/** Their copy in beats: Jev's roles when decoded, else its lines (or sentences). Decisions applied. */
function beatsOf(src: RecreateSource, flags: Flag[], decisions: Decisions, t: T = english): string[] {
  const spoken = src.video ? (src.videoScan?.transcript ?? []).map((l) => l.text.trim()).filter(Boolean) : [];
  if (spoken.length) return spoken.slice(0, 8).map((line) => clip(applyDecisions(line, flags, decisions), 90));
  if (src.decoded?.roles.length) return src.decoded.roles.slice(0, 8).map((r) => `${t(roleName(r.role))}: ${clip(applyDecisions(r.text, flags, decisions), 90)}`);
  const lines = src.body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const parts = lines.length > 1 ? lines : (src.body.match(/[^.!?]+[.!?]*/g) ?? []).map((s) => s.trim()).filter(Boolean);
  return parts.slice(0, 6).map((p) => clip(applyDecisions(p, flags, decisions), 80)).filter(Boolean);
}

const sizeText = (src: RecreateSource) => (src.width && src.height ? `${src.width} × ${src.height}` : "");
export const kindLabel = (target: RecreateTarget, t: T = english) =>
  target.kind === "ugc_video" ? t("AI UGC video") : target.kind === "ai_video" ? t("AI video") : target.format === "carousel" ? t("carousel of {n} image cards", { n: target.cards }) : target.format === "dynamic" ? t("dynamic ad ({n} image options)", { n: target.cards }) : t("single image");

/**
 * What the recreate can keep from their ad at a closeness; each one can be unticked. `t` translates the
 * labels and the wording around their ad's own text for the sheet; the prompt calls it in English.
 */
export function keepItems(src: RecreateSource, target: RecreateTarget, flags: Flag[] = [], decisions: Decisions = {}, closeness: Closeness = "balanced", t: T = english): KeepItem[] {
  const video = target.kind !== "image";
  const size = sizeText(src);
  const tr = (label: string | undefined) => (label ? t(label) : label);
  const where = `${tr(MEDIA_LABEL[src.mediaType])} → ${kindLabel(target, t)} · ${tr(target.placement.label)} (${target.placement.aspect})`;
  const items: KeepItem[] = [{
    id: "type", label: t("Creative type and size"),
    detail: size ? t("{what} · theirs {size}", { what: where, size }) : where,
  }, {
    id: "layout", label: t("Layout and composition"),
    detail: closeness === "very_close"
      ? video
        ? t("Mirror their framing, kinds of shot and caption style shot by shot")
        : t("Mirror their layout, composition, typography style and text placement; the same amount of text")
      : video
        ? t("The same framing and kinds of shot (talking head, screen recording, b-roll) in the same order")
        : t("The same layout, composition and text placement, with our brand, colours and people"),
  }];
  const vs = video ? src.videoScan : null;
  const hookLine = applyDecisions(vs?.hook.line || src.decoded?.roles.find((r) => r.role === "hook")?.text || firstLine(src.body) || firstLine(src.headline), flags, decisions);
  if (vs?.hook.what_happens) {
    const what = t("The first {seconds} s: {what}", { seconds: vs.hook.seconds || 2, what: clip(applyDecisions(vs.hook.what_happens, flags, decisions), 200) });
    items.push({ id: "hook", label: t("Hook pattern"), detail: hookLine ? t("{text}. Their opening line, to rewrite: \"{line}\"", { text: what, line: clip(hookLine, 140) }) : what });
  } else if (src.decoded) {
    const format = tr(AD_FORMAT_LABEL[src.decoded.format]) ?? src.decoded.format;
    const hook = src.decoded.hookType ? t("{type} hook", { type: tr(HOOK_LABEL[src.decoded.hookType]) ?? src.decoded.hookType }) : t("its hook");
    const roles = [...new Set(src.decoded.roles.map((r) => t(roleName(r.role))))].join(" → ");
    const base = roles ? t("{format}, {hook}; lines in order: {roles}", { format, hook, roles }) : `${format}, ${hook}`;
    items.push({ id: "hook", label: t("Hook pattern"), detail: hookLine ? t("{text}. Their opening, to rewrite: \"{line}\"", { text: base, line: clip(hookLine, 140) }) : base });
  } else if (hookLine) {
    items.push({ id: "hook", label: t("Hook pattern"), detail: t("The kind of opening line they use (rewrite it, keep the pattern): \"{line}\"", { line: clip(hookLine, 140) }) });
  }
  if (vs?.shots.length) {
    const seconds = Math.round(vs.duration_sec || src.duration || vs.shots[vs.shots.length - 1].end || 0);
    const n = vs.shots.length;
    const list = vs.shots.map((x) => tr(SHOT_LABEL[x.shot_type]) ?? t("shot")).join(" → ");
    const count = seconds
      ? (n === 1 ? t("{n} shot over about {seconds} s", { n, seconds }) : t("{n} shots over about {seconds} s", { n, seconds }))
      : (n === 1 ? t("{n} shot", { n }) : t("{n} shots", { n }));
    const shots = `${count}: ${list}`;
    items.push({ id: "shots", label: t("Shot list"), detail: vs.structure ? t("{shots}. Beats: {beats}", { shots, beats: clip(applyDecisions(vs.structure, flags, decisions), 160) }) : shots });
  }
  const beats = beatsOf(src, flags, decisions, t);
  if (beats.length) {
    const n = beats.length;
    items.push({ id: "beats", label: t("Copy structure"), detail: `${n === 1 ? t("{n} beat", { n }) : t("{n} beats", { n })}: ${beats.map((b, i) => `${i + 1}) ${b}`).join(" ")}` });
  }
  if (video) {
    const seconds = src.duration ? Math.round(src.duration) : null;
    items.push({ id: "pacing", label: t("Pacing and length"), detail: t("{length}, {pacing}, the hook in the first {seconds} seconds", {
      length: seconds ? t("About {n} s", { n: seconds }) : t("Their length"),
      pacing: vs?.pacing ? clip(vs.pacing, 140) : t("the same rhythm of cuts"),
      seconds: vs?.hook.seconds ? Math.max(1, Math.round(vs.hook.seconds)) : 2,
    }) });
  }
  if (src.cta) items.push({ id: "cta", label: t("Call to action type"), detail: `"${src.cta}"` });
  if (closeness === "very_close") {
    const beats = items.find((k) => k.id === "beats");
    if (beats) beats.detail = t("Line by line, the same length and copywriting style; {detail}", { detail: beats.detail });
  } else if (closeness === "close") {
    const beats = items.find((k) => k.id === "beats");
    if (beats) beats.detail = t("The same copy rhythm; {detail}", { detail: beats.detail });
  }
  return items.map((k) => (KEPT_AT[closeness].includes(k.id) ? k : { ...k, off: true }));
}

/** Their style as the AI scan read it, for KEEP: more of it the closer the recreate stays. Never their colours. */
export function styleLine(style: AdScan["style"] | null | undefined, closeness: Closeness): string | null {
  if (!style || closeness === "loose") return null;
  const parts: [string, string][] = closeness === "balanced"
    ? [["typography", style.typography], ["text density", style.text_density]]
    : [["layout", style.layout], ["typography", style.typography], ["text density", style.text_density], ["vibe", style.vibe]];
  const text = parts.filter(([, v]) => v?.trim()).map(([k, v]) => `${k}: ${v.trim()}`).join("; ");
  return text || null;
}

// MARK: Your version

export interface RecreateInputs {
  brandName: string;
  colors: string[];
  vibe: string;
  logo: "icon" | "none";
  link: "app_store" | "none";
  cta: string;
  headline: string;
  primaryText: string;
  /** The words on the image, one line each (prefilled from the AI scan's reading). */
  onImageText: string;
  tone: string;
  // Image, carousel, dynamic
  people: "none" | "different";
  person: string;
  background: string;
  showProduct: boolean;
  cardHeadlines: string[];
  // Video
  avatar: { id: string; name: string; type?: string | null } | null;
  presenter: string;
  setting: string;
  voiceover: string;
  captions: string;
  music: string;
  length: number;
  custom: string;
  /** Exact recreation: theirs → ours for every element that changes (keep: stays as it is). */
  swaps: RecreateSwap[];
  /** Exact recreation: their colours change to ours (off: their colours stay). */
  recolour: boolean;
}

export interface RecreateSwap { element: SwapElement; theirs: string; ours: string; style: string; keep: boolean }

export const SWAP_LABEL: Record<SwapElement, string> = {
  headline: m("Headline"), subhead: m("Subhead"), body: m("Text"), wordmark: m("Wordmark"), logo: m("Logo"), product: m("Product"), subject: m("Subject"),
  label: m("Label"), cta: m("Button"), price: m("Price or offer"), legal: m("Small print"), person: m("Person"), screen: m("App screen"), other: m("Element"),
};

/**
 * The swaps an exact recreation starts with: the scan's (theirs → ours, AI), with our name on every
 * wordmark; without a scan, nothing (the sheet scans as it opens).
 */
export function defaultSwaps(src: RecreateSource, appName: string): RecreateSwap[] {
  return (src.swaps ?? []).slice(0, 30).map((w) => ({
    element: w.element, theirs: w.theirs, style: w.style, keep: w.keep,
    ours: w.element === "wordmark" && !w.keep ? appName : w.keep ? w.theirs : w.ours,
  }));
}

export const VIDEO_LENGTHS = [5, 8, 10, 15, 20, 30];
const nearestOf = (options: number[], value: number) => options.reduce((best, v) => (Math.abs(v - value) < Math.abs(best - value) ? v : best), options[0]);

/** The voiceover their ad implies: what they say (the scan's transcript), else Jev's lines, else the copy's lines. Theirs, to be rewritten. */
export function theirScript(src: RecreateSource): string {
  const spoken = (src.videoScan?.transcript ?? []).map((l) => l.text.trim()).filter(Boolean);
  if (src.video && spoken.length) return spoken.join("\n");
  if (src.decoded?.roles.length) return src.decoded.roles.slice(0, 8).map((r) => r.text.trim()).filter(Boolean).join("\n");
  return src.body.trim();
}

/**
 * Whether their ad shows a phone or an app screen: only then do our app's screens go in by default.
 * A strawberry before/after stays a strawberry before/after; the app is our name and claim, not a phone mockup.
 */
export function showsAppScreen(src: RecreateSource): boolean {
  if (src.swaps?.some((w) => w.element === "screen")) return true;
  const seen = [src.style ? Object.values(src.style).join(" ") : "", src.videoScan?.shots?.map((s) => s.visual).join(" ") ?? "", (src.decoded?.format ?? "").replace(/_/g, " ")].join(" ");
  return /\b(phones?|iphones?|smartphones?|app screens?|screens?hots?|mock-?ups?|app ui|screen recording|demo)\b/i.test(seen);
}

/** The form's starting values: the brand kit for everything brand-specific, their wording where it's to be rewritten. */
export function defaultInputs(src: RecreateSource, target: RecreateTarget, brand: BrandForRecreate): RecreateInputs {
  return {
    brandName: brand.appName,
    colors: [...(brand.colors ?? [])],
    vibe: "",
    logo: brand.iconUrl ? "icon" : "none",
    link: brand.appStoreUrl ? "app_store" : "none",
    cta: src.cta || "Download",
    headline: src.headline,
    primaryText: src.body,
    onImageText: (src.onImageText ?? []).join("\n"),
    tone: brand.tone ?? "",
    people: "none",
    person: "",
    background: "",
    showProduct: (brand.screenshots ?? 0) > 0 && showsAppScreen(src),
    cardHeadlines: Array.from({ length: target.format === "single" ? 0 : target.cards }, (_, i) => src.cards?.[i]?.title ?? (i === 0 ? src.headline : "")),
    avatar: null,
    presenter: "",
    setting: "",
    voiceover: theirScript(src),
    captions: theirCaptions(src),
    music: "",
    length: nearestOf(VIDEO_LENGTHS, src.duration && src.duration > 0 ? src.duration : 15),
    custom: "",
    swaps: defaultSwaps(src, brand.appName),
    recolour: false,
  };
}

/** Their on-screen captions in order (the video scan), else their headline. Theirs, to be rewritten. */
export function theirCaptions(src: RecreateSource): string {
  const lines = [...new Set((src.videoScan?.shots ?? []).map((x) => x.on_screen_text.trim()).filter(Boolean))];
  return src.video && lines.length ? clip(lines.join(" / "), 200) : src.headline;
}

/** Same words as theirs (ignoring case and spacing)? Then the prompt asks for a rewrite instead of using them. */
export const sameAsTheirs = (mine: string, theirs: string) => Boolean(mine.trim()) && norm(mine) === norm(theirs);

/** Warnings about the inputs that don't block: wording still theirs. */
export function inputWarnings(src: RecreateSource, target: RecreateTarget, inputs: RecreateInputs, t: T = english): string[] {
  const out: string[] = [];
  if (sameAsTheirs(inputs.headline, src.headline)) out.push(t("The headline is still their exact wording; the prompt asks for a rewrite."));
  if (sameAsTheirs(inputs.primaryText, src.body)) out.push(t("The primary text is still their exact wording; the prompt asks for a rewrite that keeps its structure."));
  if (src.onImageText?.length && sameAsTheirs(inputs.onImageText, src.onImageText.join("\n"))) out.push(t("The on-image text is still theirs; the prompt asks for a rewrite."));
  if (target.kind !== "image" && sameAsTheirs(inputs.voiceover, theirScript(src))) out.push(t("The voiceover is still their script; the prompt asks for a rewrite of each beat."));
  return out;
}

// MARK: The prompt

export interface ComposeInput {
  /** Balanced when left out. */
  closeness?: Closeness;
  src: RecreateSource;
  target: RecreateTarget;
  keep: Partial<Record<KeepId, boolean>>;
  flags: Flag[];
  decisions: Decisions;
  inputs: RecreateInputs;
  brand: BrandForRecreate;
  /**
   * Image ads: how many of their images go to Higgsfield as references, ahead of our screenshots
   * (0 or left out: none; the prompt then works from words alone). AI video: how many of their
   * video's key frames go (Seedance takes images as references); UGC video takes none.
   */
  styleReferences?: number;
  /** AI video: the second each sent key frame was taken at, in order (for REFERENCE FRAMES). */
  frameTimes?: number[];
  /** Use the AI product profile (brand.profile) for who we speak to, our promise, proof and look. On unless false. */
  useProfile?: boolean;
  /** Our product images the user picked (they go to Higgsfield after their ad's image). */
  productImages?: { label: string; kind: string }[];
  /**
   * Image ads with "Logo: ours": the logo file, whether it goes to Higgsfield as a reference (right
   * after their image) and where the real file is placed on the finished image (null: not placed).
   */
  logo?: { url: string; label: string; reference: boolean; overlay: LogoPosition | null } | null;
}

export interface Composed {
  prompt: string;
  /** For QA (BatchRequest.mustAvoid): their brand, page name, links, handles… */
  mustAvoid: string[];
  /** Flagged text still in the prompt outside NEVER INCLUDE. Sending is blocked while there are any. */
  leaks: string[];
}

const quote = (s: string) => `"${s}"`;
const domainOf = (url: string) => {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ""); } catch { return ""; }
};

/** Everything that must never appear, for NEVER INCLUDE and for QA. */
export function avoidList(src: RecreateSource, flags: Flag[], decisions: Decisions, appName: string): string[] {
  const out: string[] = [squash(src.pageName)];
  if (src.competitor) out.push(squash(src.competitor));
  for (const flag of flags) {
    // Testimonials are too long to match, a logo is a picture, and the scan describes faces rather than naming them.
    if (decisions[flag.id]?.action === "keep" || flag.kind === "testimonial" || flag.kind === "logo" || (flag.kind === "person" && flag.source === "ai")) continue;
    out.push(flag.text);
    if (flag.kind === "url") {
      const domain = domainOf(flag.text);
      if (domain && !/(^|\.)(apple|google|facebook|instagram|fb)\.com$/.test(domain)) out.push(domain);
    }
  }
  return cleanMustAvoid(out.filter((s) => compact(s) && compact(s) !== compact(appName)).sort((a, b) => rank(a, flags) - rank(b, flags)));
}
const RANK: FlagKind[] = ["brand", "url", "handle", "phone", "email", "address", "price", "person", "claim", "other", "testimonial", "logo"];
const rank = (text: string, flags: Flag[]) => {
  const flag = flags.find((f) => norm(f.text) === norm(text));
  return flag ? RANK.indexOf(flag.kind) : -1;
};

/** A text line for the prompt: use ours as written, or ask for a rewrite of theirs (decisions applied). */
function textLine(label: string, mine: string, theirs: string, flags: Flag[], decisions: Decisions, max: number): string | null {
  const text = applyDecisions(mine, flags, decisions).split(/\n+/).map((l) => l.trim()).filter(Boolean).join(" / ");
  if (!text) return null;
  return sameAsTheirs(mine, theirs)
    ? `${label}: rewrite in our own words, keeping its length and structure (theirs: ${quote(clip(text, max))})`
    : `${label}: ${quote(clip(text, max))}`;
}

/** How closely to follow their attached image, per closeness. */
const REFERENCE_AT: Record<Closeness, string> = {
  exact: "Reproduce it exactly, element for element; only the swaps listed change.",
  loose: "Use it only for the general format and where things sit; the look is ours.",
  balanced: "Keep its layout, composition and text hierarchy; the visuals, colours and words are ours.",
  close: "Follow it closely: the same layout, composition, text placement and sizes, typography style, lighting and kind of imagery (photo, illustration, screenshot, sticker…), and the same visual devices (badges, arrows, frames, highlights).",
  very_close: "Mirror it: the same layout, composition, framing, text placement and sizes, typography style, lighting, imagery style and every visual device, element for element.",
};

/** How closely to follow their video's attached key frames, per closeness. */
const REFERENCE_VIDEO_AT: Record<Closeness, string> = {
  exact: "Mirror them shot for shot: framing, camera moves, lighting, caption placement and size, and every on-screen device.",
  loose: "Use them only for the general format: the kinds of shot and the framing; the look is ours.",
  balanced: "Keep their kinds of shot, framing and order; the people, places, colours and words are ours.",
  close: "Follow them closely: the same shots in the same order, framing, camera distance and movement, lighting, caption placement and on-screen devices.",
  very_close: "Mirror them shot for shot: framing, camera moves, lighting, caption placement and size, and every on-screen device.",
};

/** The reference block: what the attached image is and how far to follow it. */
/** How to use our own images: rebuilt into the scene, never pasted over theirs. */
export const OUR_IMAGES_RULE = "Build the creative around them: put each where their ad shows its own product or screen, and re-compose the scene so it belongs there (scale, angle, perspective, lighting, shadows and the layout around it adjusted). Keep our product exactly as it looks; never paste it flat over theirs.";

/**
 * What each attached image is, in the order Higgsfield gets them: their ad (when sent), our chosen
 * images, then our app screenshots.
 */
function referenceBlock(theirs: number, closeness: Closeness, ours: { label: string; kind: string }[], screenshots: boolean, logo: string | ComposeInput["logo"] = null, frames: number[] | null = null): string {
  const lines: string[] = [];
  let n = 1;
  const range = (count: number) => (count > 1 ? `${n}–${n + count - 1}` : `${n}`);
  if (theirs && frames) {
    const at = frames.slice(0, theirs).map((t) => `${t} s`).join(", ");
    lines.push(`REFERENCE FRAMES: ${theirs > 1 ? `The first ${theirs} attached images are stills from their video` : "The first attached image is a still from their video"}${at ? ` (at ${at})` : ""}, in order. ${REFERENCE_VIDEO_AT[closeness]}`);
    lines.push("It must read as a sibling of that video, not a copy: every brand-specific detail changes to ours (name, logo, product, app screens, wording, people, colours where CHANGE says so, links).");
    n += theirs;
  } else if (theirs) {
    lines.push(`REFERENCE IMAGE: ${theirs > 1 ? `The first ${theirs} attached images are their ad (in card order)` : "The first attached image is their ad"}. ${REFERENCE_AT[closeness]}`);
    lines.push("It must read as a sibling of that ad, not a print of it: every brand-specific detail changes to ours (name, logo, product, app screens, wording, people, colours where CHANGE says so, links).");
    n += theirs;
  }
  // Our logo right after their image, labelled, so the model copies it instead of inventing a mark.
  if (typeof logo === "string") lines.push(logo);
  else if (logo) {
    lines.push(logoBriefLines(logo, logo.reference ? n : 0));
    if (logo.reference) n += 1;
  }
  if (ours.length) {
    lines.push(`OUR IMAGES: attached image${ours.length > 1 ? "s" : ""} ${range(ours.length)} ${ours.length > 1 ? "are" : "is"} ours: ${ours.map((o, i) => `${n + i}) ${o.label || "our product"} (${o.kind.replace("_", " ")})`).join("; ")}. ${OUR_IMAGES_RULE}`);
    n += ours.length;
  }
  if (screenshots) lines.push(`${n > 1 ? `The attached images after ${n - 1 > 1 ? "those" : "it"}` : "The attached images"} are our app's real screens: show those, never their product.`);
  return lines.join("\n");
}

const seconds = (x: number) => String(Math.round(x * 10) / 10);

/**
 * Their shots as the plan for ours (the video scan): timings scaled to our length, their captions and
 * spoken words quoted only to be rewritten (decisions applied). Balanced keeps the kinds of shot and
 * timing; Close and Very close add what each shows, its caption and its line. Loose: none.
 */
export function shotPlan(src: RecreateSource, length: number, closeness: Closeness, flags: Flag[], decisions: Decisions): string[] {
  const shots = src.videoScan?.shots ?? [];
  if (!src.video || !shots.length || closeness === "loose") return [];
  const theirs = src.videoScan?.duration_sec || src.duration || shots[shots.length - 1].end || length;
  const k = theirs > 0 && length > 0 ? length / theirs : 1;
  const detailed = closeness !== "balanced";
  const fix = (x: string) => applyDecisions(x, flags, decisions);
  return shots.slice(0, 10).map((x, i) => {
    const parts = [`${i + 1}) ${seconds(x.start * k)}–${seconds(Math.max(x.start, x.end) * k)} s · ${SHOT_LABEL[x.shot_type] ?? "shot"}`];
    if (x.visual) parts.push(clip(fix(x.visual), detailed ? 150 : 70));
    if (detailed && x.on_screen_text) parts.push(`caption: ours in place of "${clip(fix(x.on_screen_text), 80)}"`);
    if (detailed && x.voiceover) parts.push(`line: ours in place of "${clip(fix(x.voiceover), 100)}"`);
    return parts.join(" · ");
  });
}

/**
 * Decisions an exact recreation takes from its swaps, for flags nobody decided: a flag inside a swap's
 * "theirs" is replaced by that swap's "ours" (removed when ours is empty), one about something a swap
 * keeps stays; their brand becomes ours. Decisions the person made always win.
 */
export function swapDecisions(flags: Flag[], swaps: RecreateSwap[], appName: string, decisions: Decisions = {}): Decisions {
  const out: Decisions = { ...decisions };
  for (const flag of flags) {
    if (out[flag.id]) continue;
    if (flag.kind === "brand") { out[flag.id] = { action: "replace", with: appName }; continue; }
    const swap = swaps.find((w) => !w.keep && norm(w.theirs).includes(norm(flag.text)));
    if (!swap) {
      // A flag about something the swaps keep (their BEFORE/AFTER, the strawberries) stays: removing it
      // would tell the model to drop what the edit keeps.
      const f = norm(flag.text);
      const kept = flag.kind !== "logo" && swaps.some((w) => w.keep && norm(w.theirs).length >= 4 && (f.includes(norm(w.theirs)) || norm(w.theirs).includes(f)));
      if (kept) out[flag.id] = { action: "keep" };
      continue;
    }
    const ours = swap.ours.trim();
    out[flag.id] = ours && !contains(ours, flag) ? { action: "replace", with: ours } : { action: "remove" };
  }
  return out;
}

/** The brand's own type, for an exact recreation's TYPE line ("" when the Brand page has no fonts). */
function brandType(system: BrandSystem | null | undefined): string {
  const fonts = system?.fonts ?? [];
  const head = fonts.find((f) => f.role === "headline") ?? fonts[0];
  const body = fonts.find((f) => f.role === "body") ?? head;
  if (!head) return "";
  const face = (f: typeof head) => `${f.family}${f.description ? ` (${clip(f.description, 90)})` : ""}`;
  return body && body.family !== head.family ? `${face(head)} for headlines and the wordmark, ${face(body)} for everything else` : `${face(head)} throughout`;
}

/**
 * An exact recreation (Closeness "Exact", image ads with their image attached): an edit of their ad,
 * not a new design. Everything stays as it is except the swaps (theirs → ours), our type, and, when
 * asked, our colours. Nothing from the profile or the brand look is added: that's what turned a
 * strawberry before/after into an app ad.
 */
function exactPrompt(c: ComposeInput): Composed {
  const { src, target, flags, inputs, brand } = c;
  const app = inputs.brandName.trim() || brand.appName;
  const placement = target.placement;
  const refs = Math.max(1, c.styleReferences ?? 0);
  const decisions = swapDecisions(flags, inputs.swaps, app, c.decisions);
  const fix = (x: string) => applyDecisions(x, flags, decisions);
  const ours = (c.productImages ?? []).slice(0, PRODUCT_REFERENCES);
  const logo = inputs.logo === "icon" ? c.logo ?? null : null;
  let n = refs + 1;
  const logoAt = logo?.reference ? n++ : 0;
  const oursFrom = n;
  const shape = src.width && src.height ? Math.abs(src.width / src.height - placement.size[0] / placement.size[1]) > 0.02 : false;

  const head = [
    `EDIT ${refs > 1 ? `THE FIRST ${refs} ATTACHED IMAGES (their ad's cards, in order)` : "THE ATTACHED AD (image 1)"} INTO OUR AD for ${app}, for ${placement.label} (${placement.aspect}, ${placement.size[0]} × ${placement.size[1]}).`,
    "Reproduce it exactly: the same layout, composition, framing, background, colours, lighting and photo style; the same objects in the same arrangement, sizes and angles; every label, pill, line, badge and icon; and every text in the same position, size, weight, case and line breaks.",
    shape ? "Their ad has another shape: extend the background evenly to fill ours; never move, resize, crop or re-arrange anything." : "",
    "Change ONLY what's listed below. Everything else stays identical.",
  ].filter(Boolean).join("\n");

  const change: string[] = [];
  for (const w of inputs.swaps.filter((x) => !x.keep && x.theirs.trim())) {
    const label = SWAP_LABEL[w.element] ?? "Element";
    const theirs = clip(w.theirs.trim(), 140);
    const mine = fix(w.ours.trim());
    const how = w.style.trim() ? ` (set exactly the same way: ${clip(w.style.trim(), 120)})` : " (same place, size and weight)";
    // Their wordmark becomes our name, set in its style; only a logo mark becomes our logo file.
    if (w.element === "logo" && logo?.reference && !logo.overlay) change.push(`- ${label}: "${theirs}" → our logo exactly as attached image ${logoAt}, same place and size`);
    else if (w.element === "product" && ours.length) change.push(`- ${label}: "${theirs}" → our product exactly as attached image${ours.length > 1 ? `s ${oursFrom}–${oursFrom + ours.length - 1}` : ` ${oursFrom}`}, in the same position, size, angle and lighting`);
    else if (!mine) change.push(`- ${label}: "${theirs}" → remove it; leave that space as background`);
    else change.push(`- ${label}: "${theirs}" → "${clip(mine, 160)}"${how}`);
  }
  // Flagged details on the image that no swap covers (a link, a handle, a code in the small print).
  // Their caption's flags aren't on the image: the edit never sees them, so they stay out of it.
  const onImage = (flag: Flag) => flag.where.some((w) => w.startsWith("image"));
  for (const flag of flags) {
    if (flag.kind === "brand" || flag.kind === "logo" || !onImage(flag)) continue;
    const d = decisions[flag.id];
    if (!d || d.action === "keep" || change.some((l) => norm(l).includes(norm(flag.text)))) continue;
    change.push(d.action === "replace" && d.with.trim() ? `- "${flag.text}" → "${clip(d.with.trim(), 120)}"` : `- "${flag.text}" → remove it`);
  }
  if (!change.length) change.push(`- Their brand name → "${app}", set exactly as theirs is.`);
  const type = brandType(brand.system);
  change.push(type ? `- Type: set the text in ${type}, at the same sizes, weights, case and spacing as theirs.` : src.typography ? `- Type: keep their type styles (${clip(src.typography, 200)}).` : "- Type: keep their type styles.");
  if (inputs.recolour && brand.system && paletteLine(brand.system)) change.push(`- Colours: swap their brand colours for ours, keeping where each sits: ${paletteLine(brand.system, 5).replace(/^Colours: /, "")}`);
  if (logo?.overlay) change.push(`- Draw no logo of ours; our real logo is placed in the ${positionWhere(logo.overlay)} afterwards, so keep that corner as it is.`);
  if (inputs.people === "different" || inputs.swaps.some((w) => w.element === "person")) change.push("- Any person: a different person in the same pose, framing and styling.");

  const kept = inputs.swaps.filter((w) => w.keep && w.theirs.trim()).map((w) => `"${clip(w.theirs.trim(), 80)}"`);
  const avoid = avoidList(src, flags, decisions, app);
  const rules = brandRules({ ...brand, appName: app }, { useProfile: false, mustAvoid: avoid });
  // The prompt names their brand and what's on their image; QA gets the whole list (captions included).
  const shown = new Set([squash(src.pageName), src.competitor ? squash(src.competitor) : "", ...flags.filter((f) => onImage(f) || f.kind === "brand").map((f) => f.text)].filter(Boolean).map(norm));
  const named = rules.mustAvoid.filter((m) => shown.has(norm(m))).slice(0, 20);
  const never = [
    `NEVER INCLUDE: ${(named.length ? named : rules.mustAvoid.slice(0, 12)).map(quote).join(", ") || "their brand"}.`,
    ...(rules.forbiddenClaims.length ? [`Never say: ${rules.forbiddenClaims.map((x) => quote(clip(x, 100))).join(", ")}.`] : []),
    "Not their logo, and no real person's likeness from their ad.",
  ].join("\n");
  const custom = inputs.custom.trim() ? `CUSTOM (follow these notes where they differ):\n${clip(inputs.custom.trim(), 800)}` : "";
  const prompt = [head, `CHANGE ONLY THESE:\n${change.join("\n")}`, kept.length ? `KEEP AS IS: ${kept.join(", ")}.` : "", never, custom].filter(Boolean).join("\n\n").slice(0, PROMPT_MAX);
  return { prompt, mustAvoid: rules.mustAvoid, leaks: leaksIn(prompt, flags, decisions) };
}

/** The brief for the Studio: RECREATE, KEEP, CHANGE, NEVER INCLUDE, CUSTOM, at most PROMPT_MAX characters. */
export function composePrompt(c: ComposeInput): Composed {
  // Image ads with their image attached, at Exact: an edit of their ad, nothing else added.
  if ((c.closeness ?? "balanced") === "exact" && c.target.kind === "image" && (c.styleReferences ?? 0) > 0) return exactPrompt(c);
  const { src, target, flags, decisions, inputs, brand } = c;
  const app = inputs.brandName.trim() || brand.appName;
  const placement = target.placement;
  const video = target.kind !== "image";
  const fix = (s: string) => applyDecisions(s, flags, decisions);

  // Exact without their image (or for a video) recreates as closely as words allow: Very close.
  const closeness = c.closeness === "exact" ? "very_close" : c.closeness ?? "balanced";
  // Their own media as references: the image(s) of an image ad, or an AI video's key frames (Seedance); never for UGC video.
  const refs = target.kind === "ugc_video" ? 0 : Math.max(0, c.styleReferences ?? 0);
  const frames = target.kind === "ai_video" ? c.frameTimes ?? [] : null;
  const screens = inputs.showProduct && (brand.screenshots ?? 0) > 0;
  const ours = (target.kind === "ugc_video" ? [] : c.productImages ?? []).slice(0, PRODUCT_REFERENCES);
  // Image ads: our logo file (or, with "No logo", an explicit "no logo, never invent one"); videos keep the old line.
  const logo = !video && inputs.logo === "icon" ? c.logo ?? null : null;
  const logoNote = video ? null : logo ?? (inputs.logo === "none" ? logoBriefLines({ label: "", reference: false, overlay: null }, 0) : null);
  const block = refs || ours.length || logoNote ? `\n${referenceBlock(refs, closeness, ours, screens && target.kind !== "ugc_video", logoNote, frames)}` : "";
  const recreate = `RECREATE: a ${kindLabel(target)} ad for ${app}, for ${placement.label} (${placement.aspect}, ${placement.size[0]} × ${placement.size[1]})${video ? `, about ${inputs.length} seconds` : ""}. Copy the style, structure and pattern of a proven competitor ad; never its brand${refs ? " or wording" : ", wording or assets"}.${block}`;

  const level = CLOSENESS.find((x) => x.id === closeness)!;
  const keep = keepItems(src, target, flags, decisions, closeness).filter((k) => !k.off && c.keep[k.id] !== false).map((k) => `- ${k.label}: ${k.detail}`);
  const style = styleLine(src.style, closeness);
  if (style) keep.push(`- Style (read from their ${video ? "video" : "image"}): ${fix(style)}`);
  const vs = video ? src.videoScan : null;
  if (vs && closeness !== "loose") {
    if (vs.voiceover_style) keep.push(`- Voiceover style: ${fix(vs.voiceover_style)}`);
    if (vs.captions_style && closeness !== "balanced") keep.push(`- Captions style: ${fix(vs.captions_style)}`);
    if (vs.music_sound && closeness === "very_close") keep.push(`- Sound: ${fix(vs.music_sound)} (never their exact track)`);
  }
  const plan = c.keep.shots === false ? [] : shotPlan(src, inputs.length, closeness, flags, decisions);
  if (closeness === "loose") keep.push("- Everything else is ours: layout, visuals and copy are free.");
  if (closeness === "balanced") keep.push("- Use our own visuals and words.");

  const change: string[] = [`- Brand: ${app}. Show our name only.`];
  // The brand's rules (lib/brand-rules.ts): the same lists QA checks the batch against (the handoff
  // marks the brief brandInBrief, so the Studio adds none of its own and QA still knows them all).
  const avoid = avoidList(src, flags, decisions, app);
  const rules = brandRules({ ...brand, appName: app }, { useProfile: c.useProfile, mustAvoid: avoid });
  const ruled = ruleLines(rules);
  // Our side of the message, from the AI product profile: their structure, our audience, promise and proof.
  const profile = rules.profile;
  if (profile) {
    change.push(`- Our product: ${clip(profile.summary, 320)}`);
    if (profile.audience) change.push(`- Speak to: ${clip(profile.audience, 160)}${profile.pains[0] ? `; their pain: ${clip(profile.pains[0], 140)}` : ""}.`);
    if (profile.promises.length) change.push(`- Our promise: ${profile.promises.slice(0, 2).map((p) => clip(p, 120)).join("; ")}.`);
    if (profile.proof.length) change.push(`- Proof we may state, exactly as written: ${profile.proof.slice(0, 2).map((p) => clip(p, 120)).join("; ")}.`);
    if (profile.visualStyle && (closeness === "loose" || closeness === "balanced") && !brand.system?.look.promptModifier) change.push(`- Our look: ${clip(profile.visualStyle, 200)}`);
  }
  // The brand system: our art direction (whole at Loose and Balanced; at Close and Very close their
  // layout and style lead, so only our colours and how our product looks), our banned words, our offers.
  const sys = rules.system;
  if (sys) {
    if (sys.look.promptModifier && (closeness === "loose" || closeness === "balanced")) change.push(`- Our look (follow exactly): ${clip(sys.look.promptModifier, 600)}`);
    else if (paletteLine(sys)) change.push(`- Our ${paletteLine(sys, 5).replace(/^Colours/, "colours")}`);
    if (sys.look.packaging && (c.productImages?.length || inputs.showProduct)) change.push(`- How our product looks: ${clip(sys.look.packaging, 240)}`);
    if (sys.voice.oneLine && !inputs.tone.trim()) change.push(`- Voice: ${clip(sys.voice.oneLine, 200)}`);
    if (rules.avoidWords.length) change.push(`- Words we never use: ${rules.avoidWords.map(quote).join(", ")}.`);
    if (ruled.offers) change.push(`- ${ruled.offers}`);
    if (ruled.wording) change.push(`- Wording: ${ruled.wording}`);
    if (ruled.required) change.push(`- ${ruled.required}`);
  }
  const colors = inputs.colors.filter(Boolean);
  if (colors.length || inputs.vibe.trim()) change.push(`- Colours: ${colors.length ? colors.join(", ") : "our own"}${inputs.vibe.trim() ? `; vibe: ${fix(inputs.vibe.trim())}` : ""}. Not their colour scheme.`);
  change.push(logo?.overlay ? `- Logo: draw none; our real logo is placed in the ${positionWhere(logo.overlay)} afterwards, so keep that corner clear.`
    : logo?.reference ? "- Logo: ours only, exactly as the attached logo image (see OUR LOGO)."
    : inputs.logo === "icon" && brand.iconUrl ? "- Logo: our app icon only." : "- Logo: none.");
  change.push(inputs.link === "app_store" && brand.appStoreUrl ? `- Link or website shown: ${brand.appStoreUrl}.` : "- Link or website shown: none.");
  if (inputs.cta.trim()) change.push(`- Call to action: ${quote(fix(inputs.cta.trim()))}.`);
  const headline = textLine(video ? "Headline" : "Headline / on-image text", inputs.headline, src.headline, flags, decisions, 160);
  if (headline) change.push(`- ${headline}`);
  const primary = textLine("Primary text", inputs.primaryText, src.body, flags, decisions, 500);
  if (primary) change.push(`- ${primary}`);
  if (!video && inputs.onImageText.trim()) {
    const onImage = textLine("On-image text (replaces all of theirs)", inputs.onImageText, (src.onImageText ?? []).join("\n"), flags, decisions, 400);
    if (onImage) change.push(`- ${onImage}`);
  }
  if (inputs.tone.trim()) change.push(`- Tone: ${clip(fix(inputs.tone.trim()), 300)}`);
  if (!video) {
    change.push(inputs.people === "different" && inputs.person.trim()
      ? `- People: a different person from anyone in their ad: ${clip(fix(inputs.person.trim()), 240)}.`
      : inputs.people === "different" ? "- People: a different person from anyone in their ad." : "- People: none.");
    if (inputs.background.trim()) change.push(`- Background and style: ${clip(fix(inputs.background.trim()), 240)}`);
    change.push(screens
      ? `- Product shown: ${app}'s real screens (${refs || ours.length ? "the attached app screenshots" : "the brand kit screenshots are the references"}).`
      : `- Product shown: ${ours.length ? "our attached product images, where their ad shows its product" : "the same kind of subject their ad shows, made ours"}; no phone or app screens unless their ad has one.`);
    if (target.format !== "single") {
      inputs.cardHeadlines.slice(0, target.cards).forEach((h, i) => {
        const line = textLine(`${target.format === "carousel" ? "Card" : "Option"} ${i + 1} headline`, h, src.cards?.[i]?.title ?? (i === 0 ? src.headline : ""), flags, decisions, 100);
        if (line) change.push(`- ${line}`);
      });
    }
  } else {
    const presenter = [inputs.avatar ? `the "${inputs.avatar.name}" avatar` : "", fix(inputs.presenter.trim())].filter(Boolean).join(": ");
    if (target.kind === "ugc_video") change.push(`- Presenter: ${presenter || "a presenter Higgsfield picks"}; a different person from the one in their ad.`);
    else if (presenter) change.push(`- People: ${presenter}; a different person from anyone in their ad.`);
    if (inputs.setting.trim()) change.push(`- Setting: ${clip(fix(inputs.setting.trim()), 200)}`);
    const voice = textLine("Voiceover script", inputs.voiceover, theirScript(src), flags, decisions, 600);
    if (voice) change.push(`- ${voice}`);
    const captions = textLine("On-screen captions", inputs.captions, theirCaptions(src), flags, decisions, 200);
    if (captions) change.push(`- ${captions}`);
    if (inputs.music.trim()) change.push(`- Music and sound: ${clip(fix(inputs.music.trim()), 160)}`);
    change.push(`- Length: ${inputs.length} seconds.`);
  }
  for (const flag of flags) {
    const d = decisions[flag.id];
    if (d?.action !== "replace" || flag.kind === "brand") continue;
    const replacement = d.with.trim();
    if (change.some((l) => l.includes(replacement))) continue;
    change.push(`- Use our ${FLAG_LABEL[flag.kind].toLowerCase()}: ${quote(clip(replacement, 120))}`);
  }

  const claims = rules.forbiddenClaims;
  const never = [
    `NEVER INCLUDE: ${rules.mustAvoid.map(quote).join(", ") || "their brand"}.`,
    ...(claims.length ? [`Never say: ${claims.map((s) => quote(clip(s, 100))).join(", ")}.`] : []),
    ...(flags.some((f) => f.kind === "logo" && decisions[f.id]?.action !== "keep") ? ["Not their logo or anything that looks like it."] : []),
    refs && video
      ? "Don't reuse any part of their video as it is (footage, faces, logo, product, captions); rebuild every shot as ours. No real person's likeness from their ad."
      : refs
      ? "Don't reuse any part of their image as it is (photo, faces, logo, product, text); rebuild every element as ours. No real person's likeness from their ad."
      : "Don't copy their exact images, footage or faces; no real person's likeness from their ad.",
  ].join("\n");
  const custom = inputs.custom.trim() ? `CUSTOM (where these notes conflict with the reference, follow these notes):\n${clip(inputs.custom.trim(), 800)}` : "";

  const head = recreate;
  const tail = [never, custom].filter(Boolean).join("\n\n");
  const body = (cap: number) => [
    keep.length ? `KEEP from their ad (closeness: ${level.label}, ${level.summary}):\n${keep.map((l) => clip(l, cap)).join("\n")}` : "",
    plan.length ? `SHOT PLAN (their shots, rebuilt as ours; timings fitted to ${inputs.length} s):\n${plan.map((l) => clip(l, Math.min(cap, 320))).join("\n")}` : "",
    `CHANGE (use ours, not theirs):\n${change.map((l) => clip(l, cap)).join("\n")}`,
  ].filter(Boolean).join("\n\n");
  let cap = 700;
  let prompt = [head, body(cap), tail].join("\n\n");
  while (prompt.length > PROMPT_MAX && cap > 60) {
    cap -= 40;
    prompt = [head, body(cap), tail].join("\n\n");
  }
  prompt = prompt.slice(0, PROMPT_MAX);
  return { prompt, mustAvoid: rules.mustAvoid, leaks: leaksIn(prompt, flags, decisions) };
}

/**
 * Flagged text (not kept) still in the prompt outside the NEVER INCLUDE block. A swap line ("theirs" →
 * "ours") quotes theirs on purpose: only the part after the arrow counts.
 */
export function leaksIn(prompt: string, flags: Flag[], decisions: Decisions): string[] {
  const lines = prompt.split("\n");
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^NEVER INCLUDE\b/.test(line)) skipping = true;
    else if (/^(CUSTOM|RECREATE|KEEP|SHOT PLAN|CHANGE|EDIT)\b/.test(line)) skipping = false;
    if (!skipping) kept.push(line.includes(" → ") ? line.slice(line.lastIndexOf(" → ") + 3) : line);
  }
  const text = kept.join("\n");
  return flags.filter((f) => decisions[f.id]?.action !== "keep" && contains(text, f)).map((f) => f.text);
}

// MARK: Handoff to the Studio

export interface RecreateHandoff {
  brief: string;
  placement: PlacementId;
  kind: RecreateKind;
  /** Carousel: the number of cards. */
  cards?: number;
  mustAvoid: string[];
  reference: { adId: string; pageName: string; libraryId: string };
  /** Dynamic ads: one variant per option. */
  variants?: number;
  /** Video length in seconds. */
  duration?: number;
  avatar?: { id: string; type: "preset" | "custom"; name: string } | null;
  useScreenshots?: boolean;
  /** Image ads: their image(s) (stored copies); AI video: their video's key frames. Sent to Higgsfield as references. */
  styleReferences?: string[];
  /** Our product images the user picked, sent after theirs (image ads and AI video). */
  productReferences?: ProductReference[];
  /** Image ads: our logo, as a reference after their image and/or placed on the finished images. */
  logo?: LogoSettings;
  /** An exact recreation: the Studio sends the brief as it is (no app lines, angles or best practices). */
  exact?: boolean;
}

/**
 * What goes to the Studio. Their media goes only as `styleReferences`: an image ad's own image(s) when
 * the sheet's "Use their image as a reference" is on, or an AI video's stored key frames when "Use
 * their key frames" is on. Their video file itself never goes, and UGC video takes no references.
 */
export function buildHandoff(c: ComposeInput, brief: string, mustAvoid: string[], styleReferences: string[] = [], productReferences: ProductReference[] = []): RecreateHandoff {
  const { src, target, inputs } = c;
  const video = target.kind !== "image";
  return {
    brief: brief.trim().slice(0, PROMPT_MAX),
    placement: target.placement.id,
    kind: target.kind,
    ...(target.format === "carousel" ? { cards: target.cards } : {}),
    ...(target.format === "dynamic" ? { variants: Math.min(LIMITS.variants, target.cards) } : {}),
    mustAvoid: cleanMustAvoid(mustAvoid),
    reference: { adId: src.adId, pageName: src.competitor ?? src.pageName, libraryId: src.libraryId },
    ...(video ? { duration: inputs.length, avatar: target.kind === "ugc_video" && inputs.avatar ? { id: inputs.avatar.id, type: inputs.avatar.type === "custom" ? "custom" : "preset", name: inputs.avatar.name } : null } : {}),
    useScreenshots: inputs.showProduct,
    ...(target.kind !== "ugc_video" && styleReferences.length ? { styleReferences: cleanStyleReferences(styleReferences) } : {}),
    ...(target.kind !== "ugc_video" && productReferences.length ? { productReferences: cleanProductReferences(productReferences) } : {}),
    ...(!video && inputs.logo === "icon" && c.logo ? { logo: { url: c.logo.url, label: c.logo.label, reference: c.logo.reference, overlay: c.logo.overlay, inBrief: true } } : {}),
    ...(c.closeness === "exact" && !video && styleReferences.length ? { exact: true, variants: 1 } : {}),
  };
}

const KINDS: RecreateKind[] = ["image", "ugc_video", "ai_video"];
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** A handoff read back from sessionStorage, checked field by field; null when it isn't one. */
export function readHandoff(raw: unknown): RecreateHandoff | null {
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const brief = str(v.brief, PROMPT_MAX).trim();
  const placement = v.placement as PlacementId;
  const kind = v.kind as RecreateKind;
  if (!brief || !PLACEMENT_IDS.includes(placement) || !KINDS.includes(kind)) return null;
  const ref = (v.reference && typeof v.reference === "object" ? v.reference : {}) as Record<string, unknown>;
  const num = (x: unknown, min: number, max: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x))) : undefined);
  const avatar = v.avatar && typeof v.avatar === "object" ? v.avatar as Record<string, unknown> : null;
  const out: RecreateHandoff = {
    brief, placement, kind,
    mustAvoid: cleanMustAvoid(v.mustAvoid),
    reference: { adId: str(ref.adId, 64), pageName: str(ref.pageName, 120) || "a competitor", libraryId: str(ref.libraryId, 40) },
  };
  const cards = num(v.cards, CAROUSEL.minCards, CAROUSEL.maxCards);
  if (cards && kind === "image") out.cards = cards;
  const variants = num(v.variants, 1, LIMITS.variants);
  if (variants) out.variants = variants;
  const duration = num(v.duration, LIMITS.minDuration, LIMITS.maxDuration);
  if (duration) out.duration = duration;
  if (avatar && typeof avatar.id === "string" && typeof avatar.name === "string") out.avatar = { id: avatar.id.slice(0, 80), type: avatar.type === "custom" ? "custom" : "preset", name: avatar.name.slice(0, 80) };
  if (typeof v.useScreenshots === "boolean") out.useScreenshots = v.useScreenshots;
  const refs = cleanStyleReferences(v.styleReferences);
  if (refs.length && kind !== "ugc_video") out.styleReferences = refs;
  const ours = cleanProductReferences(v.productReferences);
  if (ours.length && kind !== "ugc_video") out.productReferences = ours;
  const logo = cleanLogo(v.logo);
  if (logo && kind === "image") out.logo = { ...logo, inBrief: true };
  if (v.exact === true && kind === "image" && out.styleReferences?.length) out.exact = true;
  return out;
}

const UGC_LENGTHS = [5, 10, 15, 20, 30];

/** The Studio's batch request, prefilled from a handoff. */
export function requestFromHandoff(h: RecreateHandoff, base: BatchRequest = DEFAULT_REQUEST): BatchRequest {
  // brandInBrief: the Recreate sheet already put the brand's rules (and the profile, unless it chose not to)
  // in the brief, so the Studio adds none of its own; QA still checks every rule, offers and banned words included.
  const next: BatchRequest = { ...base, brief: h.brief.slice(0, LIMITS.briefChars), kinds: [h.kind], placements: [h.placement], format: "single", mustAvoid: h.mustAvoid, brandInBrief: true, useProfile: false, fromRecreate: true, sourceAd: cleanSourceAd(h.reference) };
  if (h.kind === "image" && h.cards) {
    next.format = "carousel";
    next.cards = h.cards;
    if (!CAROUSEL_PLACEMENTS.includes(h.placement)) next.placements = ["square"];
  }
  if (h.variants) next.variants = h.variants;
  if (h.kind === "ugc_video") {
    next.video = {
      ...base.video,
      ...(h.duration ? { duration: nearestOf(UGC_LENGTHS, h.duration) } : {}),
      ...(h.avatar ? { avatar: h.avatar } : {}),
      ...(h.useScreenshots === false ? { product: "none" as const } : {}),
    };
  }
  if (h.kind === "ai_video") {
    const ai = { ...DEFAULT_REQUEST.aiVideo!, ...base.aiVideo };
    next.aiVideo = { ...ai, ...(h.duration ? { duration: nearestOf(VIDEO_LENGTHS, h.duration) } : {}), ...(h.useScreenshots !== undefined ? { useScreenshots: h.useScreenshots } : {}) };
    // Their key frames go first (the brief's REFERENCE FRAMES numbers them), then our images, then the screenshots.
    if (h.styleReferences?.length) { next.styleReferences = h.styleReferences; next.referencesInBrief = true; }
  }
  if (h.kind === "image" && h.useScreenshots !== undefined) next.image = { ...base.image, useScreenshots: h.useScreenshots };
  if (h.kind === "image" && h.styleReferences?.length) next.styleReferences = h.styleReferences;
  // The brief already says what each of our images is (OUR IMAGES), so the Studio doesn't add its own line.
  if (h.kind !== "ugc_video" && h.productReferences?.length) { next.productReferences = h.productReferences; next.referencesInBrief = true; }
  // The brief says which attached image is our logo (OUR LOGO); the job sends it there and places it after.
  // Without one (Recreate's "no logo"), the Studio's default logo isn't added behind the brief's back.
  next.logo = h.kind === "image" && h.logo ? { ...h.logo, inBrief: true } : null;
  // An exact recreation's brief is the whole prompt: the Studio adds nothing of its own (lib/creative-plan.ts).
  if (h.exact && h.kind === "image") { next.exactRecreate = true; next.referencesInBrief = true; }
  return next;
}
