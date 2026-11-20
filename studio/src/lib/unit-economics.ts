// Unit economics: what a customer costs, what they are worth and when they pay back, and a 12-month
// projection from a scenario the team can change. Pure functions (no React, no I/O), so the Measure
// page recomputes on every keystroke and every formula is unit-tested (unit-economics.test.ts).
//
// Money is USD throughout (Meta spend is converted at the sync's rate before it gets here). A plan's
// price is its price after the store's sales taxes (what RevenueCat calls revenue net of taxes); the
// store fee comes off that (15% for the App Store Small Business Program and subscriptions past their
// first year, 30% otherwise), then refunds off what is left. "Net" below means after both.
//
// Every result says which source it came from, so the page can show "how it's calculated" next to it.
import type { MixpanelRow, RcRow } from "./measure";

/** A plan in the mix: months between charges (0 = a one-time, lifetime purchase), its price after tax (USD), and its share of new payers (0–1). */
export interface Plan { months: number; price: number; share: number }
/** The billing periods the scenario panel offers; a saved plan may use any other length. */
export const PLAN_PERIODS = [12 / 52, 1, 2, 3, 6, 12, 0] as const;
export const STORE_FEES = [0.15, 0.3] as const;
export const DAYS_PER_MONTH = 30.4375;

export interface Scenario {
  /** Ad spend per day, USD. */
  dailySpend: number;
  /** Cost per install, USD. */
  cpi: number;
  /** Installs that start a trial (0–1). */
  trialRate: number;
  /** Trials that convert to paid (0–1). */
  trialToPaid: number;
  plans: Plan[];
  /** Share of monthly subscribers lost each month (0–1); plans shorter than a year renew at (1 − churn) per month. */
  monthlyChurn: number;
  /** Share of annual subscribers who renew at the year's end (0–1); plans of a year or longer use it per year. */
  annualRenewal: number;
  /** Share of revenue refunded (0–1). */
  refundRate: number;
  /** The store's cut of the price (0–1). */
  storeFee: number;
  /** How far the projection looks (months). */
  months: number;
}

export const DEFAULT_SCENARIO: Scenario = {
  dailySpend: 100, cpi: 2.5, trialRate: 0.15, trialToPaid: 0.35,
  plans: [{ months: 12, price: 49.99, share: 0.6 }, { months: 1, price: 9.99, share: 0.4 }],
  monthlyChurn: 0.12, annualRenewal: 0.35, refundRate: 0.03, storeFee: 0.15, months: 12,
};

const finite = (n: unknown, fallback: number) => (typeof n === "number" && Number.isFinite(n) ? n : typeof n === "string" && n.trim() && Number.isFinite(Number(n)) ? Number(n) : fallback);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const OLD_KINDS: Record<string, number> = { weekly: 12 / 52, monthly: 1, quarterly: 3, annual: 12, lifetime: 0 };

/**
 * A scenario from anywhere (a saved row, a form): every number made finite and in range, the plan
 * shares made to add up to 1. Returns null for something that isn't a scenario at all. Plans saved
 * before periods were in months ({ kind: "annual" }) are read too.
 */
export function cleanScenario(raw: unknown, base: Scenario = DEFAULT_SCENARIO): Scenario | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const plansRaw = Array.isArray(r.plans) ? r.plans : base.plans;
  const plans = plansRaw.slice(0, 6).flatMap((p) => {
    if (!p || typeof p !== "object") return [];
    const q = p as Record<string, unknown>;
    const months = typeof q.kind === "string" && q.months == null ? OLD_KINDS[q.kind] : finite(q.months, Number.NaN);
    if (months == null || !Number.isFinite(months) || months < 0 || months > 120) return [];
    return [{ months, price: clamp(finite(q.price, 0), 0, 100_000), share: clamp(finite(q.share, 0), 0, 1) }];
  });
  return {
    dailySpend: clamp(finite(r.dailySpend, base.dailySpend), 0, 10_000_000),
    cpi: clamp(finite(r.cpi, base.cpi), 0, 10_000),
    trialRate: clamp(finite(r.trialRate, base.trialRate), 0, 1),
    trialToPaid: clamp(finite(r.trialToPaid, base.trialToPaid), 0, 1),
    plans: normalisePlans(plans),
    monthlyChurn: clamp(finite(r.monthlyChurn, base.monthlyChurn), 0, 1),
    annualRenewal: clamp(finite(r.annualRenewal, base.annualRenewal), 0, 1),
    refundRate: clamp(finite(r.refundRate, base.refundRate), 0, 1),
    storeFee: clamp(finite(r.storeFee, base.storeFee), 0, 0.99),
    months: Math.round(clamp(finite(r.months, base.months), 1, 36)),
  };
}

