// Research → "Make this for <app>": one sheet that turns a competitor's winning ad into the same kind of ad
// for the student's own app, three ways: a ready-made prompt to paste into another tool (always there, no
// key needed), "Generate here" with the creative pipeline, and "Send to Studio" for a full batch.
//
// This file is the pure part, shared by the sheet (components/research/make-for-app.tsx), the API routes
// and the Node tests (scripts/creative-runner/tests/make-for-app.test.ts). Relative imports only.
//
// 1. blueprint() reads the competitor ad's STRUCTURE: its format, layout, hook and copy structure, text
//    density, type and vibe, and its aspect ratio. From the stored decode and AI scan when there are
//    some, else from the ad's own text and media type. Every piece of their wording is scrubbed: their
//    brand and page name (and close variants), links, handles and quoted words never get through.
// 2. appFromBrand() collects the student's app: name, what it does, audience, the outcome it promises,
//    the claims it may make (verified facts, proof, product claims), banned words and forbidden claims
//    (the brand rules), colours as hex with roles, fonts, tone, a call to action, logo, icon and screens.
// 3. buildPrompts() writes three variants (ChatGPT / GPT Image, Higgsfield, general Midjourney-style)
//    plus `generate`, the Higgsfield wording with the reference images numbered the way the creatives
//    backend sends them. Nothing of the competitor's words is quoted: the copy lines are the app's own.
// 4. makeCost() estimates what one image costs on each provider, makeRequest() is the BatchRequest that
//    "Generate here" starts (the same one the Studio and Playground use), makeHandoff() the Studio handoff.
import { cleanMustAvoid, DEFAULT_REQUEST, jobCost, type BatchRequest, type ImageQuality, type ImageResolution } from "./creative-plan";
import { costLabel, fmtUsd, openAiImageMode, openAiImageUsd, type ImageProvider, type OpenAiImagePlan } from "./image-provider";
import { nearestPlacement, placementById, PLACEMENTS, type Aspect, type PlacementId } from "./meta-formats";
import { brandVariants, PROMPT_MAX, type RecreateHandoff, type RecreateSource } from "./recreate";
import { AD_FORMAT_LABEL } from "./research";
import { HOOK_LABEL, ROLE_LABEL } from "./types";
import { verifiedFacts, type BrandSystem } from "./brand-system";
import type { ProductProfile } from "./product-insight";

// MARK: The student's app

export interface MakeColor { hex: string; role: string; name?: string }
export interface MakeFont { role: string; family: string; weight?: number }

export interface MakeApp {
  name: string;
  /** What it does, in one line. */
  does: string;
  audience: string;
  /** The outcome it promises the buyer. */
  outcome: string;
  /** Claims the ad may make, exactly as written (verified facts, proof, product claims). */
  claims: string[];
  /** Words the brand never uses (Brand page, voice). */
  bannedWords: string[];
  /** Claims never to make or imply. */
  forbiddenClaims: string[];
  colors: MakeColor[];
  fonts: MakeFont[];
  tone: string;
  /** The words on the button. */
  cta: string;
  logoUrl: string | null;
  iconUrl: string | null;
  /** How many App Store screenshots the brand kit has. */
  screenshots: number;
  /** App screens among the product images. */
  screens: string[];
}

/** What appFromBrand reads: the Research page's brand (lib/research.ts ResearchBrand) fits. */
export interface BrandLike {
  appName: string;
  tagline?: string | null;
  colors?: string[];
  iconUrl?: string | null;
  screenshots?: number;
  tone?: string | null;
  forbiddenClaims?: string[];
  profile?: ProductProfile | null;
  system?: BrandSystem | null;
}

export interface AssetLike { url: string; kind: string; hidden?: boolean; label?: string | null }

const HEX = /^#[0-9a-f]{6}$/i;
const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const bare = (s: string) => squash(s).replace(/[.;:,]+$/, "");
const uniq = (list: (string | null | undefined)[], max: number) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const text = squash(raw);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
  }
  return out.slice(0, max);
};
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : text);

const ROLE_ORDER = ["primary", "secondary", "accent", "background", "neutral"];

