// The operating model: every connected source's numbers for one period, turned into the few that run
// a subscription app (spend, revenue, CAC, LTV, LTV:CAC, payback, the funnel, time to first purchase)
// with the source each came from. Measure's operating sections and the app Home's "Business" card both
// read it. Pure, so it is tested with the rest of the math (unit-economics.test.ts).
import {
  groups, headlineCustomers, isMetaSource, metrics, mixpanel, money, rcMonthlyChurn, rcPlanObservations, rcRefundRate, revenuecat, SOURCES, superwall, totals, truthFor,
  type Group, type Headline, type MeasureData, type MixpanelSummary, type RcSummary, type Source, type SuperwallSummary, type Totals,
} from "./measure";
import {
  chooseLtv, cleanScenario, cohortLtv, costPerFirstPurchase, ltvToCac, modelLtv, netPrice, payerCashflow, paybackMonth, scenarioFromData, timeToFirstPurchase,
  type ChosenLtv, type CohortLtv, type FirstPurchaseCost, type Observed, type Scenario, type ScenarioField, type TimeToFirstPurchase,
} from "./unit-economics";

/** A number with the source it came from ("Meta", "RevenueCat"…) and, for money, its currency. */
export interface Sourced { value: number; source: string; currency?: string }

export interface Operating {
  connected: Source[];
  /** Spend is in USD (or no Meta at all), so it can be set against revenue. */
  comparable: boolean;
  spend: number;
  /** Spend's currency: USD, or the ad account's when no exchange rate is stored yet. */
  spendCurrency: string;
  revenue: Sourced | null;
  headline: Headline;
  /** Spend ÷ paying customers from the headline source; blended when that source counts everyone. */
  cac: (Sourced & { blended: boolean }) | null;
  firstPurchase: FirstPurchaseCost;
  timeToFirstPurchase: TimeToFirstPurchase;
  /** The LTV every figure on Measure and Home uses (manual, cohort, model or first purchase). */
  ltv: ChosenLtv;
  /** The modelled LTV per payer (null while plan prices are unknown), shown beside the counted one. */
  model: number | null;
  cohort: (CohortLtv & { gross?: boolean }) | null;
  /** The CAC LTV:CAC and payback divide by: the headline CAC, else the cost per first purchase. */
  cacUsed: number | null;
  ltvCac: number | null;
  /** First month a customer's net cash covers CAC; cash follows the plan mix and renewals, scaled to the LTV shown. */
  paybackMonth: number | null;
  funnel: { impressions: Sourced | null; installs: Sourced | null; trials: Sourced | null; paid: Sourced | null };
  /** The scenario prefilled from this period (or the saved one), with where each number came from. */
  scenario: Scenario;
  scenarioSources: Record<ScenarioField, string>;
  saved: boolean;
  /** The plan prices are real (new-subscription revenue, or saved by the team). Otherwise the panel asks for them. */
  priced: boolean;
  /** CPI came from every install (organic included): label it blended. */
  blendedCpi: boolean;
  rc: RcSummary; mp: MixpanelSummary; sw: SuperwallSummary; t: Totals;
  creatives: Group[];
}

const positive = (value: number, source: string, currency?: string): Sourced | null => (value > 0 ? { value, source, ...(currency ? { currency } : {}) } : null);
const first = (...options: (Sourced | null)[]) => options.find((o) => o != null) ?? null;

