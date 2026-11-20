// What the launch function writes in English, in the page's language: Meta's effective_status, the
// readiness list on the Launch page (missing settings, account issues) and the lines of a send or edit
// plan ("Meta will receive"). The function's response stays as it is; the studio matches its fixed
// sentences and templates and says them again. Values people typed (names, headlines, links, places,
// interests) are shown exactly as written, even when one happens to equal a sentence in a dictionary.
import { m, type Translator } from "../../lib/i18n/translate";
import { BID_INFO, type BidStrategy } from "../../lib/launch/rules";
import type { FeatureState } from "../../lib/capabilities";
import type { InstallState } from "../../lib/install/types";
import { RULE_SENTENCES, ruleText } from "./rules-words";

/** Meta's effective_status in plain words. */
export const EFFECTIVE_STATUS: Record<string, string> = {
  ACTIVE: m("Running"), PAUSED: m("Paused"), ADSET_PAUSED: m("Ad set paused"), CAMPAIGN_PAUSED: m("Campaign paused"), PENDING_REVIEW: m("In review"),
  IN_PROCESS: m("Meta is processing"), DISAPPROVED: m("Rejected by Meta"), WITH_ISSUES: m("Delivery issues"), PREAPPROVED: m("Approved, not running"),
  PENDING_BILLING_INFO: m("Needs billing info"), ARCHIVED: m("Archived"), DELETED: m("Deleted"),
};
export const statusWord = ({ t }: Translator, s: string) => (EFFECTIVE_STATUS[s] ? t(EFFECTIVE_STATUS[s]) : s.toLowerCase().replace(/_/g, " "));

// MARK: The Launch page's "Before launching" list (launch function: meta.ts missing(), index.ts status)

export const STATUS_SENTENCES: readonly string[] = [
  m("Connect a Meta ad account to the workspace."),
  m("Connect the Facebook Page the ads run from."),
  m("Add the Meta app id for the iOS app (App promotion needs it)."),
  m("Add the App Store link (or switch the objective to Website traffic until the app is live)."),
  m("Add the website the ads link to."),
  m("Choose (or create) the testing ad set."),
  m("Choose (or create) the scaling ad set."),
  m("The ad account has no payment method: drafts can be created, but nothing can be published until one is added."),
  m("Add the ad account id to this workspace's Launch settings first."),
  m("This ad account isn't on the list Launch may use (META_ALLOWED_AD_ACCOUNTS)."),
];