/** Shares scaled to add up to 1 (all zero: equal shares). */
export function normalisePlans(plans: Plan[]): Plan[] {
  const total = plans.reduce((s, p) => s + p.share, 0);
  if (!plans.length) return [];
  return plans.map((p) => ({ ...p, share: total > 0 ? p.share / total : 1 / plans.length }));
}

/** What one charge leaves after the store's cut and refunds. */
export const netPrice = (price: number, storeFee: number, refundRate: number) => Math.max(0, price) * (1 - clamp(storeFee, 0, 1)) * (1 - clamp(refundRate, 0, 1));

/** The chance a subscriber renews after one billing period of `months` (0: a one-time purchase never renews). */
export function renewal(months: number, s: Pick<Scenario, "monthlyChurn" | "annualRenewal">): number {
  if (!(months > 0)) return 0;
  if (months >= 12) return clamp(s.annualRenewal, 0, 1) ** (months / 12);
  return (1 - clamp(s.monthlyChurn, 0, 1)) ** months;
}

/**
 * Expected net cash from one new paying customer in each month after they first pay (month 0 is the
 * month of the first charge), over `months`, across the plan mix. A charge falls in the month it
 * happens; charge k is paid with probability renewal^k.
 */
export function payerCashflow(s: Scenario, months: number): number[] {
  const out = Array.from({ length: Math.max(0, Math.floor(months)) }, () => 0);
  if (!out.length) return out;
  for (const plan of normalisePlans(s.plans)) {
    const net = netPrice(plan.price, s.storeFee, s.refundRate) * plan.share;
    if (net <= 0) continue;
    if (!(plan.months > 0)) { out[0] += net; continue; }
    const keep = renewal(plan.months, s);
    for (let k = 0, alive = 1; k * plan.months < out.length && alive >= 1e-9; k++, alive *= keep) out[Math.floor(k * plan.months)] += net * alive;
  }
  return out;
}

/** The share of one month's new payers still subscribed `age` months later (one-time buyers count as kept). */
export function stillActive(s: Scenario, age: number): number {
  let active = 0;
  for (const plan of normalisePlans(s.plans)) {
    if (!(plan.months > 0)) { active += plan.share; continue; }
    active += plan.share * renewal(plan.months, s) ** Math.floor(age / plan.months);
  }
  return active;
}

// MARK: Plans from RevenueCat

/**
 * Months between charges for a RevenueCat product duration: ISO 8601 ("P1M", "P6M", "P1Y", "P1W",
 * "P3D") or words ("Monthly", "6 months", "Semiannual", "Bimonthly", "Lifetime"). Null when it can't
 * be told: never silently monthly.
 */
