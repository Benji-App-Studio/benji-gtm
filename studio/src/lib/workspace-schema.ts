// Workspaces: every product is one. Its connections (the accounts the growth modules work against)
// and brand kit live on the product row as JSON (products.connections, products.brand_kit). The kit is
// edited only through the Brand page, which keeps it in step with products.brand_system (lib/brand.ts);
// generators read the merged brand (lib/server/brand.ts brandFor). This file is safe in the browser:
// shapes, cleaning and status. The server reader is lib/workspace.ts, and the
// edge function has a twin in supabase/functions/_shared/workspace.ts (keep the shapes in step).
// Words people see are marked with m() and said with t() where they are shown.
import { fill, m, type Vars } from "./i18n/translate";

const english = (text: string, vars?: Vars) => fill(text, vars, "en");

/** IDs only, never secrets. Every field is optional: a module checks for what it needs. */
export interface WorkspaceConnections {
  /** adAccountId is stored as "act_<digits>", the Marketing API's node ID. The rest are plain numeric IDs. */
  meta?: { adAccountId?: string; pageId?: string; instagramId?: string; pixelId?: string; appId?: string };
  revenuecat?: { projectId?: string };
  appstack?: { appId?: string };
  /**
   * The operating dashboard's analytics: a Mixpanel project (region us, eu or in; the event names the
   * funnel reads, empty for the defaults; a saved funnel's ID for time to convert) and a Superwall app.
   */
  mixpanel?: {
    projectId?: string; region?: string; funnelId?: string; workspaceId?: string;
    installEvent?: string; signupEvent?: string; paywallEvent?: string; trialEvent?: string; purchaseEvent?: string; activeEvent?: string;
  };
  superwall?: { applicationId?: string };
  /** supabasePrefix is "<bucket>/<folder>", by default "workspace/<user id>/<product id>". */
  storage?: { supabasePrefix?: string; driveFolderId?: string };
}

export interface BrandKit {
  appName: string;
  tagline?: string;
  iconUrl?: string;
  /** "#RRGGBB", upper case, most important first. */
  colors: string[];
  /** Real screenshots of the app, in the order to use them. */
  screenshotUrls: string[];
  tone?: string;
  /** Claims a creative must never make (one per entry); the QA step checks copy against them. */
  forbiddenClaims?: string[];
  appStoreUrl?: string;
}

export interface Workspace { id: string; name: string; connections: WorkspaceConnections; brandKit: BrandKit }

// MARK: Connections and their status

export type ConnectionKey = keyof WorkspaceConnections;
export const CONNECTION_KEYS: ConnectionKey[] = ["meta", "revenuecat", "superwall", "mixpanel", "appstack", "storage"];

/** The connections Measure reads, each one card that is enough on its own to light up the dashboard. */
export const MEASURE_SOURCES = ["meta", "revenuecat", "superwall", "mixpanel", "appstack"] as const;
export type MeasureSourceKey = (typeof MEASURE_SOURCES)[number];

/** The defaults when a Mixpanel event isn't mapped (twin of supabase/functions/metrics/mixpanel.ts DEFAULT_EVENTS). */
export const MIXPANEL_DEFAULT_EVENTS = { install: "$ae_first_open", signup: "Sign Up", paywall: "Paywall Viewed", trial: "Trial Started", purchase: "Purchase", active: "$ae_session" } as const;

/** A Mixpanel event name as typed: any text up to 255 characters, no line breaks. */
function eventName(value: string): string | null {
  const v = value.trim();
  return v && v.length <= 255 && !/[\r\n]/.test(v) ? v : null;
}

/** not_set: no IDs yet. set: IDs saved, not (or no longer) verified. verified: a check passed for exactly these IDs. */
export type ConnectionState = "not_set" | "set" | "verified";

/** The last verification of a connection, as stored in products.connection_checks. */
export interface ConnectionCheck { ok: boolean; message: string; checkedAt: string; values: string }
export type ConnectionChecks = Partial<Record<ConnectionKey, ConnectionCheck>>;

