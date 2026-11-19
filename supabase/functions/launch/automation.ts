// The daily automation (off by default, per workspace): each morning it takes the newest approved
// creatives that haven't been launched and queues paused drafts in the testing ad set, within caps.
// It never creates campaigns or ad sets and never spends: the ads it makes are paused, and the
// testing ad set's budget must sit under the workspace's guardrail or nothing is queued.
import { fromMinor, missing, type AdSetInfo } from "./meta.ts";
import type { CreativeInput, LaunchSettingsRow } from "./types.ts";

export interface DailyInput {
  settings: LaunchSettingsRow;
  creatives: CreativeInput[];
  /** Creative ids that already have a draft (any stage, any status but error/cancelled). */
  launched: Set<string>;
  /** Drafts the automation already queued today (UTC). */
  queuedToday: number;
  testingAdSet: AdSetInfo | null;
  currency: string;
}

export interface DailyPlan { picks: CreativeInput[]; notes: string[] }

export function planDaily(input: DailyInput): DailyPlan {
  const { settings } = input;
  const notes: string[] = [];
  if (!settings.automation_enabled) return { picks: [], notes: ["Daily uploads are off."] };
  const gaps = missing(settings, "TEST");
  if (gaps.length) return { picks: [], notes: gaps };
  const adSet = input.testingAdSet;
  if (!adSet) return { picks: [], notes: ["Couldn't read the testing ad set."] };
  if (["DELETED", "ARCHIVED"].includes(adSet.status)) return { picks: [], notes: ["The testing ad set is deleted or archived."] };

  // Budget guardrail: the automation only adds ads to an ad set whose budget is under the cap.
  const cap = settings.max_daily_budget;
  if (cap == null) return { picks: [], notes: ["Set a maximum daily budget for the testing ad set before turning on daily uploads."] };
  if (adSet.dailyBudget == null && adSet.lifetimeBudget == null) {
    notes.push("The testing ad set has no budget of its own (campaign budget); the cap is checked in Ads Manager.");
  }
  if (adSet.dailyBudget != null && fromMinor(adSet.dailyBudget, input.currency) > cap) {
    return { picks: [], notes: [`The testing ad set's daily budget (${fromMinor(adSet.dailyBudget, input.currency)} ${input.currency}) is over the ${cap} ${input.currency} guardrail.`] };
  }

  const today = Math.max(0, settings.automation_max_ads_per_day - input.queuedToday);
  const room = Math.max(0, settings.automation_max_ads_in_adset - adSet.ads);
  const count = Math.min(today, room);
  if (count === 0) {
    return { picks: [], notes: [today === 0 ? "Today's limit is reached." : `The testing ad set already holds ${adSet.ads} ads (limit ${settings.automation_max_ads_in_adset}).`] };
  }
  const fresh = input.creatives
    .filter((c) => !input.launched.has(c.id))
    .sort((a, b) => (b.approvedAt ?? "").localeCompare(a.approvedAt ?? ""));
  if (!fresh.length) return { picks: [], notes: ["No new approved creatives."] };
  const picks = fresh.slice(0, count);
  if (fresh.length > count) notes.push(`${fresh.length - count} more approved creative(s) wait for tomorrow.`);
  return { picks, notes };
}
