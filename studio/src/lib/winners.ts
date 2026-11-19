// Research → Our ads → "More like our winners": our own longest-running ads of one kind (statics or
// videos), ranked by how far they beat their age curve (lib/research.ts outperformsBy), become a Studio
// brief: what they share (format, hook, proof, offer, CTA and layout, from Jev's read and the AI scan),
// their images as style references (a video's key frames or poster) and their offer wording, word for
// word. Unlike Recreate, the ads are ours: the brand in them stays, and only their hook lines must not
// be reused (a clone of a live winner's hook competes with it). The Studio gets it as a handoff in
// sessionStorage (WINNERS_KEY), read by the batch form (`?from=winners`). Plain TypeScript (browser, Node tests).
import { DEFAULT_REQUEST, LIMITS, STYLE_REFERENCES, cleanStyleReferences, type BatchRequest } from "./creative-plan";
import { AD_FORMAT_LABEL, CTA_TYPE_LABEL, daysRunning, fitFor, LONG_RUNNER_DAYS, outperformsBy, type PaidAdRow, type RankFit } from "./research";
import { isVideoAd } from "./recreate";
import { WINNERS_HANDOFF_KEY } from "./storage-keys";
import { HOOK_LABEL } from "./types";

export type WinnerKind = "static" | "video";
/** sessionStorage key of the handoff. Read it with readStored (lib/storage-keys.ts). */
export const WINNERS_KEY = WINNERS_HANDOFF_KEY;
/** Winners one brief is built from. */
export const WINNERS_MAX = 5;

export const WINNER_KIND_LABEL: Record<WinnerKind, { one: string; many: string }> = { static: { one: "static", many: "statics" }, video: { one: "video", many: "videos" } };

export const winnerKindOf = (ad: Pick<PaidAdRow, "media_type" | "media" | "is_video">): WinnerKind => (isVideoAd(ad.media_type, ad.media ?? [], ad.is_video) ? "video" : "static");

export interface Winner { ad: PaidAdRow; days: number; beats: number | null }

/**
 * Our own live ads of one kind, long runners first (LONG_RUNNER_DAYS+; the longest-running ones when
 * none is that old), ranked by how far they beat their age curve, then by days running. One per creative.
 */
export function pickWinners(ads: PaidAdRow[], kind: WinnerKind, o: { fits?: Map<string, RankFit> | null; now?: number; max?: number } = {}): Winner[] {
  const now = o.now ?? Date.now();
  const mine = ads
    .filter((ad) => ad.is_own && ad.active && ad.media_type !== "text" && winnerKindOf(ad) === kind)
    .map((ad) => ({ ad, days: daysRunning(ad, now) ?? 0, beats: outperformsBy(ad, fitFor(o.fits, ad), now) }));
  const long = mine.filter((w) => w.days >= LONG_RUNNER_DAYS);
  const pool = long.length ? long : mine;
  const seen = new Set<string>();
  return pool
    .sort((a, b) => (b.beats ?? -Infinity) - (a.beats ?? -Infinity) || b.days - a.days)
    .filter((w) => {
      const key = w.ad.creative_key ?? w.ad.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, o.max ?? WINNERS_MAX);
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const quote = (s: string) => `"${clip(squash(s), 140)}"`;
const uniq = (list: (string | null | undefined)[]) => {
  const out: string[] = [];
  for (const raw of list) {
    const s = squash(raw ?? "");
    // The same line with or without its full stop is one line.
    const key = (x: string) => x.toLowerCase().replace(/[.!…\s]+$/, "");
    if (s && !out.some((o) => key(o) === key(s))) out.push(s);
  }
  return out;
};

/** "Reviews / social proof (3 of 4), Silent text (1 of 4)": the most common first. */
function tally(values: (string | null | undefined)[], label: (v: string) => string, total: number): string {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, n]) => `${label(v)} (${n} of ${total})`).join(", ");
}

const OFFER = /(\$\s?\d|€\s?\d|£\s?\d|\d+\s?%|\bfree\b|\btrial\b|\boff\b|first month|\/mo\b|per month|save\b|discount|deal\b|guarantee)/i;

