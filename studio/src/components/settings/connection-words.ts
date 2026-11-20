// A connection check's result (App settings › Connections, Measure's source cards) in the page's
// language. The checks (lib/server/connections/*.ts and the `metrics` edge function's /verify) answer and
// store their result in English, so a stored check reads the same whatever language checked it; this
// file lists every sentence they write, as templates, and translates a result sentence by sentence
// where it is shown. Anything it doesn't know (a provider's own error text) is passed to the backend
// message translator, then left as it came.
//   connectionMessage(status.message, tr)
import { m } from "../../lib/i18n/translate";
import { templateTranslator } from "../../lib/i18n/template-match";

/** Every sentence a connection check writes. {name} marks a value; {n} and {status} are numbers. */
export const CONNECTION_SENTENCES: readonly string[] = [
  // The studio's own checks (lib/server/connections).
  m("Add the ad account ID first."),
  m("Add the RevenueCat project ID first."),
  m("Add the Mixpanel project ID first."),
  m("Add the Superwall application ID first."),
  m("Add the AppStack app ID first."),
  m("Can't open {folder}: {reason}"),
  m("Files go to {folder}."),
  m("The Google Drive folder isn't checked yet."),
  m("Checking {provider} needs the latest metrics function deployed."),
  m("Checking {provider} failed ({status})."),
  m("The IDs are saved."),
  m("The check failed: {reason}"),
  // The metrics function's /verify (supabase/functions/metrics).
  m("{provider} can't be checked yet."),
  m("Launch can't write to it until it's on META_ALLOWED_AD_ACCOUNTS."),
  m("Ad account \"{name}\" ({currency}) is readable."),
  m("It isn't active (status {status})."),
  m("Page \"{name}\" is readable."),
  m("No Page id is set, so the Page wasn't checked."),
  m("The ad account is readable, but the Page ({id}) isn't: {reason}"),
  m("Meta answered {status}: {reason}"),
  m("RevenueCat project {id} is readable ({n} overview metrics)."),
  m("RevenueCat answered {status}: {reason}"),
  m("Add the AppStack app ID (bundle id) first."),
  m("AppStack's export for {id} is readable."),
  m("AppStack rejected the key. Copy the app's API key from AppStack's app settings into APPSTACK_API_KEY (or APPSTACK_API_KEY_<APP>)."),
  m("AppStack answered {status}: {reason}"),
  m("Add the Mixpanel project ID (numbers only) first."),
  m("Add the Mixpanel project ID (numbers only) on the connection card."),
  m("Mixpanel project {id} is readable: {n} people did \"{event}\" in the last 7 days."),
  m("Mixpanel project {id} is readable, but nobody did \"{event}\" in the last 7 days."),
  m("Check the install event's name on the card."),
  m("Its most common events: {names}."),
  m("Set the install event (and the others) under Event names."),
  m("The Mixpanel key should be the service account's username and secret as username:secret."),
  m("Mixpanel rejected the service account. Check the username and secret (Organization settings > Service accounts) and update MIXPANEL_SERVICE_ACCOUNT."),
  m("The Mixpanel service account can't read this project. Add the project to it (Organization settings > Service accounts > the account > Projects)."),
  m("Mixpanel doesn't know this project here. Check the project ID and the data residency (US, EU or India) on the connection card."),
  m("Mixpanel's rate limit was hit (60 queries an hour per project). Try again later."),
  m("Mixpanel refused the query. Check the project ID, the data residency and the event names."),
  m("Mixpanel refused the query ({reason}). Check the project ID, the data residency and the event names."),
  m("Mixpanel answered {status}."),
  m("Mixpanel answered {status} ({reason})."),
  m("Superwall {app} is readable: {n} paywall views in the last 7 days."),
  m("Add the Superwall application ID (numbers only) on the connection card."),
  m("Superwall has no application {id} in this key's organization. Check the ID (Settings > Keys in the app's dashboard) and that the key has access to all projects."),
  m("Superwall rejected the key. Create an organization API key (Settings > API Keys) and update SUPERWALL_API_KEY."),
  m("The Superwall key can't read analytics. Give it the data:read and projects:read scopes and access to all projects."),
  m("The Superwall key can't list projects. Give it the projects:read scope too (it needs data:read and projects:read, with access to all projects)."),
  m("Superwall doesn't know this application in the key's organization. Check the application ID on the connection card."),
  m("Superwall's rate limit was hit. Try again in a few minutes."),
  m("Superwall answered {status}."),
  m("Superwall answered {status}: {reason}."),
];

/** A stored or answered connection-check message in the page's language (unchanged in English). */
export const connectionMessage = templateTranslator(CONNECTION_SENTENCES);
