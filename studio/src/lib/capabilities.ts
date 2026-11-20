// What each feature needs before it can work: API keys (install-wide, Settings > API keys) and, for
// some, a connection on the app itself (its ad account, its RevenueCat project). Pages ask
// `featureState` and show a "connect X" state instead of a broken screen or a backend error.
//
// Plain TypeScript, safe in the browser. When the install can't be read (`install` is null) nothing is
// locked: the page works as before and the backend's own message explains a missing key.
//
// Words: pass the page's { t, intl } (useT) as featureState's last argument to get title, body, action and
// the missing labels in the viewer's language; without it they are English (the tests read those).
import { fill, m, type Translator } from "./i18n/translate";
import { isKeyOf, isPerAppBase, keySpec } from "./install/key-catalog";
import type { InstallState } from "./install/types";
import type { ConnectionKey, WorkspaceConnections } from "./workspace-schema";

export type Feature =
  | "ai"
  | "research.collect"
  | "research.metaApi"
  | "research.google"
  | "research.tiktokEu"
  | "research.tiktokTopAds"
  | "research.tiktokLibrary"
  | "studio.images"
  | "studio.video"
  | "studio.runner"
  | "drive.export"
  | "launch"
  | "measure.meta"
  | "measure.revenuecat"
  | "measure.appstack"
  | "measure.mixpanel"
  | "measure.superwall"
  | "market.summary"
  | "market.play";

interface Need {
  /** What the feature is called in a sentence: "Connect OpenAI to <what>". */
  what: string;
  /** Every key in one inner list is needed; any one inner list is enough. */
  keys: string[][];
  /** Fields on the app's own connections that must be filled in. */
  connections?: { key: ConnectionKey; field: string; label: string }[];
}

const NEEDS: Record<Feature, Need> = {
  ai: { what: m("read ads and posts, write the analysis and check creatives"), keys: [["OPENAI_API_KEY"]] },
  "research.collect": { what: m("collect competitors' posts and ads automatically"), keys: [["APIFY_TOKEN"]] },
  "research.metaApi": { what: m("pull ads from Meta's Ad Library API"), keys: [["META_AD_LIBRARY_TOKEN"]] },
  "research.google": { what: m("collect competitors' Google search and YouTube ads"), keys: [["APIFY_TOKEN"]] },
  "research.tiktokEu": { what: m("collect competitors' TikTok ads shown in Europe"), keys: [["APIFY_TOKEN"]] },
  "research.tiktokTopAds": { what: m("collect TikTok's top ads by keyword"), keys: [["APIFY_TOKEN"]] },
  "research.tiktokLibrary": { what: m("pull TikTok ads from TikTok's official API"), keys: [["TIKTOK_RESEARCH_CLIENT_KEY", "TIKTOK_RESEARCH_CLIENT_SECRET"]] },
  "studio.images": { what: m("generate images"), keys: [["HIGGSFIELD_API_KEY"], ["OPENAI_API_KEY"]] },
  "studio.video": { what: m("generate videos"), keys: [["HIGGSFIELD_API_KEY"]] },
  "studio.runner": { what: m("make creator-style videos and cut-outs with the desktop runner"), keys: [["CREATIVES_RUNNER_SECRET"]] },
  "drive.export": {
    what: m("export creatives to Google Drive"), keys: [["GOOGLE_SERVICE_ACCOUNT_JSON"]],
    connections: [{ key: "storage", field: "driveFolderId", label: m("a Google Drive folder") }],
  },
  launch: {
    what: m("send ads to Meta as paused drafts"), keys: [["META_SYSTEM_USER_TOKEN", "META_APP_SECRET"]],
    connections: [{ key: "meta", field: "adAccountId", label: m("your Meta ad account") }, { key: "meta", field: "pageId", label: m("your Facebook Page") }],
  },
  "measure.meta": {
    what: m("read ad spend from Meta"), keys: [["META_SYSTEM_USER_TOKEN", "META_APP_SECRET"]],
    connections: [{ key: "meta", field: "adAccountId", label: m("your Meta ad account") }],
  },
  "measure.revenuecat": {
    what: m("read trials and revenue from RevenueCat"), keys: [["REVENUECAT_API_KEY"]],
    connections: [{ key: "revenuecat", field: "projectId", label: m("your RevenueCat project") }],
  },
  "measure.appstack": {
    what: m("read installs from AppStack"), keys: [["APPSTACK_API_KEY"]],
    connections: [{ key: "appstack", field: "appId", label: m("your AppStack app") }],
  },
  "measure.mixpanel": {
    what: m("read your funnel, retention and active users from Mixpanel"), keys: [["MIXPANEL_SERVICE_ACCOUNT"]],
    connections: [{ key: "mixpanel", field: "projectId", label: m("your Mixpanel project") }],
  },
  "measure.superwall": {
    what: m("read paywall views and purchases from Superwall"), keys: [["SUPERWALL_API_KEY"]],
    connections: [{ key: "superwall", field: "applicationId", label: m("your Superwall app") }],
  },
  // Market reads the App Store with no key; these two are its extras.
  "market.summary": { what: m("write the AI summaries of app reviews and top charts"), keys: [["OPENAI_API_KEY"]] },
  "market.play": { what: m("read Google Play reviews (Google has no free official API)"), keys: [["APIFY_TOKEN"]] },
};

