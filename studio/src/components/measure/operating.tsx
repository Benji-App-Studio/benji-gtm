"use client";
// Measure's operating dashboard: the sections that turn the sources into the numbers an app is run by.
//   Unit economics   CAC → first purchase (cost and days to it), CAC → LTV (modelled, cohorts beside it), payback
//   Projection       a scenario prefilled from the data, 12 months of subscribers, revenue and profit
//   RevenueCat       revenue, MRR, trials, new paid, churn and refunds per day
//   Superwall        paywall views and conversion, by paywall and by placement
//   Mixpanel         the mapped funnel, the retention curve and active users
// Each section stands alone: a source that isn't connected shows where to connect it, the rest still work.
// Every number says how it's calculated and which source it came from.
import { useMemo, useState, type ReactNode } from "react";
import { LineChart, RankBars } from "@/components/charts";
import { Button, cx, inputClass, Locked, Spinner } from "@/components/ui";
import type { Operating } from "@/lib/business-summary";
import { useT } from "@/lib/i18n/client";
import { formatMoney } from "@/lib/i18n/format";
import { syncMessage } from "./sync-words";
import type { Translator } from "@/lib/i18n/translate";
import { dayList, MIXPANEL_STEPS, rcDaily, rcLevel, SOURCE_NAME, type MeasureData, type MixpanelStep } from "@/lib/measure";
import { NEEDS_PRICE, PLAN_PERIODS, project, type Scenario, type ScenarioField } from "@/lib/unit-economics";
import { BandLine, HatchedBars, hatch, Readout } from "./charts";
import { HowLabel, KeyValue, Kpi, Panel, PanelHead, Segmented } from "./kit";

export type Gate = { title: string; body: string; href: string; action: string };

// MARK: Formatting (the viewer's language)

export function useFormat() {
  const tr = useT();
  return useMemo(() => formatters(tr), [tr]);
}

export function formatters({ intl, t }: Translator) {
  // The one money format (lib/i18n/format.ts): 2 decimals under 100, whole amounts above, short from 10,000.
  const money = (n: number | null | undefined, currency = "USD") => formatMoney(intl, n, currency, { compact: true });
  const count = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "–" : new Intl.NumberFormat(intl, { notation: Math.abs(n) >= 100_000 ? "compact" : "standard", maximumFractionDigits: Math.abs(n) < 10 && n % 1 ? 1 : 0 }).format(n));
  const pct = (n: number | null | undefined, digits = 1) => (n == null || !Number.isFinite(n) ? "–" : new Intl.NumberFormat(intl, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n));
  const times = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "–" : `${new Intl.NumberFormat(intl, { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n)}×`);
  const days = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "–" : t("{n} days", { n: Math.round(n * 10) / 10 }));
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(intl, { month: "short", day: "numeric", timeZone: "UTC" });
  const month = (n: number | null | undefined) => (n == null ? t("Not within the horizon") : n === 0 ? t("Right away") : t("Month {n}", { n }));
  return { money, count, pct, times, days, day, month };
}

/** A RevenueCat cohort period ("Day 30", "Month 3") in words; other names stay as RevenueCat wrote them. */
function periodName(t: Translator["t"], period: string | null | undefined): string {
  const m = /^(day|week|month|year)\s+(\d+)$/i.exec(period?.trim() ?? "");
  if (!m) return period ?? "";
  const n = Number(m[2]);
  switch (m[1].toLowerCase()) {
    case "day": return t("Day {n}", { n });
    case "week": return t("Week {n}", { n });
    case "month": return t("Month {n}", { n });
    default: return t("Year {n}", { n });
  }
}

/** "from RevenueCat", "default", "saved"… for a number's source tag. */
function sourceTag(t: Translator["t"], source: string): string {
  if (!source || source === "default") return t("default");
  if (source === "saved") return t("saved");
  if (source === "your setting") return t("your setting");
  if (source === NEEDS_PRICE) return t("needs your price");
  if (source.endsWith(" (blended)")) return t("blended, from {source}", { source: source.replace(/ \(blended\)$/, "") });
  return t("from {source}", { source });
}

function SourceChip({ source }: { source: string }) {
  const { t } = useT();
  return <span className={cx("inline-flex h-5 items-center rounded-full border px-1.5 text-[11px] font-normal whitespace-nowrap", source === NEEDS_PRICE ? "border-caution text-ink" : "border-hairline", source === "default" || !source ? "text-faint" : "text-muted")}>{sourceTag(t, source)}</span>;
}

function GateLine({ gate, className }: { gate: Gate; className?: string }) {
  return <Locked href={gate.href} action={gate.action} className={className}>{gate.title}</Locked>;
}