export interface ConnectionStatus {
  state: ConnectionState;
  /** The last check's message, when it was for the current values (a failure explains itself here). */
  message?: string;
  checkedAt?: string;
  failed?: boolean;
}

/** What the browser gets for a workspace: the contract's fields plus status and where files go. */
export interface WorkspaceView extends Workspace {
  isPrimary: boolean;
  status: Record<ConnectionKey, ConnectionStatus>;
}

/** How much each module has to work with for a product; null where it couldn't be counted. */
export interface WorkspaceCounts {
  watchlist: number | null; paidAds: number | null; formatCards: number | null; creatives: number | null; approvedCreatives: number | null; metaAds: number | null;
  /** Drafts that reached Meta (they have an ad id). Absent from an older server. */
  launchedAds?: number | null;
  /**
   * Days of results: daily rows with data from a revenue or analytics source (RevenueCat, Superwall,
   * Mixpanel, AppStack) or with spend on an ad launched from the dashboard. A source that synced nothing
   * doesn't count. Absent from an older server.
   */
  resultRows?: number | null;
}

/** One row of the workspace switcher. */
export interface WorkspaceSummary { id: string; name: string; appName: string; iconUrl?: string; isPrimary: boolean; ready: number; total: number }

type Field = { key: string; label: string; placeholder: string; hint: string; clean: (value: string) => string | null };

const digits = (min: number, max: number) => (value: string) => {
  const v = value.trim();
  if (new RegExp(`^\\d{${min},${max}}$`).test(v)) return v;
  // Pasted links: ?id=123, /123/ and the like.
  const found = v.match(new RegExp(`(?:id=|/)(\\d{${min},${max}})(?:\\D|$)`))?.[1];
  return found ?? null;
};

