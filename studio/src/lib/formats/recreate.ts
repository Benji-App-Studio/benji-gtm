// A format card + our app → ready-to-run Higgsfield inputs: which model and mode, the prompt, the
// aspect ratio and length, the script beats rewritten for our product, on-screen text, a caption and
// the CLI command. Deterministic templates (no paid calls): every line comes from the workspace's
// angles, so nothing of the competitor's is reused. A copywriting model can replace them later by
// passing its own `lines` (one per beat).
//
// Policy (docs/POLICY.md) is built into the templates: presenters are original
// characters who explain the app and never speak as a customer, founder or credentialed expert
// (PR-2, PR-3, NH-5); review and before/after formats are flagged for a person to confirm (PR-3,
// NH-2, NH-4); look-alike platform UIs become original designs (PR-5); rule explainers for visa,
// residency and tax products carry "Rules change; check official sources" (BW-2).
import { jobCost } from "../creative-plan";
import { anglesFor, brandDefaults, pickAngle } from "./angles";
import { FAMILIES } from "./families";
import { policyIssues } from "./policy";
import type { Angle, AppContext, Beat, FamilyId, FormatCard, HiggsfieldModel, Recipe, RecipeBeat } from "./types";

const ROLE_NAME: Record<string, string> = {
  hook: "Hook", setup: "Setup", product: "Product", method: "Method", benefit: "Benefit", proof: "Proof", cta: "CTA",
};
const MODE_LABEL: Record<string, string> = {
  ugc: "UGC", ugc_how_to: "Tutorial (UGC how-to)", product_review: "Product review", tv_spot: "TV spot", product_showcase: "Product showcase", t2v: "Text to video",
};
const MODEL_LABEL: Record<HiggsfieldModel, string> = {
  marketing_studio_video: "Marketing Studio Video", seedance_2_5: "Seedance 2.5", gpt_image_2_5: "GPT Image 2.5",
};

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** Lower-cases a leading word unless it's an acronym ("AI face scan" stays). */
const lowerFirst = (text: string) => (/^[A-Z]{2}/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1));
const end = (text: string) => (/[.!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const shorten = (text: string, max: number) => {
  const list = text.replace(/[.!]+$/, "").split(/\s+/);
  return list.length <= max ? list.join(" ") : `${list.slice(0, max).join(" ")}…`;
};
const TAG_BLOCK = new Set(["fine", "overstay", "deport", "immigration", "border", "acne", "breakout"]);

/** Shell-safe single quoting. */
export const shq = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

interface Ctx { app: string; angle: Angle; family: FamilyId; hookType: string | null; platform: string; source: string }

/** Formats whose method beat is a run of steps. */
const listy = (c: Ctx) => c.family === "how_to_steps" || c.family === "listicle" || c.family === "proof_then_method" || c.family === "quiz_funnel" || c.hookType === "number_list";

function hookLine(c: Ctx): string {
  const a = c.angle;
  if (c.family === "quiz_funnel") return a.question;
  if (c.family === "us_vs_them") return end(`${cap(a.mistake)} vs ${c.app}`);
  switch (c.hookType) {
    case "question": return a.question;
    case "bold_claim": return end(a.claim);
    case "number_list": return end(`3 steps to ${a.outcome}`);
    // Stories are told as a scenario: the presenter never claims it happened to them (PR-2).
    case "story": return end(a.story);
    case "pov": return end(`POV: ${a.pov}`);
    case "warning": return end(`Stop ${a.mistake}`);
    case "news": return `Heads up: here's the part of ${a.topic} most people miss.`;
    case "how_to": return end(`How to ${a.outcome} in under a minute`);
    case "curiosity_gap": return `Nobody tells you this about ${a.topic}…`;
    default: return c.family === "myth_vs_reality" ? `“${cap(a.myth)}.” Not quite.` : end(a.claim);
  }
}

function lineFor(role: string, c: Ctx): string {
  const a = c.angle;
  const steps = a.steps.map((s, i) => `${["One", "Two", "Three"][i]}: ${s.startsWith(c.app) ? s : s.charAt(0).toLowerCase() + s.slice(1)}.`).join(" ");
  switch (role) {
    case "hook": return hookLine(c);
    case "setup":
      if (c.family === "myth_vs_reality") return `A lot of people believe ${a.myth}.`;
      if (c.family === "storytime" || c.family === "challenge_or_test" || c.family === "ai_ugc") return end(`${cap(a.pain)} happens more easily than you'd think`);
      if (c.family === "us_vs_them" || c.family === "before_after") return end(`Before: ${a.mistake}`);
      return a.setup;
    case "method":
      if (listy(c)) return steps;
      if (c.family === "myth_vs_reality") return `In reality: ${a.mechanism.charAt(0).toLowerCase()}${a.mechanism.slice(1)}`;
      return a.mechanism;
    // The product speaks for itself: no "I use it" from a presenter (PR-2, PR-3).
    case "product":
      if (c.family === "us_vs_them" || c.family === "before_after") return `After: ${c.app}, with ${a.feature}.`;
      if (c.family === "product_demo" || c.family === "comparison" || c.family === "hook_demo") return `This is ${c.app}: ${a.feature}.`;
      return `That's what ${c.app} is for: ${a.feature}.`;
    case "benefit": return end(`With ${c.app}, ${a.benefit}`);
    case "proof": return c.family === "testimonial_review" ? "[A real customer review, quoted with consent]" : end(`Here's what that looks like: ${a.proof}`);
    case "cta": return end(c.source === "paid" || c.platform === "meta_ads" || c.platform === "tiktok_ads" ? a.cta : `${a.cta}, link in bio`);
    default: return a.setup;
  }
}

function overlayFor(role: string, line: string, c: Ctx): string {
  const a = c.angle;
  switch (role) {
    case "hook": return shorten(line, 8);
    case "setup": return shorten(cap(a.pain), 6);
    case "method": return listy(c) ? a.steps.map((s, i) => `${i + 1}. ${shorten(s, 4)}`).join(" / ") : shorten(a.mechanism, 8);
    case "product": return `${c.app}: ${shorten(a.feature, 5)}`;
    case "benefit": return shorten(cap(a.outcome), 7);
    case "proof": return c.family === "testimonial_review" ? "★★★★★ (real rating only)" : `${c.app}, real screen`;
    case "cta": return shorten(a.cta, 7);
    default: return "";
  }
}

const APP_SHOTS = new Set(["screen_demo", "product_shot", "proof_shot"]);

function visualFor(beat: Beat, c: Ctx): string {
  const cast = FAMILIES[c.family].cast;
  let visual = beat.visual;
  if (beat.role === "product" && (!visual || !APP_SHOTS.has(visual))) visual = "screen_demo";
  if (beat.role === "proof" && (!visual || !APP_SHOTS.has(visual))) visual = "proof_shot";
  if (beat.role === "cta" && !visual) visual = "product_shot";
  if (!visual) visual = beat.role === "method" && listy(c) ? "screen_demo" : cast === "none" ? "broll" : cast === "actors" ? "skit" : "talking_head";
  if (cast === "none" && (visual === "talking_head" || visual === "reaction" || visual === "skit")) visual = "broll";
  return visual;
}

function shotFor(visual: string, c: Ctx, colorName: string): string {
  const a = c.angle;
  switch (visual) {
    case "talking_head": return c.family === "green_screen"
      ? `presenter in front of a full-screen ${c.app} screenshot (${a.demoShot})`
      : "presenter talking to camera, phone at eye level, natural window light";
    case "screen_demo": return `iPhone screen recording of ${a.demoShot}`;
    case "product_shot": return `close-up of a hand holding an iPhone showing ${a.demoShot}`;
    case "text_on_screen": return `bold on-screen text over a clean ${colorName} background`;
    case "broll": return a.broll;
    case "proof_shot": return c.family === "testimonial_review" ? `a real customer review card over a ${colorName} background` : `close-up of the phone showing ${a.proof}`;
    case "reaction": return `presenter reacting to the ${c.app} screen`;
    case "skit": return `short acted scene: ${a.pov}`;
    default: return "presenter talking to camera";
  }
}

/** Our beats: the card's job order (first of each job, at most six), always with the product and a CTA. */
function planBeats(card: FormatCard): Beat[] {
  const byRole = new Map<string, Beat>();
  // Cards whose winners show too little structure already carry the format's usual order (cards.ts);
  // stored cards from before that still get it here.
  const source = new Set(card.beats.map((b) => b.role).filter((r) => r !== "other")).size >= 3 ? card.beats
    : FAMILIES[card.family].beats.map((role, i, all) => ({ role, share: 1 / all.length, visual: i === 0 ? card.beats[0]?.visual ?? null : null }));
  for (const beat of source) {
    if (beat.role === "other") continue;
    const seen = byRole.get(beat.role);
    if (seen) seen.share += beat.share;
    else byRole.set(beat.role, { ...beat });
  }
  let beats = [...byRole.values()];
  if (beats[0]?.role !== "hook") beats = [{ role: "hook", share: 0.12, visual: null }, ...beats.filter((b) => b.role !== "hook")];
  beats = beats.slice(0, 6);
  if (!beats.some((b) => b.role === "product")) {
    const at = beats.findIndex((b) => b.role === "cta");
    beats.splice(at < 0 ? beats.length : at, 0, { role: "product", share: 0.18, visual: null });
  }
  if (!beats.some((b) => b.role === "cta")) beats.push({ role: "cta", share: 0.1, visual: null });
  else beats = [...beats.filter((b) => b.role !== "cta"), beats.find((b) => b.role === "cta")!];
  const total = beats.reduce((n, b) => n + b.share, 0) || 1;
  return beats.map((b) => ({ ...b, share: b.share / total }));
}

/** Speaking pace for voice-over and talking to camera (about 155 words a minute). */
const WORDS_PER_SEC = 2.6;
const spoken = (line: string) => Math.max(1.5, line.split(/\s+/).filter(Boolean).length / WORDS_PER_SEC);

/**
 * Seconds per beat. Spoken beats get the time their line takes to say, stretched evenly to fill the
 * clip; silent ones follow the winners' proportions (at least 2 s each). Cut points land on half seconds.
 */
function timeBeats(beats: Beat[], lines: string[], duration: number, speech: boolean): [number, number][] {
  const raw = speech ? lines.map(spoken) : beats.map((b) => Math.max(2, b.share * duration));
  const scale = duration / (raw.reduce((n, s) => n + s, 0) || 1);
  let t = 0;
  return raw.map((s, i) => {
    const from = Math.round(t * 2) / 2;
    t += s * scale;
    return [from, i === raw.length - 1 ? duration : Math.max(from + 0.5, Math.round(t * 2) / 2)];
  });
}

function route(card: FormatCard): { model: HiggsfieldModel; mode: string | null; aspect: string; why: string } {
  if (card.medium === "text") {
    return { model: "gpt_image_2_5", mode: null, aspect: card.platform === "linkedin" ? "4:5" : "1:1", why: "A text post: recreated as a feed image with the hook as the headline (GPT Image 2.5 renders on-image text best), plus the post copy itself." };
  }
  if (card.medium === "image") {
    return { model: "gpt_image_2_5", mode: null, aspect: card.platform === "tiktok_ads" ? "9:16" : "4:5", why: `A static ${FAMILIES[card.family].label.toLowerCase()} ad: GPT Image 2.5 is Higgsfield's default for designed images with legible text. ${card.platform === "tiktok_ads" ? "9:16 for TikTok." : "4:5 fills the Meta feed."}` };
  }
  const video = FAMILIES[card.family].video;
  return video.model === "marketing_studio_video"
    ? { model: video.model, mode: video.mode, aspect: "9:16", why: `Presenter-led ${FAMILIES[card.family].label.toLowerCase()} format: Marketing Studio is Higgsfield's default for ads and UGC, in ${MODE_LABEL[video.mode] ?? video.mode} mode.` }
    : { model: video.model, mode: "t2v", aspect: "9:16", why: `${FAMILIES[card.family].label} is scene- and motion-led, not a presenter talking: Seedance 2.5 (multi-shot text-to-video) fits better than Marketing Studio.` };
}

/** The still's layout for each format (image ads, text posts). */
function layoutFor(c: Ctx, colorName: string): string {
  const a = c.angle;
  const mock = `an iPhone mockup showing ${a.demoShot}`;
  switch (c.family) {
    case "listicle": case "how_to_steps": case "quiz_funnel":
      return `a numbered list of three short items: ${a.steps.map((s, i) => `"${i + 1}. ${shorten(s, 5)}"`).join(", ")}, next to ${mock}`;
    case "myth_vs_reality":
      return `a split layout: left labelled "Myth" with "${shorten(a.myth, 8)}" struck through; right labelled "Reality" with "${shorten(a.mechanism, 10)}"`;
    case "comparison": case "us_vs_them":
      return `a two-column comparison table, "The old way" (${shorten(a.mistake, 6)}) vs "${c.app}", four rows with crosses and ticks, no other brand names`;
    case "before_after":
      return `a split image: left "Before" shows ${a.broll.split(",")[0]} and a messy hand-written count; right "After" shows ${mock}`;
    case "reddit_style": case "tweet_style":
      return `an original text-post card (no Reddit, X or other platform logos, names or UI): a short question about ${a.topic} and a reply recommending ${c.app}, beside ${mock}`;
    case "testimonial_review":
      return `five stars and one review quote in large type, left as the placeholder [REAL REVIEW QUOTE] for a real customer's review, used with their permission, beside ${mock}`;
    default:
      return `${mock} on a clean ${colorName} background`;
  }
}

/**
 * The recipe for one card. `angleId` picks one of the workspace's angles (default: the best fit);
 * `lines` overrides beat lines by index (a copy provider's rewrite).
 */
export function recreate(card: FormatCard, app: AppContext, o: { angleId?: string; lines?: (string | null | undefined)[] } = {}): Recipe {
  const angles = anglesFor(app);
  const angle = angles.find((a) => a.id === o.angleId) ?? pickAngle(card, angles);
  const brand = brandDefaults(app);
  const name = app.brandKit.appName || app.name;
  const c: Ctx = { app: name, angle, family: card.family, hookType: card.hookType, platform: card.platform, source: card.source };
  const r = route(card);
  const family = FAMILIES[card.family];
  const notes: string[] = [];
  const needsHuman = new Set<string>();
  const colorName = brand.colorNames[0] ?? "brand-colour";
  const palette = brand.colorNames.length ? brand.colorNames.slice(0, 3).join(", ") : "the app's brand colours";

  const plan = planBeats(card);
  // A caller's rewrite (`o.lines`) replaces the template line; the checks below still run on it.
  const lines = plan.map((beat, i) => o.lines?.[i]?.trim() || lineFor(beat.role, c));
  const explainsRule = brand.disclaimer != null && plan.some((b) => b.role === "method");

  // Length: long enough to say every line, nudged towards the winners' typical length, inside what
  // each model makes in one clip.
  let duration: number | null = null;
  const speech = r.model === "marketing_studio_video" || family.cast === "actors";
  if (card.medium === "video") {
    const needed = lines.reduce((n, l) => n + spoken(l), 0);
    const base = card.lengthSec ?? family.defaultSec;
    const [lo, hi] = r.model === "marketing_studio_video" ? [8, 30] : [5, 15];
    duration = clamp(Math.round(speech ? Math.max(needed * 1.1, Math.min(base, needed * 1.4)) : base), lo, hi);
    if (base > duration + 10) notes.push(`The winners run about ${Math.round(base)}s; this is a ${duration}s cut of the same beats. For the long version, generate the method beats as a second clip and join them in the edit.`);
    if (speech && needed > duration + 1) notes.push(`The lines need about ${Math.round(needed)}s to say; trim them or raise --duration.`);
  }
  const times = duration ? timeBeats(plan, lines, duration, speech) : plan.map(() => [null, null] as [null, null]);
  const beats: RecipeBeat[] = plan.map((beat, i) => {
    const visual = visualFor(beat, c);
    const onScreen = overlayFor(beat.role, lines[i], c);
    return {
      role: beat.role, from: times[i][0], to: times[i][1], line: lines[i], visual, shot: shotFor(visual, c, colorName),
      onScreen: beat.role === "method" && explainsRule ? `${onScreen} · ${brand.disclaimer}` : onScreen,
    };
  });
  const hook = beats[0].line;
  const span = (b: RecipeBeat) => (b.from != null && b.to != null ? `${b.from}-${b.to}s` : "");
  const rules = explainsRule ? ` Small on-screen note during the explanation: "${brand.disclaimer}"` : "";

  let prompt: string;
  let params: Record<string, string | number | boolean | string[]>;
  if (r.model === "marketing_studio_video") {
    // An original presenter who explains the app: never a customer, the founder or a credentialed expert (PR-2, NH-5).
    const presenter = `An original presenter (not a real person's likeness), relatable to ${angle.audience}, explaining the app; not a customer and not a doctor, lawyer, tax adviser or other expert`;
    // Compact on purpose (Higgsfield models drift on very long prompts): the look is set once, and
    // beats filmed to camera say so in two words.
    prompt = [
      `${MODE_LABEL[r.mode!]} ad, vertical 9:16, ${duration}s, for the iPhone app ${name} (${lowerFirst((app.brandKit.tagline || angle.feature).replace(/\.$/, ""))}).`,
      `${presenter}. Filmed on a phone at eye level, natural light.`,
      ...beats.map((b) => `${span(b)} ${ROLE_NAME[b.role] ?? b.role}${b.visual === "talking_head" ? " (to camera)" : ` (${b.shot})`}: "${b.line}"`),
      `Burned-in captions. Accents in ${palette}. Tone: ${brand.tone}. The only app or brand shown is ${name}.${rules}`,
    ].join(" ");
    params = { mode: r.mode!, duration: duration!, aspect_ratio: r.aspect, resolution: "720p", generate_audio: true };
    notes.push(`Marketing Studio works best with your product attached: import the App Store page once (setup below), or pass a screenshot with --image-references so the screen shots show the real ${name} UI.`);
  } else if (r.model === "seedance_2_5") {
    const silent = family.cast === "none";
    prompt = [
      `Vertical 9:16 multi-shot video, ${duration}s, for the ${name} app.`,
      ...beats.map((b, i) => `Shot ${i + 1} (${span(b)}): ${b.shot}${!silent && b.role !== "cta" && family.cast === "actors" ? `, line: "${b.line}"` : ""}.`),
      `Handheld phone look, soft natural light, ${palette} in the set and wardrobe. Original characters, no real person's likeness, no logos.${silent ? " No text in frame: the captions are added in the edit." : ""}`,
    ].join(" ");
    params = { mode: "t2v", duration: duration!, aspect_ratio: r.aspect, resolution: "720p", generate_audio: !silent };
    if (silent) notes.push(`The message is in the on-screen text: add it in the edit over this footage${explainsRule ? `, with "${brand.disclaimer}"` : ""}, and a sound from Meta's Sound Collection or TikTok's Commercial Music Library (IP-4).`);
    notes.push(`To show the real ${name} screens, switch to --mode omni_reference and pass an app screenshot with --image-references.`);
  } else {
    const headline = shorten(hook.replace(/[“”"]/g, ""), 10);
    prompt = `${r.aspect} social ${card.source === "paid" ? "ad" : "post"} image for the iPhone app ${name}. Headline in large bold type: "${headline}". Smaller line: "${cap(angle.outcome)}." Layout: ${layoutFor(c, colorName)}. Small "${shorten(angle.cta, 6)}" button at the bottom.${explainsRule ? ` Tiny footnote: "${brand.disclaimer}"` : ""} ${cap(palette)} palette, clean minimal layout, generous whitespace, crisp legible text. No other brands, logos or real people.`;
    params = { aspect_ratio: r.aspect, quality: "high", resolution: "2k" };
    // A paid image ad's own picture (the stored copy) as the reference: the layout and look follow it,
    // every brand detail is ours.
    const reference = card.source === "paid" && card.medium === "image" ? card.examples.map((e) => e.thumb).find((t): t is string => Boolean(t && /^https:\/\//.test(t))) : undefined;
    if (reference) {
      params.style_refs = [reference];
      prompt = `REFERENCE IMAGE: the first attached image is a competitor's ad in this format. Keep its layout, composition, text hierarchy and kind of imagery so it reads as a sibling of that ad, not a print of it: the brand, product, wording, people and colours are ours, as described here. ${prompt}`;
      notes.push("Send to Studio attaches the competitor's image as the layout and style reference (then your screenshots). The command below doesn't: add it with --image-references.");
    }
    if (app.brandKit.screenshotUrls.length) notes.push("Pass an app screenshot with --image-references so the mockup shows the real UI.");
  }

  // What a person must confirm before this runs (POLICY.md).
  if (card.family === "testimonial_review") needsHuman.add("PR-3");
  if (card.family === "ugc_testimonial" || card.family === "storytime" || card.family === "ai_ugc") notes.push("Testimonial-style formats are rewritten as a presenter explaining the app. A real customer's own words (with consent on file) can replace the lines; an AI presenter never claims to have used it (PR-2, PR-3).");
  if (card.family === "founder_story") { needsHuman.add("PR-2"); notes.push("Founder formats need the real founder on camera: an AI presenter can't pose as the founder or an expert (PR-2)."); }
  if (card.family === "before_after" && brand.policy === "health") { needsHuman.add("NH-2"); needsHuman.add("NH-4"); notes.push("Before/after for a health or wellness product compares the product's own result screens, never faces or bodies; check Meta's health rules before running (NH-2, NH-4)."); }
  if (card.family === "reddit_style" || card.family === "tweet_style") notes.push("Look-alike platform screenshots are rebuilt as an original design with no platform logos or UI (PR-5).");
  if (card.family === "us_vs_them" || card.family === "comparison") notes.push("Compare against the old way, never a named competitor (IP-5).");
  if (brand.policy === "health") needsHuman.add("NH-1");
  if (r.model !== "gpt_image_2_5") notes.push("Realistic AI people: turn on TikTok's AI-generated content label when launching there (AI-2).");
  if (card.ctaShare < 0.3) notes.push(`Only ${Math.round(card.ctaShare * 100)}% of these winners ask for an action; the CTA here is kept short and last so the format still feels native.`);

  // Hashtags from the angle's plain keywords, minus risky ones (fear, immigration politics: BW-4, BW-5).
  const tags = [...new Set([...angle.keywords.filter((k) => /^[a-z0-9]+$/i.test(k) && !TAG_BLOCK.has(k)).slice(0, 3), name.replace(/\W/g, "").toLowerCase()])];
  const caption = `${hook}\n\n${cap(angle.outcome)} with ${name}. ${end(angle.cta)}${explainsRule ? `\n\n${brand.disclaimer}` : ""}\n\n${tags.map((t) => `#${t}`).join(" ")}`;
  let postCopy: string | null = null;
  if (card.medium === "text") {
    const method = listy(c) ? angle.steps.map((s) => `→ ${s}`).join("\n") : angle.mechanism;
    postCopy = card.platform === "x"
      ? `${hook}\n\n${method}\n\n${name}: ${angle.feature}.`.slice(0, 280)
      : `${hook}\n\n${angle.setup}\n\n${method}\n\n${name} does this: ${angle.feature}.\n\n${end(angle.cta)}${brand.disclaimer ? `\n\n${brand.disclaimer}` : ""}`;
  }

  const flags = Object.entries(params).filter(([, v]) => !Array.isArray(v)).map(([k, v]) => `--${k} ${v}`).join(" ");
  const cli = `higgsfield generate create ${r.model} --prompt ${shq(prompt)} ${flags} --wait`;
  const costCli = `higgsfield generate cost ${r.model} --prompt ${shq("cost check")} ${flags}`;
  const setup = r.model === "marketing_studio_video" && app.brandKit.appStoreUrl
    ? [
      `higgsfield marketing-studio webproducts fetch --url ${shq(app.brandKit.appStoreUrl)} --wait --json`,
      `# then add to the command: --web_product_ids @ids.json --specific_mode web_product --web_product_type mobile  (ids.json = ["<web product id>"])`,
    ]
    : [];

  const viewer = [caption, postCopy ?? "", ...beats.flatMap((b) => [b.line, b.onScreen])];
  const issues = policyIssues([prompt, ...viewer], card, app, brand.claims, viewer);
  return {
    cardKey: card.key, model: r.model, modelLabel: MODEL_LABEL[r.model], mode: r.mode, why: r.why,
    aspectRatio: r.aspect, duration, resolution: String(params.resolution), angle: { id: angle.id, label: angle.label },
    prompt, beats, onScreenText: beats.map((b) => b.onScreen).filter(Boolean), caption, postCopy, params, cli, costCli, setup,
    // The Studio's price table (lib/creative-plan.ts jobCost), for the params this recipe runs with.
    estCredits: r.model === "gpt_image_2_5" || duration ? jobCost(r.model, params) : null,
    notes, checks: { ok: issues.length === 0, issues }, needsHuman: [...needsHuman],
  };
}
