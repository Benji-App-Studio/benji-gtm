// Scaling advice for the scaling ad set, from the Meta ads playbook: raise a winner's budget about
// 20 % every 48 hours while its cost per conversion stays under target, judge where the CPA settles
// rather than the day after a bump, and when increases keep breaking it, add more winners side by
// side instead of forcing one ad set higher. Advice only: nothing here changes a budget on Meta.
import type { AdMetrics } from "@/lib/ad-metrics";
import { EVENT_LABEL, type Thresholds } from "./promotion";

export type ScalingMove = "setup" | "promote_first" | "wait" | "raise" | "hold" | "horizontal" | "at_cap";

export interface ScalingAdvice {
  move: ScalingMove;
  /** One sentence: what to do. */
  summary: string;
  /** Why, in a line or two. */
  why: string;
  currency: string;
  dailyBudget: number | null;
  /** The budget the playbook's next 20 % step lands on (capped by the max daily budget). */
  nextBudget: number | null;
  /** Last 3 days in the scaling ad set. */
  recent: { spend: number; conversions: number; cpa: number | null; days: number };
  /** The 4 days before them, to see whether CPA moved after a change. */
  before: { spend: number; conversions: number; cpa: number | null };
  ads: number;
}

const STEP = 0.2;

export function scalingAdvice(o: {
  metrics: AdMetrics[];
  thresholds: Thresholds;
  scalingAdSetId: string | null | undefined;
  /** The scaling ad set's daily budget in major units (null when it isn't known). */
  dailyBudget: number | null;
  maxDailyBudget: number | null;
  currency?: string;
  today?: string;
}): ScalingAdvice {
  const t = o.thresholds;
  const e = EVENT_LABEL[t.conversionEvent];
  const ads = o.metrics.filter((m) => o.scalingAdSetId && m.adSetId === o.scalingAdSetId);
  const currency = ads[0]?.currency ?? o.currency ?? "USD";
  const today = o.today ?? new Date().toISOString().slice(0, 10);
  const daysAgo = (d: string) => Math.round((Date.parse(today) - Date.parse(d)) / 86_400_000);
  const pick = (from: number, to: number) => {
    let spend = 0, conversions = 0;
    const seen = new Set<string>();
    for (const ad of ads) for (const d of ad.days) {
      const age = daysAgo(d.date);
      if (age < from || age > to) continue;
      spend += d.spend;
      conversions += t.conversionEvent === "install" ? d.installs : t.conversionEvent === "trial" ? d.trials : t.conversionEvent === "purchase" ? d.purchases : d.clicks;
      if (d.spend > 0) seen.add(d.date);
    }
    return { spend, conversions, cpa: conversions ? spend / conversions : null, days: seen.size };
  };
  // Today is partial: look at the three full days before it, and the four before those.
  const recent = pick(1, 3);
  const prior = pick(4, 7);
  const before = { spend: prior.spend, conversions: prior.conversions, cpa: prior.cpa };
  const budget = o.dailyBudget;
  const raw = budget != null ? Math.round(budget * (1 + STEP)) : null;
  const nextBudget = raw != null && o.maxDailyBudget != null ? Math.min(raw, o.maxDailyBudget) : raw;
  const base = { currency, dailyBudget: budget, nextBudget, recent, before, ads: ads.length };
  const money = (n: number) => { try { return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(n); } catch { return `${Math.round(n)} ${currency}`; } };

  if (!o.scalingAdSetId) return { ...base, move: "setup", summary: "No scaling ad set yet.", why: "Pick or create one in Launch settings. The playbook scales winners in their own campaign, ideally with a campaign budget (CBO) so Meta moves money to the best ad." };
  if (!ads.length) return { ...base, move: "promote_first", summary: "Promote a winner from testing first.", why: "Scaling starts once a testing ad has beaten your target cost per " + e.one + " on enough spend; the suggestions above say when." };
  if (!t.targetCac) return { ...base, move: "wait", summary: `Set a target cost per ${e.one} to get scaling advice.`, why: "Every scaling step is judged against it. Work it out from what a customer is worth (LTV) and how fast you need the money back." };
  if (recent.days < 2 || recent.spend < t.targetCac * 2) {
    return { ...base, move: "wait", summary: "Let it spend before changing the budget.", why: `The last 3 days spent ${money(recent.spend)}; judge on at least about ${money(t.targetCac * 2)} (2 × target) so the cost per ${e.one} is a result, not noise.` };
  }
  const cpa = recent.cpa;
  const under = cpa != null && cpa <= t.targetCac;
  const wellOver = cpa == null || cpa > t.targetCac * 1.2;
  // CPA was fine before and broke in the latest days: the last raise was probably too far for this ad set.
  const brokeAfterRaise = before.cpa != null && before.cpa <= t.targetCac && wellOver;
  if (under) {
    if (budget != null && o.maxDailyBudget != null && budget >= o.maxDailyBudget) {
      return { ...base, move: "at_cap", summary: `At your max daily budget (${money(o.maxDailyBudget)}), and still under target.`, why: "Raise the max in Launch settings if the economics allow, or scale horizontally: promote another winner and give it its own budget." };
    }
    return {
      ...base, move: "raise",
      summary: nextBudget != null && budget != null ? `Raise the daily budget about 20 %: ${money(budget)} → ${money(nextBudget)}, then leave it 48 hours.` : "Raise the daily budget about 20 %, then leave it 48 hours.",
      why: `Cost per ${e.one} over the last 3 days is ${money(cpa!)} against a ${money(t.targetCac)} target. Expect it to wobble after the change; judge where it settles, not the next morning.`,
    };
  }
  if (brokeAfterRaise) {
    return { ...base, move: "horizontal", summary: "Stop raising this one; scale sideways with more winners.", why: `Cost per ${e.one} went from ${money(before.cpa!)} to ${cpa != null ? money(cpa) : "no conversions"} in the last 3 days. If it doesn't settle back under ${money(t.targetCac)} within 48 hours, step the budget back about 20 % and promote another winner (or a variation of this one) to run beside it.` };
  }
  if (wellOver) {
    return { ...base, move: "hold", summary: "Hold the budget; the cost per " + e.one + " is over target.", why: `${cpa != null ? money(cpa) : "No conversions"} over the last 3 days against ${money(t.targetCac)}. Give it 48 hours to settle; if it doesn't, lower the budget or pause the weakest ad, and keep new creatives in testing.` };
  }
  return { ...base, move: "hold", summary: "Hold: it's around target.", why: `${money(cpa!)} against ${money(t.targetCac)}. Raise again once it settles under target.` };
}

const NO_OFFSET = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);
/** Meta reports budgets in the currency's minor unit (cents); the studio works in major units. */
export const fromMinor = (minor: number, currency: string) => minor / (NO_OFFSET.has(currency.toUpperCase()) ? 1 : 100);