export function planMonths(segment: string): number | null {
  const s = segment.trim().toLowerCase();
  const iso = s.match(/^p(?:(\d+)y)?(?:(\d+)m)?(?:(\d+)w)?(?:(\d+)d)?$/);
  if (iso && iso.slice(1).some(Boolean)) {
    const [y, m, w, d] = iso.slice(1).map((v) => Number(v ?? 0));
    const months = y * 12 + m + (w * 7 + d) / DAYS_PER_MONTH;
    return months > 0 ? months : null;
  }
  if (/life|non.?renew|one.?time|consumable|non.?subscription/.test(s)) return 0;
  const words: [RegExp, number][] = [
    [/semi.?annual|half.?year|six.?month/, 6], [/bi.?monthly|two.?month/, 2], [/quarter|three.?month/, 3],
    [/bi.?weekly|two.?week|fortnight/, 14 / DAYS_PER_MONTH], [/week/, 12 / 52], [/two.?year|biennial/, 24], [/year|annual/, 12], [/month/, 1],
  ];
  const n = s.match(/^(\d+)[\s-]*(day|week|month|year)s?$/);
  if (n) return Number(n[1]) * ({ day: 1 / DAYS_PER_MONTH, week: 7 / DAYS_PER_MONTH, month: 1, year: 12 }[n[2] as "day"]);
  return words.find(([re]) => re.test(s))?.[1] ?? null;
}

export interface PlanObservation {
  segment: string;
  /** New paid subscriptions in the period (RevenueCat actives_new by duration): the share of new payers. */
  newPaid: number;
  /** New-subscription revenue net of taxes and its transactions (RevenueCat revenue, transaction type "new subscription"). */
  newRevenue: number | null; newTransactions: number | null;
}

/**
 * The plan mix the data supports. Shares come from new paid subscriptions per duration. A plan's price
 * is new-subscription revenue net of taxes ÷ its transactions, never proceeds (which hold every renewal).
 * Without that, `priced` is false: the team enters prices on the scenario panel.
 */
export function plansFromData(observed: PlanObservation[]): { plans: Plan[]; priced: boolean; unknown: string[] } {
  const unknown: string[] = [];
  const byMonths = new Map<number, { newPaid: number; revenue: number; transactions: number }>();
  for (const o of observed) {
    const months = planMonths(o.segment);
    if (months == null) { if (o.newPaid > 0) unknown.push(o.segment); continue; }
    const key = Math.round(months * 1000) / 1000;
    const p = byMonths.get(key) ?? { newPaid: 0, revenue: 0, transactions: 0 };
    p.newPaid += o.newPaid; p.revenue += o.newRevenue ?? 0; p.transactions += o.newTransactions ?? 0;
    byMonths.set(key, p);
  }
  const total = [...byMonths.values()].reduce((s, p) => s + p.newPaid, 0);
  const plans = [...byMonths.entries()].filter(([, p]) => p.newPaid > 0)
    .map(([months, p]) => ({ months, price: p.transactions > 0 ? Math.round((p.revenue / p.transactions) * 100) / 100 : 0, share: total > 0 ? p.newPaid / total : 0 }))
    .sort((a, b) => b.share - a.share);
  return { plans, priced: plans.length > 0 && plans.every((p) => p.price > 0), unknown };
}

// MARK: LTV, CAC and payback

export interface LtvModel {
  /** Net lifetime value of one paying customer over the horizon. */
  perPayer: number;
  /** …of one trial start (× trial to paid) and of one install (× trial rate). */
  perTrial: number; perInstall: number;
  horizonMonths: number;
}

/** LTV modelled from the price mix, renewals (churn), refunds and the store fee, over a horizon (24 months by default). */
export function modelLtv(s: Scenario, horizonMonths = 24): LtvModel {
  const perPayer = payerCashflow(s, horizonMonths).reduce((a, b) => a + b, 0);
  return { perPayer, perTrial: perPayer * s.trialToPaid, perInstall: perPayer * s.trialToPaid * s.trialRate, horizonMonths };
}

/** The first month (1 = the month of the first charge) by which cumulative net cash covers `cac`, or null within the horizon. */
export function paybackMonth(cac: number | null, cashflow: number[]): number | null {
  if (cac == null || !Number.isFinite(cac)) return null;
  if (cac <= 0) return 0;
  let total = 0;
  for (let m = 0; m < cashflow.length; m++) {
    total += cashflow[m];
    if (total >= cac - 1e-9) return m + 1;
  }
  return null;
}