/** The app as the prompts need it, from the brand kit, the brand system, the AI profile and the product images. */
export function appFromBrand(brand: BrandLike | null | undefined, assets: AssetLike[] = []): MakeApp {
  const b = brand ?? { appName: "" };
  const sys = b.system ?? null;
  const p = b.profile ?? null;
  const palette: MakeColor[] = (sys?.palette ?? []).filter((c) => HEX.test(c.hex)).map((c) => ({ hex: c.hex.toUpperCase(), role: c.role, ...(c.name ? { name: c.name } : {}) }));
  // A kit with colours but no brand system: the first is the primary, the second the secondary, the rest accents.
  const kit = (b.colors ?? []).filter((c) => HEX.test(c) && !palette.some((x) => x.hex.toLowerCase() === c.toLowerCase()))
    .map((hex, i) => ({ hex: hex.toUpperCase(), role: palette.length ? "accent" : ["primary", "secondary"][i] ?? "accent" }));
  const colors = [...palette, ...kit].sort((x, y) => (ROLE_ORDER.indexOf(x.role) + 9) % 9 - (ROLE_ORDER.indexOf(y.role) + 9) % 9).slice(0, 6);
  const fonts = (sys?.fonts ?? []).filter((f) => squash(f.family)).map((f) => ({ role: f.role, family: squash(f.family), ...(f.weight ? { weight: f.weight } : {}) })).slice(0, 3);
  const visible = assets.filter((a) => !a.hidden && /^https:\/\//.test(a.url));
  const productClaims = (sys?.products ?? []).flatMap((x) => x.claims);
  const facts = verifiedFacts(sys).map((f) => `${f.label}: ${f.value}`);
  return {
    name: squash(b.appName),
    does: bare(p?.summary || sys?.positioning.valueProposition || b.tagline || ""),
    audience: bare(p?.audience || sys?.avatars?.[0]?.name || ""),
    outcome: bare(p?.promises[0] || sys?.positioning.valueProposition || b.tagline || ""),
    claims: uniq([...facts, ...(p?.proof ?? []), ...productClaims], 8),
    bannedWords: uniq(sys?.voice.avoid ?? [], 20).filter((w) => w.length >= 2),
    forbiddenClaims: uniq([...(b.forbiddenClaims ?? []), ...(sys?.voice.forbiddenClaims ?? []), ...(p?.avoid ?? [])], 12),
    colors,
    fonts,
    tone: bare(b.tone || sys?.voice.oneLine || p?.voice || ""),
    cta: bare(p?.ctas[0] || "Download now"),
    logoUrl: visible.find((a) => a.kind === "logo")?.url ?? null,
    iconUrl: /^https:\/\//.test(b.iconUrl ?? "") ? b.iconUrl! : null,
    screenshots: Math.max(0, b.screenshots ?? 0),
    screens: visible.filter((a) => a.kind === "app_screen").map((a) => a.url).slice(0, 3),
  };
}

export type MakeGapKey = "name" | "colors" | "logo" | "does" | "audience" | "outcome" | "fonts";
export interface MakeGap { key: MakeGapKey; label: string; /** Missing colours or logo: said up front, with a link to Brand. */ main: boolean }

/** What the Brand page still lacks for a good prompt. The prompt still works without it: it just says less. */
export function brandGaps(app: MakeApp): MakeGap[] {
  const gaps: MakeGap[] = [];
  if (!app.name) gaps.push({ key: "name", label: "your app's name", main: true });
  if (!app.colors.length) gaps.push({ key: "colors", label: "brand colours", main: true });
  if (!app.logoUrl && !app.iconUrl) gaps.push({ key: "logo", label: "a logo or app icon", main: true });
  if (!app.does) gaps.push({ key: "does", label: "what it does", main: false });
  if (!app.audience) gaps.push({ key: "audience", label: "who it's for", main: false });
  if (!app.outcome) gaps.push({ key: "outcome", label: "the outcome it promises", main: false });
  if (!app.fonts.length) gaps.push({ key: "fonts", label: "fonts", main: false });
  return gaps;
}

// MARK: Their ad's structure

export type MakeMode = "image" | "still" | "video";

export interface AdBlueprint {
  /** "image": an image ad; "still": one image in a video ad's style; "video": a video prompt. */
  mode: MakeMode;
  video: boolean;
  format: string;
  aspect: Aspect;
  placement: PlacementId;
  cards: number;
  layout: string;
  hook: string;
  /** The order of their message, as roles ("Hook", "Benefit", "CTA"). */
  structure: string[];
  textDensity: string;
  typography: string;
  vibe: string;
  /** Lines of text on the image (from the scan), 0 when unknown. */
  lines: number;
  hasCta: boolean;
  shots: { from: number; to: number; type: string; visual: string }[];
  duration: number | null;
  /** True when it was read from the stored decode or AI scan, false when only from the ad's own text. */
  fromRead: boolean;
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|app|io|co|net|org|ai|me|ly|uk|de|fr|us)(?:\/\S*)?\b/gi;
const HANDLE_RE = /(^|\s)@[a-z0-9_.]{2,}/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g;
const QUOTED_RE = /["“”„«»][^"“”„«»\n]{1,160}["“”„«»]|(^|[\s(])['‘’][^'‘’\n]{2,160}['‘’](?=[\s.,;:)!?]|$)/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Their names as they may be written: page name, competitor, and the name in their link's domain. */
export function theirNames(src: Pick<RecreateSource, "pageName" | "competitor" | "linkUrl" | "caption">): string[] {
  const domain = (() => {
    const raw = src.linkUrl || src.caption || "";
    const m = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)\./i.exec(raw.trim());
    return m && m[1].length >= 4 && !/^(apps|play|itunes|link|bit|go|get|l|lm|m|fb)$/i.test(m[1]) ? m[1] : null;
  })();
  return brandVariants([src.pageName, src.competitor, domain]);
}

/** Takes their brand, links, handles, emails and quoted words out of a description of their ad. */
export function scrubber(names: string[]): (text: string | null | undefined) => string {
  const res = names.filter((n) => n.replace(/[^a-z0-9]/gi, "").length >= 3).map((n) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?:'s)?(?![\\p{L}\\p{N}])`, "giu"));
  return (text) => {
    let out = squash(text);
    out = out.replace(QUOTED_RE, (_m, pre = "") => `${pre}a short line`);
    out = out.replace(EMAIL_RE, "").replace(URL_RE, "").replace(HANDLE_RE, "$1");
    for (const re of res) out = out.replace(re, "the brand");
    return squash(out.replace(/\(\s*\)/g, "").replace(/\s+([.,;:])/g, "$1"));
  };
}

/** Any of their names still in a text (case-insensitive, whole words). The app's own name never counts. */
export function leaksOf(text: string, names: string[], appName = ""): string[] {
  const app = appName.trim().toLowerCase();
  return names.filter((n) => n.toLowerCase() !== app && !app.includes(n.toLowerCase()) && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, "iu").test(text));
}

const ASPECT_OF: Record<PlacementId, Aspect> = Object.fromEntries(PLACEMENTS.map((p) => [p.id, p.aspect])) as Record<PlacementId, Aspect>;

function hookLine(src: RecreateSource, clean: (t: string) => string): string {
  const d = src.decoded;
  const type = d?.hookType ? (HOOK_LABEL[d.hookType] ?? d.hookType).toLowerCase() : "";
  const hook = d?.roles.find((r) => r.role === "hook");
  const words = hook ? hook.text.split(/\s+/).filter(Boolean).length : 0;
  const visual = hook?.visual ? clean(hook.visual) : "";
  const video = src.videoScan?.hook;
  if (src.video && video?.what_happens) return `${type ? `A ${type} hook` : "A hook"} in the first ${Math.max(1, Math.round(video.seconds || 2))} seconds: ${clean(video.what_happens)}`;
  if (type) return `A ${type} hook${words ? ` of about ${words} words` : ""}${visual ? `, shown as ${visual}` : ""}, as the biggest text`;
  const head = squash(src.headline || src.body.split("\n")[0] || "");
  if (!head) return "";
  if (/\?\s*$/.test(head)) return "A question as the hook, as the biggest text";
  if (/^\d|\b\d+\s+(?:ways|tips|reasons|things|steps)\b/i.test(head)) return "A number-led hook (a count or a stat), as the biggest text";
  return `A short, bold hook line of about ${Math.min(10, head.split(/\s+/).length)} words, as the biggest text`;
}

function defaultLayout(src: RecreateSource, cards: number): string {
  if (src.video) return "vertical, full-bleed video frames with short captions over the middle third";
  if (src.mediaType === "carousel") return `a carousel of ${cards} cards, one idea per card, the same frame and type on every card`;
  return "one bold headline at the top, the product as the hero in the middle, a short supporting line and a button at the bottom";
}

/** The structure of their ad, never its words. `mode` picks how a video ad is made ("still" or "video"). */
export function blueprint(src: RecreateSource, mode?: "still" | "video"): AdBlueprint {
  const clean = scrubber(theirNames(src));
  const style = src.style ?? null;
  const placement = (src.width && src.height ? nearestPlacement(src.width, src.height) : undefined)?.id ?? (src.video ? "stories_reels" : "feed_vertical");
  const cards = src.mediaType === "carousel" ? Math.max(2, Math.min(10, src.cardCount)) : 1;
  const formatId = src.decoded?.format && src.decoded.format !== "no_clear_format" ? src.decoded.format : null;
  const format = formatId ? AD_FORMAT_LABEL[formatId] ?? formatId.replace(/_/g, " ")
    : src.video ? "Video ad" : src.mediaType === "carousel" ? `Carousel of ${cards} cards` : "Single image ad";
  const roles = (src.decoded?.roles ?? []).map((r) => ROLE_LABEL[r.role] ?? "").filter((r) => r && r !== "Other");
  const structure = roles.length ? roles.filter((r, i) => roles.indexOf(r) === i)
    : [src.headline || src.body ? "Hook" : "", src.body.length > 60 ? "Benefit" : "", src.cta ? "CTA" : ""].filter(Boolean);
  const shots = (src.videoScan?.shots ?? []).slice(0, 8).map((s) => ({ from: s.start, to: s.end, type: s.shot_type.replace(/_/g, " "), visual: cut(clean(s.visual), 140) }));
  const how = src.video ? (mode ?? "video") : "image";
  return {
    // A still from a video ad with no named format is an image ad, not "a video ad" (the still line says the rest).
    mode: how, video: src.video, format: how === "still" && !formatId ? "Single image ad" : format,
    aspect: how === "video" ? "9:16" : ASPECT_OF[placement], placement: how === "video" ? "stories_reels" : placement, cards: how === "image" ? cards : 1,
    layout: cut(clean(style?.layout) || defaultLayout(src, cards), 260),
    hook: cut(hookLine(src, clean), 220),
    structure: structure.length ? structure : ["Hook", "CTA"],
    textDensity: cut(clean(style?.text_density), 120),
    typography: cut(clean(src.typography || style?.typography), 160),
    vibe: cut(clean(style?.vibe), 140),
    lines: src.onImageText?.length ?? 0,
    hasCta: Boolean(src.cta),
    shots,
    duration: src.duration ? Math.round(src.duration) : null,
    fromRead: Boolean(src.decoded || style || src.videoScan),
  };
}

// MARK: The prompts

export type PromptVariant = "gpt" | "higgsfield" | "general";
export const VARIANT_LABEL: Record<PromptVariant, string> = { gpt: "GPT Image / ChatGPT", higgsfield: "Higgsfield", general: "General" };
/** One line on how to use each variant in its own tool. */
export const VARIANT_HOW: Record<PromptVariant, string> = {
  gpt: "In ChatGPT: attach the reference and your brand kit images, paste the prompt, send.",
  higgsfield: "In Higgsfield: pick GPT Image 2.5 (or Seedance for video), add the images in the order the prompt numbers them, paste the prompt.",
  general: "In Midjourney or another tool: paste the prompt; add the reference as an image prompt or style reference where the tool takes one.",
};

export interface RefPlan {
  /** Their ad's image (or a video's still) goes first, as the layout reference. */
  reference: boolean;
  logo: boolean;
  /** App screenshots after the logo. */
  screens: number;
}

export interface MakePrompts {
  gpt: string;
  higgsfield: string;
  general: string;
  /** What "Generate here" sends: the Higgsfield wording with the images numbered as the backend sends them. */
  generate: string;
  /** Their names, links and handles: QA flags any of it on the creative. */
  mustAvoid: string[];
  /** Their names found in a prompt after scrubbing (always empty unless something slipped through). */
  leaks: string[];
}

const hexLine = (colors: MakeColor[]) => colors.map((c) => `${c.hex} (${c.role}${c.name ? `, ${c.name}` : ""})`).join(", ");
const fontLine = (fonts: MakeFont[]) => fonts.map((f) => `${f.role}: ${f.family}${f.weight ? ` ${f.weight}` : ""}`).join("; ");
const quoted = (s: string) => `"${s.replace(/"/g, "'")}"`;

/** The copy on the ad, in the app's own words, without any banned word. */
export function copyLines(app: MakeApp): { headline: string; support: string; cta: string } {
  const banned = app.bannedWords.map((w) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, "iu"));
  const ok = (s: string) => s && !banned.some((re) => re.test(s));
  const short = (s: string, words: number) => { const w = s.split(/\s+/); return w.length > words ? `${w.slice(0, words).join(" ")}` : s; };
  const headline = [app.outcome, app.does, app.name].map((s) => short(bare(s), 9)).find(ok) ?? "";
  const support = [app.does, app.audience ? `Made for ${app.audience}` : ""].map((s) => cut(bare(s), 90)).find((s) => ok(s) && s !== headline) ?? "";
  const cta = [app.cta, "Download now", "Try it free"].find(ok) ?? "";
  return { headline, support, cta };
}