/** A section's heading row across the page. */
function SectionTitle({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-8 mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-group font-medium text-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-caption text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

// MARK: Unit economics

export function EconomicsSection({ data, o }: { data: MeasureData; o: Operating }) {
  const { t } = useT();
  const f = useFormat();
  const ttfp = o.timeToFirstPurchase;
  const fp = o.firstPurchase;
  const ltv = o.ltv.value;
  const cac = o.cac?.value ?? fp.value;
  const basisLabel = o.ltv.basis === "manual" ? t("set by you") : o.ltv.basis === "model" ? t("modelled") : o.ltv.basis === "cohort" ? t("RevenueCat cohorts") : t("first purchase");
  // Per trial and per install follow the LTV shown, whatever its basis.
  const perTrial = ltv == null ? null : ltv * o.scenario.trialToPaid;
  const perInstall = perTrial == null ? null : perTrial * o.scenario.trialRate;
  const ltvHow = o.ltv.basis === "manual" ? t("The LTV you set on the cost card. Choose From your data there to use RevenueCat's cohorts or the model.")
    : o.ltv.basis === "cohort" ? t("RevenueCat's realized LTV per paying customer at {period}, the same period for every cohort counted, weighted by paying customers. It is what customers have paid so far, so it grows as cohorts age. The model from your plan prices is shown below for comparison.", { period: periodName(t, o.ltv.period) })
    : o.ltv.basis === "model" ? t("Modelled from the scenario below: each plan's price after tax, less the store's fee and refunds, times the renewals you can expect (monthly churn, annual renewal), over 24 months, weighted by the plan mix.")
    : t("What a first purchase leaves: new-subscription revenue after tax per transaction, less the store's fee and refunds. Renewals aren't counted until RevenueCat has cohorts or you enter plan prices.");
  return (
    <>
      <SectionTitle title={t("Unit economics")} sub={t("What a paying customer costs, what they're worth and when they pay back. Last {n} days, USD.", { n: data.range.days })} />
      <div className="grid gap-3 @4xl:grid-cols-2">
        <Panel className="flex flex-col p-4">
          <PanelHead title={t("CAC to first purchase")} sub={fp.customers ? t("{n} first purchases counted by {source}", { n: Math.round(fp.customers), source: fp.source }) : t("No first purchases in this period yet")} />
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-figure font-medium text-ink tabular-nums">{f.money(fp.value)}</span>
            <span className="text-caption text-muted">{t("per first purchase")}</span>
          </div>
          <div className="mt-3">
            <KeyValue label={t("Cost per first purchase")} value={f.money(fp.value)} chip={fp.source ? <SourceChip source={fp.source} /> : undefined}
              how={t("Ad spend in the period ÷ first purchases in the period. Attributed purchases (AppStack, else Meta) are used when there are any; otherwise every new paid subscription (RevenueCat), Superwall purchases or Mixpanel's purchase event, in that order.")} />
            <KeyValue label={t("Median days to first purchase")} value={ttfp.medianDays != null ? f.days(ttfp.medianDays) : ttfp.notEnough ? t("Not enough data") : "–"} chip={ttfp.source ? <SourceChip source={SOURCE_NAME[ttfp.source]} /> : undefined}
              how={t("From RevenueCat's conversion to paying chart, read for 3, 7, 14 and 30 days: of each day's new customers, the share who had paid (a free trial doesn't count) by each window's end. Converters are spread across the windows and the median is read where half have paid. With fewer than two windows nothing is estimated. Mixpanel's saved funnel only gives a mean.")} />
            <KeyValue label={t("Mean days to first purchase")} value={f.days(ttfp.meanDays)}
              how={t("RevenueCat: the windows' midpoints weighted by their share of converters (those who paid within 30 days). Mixpanel: the saved funnel's mean time from its first step to its last, weighted by each day's converters.")} />
          </div>
          {ttfp.buckets.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-xs text-muted">{t("When customers first pay, after install")}</p>
              <DistributionBars buckets={ttfp.buckets} />
              <p className="mt-2 text-xs text-faint">{t("{n} new customers in finished cohorts", { n: ttfp.basis })}</p>
            </div>
          ) : (
            <p className="mt-4 rounded-inner border border-line bg-raised px-3 py-2 text-caption text-muted">
              {ttfp.notEnough
                ? t("RevenueCat returned {n} conversion window, too few to spread first purchases over. Sync again; the others may have been skipped.", { n: ttfp.windows.length })
                : ttfp.source === "mixpanel" ? t("Connect RevenueCat to see the spread, not just the mean.") : t("Days to first purchase need RevenueCat (conversion to paying) or a saved Mixpanel funnel from install to purchase.")}
            </p>
          )}
        </Panel>

        <Panel className="flex flex-col p-4">
          <PanelHead title={t("CAC to LTV")} sub={t("LTV basis: {basis}", { basis: basisLabel })} />
          <div className="mt-3 grid gap-px overflow-hidden rounded-inner border border-line bg-line @md:grid-cols-3">
            <Kpi label={t("LTV per paying customer")} value={f.money(ltv)} how={ltvHow} />
            <Kpi label={t("LTV : CAC")} value={f.times(o.ltvCac)} tone={o.ltvCac != null ? (o.ltvCac >= 3 ? "win" : o.ltvCac < 1 ? "warn" : undefined) : undefined}
              how={t("LTV ÷ CAC. CAC is the headline cost per paying customer (or the cost per first purchase when there's no headline). Above 1 a customer earns back what they cost; 3 is the usual healthy mark.")} />
            <Kpi label={t("Payback")} value={f.month(o.paybackMonth)} how={t("The first month in which a customer's cumulative net cash covers CAC. Cash over time follows the plan mix and renewals, scaled to the LTV shown. Month 1 is the month of the first charge, so an annual plan that covers CAC pays back in month 1.")} />
          </div>
          <div className="mt-3">
            <KeyValue label={t("CAC")} value={f.money(cac)} chip={o.cac ? <SourceChip source={o.cac.source} /> : fp.source ? <SourceChip source={fp.source} /> : undefined}
              how={o.cac?.blended ? t("Blended: ad spend ÷ every new paying customer the source counted, organic included. Real paid CAC is at or above it.") : t("Ad spend ÷ paying customers attributed to the ads.")} />
            <KeyValue label={t("LTV per trial start")} value={f.money(perTrial)} how={t("The LTV shown × trial to paid.")} />
            <KeyValue label={t("LTV per install")} value={f.money(perInstall)} how={t("LTV per trial start × the share of installs who start a trial. Compare it with your CPI.")} />
            <KeyValue label={t("Realized LTV (cohorts)")} value={o.cohort ? f.money(o.cohort.value) : "–"} chip={o.cohort ? <span className="text-xs font-normal text-muted">{periodName(t, o.cohort.period)}</span> : undefined}
              how={o.cohort?.gross ? t("RevenueCat's realized LTV per paying customer at one period for every cohort counted. RevenueCat sent it as revenue, so the store fee is taken off here.") : t("RevenueCat's realized LTV per paying customer (proceeds) at one period for every cohort counted, weighted by paying customers. Realized to date.")} />
            <KeyValue label={t("Modelled LTV")} value={o.model == null ? t("Needs plan prices") : f.money(o.model)}
              how={t("The 24-month model from the scenario's plan prices, renewals, refunds and store fee. It needs real prices: new-subscription revenue from RevenueCat, or prices you enter in the scenario.")} />
          </div>
          {cac != null && ltv != null && (
            <p className="mt-3 rounded-inner border border-line bg-raised px-3 py-2 text-caption text-muted">
              {ltv >= cac ? t("Each paying customer is worth {gap} more than they cost.", { gap: f.money(ltv - cac) }) : t("Each paying customer costs {gap} more than they're worth. Lower CAC or raise LTV before scaling.", { gap: f.money(cac - ltv) })}
            </p>
          )}
        </Panel>
      </div>
    </>
  );
}

/** Shares of converters per window: one hatched column each, the largest solid. */
function DistributionBars({ buckets }: { buckets: Operating["timeToFirstPurchase"]["buckets"] }) {
  const { t } = useT();
  const f = useFormat();
  const label = (b: (typeof buckets)[number]) => b.to == null ? t("After {n} days", { n: b.from - 1 }) : b.to === 0 ? t("Same day") : b.from === b.to ? t("Day {n}", { n: b.to }) : t("Days {from}–{to}", { from: b.from, to: b.to });
  const max = Math.max(...buckets.map((b) => b.share), 0.0001);
  const top = buckets.findIndex((b) => b.share === max);
  return (
    <div className="grid grid-cols-[minmax(92px,auto)_1fr_auto] items-center gap-x-3 gap-y-2 text-xs">
      {buckets.map((b, i) => (
        <div key={i} className="contents">
          <span className="text-label">{label(b)}</span>
          <span className="relative h-3 rounded-xs bg-control" aria-hidden>
            <span className="absolute inset-y-0 left-0 rounded-xs" style={{ width: `${(b.share / max) * 100}%`, ...(i === top ? { background: "var(--color-accent)" } : hatch("var(--color-accent)", false)) }} />
          </span>
          <span className="text-right font-medium text-ink tabular-nums">{f.pct(b.share, 0)}</span>
        </div>
      ))}
    </div>
  );
}

// MARK: Projection

type Draft = Scenario;
const PERCENT_FIELDS = new Set<ScenarioField>(["trialRate", "trialToPaid", "monthlyChurn", "annualRenewal", "refundRate"]);

export function ProjectionPanel({ o, save }: { o: Operating; save: (body: Record<string, unknown>) => Promise<void> }) {
  const { t } = useT();
  const f = useFormat();
  const [draft, setDraft] = useState<Draft>(o.scenario);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(o.scenario);
  const p = useMemo(() => project(draft), [draft]);
  const last = p.months[p.months.length - 1];
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const planLabel = (months: number) => months === 0 ? t("Lifetime") : Math.abs(months - 12 / 52) < 0.01 ? t("Weekly") : months === 1 ? t("Monthly") : months === 3 ? t("Quarterly") : months === 12 ? t("Annual")
    : Number.isInteger(months) ? t("Every {n} months", { n: months }) : t("Every {n} days", { n: Math.round(months * 30.4375) });

  async function persist(kind: "save" | "reset") {
    setBusy(kind);
    await save({ settings: { scenario: kind === "save" ? draft : null } });
    setBusy(null);
  }

  const field = (key: ScenarioField, label: string, how: string, step = "any") => {
    const percent = PERCENT_FIELDS.has(key);
    const raw = draft[key] as number;
    return (
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-xs text-label"><HowLabel label={<span>{label}</span>} how={how} /></span>
        <span className="relative">
          <input type="number" inputMode="decimal" step={step} min={0} value={Number.isFinite(raw) ? Math.round((percent ? raw * 100 : raw) * 100) / 100 : ""}
            onChange={(e) => { const n = Number(e.target.value); set(key, (percent ? n / 100 : n) as never); }}
            className={cx(inputClass, "pr-8 text-right tabular-nums")} aria-label={label} />
          <span className="pointer-events-none absolute inset-y-0 right-2.5 grid place-items-center text-xs text-faint">{percent ? "%" : "$"}</span>
        </span>
        <span><SourceChip source={o.scenarioSources[key]} /></span>
      </label>
    );
  };

  // The x-axis is the month number (it fits a phone); the hover card and the table name the month in full.
  const labels = p.months.map((m) => String(m.month));
  const monthName = (n: number) => t("Month {n}", { n });
  // Three ticks: the lowest point, zero (break-even) and the highest, so the axis reads in round places.
  const all = [...p.months.flatMap((m) => [m.cumulativeProfit, m.cumulativeRevenue]), ...p.band.low, ...p.band.high, 0];
  const ticks = [...new Set([Math.min(...all), 0, Math.max(...all)])].filter((v, i, list) => i === 0 || Math.abs(v - list[i - 1]) > 1e-6);
  return (
    <>
      <SectionTitle title={t("Projection")} sub={o.saved ? t("Your saved scenario. Change any number to see the next 12 months move.") : t("Prefilled from your last period's numbers. Change any number to see the next 12 months move.")}
        right={<div className="flex flex-wrap items-center gap-2">
          {(o.saved || dirty) && <Button variant="ghost" size="sm" onClick={() => (dirty && !o.saved ? setDraft(o.scenario) : void persist("reset"))} disabled={busy != null}>{busy === "reset" && <Spinner className="size-3.5" />}{o.saved ? t("Reset to my data") : t("Discard changes")}</Button>}
          <Button size="sm" onClick={() => void persist("save")} disabled={!dirty || busy != null}>{busy === "save" && <Spinner className="size-3.5" />}{t("Save scenario")}</Button>
        </div>} />
      <div className="grid gap-3 @5xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <Panel className="p-4">
          <PanelHead title={t("Scenario")} sub={t("Every number is editable. The tag says where it came from.")} />
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3">
            {field("dailySpend", t("Daily spend"), t("Ad spend per day. Prefilled: Meta spend in the period ÷ its days, in USD."))}
            {field("cpi", o.blendedCpi ? t("Cost per install (blended)") : t("Cost per install"), o.blendedCpi
              ? t("Blended: spend ÷ every install Mixpanel counted, organic included, because no ad attribution (AppStack or Meta installs) is connected. The real cost of an install from the ads is higher.")
              : t("Spend ÷ installs the ads brought (AppStack, else Meta). Organic installs aren't counted."))}
            {field("trialRate", t("Install to trial"), t("Trial starts ÷ installs. Prefilled from RevenueCat or Superwall trials (else Mixpanel or attribution) over the same installs."))}
            {field("trialToPaid", t("Trial to paid"), t("Trials that convert to paid. Prefilled from RevenueCat's trial conversion rate, else paid ÷ trials from one source."))}
            {field("monthlyChurn", t("Monthly churn"), t("Share of monthly subscribers lost each month (weekly and quarterly plans follow it too). Prefilled from RevenueCat's churn chart."))}
            {field("annualRenewal", t("Annual renewal"), t("Share of annual subscribers who renew after a year. RevenueCat needs a year of history to show it, so it starts at a typical 35%."))}
            {field("refundRate", t("Refund rate"), t("Share of revenue refunded. Prefilled from RevenueCat's refund rate, else Superwall's refunds ÷ revenue."))}
            <label className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center justify-between gap-2 text-xs text-label">
                <HowLabel label={<span>{t("Store fee")}</span>} how={t("The store's cut of each charge: 15% in the App Store Small Business Program and Google Play's first $1M (and for subscriptions after a year), 30% otherwise.")} />
              </span>
              <Segmented label={t("Store fee")} value={draft.storeFee >= 0.2 ? "0.3" : "0.15"} onChange={(v) => set("storeFee", Number(v))} options={[{ value: "0.15", label: "15%" }, { value: "0.3", label: "30%" }]} />
            </label>
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <div className="mb-2 flex items-center justify-between gap-2 text-xs text-label">
              <HowLabel label={<span>{t("Plans and price mix")}</span>} how={t("Gross price and share of new paying customers for each plan. Prefilled from RevenueCat's proceeds and new paid subscriptions by product duration, grossed back up by the store fee (an estimate: proceeds also hold renewals).")} />
              <SourceChip source={o.scenarioSources.plans} />
            </div>
            <div className="grid gap-2">
              {draft.plans.map((plan, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_84px_70px_auto] items-center gap-2">
                  <select aria-label={t("Plan")} value={String(plan.months)} onChange={(e) => set("plans", draft.plans.map((x, j) => (j === i ? { ...x, months: Number(e.target.value) } : x)))} className={cx(inputClass, "h-8 py-0")}>
                    {[...new Set<number>([...PLAN_PERIODS, plan.months])].map((m) => <option key={m} value={String(m)}>{planLabel(m)}</option>)}
                  </select>
                  <input type="number" inputMode="decimal" min={0} step="0.01" aria-label={t("Price")} value={plan.price} onChange={(e) => set("plans", draft.plans.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)))} className={cx(inputClass, "h-8 text-right tabular-nums")} />
                  <input type="number" inputMode="decimal" min={0} max={100} step="1" aria-label={t("Share of new payers")} value={Math.round(plan.share * 100)} onChange={(e) => set("plans", draft.plans.map((x, j) => (j === i ? { ...x, share: Number(e.target.value) / 100 } : x)))} className={cx(inputClass, "h-8 text-right tabular-nums")} />
                  <button type="button" onClick={() => set("plans", draft.plans.filter((_, j) => j !== i))} className="grid size-7 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink" aria-label={t("Remove plan")}>×</button>
                </div>
              ))}
              {draft.plans.length < 6 && <button type="button" onClick={() => set("plans", [...draft.plans, { months: 1, price: 0, share: 0 }])} className="justify-self-start rounded-xs text-xs font-medium text-accent hover:underline">{t("Add a plan")}</button>}
              <p className="text-xs text-faint">{t("Price after tax in USD, then the plan's share of new payers in %. Shares are scaled to add up to 100%.")}</p>
            </div>
          </div>
        </Panel>

        <Panel className="flex min-w-0 flex-col p-4">
          {!o.priced && draft.plans.some((p) => !(p.price > 0)) && (
            <p className="mb-3 rounded-inner border border-caution bg-caution-soft px-3 py-2 text-caption text-ink">
              {t("Enter your plan prices in the scenario. RevenueCat didn't report new-subscription revenue, and its proceeds include every renewal, so they can't give a price. Until then revenue and LTV here count only the plans with a price.")}
            </p>
          )}
          <PanelHead title={t("Next 12 months")} sub={t("Steady spend, new payers each month, renewals stacking up. The band: conversion 20% worse or better, churn 25% higher or 20% lower.")} />
          <div className="mt-3 grid gap-px overflow-hidden rounded-inner border border-line bg-line @2xl:grid-cols-3 @5xl:grid-cols-5">
            <Kpi label={t("Subscribers")} value={f.count(last?.subscribers)} how={t("Paying subscribers at the end of month 12: every month's new payers, less those who churned or didn't renew (lifetime buyers count as kept).")} />
            <Kpi label={t("Revenue (12 mo)")} value={f.money(last?.cumulativeRevenue)} how={t("Net revenue over the 12 months: every charge after the store's fee and refunds.")} />
            <Kpi label={t("Profit (12 mo)")} value={f.money(last?.cumulativeProfit)} tone={last ? (last.cumulativeProfit >= 0 ? "win" : "warn") : undefined} how={t("Net revenue − ad spend, summed over the 12 months. Other costs aren't counted.")} />
            <Kpi label={t("Payback")} value={f.month(p.paybackMonth)} how={t("When one month's new payers have earned back that month's ad spend (CAC = CPI ÷ (install to trial × trial to paid)).")} />
            <Kpi label={t("Break-even")} value={p.breakEvenMonth == null ? t("Not within 12 months") : t("Month {n}", { n: p.breakEvenMonth })} how={t("The first month in which cumulative profit is back to zero or above.")} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 rounded-full bg-accent" />{t("Cumulative profit")}</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 rounded-full bg-ink" />{t("Cumulative revenue")}</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden className="w-4 border-t border-dashed border-ink" />{t("Break-even")}</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-4 rounded-xs bg-accent/15" />{t("Likely range")}</span>
          </div>
          <LineChart className="mt-2" height={280} labels={labels}
            series={[
              { key: "profit", label: t("Cumulative profit"), values: p.months.map((m) => m.cumulativeProfit), color: "accent" },
              { key: "revenue", label: t("Cumulative revenue"), values: p.months.map((m) => m.cumulativeRevenue), color: "ink", hollow: true },
            ]}
            band={{ from: 0, low: p.band.low, high: p.band.high }} target={0} yTicks={ticks} format={(n) => f.money(n)}
            tip={(i) => [<strong key="m" className="font-medium text-ink">{monthName(i + 1)}</strong>, <span key="p">{t("Profit {value}", { value: f.money(p.months[i].cumulativeProfit) })}</span>, <span key="r">{t("Revenue {value}", { value: f.money(p.months[i].cumulativeRevenue) })}</span>, <span key="s">{t("{n} subscribers", { n: Math.round(p.months[i].subscribers) })}</span>]} />
          <p className="-mt-1 text-center text-xs text-faint">{t("Months from now")}</p>
          <details className="mt-3 text-xs text-muted">
            <summary className="cursor-pointer select-none">{t("Show the months as a table")}</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-right tabular-nums">
                <thead><tr className="text-muted">{[t("Month"), t("Spend"), t("New payers"), t("Subscribers"), t("Revenue"), t("Profit"), t("Cumulative profit")].map((h) => <th key={h} className="h-7 border-b border-line px-2 font-book first:text-left">{h}</th>)}</tr></thead>
                <tbody>
                  {p.months.map((m) => (
                    <tr key={m.month} className="text-ink">
                      <td className="h-7 px-2 text-left">{monthName(m.month)}</td><td className="px-2">{f.money(m.spend)}</td><td className="px-2">{f.count(m.newPayers)}</td><td className="px-2">{f.count(m.subscribers)}</td>
                      <td className="px-2">{f.money(m.revenue)}</td><td className={cx("px-2", m.profit < 0 && "text-warn")}>{f.money(m.profit)}</td><td className={cx("px-2", m.cumulativeProfit < 0 && "text-warn")}>{f.money(m.cumulativeProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Panel>
      </div>
    </>
  );
}

// MARK: RevenueCat trends

type RcMetric = "revenue" | "mrr" | "trials" | "paid" | "churn" | "refunds";

export function RevenueTrendsCard({ data, o, gate }: { data: MeasureData; o: Operating; gate: Gate | null }) {
  const tr = useT();
  const { t } = tr;
  const f = useFormat();
  const [metric, setMetric] = useState<RcMetric>("revenue");
  const days = dayList(data.range.since, data.range.until);
  const rows = data.revenuecat;
  if (data.sync.revenuecat?.status !== "ok") {
    return (
      <Panel className="p-4">
        <PanelHead title={t("Revenue over time")} sub={t("From RevenueCat")} />
        {gate ? <GateLine gate={gate} className="mt-3" /> : <p className="mt-3 text-sm text-muted">{data.sync.revenuecat?.message ? syncMessage(data.sync.revenuecat.message, tr) : t("Connected. Press Sync now to load the last 90 days.")}</p>}
      </Panel>
    );
  }
  const OPTIONS: { value: RcMetric; label: string; how: string }[] = [
    { value: "revenue", label: t("Revenue"), how: t("Gross revenue per day (RevenueCat's revenue chart), net of refunds recorded that day.") },
    { value: "mrr", label: t("MRR"), how: t("Monthly recurring revenue each day: active subscriptions normalised to a month (RevenueCat's MRR chart).") },
    { value: "trials", label: t("New trials"), how: t("Trials started each day (RevenueCat's new trials chart).") },
    { value: "paid", label: t("New paid"), how: t("New paying subscriptions each day, trial conversions included (RevenueCat's new paid subscriptions).") },
    { value: "churn", label: t("Churn"), how: t("Subscriptions that churned each day (RevenueCat's churn chart).") },
    { value: "refunds", label: t("Refunds"), how: t("Refunded revenue each day, by refund date (RevenueCat's refunds chart).") },
  ];
  const isMoney = metric === "revenue" || metric === "mrr" || metric === "refunds";
  const series: (number | null)[] =
    metric === "revenue" ? rcDaily(rows, "revenue", (m) => /revenue/i.test(m) && !/transactions/i.test(m), days)
    : metric === "mrr" ? rcLevel(rows, "mrr", () => true, days)
    : metric === "trials" ? rcDaily(rows, "trials_new", () => true, days)
    : metric === "paid" ? rcDaily(rows, "actives_new", (m) => /total/i.test(m), days)
    : metric === "churn" ? rcDaily(rows, "churn", (m) => /churn/i.test(m) && !/rate|%/i.test(m), days)
    : rcDaily(rows, "refunds", (m) => /revenue|proceeds/i.test(m), days);
  const empty = series.every((v) => !v);
  const fmt = (n: number) => (isMoney ? f.money(n) : f.count(n));
  const current = OPTIONS.find((x) => x.value === metric)!;
  return (
    <Panel className="flex min-w-0 flex-col p-4">
      <PanelHead title={<HowLabel label={<span>{t("Revenue over time")}</span>} how={current.how} />} sub={t("From RevenueCat · last {n} days · USD", { n: data.range.days })}
        right={<Segmented label={t("RevenueCat metric")} value={metric} onChange={setMetric} options={OPTIONS.map(({ value, label }) => ({ value, label }))} />} />
      {empty
        ? <p className="mt-6 text-sm text-muted">{metric === "mrr" || metric === "churn" ? t("RevenueCat hasn't sent this chart yet. Sync again, or check the key's Charts & metrics access.") : t("Nothing in this period yet.")}</p>
        : <HatchedBars name={current.label} format={fmt} points={days.map((d, i) => ({ key: d, label: f.day(d), value: series[i] ?? 0, tip: <><Readout first value={fmt(series[i] ?? 0)} /><span>{f.day(d)}</span></> }))} />}
      <div className="mt-3 grid gap-x-6 border-t border-line pt-2 @xl:grid-cols-3">
        <KeyValue label={t("Trial to paid")} value={f.pct(o.rc.conversionRate)} />
        <KeyValue label={t("Monthly churn")} value={o.scenarioSources.monthlyChurn === "RevenueCat" || o.saved ? f.pct(o.scenario.monthlyChurn) : "–"} />
        <KeyValue label={t("MRR now")} value={f.money(o.rc.mrr)} />
      </div>
    </Panel>
  );
}

// MARK: Superwall

export function SuperwallSection({ data, o, gate }: { data: MeasureData; o: Operating; gate: Gate | null }) {
  const tr = useT();
  const { t } = tr;
  const f = useFormat();
  const [by, setBy] = useState<"paywall" | "placement">("paywall");
  const sw = o.sw;
  const sync = data.sync.superwall;
  if (sync?.status !== "ok") {
    return (
      <>
        <SectionTitle title={t("Paywalls")} sub={t("From Superwall")} />
        <Panel className="p-4">
          <p className="text-sm text-muted">{t("Paywall views, purchases and conversion for every paywall and placement appear here.")}</p>
          {gate ? <GateLine gate={gate} className="mt-3" /> : <p className="mt-2 text-sm text-muted">{sync?.message ? syncMessage(sync.message, tr) : t("Connected. Press Sync now to load the last 90 days.")}</p>}
        </Panel>
      </>
    );
  }
  const days = dayList(data.range.since, data.range.until);
  const byDay = new Map(sw.byDay.map((d) => [d.date, d]));
  const groups = by === "paywall" ? sw.byPaywall : sw.byPlacement;
  return (
    <>
      <SectionTitle title={t("Paywalls")} sub={t("From Superwall{app} · production only · last {n} days", { app: sync.details?.app?.name ? ` (${sync.details.app.name})` : "", n: data.range.days })} />
      <Panel className="grid gap-px overflow-hidden bg-line! @2xl:grid-cols-2 @5xl:grid-cols-5">
        <Kpi label={t("Paywall views")} value={f.count(sw.opens)} how={t("Times a paywall opened (Superwall's paywall_open event), sandbox left out.")} />
        <Kpi label={t("Purchases")} value={f.count(sw.conversions)} how={t("Paid purchases from a paywall: subscription_start (a subscription without an introductory offer) and nonRecurringProduct_purchase. Free trials aren't counted here.")} />
        <Kpi label={t("Conversion")} value={f.pct(sw.rate, 2)} how={t("Paid purchases ÷ paywall views.")} />
        <Kpi label={t("Trials started")} value={f.count(sw.trials)} how={t("Free trials started from a paywall (freeTrial_start: a subscription with an introductory offer).")} />
        <Kpi label={t("Revenue")} value={f.money(sw.revenue)} hint={sw.refunds ? t("{amount} refunded", { amount: f.money(sw.refunds) }) : undefined} how={t("Revenue Superwall tracked per day (its revenue table, refunds as negative amounts), without RevenueCat's copy of Stripe sales.")} />
      </Panel>
      <div className="mt-3 grid gap-3 @5xl:grid-cols-[3fr_2fr]">
        <Panel className="min-w-0 p-4">
          <PanelHead title={t("Paywall views per day")} sub={t("Hover a day for its purchases and conversion")} />
          <HatchedBars name={t("Paywall views per day")} format={(n) => f.count(n)} points={days.map((d) => {
            const row = byDay.get(d);
            const opens = row?.opens ?? 0, bought = row?.conversions ?? 0;
            return { key: d, label: f.day(d), value: opens, tip: <><Readout first value={f.count(opens)} label={t("views")} /><Readout value={f.count(bought)} label={t("purchases")} /><Readout value={f.pct(opens ? bought / opens : null)} /><span>{f.day(d)}</span></> };
          })} />
        </Panel>
        <Panel className="min-w-0 p-4">
          <PanelHead title={by === "paywall" ? t("Conversion by paywall") : t("Conversion by placement")} sub={t("Bar: paywall views. Right: purchases and conversion.")}
            right={<Segmented label={t("Group by")} value={by} onChange={setBy} options={[{ value: "paywall", label: t("Paywall") }, { value: "placement", label: t("Placement") }]} />} />
          {groups.length ? (
            <RankBars className="mt-2 -mx-3" tone="accent" format={(n) => f.count(n)} selected={groups[0]?.key}
              rows={groups.slice(0, 8).map((g) => ({ key: g.key || "(none)", label: g.key || (by === "paywall" ? t("No paywall name") : t("No placement")), value: g.opens, note: <>{t("{n} bought", { n: g.conversions })} · <strong className="font-medium text-ink">{f.pct(g.rate)}</strong></> }))} />
          ) : <p className="mt-4 text-sm text-muted">{t("No paywall views in this period yet.")}</p>}
        </Panel>
      </div>
    </>
  );
}

// MARK: Mixpanel

export function MixpanelSection({ data, o, gate }: { data: MeasureData; o: Operating; gate: Gate | null }) {
  const tr = useT();
  const { t } = tr;
  const f = useFormat();
  const mp = o.mp;
  const sync = data.sync.mixpanel;
  const STEP: Record<MixpanelStep, string> = { install: t("Install"), signup: t("Sign-up"), paywall: t("Paywall view"), trial: t("Trial start"), purchase: t("Purchase") };
  if (sync?.status !== "ok") {
    return (
      <>
        <SectionTitle title={t("Funnel and retention")} sub={t("From Mixpanel")} />
        <Panel className="p-4">
          <p className="text-sm text-muted">{t("Your own funnel from install to purchase, the retention curve and active users appear here, from the events you map.")}</p>
          {gate ? <GateLine gate={gate} className="mt-3" /> : <p className="mt-2 text-sm text-muted">{sync?.message ? syncMessage(sync.message, tr) : t("Connected. Press Sync now to load the last 90 days.")}</p>}
        </Panel>
      </>
    );
  }
  const days = dayList(data.range.since, data.range.until);
  const active = new Map(mp.activeByDay.map((d) => [d.date, d.users]));
  const retention = mp.retention.filter((r) => r.day <= 30);
  const at = (day: number) => retention.find((r) => r.day === day)?.rate ?? null;
  const top = mp.funnel[0]?.users ?? 0;
  return (
    <>
      <SectionTitle title={t("Funnel and retention")} sub={t("From Mixpanel · unique users per day, summed over the last {n} days", { n: data.range.days })} />
      {mp.missing.length > 0 && (
        <p className="mb-3 rounded-inner border border-line bg-caution-soft px-3 py-2 text-caption text-ink">{t("No one did {events} in the synced period. Check those event names on the Mixpanel connection card.", { events: mp.missing.map((e) => `"${e}"`).join(", ") })}</p>
      )}
      <div className="grid gap-3 @4xl:grid-cols-2">
        <Panel className="min-w-0 p-4">
          <PanelHead title={<HowLabel label={<span>{t("Funnel")}</span>} how={t("Each step is the unique users who did its mapped event, per day, summed over the period. The steps are counted separately (not one user's path), so a step can exceed the one before it. Conversion is each step ÷ the first.")} />}
            sub={t("Install to purchase, from your mapped events")} />
          <div className="mt-4 grid gap-3">
            {MIXPANEL_STEPS.map((step, i) => {
              const users = mp.funnel[i]?.users ?? 0;
              const share = top > 0 ? users / top : 0;
              return (
                <div key={step}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-ink">{STEP[step]} <span className="text-xs text-faint">{mp.events[step] ?? ""}</span></span>
                    <span className="shrink-0 tabular-nums"><strong className="font-medium text-ink">{f.count(users)}</strong>{i > 0 && <span className="ml-2 text-xs text-muted">{f.pct(top ? users / top : null)}</span>}</span>
                  </div>
                  <span className="mt-1.5 block h-2.5 rounded-xs bg-control" aria-hidden>
                    <span className="block h-full rounded-xs" style={{ width: `${Math.min(1, share) * 100}%`, ...(i === 0 ? { background: "var(--color-accent)" } : hatch("var(--color-accent)", false)) }} />
                  </span>
                </div>
              );
            })}
          </div>
          {mp.ttc && <p className="mt-4 text-xs text-muted">{t("Mean time from install to purchase: {days} (saved funnel, {n} converters).", { days: f.days(mp.ttc.meanSeconds / 86_400), n: Math.round(mp.ttc.conversions) })}</p>}
        </Panel>
        <Panel className="min-w-0 p-4">
          <PanelHead title={<HowLabel label={<span>{t("Retention")}</span>} how={t("Of the people who installed on a day, the share who did the active event again N days later, over every install cohort synced (weighted by cohort size). Day 0 is the install day.")} />}
            sub={t("Day 1 {d1} · Day 7 {d7} · Day 30 {d30}", { d1: f.pct(at(1)), d7: f.pct(at(7)), d30: f.pct(at(30)) })} />
          {retention.length > 1
            // One point per day since install, so the x-axis is true to time (days with no reading are gaps).
            ? <div className="mt-4"><BandLine name={t("Retention")} height={200} format={(n) => f.pct(n, 0)}
                points={Array.from({ length: retention[retention.length - 1].day + 1 }, (_, d) => {
                  const r = retention.find((x) => x.day === d);
                  return { key: String(d), label: t("Day {n}", { n: d }), value: r ? r.rate : null, other: null,
                    tip: r ? <><Readout first value={f.pct(r.rate)} /><span>{t("Day {n}", { n: d })}</span><Readout value={t("{n} cohorts", { n: r.cohorts })} /></> : undefined };
                })} /></div>
            : <p className="mt-4 text-sm text-muted">{t("Retention appears once install cohorts are a few days old.")}</p>}
        </Panel>
      </div>
      <Panel className="mt-3 min-w-0 p-4">
        <PanelHead title={t("Active users per day")} sub={t("Average {n} a day · unique users who did \"{event}\"", { n: f.count(mp.avgActive), event: mp.events.active ?? "" })} />
        <HatchedBars name={t("Active users per day")} format={(n) => f.count(n)} points={days.map((d) => ({ key: d, label: f.day(d), value: active.get(d) ?? 0 }))} />
      </Panel>
    </>
  );
}