/** LTV ÷ CAC, or null when either is missing or CAC is zero. */
export const ltvToCac = (ltv: number | null, cac: number | null) => (ltv != null && cac != null && cac > 0 ? ltv / cac : null);

/** Cost per new paying customer implied by a scenario: CPI ÷ (trial rate × trial to paid). */
export function scenarioCac(s: Scenario): number | null {
  const conversion = s.trialRate * s.trialToPaid;
  return conversion > 0 && s.cpi > 0 ? s.cpi / conversion : null;
}

export type LtvBasis = "manual" | "cohort" | "model" | "first_purchase";
export interface ChosenLtv { value: number | null; basis: LtvBasis; source: string; period?: string }

export interface CohortLtv { value: number; cohorts: number; payers: number; period: string }

/**
 * RevenueCat's realized LTV per paying customer by cohort, at ONE period for every cohort: the most
 * advanced period that cohorts holding at least half of the paying customers have reached, averaged
 * over the cohorts that reached it (weighted by their paying customers). Realized to date.
 */
export function cohortLtv(rows: RcRow[], chart = "ltv_paying"): CohortLtv | null {
  const cohorts = new Map<string, { size: number; periods: Map<number, { value: number; name: string }> }>();
  for (const r of rows) {
    if (r.chart !== chart) continue;
    const index = Number(r.segment);
    if (!Number.isInteger(index) || r.segment === "") continue;
    const c = cohorts.get(r.date) ?? { size: 0, periods: new Map() };
    if (index === 0) c.size = r.value;
    else c.periods.set(index, { value: r.value, name: r.measure });
    cohorts.set(r.date, c);
  }
  const usable = [...cohorts.values()].filter((c) => c.size > 0 && c.periods.size > 0);
  const totalPayers = usable.reduce((s, c) => s + c.size, 0);
  if (!totalPayers) return null;
  const indexes = [...new Set(usable.flatMap((c) => [...c.periods.keys()]))].sort((a, b) => b - a);
  for (const index of indexes) {
    const reached = usable.filter((c) => c.periods.has(index));
    const payers = reached.reduce((s, c) => s + c.size, 0);
    if (payers * 2 < totalPayers) continue;
    const value = reached.reduce((s, c) => s + c.periods.get(index)!.value * c.size, 0) / payers;
    return { value, cohorts: reached.length, payers, period: reached[0].periods.get(index)!.name };
  }
  return null;
}

/**
 * The LTV the page counts: the team's own number; else RevenueCat's realized cohort LTV; else the
 * model (only when its prices are real: new-subscription revenue or prices the team saved); else the
 * value of a first purchase. Proceeds never set a price.
 */
export function chooseLtv(manual: number | null, cohort: CohortLtv | null, model: LtvModel | null, firstPurchase: number | null): ChosenLtv {
  if (manual != null && manual >= 0) return { value: manual, basis: "manual", source: "set by you" };
  if (cohort) return { value: cohort.value, basis: "cohort", source: "RevenueCat", period: cohort.period };
  if (model && model.perPayer > 0) return { value: model.perPayer, basis: "model", source: "modelled" };
  if (firstPurchase != null && firstPurchase > 0) return { value: firstPurchase, basis: "first_purchase", source: "RevenueCat" };
  return { value: null, basis: "model", source: "" };
}

// MARK: CAC → first purchase

export interface FirstPurchaseCost { value: number | null; customers: number; source: string }

/** Cost per first purchase: spend ÷ first purchases from the first source that has any, in the order given. */
export function costPerFirstPurchase(spend: number, sources: { source: string; customers: number }[]): FirstPurchaseCost {
  const found = sources.find((s) => s.customers > 0);
  if (!found) return { value: null, customers: 0, source: sources[0]?.source ?? "" };
  return { value: spend > 0 ? spend / found.customers : null, customers: found.customers, source: found.source };
}

