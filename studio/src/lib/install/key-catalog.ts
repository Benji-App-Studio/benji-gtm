// Every API key the app can use: what it is called, what it unlocks, and where to get it. The setup
// checklist and Settings > API keys are both drawn from this list, and the names match the ones the
// database accepts (install_secret_allowed in the install_core migration).

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
  { id: "core", title: "AI", blurb: "Reads competitors' ads and posts, writes the analysis, and checks creatives." },
  { id: "research", title: "Research", blurb: "Collects competitors' posts and ads automatically." },
  { id: "creative", title: "Creative", blurb: "Generates images and videos in Studio and Playground." },
  { id: "ads", title: "Ads and revenue", blurb: "Sends ads to Meta as paused drafts and measures what they earn." },
  { id: "advanced", title: "Advanced", blurb: "Optional. Most installs never need these." },
];

export const KEY_CATALOG: KeySpec[] = [
  {
    name: "OPENAI_API_KEY", label: "OpenAI", group: "core", required: true,
    unlocks: "Product profile, competitor analysis, reading ads, creative checks and ad copy.",
    getUrl: "https://platform.openai.com/api-keys",
    steps: ["Add credit under Settings > Billing (minimum $5).", "Click Create new secret key.", "Keep Owned by: You and Permissions: All, then click Create secret key.", "Copy the key and paste it here."],
    hint: "Starts with sk-proj- (older keys sk-)",
    guide: "docs/keys/openai.md",
  },
  {
    name: "APIFY_TOKEN", label: "Apify", group: "research",
    unlocks: "Collects competitors' Instagram, TikTok, YouTube and X posts, and their Meta and Google ads (Settings > Research sources).",
    getUrl: "https://console.apify.com/settings/integrations",
    steps: ["Create a free Apify account.", "Under Personal API tokens, click Create a new token.", "Leave Limit token permissions off and click Create.", "Copy the token (it is shown once) and paste it here."],
    hint: "Starts with apify_api_",
    guide: "docs/keys/apify.md",
  },
  {
    name: "META_AD_LIBRARY_TOKEN", label: "Meta Ad Library", group: "research",
    unlocks: "Pulls competitors' ads from Meta's official Ad Library API (ads shown in the EU and UK).",
    getUrl: "https://www.facebook.com/ID",
    steps: ["Confirm your identity at facebook.com/ID and wait for Meta's OK.", "Create an app (use case Other) at developers.facebook.com/apps/creation.", "In Graph API Explorer pick the app, choose User Token and click Generate Access Token.", "Open it in the Access Token Tool, click Extend Access Token and paste the new token here."],
    hint: "Starts with EAA; lasts about 60 days",
    guide: "docs/keys/meta-ad-library.md",
  },
  {
    name: "HIGGSFIELD_API_KEY", label: "Higgsfield", group: "creative",
    unlocks: "Image and video generation in Studio and Playground.",
    getUrl: "https://open.higgsfield.ai/api-keys",
    steps: ["Add funds under Billing on open.higgsfield.ai (separate from a web plan, minimum $5).", "Open API Keys and click Create API key.", "Name it and click Create key.", "Click Copy API key (it copies ID:SECRET) and paste it here."],
    hint: "Key ID and secret as ID:SECRET",
    guide: "docs/keys/higgsfield.md",
  },
  {
    name: "META_SYSTEM_USER_TOKEN", label: "Meta system user token", group: "ads", pairsWith: ["META_APP_SECRET"],
    unlocks: "Launch (paused ad drafts in your ad account) and Meta spend in Measure.",
    getUrl: "https://business.facebook.com/settings/system-users",
    steps: ["Add an Employee system user under Users > System users.", "Assign assets: your app, ad account and Page, each with full control.", "Generate token: your app, expiry Never, with ads_management, ads_read, business_management, pages_read_engagement and pages_show_list.", "Copy it (it is shown once) and paste it here."],
    hint: "Starts with EAA",
    guide: "docs/keys/meta-ads.md",
  },
  {
    name: "META_APP_SECRET", label: "Meta app secret", group: "ads", pairsWith: ["META_SYSTEM_USER_TOKEN"],
    unlocks: "Signs every call to Meta. Needed when your Meta app has Require App Secret turned on, and safer either way.",
    getUrl: "https://developers.facebook.com/apps",
    steps: ["Open the app you picked when making the system user token.", "Go to App settings > Basic.", "Click Show next to App secret and paste it here."],
    hint: "32 characters, 0-9 and a-f",
    guide: "docs/keys/meta-ads.md",
  },
  {
    name: "REVENUECAT_API_KEY", label: "RevenueCat", group: "ads",
    unlocks: "Trials, purchases and revenue in Measure.",
    getUrl: "https://app.revenuecat.com",
    steps: ["Open your project, then Project settings > API keys.", "Click + New secret API key and choose V2.", "Give Charts & metrics read and Project configuration read, then click Generate.", "Paste the key here."],
    hint: "Starts with sk_",
    guide: "docs/keys/revenuecat.md",
  },
  {
    name: "APPSTACK_API_KEY", label: "AppStack", group: "ads",
    unlocks: "Installs and revenue attributed to each ad in Measure.",
    getUrl: "https://console.appstack.tech/auth/sign-in",
    steps: ["Sign in to the AppStack console (it is invite-only) and pick your app.", "Open SDK in the side menu and choose Production.", "Copy the API key and paste it here."],
    hint: "Your app's Production API key",
    guide: "docs/keys/appstack.md",
  },
  {
    name: "GOOGLE_SERVICE_ACCOUNT_JSON", label: "Google Drive service account", group: "advanced", multiline: true,
    unlocks: "Exports approved creatives to a Google Drive folder.",
    getUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts",
    steps: ["Enable the Google Drive API in a Google Cloud project.", "Create a service account, then Keys > Add key > Create new key > JSON.", "Paste the whole file here.", "Add the service account's email to a shared drive as Content manager."],
    hint: "The whole .json key file",
    guide: "docs/keys/google-drive.md",
  },
  {
    name: "TYPESAFE_API_KEY", label: "TypeSafe", group: "advanced",
    unlocks: "An alternative AI for reading ads and checking creatives (switch to it under AI models).",
    getUrl: "https://console.typesafe.ai/keys",
    steps: ["Sign in to the TypeSafe console (Jev is in early access).", "Open API Keys and create a key.", "Copy the key and paste it here, then choose TypeSafe under Settings > AI models."],
    hint: "Your TypeSafe key (it can't be checked until it is used)",
    guide: "docs/keys/typesafe.md",
  },
  {
    name: "TIKTOK_RESEARCH_CLIENT_KEY", label: "TikTok research client key", group: "advanced", pairsWith: ["TIKTOK_RESEARCH_CLIENT_SECRET"],
    unlocks: "Pulls competitors' TikTok ads from TikTok's Commercial Content API.",
    getUrl: "https://developers.tiktok.com/products/commercial-content-api",
    steps: ["Apply for the Commercial Content API (reviewed by hand, often refused).", "After approval, open the project's registration details.", "Copy the client key here and the client secret below."],
    hint: "Client key from your approved project",
    guide: "docs/keys/tiktok.md",
  },
  {
    name: "TIKTOK_RESEARCH_CLIENT_SECRET", label: "TikTok research client secret", group: "advanced", pairsWith: ["TIKTOK_RESEARCH_CLIENT_KEY"],
    unlocks: "Used together with the TikTok research client key.",
    getUrl: "https://developers.tiktok.com/products/commercial-content-api",
    steps: ["Open the same project's registration details on TikTok for Developers.", "Click Display next to the client secret and copy it.", "Paste it here."],
    hint: "Client secret from the same project",
    guide: "docs/keys/tiktok.md",
  },
];

export const keySpec = (name: string): KeySpec | undefined => KEY_CATALOG.find((k) => k.name === name);
export const keysInGroup = (group: KeyGroup): KeySpec[] => KEY_CATALOG.filter((k) => k.group === group);
