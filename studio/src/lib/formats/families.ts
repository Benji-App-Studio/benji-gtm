// Format families (the research engine's format LIBRARY in engine/formats.ts) and how each is best recreated on
// Higgsfield. Reports can carry their own format ids (older runs and custom libraries do), so any id
// is mapped onto the closest family by its id, name and description.
import type { FamilyId } from "./types";
import { m } from "../i18n/translate";

export interface Family {
  label: string;
  /** How the format works, in neutral words: what to keep when recreating it. */
  pattern: string;
  /** The Higgsfield route for video winners. */
  video: { model: "marketing_studio_video"; mode: string } | { model: "seedance_2_5"; mode: "t2v" };
  /** Who's on screen. */
  cast: "creator" | "actors" | "none";
  /** A sensible length when the winners don't say. */
  defaultSec: number;
  /** The usual job order, for winners whose script doesn't show one (silent or caption-only posts). */
  beats: string[];
}

export const FAMILIES: Record<FamilyId, Family> = {
  storytime: { label: m("Storytime"), pattern: m("A first-person story told as it unfolds, turning into the lesson the product solves."), video: { model: "marketing_studio_video", mode: "ugc" }, cast: "creator", defaultSec: 20, beats: ["hook", "setup", "method", "product", "benefit", "cta"] },
  how_to_steps: { label: m("How to, step by step"), pattern: m("Promise one outcome, then walk through it in clear numbered steps on screen."), video: { model: "marketing_studio_video", mode: "ugc_how_to" }, cast: "creator", defaultSec: 20, beats: ["hook", "method", "product", "benefit", "cta"] },
  proof_then_method: { label: m("I did X, here's how"), pattern: m("Open on the result, then show the method that got it, with the product as the method."), video: { model: "marketing_studio_video", mode: "ugc" }, cast: "creator", defaultSec: 20, beats: ["hook", "proof", "method", "product", "cta"] },
  listicle: { label: m("N things"), pattern: m("Promise a count, then deliver each item fast with a number on screen."), video: { model: "marketing_studio_video", mode: "ugc_how_to" }, cast: "creator", defaultSec: 20, beats: ["hook", "method", "product", "cta"] },
  myth_vs_reality: { label: m("Myth vs reality"), pattern: m("Name a common belief, flatly correct it, then show what's actually true."), video: { model: "marketing_studio_video", mode: "ugc_how_to" }, cast: "creator", defaultSec: 15, beats: ["hook", "setup", "method", "product", "cta"] },
  news_update: { label: m("News / what changed"), pattern: m("Lead with what changed and who it affects, then what to do about it."), video: { model: "marketing_studio_video", mode: "ugc" }, cast: "creator", defaultSec: 15, beats: ["hook", "setup", "method", "product", "cta"] },
  explainer: { label: m("Explainer"), pattern: m("Explain one rule or concept plainly, with one concrete example on screen."), video: { model: "marketing_studio_video", mode: "ugc_how_to" }, cast: "creator", defaultSec: 20, beats: ["hook", "setup", "method", "product", "cta"] },
  expert_answers: { label: m("The expert answers"), pattern: m("A credible presenter answers the question buyers keep asking, then points to the tool."), video: { model: "marketing_studio_video", mode: "ugc_how_to" }, cast: "creator", defaultSec: 20, beats: ["hook", "setup", "method", "product", "cta"] },
  hack_or_secret: { label: m("Hack nobody tells you"), pattern: m("Frame one tip as an insider shortcut, reveal it fast, show it working."), video: { model: "marketing_studio_video", mode: "ugc" }, cast: "creator", defaultSec: 15, beats: ["hook", "setup", "method", "product", "proof", "cta"] },
  comparison: { label: m("This vs that"), pattern: m("Put the old way next to the better way and let the difference show."), video: { model: "marketing_studio_video", mode: "product_review" }, cast: "creator", defaultSec: 15, beats: ["hook", "setup", "product", "benefit", "cta"] },
  pov_skit: { label: m("POV / skit"), pattern: m("A short acted scene of a situation the buyer knows too well, with the product as the punchline."), video: { model: "seedance_2_5", mode: "t2v" }, cast: "actors", defaultSec: 12, beats: ["hook", "setup", "product", "benefit", "cta"] },
  day_in_life: { label: m("Day in the life"), pattern: m("A diary-style run through a day where the product shows up naturally at the moment it matters."), video: { model: "seedance_2_5", mode: "t2v" }, cast: "actors", defaultSec: 15, beats: ["hook", "setup", "product", "benefit", "cta"] },
  reaction: { label: m("Reaction"), pattern: m("React to a relatable prompt (a question, a headline you write yourself), then answer it with the product."), video: { model: "marketing_studio_video", mode: "ugc" }, cast: "creator", defaultSec: 15, beats: ["hook", "setup", "method", "product", "cta"] },
  silent_text: { label: m("Silent text-on-screen"), pattern: m("Music and calm footage; the message is all in on-screen text, built to be saved."), video: { model: "seedance_2_5", mode: "t2v" }, cast: "none", defaultSec: 10, beats: ["hook", "setup", "method", "product", "cta"] },
  product_demo: { label: m("Product demo"), pattern: m("Show the product doing the one job, screen first, with a voice-over of why it matters."), video: { model: "marketing_studio_video", mode: "product_review" }, cast: "creator", defaultSec: 15, beats: ["hook", "product", "method", "benefit", "cta"] },
  ugc_testimonial: { label: m("UGC testimonial"), pattern: m("A real-feeling user talks to camera about the problem and how the product fixed it."), video: { model: "marketing_studio_video", mode: "ugc" }, cast: "creator", defaultSec: 20, beats: ["hook", "setup", "product", "benefit", "proof", "cta"] },
  challenge_or_test: { label: m("I tested it"), pattern: m("Set up a test, run it on camera, reveal the result."), video: { model: "marketing_studio_video", mode: "ugc" }, cast: "creator", defaultSec: 20, beats: ["hook", "setup", "method", "proof", "product", "cta"] },
  behind_the_scenes: { label: m("Behind the scenes"), pattern: m("Show how the product is made or why it exists, from the maker's side."), video: { model: "seedance_2_5", mode: "t2v" }, cast: "actors", defaultSec: 15, beats: ["hook", "setup", "product", "benefit", "cta"] },
  // Paid-ad formats (the research engine's AD_FORMATS), the ones marketers test in Meta and TikTok ads.
  hook_demo: { label: m("Hook + app demo"), pattern: m("One scroll-stopping line, then the app doing the job on screen, fast."), video: { model: "marketing_studio_video", mode: "ugc_how_to" }, cast: "creator", defaultSec: 15, beats: ["hook", "product", "method", "benefit", "cta"] },
  static_benefit: { label: m("Static benefit headline"), pattern: m("One image: a big outcome headline, the app screen, a short CTA."), video: { model: "seedance_2_5", mode: "t2v" }, cast: "none", defaultSec: 8, beats: ["hook", "product", "benefit", "cta"] },
  reddit_style: { label: m("Forum-thread style"), pattern: m("Looks like a forum thread: a question or confession, then a reply that answers with the product. Original design, no platform branding."), video: { model: "seedance_2_5", mode: "t2v" }, cast: "none", defaultSec: 8, beats: ["hook", "setup", "product", "cta"] },
  tweet_style: { label: m("Short-post screenshot style"), pattern: m("Looks like a short social post: one punchy opinion or story, a reply naming the product. Original design, no platform branding."), video: { model: "seedance_2_5", mode: "t2v" }, cast: "none", defaultSec: 8, beats: ["hook", "product", "cta"] },
  ai_ugc: { label: m("AI / actor UGC"), pattern: m("A presenter talks to camera in a casual style about the problem and the app as the fix (a presenter, never a customer)."), video: { model: "marketing_studio_video", mode: "ugc" }, cast: "creator", defaultSec: 20, beats: ["hook", "setup", "product", "benefit", "cta"] },
  before_after: { label: m("Before / after"), pattern: m("The state before and after the app, side by side: the change is the message."), video: { model: "seedance_2_5", mode: "t2v" }, cast: "none", defaultSec: 10, beats: ["hook", "setup", "product", "benefit", "cta"] },
  us_vs_them: { label: m("Us vs the old way"), pattern: m("A comparison of the app against the old way, with ticks and crosses. Never names a competitor."), video: { model: "marketing_studio_video", mode: "product_review" }, cast: "creator", defaultSec: 15, beats: ["hook", "setup", "product", "benefit", "cta"] },
  quiz_funnel: { label: m("Quiz / result reveal"), pattern: m("Invites a quick check, teases the result, shows the result screen, then the app."), video: { model: "marketing_studio_video", mode: "ugc_how_to" }, cast: "creator", defaultSec: 15, beats: ["hook", "method", "proof", "product", "cta"] },
  testimonial_review: { label: m("Reviews / social proof"), pattern: m("Real review quotes and ratings carry the ad. Only real, consented reviews."), video: { model: "seedance_2_5", mode: "t2v" }, cast: "none", defaultSec: 10, beats: ["hook", "proof", "product", "cta"] },
  green_screen: { label: m("Green screen over proof"), pattern: m("A presenter in front of an app screen or a fact card, explaining it."), video: { model: "marketing_studio_video", mode: "ugc" }, cast: "creator", defaultSec: 15, beats: ["hook", "setup", "method", "product", "cta"] },
  founder_story: { label: m("Founder / expert to camera"), pattern: m("Why the app exists, told to camera by the person who built it."), video: { model: "marketing_studio_video", mode: "ugc" }, cast: "creator", defaultSec: 20, beats: ["hook", "setup", "product", "benefit", "cta"] },
  motivational: { label: m("Motivation"), pattern: m("An aspirational message over cinematic footage, tying the product to the life the buyer wants."), video: { model: "seedance_2_5", mode: "t2v" }, cast: "none", defaultSec: 12, beats: ["hook", "setup", "benefit", "product", "cta"] },
};

