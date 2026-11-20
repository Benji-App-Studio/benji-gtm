"use client";
// Step 2 of "Send to Meta" (new campaigns only): objective, where the budget lives (CBO or ABO), the
// budget and bid strategy, then dates, a spending limit, special ad categories and SKAdNetwork behind
// "More options".
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";
import type { Stage } from "@/lib/launch/naming";
import { BID_INFO, BID_STRATEGIES, type BidStrategy, type CampaignSpec, META_OBJECTIVES, type MetaObjective, OBJECTIVE_INFO, SPECIAL_AD_CATEGORIES } from "@/lib/launch/rules";
import { fromLocalInput, toLocalInput } from "@/lib/launch/send";
import { inputClass, Segmented, Toggle } from "../ui";
import { Choice, Group, Hint, Labeled, MoneyInput, MoreOptions } from "./send-parts";

const SPECIAL_LABEL: Record<string, string> = {
  HOUSING: m("Housing"), EMPLOYMENT: m("Employment"), FINANCIAL_PRODUCTS_SERVICES: m("Credit and financial services"), ISSUES_ELECTIONS_POLITICS: m("Social issues, elections or politics"),
};

export function CampaignStep({ value: c, onChange, currency, stage }: { value: CampaignSpec; onChange: (c: CampaignSpec) => void; currency: string; stage: Stage }) {
  const set = (patch: Partial<CampaignSpec>) => onChange({ ...c, ...patch });
  const lifetime = c.lifetimeBudget != null;
  const { t } = useT();
  return (
    <div className="grid gap-4">
      <Group title={t("Campaign")}>
        <Labeled label={t("Name")} hint={t("Follows the naming convention so Measure can group results; change it if you like.")}>
          <input className={inputClass} value={c.name} maxLength={400} onChange={(e) => set({ name: e.target.value })} />
        </Labeled>
        <Labeled label={t("Objective")} hint={t(OBJECTIVE_INFO[c.objective].hint)}>
          <select className={inputClass} value={c.objective} onChange={(e) => set({ objective: e.target.value as MetaObjective })}>
            {META_OBJECTIVES.map((o) => <option key={o} value={o}>{t(OBJECTIVE_INFO[o].label)}</option>)}
          </select>
        </Labeled>
      </Group>

      <Group title={t("Budget")} hint={t("Where the money is set decides who moves it between ad sets.")}>
        <Choice name="budget-mode" value={c.budgetMode} onChange={(m) => set(m === "ABO"
          ? { budgetMode: "ABO", dailyBudget: null, lifetimeBudget: null, bidStrategy: null }
          : { budgetMode: "CBO", dailyBudget: c.dailyBudget ?? 50, lifetimeBudget: null, bidStrategy: c.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP" })} options={[
          { value: "ABO", label: t("On each ad set (ABO)"), hint: t("You give every ad set its own budget, so each new concept gets a fair test. The playbook's choice for testing.") },
          { value: "CBO", label: t("On the campaign (CBO)"), hint: t("One budget; Meta moves it to the ad sets doing best. The playbook's choice for scaling winners.") },
        ]} />
        {stage === "TEST" && c.budgetMode === "CBO" && <Hint>{t("Testing usually runs ABO, so every concept gets spend. CBO is for scaling proven winners.")}</Hint>}
        {c.budgetMode === "CBO" && (
          <div className="grid gap-3 @lg:grid-cols-2">
            <Labeled label={lifetime ? t("Lifetime budget") : t("Daily budget")} hint={lifetime ? t("Spent over the campaign's dates; needs an end date.") : t("Meta may spend a little more on good days and less on others.")}>
              <div className="grid gap-2">
                <Segmented label={t("Budget type")} value={lifetime ? "lifetime" : "daily"} onChange={(v) => set(v === "lifetime" ? { lifetimeBudget: c.dailyBudget ?? 500, dailyBudget: null } : { dailyBudget: c.lifetimeBudget ?? 50, lifetimeBudget: null })}
                  options={[{ value: "daily", label: t("Daily") }, { value: "lifetime", label: t("Lifetime") }]} />
                <MoneyInput value={lifetime ? c.lifetimeBudget : c.dailyBudget} onChange={(v) => set(lifetime ? { lifetimeBudget: v } : { dailyBudget: v })} currency={currency} label={t("Campaign budget")} />
              </div>
            </Labeled>
            <Labeled label={t("Bid strategy")} hint={t(BID_INFO[(c.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP") as BidStrategy].hint)}>
              <select className={inputClass} value={c.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP"} onChange={(e) => set({ bidStrategy: e.target.value as BidStrategy })}>
                {BID_STRATEGIES.map((b) => <option key={b} value={b}>{t(BID_INFO[b].label)}</option>)}
              </select>
            </Labeled>
          </div>
        )}
        {c.budgetMode === "CBO" && c.bidStrategy && c.bidStrategy !== "LOWEST_COST_WITHOUT_CAP" && (
          <Hint>{t("Meta asks for the cap or ROAS floor on each ad set of a CBO campaign; set those in Ads Manager before publishing.")}</Hint>
        )}
        {c.budgetMode === "CBO" && lifetime && !c.stopTime && <p className="text-xs text-warn">{t("A lifetime budget needs an end date (More options).")}</p>}
      </Group>

      <MoreOptions defaultOpen={c.budgetMode === "CBO" && lifetime}>
        <div className="grid gap-3 @lg:grid-cols-2">
          <Labeled label={t("Starts")} hint={t("Empty: when you publish it.")}><input type="datetime-local" className={inputClass} value={toLocalInput(c.startTime)} onChange={(e) => set({ startTime: fromLocalInput(e.target.value) })} /></Labeled>
          <Labeled label={t("Ends")} hint={t("Empty: runs until you stop it.")}><input type="datetime-local" className={inputClass} value={toLocalInput(c.stopTime)} onChange={(e) => set({ stopTime: fromLocalInput(e.target.value) })} /></Labeled>
        </div>
        <Labeled label={t("Spending limit")} hint={t("The most this campaign may ever spend, whatever the budgets say. Optional.")}>
          <MoneyInput value={c.spendCap} onChange={(v) => set({ spendCap: v })} currency={currency} label={t("Spending limit")} placeholder={t("No limit")} />
        </Labeled>
        <Labeled label={t("Special ad category")} hint={t("Only for ads about housing, jobs, credit or politics: Meta then limits targeting by age, gender and place.")}>
          <select className={inputClass} value={c.specialAdCategories?.[0] ?? ""} onChange={(e) => set({ specialAdCategories: e.target.value ? [e.target.value] : [], specialAdCountries: e.target.value ? c.specialAdCountries ?? [] : [] })}>
            <option value="">{t("None")}</option>
            {SPECIAL_AD_CATEGORIES.map((s) => <option key={s} value={s}>{t(SPECIAL_LABEL[s])}</option>)}
          </select>
        </Labeled>
        {Boolean(c.specialAdCategories?.length) && (
          <Labeled label={t("Countries for the category")} hint={t("Two-letter codes, comma separated (US, GB).")}>
            <input className={inputClass} value={(c.specialAdCountries ?? []).join(", ")} onChange={(e) => set({ specialAdCountries: e.target.value.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean) })} />
          </Labeled>
        )}
        {c.objective === "OUTCOME_APP_PROMOTION" && (
          <label className="flex items-start gap-3 text-sm">
            <Toggle checked={Boolean(c.skadnetwork)} onChange={(v) => set({ skadnetwork: v })} label={t("SKAdNetwork attribution")} />
            <span><span className="font-medium">{t("SKAdNetwork attribution")}</span><span className="block text-xs text-muted">{t("Apple’s privacy-safe install counting for iOS apps. Leave on for iOS.")}</span></span>
          </label>
        )}
      </MoreOptions>
    </div>
  );
}