/** Their offer wording, verbatim: price and offer lines from the scan (on-image text and flags), then copy lines that state one. */
export function offerWording(ads: PaidAdRow[]): string[] {
  const lines: string[] = [];
  for (const ad of ads) {
    for (const t of ad.scan?.on_image_text ?? []) if (t.role === "price" || (t.role !== "legal" && OFFER.test(t.text))) lines.push(t.text);
    for (const f of ad.scan?.flags ?? []) if (f.kind === "price_or_offer") lines.push(f.text);
    for (const field of [ad.headline, ad.description, ...(ad.body ?? "").split(/\n+|(?<=[.!?])\s+/)]) if (field && OFFER.test(field) && field.length <= 140) lines.push(field);
  }
  return uniq(lines).slice(0, 4);
}

/** Their opening lines: a video's spoken or on-screen hook, else the read's hook line, else the copy's first line. */
function hookLines(ads: PaidAdRow[]): string[] {
  return uniq(ads.map((ad) => ad.scan?.video?.hook?.line
    || ad.decoded?.roles.find((r) => r.role === "hook")?.text
    || ad.scan?.on_image_text.find((t) => t.role === "headline")?.text
    || (ad.body ?? "").split("\n").map((l) => l.trim()).find(Boolean))).slice(0, 4);
}

/** The images that go along: one per ad first (a static's own image, a video's first key frame or poster), then more. */
export function winnerImages(ads: PaidAdRow[], max = STYLE_REFERENCES): string[] {
  const perAd = ads.map((ad) => {
    const frames = (ad.scan?.video?.frames ?? []).map((f) => f.url);
    const images = (ad.media ?? []).filter((m) => m.type === "image").map((m) => m.url);
    const posters = [ad.thumb, ...(ad.media ?? []).map((m) => m.thumb)];
    return cleanStyleReferences([...(winnerKindOf(ad) === "video" ? [...frames, ...posters] : [...images, ...posters])].filter(Boolean));
  });
  const out: string[] = [];
  for (let round = 0; out.length < max && perAd.some((list) => list.length > round); round++) {
    for (const list of perAd) if (list[round] && !out.includes(list[round]) && out.length < max) out.push(list[round]);
  }
  return out;
}

export interface WinnersBrief { brief: string; styleReferences: string[]; offers: string[] }

/** The brief: what the winners share, their images as references, their offer wording, and a new hook. */
export function winnersBrief(winners: Winner[], kind: WinnerKind, appName: string): WinnersBrief {
  const ads = winners.map((w) => w.ad);
  const n = ads.length;
  const k = WINNER_KIND_LABEL[kind];
  const days = winners.map((w) => w.days);
  const best = Math.max(...winners.map((w) => w.beats ?? -Infinity));
  const offers = offerWording(ads);
  const styleReferences = winnerImages(ads);
  const roleLines = (role: string) => uniq(ads.flatMap((ad) => (ad.decoded?.roles ?? []).filter((r) => r.role === role).map((r) => r.text))).slice(0, 3);
  const ctas = tally(ads.map((ad) => ad.library?.ctaType ? CTA_TYPE_LABEL[ad.library.ctaType] ?? ad.cta : ad.cta), (v) => v, n);
  const layouts = uniq(ads.map((ad) => ad.scan?.style?.layout)).slice(0, 2);
  const typography = uniq(ads.map((ad) => ad.scan?.typography ?? ad.scan?.style?.typography)).slice(0, 1);
  const density = tally(ads.map((ad) => ad.scan?.style?.text_density), (v) => v, n);
  const structure = uniq(ads.map((ad) => ad.scan?.video?.structure)).slice(0, 2);
  const pacing = uniq(ads.map((ad) => ad.scan?.video?.pacing)).slice(0, 1);
  const captions = uniq(ads.map((ad) => ad.scan?.video?.captions_style)).slice(0, 1);
  const lengths = ads.map((ad) => ad.scan?.video?.duration_sec ?? ad.creative?.media?.find((m) => m.duration_sec)?.duration_sec).filter((d): d is number => Boolean(d));
  const hooks = hookLines(ads);
  const line = (label: string, value: string | string[]) => {
    const text = Array.isArray(value) ? value.filter(Boolean).join("; ") : value;
    return text ? `- ${label}: ${text}` : "";
  };
  const lines = [
    `MORE LIKE OUR WINNERS: a new ${kind === "static" ? "static image ad" : "short video ad"} for ${appName}, built on what our ${n} longest-running ${n === 1 ? k.one : k.many} share (live ${Math.min(...days)}–${Math.max(...days)} days${Number.isFinite(best) && best > 0 ? `; the strongest ranks ${best} places better than its age predicts` : ""}).`,
    "SHARED STRUCTURE:",
    line("Format", tally(ads.map((ad) => ad.decoded?.format), (v) => AD_FORMAT_LABEL[v] ?? v, n)),
    line("Hook", tally(ads.map((ad) => ad.decoded?.hookType), (v) => HOOK_LABEL[v] ?? v, n)),
    hooks.length ? `- Their opening lines (for the spirit only; write a NEW hook, never one of these): ${hooks.map(quote).join("; ")}` : "",
    line("Proof", roleLines("proof").map(quote)),
    line("Mechanism", roleLines("method").map(quote)),
    line("CTA", [ctas, ...roleLines("cta").map(quote)].filter(Boolean)),
    kind === "static" ? line("Layout", layouts) : "",
    kind === "static" ? line("Type", typography) : "",
    kind === "static" ? line("Text density", density) : "",
    kind === "video" ? line("Beats", structure) : "",
    kind === "video" ? line("Pacing", pacing) : "",
    kind === "video" ? line("Captions", captions) : "",
    kind === "video" && lengths.length ? line("Length", `${Math.round(Math.min(...lengths))}–${Math.round(Math.max(...lengths))} s`) : "",
    offers.length ? `OFFER, word for word (only these): ${offers.map(quote).join("; ")}` : "",
    styleReferences.length ? `REFERENCE IMAGES: ${refsLine(styleReferences.length, kind)} Follow their ${kind === "video" ? "framing, shots and on-screen text style" : "layout, type and composition"}; our brand in them stays exactly as it is. Make a new ad, not a copy of any one of them.` : "",
  ].filter(Boolean);
  // Every quoted line is clipped and every list capped, so this stays well inside the Studio's brief limit.
  return { brief: lines.join("\n").slice(0, LIMITS.briefChars), styleReferences, offers };
}