export function operating(data: MeasureData): Operating {
  const m = money(data);
  const rate = m.rate ?? 1;
  const comparable = m.currency === "USD";
  const { since } = data.range;
  const inRange = (d: string) => d >= since;
  const metaCur = data.meta.filter((r) => inRange(r.date));
  const asCur = data.appstack.filter((r) => inRange(r.date) && isMetaSource(r.media_source));
  const t = totals(metaCur, asCur, rate);
  const rcRows = data.revenuecat.filter((r) => inRange(r.date));
  const rc = revenuecat(data, rcRows);
  // Retention reads every cohort loaded (the period and the month before it); the funnel only the period.
  const mpCur = data.mixpanel.filter((r) => inRange(r.date) || r.metric.startsWith("retention"));
  const mp = mixpanel(data, mpCur);
  const sw = superwall(data, data.superwall.filter((r) => inRange(r.date)));
  const { headline, split } = truthFor(data);
  const ok = (s: Source) => data.sync[s]?.status === "ok";
  const connected = SOURCES.filter((s) => ok(s));
  const attributed = metrics(t, split);
  const splitName = split === "appstack" ? "AppStack" : "Meta";
  const hasSpend = ok("meta") || data.meta.length > 0;

  const revenue = first(
    ok("revenuecat") ? positive(rc.revenue, "RevenueCat", "USD") : null,
    ok("superwall") ? positive(sw.revenue, "Superwall", "USD") : null,
    // AppStack reports USD; Meta's purchase value is in the spend's currency.
    positive(attributed.revenue, splitName, split === "appstack" ? "USD" : m.currency),
  );
  const customers = headlineCustomers(headline, t, rc, mp, sw);
  const headlineName = { meta: "Meta", appstack: "AppStack", revenuecat: "RevenueCat", mixpanel: "Mixpanel", superwall: "Superwall" }[headline];
  const cac = t.spend > 0 && customers > 0 && comparable ? { value: t.spend / customers, source: headlineName, currency: "USD", blended: !(headline === "meta" || headline === "appstack") } : null;

  const mpPurchases = mp.funnel.find((f) => f.step === "purchase")?.users ?? 0;
  const firstPurchase = costPerFirstPurchase(comparable ? t.spend : 0, [
    { source: splitName, customers: t[split].purchases },
    { source: "RevenueCat", customers: ok("revenuecat") ? rc.newPaid : 0 },
    { source: "Superwall", customers: ok("superwall") ? sw.conversions : 0 },
    { source: "Mixpanel", customers: ok("mixpanel") ? mpPurchases : 0 },
  ]);

  // The funnel shows every install (Mixpanel's, organic included) when it has them; CPI uses the ads' own.
  const attributedInstalls = first(positive(t[split].installs, splitName), positive(t.meta.installs, "Meta"));
  const allInstalls = ok("mixpanel") ? positive(mp.funnel[0].users, "Mixpanel") : null;
  const installs = first(allInstalls, attributedInstalls);
  const trials = first(
    ok("revenuecat") ? positive(rc.trials, "RevenueCat") : null,
    ok("superwall") ? positive(sw.trials, "Superwall") : null,
    ok("mixpanel") ? positive(mp.funnel.find((f) => f.step === "trial")?.users ?? 0, "Mixpanel") : null,
    positive(t[split].trials, splitName),
  );
  const paid = first(
    ok("revenuecat") ? positive(rc.newPaid, "RevenueCat") : null,
    ok("superwall") ? positive(sw.conversions, "Superwall") : null,
    ok("mixpanel") ? positive(mpPurchases, "Mixpanel") : null,
    positive(t[split].purchases, splitName),
  );
  const trialToPaid = ok("revenuecat") && rc.conversionRate != null && rc.trialStarts > 0 ? { value: rc.conversionRate, source: "RevenueCat" }
    : trials && paid && paid.source === trials.source ? { value: Math.min(1, paid.value / trials.value), source: trials.source } : null;

  const plans = rcPlanObservations(rcRows);
  const observed: Observed = {
    spend: hasSpend && comparable ? t.spend : null, days: data.range.days,
    attributedInstalls, allInstalls, trials, trialToPaid, plans,
    monthlyChurn: rcMonthlyChurn(rcRows),
    refundRate: ok("revenuecat") ? rcRefundRate(rcRows, rc) : sw.revenue + sw.refunds > 0 ? sw.refunds / (sw.revenue + sw.refunds) : null,
  };
  const prefilled = scenarioFromData(observed);
  const saved = cleanScenario(data.settings.scenario ?? null, prefilled.scenario);
  const scenario = saved ?? prefilled.scenario;
  // The model counts only with real prices: new-subscription revenue, or a scenario the team saved.
  const priced = Boolean(saved) || prefilled.sources.plans === "RevenueCat";
  const model = priced ? modelLtv(scenario) : null;
  // Cohorts are read across everything loaded: a recent one hasn't finished its window yet. Proceeds
  // match the model; the gross chart (when RevenueCat refused proceeds) is brought to net by the store fee.
  const net = cohortLtv(data.revenuecat);
  const grossCohort = net ? null : cohortLtv(data.revenuecat, "ltv_paying_gross");
  const cohort = net ?? (grossCohort ? { ...grossCohort, value: netPrice(grossCohort.value, scenario.storeFee, 0), gross: true } : null);
  // What a first purchase leaves: new-subscription revenue (net of taxes) per transaction, after the store fee and refunds.
  const newRevenue = plans.reduce((s, p) => s + (p.newRevenue ?? 0), 0);
  const newTransactions = plans.reduce((s, p) => s + (p.newTransactions ?? 0), 0);
  const firstValue = newTransactions > 0 ? netPrice(newRevenue / newTransactions, scenario.storeFee, scenario.refundRate) : null;
  const ltv = chooseLtv(data.settings.ltv_basis === "manual" ? data.settings.ltv_manual : null, cohort, model, firstValue);
  const cacUsed = cac?.value ?? firstPurchase.value;
  // Payback: cash over time follows the plan mix and renewals (unit prices while prices are unknown), scaled to the LTV shown.
  const shape = payerCashflow(priced ? scenario : { ...scenario, plans: scenario.plans.map((p) => ({ ...p, price: 1 })) }, 36);
  const shapeTotal = shape.slice(0, 24).reduce((a, b) => a + b, 0);
  const scaled = ltv.value != null && shapeTotal > 0 ? shape.map((v) => (v * ltv.value!) / shapeTotal) : [];

  return {
    connected, comparable, spend: t.spend, spendCurrency: m.currency, revenue, headline, cac, firstPurchase,
    timeToFirstPurchase: timeToFirstPurchase(data.revenuecat, data.mixpanel.filter((r) => inRange(r.date))),
    ltv, model: model?.perPayer ?? null, cohort, cacUsed,
    ltvCac: comparable ? ltvToCac(ltv.value, cacUsed) : null,
    paybackMonth: comparable ? paybackMonth(cacUsed, scaled) : null,
    funnel: { impressions: positive(t.impressions, "Meta"), installs, trials, paid },
    scenario, scenarioSources: saved ? Object.fromEntries(Object.keys(prefilled.sources).map((k) => [k, "saved"])) as Record<ScenarioField, string> : prefilled.sources,
    saved: Boolean(saved), priced, blendedCpi: !saved && prefilled.blendedCpi,
    rc, mp, sw, t,
    creatives: groups(data, "creative", metaCur, asCur, rate, split),
  };
}

