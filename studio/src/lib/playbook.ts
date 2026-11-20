// Tips from the Meta ads playbook (the global `meta-ads-playbook` skill), shown as small info boxes
// where each one applies. Suggestions, never rules: every box can be closed, and nothing here blocks
// an action. Each tip names the playbook section it comes from so the dashboard and the skill agree.
// The words are marked with m() and said with t() in components/playbook-tip.tsx.
import { m } from "./i18n/translate";

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
    title: m("Grow where people already pay"),
    body: m("A niche where at least one app makes about $100K+/month has proven the problem, the downloads and the willingness to pay. Your job is to take a slice of that demand, not create it."),
    more: m("Competition is a good sign: money is already being spent there. Study why the leader works: who it's for, how it's positioned, when people pay."),
    section: m("Market"),
  },
  "copy-why-not-assets": {
    title: m("Copy why it works, never the assets"),
    body: m("Take the format, the hook type and the structure of a proven ad, then make it yours. Never reuse a competitor's footage, graphics, branding or exact script."),
    section: m("Market"),
  },
  "change-the-angle": {
    title: m("Change the angle, not the category"),
    body: m("The same proven idea aimed at one specific group usually beats a generic version: the visuals, words and hook are built around that exact person."),
    section: m("Market"),
  },
  "creative-is-targeting": {
    title: m("Your creative is your targeting"),
    body: m("Meta works out who an ad is for from its visuals, language and hook, and from who engages. A very specific creative with broad targeting usually beats stacked interests. The right person should think \"this is literally for me\"."),
    section: m("Algorithm"),
  },
  "different-concepts": {
    title: m("Test genuinely different concepts first"),
    body: m("Different hooks, angles, formats, problems and people, not five tweaks of one ad. The one you think is weakest is often the winner."),
    section: m("Testing"),
  },
  "five-per-adset": {
    title: m("About 5 ads per ad set at $20–50/day"),
    body: m("A good starting test for a new batch of concepts. Keep it simple: one testing campaign, one scaling campaign."),
    section: m("Testing"),
  },
  "variations-vs-concepts": {
    title: m("Variations once you have a winner"),
    body: m("Keep the winning idea and change the hook, opening visual, font or colour. If variations keep failing, go back to new concepts; if new concepts keep failing, go back to variations. Follow the data."),
    section: m("Testing"),
  },
  "hook-and-sound-off": {
    title: m("Hook in the first 3 seconds"),
    body: m("Show the problem or the app straight away, keep it to about 15 seconds, and make it work with the sound off: the key point on screen and captions on speech."),
    section: m("Creative"),
  },
  "abo-cbo": {
    title: m("ABO to find winners, CBO to scale them"),
    body: m("Test new creatives with ad set budgets (ABO) so each gets a fair share; move winners into a campaign-budget (CBO / Advantage+) campaign and let Meta put money where it works."),
    more: m("Launch's setup makes the testing campaign with ad set budgets and the scaling campaign with a campaign budget; switch the scaling one to ad set budgets in Launch settings → How campaigns are set up."),
    section: m("Structure"),
  },
  "deepest-event": {
    title: m("Optimise for the deepest event that fires often"),
    body: m("Optimise for installs and Meta finds people who install; optimise for trials or purchases and it finds people who pay. Use trials or purchases once they fire often enough (roughly 50 a week); installs only when volume is too low."),
    more: m("Set it in Launch settings → How campaigns are set up. Trial and purchase optimisation need the app to send those events to Meta through the SDK or the MMP."),
    section: m("Algorithm"),
  },
  "broad-targeting": {
    title: m("Keep targeting broad"),
    body: m("All ages, all genders, no interests, in the countries you sell to. Let the creative do the targeting; don't use settings to rescue a vague ad."),
    section: m("Algorithm"),
  },
  "judge-by-spend": {
    title: m("Judge ads by spend, never by days"),
    body: m("One ad can spend $100 in three days and another $10. Compare each ad with your normal cost per conversion once it has spent enough: about 2 × target before calling a loser, 3 × before calling a winner."),
    section: m("Testing"),
  },
  "kill-dont-wait": {
    title: m("\"A couple more days\" means kill it"),
    body: m("If you catch yourself hoping a mediocre ad will turn around, the answer is usually already obvious. Pause it and test something new."),
    section: m("Testing"),
  },
  "not-every-ad-spends": {
    title: m("Not every ad will spend, and that's fine"),
    body: m("Meta puts budget behind what it expects to work. You don't need every ad tested; you need Meta to find the best ones."),
    section: m("Testing"),
  },
  "scale-testing-bar": {
    title: m("Raise the testing bar as you scale"),
    body: m("A winner at $100/day may not hold at $1,000/day. As spend grows, test more and bigger, and keep feeding new winners into scaling."),
    section: m("Scaling"),
  },
  fatigue: {
    title: m("Test replacements before winners fatigue"),
    body: m("Every winner wears out: rising cost per conversion, falling CTR, higher frequency. Refresh the hook or visual to extend it, and always have the next creatives in testing while the current ones still work."),
    section: m("Fatigue"),
  },
  variance: {
    title: m("Most daily swings are noise"),
    body: m("One day looks amazing, the next terrible, then it recovers. Zoom out, wait for enough data, decide whether something actually changed, then act."),
    section: m("Mindset"),
  },
  "diagnose-by-layer": {
    title: m("Diagnose by layer"),
    body: m("High CPM: auction or audience. Low hook rate or CTR: the creative isn't stopping the scroll. Low install or trial rate: the store page or onboarding. Low trial-to-paid: the product or paywall."),
    section: m("Metrics"),
  },
  "cheap-installs": {
    title: m("A cheap install that never pays isn't cheap"),
    body: m("Read cost per install with the paywall rate and the trial-to-paid rate. Cost per paying user is the number that decides scaling."),
    section: m("Metrics"),
  },
  headroom: {
    title: m("Know your headroom"),
    body: m("Know the most you can pay for a customer from what they're worth (LTV) and how fast you need the money back, before raising budgets. If retention is weak, fix the product before buying more users."),
    section: m("Strategy"),
  },
};