export const CONNECTION_FIELDS: Record<ConnectionKey, { label: string; blurb: string; fields: Field[] }> = {
  meta: {
    label: "Meta",
    blurb: m("Where Launch creates paused drafts and Measure reads spend and installs."),
    fields: [
      { key: "adAccountId", label: m("Ad account ID"), placeholder: "act_1234567890", hint: m("Ads Manager → account dropdown. With or without act_."),
        clean: (v) => { const id = v.trim().match(/^(?:act[_=])?(\d{5,20})$/)?.[1] ?? v.match(/act[_=](\d{5,20})/)?.[1]; return id ? `act_${id}` : null; } },
      { key: "pageId", label: m("Facebook Page ID"), placeholder: "102345678901234", hint: m("Page → About → Page transparency, or Business settings → Pages."), clean: digits(5, 25) },
      { key: "instagramId", label: m("Instagram account ID"), placeholder: "17841400000000000", hint: m("Business settings → Instagram accounts. The numeric ID, not the handle."), clean: digits(5, 25) },
      { key: "pixelId", label: m("Pixel / dataset ID"), placeholder: "1234567890", hint: m("Events Manager → Data sources → your dataset → Settings tab → Dataset ID."), clean: digits(5, 25) },
      { key: "appId", label: m("Meta app ID"), placeholder: "1234567890", hint: m("developers.facebook.com → your app. Needed for app install campaigns."), clean: digits(5, 25) },
    ],
  },
  revenuecat: {
    label: "RevenueCat",
    blurb: m("Trials, subscriptions and revenue, so Measure can work out LTV and payback."),
    fields: [
      { key: "projectId", label: m("Project ID"), placeholder: "proj1a2b3c4d", hint: m("Project settings › General, starts with proj. A link from the dashboard works too."),
        // The dashboard address shows the id without its "proj" prefix; the API needs it.
        clean: (v) => { const raw = v.match(/projects\/([A-Za-z0-9_-]{3,64})/)?.[1] ?? v.trim(); const id = /^proj/.test(raw) ? raw : `proj${raw}`; return /^proj[A-Za-z0-9_-]{3,64}$/.test(id) ? id : null; } },
    ],
  },
  appstack: {
    label: "AppStack",
    blurb: m("Install attribution from the App Store, matched to campaigns."),
    fields: [
      { key: "appId", label: m("App ID"), placeholder: "com.example.app", hint: m("Your app's bundle ID (iOS) or package name (Android)."),
        clean: (v) => (/^[A-Za-z0-9._:-]{1,100}$/.test(v.trim()) ? v.trim() : null) },
    ],
  },
  superwall: {
    label: "Superwall",
    blurb: m("Paywall views, purchases and trials per paywall and placement, and revenue, so Measure shows which paywall converts."),
    fields: [
      { key: "applicationId", label: m("Application ID"), placeholder: "9021", hint: m("Superwall dashboard: your app, then Settings. The number in the app's address works too."),
        clean: (v) => v.trim().match(/^\d{1,20}$/)?.[0] ?? v.match(/applications\/(\d{1,20})/)?.[1] ?? null },
    ],
  },
  mixpanel: {
    label: "Mixpanel",
    blurb: m("Your own funnel (install, sign-up, paywall, trial, purchase), retention and active users. Leave an event empty for the default."),
    fields: [
      { key: "projectId", label: m("Project ID"), placeholder: "3141592", hint: m("Mixpanel: Settings, Project settings, Overview, Project ID."),
        clean: (v) => v.trim().match(/^\d{1,20}$/)?.[0] ?? v.match(/project\/(\d{1,20})/)?.[1] ?? null },
      { key: "region", label: m("Data residency"), placeholder: "us", hint: m("us, eu or in: where the project's data is stored (Project settings, Overview)."),
        clean: (v) => { const r = v.trim().toLowerCase().replace(/^(united states|usa)$/, "us").replace(/^europe$/, "eu").replace(/^india$/, "in"); return ["us", "eu", "in"].includes(r) ? r : null; } },
      { key: "installEvent", label: m("Install event"), placeholder: MIXPANEL_DEFAULT_EVENTS.install, hint: m("The event a new install sends. $ae_first_open is only sent when Mixpanel's automatic events are on (they're off by default)."), clean: eventName },
      { key: "signupEvent", label: m("Sign-up event"), placeholder: MIXPANEL_DEFAULT_EVENTS.signup, hint: m("Your sign-up or account-created event."), clean: eventName },
      { key: "paywallEvent", label: m("Paywall view event"), placeholder: MIXPANEL_DEFAULT_EVENTS.paywall, hint: m("The event sent when the paywall shows (Superwall's integration sends paywall_open)."), clean: eventName },
      { key: "trialEvent", label: m("Trial start event"), placeholder: MIXPANEL_DEFAULT_EVENTS.trial, hint: m("The event sent when a free trial starts."), clean: eventName },
      { key: "purchaseEvent", label: m("Purchase event"), placeholder: MIXPANEL_DEFAULT_EVENTS.purchase, hint: m("The event sent on a first paid purchase."), clean: eventName },
      { key: "activeEvent", label: m("Active user event"), placeholder: MIXPANEL_DEFAULT_EVENTS.active, hint: m("What counts as using the app that day (retention and active users)."), clean: eventName },
      { key: "funnelId", label: m("Saved funnel ID (optional)"), placeholder: "4815162", hint: m("A saved Funnels report from install to purchase, for time to convert: the number in its address."),
        clean: (v) => v.trim().match(/^\d{1,20}$/)?.[0] ?? v.match(/(?:funnel|report)\D{0,20}(\d{3,20})/)?.[1] ?? null },
      { key: "workspaceId", label: m("Data view ID (optional)"), placeholder: "123456", hint: m("Only if your project uses Data Views: the data view's ID, so Measure reads the same data you see."),
        clean: (v) => v.trim().match(/^\d{1,20}$/)?.[0] ?? v.match(/view\/(\d{1,20})/)?.[1] ?? null },
    ],
  },
  storage: {
    label: m("Storage"),
    blurb: m("Where this product's files go: brand assets, generated creatives, exports."),
    fields: [
      { key: "supabasePrefix", label: m("Supabase Storage folder"), placeholder: "workspace/<you>/<this product>", hint: m("Bucket, then folder. Leave empty for the default."),
        clean: (v) => { const p = v.trim().replace(/^\/+|\/+$/g, ""); return /^[a-z0-9][a-z0-9_-]{2,62}\/[A-Za-z0-9._/-]{1,300}$/.test(p) && !p.includes("..") ? p : null; } },
      { key: "driveFolderId", label: m("Google Drive folder ID (optional)"), placeholder: "1AbCdEfGhIjKlMnOpQrStUv", hint: m("Paste the folder link or its ID. For sharing finished creatives."),
        clean: (v) => { const id = v.match(/folders\/([A-Za-z0-9_-]{10,200})/)?.[1] ?? v.match(/[?&]id=([A-Za-z0-9_-]{10,200})/)?.[1] ?? v.trim(); return /^[A-Za-z0-9_-]{10,200}$/.test(id) ? id : null; } },
    ],
  },
};

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** A connection's saved values, as text a check can be compared against. Empty when nothing is set. */
export function connectionValues(connections: WorkspaceConnections, key: ConnectionKey): string {
  const entries = Object.entries((connections[key] ?? {}) as Record<string, string | undefined>).filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? JSON.stringify(Object.fromEntries(entries)) : "";
}