// MARK: The app Home's summary

export type NeedItem =
  | { kind: "sync_failed"; source: Source; message: string }
  | { kind: "no_customers"; name: string; fallbackName: string | null; spend: number }
  | { kind: "above_target"; cac: number; ltv: number }
  | { kind: "ready_to_scale"; name: string; fallbackName: string | null; cac: number }
  | { kind: "missing_events"; events: string[] };

export interface AdLine {
  name: string;
  /** Set when Meta gave no name: the English stand-in to show with t() instead of `name`. */
  fallbackName: string | null;
  thumbnail: string | null; spend: number; customers: number; cac: number | null }

export interface BusinessSummary {
  connected: Source[];
  /** Something is connected (saved IDs), even if it hasn't synced yet. */
  anyConnection: boolean;
  lastSync: string | null;
  days: number;
  /** Spend's currency (USD, or the ad account's when no exchange rate is stored). Revenue and CAC carry their own. */
  currency: string;
  spend: number | null;
  revenue: Sourced | null;
  cac: (Sourced & { blended: boolean }) | null;
  ltv: ChosenLtv;
  ltvCac: number | null;
  paybackMonth: number | null;
  funnel: Operating["funnel"];
  best: AdLine | null;
  worst: AdLine | null;
  needs: NeedItem[];
}

const line = (g: Group): AdLine => ({ name: g.name, fallbackName: g.fallbackName, thumbnail: g.thumbnail, spend: g.m.spend, customers: g.m.purchases, cac: g.m.cac });

export function businessSummary(data: MeasureData): BusinessSummary {
  const o = operating(data);
  const spenders = o.creatives.filter((g) => g.m.spend > 0);
  const converting = spenders.filter((g) => g.m.cac != null).sort((a, b) => a.m.cac! - b.m.cac!);
  const best = converting[0] ?? null;
  // Worst: the biggest spender with no customer, else the costliest customer (never the best one).
  const worst = spenders.filter((g) => !g.m.purchases).sort((a, b) => b.m.spend - a.m.spend)[0]
    ?? (converting.length > 1 ? converting[converting.length - 1] : null);
  const ltv = o.comparable ? o.ltv.value : null;
  const needs: NeedItem[] = [];
  for (const s of SOURCES) if (data.sync[s]?.status === "error") needs.push({ kind: "sync_failed", source: s, message: data.sync[s]!.message ?? "" });
  if (ltv != null && o.cac && o.cac.value > ltv) needs.push({ kind: "above_target", cac: o.cac.value, ltv });
  if (ltv != null) {
    const burner = spenders.filter((g) => !g.m.purchases && g.m.spend >= ltv).sort((a, b) => b.m.spend - a.m.spend)[0];
    if (burner) needs.push({ kind: "no_customers", name: burner.name, fallbackName: burner.fallbackName, spend: burner.m.spend });
    const winner = converting.find((g) => g.role === "testing" && g.m.cac! <= ltv * 0.7 && g.m.purchases >= 2);
    if (winner) needs.push({ kind: "ready_to_scale", name: winner.name, fallbackName: winner.fallbackName, cac: winner.m.cac! });
  }
  if (o.mp.connected && o.mp.missing.length) needs.push({ kind: "missing_events", events: o.mp.missing });
  const c = data.workspace.connected;
  return {
    connected: o.connected,
    anyConnection: SOURCES.some((s) => c[s]),
    lastSync: Object.values(data.sync).map((s) => s!.synced_at).sort().pop() ?? null,
    days: data.range.days,
    currency: o.spendCurrency,
    spend: data.sync.meta?.status === "ok" || data.meta.length ? o.spend : null,
    revenue: o.revenue,
    cac: o.cac,
    ltv: o.ltv,
    ltvCac: o.ltvCac,
    paybackMonth: o.paybackMonth,
    funnel: o.funnel,
    best: best ? line(best) : null,
    worst: worst && worst !== best ? line(worst) : null,
    needs: needs.slice(0, 4),
  };
}
