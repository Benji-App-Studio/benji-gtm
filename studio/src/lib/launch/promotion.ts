// Promote-to-scaling and pause suggestions. A testing ad is suggested for the scaling campaign only
// when its numbers are a result rather than luck: enough spend and conversions, spread over several
// days, and a CAC that is below target with real confidence (and ROAS at target, when there's
// revenue to judge it by). Clear losers are suggested for pausing. Every suggestion says why.
//
// The model: conversions arrive as a Poisson process in spend, at rate λ conversions per unit of
// currency (CAC = 1/λ). With a Gamma(α₀, β₀) prior on λ, after k conversions on spend S the
// posterior is Gamma(α₀ + k, β₀ + S). The prior is one pseudo-conversion at the target CAC
// (α₀ = 1, β₀ = target), so a creative with little data reads as "about target" and has to earn
// its way above it. P(CAC < target) = P(λ > 1/target) = 1 − GammaCDF(1/target).
//
// Defaults (each workspace can change them in Launch settings):
//   promote when ALL of
//     spend ≥ 3 × target CAC                    (one lucky day isn't a result)
//     conversions ≥ 10
//     delivered on ≥ 3 days, and no single day holds > 60 % of the conversions
//     P(CAC < target) ≥ 80 %
//     ROAS over the last 7 days ≥ target ROAS with ≥ 5 paying users (only when a target is set
//       and revenue is attributed; skipped while there is no revenue, e.g. before launch)
//   pause when
//     spend ≥ 2 × target CAC and P(CAC > target) ≥ 90 %   (zero conversions after 2× target trips this)
import type { AdMetrics, AdMetricsDay } from "@/lib/ad-metrics";
import { gammaCdf, gammaQuantile } from "./stats";

export type ConversionEvent = "install" | "trial" | "purchase" | "link_click";

export interface Thresholds {
  /** Target cost per conversion, in the ad account's currency. 0 = not set (no suggestions). */
  targetCac: number;
  /** Target ROAS (revenue ÷ spend); null = don't judge ROAS. */
  targetRoas: number | null;
  conversionEvent: ConversionEvent;
  minSpendMultiple: number;
  minConversions: number;
  minDays: number;
  maxDayShare: number;
  confidence: number;
  windowDays: number;
  minPayingForRoas: number;
  pauseSpendMultiple: number;
  pauseConfidence: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  targetCac: 0,
  targetRoas: null,
  conversionEvent: "trial",
  minSpendMultiple: 3,
  minConversions: 10,
  minDays: 3,
  maxDayShare: 0.6,
  confidence: 0.8,
  windowDays: 7,
  minPayingForRoas: 5,
  pauseSpendMultiple: 2,
  pauseConfidence: 0.9,
};

export const EVENT_LABEL: Record<ConversionEvent, { one: string; many: string }> = {
  install: { one: "install", many: "installs" },
  trial: { one: "trial", many: "trials" },
  purchase: { one: "purchase", many: "purchases" },
  link_click: { one: "link click", many: "link clicks" },
};

export function thresholds(saved: Partial<Thresholds> | null | undefined): Thresholds {
  const t = { ...DEFAULT_THRESHOLDS };
  for (const [k, v] of Object.entries(saved ?? {})) {
    if (v === undefined) continue;
    (t as Record<string, unknown>)[k] = v;
  }
  return t;
}

export type Verdict = "promote" | "pause" | "keep_testing" | "promoted";

export interface Check {
  label: string;
  /** true passed, false failed, null not applicable (e.g. no revenue yet). */
  pass: boolean | null;
  detail: string;
}

export interface Suggestion {
  adId: string;
  adName: string;
  stage: "TEST" | "SCALE" | "OTHER";
  verdict: Verdict;
  /** One sentence: what to do and the main reason. */
  summary: string;
  checks: Check[];
  spend: number;
  conversions: number;
  currency: string;
  /** Observed CAC, and an 80 % credible interval from the posterior. */
  cac: number | null;
  cacLow: number | null;
  cacHigh: number | null;
  /** P(true CAC < target). */
  probBelowTarget: number | null;
  roas: number | null;
}