function refList(refs: RefPlan, app: MakeApp): { line: string; n: { reference?: number; logo?: number; screens?: [number, number] } } {
  let i = 0;
  const n: { reference?: number; logo?: number; screens?: [number, number] } = {};
  const parts: string[] = [];
  if (refs.reference) { n.reference = ++i; parts.push(`image ${i} is the reference ad (layout and structure only)`); }
  if (refs.logo) { n.logo = ++i; parts.push(`image ${i} is the ${app.name || "app"} logo`); }
  if (refs.screens > 0) { n.screens = [i + 1, i + refs.screens]; parts.push(refs.screens > 1 ? `images ${i + 1}–${i + refs.screens} are screens of the app` : `image ${i + 1} is a screen of the app`); i += refs.screens; }
  return { line: parts.length ? `Attached: ${parts.join("; ")}.` : "", n };
}

function rulesLines(app: MakeApp): string[] {
  return [
    app.claims.length ? `Only these claims may appear, as written: ${app.claims.map((c) => cut(c, 90)).join("; ")}. Make no other claim, number or promise.` : "Make no claim, number, rating or promise beyond what is written here.",
    app.bannedWords.length ? `Never use these words: ${app.bannedWords.join(", ")}.` : "",
    app.forbiddenClaims.length ? `Never claim or imply: ${app.forbiddenClaims.map((c) => cut(c, 80)).join("; ")}.` : "",
  ].filter(Boolean);
}

