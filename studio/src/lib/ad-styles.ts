// The Style Library: proven Meta ad formats the person picks, fills in for their own product and sends
// to the Playground (lib/playground.ts) to generate. Each style has a reference screenshot (another
// brand's ad, used only for its layout and look), the fields the person fills in, and a prompt builder
// that describes the layout exactly, puts every on-image word in quotes as typed, says where the
// person's own images go, and swaps the reference's brand for theirs. No AI calls: this only composes a
// request; the Playground shows it, prices it and generates after the person confirms.
// Plain TypeScript with relative imports so the browser and `npx tsx` checks share it.
import type { Aspect } from "./meta-formats";
import { placementById } from "./meta-formats";
import { PLAYGROUND_MAX_INPUTS, type PlaygroundRequest } from "./playground";
import type { TemplateFit } from "./playground-templates";
import type { ProductProfile } from "./product-insight";
import type { AppStoreReview } from "./reviews";

// MARK: Types

export interface StyleOption { value: string; label: string }

export interface StyleField {
  key: string;
  label: string;
  placeholder: string;
  /** The starting value: fixed, or worked out from the product (see defaultFieldsFor). */
  default: string | ((ctx: StyleContext) => string);
  multiline?: boolean;
  maxLength: number;
  required?: boolean;
  /** A fixed set of choices (rendered as a segmented control). */
  options?: StyleOption[];
  /** True when the value is printed on the image word for word (quoted in the prompt). */
  onImage: boolean;
  /** A short tip under the field. */
  hint?: string;
  /** A cell of the style's table (AdStyle.table): its row (from 1) and column. */
  cell?: { row: number; col: string };
  /** Required only when another field makes a claim, e.g. a study footnote once the headline says "clinically proven". */
  requiredIf?: { keys: string[]; pattern: RegExp; message: string };
  /** A number, quote or name that must come from real evidence: never pre-filled (see defaultFieldsFor). */
  evidence?: boolean;
}

/** A column of a style's table of fields (the 5 reasons, problem/solution bubbles, stats…). */
export interface StyleColumn {
  col: string;
  label: string;
  /** Head the column with this field's value instead (e.g. the brand typed above the 5-reasons table). */
  labelFrom?: string;
  /** A fixed width in px; otherwise a share of the rest (fr, default 1). */
  px?: number;
  fr?: number;
  center?: boolean;
}

/** The library's sections, so 15 formats stay easy to scan. */
export type StyleGroup = "social" | "proof" | "hero";
export const STYLE_GROUPS: { id: StyleGroup; label: string }[] = [
  { id: "social", label: "Social-native" },
  { id: "proof", label: "Proof & stats" },
  { id: "hero", label: "Product hero" },
];

export interface AdStyle {
  id: string;
  name: string;
  group: StyleGroup;
  /** The one-line why, for the card. */
  tagline: string;
  /** Why it works, in the person's words. */
  why: string;
  /** Where and for whom it runs best (placements, audience temperature). */
  audience: string;
  /** What it's for (the same guidance a custom template's read has, lib/playground-templates.ts TemplateGuidance). */
  bestFor?: string;
  angle?: string;
  fits?: TemplateFit[];
  adaptTip?: string;
  /** The style's natural ratio. */
  aspect: Aspect;
  /** Other ratios it works in (the first is the default). */
  aspects: Aspect[];
  /** Site-relative (public/ad-styles); the Playground API makes it an absolute URL for Higgsfield. */
  referenceImage: string;
  /** A small version for the card grid. */
  thumbImage: string;
  /** The brands in the reference; sent as mustAvoid so the output never copies them. */
  exampleBrands: string[];
  /** What to attach, shown above the image picker. */
  imageHint: string;
  /** The product is pictured (the first product image is attached by default); otherwise images are optional. */
  needsImages: boolean;
  /** How the attached images are used, for the prompt. */
  imageUse: string;
  /** A rule to respect when filling it in (policy, honesty). */
  caution?: string;
  fields: StyleField[];
  /** How the fields with a `cell` are laid out as a compact table, and what to say when one is missing. */
  table?: { columns: StyleColumn[]; note: string };
  /** Soft cap on the on-image text, for styles where long copy wouldn't fit (9:16 safe zone). */
  textBudget?: number;
}

/** What the prompt and the defaults know about the product. */
export interface StyleContext {
  appName: string;
  productDescription?: string;
  /** The product's category, e.g. "habit tracker" (Product page). */
  category?: string;
  /** Competitor names and handles: kept out of the prompt and sent as mustAvoid. */
  competitors?: string[];
  /** Mobile app / SaaS / physical product…: decides how the product is shown. */
  kind?: string;
  /** The AI product profile, for honest default copy (its promises, features, pains). */
  profile?: ProductProfile | null;
  /** Real App Store reviews, verbatim (lib/reviews.ts): offered by the review picker, never used as defaults. */
  reviews?: AppStoreReview[];
}

/** An image the person attaches (from the workspace's product images). */
export interface StyleInput { url: string; label: string | null }

export interface BuiltStyle {
  prompt: string;
  /** Characters over the Playground's prompt limit (0 when it fits): shorten the text before using it. */
  overBy: number;
  /** Ready for onUse: the Playground shows it for edits and confirms the cost before generating. */
  request: PlaygroundRequest;
}

// MARK: Helpers

const clean = (s: string | undefined | null) => (s ?? "").trim().replace(/\s+/g, " ");
const bare = (s: string) => clean(s).replace(/[.;:!]+$/, "");
const isApp = (kind?: string) => !kind || kind === "mobile_app" || kind === "saas";
const short = (s: string | undefined, max: number) => { const v = bare(s ?? ""); return v && v.length <= max ? v : ""; };
const category = (ctx: StyleContext) => short(ctx.category, 32).toLowerCase();
const appName = (ctx: StyleContext) => clean(ctx.appName);

/** How the product appears in a photo, by kind: an app on a phone, or the product itself. */
function productShot(ctx: StyleContext, where: string) {
  const name = appName(ctx) || "the app";
  return isApp(ctx.kind)
    ? `A hand holding an iPhone with ${name} open on screen, ${where}`
    : `A hand holding ${name}, ${where}`;
}

/** The product as the prompt places it: the phone with the app open, or the product itself. */
const thing = (ctx: StyleContext) => (isApp(ctx.kind) ? "an iPhone showing the app" : "the product");
const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const upperFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const feature = (ctx: StyleContext, i: number) => ctx.profile?.features[i];
const promise = (ctx: StyleContext, i: number, max: number) => short(ctx.profile?.promises[i], max);
const pain = (ctx: StyleContext, i: number, max: number) => short(ctx.profile?.segments[i]?.pain, max) || short(ctx.profile?.pains[i], max);
const audience = (ctx: StyleContext, max: number) => short(ctx.profile?.audience, max);

const STAT_HINT = "A real number from your own data or a published study. Never estimated or invented.";
const SOURCE_HINT = "Who measured it, how many people, when: e.g. Survey of 212 users, Sept 2026.";
const REVIEW_CAUTION = "Base it on a real customer review, used with their permission. Made-up reviews break FTC rules and Meta's ad policies.";
const STATS_CAUTION = "Only real, sourced numbers (your own user data or a published study), with the source printed in the footnote. Made-up or rounded-up stats break Meta's ad policies and consumer-protection law.";
const BEFORE_AFTER_CAUTION = "Use real, unretouched before/after photos of a real customer, with their written permission. Meta restricts before/after images for health, weight and body claims; invented results break its ad policies.";

const SAFE_916 = placementById("stories_reels")?.safe ?? { top: 0.14, bottom: 0.35, sides: 0.06 };
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** The 9:16 safe-zone line (Meta covers the top, bottom and sides of Stories and Reels with its own UI). */
export const SAFE_ZONE_916 =
  `9:16 SAFE ZONE: Meta's interface covers the top ${pct(SAFE_916.top)}, the bottom ${pct(SAFE_916.bottom)} and ${pct(SAFE_916.sides)} at each side. Keep every word, the product and any face between ${pct(SAFE_916.top)} and ${pct(1 - SAFE_916.bottom)} of the height; only background in the covered areas. Don't draw Meta's interface.`;

const ARROW_COLORS: Record<string, string> = {
  yellow: "bright neon yellow (#F4F11C)", white: "pure white", red: "bright red (#FF3B30)", pink: "hot pink (#FF2D87)", green: "bright green (#34C759)",
};

// MARK: The styles

