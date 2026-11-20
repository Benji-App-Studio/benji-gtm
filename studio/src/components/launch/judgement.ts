// Launch's promote/pause judgement (lib/launch/promotion.ts) in the page's language: each summary,
// check and missing piece from its code and raw values, with money, percentages and multiples in the
// page's locale.
import type { Translator } from "@/lib/i18n/translate";
import type { Check, ConversionEvent, Suggestion } from "@/lib/launch/promotion";
import type { ScalingAdvice } from "@/lib/launch/scaling";
import { formats } from "./ads-words";

/** The conversion, plural, in the page's language. */
export const events = ({ t }: Translator, e: ConversionEvent) =>
  e === "install" ? t("installs") : e === "trial" ? t("trials") : e === "purchase" ? t("purchases") : t("link clicks");

/** The conversion, one of it, in the page's language ("Cost per {event}"). */
export const eventOne = ({ t }: Translator, e: ConversionEvent) =>
  e === "install" ? t("install") : e === "trial" ? t("trial") : e === "purchase" ? t("purchase") : t("link click");

/** The conversion as a column or fact label ("Purchases"). */
export const eventsTitle = ({ t }: Translator, e: ConversionEvent) =>
  e === "install" ? t("Installs") : e === "trial" ? t("Trials") : e === "purchase" ? t("Purchases") : t("Link clicks");

function fmt(tr: Translator, currency: string) {
  const $ = formats(tr, currency);
  const pct = (n: number) => new Intl.NumberFormat(tr.intl, { style: "percent", maximumFractionDigits: 0 }).format(n);
  const one = (n: number) => new Intl.NumberFormat(tr.intl, { maximumFractionDigits: 1 }).format(n);
  return { money: (n: number) => $.money(n), pct, one, times: $.times, count: $.count };
}

export function summaryText(tr: Translator, s: Suggestion): string {
  const { t } = tr;
  const f = fmt(tr, s.currency);
  const v = s.summaryValues;
  const ev = events(tr, s.event);
  switch (s.summaryCode) {
    case "no_target": return t("Set a target CAC in Launch settings to get suggestions.");
    case "pause_none": return t("Pause: {spend} spent ({multiple}× target CAC) with no {events}.", { spend: f.money(v.spend), multiple: f.one(v.multiple), events: ev });
    case "pause_cac": return t("Pause: CAC {cac} after {spend}; {prob} sure it's above the {target} target.", { cac: f.money(v.cac), spend: f.money(v.spend), prob: f.pct(v.prob), target: f.money(v.target) });
    case "promoted": return t("Already copied to the scaling campaign.");
    case "promote": return t("Promote: {n} {events} at {cac} CAC over {days} days; {prob} sure it beats the {target} target.", { n: f.count(v.n), events: ev, cac: f.money(v.cac), days: f.count(v.days), prob: f.pct(v.prob), target: f.money(v.target) });
    case "holding_cac": return t("Holding: CAC {cac}.", { cac: f.money(v.cac) });
    case "holding_none": return t("Holding: no {events} yet.", { events: ev });
    case "keep_testing": {
      const parts = s.needs.map((n) => {
        switch (n.code) {
          case "spend": return t("{amount} more spend", { amount: f.money(n.n) });
          case "conversions": return t("{n} more {events}", { n: f.count(n.n), events: ev });
          case "days": return t("{n} more days of delivery", { n: f.count(n.n) });
          case "spread": return t("{events} spread over more days", { events: ev });
          case "lower_cac": return t("a lower CAC");
          case "clear_cac": return t("a CAC clearly below target");
          case "roas": return t("ROAS at target");
        }
      });
      const list = parts.length ? new Intl.ListFormat(tr.intl, { style: "short", type: "conjunction" }).format(parts) : t("more data");
      return t("Keep testing: needs {list}.", { list });
    }
  }
}

export function checkLabel(tr: Translator, c: Check, event: ConversionEvent): string {
  const { t } = tr;
  switch (c.code) {
    case "spend": case "spend_unset": return t("Enough spend");
    case "conversions": return t("Enough {events}", { events: events(tr, event) });
    case "spread": case "spread_best": return t("Not one lucky day");
    case "cac": case "cac_none": case "cac_unset": return t("CAC below target, with confidence");
    case "roas": return t("ROAS over {days} days", { days: c.values.days });
    case "roas_unset": case "roas_no_revenue": return t("ROAS");
  }
}