export function connectionStatus(connections: WorkspaceConnections, checks: ConnectionChecks, key: ConnectionKey): ConnectionStatus {
  const values = connectionValues(connections, key);
  if (!values) return { state: "not_set" };
  const check = checks[key];
  if (!check || check.values !== values) return { state: "set" };
  return { state: check.ok ? "verified" : "set", message: check.message, checkedAt: check.checkedAt, failed: !check.ok };
}

/** Saved connections, read leniently: only known fields, only text. */
export function readConnections(raw: unknown): WorkspaceConnections {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const out: WorkspaceConnections = {};
  for (const key of CONNECTION_KEYS) {
    const section: Record<string, string> = {};
    for (const field of CONNECTION_FIELDS[key].fields) {
      const value = str(source[key]?.[field.key]).trim();
      if (value) section[field.key] = value;
    }
    if (Object.keys(section).length) (out as Record<string, unknown>)[key] = section;
  }
  return out;
}

/**
 * Connection edits from a form: each section given replaces the saved one (empty fields clear it).
 * Returns the cleaned sections, or an error message naming the field that's wrong.
 */
// The optional fields' labels without " (optional)", as the error sentence names them.
m("Saved funnel ID"); m("Google Drive folder ID");

export function cleanConnections(input: unknown, t: (text: string, vars?: Vars) => string = english): WorkspaceConnections | string {
  if (!input || typeof input !== "object") return {};
  const out: WorkspaceConnections = {};
  for (const key of CONNECTION_KEYS) {
    const given = (input as Record<string, unknown>)[key];
    if (given === undefined) continue;
    const section: Record<string, string> = {};
    for (const field of CONNECTION_FIELDS[key].fields) {
      const value = str((given as Record<string, unknown> | null)?.[field.key]).trim().slice(0, 500);
      if (!value) continue;
      const clean = field.clean(value);
      if (!clean) return t("{source} {field}: that doesn't look right. {hint}", { source: t(CONNECTION_FIELDS[key].label), field: t(field.label.replace(/ \(optional\)$/, "")), hint: t(field.hint) });
      section[field.key] = clean;
    }
    (out as Record<string, unknown>)[key] = section;
  }
  return out;
}

// MARK: Brand kit

export const BRAND_LIMITS = { colors: 12, screenshots: 20, claims: 50 };