export const AD_STYLES: AdStyle[] = [
  {
    id: "zero-star-review",
    group: "social",
    name: "Zero-star review",
    tagline: "A 1-star rating that's secretly a rave: negativity stops the scroll, the read converts.",
    why: "The controversy of a zero (or one) star rating hooks people in, but when they actually read it, it's a glowing review. The format exploits people's tendency to stop for negativity.",
    audience: "Cold audiences in the feed; products with real, enthusiastic reviews to adapt.",
    bestFor: "Products people love once they try them and have real, enthusiastic reviews for: apps, everyday goods and local services.",
    angle: "social proof",
    fits: ["physical", "app", "service"],
    adaptTip: "For an offer, keep the review about the product and put the deal in the sign-off line, never in the customer's words.",
    aspect: "1:1",
    aspects: ["1:1", "4:5"],
    referenceImage: "/ad-styles/zero-star-review.jpg",
    thumbImage: "/ad-styles/zero-star-review-thumb.jpg",
    exampleBrands: ["First Day"],
    imageHint: "Attach the product (or an app screen) to show in hand in the photo.",
    needsImages: true,
    imageUse: "They are the product in the photo.",
    caution: REVIEW_CAUTION,
    fields: [
      { key: "reviewer", label: "Reviewer name", placeholder: "First name and initial, e.g. Sam R.", default: "", maxLength: 24, required: true, onImage: true,
        hint: "The real reviewer's name as they allow it to be shown." },
      { key: "stars", label: "Rating", placeholder: "", default: "1", maxLength: 1, required: true, onImage: false,
        options: [{ value: "1", label: "1 star" }, { value: "0", label: "0 stars" }] },
      { key: "review", label: "Review", placeholder: "Reads like a complaint, is actually glowing…", maxLength: 360, multiline: true, required: true, onImage: true,
        default: (ctx) => {
          const app = appName(ctx) || "this app";
          const cat = category(ctx);
          const promise = short(ctx.profile?.promises[0], 90);
          return [
            `Absolute game changer, unfortunately 🙄 I put off trying ${app} for months because I thought it was just another ${cat ? `${cat} ` : ""}${isApp(ctx.kind) ? "app" : "gimmick"}.`,
            promise ? `${promise}. Really.` : "",
            "Now I can't stop recommending it, and I wanted so badly to stay annoyed.",
          ].filter(Boolean).join(" ");
        },
        hint: "Start with a complaint-sounding hook; end on the praise." },
      { key: "signOff", label: "Sarcastic sign-off", placeholder: "Thanks a lot …", maxLength: 48, required: true, onImage: true,
        default: (ctx) => (appName(ctx) ? `Thanks a lot ${appName(ctx)}.` : ""), hint: "Printed in bold at the end of the review." },
      { key: "scene", label: "Photo", placeholder: "What the lifestyle photo shows", maxLength: 160, multiline: true, required: true, onImage: false,
        default: (ctx) => productShot(ctx, "outdoors on a sunny lawn, close-up and candid") },
    ],
  },
  {
    id: "ig-story-reply",
    group: "social",
    name: "Story question reply",
    tagline: "Instagram's own question sticker: feels like a reply, not a placement.",
    why: "Native Instagram UI, so it feels familiar. It reads like a creator answering a follower rather than an ad placement, and warm traffic loves it.",
    audience: "Stories and Reels; retargeting and warm audiences who already know the problem.",
    bestFor: "Apps and everyday products people ask friends to recommend, in crowded categories where they want someone to just pick.",
    angle: "social proof",
    fits: ["physical", "app"],
    adaptTip: "For a service, answer with your business's name and point the arrows at a photo of the finished result instead of a product.",
    aspect: "9:16",
    aspects: ["9:16"],
    referenceImage: "/ad-styles/ig-story-reply.jpg",
    thumbImage: "/ad-styles/ig-story-reply-thumb.jpg",
    exampleBrands: ["Free Soul"],
    imageHint: "Attach the product or the phone with the app open; it's the photo the arrows point at.",
    needsImages: true,
    imageUse: "They are the product in the photo the arrows point at.",
    fields: [
      { key: "question", label: "Question", placeholder: "What a follower asked", maxLength: 60, required: true, onImage: true,
        default: (ctx) => {
          const cat = category(ctx);
          return cat ? `Best ${cat} app?` : isApp(ctx.kind) ? "What app do you swear by?" : "What do you swear by?";
        },
        hint: "Short, the way people type in a question box." },
      { key: "answer", label: "Answer", placeholder: "Your reply", maxLength: 40, required: true, onImage: true, default: "Start with this one." },
      { key: "arrowColor", label: "Arrows", placeholder: "", default: "yellow", maxLength: 10, required: true, onImage: false,
        options: Object.keys(ARROW_COLORS).map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) })) },
      { key: "scene", label: "Photo", placeholder: "The casual phone photo under the sticker", maxLength: 160, multiline: true, required: true, onImage: false,
        default: (ctx) => isApp(ctx.kind)
          ? `An iPhone with ${appName(ctx) || "the app"} open, lying on a white marble kitchen counter, shot from above at a slight angle`
          : `${appName(ctx) || "The product"} spread out on a white marble kitchen counter, shot from above at a slight angle` },
    ],
    textBudget: 100,
  },
  {
    id: "notes-breakup",
    group: "social",
    name: "Notes app breakup",
    tagline: "A breakup letter to the old way, in the iPhone Notes app. Petty, personal, unskippable.",
    why: "The breakup letter to your customers' old way of doing things. Personal, petty and impossible to skip, because it looks like a screenshot of someone's notes, not an ad.",
    audience: "Switching campaigns: people stuck with a manual workaround or a worse tool.",
    bestFor: "Apps and services that replace a manual workaround or a clunky old tool: spreadsheets, paper lists, reminders, the old way.",
    angle: "problem awareness",
    fits: ["app", "service"],
    adaptTip: "For a physical product, break up with what it replaces (the old razor, the sugary drink) and paste in a product photo instead of an app screen.",
    aspect: "9:16",
    aspects: ["9:16"],
    referenceImage: "/ad-styles/notes-breakup.jpg",
    thumbImage: "/ad-styles/notes-breakup-thumb.jpg",
    exampleBrands: ["Canva"],
    imageHint: "Optional: the note is the ad. An attached app screen shows as a small pasted picture inside it.",
    needsImages: false,
    imageUse: "Show the first one once, small, as an inline picture inside the note right after the bold paragraph, the way a pasted screenshot looks in Notes.",
    caution: "Break up with the old way (spreadsheets, guesswork), not a named competitor: naming one can get the ad rejected.",
    fields: [
      { key: "title", label: "Title", placeholder: "It's over between us.", default: "It's over between us. Seriously.", maxLength: 44, required: true, onImage: true },
      { key: "p1", label: "Paragraph 1", placeholder: "For too long I've…", maxLength: 130, multiline: true, required: true, onImage: true,
        default: (ctx) => {
          const pain = short(ctx.profile?.pains[0], 90);
          return pain ? `For too long I've put up with this: ${pain.charAt(0).toLowerCase()}${pain.slice(1)}.` : "For too long I've done this the hard way, one painful step at a time.";
        } },
      { key: "p2", label: "Paragraph 2", placeholder: "The petty details of the old way", maxLength: 130, multiline: true, required: true, onImage: true,
        default: "The spreadsheets. The reminders I never set. The 'I'll sort it out later'. I deserve better, and honestly, so do you." },
      { key: "p3", label: "Paragraph 3 (optional)", placeholder: "One more petty line", maxLength: 100, multiline: true, onImage: true, default: "" },
      { key: "found", label: "The new love (bold)", placeholder: "I've found …", maxLength: 120, multiline: true, required: true, onImage: true,
        default: (ctx) => {
          const found = `I've found ${appName(ctx) || "someone new"}.`;
          const promise = short(ctx.profile?.promises[0], 118 - found.length);
          return `${found}${promise ? ` ${promise}.` : ""}`;
        },
        hint: "Printed in bold: the product and what it does for them." },
      { key: "signOff", label: "Sign-off", placeholder: "I wish you well, but…", maxLength: 90, multiline: true, required: true, onImage: true,
        default: "I wish you well. Please don't text me." },
    ],
    textBudget: 560,
  },
  {
    id: "five-reasons-why",
    group: "proof",
    name: "5 reasons why",
    tagline: "A handwritten comparison table: us vs. the rest, read line by line.",
    why: "The cheapest CPMs you'll ever buy. A comparison table people actually read, and need, before they switch.",
    audience: "Feed placements; markets where people compare options on price and features.",
    bestFor: "Products that win a side-by-side on price or features against the usual options: subscriptions, apps, value brands and dupes.",
    angle: "price comparison",
    fits: ["physical", "app", "service"],
    adaptTip: "For an offer, make the rows what the deal includes (price, shipping, trial length) against paying full price elsewhere.",
    aspect: "1:1",
    aspects: ["1:1", "4:5"],
    referenceImage: "/ad-styles/five-reasons-why.jpg",
    thumbImage: "/ad-styles/five-reasons-why-thumb.jpg",
    exampleBrands: ["Fridays"],
    imageHint: "Optional: the table is the ad. Attach a logo or a real-world photo to use as the blurred background.",
    needsImages: false,
    imageUse: "A logo goes small next to our brand on the board; a photo becomes the blurred background.",
    caution: "Only claim what's true for most of the alternatives today, and say what the comparison is based on in the disclaimer.",
    fields: [
      { key: "ours", label: "Our brand", placeholder: "Your brand as written on the board", maxLength: 30, required: true, onImage: true, default: (ctx) => appName(ctx) },
      { key: "theirs", label: "Compared with", placeholder: "Other … apps", maxLength: 36, required: true, onImage: true,
        default: (ctx) => {
          const cat = category(ctx);
          const group = isApp(ctx.kind) ? (cat ? `Other ${cat} apps` : "Other apps") : (cat ? `Other ${cat} brands` : "The usual options");
          return group.length <= 36 ? group : isApp(ctx.kind) ? "Other apps" : "The usual options";
        },
        hint: "A group, not a named competitor." },
      ...[1, 2, 3, 4, 5].flatMap((row): StyleField[] => [
        { key: `r${row}feature`, label: `Reason ${row}`, placeholder: row === 1 ? "e.g. Monthly price" : "A feature or benefit", maxLength: 28, required: true, onImage: true,
          cell: { row, col: "feature" }, default: (ctx) => reasons(ctx)[row - 1] ?? "" },
        { key: `r${row}ours`, label: `Reason ${row}: us`, placeholder: "✓ or $0", maxLength: 12, required: true, onImage: true, cell: { row, col: "ours" }, default: "✓" },
        { key: `r${row}theirs`, label: `Reason ${row}: them`, placeholder: "✗ or $19/mo", maxLength: 12, required: true, onImage: true, cell: { row, col: "theirs" }, default: "✗" },
      ]),
      { key: "disclaimer", label: "Disclaimer (optional)", placeholder: "e.g. Based on public pricing pages, Oct 2026.", maxLength: 140, multiline: true, onImage: true, default: "" },
      { key: "background", label: "Background", placeholder: "The blurred real-world setting behind the board", maxLength: 120, required: true, onImage: false,
        default: "a softly blurred modern office hallway with glass railings and natural light" },
    ],
    table: {
      columns: [
        { col: "feature", label: "Reason" },
        { col: "ours", label: "Us", labelFrom: "ours", px: 88, center: true },
        { col: "theirs", label: "Them", labelFrom: "theirs", px: 88, center: true },
      ],
      note: "Fill in every row (a ✓, ✗ or a price like $0).",
    },
  },
  {
    id: "review-card-quote",
    group: "social",
    name: "Review card quote",
    tagline: "A real 5-star quote on a clean card over a soft lifestyle photo: social proof that feels editorial.",
    why: "People trust other customers more than brands. A single, specific review in a magazine-style card reads as proof rather than a pitch, and the five stars register before a word is read.",
    audience: "Warm and retargeting audiences in the feed; products with strong, specific reviews.",
    bestFor: "Anything with a strong, specific customer review that buyers would weigh before paying: consumer products, apps and services.",
    angle: "social proof",
    fits: ["physical", "app", "service"],
    adaptTip: "For an offer, keep the quote about the product itself and add the deal as a short line under the card, never inside the review.",
    aspect: "4:5",
    aspects: ["4:5", "1:1"],
    referenceImage: "/ad-styles/review-card-quote.jpg",
    thumbImage: "/ad-styles/review-card-quote-thumb.jpg",
    exampleBrands: ["bēm", "Bem"],
    imageHint: "Attach a clean product shot (or the phone with the app open); it overlaps the card's corner.",
    needsImages: true,
    imageUse: "They are the product overlapping the card.",
    caution: REVIEW_CAUTION,
    fields: [
      { key: "headline", label: "Headline", placeholder: "What the review proves, e.g. HELPS WITH DULL SKIN", maxLength: 40, required: true, onImage: true,
        default: (ctx) => promise(ctx, 0, 40).toUpperCase(), hint: "The benefit the review backs up, in a few words." },
      { key: "quote", label: "Review", placeholder: "Paste a real customer's words", maxLength: 160, multiline: true, required: true, onImage: true, default: "", evidence: true,
        hint: "A real review, word for word, used with the customer's permission." },
      { key: "reviewer", label: "Reviewer", placeholder: "First name and initial, e.g. Christine G.", maxLength: 24, required: true, onImage: true, default: "", evidence: true,
        hint: "As the reviewer allows it to be shown." },
      { key: "background", label: "Background photo", placeholder: "The blurred photo behind the card", maxLength: 110, required: true, onImage: false,
        default: "a smiling person in soft daylight against a teal-blue wall" },
    ],
  },
  {
    id: "big-stat-hero",
    group: "proof",
    name: "Big stat hero",
    tagline: "One huge, real number stops the scroll; the proof does the selling.",
    why: "A big number is the fastest thing to read in a feed and it answers \"does it work?\" before anyone asks. Paired with a clean product shot, it looks confident and premium.",
    audience: "Cold audiences in the feed and Stories; products with a survey or study result to point to.",
    bestFor: "Products with one real, sourced result to lead with (a survey, a study, usage data): supplements, skincare, apps with a measurable outcome.",
    angle: "proof in numbers",
    fits: ["physical", "app"],
    adaptTip: "For a service, lead with an outcome you can source (jobs done, average time saved) and show the result or your team instead of a product shot.",
    aspect: "4:5",
    aspects: ["4:5", "9:16"],
    referenceImage: "/ad-styles/big-stat-hero.jpg",
    thumbImage: "/ad-styles/big-stat-hero-thumb.jpg",
    exampleBrands: ["The Ordinary"],
    imageHint: "Attach a clean product shot (or the phone with the app open); it sits across the split.",
    needsImages: true,
    imageUse: "They are the product across the split.",
    caution: STATS_CAUTION,
    fields: [
      { key: "eyebrow", label: "Eyebrow (optional)", placeholder: "e.g. SUITABLE FOR ALL SKIN TYPES", maxLength: 32, onImage: true,
        default: (ctx) => { const a = audience(ctx, 26); return a ? `FOR ${a.toUpperCase()}` : ""; } },
      { key: "stat", label: "The stat", placeholder: "e.g. 90%", maxLength: 8, required: true, onImage: true, default: "", evidence: true, hint: STAT_HINT },
      { key: "statLine", label: "What it measures", placeholder: "e.g. say skin feels more hydrated & looks", maxLength: 56, multiline: true, required: true, onImage: true, default: "", evidence: true,
        hint: "Exactly what was measured, as the source says it." },
      { key: "bigWord", label: "Big word", placeholder: "e.g. PLUMPER", maxLength: 14, required: true, onImage: true, default: "", evidence: true,
        hint: "Ends the sentence in big type." },
      { key: "result", label: "Result line (optional)", placeholder: "e.g. Visible results in 2 weeks", maxLength: 36, onImage: true, default: "" },
      { key: "source", label: "Source", placeholder: "e.g. Survey of 212 users, Sept 2026.", maxLength: 90, multiline: true, required: true, onImage: true, default: "", evidence: true, hint: SOURCE_HINT },
      { key: "texture", label: "Left half", placeholder: "The close-up texture beside the white panel", maxLength: 90, required: true, onImage: false,
        default: "a pale aqua gel texture with soft ripples and tiny bubbles" },
    ],
  },
  {
    id: "clinical-stats-stack",
    group: "proof",
    name: "Clinical stats stack",
    tagline: "Three clean stats with a study footnote: premium, credible and quick to scan.",
    why: "Three results stacked with hairline rules look like a lab report, not an ad. Specific percentages with a named study build trust with sceptical buyers, and the plinth shot keeps it premium.",
    audience: "Feed placements; considered purchases where people want evidence before they buy.",
    bestFor: "Physical products with study-backed results that people research before buying: skincare, supplements, health and wellness.",
    angle: "authority",
    fits: ["physical"],
    adaptTip: "For an app, use three stats from your own user data with the source in the footnote, and stand a phone showing the app on the plinth.",
    aspect: "4:5",
    aspects: ["4:5", "1:1"],
    referenceImage: "/ad-styles/clinical-stats-stack.jpg",
    thumbImage: "/ad-styles/clinical-stats-stack-thumb.jpg",
    exampleBrands: [],
    imageHint: "Attach a clean product shot (or the phone with the app open); it stands on the stone plinth.",
    needsImages: true,
    imageUse: "They are the product on the plinth.",
    caution: STATS_CAUTION,
    fields: [
      { key: "head1", label: "Headline", placeholder: "e.g. DAILY PLANNER", maxLength: 22, required: true, onImage: true,
        default: (ctx) => (category(ctx) || appName(ctx)).toUpperCase().slice(0, 22).trim() },
      { key: "head2", label: "Headline line 2", placeholder: "e.g. BRIGHTEN AND FIRM YOUR SKIN", maxLength: 36, required: true, onImage: true,
        default: (ctx) => promise(ctx, 0, 36).toUpperCase() },
      ...[1, 2, 3].flatMap((row): StyleField[] => [
        { key: `s${row}stat`, label: `Stat ${row}`, placeholder: "94%", maxLength: 6, required: true, onImage: true, cell: { row, col: "stat" }, default: "", evidence: true },
        { key: `s${row}text`, label: `Stat ${row}: what it measures`, placeholder: "saw improvement in skin texture", maxLength: 52, required: true, onImage: true, cell: { row, col: "text" }, default: "", evidence: true },
      ]),
      { key: "footnote", label: "Study footnote", placeholder: "e.g. Based on a 28-day consumer study of 30 people.", maxLength: 100, multiline: true, required: true, onImage: true, default: "", evidence: true, hint: SOURCE_HINT },
    ],
    table: {
      columns: [{ col: "stat", label: "Stat", px: 72, center: true }, { col: "text", label: "What it measures" }],
      note: `Every stat needs its number and what it measures. ${STAT_HINT}`,
    },
  },
  {
    id: "before-after-stats",
    group: "proof",
    name: "Before/after with stats",
    tagline: "Real results side by side, backed by two numbers: the most persuasive proof there is.",
    why: "A before/after shows the outcome instead of describing it, and two stats underneath turn one person's result into evidence. The product beside it ties the result to what they'd buy.",
    audience: "Cold audiences in the feed; products with visible results and customers happy to share them.",
    bestFor: "Products and services with a visible result real customers will share photos of: skincare, fitness, cleaning, beauty and home services.",
    angle: "visible results",
    fits: ["physical", "service"],
    adaptTip: "For an app, show a before and after screen (the messy spreadsheet, then the app's clean view) instead of photos of people.",
    aspect: "1:1",
    aspects: ["1:1", "4:5"],
    referenceImage: "/ad-styles/before-after-stats.jpg",
    thumbImage: "/ad-styles/before-after-stats-thumb.jpg",
    exampleBrands: ["Botane"],
    imageHint: "Attach, in order: the real before photo, the real after photo, then the product (or an app screen).",
    needsImages: true,
    imageUse: "In order: the real before photo, the real after photo, then the product standing on the right.",
    caution: `${BEFORE_AFTER_CAUTION} ${STATS_CAUTION}`,
    fields: [
      { key: "eyebrow", label: "Eyebrow (optional)", placeholder: "e.g. Independently tested", maxLength: 28, onImage: true, default: "",
        hint: "Only a claim you can back up." },
      { key: "head1", label: "Headline", placeholder: "e.g. One gel.", maxLength: 24, required: true, onImage: true,
        default: (ctx) => (isApp(ctx.kind) ? "One app." : "One product.") },
      { key: "head2", label: "Headline line 2", placeholder: "e.g. Multiple results.", maxLength: 28, required: true, onImage: true, default: "Real results." },
      ...[1, 2].flatMap((row): StyleField[] => [
        { key: `s${row}stat`, label: `Stat ${row}`, placeholder: "97%", maxLength: 8, required: true, onImage: true, cell: { row, col: "stat" }, default: "", evidence: true },
        { key: `s${row}text`, label: `Stat ${row}: what it measures`, placeholder: "noticed softer skin", maxLength: 36, required: true, onImage: true, cell: { row, col: "text" }, default: "", evidence: true },
      ]),
      { key: "source", label: "Source", placeholder: "e.g. Survey of 120 customers after 4 weeks, 2026.", maxLength: 90, multiline: true, required: true, onImage: true, default: "", evidence: true, hint: SOURCE_HINT },
    ],
    table: {
      columns: [{ col: "stat", label: "Stat", px: 72, center: true }, { col: "text", label: "What it measures" }],
      note: `Both stats need a number and what it measures. ${STAT_HINT}`,
    },
  },
  {
    id: "taped-before-after",
    group: "proof",
    name: "Taped before/after",
    tagline: "A scrapbook before/after with tape and a handwritten note: reads like a friend's journal, not an ad.",
    why: "Taped photos, an underlined line and a hand-circled note feel personal and lo-fi, so people look closer instead of skipping. The side-by-side result does the convincing.",
    audience: "Feed and Stories for beauty, wellness and visible-result products; UGC-style testing.",
    bestFor: "Beauty, wellness and other visible-result products or treatments, in a lo-fi, UGC look that suits testing new angles.",
    angle: "visible results",
    fits: ["physical", "service"],
    adaptTip: "For an app, tape up two screenshots (before: the old way; after: your app) and keep the handwritten note.",
    aspect: "4:5",
    aspects: ["4:5", "1:1"],
    referenceImage: "/ad-styles/taped-before-after.jpg",
    thumbImage: "/ad-styles/taped-before-after-thumb.jpg",
    exampleBrands: ["Smytten", "Glo Bleach", "Instant Glo"],
    imageHint: "Attach, in order: the real before photo, the real after photo, then the product (or an app screen).",
    needsImages: true,
    imageUse: "In order: the real before photo, the real after photo, then the product at bottom right.",
    caution: BEFORE_AFTER_CAUTION,
    fields: [
      { key: "line", label: "Line (optional)", placeholder: "e.g. Enriched with", maxLength: 24, onImage: true, default: (ctx) => (isApp(ctx.kind) ? "The secret:" : "Made with") },
      { key: "highlight", label: "Underlined part", placeholder: "e.g. Aloe Vera and Turmeric", maxLength: 32, required: true, onImage: true,
        default: (ctx) => short(feature(ctx, 0)?.name, 32), hint: "Underlined with a marker stroke." },
      { key: "caption", label: "Handwritten note", placeholder: "e.g. Instant, natural glow.", maxLength: 28, required: true, onImage: true,
        default: (ctx) => promise(ctx, 0, 28), hint: "Circled by hand, bottom left." },
    ],
  },
  {
    id: "trust-badges-benefits",
    group: "hero",
    name: "Trust badges & benefits",
    tagline: "Seals on one side, benefit icons on the other: trust and the reasons to buy in one glance.",
    why: "Trust seals answer \"is it safe?\" and four icon benefits answer \"what does it do?\" around a big, clean product shot. It reads in a second and suits people comparing options.",
    audience: "Feed and Stories; products with real certifications or plain, checkable facts to show.",
    bestFor: "Physical products with real certifications or checkable facts (vegan, cruelty-free, made in…) sold to people comparing options.",
    angle: "trust",
    fits: ["physical"],
    adaptTip: "For an app, swap the seals for real, checkable facts (App Store rating, no account needed, works offline) and stand a phone in the centre.",
    aspect: "4:5",
    aspects: ["4:5", "9:16"],
    referenceImage: "/ad-styles/trust-badges-benefits.jpg",
    thumbImage: "/ad-styles/trust-badges-benefits-thumb.jpg",
    exampleBrands: ["Tower 28", "National Eczema Association", "National Rosacea Society", "National Psoriasis Foundation"],
    imageHint: "Attach a clean product shot (or the phone with the app open); it stands in the centre.",
    needsImages: true,
    imageUse: "They are the product in the centre.",
    caution: "The badges look like certification seals: use only seals you really hold, or plain true facts (e.g. Vegan, Works offline). Never an award or certification you don't have.",
    fields: [
      { key: "headline", label: "Headline", placeholder: "Your product's name", maxLength: 28, required: true, onImage: true, default: (ctx) => appName(ctx).toUpperCase().slice(0, 28).trim() },
      { key: "subline", label: "Subline", placeholder: "What it is, e.g. DAILY RESCUE FACIAL SPRAY", maxLength: 40, required: true, onImage: true,
        default: (ctx) => (category(ctx) || promise(ctx, 0, 40)).toUpperCase() },
      ...[1, 2, 3, 4].map((i): StyleField => ({
        key: `benefit${i}`, label: `Benefit ${i}`, placeholder: i === 1 ? "e.g. CALMS REDNESS" : "A short benefit", maxLength: 30, required: true, onImage: true,
        default: (ctx) => (labels(ctx, 30, false)[i - 1] ?? "").toUpperCase(),
      })),
      ...[1, 2, 3].map((i): StyleField => ({
        key: `badge${i}`, label: i === 3 ? "Badge 3 (optional)" : `Badge ${i}`, placeholder: i === 1 ? "e.g. Cruelty-free" : "A true fact or seal you hold", maxLength: 22, required: i < 3, onImage: true,
        default: (ctx) => short(ctx.profile?.differentiators[i - 1], 22), hint: i === 1 ? "Only true facts or seals you really hold." : undefined,
      })),
      { key: "spec", label: "Spec bar", placeholder: "e.g. 1 fl oz (30 ml) | Daily essential", maxLength: 44, required: true, onImage: true,
        default: (ctx) => {
          const a = audience(ctx, 24);
          const both = [upperFirst(category(ctx)), a ? `For ${lowerFirst(a)}` : ""].filter(Boolean).join(" | ");
          return (both.length <= 44 ? both : upperFirst(category(ctx))) || (isApp(ctx.kind) ? "" : "Daily essential");
        },
        hint: "Size, format or who it's for." },
    ],
  },
  {
    id: "clinically-proven-callouts",
    group: "hero",
    name: "Benefit callouts",
    tagline: "A clear claim, the product and three icon benefits joined by dotted lines: an instant product brief.",
    why: "It works like a diagram: the eye goes from the claim to the product to each benefit. A highlighted phrase lands the main promise, and the callouts make the product feel engineered.",
    audience: "Feed placements; products with two or three distinct, easy-to-picture benefits.",
    bestFor: "Products with two or three distinct, easy-to-picture benefits: gadgets, skincare, supplements, or an app with clear features.",
    angle: "education",
    fits: ["physical", "app"],
    adaptTip: "For a service, put a photo of the finished result in the centre and call out what's included.",
    aspect: "4:5",
    aspects: ["4:5", "1:1"],
    referenceImage: "/ad-styles/clinically-proven-callouts.jpg",
    thumbImage: "/ad-styles/clinically-proven-callouts-thumb.jpg",
    exampleBrands: ["COSRX"],
    imageHint: "Attach a clean product shot (or the phone with the app open); it stands in the centre.",
    needsImages: true,
    imageUse: "They are the product in the centre.",
    caution: "Only say \"clinically proven\" or \"tested\" if a real study backs it, and name the study in the footnote (who, how many people, how long). Otherwise keep a softer headline like the one filled in.",
    fields: [
      { key: "headline", label: "Headline", placeholder: "e.g. Clinically Proven (only if true)", maxLength: 28, required: true, onImage: true,
        default: (ctx) => { const a = audience(ctx, 19); return a ? `Made for ${lowerFirst(a)}` : "Made for every day"; } },
      { key: "line1", label: "Line before the highlight (optional)", placeholder: "e.g. The Ultimate", maxLength: 24, onImage: true, default: "Your everyday" },
      { key: "highlight", label: "Highlighted phrase", placeholder: "e.g. Barrier-Strengthening Solution", maxLength: 36, required: true, onImage: true,
        default: (ctx) => upperFirst(category(ctx)) || short(feature(ctx, 0)?.name, 36), hint: "White on a solid colour bar." },
      { key: "line3", label: "Line after the highlight (optional)", placeholder: "e.g. for Sensitive & Dry Skin", maxLength: 36, onImage: true,
        default: (ctx) => { const a = audience(ctx, 30); return a ? `for ${lowerFirst(a)}` : ""; } },
      ...[1, 2, 3].map((i): StyleField => ({
        key: `callout${i}`, label: `Callout ${i}`, placeholder: i === 1 ? "e.g. Skin barrier" : "A benefit in two words", maxLength: 20, required: true, onImage: true,
        default: (ctx) => labels(ctx, 20)[i - 1] ?? "",
      })),
      { key: "footnote", label: "Study footnote", placeholder: "e.g. Clinical test by an independent lab, 20 people aged 20–59, 2026.", maxLength: 120, multiline: true, onImage: true, default: "", evidence: true,
        requiredIf: { keys: ["headline", "line1", "highlight", "line3"], pattern: /clinical|proven|tested|dermatolog|stud(y|ies)|trial/i, message: "Name the study: your text claims it was tested" },
        hint: "Required when the text says clinically proven or tested." },
    ],
  },
  {
    id: "question-orbit",
    group: "hero",
    name: "Question orbit",
    tagline: "Four questions the viewer is already asking, orbiting the product: every \"yes\" pulls them closer.",
    why: "Questions make people answer in their head, and each \"yes\" is a small commitment. The floating product with orbit lines feels premium and gives the eye a path around the frame.",
    audience: "Cold audiences in the feed; products that solve several related problems.",
    bestFor: "Products that answer several questions buyers already ask themselves: problem-solvers with more than one use.",
    angle: "curiosity",
    fits: ["physical", "app"],
    adaptTip: "For a service, let the questions orbit a photo of the outcome (a spotless flat, a finished garden) instead of a product.",
    aspect: "4:5",
    aspects: ["4:5", "1:1"],
    referenceImage: "/ad-styles/question-orbit.jpg",
    thumbImage: "/ad-styles/question-orbit-thumb.jpg",
    exampleBrands: ["Abib"],
    imageHint: "Attach a clean product shot (or the phone with the app open); it floats in the centre.",
    needsImages: true,
    imageUse: "They are the floating product.",
    fields: [1, 2, 3, 4].map((i): StyleField => ({
      key: `q${i}`, label: `Question ${i}`, placeholder: i === 1 ? "e.g. Want calmer mornings?" : "Want to …?", maxLength: 44, required: true, onImage: true,
      default: (ctx) => {
        const p = promise(ctx, i - 1, 34);
        if (p) return `Want to ${lowerFirst(bare(p))}?`;
        const hurt = pain(ctx, i - 1, 32);
        return hurt ? `Tired of ${lowerFirst(bare(hurt))}?` : "";
      },
      hint: i === 1 ? "Questions your buyers would answer yes to." : undefined,
    })),
  },
  {
    id: "one-product-many-moments",
    group: "hero",
    name: "One product, many moments",
    tagline: "One product, six everyday moments around it: shows how often they'd use it, so the price feels small.",
    why: "Listing real moments of use lets more people see themselves in one ad, and \"one product, many jobs\" is an easy value story. The circle keeps six messages calm and readable.",
    audience: "Feed placements; versatile products with several distinct uses or audiences.",
    bestFor: "Versatile products used many times a day or for many jobs, where how often they're used makes the price feel small.",
    angle: "value",
    fits: ["physical", "app"],
    adaptTip: "For a service, list the moments it helps (moving day, after a party, before guests arrive) around a photo of your team or the result.",
    aspect: "4:5",
    aspects: ["4:5", "1:1"],
    referenceImage: "/ad-styles/one-product-many-moments.jpg",
    thumbImage: "/ad-styles/one-product-many-moments-thumb.jpg",
    exampleBrands: ["nemah"],
    imageHint: "Attach a clean product shot (or the phone with the app open); it rises from the bottom through the circle.",
    needsImages: true,
    imageUse: "They are the product rising through the circle.",
    fields: [
      { key: "line1", label: "Headline", placeholder: "e.g. One spray.", maxLength: 32, required: true, onImage: true, default: (ctx) => (isApp(ctx.kind) ? "One app." : "One product.") },
      { key: "line2", label: "Headline line 2", placeholder: "e.g. Six fewer steps in your routine.", maxLength: 48, required: true, onImage: true, default: "Six moments it makes easier." },
      ...[1, 2, 3, 4, 5, 6].flatMap((row): StyleField[] => [
        { key: `m${row}title`, label: `Moment ${row}`, placeholder: row === 1 ? "e.g. POST-WORKOUT" : "A moment", maxLength: 22, required: true, onImage: true, cell: { row, col: "title" },
          default: (ctx) => short(feature(ctx, row - 1)?.name, 22).toUpperCase() },
        { key: `m${row}line`, label: `Moment ${row}: line`, placeholder: "e.g. Quick reset after the gym", maxLength: 34, required: true, onImage: true, cell: { row, col: "line" },
          default: (ctx) => upperFirst(short(feature(ctx, row - 1)?.benefit, 34)) },
      ]),
    ],
    table: {
      columns: [{ col: "title", label: "Moment" }, { col: "line", label: "One line", fr: 1.4 }],
      note: "Fill in all six moments, each with its line.",
    },
  },
  {
    id: "problem-solution",
    group: "hero",
    name: "Problem ? Solution !",
    tagline: "Name the problem, show the fix: three speech bubbles make the value obvious in a second.",
    why: "Problem/solution is the clearest story in advertising. People spot their own problem in a bubble, see exactly what fixes it, and the arrows tie every answer back to the product.",
    audience: "Cold audiences in the feed and Stories; products that solve several specific problems.",
    bestFor: "Anything that fixes several specific, nameable problems: apps, household products and services.",
    angle: "problem awareness",
    fits: ["physical", "app", "service"],
    adaptTip: "For an offer, keep the bubbles about the problems and put the deal in the closing line, not in a bubble.",
    aspect: "4:5",
    aspects: ["4:5", "9:16"],
    referenceImage: "/ad-styles/problem-solution.jpg",
    thumbImage: "/ad-styles/problem-solution-thumb.jpg",
    exampleBrands: ["Dot & Key", "Smytten"],
    imageHint: "Attach a clean product shot (or the phone with the app open); it sits tilted among the bubbles.",
    needsImages: true,
    imageUse: "They are the tilted product the arrows point at.",
    fields: [1, 2, 3].flatMap((row): StyleField[] => [
      { key: `b${row}problem`, label: `Bubble ${row}: problem`, placeholder: row === 1 ? "e.g. REDNESS" : "A problem", maxLength: 22, required: true, onImage: true, cell: { row, col: "problem" },
        default: (ctx) => pain(ctx, row - 1, 22).toUpperCase() },
      { key: `b${row}solution`, label: `Bubble ${row}: solution`, placeholder: "e.g. CICA EXTRACT", maxLength: 22, required: true, onImage: true, cell: { row, col: "solution" },
        default: (ctx) => short(feature(ctx, row - 1)?.name, 22).toUpperCase() },
      { key: `b${row}benefit`, label: `Bubble ${row}: benefit`, placeholder: "e.g. Calms irritation and repairs skin", maxLength: 44, required: true, onImage: true, cell: { row, col: "benefit" },
        default: (ctx) => upperFirst(short(feature(ctx, row - 1)?.benefit, 44)) },
    ]),
    table: {
      columns: [{ col: "problem", label: "Problem" }, { col: "solution", label: "Solution" }, { col: "benefit", label: "Benefit", fr: 1.6 }],
      note: "Fill in all three bubbles: the problem, what solves it, and one line on the benefit.",
    },
  },
  {
    id: "dont-buy-this",
    group: "hero",
    name: "Don't buy this",
    tagline: "Reverse psychology: a headline telling people not to buy gets read to the end.",
    why: "\"Don't buy this\" breaks the pattern of every other ad, so curiosity wins and people read the \"unless…\" line. It qualifies the audience too: the ones who want that result lean in.",
    audience: "Cold audiences in the feed and Stories; products with one clear, desirable outcome.",
    bestFor: "Products with one clear, desirable outcome the \"unless you want…\" line can promise: consumer goods and apps.",
    angle: "curiosity",
    fits: ["physical", "app"],
    adaptTip: "For a service, make it \"Don't book this\" and swap the product shot for a photo of the result.",
    aspect: "4:5",
    aspects: ["4:5", "9:16"],
    referenceImage: "/ad-styles/dont-buy-this.jpg",
    thumbImage: "/ad-styles/dont-buy-this-thumb.jpg",
    exampleBrands: ["Terra", "One & Done"],
    imageHint: "Attach a clean product shot (or the phone with the app open); it overlaps the big headline.",
    needsImages: true,
    imageUse: "They are the product overlapping the headline.",
    fields: [
      { key: "verb", label: "Verb", placeholder: "", maxLength: 8, required: true, onImage: true,
        default: (ctx) => (isApp(ctx.kind) ? "DOWNLOAD" : "BUY"),
        options: [{ value: "BUY", label: "Buy" }, { value: "DOWNLOAD", label: "Download" }, { value: "TRY", label: "Try" }] },
      { key: "thing", label: "Product type", placeholder: "e.g. PLANNER", maxLength: 12, required: true, onImage: true,
        default: (ctx) => (isApp(ctx.kind) ? "APP" : (category(ctx).split(" ").pop() ?? "").toUpperCase().slice(0, 12)), hint: "The last line of the headline." },
      { key: "subline", label: "Subline", placeholder: "Unless you want …", maxLength: 60, multiline: true, required: true, onImage: true,
        default: (ctx) => { const p = promise(ctx, 0, 40); return p ? `Unless you want to ${lowerFirst(bare(p))}.` : ""; },
        hint: "Starts with \"Unless you want\": the result they'd get." },
      ...[1, 2, 3].map((i): StyleField => ({
        key: `check${i}`, label: `Benefit ${i}`, placeholder: i === 1 ? "e.g. Deep hydration" : "A short benefit", maxLength: 24, required: true, onImage: true,
        default: (ctx) => labels(ctx, 24)[i - 1] ?? "",
      })),
    ],
  },
];

