// The product's selling angles: the pieces every recreated beat is written from, so a prompt is always
// about OUR product, never the competitor's. Angles come from the product's own AI profile (one per
// customer group); a product without one gets a single angle derived from its description.
//
// The copy follows docs/POLICY.md: an AI presenter never speaks as a customer or an expert (PR-2,
// PR-3), so lines talk about the product and to "you", never "I use it"; questions don't touch
// personal attributes such as immigration status or health (PA-1, PA-2). What a product may never
// say comes from its own settings (the Brand page's forbidden claims, the AI profile's claims to
// avoid) plus the rules of its category, worked out from what the product is (`policyFor`): health
// and wellness products make no medical claims or promised results (NH-1 to NH-5); visa, residency
// and tax products promise no outcome, stay calm and commercial, and say that rules change (BW-1 to
// BW-5). Every `mechanism` line is a general fact the creative states on camera: keep them true.
import { policyFor, type PolicyProfile } from "../creative-plan";
import type { Angle, AppContext, FormatCard } from "./types";

/** A phrase the copy must never contain (whole words; a trailing * matches any ending), and the POLICY.md rule it breaks. */
export type Claim = { text: string; rule: string };

interface CategoryRules {
  claims: Claim[];
  /** Shown on screen and in the caption whenever a rule is explained (BW-2). */
  disclaimer: string | null;
}

/** What every product of a category must never say, whatever its own lists hold. */
const CATEGORY_RULES: Record<PolicyProfile, CategoryRules> = {
  health: {
    disclaimer: null,
    claims: [
      { text: "cure*", rule: "NH-1" }, { text: "treat*", rule: "NH-1" }, { text: "heal", rule: "NH-1" }, { text: "heals", rule: "NH-1" }, { text: "healing", rule: "NH-1" }, { text: "prevent*", rule: "NH-1" }, { text: "diagnos*", rule: "NH-1" },
      { text: "reverse", rule: "NH-1" }, { text: "medical advice", rule: "NH-1" }, { text: "prescription", rule: "NH-1" },
      { text: "guarantee*", rule: "NH-2" }, { text: "clinically proven", rule: "NH-2" }, { text: "in 7 days", rule: "NH-2" }, { text: "overnight results", rule: "NH-2" },
      { text: "your acne", rule: "NH-3" }, { text: "your rosacea", rule: "NH-3" }, { text: "your eczema", rule: "NH-3" },
      { text: "ugly", rule: "NH-4" }, { text: "gross", rule: "NH-4" }, { text: "dr.", rule: "NH-5" }, { text: "white coat", rule: "NH-5" },
    ],
  },
  immigration_tax: {
    disclaimer: "Rules change; check official sources.",
    claims: [
      { text: "guarantee*", rule: "BW-1" }, { text: "stay legal", rule: "BW-1" }, { text: "never overstay", rule: "BW-1" }, { text: "avoid tax", rule: "BW-1" },
      { text: "get your visa", rule: "BW-1" }, { text: "approved", rule: "BW-1" },
      { text: "legal advice", rule: "BW-2" }, { text: "tax advice", rule: "BW-2" }, { text: "lawyer", rule: "BW-2" },
      { text: "deport*", rule: "BW-4" }, { text: "banned", rule: "BW-4" }, { text: "entry ban", rule: "BW-4" },
      { text: "immigration policy", rule: "BW-5" }, { text: "refugee", rule: "BW-5" }, { text: "illegal", rule: "BW-5" }, { text: "government", rule: "BW-3" },
      { text: "your visa status", rule: "PA-2" }, { text: "undocumented", rule: "PA-2" },
    ],
  },
  general: { disclaimer: null, claims: [] },
};

/** Which category rules a product falls under, from its own name, description, keywords and AI profile. */
export const policyOf = (app: Pick<AppContext, "name" | "brandKit" | "description" | "keywords" | "profile">): PolicyProfile =>
  policyFor([app.brandKit.appName, app.name, app.brandKit.tagline ?? "", app.description, app.keywords.join(" "), app.profile?.summary ?? ""].join(" "));

const sentence = (text: string) => (text.split(/(?<=[.!?])\s/)[0] ?? text).trim().replace(/[.!?]+$/, "");
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** A single angle for a product with no AI profile yet, from its own description. */
function derived(app: AppContext): Angle {
  const name = app.brandKit.appName || app.name;
  const what = sentence(app.brandKit.tagline || app.description || `${name} makes it easy`);
  const audience = app.audience || "people like you";
  const topic = app.keywords[0] || "this";
  return {
    id: "core", label: "Core promise", keywords: app.keywords.map((k) => k.toLowerCase()), audience, topic,
    pain: `doing ${topic} the hard way`, stakes: "time you don't get back", outcome: `get ${topic} done without the hassle`,
    feature: lower(what), mechanism: `${what}.`,
    steps: [`Open ${name}`, "Set it up in a minute", "Let it handle the rest"],
    benefit: `${topic} gets simpler`, proof: `${name} doing the job on screen`, demoShot: `the ${name} app's main screen in use`,
    broll: "everyday moments where the problem shows up",
    question: `Still doing ${topic} the hard way?`, claim: `${topic} doesn't have to be this hard`,
    story: `Imagine spending another evening on ${topic}`, pov: `you're dealing with ${topic} again`,
    mistake: `doing ${topic} by hand`, myth: `${topic} has to take hours`, setup: `Most people still do ${topic} the slow way.`,
    cta: `Try ${name} today`,
  };
}