/** "#abc", "abc", "#AABBCC" → "#AABBCC"; anything else → null. */
export function hexColor(value: string): string | null {
  const v = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(v)) return `#${v.split("").map((c) => c + c).join("")}`.toUpperCase();
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v}`.toUpperCase() : null;
}

const isUrl = (value: string) => { try { return new URL(value).protocol === "https:"; } catch { return false; } };
const list = (value: unknown) => (Array.isArray(value) ? value.map(str) : str(value).split("\n")).map((v) => v.trim()).filter(Boolean);

/** A saved brand kit, read leniently; the app name falls back to the product's name. */
export function readBrandKit(raw: unknown, productName: string): BrandKit {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kit: BrandKit = {
    appName: str(source.appName).trim() || productName,
    colors: list(source.colors).map(hexColor).filter((c): c is string => Boolean(c)),
    screenshotUrls: list(source.screenshotUrls).filter(isUrl),
  };
  const tagline = str(source.tagline).trim();
  const iconUrl = str(source.iconUrl).trim();
  const tone = str(source.tone).trim();
  const appStoreUrl = str(source.appStoreUrl).trim();
  const claims = list(source.forbiddenClaims);
  if (tagline) kit.tagline = tagline;
  if (iconUrl && isUrl(iconUrl)) kit.iconUrl = iconUrl;
  if (tone) kit.tone = tone;
  if (claims.length) kit.forbiddenClaims = claims;
  if (appStoreUrl && isUrl(appStoreUrl)) kit.appStoreUrl = appStoreUrl;
  return kit;
}

/**
 * Brand kit edits from a form: only the keys given change, and an empty value clears one. Returns
 * what to store, or an error message.
 */
export function cleanBrandKit(input: unknown): Partial<Record<keyof BrandKit, unknown>> | string {
  if (!input || typeof input !== "object") return {};
  const body = input as Record<string, unknown>;
  const out: Partial<Record<keyof BrandKit, unknown>> = {};
  const text = (key: keyof BrandKit, max: number, label: string) => {
    if (!(key in body)) return null;
    const value = str(body[key]).trim();
    if (value.length > max) return `${label} is too long (${max} characters at most).`;
    out[key] = value || undefined;
    return null;
  };
  const url = (key: keyof BrandKit, label: string, test?: (u: URL) => boolean) => {
    if (!(key in body)) return null;
    const value = str(body[key]).trim();
    if (!value) { out[key] = undefined; return null; }
    if (!isUrl(value) || value.length > 1000 || (test && !test(new URL(value)))) return `${label} should be a full https:// link.`;
    out[key] = value;
    return null;
  };
  const error = text("appName", 80, "The app name") ?? text("tagline", 160, "The tagline") ?? text("tone", 4000, "Tone of voice")
    ?? url("iconUrl", "The icon")
    ?? url("appStoreUrl", "The App Store link", (u) => /(^|\.)apple\.com$|(^|\.)play\.google\.com$/.test(u.hostname));
  if (error) return error;
  if ("colors" in body) {
    const raw = list(body.colors);
    const colors = raw.map(hexColor);
    const bad = raw.find((_, i) => !colors[i]);
    if (bad) return `"${bad.slice(0, 20)}" isn't a hex colour like #0090FF.`;
    out.colors = [...new Set(colors as string[])].slice(0, BRAND_LIMITS.colors);
  }
  if ("screenshotUrls" in body) {
    const urls = list(body.screenshotUrls);
    if (urls.some((u) => !isUrl(u))) return "Screenshots should be uploaded images (https links).";
    out.screenshotUrls = [...new Set(urls)].slice(0, BRAND_LIMITS.screenshots);
  }
  if ("forbiddenClaims" in body) {
    const claims = list(body.forbiddenClaims);
    if (claims.length > BRAND_LIMITS.claims) return `Keep forbidden claims to ${BRAND_LIMITS.claims} lines.`;
    if (claims.some((c) => c.length > 300)) return "Each forbidden claim should fit on one line (300 characters).";
    out.forbiddenClaims = claims.length ? claims : undefined;
  }
  return out;
}

// MARK: Modules and navigation

export type WorkspaceModule = "brand" | "research" | "market" | "formats" | "studio" | "playground" | "launch" | "measure" | "settings";

/**
 * A product's pages as they were before the journey-ordered navigation. The sidebar, the command menu
 * and the old-address redirects now read lib/nav-model.ts (Home, Research, Studio, Launch, Measure, App
 * settings); Brand, Market and Playground live on as App settings › Brand, Research › App Store and
 * Studio › Remix, and their old addresses redirect. Kept for workspaceHref's page names and MODULE_NEEDS.
 */