/** "attached images 1–3 are our own winning statics." */
function refsLine(count: number, kind: WinnerKind): string {
  const what = kind === "video" ? "stills from our own winning videos" : count > 1 ? "our own winning statics" : "one of our own winning statics";
  return `attached image${count > 1 ? `s 1–${count} are` : " 1 is"} ${what}.`;
}

// MARK: Handoff to the Studio

export interface WinnersHandoff {
  kind: WinnerKind;
  brief: string;
  styleReferences: string[];
  offers: string[];
  /** The winners it was built from (paid_ads ids) and their Page. */
  adIds: string[];
  pageName: string;
}

export function buildWinnersHandoff(winners: Winner[], kind: WinnerKind, appName: string): WinnersHandoff | null {
  if (!winners.length) return null;
  const b = winnersBrief(winners, kind, appName);
  return { kind, brief: b.brief, styleReferences: b.styleReferences, offers: b.offers, adIds: winners.map((w) => w.ad.id), pageName: winners[0].ad.competitor ?? winners[0].ad.page_name };
}

/** A handoff read back from sessionStorage, checked field by field; null when it isn't one. */
export function readWinners(raw: unknown): WinnersHandoff | null {
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const kind = v.kind === "static" || v.kind === "video" ? v.kind : null;
  const brief = typeof v.brief === "string" ? v.brief.trim().slice(0, LIMITS.briefChars) : "";
  if (!kind || !brief) return null;
  const strings = (x: unknown, n: number, max: number) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").map((s) => s.slice(0, max)).slice(0, n) : []);
  return {
    kind, brief,
    styleReferences: cleanStyleReferences(v.styleReferences),
    offers: strings(v.offers, 4, 200),
    adIds: strings(v.adIds, WINNERS_MAX, 64),
    pageName: typeof v.pageName === "string" ? v.pageName.slice(0, 120) : "",
  };
}

/** The Studio's batch request from a handoff: statics as image ads (4:5 and 9:16), videos as AI videos following the frames. */
export function requestFromWinners(h: WinnersHandoff, base: BatchRequest = DEFAULT_REQUEST): BatchRequest {
  const next: BatchRequest = {
    ...base, brief: h.brief, format: "single", variants: base.variants,
    kinds: h.kind === "static" ? ["image"] : ["ai_video"],
    placements: h.kind === "static" ? ["feed_vertical", "stories_reels"] : ["stories_reels"],
    // The brief numbers the attached images itself (REFERENCE IMAGES), so the Studio adds no line of its own.
    ...(h.styleReferences.length ? { styleReferences: h.styleReferences, referencesInBrief: true } : {}),
  };
  return next;
}