// Checked in order: the first match wins ("rule_change_news" is news before it's an explainer).
const RULES: [RegExp, FamilyId][] = [
  [/reddit|forum|thread/, "reddit_style"],
  [/tweet|post screenshot/, "tweet_style"],
  [/before.{0,3}after|transformation/, "before_after"],
  [/us vs them|vs them|old way/, "us_vs_them"],
  [/quiz|result reveal|score reveal/, "quiz_funnel"],
  [/green.?screen/, "green_screen"],
  [/founder/, "founder_story"],
  [/social proof|reviews|star rating|ratings/, "testimonial_review"],
  [/ai ugc|actor ugc|avatar/, "ai_ugc"],
  [/hook.{0,4}demo/, "hook_demo"],
  [/static|benefit headline/, "static_benefit"],
  [/silent|text[_ -]?overlay|text[_ -]on[_ -]screen|no speech/, "silent_text"],
  [/news|update|breaking|just changed|announc/, "news_update"],
  [/myth|reality|wrong|not true/, "myth_vs_reality"],
  [/hack|secret|loophole|nobody tells|gatekept/, "hack_or_secret"],
  [/testimonial|ugc/, "ugc_testimonial"],
  [/\bvs\b|versus|compar|this or that/, "comparison"],
  [/pov|skit|relatable|meme/, "pov_skit"],
  [/reaction|stitch|duet|react/, "reaction"],
  [/challenge|tested|i tried|experiment/, "challenge_or_test"],
  [/day in|routine|diary|series|episode/, "day_in_life"],
  [/behind|build in public|making of/, "behind_the_scenes"],
  [/motivat|mindset|inspir/, "motivational"],
  [/list|ranked|options|\d+ (things|ways|tips)|top \d/, "listicle"],
  [/expert|lawyer|advisor|doctor|dermatolog|credential/, "expert_answers"],
  [/how i |i did|i got|got my|how_i|proof/, "proof_then_method"],
  [/story|happened|storytime|confession/, "storytime"],
  [/how to|how_to|step|tutorial|guide/, "how_to_steps"],
  [/promo|demo|review|product|app /, "product_demo"],
  [/explain|rule|what is|means/, "explainer"],
];

/** The family for any format id, using its name and description when the id isn't one of the library's. */
export function familyOf(formatId: string, name = "", description = ""): FamilyId {
  if (formatId in FAMILIES) return formatId as FamilyId;
  const id = formatId.replace(/_/g, " ");
  for (const [rule, family] of RULES) if (rule.test(id)) return family;
  const text = `${name} ${description}`.toLowerCase();
  for (const [rule, family] of RULES) if (rule.test(text)) return family;
  return "explainer";
}

/** Hook types (engine/decode.ts HOOK_TYPES) as patterns to fill with our own words. */
export const HOOK_PATTERN: Record<string, string> = {
  question: m("Ask the question the buyer is already asking themselves."),
  bold_claim: m("State the strongest claim flatly, no warm-up."),
  number_list: m("Promise a count, then deliver it in order."),
  story: m("Start mid-story, at the moment it went wrong."),
  pov: m("Set a scene the buyer knows too well in one line (POV: …)."),
  warning: m("Warn them off a common, costly mistake."),
  news: m("Lead with what changed and who it affects."),
  how_to: m("Name the outcome and how fast they'll get it."),
  curiosity_gap: m("Tease the answer and hold it back a beat."),
  other: m("Open on the most striking image or line; no greeting."),
};