const STATUS_PATTERNS: [RegExp, (tr: Translator, ...g: string[]) => string][] = [
  [/^The ad account isn't active \(status (.+)\)\.$/, ({ t }, status) => t("The ad account isn't active (status {status}).", { status })],
  [/^Couldn't read the testing ad set: ([\s\S]+)$/, ({ t }, reason) => t("Couldn't read the testing ad set: {reason}", { reason })],
  [/^Couldn't read the scaling ad set: ([\s\S]+)$/, ({ t }, reason) => t("Couldn't read the scaling ad set: {reason}", { reason })],
];

/** One line of the readiness list in the page's language; Meta's own errors stay as written. */
export function launchStatusText(tr: Translator, text: string): string {
  if (STATUS_SENTENCES.includes(text)) return tr.t(text);
  for (const [pattern, say] of STATUS_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return say(tr, ...match.slice(1));
  }
  return ruleText(tr, text);
}

// MARK: Plan lines (launch function: sheet.ts campaignLines, adSetLines, the ad lines and editRoute)

/** The plan's note, line labels and fixed values. */
export const PLAN_WORDS: readonly string[] = [
  m("Everything is created paused — nothing spends until you publish it in Ads Manager."),
  m("Objective"), m("Budget"), m("Bidding"), m("Spending limit"), m("Runs"), m("Special ad category"), m("Optimises for"), m("Who"), m("Where"),
  m("Schedule"), m("Frequency cap"), m("Status"), m("Already holds"), m("Format"), m("Headline"), m("Button"), m("Links to"), m("AI disclosure"),
  m("Name"), m("Daily budget"), m("Lifetime budget"), m("Bid amount"), m("ROAS floor"), m("Starts"), m("Ends"),
  m("On each ad set (ABO)"), m("Shared from the campaign (CBO)"), m("Made with AI (declared)"), m("Not made with AI (declared)"), m("Paused"),
  m("Advantage+ placements (Meta picks where it shows)"), m("all genders"), m("Advantage+ audience (age and interests are suggestions)"),
  m("when published"), m("no end"), m("Single image"), m("Single video"),
];

/** Values the function writes from fixed lists (objectives, goals, bidding, buttons, placements…). */
const FIXED = new Set<string>([...PLAN_WORDS, ...RULE_SENTENCES]);
/** Lines whose value is what someone typed or picked: never looked up. */
const RAW = new Set(["Headline", "Links to", "Name", "Starts", "Ends", "Spending limit", "Bid amount", "ROAS floor", "Special ad category"]);
const GENDER: Record<string, string> = { "all genders": m("all genders"), men: m("Men"), women: m("Women") };

const fixed = (tr: Translator, text: string) => (FIXED.has(text) ? tr.t(text) : text);

function budget(tr: Translator, value: string): string | null {
  const { t } = tr;
  const forms: [RegExp, (amount: string) => string][] = [
    [/^(.+) a day on the campaign \(CBO\)$/, (amount) => t("{amount} a day on the campaign (CBO)", { amount })],
    [/^(.+) in total on the campaign \(CBO\)$/, (amount) => t("{amount} in total on the campaign (CBO)", { amount })],
    [/^(.+) a day \(CBO\)$/, (amount) => t("{amount} a day (CBO)", { amount })],
    [/^(.+) in total \(CBO\)$/, (amount) => t("{amount} in total (CBO)", { amount })],
    [/^(.+) a day$/, (amount) => t("{amount} a day", { amount })],
    [/^(.+) in total$/, (amount) => t("{amount} in total", { amount })],
  ];
  for (const [pattern, say] of forms) {
    const match = pattern.exec(value);
    if (match) return say(match[1]);
  }
  return null;
}

/** A plan line's value in the page's language (its label goes through t() as a fixed word). */
export function planValue(tr: Translator, label: string, value: string): string {
  const { t, tn } = tr;
  if (RAW.has(label)) return value;
  if (FIXED.has(value)) return t(value);
  // "A → B": a start and end ("when published → no end") or an old and new budget.
  if (value.includes(" → ")) return value.split(" → ").map((part) => fixed(tr, part)).join(" → ");
  switch (label) {
    case "Status": {
      const code = value.toUpperCase().replace(/ /g, "_");
      return EFFECTIVE_STATUS[code] ? t(EFFECTIVE_STATUS[code]) : value;
    }
    case "Budget": case "Daily budget": case "Lifetime budget":
      return budget(tr, value) ?? value;
    case "Optimises for": {
      const match = /^(.+?) \((.+)\)$/.exec(value);
      return match ? `${fixed(tr, match[1])} (${match[2]})` : fixed(tr, value);
    }
    case "Bidding": {
      if (BID_INFO[value as BidStrategy]) return t(BID_INFO[value as BidStrategy].label);
      const match = /^(.+?)(?: at (.+?))?(?: \(ROAS ≥ (.+)\))?$/.exec(value);
      if (!match) return value;
      const [, strategy, amount, floor] = match;
      const head = amount ? t("{strategy} at {amount}", { strategy: fixed(tr, strategy), amount }) : fixed(tr, strategy);
      return floor ? `${head} (ROAS ≥ ${floor})` : head;
    }
    case "Who":
      return value.split(" · ").map((part, i) => {
        if (i < 2) return part; // places and ages, as written
        if (GENDER[part]) return t(GENDER[part]);
        const interests = /^interests: ([\s\S]+)$/.exec(part);
        return interests ? t("interests: {list}", { list: interests[1] }) : fixed(tr, part);
      }).join(" · ");
    case "Schedule": {
      const match = /^(\d+) weekly blocks?$/.exec(value);
      return match ? tn(Number(match[1]), "{n} weekly block", "{n} weekly blocks") : value;
    }
    case "Frequency cap": {
      const match = /^(\d+) per (\d+) day\(s\)$/.exec(value);
      return match ? tn(Number(match[2]), "{times} per {n} day", "{times} per {n} days", { times: match[1] }) : value;
    }
    case "Already holds": {
      const match = /^(\d+) ads?$/.exec(value);
      return match ? tn(Number(match[1]), "{n} ad", "{n} ads") : value;
    }
    case "Format": {
      const carousel = /^Carousel of (\d+) cards$/.exec(value);
      if (carousel) return tn(Number(carousel[1]), "Carousel of {n} card", "Carousel of {n} cards");
      const versions = /^(\d+) versions by placement$/.exec(value);
      if (versions) return tn(Number(versions[1]), "{n} version by placement", "{n} versions by placement");
      return value;
    }
  }
  return value;
}

// MARK: Launch locked behind its keys

/** Whether the viewer adds the keys themselves (the same rule as lib/capabilities.ts uses for its sentence). */
export const canAddKeys = (install: Pick<InstallState, "mode" | "owned" | "role"> | null | undefined) =>
  !install || install.mode === "accounts" || !install.owned || install.role === "owner";

/**
 * The locked Launch page's button and line. Launch needs two Meta keys that only work as a pair, so with
 * both missing someone who can add keys is told about both; anyone else keeps the registry's own line
 * ("ask the owner"). Decided on data, never on the registry's wording (which may already be translated).
 */
export function keysLockWords(tr: Translator, lock: Pick<FeatureState, "missingKeys" | "action" | "body">, canAdd: boolean): { action: string; body: string } {
  if (lock.missingKeys.length > 1 && canAdd) return { action: tr.t("Add the keys"), body: tr.t("Add both keys in Settings › Your keys. They are checked together once both are saved.") };
  return { action: lock.action, body: lock.body };
}

/** An error from a launch call in the page's language (server text it doesn't know stays as written). */
export const callErrorText = (tr: Translator, message: string) => launchStatusText(tr, message);
