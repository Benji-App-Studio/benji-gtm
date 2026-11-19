// Winners → format cards. Picks each report's winning posts (and any paid ads the research agent
// found), then clusters near-identical winners (same source, medium, format, hook type and opening
// structure) into one card with every example and the evidence that it works. Pure and deterministic.
import type { Post, Report } from "../types";
import { FAMILIES, familyOf, HOOK_PATTERN } from "./families";
import type { Beat, CardPlatform, FormatCard, Line, Medium, PaidAd, PaidAdSeedRow, Winner } from "./types";

const NO_FORMAT = "no_clear_format";
/** A post must score at least this to count as a winner (the report's 0–100 best-content score). */
const MIN_SCORE = 55;
/** …or be at least this good with buyers in the comments. */
const MIN_SCORE_BUYERS = 40;
/** Paid ads running this long are winners whatever else we know. */
const MIN_PAID_DAYS = 21;

export const median = (values: number[]) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`;
const firstLine = (text: string) => (text.split("\n").find((l) => l.trim()) ?? "").trim();

export const lengthBucket = (sec: number | null) => sec == null ? null : sec < 15 ? "under 15s" : sec < 30 ? "15–30s" : sec < 60 ? "30–60s" : "60s+";

/** The winning posts of one report: per channel, the top quarter by score, plus any with buyers in the comments. */
export function winnersFromReport(report: Report, runId: string | null = null): Winner[] {
  const formats = new Map(report.formats.map((f) => [f.id, f]));
  const posts = report.reels.filter((p) => (p.onTopic == null || p.onTopic >= 0.5) && p.format && p.format !== NO_FORMAT);
  const out: Winner[] = [];
  for (const platform of new Set(posts.map((p) => p.platform))) {
    const ranked = posts.filter((p) => p.platform === platform).sort((a, b) => b.score - a.score);
    const top = new Set(ranked.slice(0, Math.max(3, Math.ceil(ranked.length / 4))).map((p) => p.id));
    for (const post of ranked) {
      const buyers = (post.buyerIntent ?? 0) >= 0.6;
      if (!((top.has(post.id) && post.score >= MIN_SCORE) || (buyers && post.score >= MIN_SCORE_BUYERS))) continue;
      out.push(fromPost(post, formats.get(post.format!), runId));
    }
  }
  return out;
}

function fromPost(post: Post, format: { name: string; description: string } | undefined, runId: string | null): Winner {
  const text = post.platform === "x" || post.platform === "linkedin";
  return {
    id: post.id, source: "organic", platform: post.platform, medium: text ? "text" : "video", url: post.url, account: post.account,
    thumb: post.thumb, postedAt: post.postedAt, formatId: post.format!, formatName: format?.name ?? post.format!.replace(/_/g, " "),
    formatDescription: format?.description ?? "", hookType: post.hookType, hookLine: (post.script[0]?.text ?? firstLine(post.caption)).slice(0, 220),
    script: post.script, caption: post.caption, hashtags: post.hashtags ?? post.caption.match(/#[\p{L}\p{N}_]+/gu)?.map((h) => h.slice(1)) ?? [],
    durationSec: post.durationSec, views: post.views, score: post.score, outlier: post.outlier, buyerIntent: post.buyerIntent,
    daysRunning: null, hasCta: post.hasCta, reasons: post.reasons, runId,
  };
}

/** Paid ads become winners when they've run long enough (or the research agent scored them well). */
export function winnersFromPaidAds(ads: PaidAd[]): Winner[] {
  return ads.flatMap((ad) => {
    const days = ad.daysRunning ?? (ad.startedAt ? Math.max(0, ((ad.lastSeenAt ? Date.parse(ad.lastSeenAt) : Date.now()) - Date.parse(ad.startedAt)) / 86_400_000) : null);
    const score = ad.score ?? Math.min(100, Math.round(40 + (days ?? 0) * 0.8 + (ad.variants ?? 1) * 3));
    if (!ad.curated && (days ?? 0) < MIN_PAID_DAYS && score < MIN_SCORE) return [];
    const script: Line[] = ad.transcript?.length ? ad.transcript
      : [ad.headline, ...ad.body.split(/(?<=[.!?])\s+|\n+/)].filter((t): t is string => Boolean(t?.trim())).slice(0, 12)
        .map((t, i) => ({ text: t.trim(), role: i === 0 ? "hook" : null, visual: null }));
    const formatId = ad.format ?? (ad.medium === "video" ? "ai_ugc" : "static_benefit");
    return [{
      id: ad.id, source: "paid" as const, curated: ad.curated, platform: ad.platform, medium: ad.medium === "video" ? "video" as const : "image" as const, url: ad.url,
      account: ad.advertiser, thumb: ad.thumb ?? null, postedAt: ad.startedAt ?? null, formatId, formatName: ad.formatName ?? AD_FORMAT_NAME[formatId] ?? formatId.replace(/_/g, " "),
      formatDescription: "", hookType: ad.hookType ?? null, hookLine: (script[0]?.text ?? ad.headline ?? "").slice(0, 220), script,
      caption: [ad.headline, ad.body].filter(Boolean).join("\n"), hashtags: [], durationSec: ad.durationSec ?? null, views: ad.reach ?? null, score,
      outlier: null, buyerIntent: null, daysRunning: days == null ? null : Math.round(days), hasCta: Boolean(ad.cta) || script.some((l) => l.role === "cta"),
      reasons: [days != null ? `running ${Math.round(days)} days` : "", ad.variants && ad.variants > 1 ? `${ad.variants} variations live` : ""].filter(Boolean), runId: null,
    }];
  });
}

/** Paid-ad format names (the research engine's AD_FORMATS), for seeds that only carry the id. */
const AD_FORMAT_NAME: Record<string, string> = {
  hook_demo: "hook + app/product demo", static_benefit: "static image: benefit headline", reddit_style: "Reddit-style post",
  tweet_style: "tweet-style screenshot", ai_ugc: "AI / actor UGC", before_after: "before / after", us_vs_them: "us vs them comparison",
  quiz_funnel: "quiz / result reveal", testimonial_review: "reviews / social proof", green_screen: "green screen over proof",
  founder_story: "founder / expert to camera",
};

/**
 * Ads someone sent to the library from Research → Ads (`paid_ads` rows with `sent_to_library_at`),
 * as PaidAds. Their `library_seed` carries Jev's decode (format, hook, each line's job); without one
 * the ad's own copy is the script.
 */
export function paidAdsFromSeeds(rows: PaidAdSeedRow[]): PaidAd[] {
  return rows.map((row) => {
    const seed = row.library_seed;
    const network = seed?.network ?? row.network;
    const format = seed?.format ?? null;
    const media = seed?.mediaType ?? row.media_type;
    return {
      id: row.id, platform: network === "tiktok" ? "tiktok_ads" : "meta_ads",
      url: seed?.snapshotUrl ?? row.snapshot_url ?? (network === "meta" ? `https://www.facebook.com/ads/library/?id=${encodeURIComponent(row.ad_id)}` : `https://library.tiktok.com/ads/detail/?ad_id=${encodeURIComponent(row.ad_id)}`),
      advertiser: seed?.competitor ?? row.competitor ?? row.page_name,
      medium: media === "video" ? "video" : media === "carousel" ? "carousel" : "image",
      body: row.body, headline: row.headline || seed?.hook || null, cta: seed?.cta || row.cta || null, thumb: seed?.thumb ?? row.thumb,
      startedAt: row.started_at, lastSeenAt: row.stopped_at ?? row.last_seen_at, daysRunning: seed?.daysRunning ?? null,
      variants: seed?.variants ?? row.variants,
      transcript: seed?.structure.length ? seed.structure.map((l, i) => ({ text: l.text, role: i === 0 ? "hook" : l.role, visual: l.visual ?? null })) : null,
      format, formatName: format ? AD_FORMAT_NAME[format] ?? format.replace(/_/g, " ") : null, hookType: seed?.hookType ?? null,
      curated: true,
    };
  });
}