export interface TimeToFirstPurchase {
  source: "revenuecat" | "mixpanel" | null;
  /** Median days from first open to first paid purchase, interpolated between RevenueCat's windows. Null with fewer than two windows. */
  medianDays: number | null;
  meanDays: number | null;
  /** Share of converters (paid by the last window) in each window. Empty with fewer than two windows. */
  buckets: { from: number; to: number; share: number }[];
  /** The windows read, each with the share of new customers who had paid by its end. */
  windows: { days: number; rate: number }[];
  /** Customers behind the numbers (RevenueCat: new customers in finished cohorts; Mixpanel: converters). */
  basis: number;
  /** RevenueCat had a window or more but not enough to spread converters over. */
  notEnough: boolean;
}

/** The share of a cohort that paid, from a conversion_to_paying cohort row set: a "%"/rate column, else a count ÷ cohort size. */
function payingRate(periods: Map<number, { value: number; name: string }>, size: number): number | null {
  const entries = [...periods.entries()].filter(([i]) => i > 0);
  // A rate column ("Conversion %", "Conversion rate"): percent (RevenueCat's way) or a fraction.
  const rate = entries.find(([, p]) => /%|rate/i.test(p.name));
  if (rate) return rate[1].value > 1 ? rate[1].value / 100 : rate[1].value;
  // Otherwise a count of paying customers ÷ the cohort's size.
  const count = entries[0];
  return count && size > 0 ? count[1].value / size : null;
}

/**
 * Days from install to first PAID purchase. RevenueCat's conversion_to_paying chart, one read per
 * conversion window (3, 7, 14, 30 days, stored as paying_conversion_<days>), gives the share of each
 * day's new customers who had paid by each window's end. With two windows or more, converters are
 * spread across them for a distribution and an interpolated median; with one, nothing is invented.
 * Otherwise a Mixpanel saved funnel's mean time to convert.
 */
export function timeToFirstPurchase(rc: RcRow[], mp: MixpanelRow[]): TimeToFirstPurchase {
  const windows: { days: number; rate: number; size: number }[] = [];
  const charts = new Set(rc.map((r) => r.chart).filter((c) => /^paying_conversion_\d+$/.test(c)));
  for (const chart of charts) {
    const days = Number(chart.split("_").pop());
    const cohorts = new Map<string, { size: number; periods: Map<number, { value: number; name: string }> }>();
    for (const r of rc) {
      if (r.chart !== chart) continue;
      const index = Number(r.segment);
      if (!Number.isInteger(index) || r.segment === "") continue;
      const c = cohorts.get(r.date) ?? { size: 0, periods: new Map() };
      if (index === 0) c.size = r.value; else c.periods.set(index, { value: r.value, name: r.measure });
      cohorts.set(r.date, c);
    }
    let paid = 0, size = 0;
    for (const c of cohorts.values()) {
      const rate = payingRate(c.periods, c.size);
      if (rate == null || c.size <= 0) continue;
      paid += Math.min(1, rate) * c.size; size += c.size;
    }
    if (size > 0) windows.push({ days, rate: paid / size, size });
  }
  windows.sort((a, b) => a.days - b.days);
  const shown = windows.map(({ days, rate }) => ({ days, rate }));
  const end = windows[windows.length - 1];
  if (windows.length >= 2 && end.rate > 0) {
    let last = 0;
    const points = windows.map((p) => { last = Math.max(last, Math.min(1, p.rate / end.rate)); return { days: p.days, share: last }; });
    const buckets: TimeToFirstPurchase["buckets"] = [];
    let from = 0, before = 0;
    for (const p of points) { buckets.push({ from, to: p.days, share: p.share - before }); before = p.share; from = p.days + 1; }
    let medianDays: number | null = null, prev = { days: 0, share: 0 };
    for (const p of points) {
      if (p.share >= 0.5) {
        const span = p.share - prev.share;
        medianDays = span > 0 ? prev.days + ((0.5 - prev.share) / span) * (p.days - prev.days) : p.days;
        break;
      }
      prev = p;
    }
    const meanDays = buckets.reduce((s, b) => s + b.share * ((b.from + b.to) / 2), 0);
    return { source: "revenuecat", medianDays, meanDays, buckets, windows: shown, basis: Math.round(end.size), notEnough: false };
  }
  const seconds = mp.filter((r) => r.metric === "ttc_seconds");
  const conversions = new Map(mp.filter((r) => r.metric === "ttc_conversions").map((r) => [r.date, r.value]));
  let weighted = 0, converted = 0;
  for (const r of seconds) { const n = conversions.get(r.date) ?? 0; weighted += r.value * n; converted += n; }
  if (converted > 0) return { source: "mixpanel", medianDays: null, meanDays: weighted / converted / 86_400, buckets: [], windows: shown, basis: converted, notEnough: windows.length > 0 };
  return { source: windows.length ? "revenuecat" : null, medianDays: null, meanDays: null, buckets: [], windows: shown, basis: end ? Math.round(end.size) : 0, notEnough: windows.length > 0 };
}