export function checkDetail(tr: Translator, c: Check, event: ConversionEvent, currency: string): string {
  const { t } = tr;
  const f = fmt(tr, currency);
  const v = c.values;
  switch (c.code) {
    case "spend": return t("{spend} of the {needed} needed ({multiple}× target CAC)", { spend: f.money(v.spend), needed: f.money(v.needed), multiple: f.one(v.multiple) });
    case "spend_unset": case "cac_unset": return t("Set a target CAC");
    case "conversions": return t("{n} of {min}", { n: f.count(v.n), min: f.count(v.min) });
    case "spread": return t("{days} days with spend (need {min})", { days: f.count(v.days), min: f.count(v.min) });
    case "spread_best": return t("{days} days with spend (need {min}); best day has {share} of {events} (max {max})", { days: f.count(v.days), min: f.count(v.min), share: f.pct(v.share), events: events(tr, event), max: f.pct(v.max) });
    case "cac": return t("CAC {cac} vs target {target}; likely {low}–{high}; {prob} sure it's below target (need {need})", { cac: f.money(v.cac), target: f.money(v.target), low: f.money(v.low), high: f.money(v.high), prob: f.pct(v.prob), need: f.pct(v.need) });
    case "cac_none": return t("No {events} yet vs target {target}; likely {low}–{high}; {prob} sure it's below target (need {need})", { events: events(tr, event), target: f.money(v.target), low: f.money(v.low), high: f.money(v.high), prob: f.pct(v.prob), need: f.pct(v.need) });
    case "roas": return t("{roas} vs {targetRoas} target, {paying} paying (need {min})", { roas: f.times(v.roas), targetRoas: f.times(v.targetRoas), paying: f.count(v.paying), min: f.count(v.min) });
    case "roas_unset": return t("No ROAS target set");
    case "roas_no_revenue": return t("No attributed revenue yet, so ROAS isn't judged");
  }
}

/** The scaling card's advice (lib/launch/scaling.ts) in the page's language: what to do, and why. */
export function scalingText(tr: Translator, a: ScalingAdvice, event: ConversionEvent): { summary: string; why: string } {
  const { t } = tr;
  const $ = formats(tr, a.currency);
  const v = a.values ?? {};
  const money = (n: number | null | undefined) => (n == null ? t("no conversions") : $.money(n));
  const e = eventOne(tr, event);
  switch (a.code) {
    case "setup": return {
      summary: t("No scaling ad set yet."),
      why: t("Pick or create one in Launch settings. The playbook scales winners in their own campaign, ideally with a campaign budget (CBO) so Meta moves money to the best ad."),
    };
    case "promote_first": return {
      summary: t("Promote a winner from testing first."),
      why: t("Scaling starts once a testing ad has beaten your target cost per {event} on enough spend; the suggestions above say when.", { event: e }),
    };
    case "no_target": return {
      summary: t("Set a target cost per {event} to get scaling advice.", { event: e }),
      why: t("Every scaling step is judged against it. Work it out from what a customer is worth (LTV) and how fast you need the money back."),
    };
    case "wait_spend": return {
      summary: t("Let it spend before changing the budget."),
      why: t("The last 3 days spent {spend}; judge on at least about {need} (2 × target) so the cost per {event} is a result, not noise.", { spend: money(v.spend), need: money(v.need), event: e }),
    };
    case "at_cap": return {
      summary: t("At your max daily budget ({max}), and still under target.", { max: money(v.max) }),
      why: t("Raise the max in Launch settings if the economics allow, or scale horizontally: promote another winner and give it its own budget."),
    };
    case "raise": case "raise_plain": return {
      summary: a.code === "raise"
        ? t("Raise the daily budget about 20%: {budget} → {next}, then leave it 48 hours.", { budget: money(v.budget), next: money(v.next) })
        : t("Raise the daily budget about 20%, then leave it 48 hours."),
      why: t("Cost per {event} over the last 3 days is {cpa} against a {target} target. Expect it to wobble after the change; judge where it settles, not the next morning.", { event: e, cpa: money(v.cpa), target: money(v.target) }),
    };
    case "horizontal": return {
      summary: t("Stop raising this one; scale sideways with more winners."),
      why: t("Cost per {event} went from {before} to {cpa} in the last 3 days. If it doesn't settle back under {target} within 48 hours, step the budget back about 20% and promote another winner (or a variation of this one) to run beside it.", { event: e, before: money(v.before), cpa: money(v.cpa), target: money(v.target) }),
    };
    case "hold_over": return {
      summary: t("Hold the budget; the cost per {event} is over target.", { event: e }),
      why: v.cpa == null
        ? t("No conversions over the last 3 days against {target}. Give it 48 hours to settle; if it doesn't, lower the budget or pause the weakest ad, and keep new creatives in testing.", { target: money(v.target) })
        : t("{cpa} over the last 3 days against {target}. Give it 48 hours to settle; if it doesn't, lower the budget or pause the weakest ad, and keep new creatives in testing.", { cpa: money(v.cpa), target: money(v.target) }),
    };
    case "hold_around": return {
      summary: t("Hold: it's around target."),
      why: t("{cpa} against {target}. Raise again once it settles under target.", { cpa: money(v.cpa), target: money(v.target) }),
    };
    default: return { summary: a.summary, why: a.why };
  }
}