/**
 * Why a feature is (or isn't) ready, as data, for pages that pick their own words: "ready", "unknown"
 * (the install couldn't be read), "add-key" (this person adds the key), "ask-owner" (a member: only the
 * owner can add it) or "add-connection" (the key is set; this app's connection isn't). Never compare
 * title, body or action: those are said in the viewer's language.
 */
export type FeatureReason = "ready" | "unknown" | "add-key" | "ask-owner" | "add-connection";

export interface FeatureState {
  feature: Feature;
  /** Why it is locked, or "ready". Optional for states built elsewhere; featureState always sets it. */
  reason?: FeatureReason;
  /** The keys still to add by name (OPENAI_API_KEY…), whatever the language; missingKeys has their labels. */
  missingKeyNames?: string[];
  /** True when everything it needs is there, and also when the install couldn't be read. */
  ok: boolean;
  /** The install couldn't be read, so nothing is known (and nothing is locked). */
  unknown: boolean;
  /** Labels of the keys still to add, e.g. ["OpenAI"]. With alternatives, the first way's keys. */
  missingKeys: string[];
  /** Labels of the app's connections still to fill in. */
  missingConnections: string[];
  /** "Connect OpenAI to read ads and posts…" */
  title: string;
  /** One line saying where to do it. */
  body: string;
  /** Where the button goes: the keys page, or this app's connections. */
  href: string;
  action: string;
}

const KEYS_HREF = "/app/settings/keys";
const englishList = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
/** How a feature's sentences are said: the page's t and locale, or English. */
export type Say = Pick<Translator, "t" | "intl">;
const ENGLISH = { t: (text: string, vars?: Record<string, string | number>) => fill(text, vars, "en"), list: englishList };

const isSet = (install: InstallState, name: string): boolean => {
  if (install.keys[name]?.set) return true;
  // AppStack and RevenueCat also take one key per app (APPSTACK_API_KEY_<APP>, REVENUECAT_API_KEY_<PROJECT>).
  return isPerAppBase(name) && Object.entries(install.keys).some(([key, state]) => key !== name && isKeyOf(name, key) && state.set);
};

/** The keys a feature needs with this install's settings (the AI's key follows the chosen provider). */
function keyWays(feature: Feature, install: InstallState): string[][] {
  if (feature === "ai" && install.aiProvider === "typesafe") return [["TYPESAFE_API_KEY"]];
  return NEEDS[feature].keys;
}

