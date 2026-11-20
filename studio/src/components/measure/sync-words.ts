// What a Measure source's last sync said (supabase/functions/metrics: index.ts and sources.ts), in the
// page's language. The metrics function writes and stores one English sentence per source sync; this
// file lists every one of them as templates for the dictionaries and translates a stored message where
// Measure and App settings show it. A provider's own error text (inside "Meta answered …") stays as it came.
//   syncMessage(data.sync.meta?.message, useT())
import { m, type Translator } from "../../lib/i18n/translate";
import { KEY_LABELS } from "../../lib/i18n/server-messages";
import { templateTranslator } from "../../lib/i18n/template-match";
import { CONNECTION_SENTENCES } from "../settings/connection-words";

export const SYNC_SENTENCES: readonly string[] = [
  m("{account}: {ads} ads, {days} ad-days since {date} ({amount} {currency} spent)."),
  m("{account}: no delivery since {date}."),
  m("{n} daily values since {date}."),
  m("Skipped (refused, rate-limited or out of time; the next sync tries again): {list}."),
  m("{installs} installs and {purchases} purchases attributed since {date}."),
  m("{installs} installs and {values} daily values since {date}."),
  m("No one did {events}: check those event names."),
  m("Skipped for time (the next sync tries again): {list}."),
  m("{app}: {opens} paywall views and {conversions} paid purchases since {date}."),
  m("Sync failed: {reason}"),
  m("Meta isn't connected: add the ad account id to this workspace's connections."),
  m("RevenueCat isn't connected: add the project id to this workspace's connections."),
  m("AppStack isn't connected: add the app id (bundle id) to this workspace's connections."),
  m("Mixpanel isn't connected: add the project ID to this app's connections."),
  m("Superwall isn't connected: add the application ID to this app's connections."),
  m("{provider} isn't connected: add {key} in Settings > API keys."),
  m("(synced a moment ago)"),
];

const SUFFIX = " (synced a moment ago)";
const say = templateTranslator([...SYNC_SENTENCES, ...CONNECTION_SENTENCES], KEY_LABELS);

/** A stored sync message in the page's language (unchanged in English); a repeat's "(synced a moment ago)" is kept. */
export function syncMessage(message: string | null | undefined, tr: Pick<Translator, "t" | "locale">): string {
  if (!message) return message ?? "";
  if (tr.locale === "en" || !message.endsWith(SUFFIX)) return say(message, tr);
  return `${say(message.slice(0, -SUFFIX.length), tr)}${tr.locale === "ko" ? " " : ""}${tr.t("(synced a moment ago)")}`;
}