export const WORKSPACE_MODULES: { key: WorkspaceModule; label: string; blurb: string; group?: "create"; hidden?: true }[] = [
  { key: "brand", label: m("Brand"), blurb: m("Name, icon, screenshots, look, voice, offers and the claims a creative must never make: every creative follows it.") },
  { key: "research", label: m("Research"), blurb: m("Your competitors' paid ads from Meta's Ad Library: what's running, for how long, and why it works.") },
  { key: "market", label: m("Market"), blurb: m("Your competitors' apps on the App Store: ratings, prices, how often they ship, what reviewers love and hate, and the top charts.") },
  { key: "formats", label: m("Formats"), blurb: m("A library of proven ad formats, each with a recreate prompt ready for the Studio (now the Studio's Start from)."), group: "create", hidden: true },
  { key: "studio", label: m("Studio"), blurb: m("Make creatives from a format and the brand, then check them against the forbidden claims before they go anywhere."), group: "create" },
  { key: "playground", label: m("Remix"), blurb: m("Bring a reference ad and say what to change: new images in its exact style, with your product and brand."), group: "create" },
  { key: "launch", label: m("Launch"), blurb: m("Send approved creatives to Meta as paused drafts, and promote the winners to scaling.") },
  { key: "measure", label: m("Measure"), blurb: m("Ad spend next to what it brought in, per campaign and creative.") },
  { key: "settings", label: m("Settings"), blurb: m("The accounts this app's pages connect to (now the Brand page's Settings tab)."), hidden: true },
];

export const workspaceHref = (id: string, module?: WorkspaceModule) => `/app/w/${id}${module ? `/${module}` : ""}`;

/** Remembers the last product opened, so /app/w (where sign-in lands) and the switcher come back to it. */
export { WORKSPACE_COOKIE } from "./storage-keys";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What each module works from, so a page can say what's missing before it's used. */
export const MODULE_NEEDS: Record<Exclude<WorkspaceModule, "settings">, { connections: ConnectionKey[]; brandKit: boolean }> = {
  brand: { connections: [], brandKit: false },
  research: { connections: [], brandKit: false },
  market: { connections: [], brandKit: false },
  formats: { connections: [], brandKit: false },
  studio: { connections: ["storage"], brandKit: true },
  playground: { connections: [], brandKit: true },
  launch: { connections: ["meta", "storage"], brandKit: true },
  measure: { connections: ["meta", "revenuecat", "superwall", "mixpanel", "appstack"], brandKit: false },
};

/** The basics every product's brand needs, whatever it sells, still empty: the setup checklist's "Brand basics". */
export function brandBasicsGaps(kit: BrandKit): string[] {
  return ([
    !kit.iconUrl && m("logo or icon"),
    !kit.colors.length && m("colours"),
    !kit.tone && m("tone of voice"),
  ] as (string | false)[]).filter((gap): gap is string => Boolean(gap));
}

/**
 * Whether the product is (or has) an app with a store listing: a mobile app by kind, or one whose
 * links name a store. A website, a shop or a service has none, and is never asked for one.
 */
export function productHasApp(product: { kind?: string | null; website?: string | null; links?: string[] | null } | null | undefined, kit?: Pick<BrandKit, "appStoreUrl">): boolean {
  if (kit?.appStoreUrl) return true;
  if (!product) return false;
  if (product.kind === "mobile_app") return true;
  return [product.website ?? "", ...(product.links ?? [])].some((link) => /apps\.apple\.com|play\.google\.com/i.test(link));
}

/**
 * The parts of a brand still empty (read from the synced kit), in the order the Brand page asks for them.
 * Screenshots of the app and the App Store link are asked only of a product that has an app (`hasApp`).
 */
export function brandKitGaps(kit: BrandKit, hasApp = false): string[] {
  return ([
    !kit.iconUrl && m("logo or icon"),
    hasApp && !kit.screenshotUrls.length && m("screenshots"),
    !kit.colors.length && m("colours"),
    !kit.tone && m("tone of voice"),
    !kit.forbiddenClaims?.length && m("forbidden claims"),
    hasApp && !kit.appStoreUrl && m("App Store link"),
  ] as (string | false)[]).filter((gap): gap is string => Boolean(gap));
}