const conversionsOf = (d: AdMetricsDay, e: ConversionEvent) =>
  e === "install" ? d.installs : e === "trial" ? d.trials : e === "purchase" ? d.purchases : d.clicks;

const money = (n: number, currency: string) => {
  try { return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(n); }
  catch { return `${Math.round(n)} ${currency}`; }
};
const pct = (p: number) => `${Math.round(p * 100)}%`;

export interface Context {
  testingAdSetId?: string | null;
  scalingAdSetId?: string | null;
  /** Testing ads that already have a copy in the scaling ad set. */
  promoted?: Set<string>;
}

export function evaluate(m: AdMetrics, t: Thresholds, ctx: Context = {}): Suggestion {
  const stage = m.adSetId && m.adSetId === ctx.testingAdSetId ? "TEST" : m.adSetId && m.adSetId === ctx.scalingAdSetId ? "SCALE" : "OTHER";
  const e = EVENT_LABEL[t.conversionEvent];
  const spend = sum(m.days, (d) => d.spend);
  const conversions = sum(m.days, (d) => conversionsOf(d, t.conversionEvent));
  const base = { adId: m.adId, adName: m.adName, stage, spend, conversions, currency: m.currency } as const;
  const cac = conversions > 0 ? spend / conversions : null;

  // Posterior on the conversion rate per unit of spend.
  const T = t.targetCac;
  const shape = 1 + conversions;
  const rate = T + spend;
  const probBelowTarget = T > 0 ? 1 - gammaCdf(1 / T, shape, rate) : null;
  const cacLow = T > 0 ? 1 / gammaQuantile(0.9, shape, rate) : null;
  const cacHigh = T > 0 ? 1 / gammaQuantile(0.1, shape, rate) : null;

  // ROAS over the window.
  const window = m.days.slice(-t.windowDays);
  const windowSpend = sum(window, (d) => d.spend);
  const windowRevenue = sum(window, (d) => d.revenue);
  const windowPaying = sum(window, (d) => d.purchases);
  const roas = windowSpend > 0 && windowRevenue > 0 ? windowRevenue / windowSpend : null;

  const daysWithSpend = m.days.filter((d) => d.spend > 0).length;
  const topDay = Math.max(0, ...m.days.map((d) => conversionsOf(d, t.conversionEvent)));
  const topShare = conversions > 0 ? topDay / conversions : 0;

  const checks: Check[] = [
    {
      label: "Enough spend",
      pass: T > 0 ? spend >= t.minSpendMultiple * T : false,
      detail: T > 0 ? `${money(spend, m.currency)} of the ${money(t.minSpendMultiple * T, m.currency)} needed (${t.minSpendMultiple}× target CAC)` : "Set a target CAC",
    },
    { label: `Enough ${e.many}`, pass: conversions >= t.minConversions, detail: `${conversions} of ${t.minConversions}` },
    {
      label: "Not one lucky day",
      pass: daysWithSpend >= t.minDays && topShare <= t.maxDayShare,
      detail: `${daysWithSpend} day${daysWithSpend === 1 ? "" : "s"} with spend (need ${t.minDays})${conversions ? `; best day has ${pct(topShare)} of ${e.many} (max ${pct(t.maxDayShare)})` : ""}`,
    },
    {
      label: "CAC below target, with confidence",
      pass: probBelowTarget != null ? probBelowTarget >= t.confidence : false,
      detail: probBelowTarget != null
        ? `${cac != null ? `CAC ${money(cac, m.currency)}` : `No ${e.many} yet`} vs target ${money(T, m.currency)}; likely ${money(cacLow!, m.currency)}–${money(cacHigh!, m.currency)}; ${pct(probBelowTarget)} sure it's below target (need ${pct(t.confidence)})`
        : "Set a target CAC",
    },
    t.targetRoas == null
      ? { label: "ROAS", pass: null, detail: "No ROAS target set" }
      : roas == null
      ? { label: "ROAS", pass: null, detail: "No attributed revenue yet, so ROAS isn't judged" }
      : {
        label: `ROAS over ${t.windowDays} days`,
        pass: roas >= t.targetRoas && windowPaying >= t.minPayingForRoas,
        detail: `${roas.toFixed(2)}× vs ${t.targetRoas.toFixed(2)}× target, ${windowPaying} paying (need ${t.minPayingForRoas})`,
      },
  ];

  const stats = { cac, cacLow, cacHigh, probBelowTarget, roas, checks };
  if (T <= 0) return { ...base, ...stats, verdict: "keep_testing", summary: "Set a target CAC in Launch settings to get suggestions." };

  // Pause: plenty of spend and a CAC that is very likely above target.
  const pauseSpend = spend >= t.pauseSpendMultiple * T;
  const probAbove = 1 - probBelowTarget!;
  if (pauseSpend && probAbove >= t.pauseConfidence) {
    return {
      ...base, ...stats, verdict: "pause",
      summary: conversions === 0
        ? `Pause: ${money(spend, m.currency)} spent (${(spend / T).toFixed(1)}× target CAC) with no ${e.many}.`
        : `Pause: CAC ${money(cac!, m.currency)} after ${money(spend, m.currency)}; ${pct(probAbove)} sure it's above the ${money(T, m.currency)} target.`,
    };
  }

  if (stage === "TEST" && ctx.promoted?.has(m.adId)) {
    return { ...base, ...stats, verdict: "promoted", summary: "Already copied to the scaling campaign." };
  }

  const applicable = checks.filter((c) => c.pass !== null);
  if (stage === "TEST" && applicable.every((c) => c.pass)) {
    return {
      ...base, ...stats, verdict: "promote",
      summary: `Promote: ${conversions} ${e.many} at ${money(cac!, m.currency)} CAC over ${daysWithSpend} days; ${pct(probBelowTarget!)} sure it beats the ${money(T, m.currency)} target.`,
    };
  }

  // What's still missing, in words.
  const needs: string[] = [];
  if (!checks[0].pass) needs.push(`${money(t.minSpendMultiple * T - spend, m.currency)} more spend`);
  if (!checks[1].pass) needs.push(`${t.minConversions - conversions} more ${t.minConversions - conversions === 1 ? e.one : e.many}`);
  if (daysWithSpend < t.minDays) needs.push(`${t.minDays - daysWithSpend} more day${t.minDays - daysWithSpend === 1 ? "" : "s"} of delivery`);
  else if (topShare > t.maxDayShare) needs.push(`${e.many} spread over more days`);
  if (!checks[3].pass) needs.push(cac != null && cac > T ? "a lower CAC" : "a CAC clearly below target");
  if (checks[4].pass === false) needs.push("ROAS at target");
  return {
    ...base, ...stats, verdict: "keep_testing",
    summary: stage === "TEST"
      ? `Keep testing: needs ${needs.length ? needs.join(", ") : "more data"}.`
      : `Holding: ${cac != null ? `CAC ${money(cac, m.currency)}` : `no ${e.many} yet`}.`,
  };
}

/** Suggestions for every ad in the testing and scaling ad sets, the actionable ones first. */
export function suggest(metrics: AdMetrics[], t: Thresholds, ctx: Context = {}): Suggestion[] {
  const order: Record<Verdict, number> = { promote: 0, pause: 1, keep_testing: 2, promoted: 3 };
  return metrics
    .filter((m) => !ctx.testingAdSetId || m.adSetId === ctx.testingAdSetId || m.adSetId === ctx.scalingAdSetId)
    .filter((m) => m.status !== "PAUSED" && m.status !== "ARCHIVED" && m.status !== "DELETED")
    .map((m) => evaluate(m, t, ctx))
    .sort((a, b) => order[a.verdict] - order[b.verdict] || b.spend - a.spend);
}

function sum<T>(rows: T[], f: (row: T) => number) {
  return rows.reduce((total, row) => total + (Number(f(row)) || 0), 0);
}