/**
 * The workspace's angles: one per customer group of the AI product profile, read from the product's
 * own site and listing; without a profile, one from the description.
 */
export function anglesFor(app: AppContext): Angle[] {
  const fromProfile = app.profile ? profileAngles(app) : [];
  return fromProfile.length ? fromProfile : [derived(app)];
}

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3);

/** Angles from the AI product profile: each customer group's pain, our promise and a real feature for it. */
export function profileAngles(app: AppContext): Angle[] {
  const p = app.profile;
  if (!p) return [];
  const name = app.brandKit.appName || app.name;
  const groups = p.segments.length ? p.segments : [{ name: p.audience || app.audience || "people like you", pain: p.pains[0] ?? "", motivation: "" }];
  const topic = app.keywords[0] || "this";
  return groups.slice(0, 3).map((group, i) => {
    const pain = sentence(group.pain || p.pains[i] || p.pains[0] || `doing ${topic} the hard way`);
    const promise = sentence(p.promises[i] ?? p.promises[0] ?? p.summary);
    const feature = p.features[i] ?? p.features[0];
    const featureNames = p.features.slice(0, 3).map((f) => f.name);
    const steps: [string, string, string] = featureNames.length >= 3
      ? [featureNames[0], featureNames[1], featureNames[2]].map((f) => `Use ${f}`) as [string, string, string]
      : [`Open ${name}`, featureNames[0] ? `Use ${featureNames[0]}` : "Set it up in a minute", "Let it handle the rest"];
    return {
      id: `profile-${i + 1}`, label: group.name.slice(0, 40) || "Core promise",
      keywords: [...new Set([...app.keywords.map((k) => k.toLowerCase()), ...words(`${group.name} ${pain}`)])].slice(0, 20),
      audience: group.name || p.audience, topic,
      pain: lower(pain), stakes: group.motivation ? `missing out on ${lower(sentence(group.motivation))}` : "time you don't get back", outcome: lower(promise),
      feature: feature ? `${feature.name}: ${lower(sentence(feature.benefit))}` : lower(sentence(p.summary)),
      mechanism: `${sentence(p.solution || p.summary)}.`,
      steps, benefit: lower(promise), proof: p.proof[0] ? sentence(p.proof[0]) : `${name} doing the job on screen`,
      demoShot: `the ${name} app${feature ? ` showing ${feature.name}` : "'s main screen in use"}`, broll: "everyday moments where the problem shows up",
      question: `${pain}?`.replace(/\?\?$/, "?"), claim: promise, story: `Imagine the day ${lower(pain)} catches up with you`, pov: lower(pain),
      mistake: `putting up with ${lower(pain)}`, myth: `${lower(pain)} is just how it is`, setup: `${pain}. It doesn't have to be.`,
      cta: p.ctas[0] ? sentence(p.ctas[0]) : `Try ${name} today`,
    };
  });
}

/**
 * What a recipe is written with: the kit's colours and tone, every claim the product never makes (its
 * own lists, then its category's rules) and the category's disclaimer.
 */
export function brandDefaults(app: AppContext) {
  const policy = policyOf(app);
  const rules = CATEGORY_RULES[policy];
  const kit = app.brandKit;
  const claims: Claim[] = [...(kit.forbiddenClaims ?? []).map((text) => ({ text, rule: "brand kit" })), ...(app.profile?.avoid ?? []).map((text) => ({ text, rule: "AI product profile" })), ...rules.claims];
  return {
    colors: kit.colors,
    colorNames: kit.colors,
    tone: kit.tone || app.profile?.voice || "friendly, direct and honest",
    claims: [...new Map(claims.map((c) => [c.text.toLowerCase(), c])).values()],
    disclaimer: rules.disclaimer,
    /** Which category rules apply (for the flags a person must confirm). */
    policy,
  };
}

/**
 * The angle that best fits what a card's winners are about: the most of its keywords in the
 * winners' topics, hooks and format name. Deterministic; ties go to the first (main) angle.
 */
export function pickAngle(card: Pick<FormatCard, "topics" | "hookLine" | "formatName" | "formatDescription">, angles: Angle[]): Angle {
  const text = ` ${[...card.topics, card.hookLine, card.formatName, card.formatDescription].join(" ").toLowerCase()} `;
  const scored = angles.map((angle, index) => ({
    angle, index,
    score: angle.keywords.reduce((n, k) => n + (text.includes(k.includes(" ") || /\W/.test(k) ? k : ` ${k}`) ? (k.includes(" ") ? 2 : 1) : 0), 0),
  }));
  return scored.sort((a, b) => b.score - a.score || a.index - b.index)[0].angle;
}