function appLines(app: MakeApp): string[] {
  const name = app.name || "the app";
  return [
    `The product: ${name}${app.does ? `, ${app.does.charAt(0).toLowerCase()}${app.does.slice(1)}` : ""}.`,
    app.audience ? `It's for ${app.audience}.` : "",
    app.outcome && app.outcome.toLowerCase() !== app.does.toLowerCase() ? `The outcome it promises: ${app.outcome}.` : "",
    app.colors.length ? `Brand colours, use only these: ${hexLine(app.colors)}.` : "Colours: a clean, neutral palette with one strong accent (no brand colours are set yet).",
    app.fonts.length ? `Fonts: ${fontLine(app.fonts)}.` : "",
    app.tone ? `Tone: ${app.tone}.` : "",
  ].filter(Boolean);
}

function textBlock(app: MakeApp, b: AdBlueprint): string[] {
  const c = copyLines(app);
  const lines = [
    c.headline ? `- Headline: ${quoted(c.headline)}` : "",
    c.support && (b.lines === 0 || b.lines >= 2) ? `- Supporting line: ${quoted(c.support)}` : "",
    c.cta && b.hasCta ? `- Button: ${quoted(c.cta)}` : "",
  ].filter(Boolean);
  return lines.length ? ["Text on the ad, exactly these words and nothing else:", ...lines] : [];
}

const sizeOf = (aspect: Aspect) => placementById(PLACEMENTS.find((p) => p.aspect === aspect)?.id ?? "feed_vertical")!.size;