// MARK: Projection

export interface ProjectionMonth {
  month: number; spend: number; installs: number; trials: number; newPayers: number;
  subscribers: number; revenue: number; profit: number; cumulativeRevenue: number; cumulativeProfit: number;
}

export interface Projection {
  months: ProjectionMonth[];
  /** Cost per new paying customer the scenario implies. */
  cac: number | null;
  /** Month a single month's cohort earns back its own ad spend (1 = its first month), or null within the horizon. */
  paybackMonth: number | null;
  /** First month in which cumulative profit reaches zero, or null within the horizon. */
  breakEvenMonth: number | null;
  /** Cumulative profit if conversion is 20% worse and churn 25% higher, and if 20% better and churn 20% lower. */
  band: { low: number[]; high: number[] };
  ltv: LtvModel;
}

function run(s: Scenario): ProjectionMonth[] {
  const n = Math.max(1, Math.round(s.months));
  const cash = payerCashflow(s, n);
  const spend = Math.max(0, s.dailySpend) * DAYS_PER_MONTH;
  const installs = s.cpi > 0 ? spend / s.cpi : 0;
  const trials = installs * s.trialRate;
  const newPayers = trials * s.trialToPaid;
  const out: ProjectionMonth[] = [];
  let cumRevenue = 0, cumProfit = 0;
  for (let m = 0; m < n; m++) {
    let revenue = 0, subscribers = 0;
    for (let age = 0; age <= m; age++) { revenue += newPayers * cash[age]; subscribers += newPayers * stillActive(s, age); }
    const profit = revenue - spend;
    cumRevenue += revenue; cumProfit += profit;
    out.push({ month: m + 1, spend, installs, trials, newPayers, subscribers, revenue, profit, cumulativeRevenue: cumRevenue, cumulativeProfit: cumProfit });
  }
  return out;
}

/** Twelve months (or `months`) of steady spend: new payers each month, renewals stacking up, revenue, profit and break-even. */
export function project(scenario: Scenario): Projection {
  const s = cleanScenario(scenario) ?? DEFAULT_SCENARIO;
  const months = run(s);
  const cac = scenarioCac(s);
  const breakEven = months.find((m) => m.cumulativeProfit >= 0 && m.spend + m.revenue > 0);
  const worse = run({ ...s, trialToPaid: s.trialToPaid * 0.8, monthlyChurn: Math.min(1, s.monthlyChurn * 1.25), annualRenewal: s.annualRenewal * 0.8 });
  const better = run({ ...s, trialToPaid: Math.min(1, s.trialToPaid * 1.2), monthlyChurn: s.monthlyChurn * 0.8, annualRenewal: Math.min(1, s.annualRenewal * 1.2) });
  return {
    months, cac,
    paybackMonth: paybackMonth(cac, payerCashflow(s, s.months)),
    breakEvenMonth: breakEven ? breakEven.month : null,
    band: { low: worse.map((m) => m.cumulativeProfit), high: better.map((m) => m.cumulativeProfit) },
    ltv: modelLtv(s),
  };
}