/**
 * Short labels from the product's own profile (never invented): its feature names, then its
 * differentiators (or, without them, its promises), each at most `max` characters.
 */
function labels(ctx: StyleContext, max: number, withDifferentiators = true): string[] {
  const p = ctx.profile;
  if (!p) return [];
  const names = [...p.features.map((f) => f.name), ...(withDifferentiators ? p.differentiators : p.promises)].map((s) => short(s, max)).filter(Boolean);
  return [...new Set(names)];
}

/** Feature names short enough for a 5-reasons row. */
const reasons = (ctx: StyleContext) => labels(ctx, 28).slice(0, 5);

export const adStyleById = (id: string) => AD_STYLES.find((s) => s.id === id);

// MARK: Defaults and validation

/** Starting values for a style's fields, from the product (name, category, profile). All editable. */
export function defaultFieldsFor(style: AdStyle, ctx: StyleContext): Record<string, string> {
  // Evidence (a stat, a review, a study) is never pre-filled: the person types the real one.
  return Object.fromEntries(style.fields.map((f) => [f.key, f.evidence ? "" : typeof f.default === "function" ? f.default(ctx) : f.default]));
}

/** Problems with the filled-in fields, by key (empty when it's ready to use). */
export function validateStyleFields(style: AdStyle, fields: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of style.fields) {
    const v = clean(fields[f.key]);
    if (f.required && !v) errors[f.key] = "Required";
    else if (!v && f.requiredIf && f.requiredIf.keys.some((k) => f.requiredIf!.pattern.test(fields[k] ?? ""))) errors[f.key] = f.requiredIf.message;
    else if (v.length > f.maxLength) errors[f.key] = `${v.length}/${f.maxLength} characters`;
    else if (f.options && v && !f.options.some((o) => o.value === v)) errors[f.key] = "Pick one";
  }
  return errors;
}

