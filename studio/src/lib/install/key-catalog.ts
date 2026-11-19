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
    steps: ["Sign in to the OpenAI platform and add a payment method under Billing.", "Open API keys and choose Create new secret key.", "Copy the key and paste it here."],
    hint: "Starts with sk-",
  },
  {
    name: "APIFY_TOKEN", label: "Apify", group: "research",
    unlocks: "Collects competitors' Instagram, TikTok, YouTube and X posts, and pulls their ads on a schedule.",
    getUrl: "https://console.apify.com/settings/integrations",
    steps: ["Create a free Apify account.", "Open Settings, then API & Integrations.", "Copy the personal API token and paste it here."],
    hint: "Starts with apify_api_",
  },
  {
    name: "META_AD_LIBRARY_TOKEN", label: "Meta Ad Library", group: "research",
    unlocks: "Pulls competitors' ads from Meta's official Ad Library API (ads shown in the EU and UK).",
    getUrl: "https://www.facebook.com/ads/library/api",
    steps: ["Confirm your identity with Meta for Ad Library API access.", "Create an app at developers.facebook.com and generate an access token.", "Paste the token here."],
    hint: "A long token starting with EAA",
  },
  {
    name: "HIGGSFIELD_API_KEY", label: "Higgsfield", group: "creative",
    unlocks: "Image and video generation in Studio and Playground.",
    getUrl: "https://console.higgsfield.ai",
    steps: ["Sign in to the Higgsfield console and add API credits (they are separate from a Higgsfield web plan).", "Open API keys and create a key. It shows a key ID and a secret.", "Paste them together as ID:SECRET, with a colon between them."],
    hint: "Key ID and secret as ID:SECRET",
  },
  {
    name: "META_SYSTEM_USER_TOKEN", label: "Meta system user token", group: "ads", pairsWith: ["META_APP_SECRET"],
    unlocks: "Launch (paused ad drafts in your ad account) and Meta spend in Measure.",
    getUrl: "https://business.facebook.com/settings/system-users",
    steps: ["In Meta Business settings, add a system user with access to your ad account and Page.", "Generate a token with ads_management, ads_read and pages_read_engagement.", "Paste the token here."],
    hint: "A long token starting with EAA",
  },
  {
    name: "META_APP_SECRET", label: "Meta app secret", group: "ads", pairsWith: ["META_SYSTEM_USER_TOKEN"],
    unlocks: "Signs every call to Meta, which Meta requires for system user tokens.",
    getUrl: "https://developers.facebook.com/apps",
    steps: ["Open the Meta app the system user belongs to.", "Go to App settings, then Basic.", "Show the App secret and paste it here."],
    hint: "32 letters and numbers",
  },
  {
    name: "REVENUECAT_API_KEY", label: "RevenueCat", group: "ads",
    unlocks: "Trials, purchases and revenue in Measure.",
    getUrl: "https://app.revenuecat.com",
    steps: ["Open your RevenueCat project, then API keys.", "Create a secret key (v2) with read access to charts and metrics.", "Paste the key here."],
    hint: "Starts with sk_",
  },
  {
    name: "APPSTACK_API_KEY", label: "AppStack", group: "ads",
    unlocks: "Installs and revenue attributed to each ad in Measure.",
    getUrl: "https://docs.appstack.tech/api/export",
    steps: ["Sign in to AppStack and open your app's settings.", "Create an API key for the export API (the linked page shows where).", "Paste the key here."],
    hint: "Your AppStack API key",
  },
  {
    name: "GOOGLE_SERVICE_ACCOUNT_JSON", label: "Google Drive service account", group: "advanced", multiline: true,
    unlocks: "Exports approved creatives to a Google Drive folder.",
    getUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts",
    steps: ["Create a service account in Google Cloud and enable the Drive API.", "Create a JSON key for it and open the downloaded file.", "Paste the whole file's contents here, then share your Drive folder with the service account's email."],
    hint: "The contents of the .json key file",
  },
  {
    name: "TYPESAFE_API_KEY", label: "TypeSafe", group: "advanced",
    unlocks: "An alternative AI for reading ads and checking creatives (switch to it under AI models).",
    getUrl: "https://docs.typesafe.ai/",
    steps: ["Create a TypeSafe account.", "Create an API key (the linked guide shows where).", "Paste the key here."],
    hint: "Your TypeSafe API key",
  },
  {
    name: "TIKTOK_RESEARCH_CLIENT_KEY", label: "TikTok research client key", group: "advanced", pairsWith: ["TIKTOK_RESEARCH_CLIENT_SECRET"],
    unlocks: "Pulls competitors' TikTok ads from TikTok's Commercial Content API.",
    getUrl: "https://developers.tiktok.com/products/commercial-content-api",
    steps: ["Apply for the Commercial Content API on TikTok for Developers.", "Open your app's credentials.", "Paste the client key here and the client secret below."],
    hint: "Your app's client key",
  },
  {
    name: "TIKTOK_RESEARCH_CLIENT_SECRET", label: "TikTok research client secret", group: "advanced", pairsWith: ["TIKTOK_RESEARCH_CLIENT_KEY"],
    unlocks: "Used together with the TikTok research client key.",
    getUrl: "https://developers.tiktok.com/products/commercial-content-api",
    steps: ["Open the same app's credentials on TikTok for Developers.", "Copy the client secret.", "Paste it here."],
    hint: "Your app's client secret",
  },
];

export const keySpec = (name: string): KeySpec | undefined => KEY_CATALOG.find((k) => k.name === name);
export const keysInGroup = (group: KeyGroup): KeySpec[] => KEY_CATALOG.filter((k) => k.group === group);
