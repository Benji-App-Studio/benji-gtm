// Joins posts, Jev's answers and the formats into a run's report: every post scored (the "best UGC"
// score and its reasons), channels summarised (each platform and account, with hit rates and their
// best post), a per-channel playbook, what the audience says in the comments, and creators worth
// working with. Pure: the CLI writes the result to data.json, the edge worker stores it in Postgres.
import { NO_FORMAT } from "./formats.ts";
import type { PartnerProgram } from "./partners.ts";
import { JEV_USD_PER_INPUT_TOKEN, median, type Decoded, type Format, type Reel, type Status, type Workflow } from "./types.ts";

export interface BuildInput {
  slug: string;
  workflow: Workflow;
  reels: Reel[];
  decoded: Decoded[];
  formats: Format[];
  status: Status | null;
  /** Partnership detection's result, when the run had it on. */
  partners?: PartnerProgram[];
}

const DAY = 86_400_000;
/** A reel "hits" when it gets at least twice the run's typical views. */
const HIT = 2;

/** Each value's percentile (0–1) among the non-null values. */
function percentiles(values: (number | null)[]): (number | null)[] {
  const sorted = values.filter((v): v is number => v != null).sort((a, b) => a - b);
  if (sorted.length < 2) return values.map((v) => (v == null ? null : 0.5));
  return values.map((v) => {
    if (v == null) return null;
    let below = 0;
    while (below < sorted.length && sorted[below] < v) below++;
    return below / (sorted.length - 1);
  });
}

