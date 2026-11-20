// Every API key the app can use: what it is called, what it unlocks, and where to get it. The setup
// checklist and Settings > API keys are both drawn from this list, and the names match the ones the
// database accepts (install_secret_allowed in the install_core migration). The words are marked with
// m() and said with t() where they are shown.
import { m } from "../i18n/translate";

export type KeyGroup = "core" | "research" | "creative" | "ads" | "advanced";

export interface KeySpec {
  name: string;
  label: string;
  group: KeyGroup;
  /** One line: what works once this key is set. */
  unlocks: string;
  /** Where to create the key. */
  getUrl: string;
  /** The steps on that page, in order. */
  steps: string[];
  /** What a valid key looks like, shown as the field's hint. */
  hint: string;
  /** A long value pasted as several lines (a JSON file's contents). */
  multiline?: boolean;
  /** Needed for the core flow (competitor research and analysis). */
  required?: boolean;
  /** Keys that only work together with this one. */
  pairsWith?: string[];
  /** The full step-by-step guide in the repo's docs/keys folder. */
  guide: string;
}

export const KEY_GROUPS: { id: KeyGroup; title: string; blurb: string }[] = [
  { id: "core", title: "AI", blurb: m("Reads competitors' ads and posts, writes the analysis, and checks creatives.") },
  { id: "research", title: m("Research"), blurb: m("Collects competitors' posts and ads automatically.") },
  { id: "creative", title: m("Creative"), blurb: m("Generates images and videos in the Studio.") },
  { id: "ads", title: m("Ads and revenue"), blurb: m("Sends ads to Meta as paused drafts and measures what they earn.") },
  { id: "advanced", title: m("Advanced"), blurb: m("Optional. Most installs never need these.") },
];