/** Characters of on-image text, for styles with a budget. */
export const onImageLength = (style: AdStyle, fields: Record<string, string>) =>
  style.fields.filter((f) => f.onImage).reduce((n, f) => n + clean(fields[f.key]).length, 0);

/** Competitor names the person typed into on-image text (worth a warning; ads naming rivals get rejected). */
export function namedCompetitors(style: AdStyle, fields: Record<string, string>, ctx: StyleContext): string[] {
  const text = style.fields.filter((f) => f.onImage).map((f) => fields[f.key] ?? "").join(" \n ").toLowerCase();
  return (ctx.competitors ?? []).map(clean).filter((c) => c.length > 2 && wordIn(text, c.toLowerCase()));
}

const wordIn = (text: string, word: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(text);

// MARK: The prompt

/** The Playground's prompt limit (PLAYGROUND_PROMPT.max in lib/playground-plan.ts); optional lines drop to stay under it. */
export const STYLE_PROMPT_MAX = 2000;

const q = (s: string) => `"${clean(s)}"`;
const cutWords = (s: string, max: number) => (s.length > max ? `${s.slice(0, max).replace(/\s+\S*$/, "")}…` : s);
const TEXT_RULE = "TEXT ON THE IMAGE, exactly as written (letter for letter; nothing added or reworded; no other words):";

/** What the attached images are and where they go. The reference is image 1, so theirs start at 2. */
function inputLine(style: AdStyle, inputs: StyleInput[], ctx: StyleContext, withLabels = true): string {
  const name = appName(ctx);
  if (!inputs.length) {
    if (!style.needsImages) return "";
    return isApp(ctx.kind)
      ? "No product images attached: keep the phone screen simple, with no readable interface text and no other brand."
      : `No product images attached: show ${name}'s product simply, with no readable label and no other brand.`;
  }
  const range = inputs.length === 1 ? "Image 2" : `Images 2–${inputs.length + 1}`;
  const names = withLabels ? ` (${inputs.map((x) => cutWords(clean(x.label), 30) || "product").join("; ")})` : "";
  return `${range}${names}: ${name}'s own. ${style.imageUse} Keep them exactly as they are; never invent screens or packaging.`;
}

/** Before/after styles show only the person's real photos; missing ones become plain placeholders, never invented results. */
const BEFORE_AFTER_RULE = "Use only the attached before/after photos; if one is missing, show a plain light-grey photo placeholder there. Never invent a face, body or result.";

function layout(style: AdStyle, f: Record<string, string>, ctx: StyleContext, aspect: Aspect): string[] {
  const name = appName(ctx);
  const P = thing(ctx);
  const safe = aspect === "9:16" ? [SAFE_ZONE_916] : [];
  const has = (key: string) => Boolean(clean(f[key]));
  switch (style.id) {
    case "zero-star-review":
      return [
        `PHOTO: ${bare(f.scene)}. Full-bleed, natural light, shallow depth of field, shot on a phone.`,
        "TOP LEFT: the brand name as a small thin white wordmark (or the attached logo).",
        "REVIEW CARD: white, rounded, soft shadow, ~80% wide, centred over the bottom ~40%. Top row: grey default-avatar circle and the name (dark grey) on the left; five stars on the right, " +
          (f.stars === "0" ? "all empty pale-grey outlines." : "the first filled golden yellow, four empty pale-grey outlines.") +
          " Below: the review, centred, dark grey rounded sans-serif, the sign-off in bold.",
        TEXT_RULE,
        `- Wordmark: ${q(name)}`,
        `- Reviewer: ${q(f.reviewer)}`,
        `- Review: ${q(f.review)}`,
        `- Bold sign-off ending the review: ${q(f.signOff)}`,
      ];
    case "ig-story-reply":
      return [
        "An Instagram Story: a casual phone photo with Instagram's native question-reply sticker and hand-drawn arrows. No other Instagram interface.",
        `PHOTO: ${bare(f.scene)}. Full-bleed, everyday light, a little grain; a real person's story, not an ad.`,
        "STICKER (Instagram's exact style): a rounded card ~70% wide, centred at ~30–42% of the height. Top: a dark charcoal band with the question in small white Instagram sans; below: white, the answer in larger bold black sans, centred. No outline, faint shadow.",
        `ARROWS: two or three thick hand-drawn ${ARROW_COLORS[f.arrowColor] ?? ARROW_COLORS.yellow} marker arrows (Instagram pen tool, uneven strokes) pointing at the product.`,
        TEXT_RULE,
        `- Question: ${q(f.question)}`,
        `- Answer: ${q(f.answer)}`,
        SAFE_ZONE_916,
      ];
    case "notes-breakup":
      return [
        "A full-screen iPhone screenshot of one note in Apple Notes, light mode: white page, black SF Pro text, left aligned.",
        "TOP: the iOS status bar, then the Notes bar: a yellow-gold back chevron with \"Notes\" on the left, a round '…' button on the right. No toolbar or keyboard.",
        "BODY: the title as a large bold heading, then the paragraphs with an empty line between them; only the 'found' paragraph is bold.",
        TEXT_RULE,
        `- Title: ${q(f.title)}`,
        `- ${q(f.p1)}`,
        `- ${q(f.p2)}`,
        ...(clean(f.p3) ? [`- ${q(f.p3)}`] : []),
        `- Bold: ${q(f.found)}`,
        `- ${q(f.signOff)}`,
        `9:16 SAFE ZONE: Meta's interface covers the top ${pct(SAFE_916.top)}, the bottom ${pct(SAFE_916.bottom)} and ${pct(SAFE_916.sides)} at each side. Only the status and Notes bars may sit in the top ${pct(SAFE_916.top)}; the text runs from just below it to above ${pct(1 - SAFE_916.bottom)} of the height, then empty note paper.`,
      ];
    case "five-reasons-why": {
      const rows = [1, 2, 3, 4, 5].map((r) => `- Row ${r}: ${q(f[`r${r}feature`])} | ${q(f[`r${r}ours`])} | ${q(f[`r${r}theirs`])}`);
      return [
        "A whiteboard with a handwritten comparison table filling most of the frame, casual uneven marker handwriting.",
        `BACKGROUND: ${bare(f.background)}, heavily blurred and muted.`,
        "BOARD: big headline on top; under it, centred, our brand in green, a black \">\", the comparison group in black; a drawn line; then five rows of three columns (reason in black, ours, theirs), no grid. ✓ = drawn check mark, ✗ = drawn cross; ours in green, their crosses red, their prices black.",
        TEXT_RULE,
        "- Headline: \"5 REASONS WHY\"",
        `- Our brand: ${q(f.ours)}`,
        `- Comparison group: ${q(f.theirs)}`,
        ...rows,
        ...(clean(f.disclaimer) ? [`- Tiny white disclaimer under the board: ${q(f.disclaimer)}`] : []),
      ];
    }
    case "review-card-quote":
      return [
        `BACKGROUND: ${bare(f.background)}, softly out of focus.`,
        "CARD: white, rounded, ~60% wide, slightly right of centre, from ~15% to ~85% of the height. Centred inside: the headline in bold dark-grey condensed sans; a short thin grey rule; five filled lavender stars; the review in quotation marks, dark-grey sans; the reviewer's name below, right of centre.",
        `PRODUCT: ${P}, tilted ~15°, overlapping the card's lower-left edge, soft shadow.`,
        TEXT_RULE,
        `- Headline: ${q(f.headline)}`,
        `- Review, inside quotation marks: ${q(f.quote)}`,
        `- Reviewer: ${q(f.reviewer)}`,
      ];
    case "big-stat-hero":
      return [
        `SPLIT: the left ~45% a soft close-up of ${bare(f.texture)}; the right a clean white panel.`,
        `PRODUCT: ${P}, large and upright, straddling the split, soft shadow.`,
        "RIGHT PANEL, left aligned, top to bottom: the eyebrow in tiny grey letter-spaced caps; the stat huge in bold charcoal geometric sans; the sentence in grey regular sans; the big word in bold charcoal; the result line small and grey. The source in tiny grey type at the bottom right.",
        TEXT_RULE,
        ...(has("eyebrow") ? [`- Eyebrow: ${q(f.eyebrow)}`] : []),
        `- Stat: ${q(f.stat)}`,
        `- Sentence: ${q(f.statLine)}`,
        `- Big word: ${q(f.bigWord)}`,
        ...(has("result") ? [`- Result line: ${q(f.result)}`] : []),
        `- Source: ${q(f.source)}`,
        ...safe,
      ];
    case "clinical-stats-stack":
      return [
        "BACKGROUND: warm light-grey seamless, soft daylight.",
        "TOP LEFT: the headline in two lines of black clean grotesk, line 1 medium, line 2 regular.",
        "LEFT HALF: three stats stacked, each a large thin black number with its description in small grey sans below, then a thin grey hairline rule. Under the last rule, the footnote in tiny grey sans.",
        `RIGHT: ${P}, standing on a rough grey stone plinth that rises from the bottom edge.`,
        TEXT_RULE,
        `- Headline: ${q(f.head1)} / ${q(f.head2)}`,
        ...[1, 2, 3].map((r) => `- Stat ${r}: ${q(f[`s${r}stat`])} | ${q(f[`s${r}text`])}`),
        `- Footnote: ${q(f.footnote)}`,
      ];
    case "before-after-stats":
      return [
        "BACKGROUND: flat light warm grey.",
        "TOP LEFT: the eyebrow in thin dark sans; under it the headline in two lines of large bold black geometric sans.",
        "LEFT ~60%: a before/after photo pair side by side with a thin white gap, each labelled in white caps on the photo.",
        "UNDER THE PHOTOS: the two stats side by side in huge bold black, each with its caption small below. The source in tiny grey type at the bottom.",
        `RIGHT: ${P}, standing tall, almost full height, soft shadow.`,
        BEFORE_AFTER_RULE,
        TEXT_RULE,
        ...(has("eyebrow") ? [`- Eyebrow: ${q(f.eyebrow)}`] : []),
        `- Headline: ${q(f.head1)} / ${q(f.head2)}`,
        "- Photo labels: \"BEFORE\", \"AFTER\"",
        ...[1, 2].map((r) => `- Stat ${r}: ${q(f[`s${r}stat`])} | ${q(f[`s${r}text`])}`),
        `- Source: ${q(f.source)}`,
      ];
    case "taped-before-after":
      return [
        "BACKGROUND: warm cream paper.",
        "TOP CENTRE: the brand name as a small serif wordmark with three small dots below; then one line of black serif, the highlighted part underlined by a soft peach marker stroke.",
        "MIDDLE: two portrait photos side by side, slightly tilted and overlapping, each held by a strip of peach paper tape at the top: before on the left, after on the right.",
        "BOTTOM LEFT: the note in black handwriting, circled by a hand-drawn peach loop.",
        `BOTTOM RIGHT: ${P}, large, overlapping the right photo's corner, soft shadow.`,
        BEFORE_AFTER_RULE,
        TEXT_RULE,
        `- Wordmark: ${q(name)}`,
        `- Line: ${has("line") ? `${q(f.line)}, then ` : ""}underlined ${q(f.highlight)}`,
        `- Handwritten note: ${q(f.caption)}`,
      ];
    case "trust-badges-benefits":
      return [
        "BACKGROUND: soft off-white linen with gentle folds and a diagonal window-light shadow.",
        "TOP: the headline centred in large black high-contrast serif; under it the subline in small black letter-spaced sans.",
        `CENTRE: ${P}, upright and large, casting a soft shadow.`,
        "LEFT: the badges stacked as round or square certification-style seals in navy and white, each showing only its own words.",
        "RIGHT: the four benefits stacked, each a thin black line icon in a circle with its words in small black sans below.",
        "BOTTOM: a thin-outlined white bar with the spec text on the left. No buttons.",
        TEXT_RULE,
        `- Headline: ${q(f.headline)}`,
        `- Subline: ${q(f.subline)}`,
        `- Badges: ${[1, 2, 3].filter((i) => has(`badge${i}`)).map((i) => q(f[`badge${i}`])).join(", ")}`,
        `- Benefits: ${[1, 2, 3, 4].map((i) => q(f[`benefit${i}`])).join(", ")}`,
        `- Spec bar: ${q(f.spec)}`,
        ...safe,
      ];
    case "clinically-proven-callouts":
      return [
        "BACKGROUND: cool blue-grey studio gradient with a pale plinth edge at the bottom.",
        "TOP, centred: the headline in bold black sans; under it line 1 in regular black, the highlight in bold white on a solid blue bar, line 3 in regular black.",
        `CENTRE: ${P}, upright and large.`,
        "CALLOUTS: three white circles with simple blue line icons (upper left, right, lower left), each with its words in dark sans beside it, joined to the product by dotted white lines.",
        "The footnote, if any, in tiny grey type right of the product. BOTTOM: the wordmark centred in bold letter-spaced black.",
        TEXT_RULE,
        `- Headline: ${q(f.headline)}`,
        ...(has("line1") ? [`- Line 1: ${q(f.line1)}`] : []),
        `- Highlight: ${q(f.highlight)}`,
        ...(has("line3") ? [`- Line 3: ${q(f.line3)}`] : []),
        `- Callouts: ${[1, 2, 3].map((i) => q(f[`callout${i}`])).join(", ")}`,
        ...(has("footnote") ? [`- Footnote: ${q(f.footnote)}`] : []),
        `- Wordmark: ${q(name)}`,
      ];
    case "question-orbit":
      return [
        "BACKGROUND: seamless pale-grey studio, soft even light.",
        `PRODUCT: ${P}, floating in the centre, tilted ~30°, large, a soft shadow far below.`,
        "ORBITS: two or three thin lines in the product's main colour loop around it, each ending in a small dot by a question.",
        "QUESTIONS: four, spread around it (top right, left, right, bottom), dark-grey sans, two short lines each, no boxes.",
        TEXT_RULE,
        ...[1, 2, 3, 4].map((i) => `- ${q(f[`q${i}`])}`),
      ];
    case "one-product-many-moments":
      return [
        "BACKGROUND: plain pale grey-white studio wall, soft light.",
        "TOP: the headline centred in two lines of rounded geometric sans: line 1 bold slate-navy, line 2 regular grey-slate.",
        `CENTRE: a thin grey circle, ~80% wide, in the lower two-thirds; ${P} rises from the bottom edge through its centre, large, cropped at the bottom.`,
        "SIX MOMENTS: three each side along the circle, each a bold small slate title over one thin grey line; right-aligned on the left, left-aligned on the right.",
        TEXT_RULE,
        `- Headline: ${q(f.line1)} / ${q(f.line2)}`,
        ...[1, 2, 3, 4, 5, 6].map((r) => `- ${q(f[`m${r}title`])} | ${q(f[`m${r}line`])}`),
      ];
    case "problem-solution":
      return [
        "BACKGROUND: white paper with a faint light-grey square grid.",
        "TOP: two huge condensed bold sans lines, centred: line 1 black, line 2 in one accent colour taken from the product.",
        `PRODUCT: ${P}, large, tilted ~20°, centre-left.`,
        "BUBBLES: three white speech bubbles with thick black outlines (upper right, middle left, lower right). Each: a small accent tag with white caps; the solution label in bold black caps and the solution in bold accent caps; the benefit in small black sans. A hand-drawn black arrow from each bubble to the product.",
        "BOTTOM CENTRE: the brand name as a small wordmark.",
        TEXT_RULE,
        "- Title: \"PROBLEM ?\" / \"SOLUTION !\"",
        ...[1, 2, 3].map((r) => `- Bubble ${r}: tag "PROBLEM:" + ${q(f[`b${r}problem`])}; "SOLUTION:"; ${q(f[`b${r}solution`])}; ${q(f[`b${r}benefit`])}`),
        `- Wordmark: ${q(name)}`,
        ...safe,
      ];
    case "dont-buy-this":
      return [
        "BACKGROUND: warm cream paper, subtle texture, soft light.",
        "HEADLINE: four stacked lines in huge black high-contrast serif, centred, tight leading, filling the top ~60%.",
        `PRODUCT: ${P}, tilted ~15°, in front of the right half of lines 2–4, soft shadow.`,
        "SUBLINE: centred under it in black regular serif, two lines.",
        "BOTTOM: the three benefits in one row, each a small round check badge in the product's colour and the words in small bold dark sans.",
        TEXT_RULE,
        `- Headline: "DON'T" / ${q(f.verb)} / "THIS" / ${q(f.thing)}`,
        `- Subline: ${q(f.subline)}`,
        `- Benefits: ${[1, 2, 3].map((i) => q(f[`check${i}`])).join(", ")}`,
        ...safe,
      ];
    default:
      return [];
  }
}

/**
 * The full image prompt for a filled-in style, and the Playground request built from it. Every
 * on-image text is quoted exactly as filled (nothing invented); the reference's brand is replaced by
 * the person's and never named (it, and the competitors, go to mustAvoid instead). Stays under the
 * Playground's limit by dropping the optional lines (what the product is) first.
 */
export function buildStylePrompt(style: AdStyle, fields: Record<string, string>, ctx: StyleContext, opts: { inputs?: StyleInput[]; aspect?: Aspect; count?: PlaygroundRequest["count"] } = {}): BuiltStyle {
  const name = appName(ctx);
  const inputs = (opts.inputs ?? []).slice(0, PLAYGROUND_MAX_INPUTS);
  const aspect = opts.aspect && style.aspects.includes(opts.aspect) ? opts.aspect : style.aspect;
  const typed = namedCompetitors(style, fields, ctx).map((c) => c.toLowerCase());
  const filled = Object.fromEntries(style.fields.map((f) => [f.key, clean(fields[f.key])]));
  // What the product is, only when it names no competitor or reference brand (the prompt never names them).
  const avoidWords = [...style.exampleBrands, ...(ctx.competitors ?? [])].map((c) => clean(c).toLowerCase()).filter((c) => c.length > 2);
  const description = cutWords(clean(ctx.productDescription), 160);
  const about = description && !avoidWords.some((w) => wordIn(description.toLowerCase(), w)) ? `${name}: ${bare(description)}.` : "";

  const head = `New Meta ad for ${q(name)} in the exact format of the reference image (${style.name}, ${aspect}): copy its layout, proportions, typography and native UI, but none of its brand, product, people or words.`;
  const compose = (withAbout: boolean, withLabels: boolean) => [
    head,
    withAbout ? about : "",
    ...layout(style, filled, ctx, aspect),
    inputLine(style, inputs, ctx, withLabels),
    `The only brand is ${q(name)}: no other names, logos or app icons. Photorealistic, crisp legible text, no borders.`,
  ].filter(Boolean).join("\n");
  // Under the Playground's limit: drop what the product is, then the image labels; past that, the text is too long.
  const tries = [compose(true, true), compose(false, true), compose(false, false)];
  const prompt = tries.find((t) => t.length <= STYLE_PROMPT_MAX) ?? tries[2];

  // The reference's brands (and seals) too, unless the person typed one on purpose (e.g. a certification they really hold).
  const onImageText = style.fields.filter((f) => f.onImage).map((f) => filled[f.key]).join(" \n ").toLowerCase();
  const examples = style.exampleBrands.filter((b) => !wordIn(onImageText, clean(b).toLowerCase()));
  const mustAvoid = [...new Set([...examples, ...(ctx.competitors ?? []).map(clean).filter((c) => c && !typed.includes(c.toLowerCase()))])];
  return {
    prompt,
    overBy: Math.max(0, prompt.length - STYLE_PROMPT_MAX),
    request: {
      prompt,
      referenceUrl: style.referenceImage, // site-relative; the Playground API resolves it to an absolute https URL
      inputUrls: inputs.map((x) => x.url),
      aspect,
      count: opts.count ?? 2,
      styleId: style.id,
      styleFields: filled,
      mustAvoid,
    },
  };
}
