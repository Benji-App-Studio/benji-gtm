// Tips from the Meta ads playbook (the global `meta-ads-playbook` skill), shown as small info boxes
// where each one applies. Suggestions, never rules: every box can be closed, and nothing here blocks
// an action. Each tip names the playbook section it comes from so the dashboard and the skill agree.

export type TipId =
  | "proven-market" | "copy-why-not-assets" | "change-the-angle"
  | "creative-is-targeting" | "different-concepts" | "five-per-adset" | "variations-vs-concepts" | "hook-and-sound-off"
  | "abo-cbo" | "deepest-event" | "broad-targeting" | "judge-by-spend" | "not-every-ad-spends" | "kill-dont-wait"
  | "scale-testing-bar" | "fatigue" | "variance" | "diagnose-by-layer" | "cheap-installs" | "headroom";

export interface Tip {
  title: string;
  body: string;
  /** Optional second paragraph behind "More". */
  more?: string;
  section: string;
}

export const TIPS: Record<TipId, Tip> = {
  "proven-market": {
    title: "Grow where people already pay",
    body: "A niche where at least one app makes about $100K+/month has proven the problem, the downloads and the willingness to pay. Your job is to take a slice of that demand, not create it.",
    more: "Competition is a good sign: money is already being spent there. Study why the leader works: who it's for, how it's positioned, when people pay.",
    section: "Market",
  },
  "copy-why-not-assets": {
    title: "Copy why it works, never the assets",
    body: "Take the format, the hook type and the structure of a proven ad, then make it yours. Never reuse a competitor's footage, graphics, branding or exact script.",
    section: "Market",
  },
  "change-the-angle": {
    title: "Change the angle, not the category",
    body: "The same proven idea aimed at one specific group usually beats a generic version: the visuals, words and hook are built around that exact person.",
    section: "Market",
  },
  "creative-is-targeting": {
    title: "Your creative is your targeting",
    body: "Meta works out who an ad is for from its visuals, language and hook, and from who engages. A very specific creative with broad targeting usually beats stacked interests. The right person should think \"this is literally for me\".",
    section: "Algorithm",
  },
  "different-concepts": {
    title: "Test genuinely different concepts first",
    body: "Different hooks, angles, formats, problems and people, not five tweaks of one ad. The one you think is weakest is often the winner.",
    section: "Testing",
  },
  "five-per-adset": {
    title: "About 5 ads per ad set at $20–50/day",
    body: "A good starting test for a new batch of concepts. Keep it simple: one testing campaign, one scaling campaign.",
    section: "Testing",
  },
  "variations-vs-concepts": {
    title: "Variations once you have a winner",
    body: "Keep the winning idea and change the hook, opening visual, font or colour. If variations keep failing, go back to new concepts; if new concepts keep failing, go back to variations. Follow the data.",
    section: "Testing",
  },
  "hook-and-sound-off": {
    title: "Hook in the first 3 seconds",
    body: "Show the problem or the app straight away, keep it to about 15 seconds, and make it work with the sound off: the key point on screen and captions on speech.",
    section: "Creative",
  },
  "abo-cbo": {
    title: "ABO to find winners, CBO to scale them",
    body: "Test new creatives with ad set budgets (ABO) so each gets a fair share; move winners into a campaign-budget (CBO / Advantage+) campaign and let Meta put money where it works.",
    more: "Launch's setup makes the testing campaign with ad set budgets and the scaling campaign with a campaign budget; switch the scaling one to ad set budgets in Launch settings → How campaigns are set up.",
    section: "Structure",
  },
  "deepest-event": {
    title: "Optimise for the deepest event that fires often",
    body: "Optimise for installs and Meta finds people who install; optimise for trials or purchases and it finds people who pay. Use trials or purchases once they fire often enough (roughly 50 a week); installs only when volume is too low.",
    more: "Set it in Launch settings → How campaigns are set up. Trial and purchase optimisation need the app to send those events to Meta through the SDK or the MMP.",
    section: "Algorithm",
  },
  "broad-targeting": {
    title: "Keep targeting broad",
    body: "All ages, all genders, no interests, in the countries you sell to. Let the creative do the targeting; don't use settings to rescue a vague ad.",
    section: "Algorithm",
  },
  "judge-by-spend": {
    title: "Judge ads by spend, never by days",
    body: "One ad can spend $100 in three days and another $10. Compare each ad with your normal cost per conversion once it has spent enough: about 2 × target before calling a loser, 3 × before calling a winner.",
    section: "Testing",
  },
  "kill-dont-wait": {
    title: "\"A couple more days\" means kill it",
    body: "If you catch yourself hoping a mediocre ad will turn around, the answer is usually already obvious. Pause it and test something new.",
    section: "Testing",
  },
  "not-every-ad-spends": {
    title: "Not every ad will spend, and that's fine",
    body: "Meta puts budget behind what it expects to work. You don't need every ad tested; you need Meta to find the best ones.",
    section: "Testing",
  },
  "scale-testing-bar": {
    title: "Raise the testing bar as you scale",
    body: "A winner at $100/day may not hold at $1,000/day. As spend grows, test more and bigger, and keep feeding new winners into scaling.",
    section: "Scaling",
  },
  fatigue: {
    title: "Test replacements before winners fatigue",
    body: "Every winner wears out: rising cost per conversion, falling CTR, higher frequency. Refresh the hook or visual to extend it, and always have the next creatives in testing while the current ones still work.",
    section: "Fatigue",
  },
  variance: {
    title: "Most daily swings are noise",
    body: "One day looks amazing, the next terrible, then it recovers. Zoom out, wait for enough data, decide whether something actually changed, then act.",
    section: "Mindset",
  },
  "diagnose-by-layer": {
    title: "Diagnose by layer",
    body: "High CPM: auction or audience. Low hook rate or CTR: the creative isn't stopping the scroll. Low install or trial rate: the store page or onboarding. Low trial-to-paid: the product or paywall.",
    section: "Metrics",
  },
  "cheap-installs": {
    title: "A cheap install that never pays isn't cheap",
    body: "Read cost per install with the paywall rate and the trial-to-paid rate. Cost per paying user is the number that decides scaling.",
    section: "Metrics",
  },
  headroom: {
    title: "Know your headroom",
    body: "Know the most you can pay for a customer from what they're worth (LTV) and how fast you need the money back, before raising budgets. If retention is weak, fix the product before buying more users.",
    section: "Strategy",
  },
};