export const KEY_CATALOG: KeySpec[] = [
  {
    name: "OPENAI_API_KEY", label: "OpenAI", group: "core", required: true,
    unlocks: m("Product profile, competitor analysis, reading ads, creative checks and ad copy."),
    getUrl: "https://platform.openai.com/api-keys",
    steps: [m("Add credit under Settings › Billing (minimum $5)."), m("Click Create new secret key."), m("Keep Owned by: You and Permissions: All, then click Create secret key."), m("Copy the key and paste it here.")],
    hint: m("Starts with sk-proj- (older keys sk-)"),
    guide: "docs/keys/openai.md",
  },
  {
    name: "APIFY_TOKEN", label: "Apify", group: "research",
    unlocks: m("Collects competitors' Instagram, TikTok, YouTube and X posts, and their Meta and Google ads (Settings › Research sources)."),
    getUrl: "https://console.apify.com/settings/integrations",
    steps: [m("Create a free Apify account."), m("Under Personal API tokens, click Create a new token."), m("Leave Limit token permissions off and click Create."), m("Copy the token (it is shown once) and paste it here.")],
    hint: m("Starts with apify_api_"),
    guide: "docs/keys/apify.md",
  },
  {
    name: "META_AD_LIBRARY_TOKEN", label: "Meta Ad Library", group: "research",
    unlocks: m("Pulls competitors' ads from Meta's official Ad Library API (ads shown in the EU and UK)."),
    getUrl: "https://www.facebook.com/ID",
    steps: [m("Confirm your identity at facebook.com/ID and wait for Meta's OK."), m("Create an app (use case Other) at developers.facebook.com/apps/creation."), m("In Graph API Explorer pick the app, choose User Token and click Generate Access Token."), m("Open it in the Access Token Tool, click Extend Access Token and paste the new token here.")],
    hint: m("Starts with EAA; lasts about 60 days"),
    guide: "docs/keys/meta-ad-library.md",
  },
  {
    name: "HIGGSFIELD_API_KEY", label: "Higgsfield", group: "creative",
    unlocks: m("Image and video generation in the Studio."),
    getUrl: "https://open.higgsfield.ai/api-keys",
    steps: [m("Add funds under Billing on open.higgsfield.ai (separate from a web plan, minimum $5)."), m("Open API Keys and click Create API key."), m("Name it and click Create key."), m("Click Copy API key (it copies ID:SECRET) and paste it here.")],
    hint: m("Key ID and secret as ID:SECRET"),
    guide: "docs/keys/higgsfield.md",
  },
  {
    name: "META_SYSTEM_USER_TOKEN", label: m("Meta system user token"), group: "ads", pairsWith: ["META_APP_SECRET"],
    unlocks: m("Launch (paused ad drafts in your ad account) and Meta spend in Measure."),
    getUrl: "https://business.facebook.com/settings/system-users",
    steps: [m("Add an Employee system user under Users › System users."), m("Assign assets: your app, ad account and Page, each with full control."), m("Generate token: your app, expiry Never, with ads_management, ads_read, business_management, pages_read_engagement and pages_show_list."), m("Copy it (it is shown once) and paste it here.")],
    hint: m("Starts with EAA"),
    guide: "docs/keys/meta-ads.md",
  },
  {
    name: "META_APP_SECRET", label: m("Meta app secret"), group: "ads", pairsWith: ["META_SYSTEM_USER_TOKEN"],
    unlocks: m("Signs every call to Meta. Needed when your Meta app has Require App Secret turned on, and safer either way."),
    getUrl: "https://developers.facebook.com/apps",
    steps: [m("Open the app you picked when making the system user token."), m("Go to App settings › Basic."), m("Click Show next to App secret and paste it here.")],
    hint: m("32 characters, 0-9 and a-f"),
    guide: "docs/keys/meta-ads.md",
  },
  {
    name: "REVENUECAT_API_KEY", label: "RevenueCat", group: "ads",
    unlocks: m("Trials, purchases and revenue in Measure."),
    getUrl: "https://app.revenuecat.com",
    steps: [m("Open your project, then Project settings › API keys."), m("Click + New secret API key and choose V2."), m("Give Charts & metrics read and Project configuration read, then click Generate."), m("Paste the key here.")],
    hint: m("Starts with sk_"),
    guide: "docs/keys/revenuecat.md",
  },
  {
    name: "APPSTACK_API_KEY", label: "AppStack", group: "ads",
    unlocks: m("Installs and revenue attributed to each ad in Measure."),
    getUrl: "https://console.appstack.tech/auth/sign-in",
    steps: [m("Sign in to the AppStack console (it is invite-only) and pick your app."), m("Open SDK in the side menu and choose Production."), m("Copy the API key and paste it here.")],
    hint: m("Your app's Production API key"),
    guide: "docs/keys/appstack.md",
  },
  {
    name: "SUPERWALL_API_KEY", label: "Superwall", group: "ads",
    unlocks: m("Paywall views, purchases and conversion by paywall and placement in Measure."),
    getUrl: "https://superwall.com/select-application",
    steps: [m("Sign in to Superwall as an organization admin."), m("Open Settings › API Keys and click Create key."), m("Give it the data:read and projects:read scopes with access to all projects, then create it."), m("Copy the key and paste it here.")],
    hint: m("An organization API key with data:read and projects:read"),
    guide: "docs/keys/superwall.md",
  },
  {
    name: "MIXPANEL_SERVICE_ACCOUNT", label: "Mixpanel", group: "ads",
    unlocks: m("Your own funnel, retention, active users and time to convert in Measure."),
    getUrl: "https://mixpanel.com/settings/org#serviceaccounts",
    steps: [m("Open Organization settings › Service accounts (you need to be an owner or admin)."), m("Click Add service account, pick the Analyst role and add your app's project."), m("Copy the username and the secret (the secret is shown once)."), m("Paste them here as username:secret.")],
    hint: m("username:secret, with a colon between"),
    guide: "docs/keys/mixpanel.md",
  },
  {
    name: "GOOGLE_SERVICE_ACCOUNT_JSON", label: m("Google Drive service account"), group: "advanced", multiline: true,
    unlocks: m("Exports approved creatives to a Google Drive folder."),
    getUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts",
    steps: [m("Enable the Google Drive API in a Google Cloud project."), m("Create a service account, then Keys › Add key › Create new key › JSON."), m("Paste the whole file here."), m("Add the service account's email to a shared drive as Content manager.")],
    hint: m("The whole .json key file"),
    guide: "docs/keys/google-drive.md",
  },
  {
    name: "TYPESAFE_API_KEY", label: "TypeSafe", group: "advanced",
    unlocks: m("An alternative AI for reading ads and checking creatives (switch to it under AI models)."),
    getUrl: "https://console.typesafe.ai/keys",
    steps: [m("Sign in to the TypeSafe console (Jev is in early access)."), m("Open API Keys and create a key."), m("Copy the key and paste it here, then choose TypeSafe under Settings › AI models.")],
    hint: m("Your TypeSafe key (it can't be checked until it is used)"),
    guide: "docs/keys/typesafe.md",
  },
  {
    name: "TIKTOK_RESEARCH_CLIENT_KEY", label: m("TikTok research client key"), group: "advanced", pairsWith: ["TIKTOK_RESEARCH_CLIENT_SECRET"],
    unlocks: m("Pulls competitors' TikTok ads from TikTok's Commercial Content API."),
    getUrl: "https://developers.tiktok.com/products/commercial-content-api",
    steps: [m("Apply for the Commercial Content API (reviewed by hand, often refused)."), m("After approval, open the project's registration details."), m("Copy the client key here and the client secret below.")],
    hint: m("Client key from your approved project"),
    guide: "docs/keys/tiktok.md",
  },
  {
    name: "TIKTOK_RESEARCH_CLIENT_SECRET", label: m("TikTok research client secret"), group: "advanced", pairsWith: ["TIKTOK_RESEARCH_CLIENT_KEY"],
    unlocks: m("Used together with the TikTok research client key."),
    getUrl: "https://developers.tiktok.com/products/commercial-content-api",
    steps: [m("Open the same project's registration details on TikTok for Developers."), m("Click Display next to the client secret and copy it."), m("Paste it here.")],
    hint: m("Client secret from the same project"),
    guide: "docs/keys/tiktok.md",
  },
];

export const keySpec = (name: string): KeySpec | undefined => KEY_CATALOG.find((k) => k.name === name);

/**
 * Keys that can also be set per app (twin of supabase/functions/_shared/keys.ts perAppKeyName): a
 * RevenueCat v2 secret key reads one project, an AppStack key one app. `<BASE>_<ID>`, the ID in capitals
 * with anything else as "_". The app's own key wins over the account's default.
 */
export const PER_APP_KEYS = { REVENUECAT_API_KEY: "projectId", APPSTACK_API_KEY: "appId" } as const;
export type PerAppBase = keyof typeof PER_APP_KEYS;
export const isPerAppBase = (name: string): name is PerAppBase => name in PER_APP_KEYS;
export const perAppKeyName = (base: PerAppBase, id: string) => `${base}_${id.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
/** Whether `name` is the default key or any per-app key of `base`. */
export const isKeyOf = (base: string, name: string) => name === base || (isPerAppBase(base) && name.startsWith(`${base}_`));
export const keysInGroup = (group: KeyGroup): KeySpec[] => KEY_CATALOG.filter((k) => k.group === group);