/** The jobs a script does in order, repeats folded: hook first, filler ("other") dropped. */
export function shapeOf(script: Line[]): string[] {
  const roles = script.map((l, i) => (i === 0 ? "hook" : l.role)).filter((r): r is string => Boolean(r) && r !== "other");
  return roles.filter((role, i) => role !== roles[i - 1]);
}

/** The script as beats: consecutive lines with the same job form one, timed as a share of the runtime. */
export function beatsOf(script: Line[], durationSec: number | null): Beat[] {
  const beats: { role: string; from: number | null; to: number | null; lines: number; visuals: string[] }[] = [];
  script.forEach((line, i) => {
    const role = i === 0 ? "hook" : line.role ?? "other";
    const last = beats[beats.length - 1];
    const next = script[i + 1]?.start ?? durationSec ?? null;
    if (last && (last.role === role || role === "other")) { last.lines++; last.to = next; if (line.visual) last.visuals.push(line.visual); }
    else beats.push({ role, from: line.start ?? null, to: next, lines: 1, visuals: line.visual ? [line.visual] : [] });
  });
  const timed = beats.every((b) => b.from != null && b.to != null && b.to >= b.from);
  const total = timed ? beats.reduce((n, b) => n + (b.to! - b.from!), 0) : beats.reduce((n, b) => n + b.lines, 0);
  return beats.map((b) => ({
    role: b.role,
    share: total ? (timed ? b.to! - b.from! : b.lines) / total : 1 / beats.length,
    visual: mostCommon(b.visuals),
  }));
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const STOP = new Set("the a an and or but if of to in on for with at by from is are was were be been it this that these those you your i my me we our they their he she his her them as so do does did not no just than then there here what when how why who which all any can will would should could about into over more most very really get got have has had its it's i'm you're dont don't".split(" "));

/** What a cluster's winners are about: hashtags first, then frequent words from hooks and captions. */
function topicsOf(winners: Winner[]): string[] {
  const counts = new Map<string, number>();
  const add = (word: string, weight: number) => {
    const w = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) return;
    counts.set(w, (counts.get(w) ?? 0) + weight);
  };
  for (const w of winners) {
    w.hashtags.forEach((h) => add(h, 2));
    `${w.hookLine} ${firstLine(w.caption)}`.split(/\s+/).forEach((word) => add(word, 1));
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);
}