function imagePrompt(variant: "gpt" | "higgsfield", app: MakeApp, b: AdBlueprint, refs: RefPlan): string {
  const name = app.name || "the app";
  const { line: attached, n } = refList(refs, app);
  const [w, h] = sizeOf(b.aspect);
  const still = b.mode === "still" ? " It is one still image in the style of a video ad (a single frame, not a video)." : "";
  const head = variant === "gpt"
    ? `Create a ${b.format.toLowerCase()} for ${name}, ${b.aspect} (${w}×${h} px), ready to run as a Meta ad.${still}`
    : `${b.format} for ${name}. Aspect ratio ${b.aspect}.${still}`;
  const refLine = refs.reference
    ? variant === "gpt"
      ? "Use the attached reference ad for its layout, structure and pacing only. Replace everything brand-specific with ours: never copy its brand name, logo, people, product, screens or words."
      : `Follow image ${n.reference}'s layout and structure; rebuild every brand-specific part (name, logo, people, product, screens, words, colours) as ours.`
    : "Never show another brand's name, logo, people or words.";
  const lines = [
    head,
    attached,
    refLine,
    b.cards > 1 ? `A carousel of ${b.cards} cards: the same frame and type on every card, one idea per card, the story told left to right.` : "",
    `Layout: ${b.layout}.`,
    b.hook ? `Hook: ${b.hook}.` : "",
    `Message order: ${b.structure.join(" → ")}.`,
    b.textDensity ? `Text amount: ${b.textDensity}.` : "",
    ...textBlock(app, b),
    ...appLines(app),
    n.logo ? `Logo: use image ${n.logo} exactly as it is, small, with clear space around it; never redraw or restyle it.` : app.logoUrl || app.iconUrl ? `Logo: place the ${name} logo small, with clear space around it.` : "No logo: leave a clean corner for one.",
    n.screens ? `App screens: show image${n.screens[0] === n.screens[1] ? ` ${n.screens[0]}` : `s ${n.screens[0]}–${n.screens[1]}`} on a phone, straight, full screen, unchanged.` : "",
    b.typography ? `Type feel: ${b.typography}, set in our fonts.` : "",
    b.vibe ? `Mood: ${b.vibe}.` : "",
    ...rulesLines(app),
    "Keep all text inside the middle 80% of the frame, sharp and spelled exactly as written.",
  ];
  return lines.filter(Boolean).join("\n");
}

function videoPrompt(variant: "gpt" | "higgsfield" | "general", app: MakeApp, b: AdBlueprint): string {
  const name = app.name || "the app";
  const c = copyLines(app);
  const length = b.duration ? Math.min(30, Math.max(5, b.duration)) : 10;
  const shots = b.shots.length
    ? b.shots.map((s) => `- ${Math.round(s.from)}–${Math.round(s.to)} s: ${s.type}${s.visual ? `, ${s.visual}` : ""}`)
    : ["- 0–2 s: the hook, big and immediate", `- 2–${length - 2} s: the problem, then ${name} solving it`, `- ${length - 2}–${length} s: the outcome and the call to action`];
  const head = variant === "general"
    ? `Vertical 9:16 video ad, ${length} seconds, for ${name}.`
    : variant === "gpt" ? `Make a ${length}-second vertical (9:16) video ad for ${name}${b.format === "Video ad" ? "" : `, in the style of a ${b.format.toLowerCase()}`}.` : `${b.format}, ${length} s, 9:16, for ${name}.`;
  return [
    head,
    "Copy the structure and pacing below; every person, product, screen and word is ours. Never show another brand.",
    b.hook ? `Hook: ${b.hook}.` : "",
    "Shots:",
    ...shots,
    `Message order: ${b.structure.join(" → ")}.`,
    c.headline ? `Spoken and on-screen message, in our words: ${quoted(c.headline)}${c.cta ? `, ending on ${quoted(c.cta)}` : ""}.` : "",
    ...appLines(app),
    b.vibe ? `Mood: ${b.vibe}.` : "",
    ...rulesLines(app),
  ].filter(Boolean).join("\n");
}

function generalImagePrompt(app: MakeApp, b: AdBlueprint): string {
  const c = copyLines(app);
  const what = app.does ? `for ${app.does.charAt(0).toLowerCase()}${app.does.slice(1)}` : "";
  const parts = [
    `${b.format.toLowerCase()} advertisement for an app called ${app.name || "the app"} ${what}`.trim(),
    b.mode === "still" ? "a single still frame in the style of a vertical video ad" : "",
    b.layout,
    b.hook ? b.hook.toLowerCase() : "",
    c.headline ? `headline text ${quoted(c.headline)}` : "",
    c.cta && b.hasCta ? `button text ${quoted(c.cta)}` : "",
    app.colors.length ? `color palette ${app.colors.map((x) => x.hex).join(" ")}` : "clean neutral palette with one accent color",
    app.fonts.length ? `${app.fonts[0].family} typography` : b.typography,
    b.vibe,
    app.tone ? `${app.tone.toLowerCase()} tone` : "",
    "crisp legible text, clean commercial design, high detail",
  ].map((s) => squash(s).replace(/[.]+$/, "")).filter(Boolean);
  return `${parts.join(", ")} --ar ${b.aspect} --style raw --no watermark, other brand logos`;
}