const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`;
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export function buildReport(input: BuildInput) {
  const reels = input.reels.map((reel) => ({ ...reel, platform: reel.platform ?? "instagram" }));
  const decoded = new Map(input.decoded.map((entry) => [entry.id, entry]));
  const formats = input.formats;
  const status = input.status;
  const workflow = input.workflow;
  const typical = median(reels.map((reel) => reel.views));
  const jevUsd = (status?.jevInputTokens ?? 0) * JEV_USD_PER_INPUT_TOKEN;
  const collectedAt = status?.collectedAt ? Date.parse(status.collectedAt) : Date.now();

  // Each creator's typical views on each platform, once they have enough reels to judge.
  const byCreator = new Map<string, number[]>();
  for (const reel of reels) byCreator.set(`${reel.platform}:${reel.owner}`, [...(byCreator.get(`${reel.platform}:${reel.owner}`) ?? []), reel.views]);
  const creatorTypical = (reel: Reel) => {
    const views = byCreator.get(`${reel.platform}:${reel.owner}`) ?? [];
    return views.length >= 3 ? median(views) : null;
  };

  const rows = reels.map((reel) => {
    const answer = decoded.get(reel.id);
    const ageDays = reel.postedAt ? Math.max(1, (collectedAt - Date.parse(reel.postedAt)) / DAY) : null;
    const baseline = creatorTypical(reel);
    const roles = answer?.roles ?? [];
    const productAt = roles.findIndex((line) => line.role === "product");
    return {
      id: reel.id, platform: reel.platform, url: reel.url, owner: reel.owner, account: reel.account ?? `@${reel.owner}`,
      caption: reel.caption, source: reel.source,
      views: reel.views, likes: reel.likes, comments: reel.comments, shares: reel.shares ?? null, saves: reel.saves ?? null,
      followers: reel.followers ?? null,
      likesPer1k: reel.views ? (reel.likes / reel.views) * 1000 : 0,
      commentsPer1k: reel.views ? (reel.comments / reel.views) * 1000 : 0,
      // Comments, shares and saves signal more intent than a like, so they weigh more.
      engagementPer1k: reel.views ? ((reel.likes + 3 * reel.comments + 5 * (reel.shares ?? 0) + 5 * (reel.saves ?? 0)) / reel.views) * 1000 : 0,
      durationSec: reel.durationSec, postedAt: reel.postedAt, thumb: reel.thumb,
      multiple: typical ? reel.views / typical : 0,
      creatorTypical: baseline,
      outlier: baseline ? reel.views / baseline : null,
      viewsPerDay: ageDays ? reel.views / ageDays : null,
      viewsPerFollower: reel.followers ? reel.views / reel.followers : null,
      format: answer?.format ?? null,
      formatConfidence: answer?.formatConfidence ?? null,
      hookType: answer?.hookType ?? null,
      commentList: answer?.comments ?? (reel.topComments ?? []).map((text) => ({ text, theme: null as string | null })),
      hashtags: reel.hashtags ?? [],
      niche: Boolean(reel.niche),
      partnerOf: reel.partnerOf ?? null,
      paidPartnership: Boolean(reel.paidPartnership),
      coauthors: reel.coauthors ?? [],
      taggedUsers: reel.taggedUsers ?? [],
      mentions: reel.mentions ?? [],
      buyerIntent: answer?.buyerIntent ?? null,
      mentionsProduct: answer?.mentionsProduct ?? null,
      onTopic: answer?.onTopic ?? null,
      hasCta: roles.some((line) => line.role === "cta"),
      brandMoment: productAt < 0 ? null : { sentence: productAt + 1, of: roles.length, start: roles[productAt].start ?? null },
      script: answer?.roles ?? reel.transcript.map((segment) => ({ ...segment, role: null, confidence: null })),
      score: 0,
      reasons: [] as string[],
    };
  });

  // The best-UGC score: how far a reel beat expectations, from several angles, as a 0–100 blend of
  // percentiles. Missing signals (no follower count, too few reels for a creator baseline) drop out.
  const signals = {
    outlier: { weight: 0.3, values: percentiles(rows.map((r) => r.outlier ?? r.multiple)) },
    velocity: { weight: 0.25, values: percentiles(rows.map((r) => r.viewsPerDay)) },
    engagement: { weight: 0.2, values: percentiles(rows.map((r) => r.engagementPer1k)) },
    reach: { weight: 0.15, values: percentiles(rows.map((r) => r.views)) },
    perFollower: { weight: 0.1, values: percentiles(rows.map((r) => r.viewsPerFollower)) },
    // Buying intent in the comments: the closest public signal to conversion.
    intent: { weight: 0.2, values: percentiles(rows.map((r) => r.buyerIntent)) },
  };
  rows.forEach((row, index) => {
    let total = 0, weight = 0;
    for (const signal of Object.values(signals)) {
      const value = signal.values[index];
      if (value == null) continue;
      total += value * signal.weight;
      weight += signal.weight;
    }
    row.score = weight ? Math.round((total / weight) * 100) : 0;
    const reasons: [number, string][] = [];
    if (row.outlier != null && row.outlier >= 1.5) reasons.push([row.outlier, `${row.outlier.toFixed(1)}× its creator's typical`]);
    else if (row.multiple >= 2) reasons.push([row.multiple / 2, `${row.multiple.toFixed(1)}× the typical reel here`]);
    if ((signals.velocity.values[index] ?? 0) >= 0.85 && row.viewsPerDay) reasons.push([3, `${fmt(row.viewsPerDay)} views a day`]);
    if ((signals.engagement.values[index] ?? 0) >= 0.85) reasons.push([2.5, `strong engagement (${Math.round(row.engagementPer1k)}/1k)`]);
    if (row.viewsPerFollower != null && row.viewsPerFollower >= 1) reasons.push([row.viewsPerFollower, `${row.viewsPerFollower.toFixed(1)} views per follower`]);
    if (row.buyerIntent != null && row.buyerIntent >= 0.6) reasons.push([4, "buyers in the comments"]);
    if (row.brandMoment?.start != null && workflow.mode !== "account") reasons.push([1, `product shown at ${clock(row.brandMoment.start)}`]);
    row.reasons = reasons.sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, text]) => text);
  });

  // Channels: every platform and every account, judged on typical views and how often they hit.
  const summarise = (items: typeof rows) => {
    const best = [...items].sort((a, b) => b.score - a.score)[0];
    const formatsHere = new Map<string, number[]>();
    for (const r of items) if (r.format && r.format !== NO_FORMAT) formatsHere.set(r.format, [...(formatsHere.get(r.format) ?? []), r.views]);
    const topFormat = [...formatsHere.entries()].filter(([, views]) => views.length >= 2).sort((a, b) => median(b[1]) - median(a[1]))[0]?.[0] ?? null;
    const hits = items.filter((r) => r.views >= HIT * typical).length;
    return {
      reels: items.length,
      medianViews: median(items.map((r) => r.views)),
      hitRate: items.length ? hits / items.length : 0,
      // For ranking: one hit from one reel shouldn't outrank five from eight, so pull small
      // samples towards a 1-in-3 prior.
      reliableHitRate: (hits + 1) / (items.length + 3),
      medianEngagement: median(items.map((r) => r.engagementPer1k)),
      medianViewsPerDay: median(items.flatMap((r) => (r.viewsPerDay == null ? [] : [r.viewsPerDay]))),
      followers: Math.max(0, ...items.map((r) => r.followers ?? 0)) || null,
      bestReel: best?.id ?? null,
      topFormat,
    };
  };
  // Channels and the playbook only learn from on-topic posts: keyword-search strays would teach the wrong lessons.
  const relevant = rows.filter((r) => r.onTopic == null || r.onTopic >= 0.5);
  const group = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
    const groups = new Map<K, typeof rows>();
    for (const r of relevant) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
    return [...groups.entries()];
  };
  const platforms = group((r) => r.platform).map(([platform, items]) => ({ platform, accounts: new Set(items.map((r) => r.account)).size, ...summarise(items) }))
    .sort((a, b) => b.medianViews - a.medianViews);
  const accounts = group((r) => `${r.platform}|${r.account}`).map(([key, items]) => {
    const [platform, account] = key.split("|");
    return { platform, account, ...summarise(items) };
  }).sort((a, b) => b.reliableHitRate - a.reliableHitRate || b.medianViews - a.medianViews);

  // The playbook: per channel, what the winners (top quarter by score) have in common.
  const bucket = (sec: number | null) => sec == null ? null : sec < 15 ? "under 15s" : sec < 30 ? "15–30s" : sec < 60 ? "30–60s" : "60s+";
  const hookLine = (r: (typeof rows)[number]) => (r.script[0]?.text ?? r.caption.split("\n").find((line) => line.trim()) ?? "").trim().slice(0, 220);
  const playbook = group((r) => r.platform).map(([platform, items]) => {
    const ranked = [...items].sort((a, b) => b.score - a.score);
    const winners = ranked.slice(0, Math.max(3, Math.ceil(items.length / 4)));
    const rank = (key: (r: (typeof rows)[number]) => string | null) => {
      const groups = new Map<string, typeof rows>();
      for (const r of items) { const k = key(r); if (k && k !== NO_FORMAT && k !== "other") groups.set(k, [...(groups.get(k) ?? []), r]); }
      return [...groups.entries()].filter(([, g]) => g.length >= 2)
        .map(([id, g]) => ({ id, posts: g.length, medianViews: median(g.map((r) => r.views)), medianScore: median(g.map((r) => r.score)) }))
        .sort((a, b) => b.medianScore - a.medianScore).slice(0, 5);
    };
    // The usual order of jobs in a winning script, e.g. hook → proof → method → cta.
    const shapes = new Map<string, number>();
    for (const r of winners) {
      const roles = r.script.map((line) => line.role).filter((role): role is NonNullable<typeof role> => Boolean(role) && role !== "other");
      const shape = roles.filter((role, i) => role !== roles[i - 1]).slice(0, 3).join(" → ");
      if (shape) shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
    }
    const share = (list: typeof rows, test: (r: (typeof rows)[number]) => boolean) => list.length ? list.filter(test).length / list.length : 0;
    return {
      platform,
      posts: items.length,
      formats: rank((r) => r.format),
      hooks: rank((r) => r.hookType),
      lengths: rank((r) => bucket(r.durationSec)),
      examples: winners.slice(0, 8).map((r) => ({ id: r.id, hook: hookLine(r), hookType: r.hookType, account: r.account, views: r.views, score: r.score, format: r.format })),
      structures: [...shapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([shape, count]) => ({ shape, count })),
      ctaWinners: share(winners, (r) => r.hasCta),
      ctaRest: share(ranked.slice(winners.length), (r) => r.hasCta),
      intentWinners: winners.some((r) => r.buyerIntent != null) ? median(winners.flatMap((r) => (r.buyerIntent == null ? [] : [r.buyerIntent]))) : null,
    };
  }).sort((a, b) => b.posts - a.posts);

  // Audience: what commenters ask for, object to and talk about, across the run.
  const commented = relevant.flatMap((r) => r.commentList.filter((c) => c.theme).map((c) => ({ ...c, theme: c.theme as string, row: r })));
  const themeCounts = new Map<string, typeof commented>();
  for (const c of commented) themeCounts.set(c.theme, [...(themeCounts.get(c.theme) ?? []), c]);
  const share = (list: { theme: string }[], theme: string) => (list.length ? list.filter((c) => c.theme === theme).length / list.length : 0);
  const audience = {
    total: commented.length,
    posts: new Set(commented.map((c) => c.row.id)).size,
    themes: [...themeCounts.entries()].map(([theme, list]) => ({
      theme, count: list.length, share: list.length / Math.max(commented.length, 1),
      // Examples from the best-performing posts first.
      examples: [...list].sort((a, b) => b.row.score - a.row.score).slice(0, 4).map((c) => ({ text: c.text, account: c.row.account, platform: c.row.platform, postId: c.row.id })),
    })).sort((a, b) => b.count - a.count),
    byPlatform: Object.fromEntries([...new Set(commented.map((c) => c.row.platform))].map((platform) => {
      const list = commented.filter((c) => c.row.platform === platform);
      return [platform, { total: list.length, themes: Object.fromEntries([...themeCounts.keys()].map((theme) => [theme, share(list, theme)])) }];
    })),
    byAccount: [...new Set(commented.map((c) => c.row.account))].map((account) => {
      const list = commented.filter((c) => c.row.account === account);
      const counts = new Map<string, number>();
      for (const c of list) counts.set(c.theme, (counts.get(c.theme) ?? 0) + 1);
      return { account, total: list.length, buyShare: share(list, "buy_intent"), objectionShare: share(list, "objection"), questionShare: share(list, "how_question"), topTheme: [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null };
    }).filter((a) => a.total >= 3).sort((a, b) => b.buyShare - a.buyShare || b.total - a.total).slice(0, 15),
  };

  // Creators worth working with: accounts that aren't the brands being studied (niche posts, or every
  // creator in a campaign), ranked by how reliably they beat the typical post, buyers in their
  // comments, and how small their audience is for the reach they get.
  const isCampaign = workflow.mode === "campaign" || (workflow.mode === "project" && Boolean(workflow.brand));
  const creatorRows = workflow.mode === "account" ? [] : relevant.filter((r) => r.niche || isCampaign || workflow.mode === "competitors");
  const profile = (platform: string, owner: string, url: string) => ({ instagram: `https://www.instagram.com/${owner}/`, tiktok: `https://www.tiktok.com/@${owner}`, youtube: `https://www.youtube.com/@${owner}`, x: `https://x.com/${owner}` } as Record<string, string>)[platform] ?? url;
  const creators = [...new Map(creatorRows.map((r) => [`${r.platform}|${r.owner}`, r])).keys()].map((key) => {
    const [platform, owner] = key.split("|");
    const items = creatorRows.filter((r) => r.platform === platform && r.owner === owner);
    const hits = items.filter((r) => r.views >= HIT * typical).length;
    const intents = items.flatMap((r) => (r.buyerIntent == null ? [] : [r.buyerIntent]));
    const followers = Math.max(0, ...items.map((r) => r.followers ?? 0)) || null;
    const best = [...items].sort((a, b) => b.score - a.score)[0];
    const reliable = (hits + 1) / (items.length + 3);
    const medianIntent = intents.length ? median(intents) : null;
    const smallBonus = followers == null ? 0.07 : followers < 10_000 ? 0.2 : followers < 100_000 ? 0.12 : 0;
    return {
      platform, owner, account: best.account, posts: items.length, medianViews: median(items.map((r) => r.views)), bestViews: best.views,
      hitRate: hits / items.length, medianIntent, followers, viewsPerFollower: followers ? median(items.map((r) => r.views)) / followers : null,
      bestReel: best.id, topFormat: best.format, profileUrl: profile(platform, owner, best.url),
      score: Math.round((reliable * 0.55 + (medianIntent ?? 0.2) * 0.25 + smallBonus + (best.score / 100) * 0.2) * 100),
    };
  }).sort((a, b) => b.score - a.score).slice(0, 40);

  const data = {
    slug: input.slug,
    mode: workflow.mode,
    title: workflow.title,
    subject: workflow.mode === "account" ? `@${workflow.handle}` : workflow.mode === "campaign" ? workflow.brand : workflow.mode === "project" ? workflow.brand ?? workflow.product : workflow.product,
    sinceDays: workflow.mode === "project" ? workflow.sinceDays : null,
    status,
    hitMultiple: HIT,
    kpis: {
      videos: reels.length,
      decoded: decoded.size,
      creators: new Set(reels.map((reel) => `${reel.platform}:${reel.owner}`)).size,
      platforms: platforms.length,
      sorted: rows.filter((row) => row.format && row.format !== NO_FORMAT).length,
      formats: formats.length,
      typicalViews: typical,
      jevUsd,
      apifyUsd: status?.apifyUsd ?? 0,
      totalUsd: jevUsd + (status?.apifyUsd ?? 0),
    },
    formats: [...formats, { id: NO_FORMAT, name: "no clear format", description: "Doesn't follow any of the recurring formats." }],
    channels: { platforms, accounts },
    playbook,
    audience,
    creators,
    partners: input.partners ?? null,
    reels: rows,
  };
  return data;
}

export type Report = ReturnType<typeof buildReport>;