// A hand-picked ad is its own card: undecoded ones share a guessed format, and folding them into one
// card made every ad sent after the first look like it never arrived.
const keyOf = (w: Winner) => (w.curated ? ["paid", "ad", w.id] : [w.source, w.medium, w.formatId, w.hookType ?? "other"]).join("|");

/**
 * Clusters winners into cards: winners with the same source, medium, format and hook type are the
 * same format (Jev's per-line roles are too noisy to split on), so they share one card with every
 * example. The card's structure is its best fully-scripted example's.
 */
export function clusterWinners(winners: Winner[]): FormatCard[] {
  const groups = new Map<string, Winner[]>();
  for (const w of winners) groups.set(keyOf(w), [...(groups.get(keyOf(w)) ?? []), w]);
  return [...groups.entries()].map(([key, list]) => toCard(key, list)).sort((a, b) => b.rank - a.rank);
}

function toCard(key: string, list: Winner[]): FormatCard {
  const ranked = [...list].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  // The template: the best example whose script has at least three beats (silent posts have one line).
  const model = ranked.find((w) => shapeOf(w.script).length >= 3) ?? best;
  const platforms = [...new Set(ranked.map((w) => w.platform))] as CardPlatform[];
  const platformCounts = new Map<CardPlatform, number>();
  for (const w of ranked) platformCounts.set(w.platform, (platformCounts.get(w.platform) ?? 0) + 1);
  const platform = [...platformCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const views = ranked.flatMap((w) => (w.views == null ? [] : [w.views]));
  const outliers = ranked.flatMap((w) => (w.outlier == null ? [] : [w.outlier]));
  const intents = ranked.flatMap((w) => (w.buyerIntent == null ? [] : [w.buyerIntent]));
  const days = ranked.flatMap((w) => (w.daysRunning == null ? [] : [w.daysRunning]));
  const durations = ranked.flatMap((w) => (w.durationSec == null ? [] : [w.durationSec]));
  const medium: Medium = best.medium;
  const lengthSec = durations.length ? Math.round(median(durations)) : null;
  const words = medium === "video" ? null : Math.round(median(ranked.map((w) => w.caption.split(/\s+/).filter(Boolean).length)));
  const reasons = [...new Set(ranked.flatMap((w) => w.reasons))].slice(0, 4);
  const evidence = {
    examples: ranked.length,
    medianViews: views.length ? median(views) : null,
    bestViews: views.length ? Math.max(...views) : null,
    medianScore: Math.round(median(ranked.map((w) => w.score))),
    bestScore: best.score,
    maxOutlier: outliers.length ? Math.max(...outliers) : null,
    buyerIntent: intents.length ? median(intents) : null,
    daysRunning: days.length ? Math.max(...days) : null,
    reasons,
  };
  const why = [
    ranked.length > 1 ? `${ranked.length} separate winners use this format` : `A single standout winner (score ${best.score})`,
    evidence.medianViews != null ? `typical ${fmt(evidence.medianViews)} views${evidence.bestViews && ranked.length > 1 ? `, best ${fmt(evidence.bestViews)}` : ""}` : "",
    evidence.maxOutlier != null && evidence.maxOutlier >= 1.5 ? `up to ${evidence.maxOutlier.toFixed(1)}× its creator's usual views` : "",
    evidence.buyerIntent != null && evidence.buyerIntent >= 0.5 ? `buyers in the comments (${Math.round(evidence.buyerIntent * 100)}% intent)` : "",
    evidence.daysRunning != null ? `paid ad running ${evidence.daysRunning} days (advertisers keep paying for what converts)` : "",
    ...reasons.filter((r) => !/views a day|typical/.test(r)).slice(0, 2),
  ].filter(Boolean);
  // Silent, caption-only or undecoded winners don't show their job order: use the format's usual one.
  const family = familyOf(best.formatId, best.formatName, best.formatDescription);
  const shape = shapeOf(model.script);
  const fromWinners = new Set(shape).size >= 3;
  const structure = fromWinners ? shape : FAMILIES[family].beats;
  return {
    key, source: best.source, medium, platform, platforms,
    formatType: best.formatId, formatName: best.formatName, formatDescription: best.formatDescription,
    family,
    hookType: best.hookType, hookLine: best.hookLine, hookPattern: HOOK_PATTERN[best.hookType ?? "other"] ?? HOOK_PATTERN.other,
    structure, structureSource: fromWinners ? "winners" : "format",
    beats: fromWinners ? beatsOf(model.script, model.durationSec) : structure.map((role, i) => ({ role, share: 1 / structure.length, visual: i === 0 ? model.script[0]?.visual ?? null : null })),
    lengthSec, lengthBucket: lengthBucket(lengthSec), words,
    ctaShare: ranked.filter((w) => w.hasCta).length / ranked.length,
    topics: topicsOf(ranked),
    evidence, why,
    examples: ranked.slice(0, 12).map((w) => ({
      id: w.id, source: w.source, platform: w.platform, url: w.url, account: w.account, thumb: w.thumb, hook: w.hookLine, views: w.views,
      score: w.score, outlier: w.outlier, buyerIntent: w.buyerIntent, daysRunning: w.daysRunning, postedAt: w.postedAt, runId: w.runId,
    })),
    // Rank: how good the best one is, how good they are typically, how many agree, and conversion signals.
    rank: Math.round(best.score * 0.5 + evidence.medianScore * 0.3 + Math.min(ranked.length, 5) * 4 + (evidence.buyerIntent ?? 0) * 10 + Math.min(evidence.daysRunning ?? 0, 90) / 6),
  };
}

/** Cards for a workspace from all its reports and paid ads (later reports' duplicates of a post are dropped). */
export function buildFormatCards(input: { reports: { runId: string | null; report: Report }[]; paidAds?: PaidAd[] }): FormatCard[] {
  const seen = new Set<string>();
  const winners = [
    ...input.reports.flatMap(({ runId, report }) => winnersFromReport(report, runId)),
    ...winnersFromPaidAds(input.paidAds ?? []),
  ].filter((w) => (seen.has(`${w.platform}:${w.id}`) ? false : (seen.add(`${w.platform}:${w.id}`), true)));
  return clusterWinners(winners);
}

/** One post as a single-example card (the report's "Recreate for my app"). */
export function cardFromPost(post: Post, report: Pick<Report, "formats">): FormatCard {
  const format = report.formats.find((f) => f.id === post.format);
  const winner = fromPost({ ...post, format: post.format && post.format !== NO_FORMAT ? post.format : "explainer" }, format, null);
  return toCard(keyOf(winner), [winner]);
}