const fit = (s: string) => (s.length > PROMPT_MAX ? s.slice(0, PROMPT_MAX) : s);

/** The three prompts (and the one "Generate here" sends) for an ad and an app. `refs` says which images go with them. */
export function buildPrompts(src: RecreateSource, app: MakeApp, o: { mode?: "still" | "video"; refs?: Partial<RefPlan>; generateRefs?: Partial<RefPlan> } = {}): MakePrompts & { blueprint: AdBlueprint } {
  const b = blueprint(src, o.mode);
  const names = theirNames(src);
  // The last pass over each whole prompt takes out their names only (our own quoted lines and line breaks stay).
  const nameRes = names.filter((n) => !leaksOf(app.name, [n]).length && n.replace(/[^a-z0-9]/gi, "").length >= 3)
    .map((n) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?:'s)?(?![\\p{L}\\p{N}])`, "giu"));
  const clean = (text: string) => nameRes.reduce((t, re) => t.replace(re, "the brand"), text);
  const pasteRefs: RefPlan = { reference: true, logo: Boolean(app.logoUrl || app.iconUrl), screens: Math.min(3, app.screens.length || app.screenshots), ...o.refs };
  const genRefs: RefPlan = { reference: false, logo: false, screens: 0, ...o.generateRefs };
  const video = b.mode === "video";
  // Their names never survive: a last scrub of each whole prompt, then a check (the app's own name is left alone).
  const finish = (s: string) => fit(clean(s).replace(/the brand the brand/g, "the brand"));
  const out = {
    gpt: finish(video ? videoPrompt("gpt", app, b) : imagePrompt("gpt", app, b, pasteRefs)),
    higgsfield: finish(video ? videoPrompt("higgsfield", app, b) : imagePrompt("higgsfield", app, b, pasteRefs)),
    general: finish(video ? videoPrompt("general", app, b) : generalImagePrompt(app, b)),
    generate: finish(imagePrompt("higgsfield", app, { ...b, mode: video ? "still" : b.mode }, genRefs)),
  };
  const leaks = [...new Set(Object.values(out).flatMap((p) => leaksOf(p, names, app.name)))];
  const domain = src.linkUrl ? /^(?:https?:\/\/)?(?:www\.)?([^/\s?#]+)/i.exec(src.linkUrl)?.[1] ?? "" : "";
  return { ...out, blueprint: b, leaks, mustAvoid: cleanMustAvoid([...names, domain].filter((n) => n && n.toLowerCase() !== app.name.toLowerCase())) };
}

// MARK: Improve with AI

/** What the creatives backend's `prompt/improve` is told: rewrite more precisely, invent nothing. */
export function improveInstructions(app: MakeApp): string {
  return [
    "You rewrite image and video generation prompts for ads so a model follows them more precisely.",
    "Keep every fact, colour hex, font, quoted text and rule exactly as given. Make layout, composition, lighting and type instructions concrete and unambiguous.",
    "Never add a claim, number, rating, price, offer, testimonial or result that is not in the prompt. Never name another brand.",
    app.bannedWords.length ? `Never use these words: ${app.bannedWords.join(", ")}.` : "",
    app.forbiddenClaims.length ? `Never claim or imply: ${app.forbiddenClaims.join("; ")}.` : "",
    "Answer with the rewritten prompt and one short note on what you changed.",
  ].filter(Boolean).join("\n");
}

/** Words the improved prompt must not contain: their names and the brand's banned words. */
export const improveBlocklist = (app: MakeApp, mustAvoid: string[]) => cleanMustAvoid([...mustAvoid, ...app.bannedWords]);

/**
 * Numbers that read as a claim (twin of claimNumbers in supabase/functions/creatives/core/prompt_improve.ts):
 * a count of three digits or more that isn't a pixel size or a year, or a percentage followed by a claim
 * word ("50% faster"). Layout numbers ("8% margins", "1080 px") are fine.
 */
export function claimNumbers(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(/(\d[\d.,]*\d|\d)(\s*%)?(\s*(?:px|×|x\s*\d))?\s*([\p{L}]+(?:\s+[\p{L}]+)?)?/gu)) {
    const [, num, pct, px, after = ""] = m;
    if (px) continue;
    if (pct) { if (/^(?:off|faster|more|less|better|cheaper|of|save|savings|discount|users|people|success|accurate|guarantee)/i.test(after.trim())) out.add(`${num}%`); continue; }
    if (num.replace(/\D/g, "").length >= 3 && !/^(?:19|20)\d\d$/.test(num)) out.add(num);
  }
  return out;
}

/** Problems with an improved prompt: a blocked word, a forbidden claim, or a quoted line that wasn't in the original. */
export function improvedProblems(original: string, improved: string, app: MakeApp, mustAvoid: string[]): string[] {
  const problems: string[] = [];
  // A blocked word may be named in the rules ("Never use these words: cheap"): only more uses than the original had count.
  const uses = (text: string, word: string) => (text.match(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, "giu")) ?? []).length;
  for (const word of improveBlocklist(app, mustAvoid)) if (uses(improved, word) > uses(original, word)) problems.push(`uses "${word}"`);
  for (const claim of app.forbiddenClaims) if (claim.length > 6 && improved.toLowerCase().includes(claim.toLowerCase()) && !original.toLowerCase().includes(claim.toLowerCase())) problems.push(`claims "${claim}"`);
  const had = claimNumbers(original);
  const fresh = [...claimNumbers(improved)].filter((x) => !had.has(x));
  if (fresh.length) problems.push(`adds the number${fresh.length > 1 ? "s" : ""} ${fresh.slice(0, 3).join(", ")}`);
  return problems;
}

// MARK: Cost and sizes

export const MAKE_QUALITIES: ImageQuality[] = ["low", "medium", "high"];
export const MAKE_RESOLUTIONS: ImageResolution[] = ["1k", "2k", "4k"];
export const MAKE_ASPECTS: Aspect[] = ["9:16", "4:5", "1:1", "16:9"];

/**
 * What each provider can make here. Both make GPT Image 2.5 in the four Meta ratios; on OpenAI a quality
 * at a resolution this Supabase plan refuses (too slow for one run: creatives health `openaiImagePlan`)
 * is left out. The Higgsfield API makes 4:5 as 3:4 (Meta trims it), which the sheet says.
 */
export function providerSizes(provider: ImageProvider, plan?: OpenAiImagePlan | null): { aspects: Aspect[]; resolutions: ImageResolution[]; qualities: ImageQuality[]; refused: string[] } {
  if (provider === "higgsfield") return { aspects: MAKE_ASPECTS, resolutions: MAKE_RESOLUTIONS, qualities: MAKE_QUALITIES, refused: [] };
  const refused: string[] = [];
  const resolutions = MAKE_RESOLUTIONS.filter((r) => MAKE_QUALITIES.some((q) => openAiImageMode(plan, r, q) !== "refuse"));
  for (const r of MAKE_RESOLUTIONS) for (const q of MAKE_QUALITIES) if (openAiImageMode(plan, r, q) === "refuse") refused.push(`${q}@${r}`);
  return { aspects: MAKE_ASPECTS, resolutions, qualities: MAKE_QUALITIES, refused };
}

/** Whether a quality at a resolution can run on this provider. */
export const sizeAllowed = (provider: ImageProvider, plan: OpenAiImagePlan | null | undefined, resolution: string, quality: string) =>
  provider === "higgsfield" || openAiImageMode(plan, resolution, quality) !== "refuse";

export interface MakeCost { provider: ImageProvider; credits: number; usd: number; label: string }

/**
 * One generation's estimated cost: Higgsfield in credits (the Studio's price table), OpenAI in dollars
 * (its published prices, the reference images and the prompt included). The Studio's planner gives the
 * same figure for the same request (the batch route refuses one that moved).
 */
export function makeCost(o: { provider: ImageProvider; aspect: Aspect; resolution: ImageResolution; quality: ImageQuality; references?: number; promptChars?: number; count?: number }): MakeCost {
  const n = Math.max(1, Math.round(o.count ?? 1));
  if (o.provider === "openai") {
    const usd = Math.round(openAiImageUsd({ aspect: o.aspect, resolution: o.resolution, quality: o.quality, references: o.references ?? 0, promptChars: o.promptChars ?? 0 }) * n * 10_000) / 10_000;
    return { provider: "openai", credits: 0, usd, label: `${costLabel("openai", { usd })} at OpenAI` };
  }
  const credits = Math.round(jobCost("gpt_image_2_5", { quality: o.quality, resolution: o.resolution }) * n * 100) / 100;
  return { provider: "higgsfield", credits, usd: 0, label: `${costLabel("higgsfield", { credits })} at Higgsfield` };
}

export { fmtUsd };

// MARK: Generate here and Send to Studio

export interface MakeRequestInput {
  prompt: string;
  blueprint: AdBlueprint;
  provider: ImageProvider;
  aspect: Aspect;
  resolution: ImageResolution;
  quality: ImageQuality;
  /** Their image (stored copy or a preview link that still loads), https. */
  reference?: string | null;
  logo?: { url: string; label: string } | null;
  /** App screens among the product images, sent after the logo (at most 3). */
  screens?: string[];
  /** Send the brand kit's screenshots last. */
  screenshots: boolean;
  mustAvoid: string[];
}

const placementFor = (aspect: Aspect): PlacementId => PLACEMENTS.find((p) => p.aspect === aspect)?.id ?? "feed_vertical";

/**
 * The batch "Generate here" starts: one image, the prompt as written (it already carries the brand and
 * numbers the images), their ad as the style reference, our logo as a reference after it, the brand
 * kit's screenshots last. The same request shape the Studio and the Playground send.
 */
export function makeRequest(i: MakeRequestInput): BatchRequest {
  const reference = i.reference && /^https:\/\/\S+$/.test(i.reference) ? i.reference : null;
  const logo = i.logo && /^https:\/\/\S+$/.test(i.logo.url) ? i.logo : null;
  return {
    ...DEFAULT_REQUEST,
    brief: i.prompt.slice(0, PROMPT_MAX),
    kinds: ["image"],
    variants: 1,
    aspects: [i.aspect],
    placements: [placementFor(i.aspect)],
    format: "single",
    image: { ...DEFAULT_REQUEST.image, model: "gpt_image_2_5", quality: i.quality, resolution: i.resolution, useScreenshots: i.screenshots, provider: i.provider },
    mustAvoid: cleanMustAvoid(i.mustAvoid),
    ...(reference ? { styleReferences: [reference] } : {}),
    ...(i.screens?.length ? { productReferences: i.screens.filter((u) => /^https:\/\/\S+$/.test(u)).slice(0, 3).map((url) => ({ url, label: "App screen", kind: "app_screen" })) } : {}),
    logo: logo ? { url: logo.url, label: logo.label, reference: true, overlay: null, inBrief: true } : null,
    referencesInBrief: true,
    brandInBrief: true,
    useProfile: false,
    fromRecreate: true,
  };
}

/** How many images that request sends (their ad, our logo, the screenshots), for the OpenAI estimate. */
export const makeReferenceCount = (i: Pick<MakeRequestInput, "reference" | "logo" | "screenshots" | "screens">, screenshots: number) =>
  Math.min(16, (i.reference ? 1 : 0) + (i.logo ? 1 : 0) + Math.min(3, i.screens?.length ?? 0) + (i.screenshots ? Math.max(0, screenshots) : 0));

/**
 * The images "Generate here" sends and how the prompt numbers them: their image, our logo, then up to three
 * app screens (product images), else the brand kit's screenshots when there are three or fewer.
 */
export function generatePlan(app: MakeApp, reference: string | null): { refs: RefPlan; logo: { url: string; label: string } | null; screens: string[]; screenshots: boolean } {
  const logoUrl = app.logoUrl ?? app.iconUrl;
  const screens = app.screens.slice(0, 3);
  const screenshots = !screens.length && app.screenshots > 0 && app.screenshots <= 3;
  return {
    refs: { reference: Boolean(reference), logo: Boolean(logoUrl), screens: screens.length || (screenshots ? app.screenshots : 0) },
    logo: logoUrl ? { url: logoUrl, label: `${app.name || "Our"} logo` } : null,
    screens,
    screenshots,
  };
}

/** The Studio handoff for "Send to Studio": the prompt as the brief, where the person picks angles and sizes. */
export function makeHandoff(src: RecreateSource, b: AdBlueprint, prompt: string, mustAvoid: string[], reference: string | null): RecreateHandoff {
  const video = b.mode === "video";
  return {
    brief: prompt.trim().slice(0, PROMPT_MAX),
    placement: b.placement,
    kind: video ? "ai_video" : "image",
    ...(b.cards > 1 ? { cards: b.cards } : {}),
    mustAvoid: cleanMustAvoid(mustAvoid),
    reference: { adId: src.adId, pageName: src.competitor ?? src.pageName, libraryId: src.libraryId },
    ...(video ? { duration: b.duration ? Math.min(30, Math.max(5, b.duration)) : 10 } : {}),
    useScreenshots: true,
    ...(!video && reference && /^https:\/\//.test(reference) ? { styleReferences: [reference] } : {}),
  };
}

/** A provider's error, in plain words, with what to do (the job's stored error is shown as well). */
export function providerErrorText(error: string | null | undefined, provider: ImageProvider): string {
  const e = (error ?? "").toLowerCase();
  const name = provider === "openai" ? "OpenAI" : "Higgsfield";
  if (!e) return `${name} couldn't make it. Try again, or try the other provider.`;
  if (/429|rate.?limit|busy|too many|concurren/.test(e)) return `${name} is busy right now (too many requests). Wait a minute and retry, or switch provider.`;
  if (/credit|balance|insufficient|quota|billing|payment/.test(e)) return `${name} says the account is out of credits or over its limit. Top it up on ${name}'s site, then retry, or switch provider.`;
  if (/key|unauthori|401|403|invalid api/.test(e)) return `${name} didn't accept the key. Check it in Settings > API keys, then retry.`;
  if (/safety|policy|moderat|rejected|refus/.test(e)) return `${name} refused the prompt under its content rules. Edit the prompt (fewer claims, no people or brands) and retry.`;
  if (/storage is full|no room/.test(e)) return "Storage is full, so the result couldn't be saved. Free up space in Settings > Storage, then retry.";
  if (/timed? ?out|took longer|time limit/.test(e)) return `${name} took too long for this Supabase plan. Retry with a lower quality or resolution.`;
  return `${name} couldn't make it: ${cut(squash(error), 160)}`;
}

/**
 * "Improve with AI" is one short OpenAI text request on the person's own key. Its cost is shown before it
 * runs as an upper bound: the tokens in and out (about 4 characters a token, the answer as long as the
 * prompt) at $10 per million in and $40 per million out, above what OpenAI charges for its text models.
 */
export const IMPROVE_PRICE_CEILING = { usdPerMillionIn: 10, usdPerMillionOut: 40 } as const;
export function improveCostUsd(promptChars: number, instructionChars = 900): number {
  const tokensIn = Math.ceil((Math.max(0, promptChars) + Math.max(0, instructionChars)) / 4);
  const tokensOut = Math.ceil(Math.max(0, promptChars) / 4) + 200;
  return Math.round(((tokensIn * IMPROVE_PRICE_CEILING.usdPerMillionIn + tokensOut * IMPROVE_PRICE_CEILING.usdPerMillionOut) / 1e6) * 10_000) / 10_000;
}