// MARK: Prefilling from the data

export type ScenarioField = Exclude<keyof Scenario, "months">;
/** The tag shown next to a plan list whose prices couldn't be read: the team enters them. */
export const NEEDS_PRICE = "needs your price";

export interface Observed {
  /** USD spent over `days` (already converted), or null when there's no ad spend source. */
  spend: number | null; days: number;
  /** Installs the ads brought (AppStack, else Meta). CPI comes from these. */
  attributedInstalls: { value: number; source: string } | null;
  /** Every install (Mixpanel, organic included): CPI from these is blended and labelled so. */
  allInstalls: { value: number; source: string } | null;
  trials: { value: number; source: string } | null;
  trialToPaid: { value: number; source: string } | null;
  plans: PlanObservation[];
  monthlyChurn: number | null; refundRate: number | null;
  storeFee?: number;
}

/**
 * A scenario from what the sources saw in the period, each field marked with where it came from
 * ("default" when nothing had it). An observed zero is kept (0% trial to paid is an answer); only a
 * missing value falls back to the default.
 */
export function scenarioFromData(o: Observed, base: Scenario = DEFAULT_SCENARIO): { scenario: Scenario; sources: Record<ScenarioField, string>; blendedCpi: boolean } {
  const sources = {} as Record<ScenarioField, string>;
  const pick = <K extends ScenarioField>(field: K, value: Scenario[K] | null | undefined, source: string): Scenario[K] => {
    const ok = value != null && (typeof value !== "number" || (Number.isFinite(value) && value >= 0));
    sources[field] = ok ? source : "default";
    return ok ? value! : base[field];
  };
  const ratio = (a: number | null | undefined, b: number | null | undefined) => (a != null && b != null && b > 0 ? a / b : null);
  const storeFee = pick("storeFee", o.storeFee, "your setting");
  const dailySpend = pick("dailySpend", o.spend == null ? null : ratio(o.spend, o.days), "Meta");
  // CPI from the installs the ads brought; from every install only when that's all there is, and then blended.
  const installs = o.attributedInstalls && o.attributedInstalls.value > 0 ? o.attributedInstalls : o.allInstalls && o.allInstalls.value > 0 ? o.allInstalls : null;
  const blendedCpi = installs != null && installs === o.allInstalls;
  const cpi = pick("cpi", o.spend == null ? null : ratio(o.spend, installs?.value), blendedCpi ? `${installs!.source} (blended)` : installs?.source ?? "");
  const trialBase = o.allInstalls && o.allInstalls.value > 0 ? o.allInstalls : installs;
  const trialRate = pick("trialRate", o.trials ? (() => { const r = ratio(o.trials.value, trialBase?.value); return r == null ? null : Math.min(1, r); })() : null, o.trials?.source ?? "");
  const trialToPaid = pick("trialToPaid", o.trialToPaid ? Math.min(1, o.trialToPaid.value) : null, o.trialToPaid?.source ?? "");
  const fromData = plansFromData(o.plans);
  sources.plans = fromData.plans.length ? (fromData.priced ? "RevenueCat" : NEEDS_PRICE) : "default";
  const scenario: Scenario = {
    dailySpend, cpi, trialRate, trialToPaid,
    // Shares from the data even when its prices are missing (then 0, for the team to fill in).
    plans: fromData.plans.length ? fromData.plans : base.plans,
    monthlyChurn: pick("monthlyChurn", o.monthlyChurn, "RevenueCat"),
    annualRenewal: base.annualRenewal,
    refundRate: pick("refundRate", o.refundRate, "RevenueCat"),
    storeFee, months: base.months,
  };
  sources.annualRenewal = "default";
  return { scenario, sources, blendedCpi };
}

/** USD from an amount in another currency at `rate` (USD per unit). No rate: null, never a guess. */
export const toUsd = (amount: number, rate: number | null | undefined) => (rate != null && rate > 0 && Number.isFinite(amount) ? amount * rate : null);