export function featureState(
  feature: Feature,
  install: InstallState | null | undefined,
  app?: { id: string; connections?: WorkspaceConnections | null } | null,
  say?: Say,
): FeatureState {
  const need = NEEDS[feature];
  const { t, list } = say ? { t: say.t, list: (items: string[]) => new Intl.ListFormat(say.intl, { type: "conjunction" }).format(items) } : ENGLISH;
  const label = (name: string) => t(keySpec(name)?.label ?? name);
  if (!install) return { feature, ok: true, unknown: true, reason: "unknown", missingKeys: [], missingKeyNames: [], missingConnections: [], title: "", body: "", href: KEYS_HREF, action: "" };

  const ways = keyWays(feature, install);
  const satisfied = ways.some((way) => way.every((name) => isSet(install, name)));
  const missingKeyNames = satisfied ? [] : ways[0].filter((name) => !isSet(install, name));
  const missingKeys = missingKeyNames.map(label);

  const connections = app?.connections ?? null;
  const missingConnections = (need.connections ?? [])
    .filter((c) => !app || !(connections?.[c.key] as Record<string, string | undefined> | undefined)?.[c.field])
    .map((c) => t(c.label));
  // Without an app in hand (an install-wide screen) only the keys are judged.
  const connectionGaps = app ? missingConnections : [];

  const ok = missingKeys.length === 0 && connectionGaps.length === 0;
  // In accounts mode every account adds its own keys: "Add the key…", never "Ask the owner…".
  const owner = install.mode === "accounts" || !install.owned || install.role === "owner";
  let title = "", body = "", href = KEYS_HREF, action = "";
  let reason: FeatureReason = "ready";
  if (missingKeys.length) {
    reason = owner ? "add-key" : "ask-owner";
    const others = ways.length > 1 ? ways.slice(1).map((way) => list(way.map(label))).join(" / ") : "";
    title = t("Connect {keys} to {what}", { keys: list(missingKeys), what: t(need.what) });
    body = owner
      ? (others ? t("Add the key in Settings › Your keys (or {others}). It is checked when you save it.", { others }) : t("Add the key in Settings › Your keys. It is checked when you save it."))
      : (others ? t("Ask the owner of this workspace to add the key in Settings › Your keys (or {others}).", { others }) : t("Ask the owner of this workspace to add the key in Settings › Your keys."));
    action = t("Add the key");
  } else if (connectionGaps.length) {
    reason = "add-connection";
    title = t("Add {items} to {what}", { items: list(connectionGaps), what: t(need.what) });
    body = t("Fill it in under this app's connections. The key is already set.");
    href = `/app/w/${app!.id}/settings?tab=connections`;
    action = t("Open connections");
  }
  return { feature, ok, unknown: false, reason, missingKeys, missingKeyNames, missingConnections: connectionGaps, title, body, href, action };
}

/** The first feature in the list that isn't ready, or null when all are. */
export function firstLocked(features: Feature[], install: InstallState | null | undefined, app?: { id: string; connections?: WorkspaceConnections | null } | null, say?: Say): FeatureState | null {
  for (const feature of features) {
    const state = featureState(feature, install, app, say);
    if (!state.ok) return state;
  }
  return null;
}

/** What each page can't open without. Research and Brand always open (importing ads needs no key). */
export const PAGE_FEATURES: Partial<Record<string, Feature[]>> = {
  launch: ["launch"],
};

/** The optional things an app can unlock, in the order the overview offers them. */
export const UNLOCKABLE: { feature: Feature; label: string }[] = [
  { feature: "research.collect", label: m("Collect competitors' posts and ads automatically") },
  { feature: "studio.images", label: m("Generate images in the Studio") },
  { feature: "studio.video", label: m("Generate videos") },
  { feature: "launch", label: m("Send ads to Meta as paused drafts") },
  { feature: "measure.meta", label: m("See ad spend in Measure") },
  { feature: "measure.revenuecat", label: m("See trials and revenue in Measure") },
  { feature: "measure.appstack", label: m("See installs per ad in Measure") },
  { feature: "measure.superwall", label: m("See paywall conversion by paywall and placement in Measure") },
  { feature: "measure.mixpanel", label: m("See your funnel, retention and active users in Measure") },
];
