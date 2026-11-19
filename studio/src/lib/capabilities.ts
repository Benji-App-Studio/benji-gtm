// What each feature needs before it can work: API keys (install-wide, Settings > API keys) and, for
// some, a connection on the app itself (its ad account, its RevenueCat project). Pages ask
// `featureState` and show a "connect X" state instead of a broken screen or a backend error.
//
// Plain TypeScript, safe in the browser. When the install can't be read (`install` is null) nothing is
// locked: the page works as before and the backend's own message explains a missing key.
import { keySpec } from "./install/key-catalog";
import type { InstallState } from "./install/types";
import type { ConnectionKey, WorkspaceConnections } from "./workspace-schema";

export type Feature =
  | "ai"
  | "research.collect"
  | "research.metaApi"
  | "studio.images"
  | "studio.video"
  | "studio.runner"
  | "drive.export"
  | "launch"
  | "measure.meta"
  | "measure.revenuecat"
  | "measure.appstack";

interface Need {
  /** What the feature is called in a sentence: "Connect OpenAI to <what>". */
  what: string;
  /** Every key in one inner list is needed; any one inner list is enough. */
  keys: string[][];
  /** Fields on the app's own connections that must be filled in. */
  connections?: { key: ConnectionKey; field: string; label: string }[];
}

const NEEDS: Record<Feature, Need> = {
  ai: { what: "read ads and posts, write the analysis and check creatives", keys: [["OPENAI_API_KEY"]] },
  "research.collect": { what: "collect competitors' posts and ads automatically", keys: [["APIFY_TOKEN"]] },
  "research.metaApi": { what: "pull ads from Meta's Ad Library API", keys: [["META_AD_LIBRARY_TOKEN"]] },
  "studio.images": { what: "generate images", keys: [["HIGGSFIELD_API_KEY"], ["OPENAI_API_KEY"]] },
  "studio.video": { what: "generate videos", keys: [["HIGGSFIELD_API_KEY"]] },
  "studio.runner": { what: "make creator-style videos and cut-outs with the desktop runner", keys: [["CREATIVES_RUNNER_SECRET"]] },
  "drive.export": {
    what: "export creatives to Google Drive", keys: [["GOOGLE_SERVICE_ACCOUNT_JSON"]],
    connections: [{ key: "storage", field: "driveFolderId", label: "a Google Drive folder" }],
  },
  launch: {
    what: "send ads to Meta as paused drafts", keys: [["META_SYSTEM_USER_TOKEN", "META_APP_SECRET"]],
    connections: [{ key: "meta", field: "adAccountId", label: "your Meta ad account" }, { key: "meta", field: "pageId", label: "your Facebook Page" }],
  },
  "measure.meta": {
    what: "read ad spend from Meta", keys: [["META_SYSTEM_USER_TOKEN", "META_APP_SECRET"]],
    connections: [{ key: "meta", field: "adAccountId", label: "your Meta ad account" }],
  },
  "measure.revenuecat": {
    what: "read trials and revenue from RevenueCat", keys: [["REVENUECAT_API_KEY"]],
    connections: [{ key: "revenuecat", field: "projectId", label: "your RevenueCat project" }],
  },
  "measure.appstack": {
    what: "read installs from AppStack", keys: [["APPSTACK_API_KEY"]],
    connections: [{ key: "appstack", field: "appId", label: "your AppStack app" }],
  },
};

export interface FeatureState {
  feature: Feature;
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
const label = (name: string) => keySpec(name)?.label ?? name;
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

const isSet = (install: InstallState, name: string): boolean => {
  if (install.keys[name]?.set) return true;
  // AppStack also takes one key per app (APPSTACK_API_KEY_<APP>).
  return name === "APPSTACK_API_KEY" && Object.entries(install.keys).some(([key, state]) => key.startsWith("APPSTACK_API_KEY_") && state.set);
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
): FeatureState {
  const need = NEEDS[feature];
  if (!install) return { feature, ok: true, unknown: true, missingKeys: [], missingConnections: [], title: "", body: "", href: KEYS_HREF, action: "" };

  const ways = keyWays(feature, install);
  const satisfied = ways.some((way) => way.every((name) => isSet(install, name)));
  const missingKeys = satisfied ? [] : ways[0].filter((name) => !isSet(install, name)).map(label);

  const connections = app?.connections ?? null;
  const missingConnections = (need.connections ?? [])
    .filter((c) => !app || !(connections?.[c.key] as Record<string, string | undefined> | undefined)?.[c.field])
    .map((c) => c.label);
  // Without an app in hand (an install-wide screen) only the keys are judged.
  const connectionGaps = app ? missingConnections : [];

  const ok = missingKeys.length === 0 && connectionGaps.length === 0;
  const owner = !install.owned || install.role === "owner";
  let title = "", body = "", href = KEYS_HREF, action = "";
  if (missingKeys.length) {
    const alternatives = ways.length > 1 ? ` (or ${list(ways.slice(1).map((way) => list(way.map(label))))})` : "";
    title = `Connect ${list(missingKeys)} to ${need.what}`;
    body = owner
      ? `Add the key in Settings > API keys${alternatives}. It is checked when you save it.`
      : `Ask the owner of this workspace to add the key in Settings > API keys${alternatives}.`;
    action = "Add the key";
  } else if (connectionGaps.length) {
    title = `Add ${list(connectionGaps)} to ${need.what}`;
    body = "Fill it in under this app's connections. The key is already set.";
    href = `/app/settings/apps/${app!.id}`;
    action = "Open connections";
  }
  return { feature, ok, unknown: false, missingKeys, missingConnections: connectionGaps, title, body, href, action };
}

/** The first feature in the list that isn't ready, or null when all are. */
export function firstLocked(features: Feature[], install: InstallState | null | undefined, app?: { id: string; connections?: WorkspaceConnections | null } | null): FeatureState | null {
  for (const feature of features) {
    const state = featureState(feature, install, app);
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
  { feature: "research.collect", label: "Collect competitors' posts and ads automatically" },
  { feature: "studio.images", label: "Generate images in Studio and Playground" },
  { feature: "studio.video", label: "Generate videos" },
  { feature: "launch", label: "Send ads to Meta as paused drafts" },
  { feature: "measure.meta", label: "See ad spend in Measure" },
  { feature: "measure.revenuecat", label: "See trials and revenue in Measure" },
  { feature: "measure.appstack", label: "See installs per ad in Measure" },
];
