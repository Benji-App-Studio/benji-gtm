// Messages the backend writes in English (edge functions in supabase/functions, the database's plan
// guards, the studio's own fallbacks in lib/server/functions.ts), shown in the page's language.
//
// The backend answers `{ error: "Add your OpenAI key in Settings > API keys." }`. Every message here is a
// template marked with m() (so the coverage check makes sure each language has it); a message from the
// backend is matched against them, its {values} picked out, and the template translated with them. A
// message made of several sentences is matched sentence by sentence. Anything unknown stays in English,
// never blank. An answer that carries a stable `code` (and `values`) is translated by that code first, so
// a function can change its English wording without breaking the translation.
//
//   translateServerMessage("Your plan allows 2 apps. Delete an app you no longer need to add another.", tr)
//     → "ご利用のプランで作成できるアプリは 2 件までです。…"
//
// Server side, relay() in lib/server/functions.ts translates every relayed `error`. In the browser, pass
// the translator from useT(): translateServerMessage(data.error, useT()).
// Plain TypeScript (server-messages.test.ts).
// (Written "../i18n/translate", not "./translate", so the coverage check sees this file: it looks for /i18n/ imports.)
import { gapBetween } from "../i18n/join";
import { m, type Translator, type Vars } from "../i18n/translate";

type Tr = Pick<Translator, "t" | "locale">;

/** The names of keys in "Add {key} in Settings > API keys." (supabase/functions/_shared/keys.ts KEY_LABELS). */
export const KEY_LABELS = [
  m("your OpenAI key"), m("your TypeSafe key"), m("your Apify token"), m("your Meta Ad Library token"), m("your Meta system user token"),
  m("your Meta app secret"), m("your RevenueCat key"), m("your AppStack key"), m("your Higgsfield key"), m("your Google Drive service account"),
  m("the desktop runner's secret"), m("your TikTok research client key"), m("your TikTok research client secret"), m("your Mixpanel service account"),
  m("your Superwall API key"),
];

/** Every message the backend sends that a person sees, as written there. {name} marks a value. */
export const SERVER_MESSAGES = [
  // Keys and the AI (_shared/keys.ts, _shared/ai).
  m("Add {key} in Settings > API keys."),
  m("{provider} refused the key: {reason} Check Settings > API keys."),
  m("The AI isn't connected."),
  m("The AI isn't connected: TypeSafe is the provider chosen in Settings."),
  m("OpenAI isn't connected."),
  m("The AI reader needs an OpenAI key."),
  m("The AI summary needs an OpenAI key."),
  m("Sorting needs an OpenAI key."),
  m("OpenAI didn't answer in time. Try again in a moment."),
  m("OpenAI's answer wasn't readable. Try again."),
  m("OpenAI wrote no usable copy. Try again."),
  m("The copy couldn't be written. Try again."),
  m("The copy request is too long."),
  m("The prompt is too long to improve."),
  m("OpenAI didn't confirm the search in time. It wasn't sent again, so it isn't paid for twice. The competitors found elsewhere are kept; search again to ask OpenAI once more."),
  m("Apify's monthly credit is used up. Add credit or upgrade at console.apify.com → Billing, then try again."),
  m("The desktop runner isn't set up yet. Create its secret in Settings > API keys, then give it to the runner."),
  // Signing in and access (_shared/auth.ts).
  m("Sign in first."),
  m("Your session has expired. Sign in again."),
  m("Confirm your email address first: open the link we sent you, then sign in again."),
  m("This account is suspended. Contact support if you think this is a mistake."),
  m("This account isn't a member of this install. Ask its owner to add you."),
  m("Only the owner of this install can do that."),
  // Plans, rates and storage (_shared/tenant.ts, _shared/storage.ts, the database's plan guards).
  m("That's a lot of requests in a short time. Wait a few minutes, then try again."),
  m("Your plan allows {n} apps. Delete an app you no longer need to add another."),
  m("Your plan allows {n} generations a month, and this month's are used up."),
  m("You have {n} generations waiting already. Let them finish (or cancel some), then try again."),
  m("Storage is full: nothing new can be saved. Free up space in Settings > Storage (or upgrade your Supabase plan), then retry."),
  m("Your storage is full: nothing new can be saved. Delete rejected or unused creatives, or old saved ad media, in Settings > Storage, then retry."),
  m("The file is bigger than your Supabase plan allows ({mb} MB). Make it smaller, or raise the limit on a paid plan."),
  m("The file is bigger than your Supabase plan allows. Make it smaller, or raise the limit on a paid plan."),
  m("This quality takes longer than your Supabase plan allows in one run. Use a lower quality, or upgrade the Supabase plan."),
  m("This run took too long and was stopped. Try again."),
  // Things that are gone.
  m("This product doesn't exist."),
  m("This app doesn't exist."),
  m("This workspace doesn't exist."),
  m("This creative doesn't exist."),
  m("This ad doesn't exist."),
  m("This project doesn't exist."),
  m("This template doesn't exist."),
  // Market (insight/market.ts) and the product profile (insight/index.ts).
  m("Only {n} review so far: too few to summarize. Refresh the app first, or try one with more reviews."),
  m("Only {n} reviews so far: too few to summarize. Refresh the app first, or try one with more reviews."),
  m("This chart came back empty. Try another category or country."),
  m("Add your App Store link first, then its reviews can be read."),
  // Composed ads (lib/server/compose.tsx).
  m("Couldn't load the Chinese font (Noto Sans TC) to set this copy. Try again in a moment."),
  m("Couldn't load the Japanese font (Noto Sans JP) to set this copy. Try again in a moment."),
  m("Couldn't load the Korean font (Noto Sans KR) to set this copy. Try again in a moment."),
  m("Some characters aren't in the built-in font: {chars}. They show as empty boxes: replace them or upload a brand font that has them."),
  // The studio's own answers when a function can't be reached (lib/server/functions.ts) and database errors (lib/db-errors.ts).
  m("This install isn't set up yet. Open /setup to connect a Supabase project."),
  m("The backend answered {status}. Try again in a moment."),
  m("Couldn't reach the backend. Try again in a moment."),
  m("The creatives backend answered {status}."),
  m("Couldn't reach the creatives backend. Try again in a moment."),
  m("The AI reader isn't deployed yet."),
  m("The database is missing a recent update. Open /setup, paste an access token and press Apply the update."),
  m("That already exists."),
  m("Something this refers to was deleted. Reload the page and try again."),
  m("You don't have access to change that. Ask the owner of this install."),
  m("Something went wrong: {detail}"),
  // Checking a key before it is stored (install/checks.ts): Settings > Your keys, the setup's key step, a connection card.
  m("{provider} couldn't be reached to check this key ({why}). It's saved; press Check again in a minute."),
  m("A key has no spaces or line breaks. Copy it again and paste only the key."),
  m("The key is empty."),
  m("TypeSafe has no quick way to check a key. It's saved and is used the next time an ad is read."),
  m("Saved. Give the same secret to the desktop runner."),
  m("Use at least {n} characters, or generate one with Rotate."),
  m("This isn't a key the app uses."),
  m("OpenAI accepted the key."),
  m("OpenAI rejected this key. Create a new secret key at platform.openai.com > API keys and paste it here."),
  m("OpenAI accepted the key but it may not list models. Use a key with full (not restricted) permissions, or allow Models: read."),
  m("Apify accepted the token (account {account})."),
  m("Apify accepted the token."),
  m("Apify rejected this token. Copy the personal API token from console.apify.com > Settings > API & Integrations."),
  m("Meta rejected this token (wrong, expired or revoked). Generate a new system user token in Business settings > System users and paste it here."),
  m("Meta rejected the app secret for this token. Both must come from the same Meta app: copy the secret from that app's Settings > Basic."),
  m("Meta accepted the token. Add your Meta app secret too, so every call to Meta is signed and the pair can be checked together."),
  m("Saved, but not checked yet: add your Meta app secret too (Meta wants calls with this token signed)."),
  m("Not checked yet: add your Meta app secret too (Meta wants calls with this token signed)."),
  m("Meta accepted the token and app secret (system user {name})."),
  m("Meta accepted the token and app secret."),
  m("Meta rejected this token with the saved app secret. Both must come from the same Meta app: use a token made in that app, or replace the app secret first."),
  m("Meta didn't accept the token: {detail}"),
  m("Saved, but not checked yet: add your Meta system user token too, then the pair is checked together."),
  m("Not checked yet: add your Meta system user token too, then the pair is checked together."),
  m("Meta accepted the app secret with the saved token."),
  m("The saved Meta system user token was rejected by Meta, so the app secret couldn't be checked. Replace the token, then check again."),
  m("Meta couldn't check the pair: {detail}"),
  m("Meta's Ad Library accepted the token."),
  m("Meta rejected this token (wrong or expired). Generate a new access token for your app at developers.facebook.com and paste it here."),
  m("Meta accepted the token, but it has no Ad Library API access yet. Confirm your identity at facebook.com/ID, accept the terms at facebook.com/ads/library/api, then try again."),
  m("Meta's Ad Library didn't accept the token: {detail}"),
  m("RevenueCat accepted the key."),
  m("RevenueCat rejected this key. Create a secret key (v2) under your project's API keys and paste it here."),
  m("RevenueCat knows this key, but it can't list projects (it needs Project configuration read). It's saved; your app's RevenueCat card checks it against that project."),
  m("AppStack accepted the key."),
  m("AppStack rejected this key. Copy the API key from your app's settings in AppStack and paste it here."),
  m("Paste the service account as username:secret (the username, a colon, then the secret Mixpanel showed once)."),
  m("Mixpanel accepted the service account ({email})."),
  m("Mixpanel accepted the service account."),
  m("Mixpanel rejected this service account. Copy the username and secret from Organization settings > Service accounts (the secret is shown once; make a new account if it's lost)."),
  m("Superwall accepted the key and can list projects. It also needs the data:read scope (with access to all projects); your app's Superwall card checks that."),
  m("Superwall rejected this key. Create an organization API key under Settings > API Keys in Superwall and paste it here."),
  m("Superwall knows this key, but it can't list projects. Give it the projects:read scope as well as data:read, with access to all projects."),
  m("Higgsfield accepted the key."),
  m("Higgsfield refused this key. Check that your API balance has funds (open.higgsfield.ai > Billing) and that the key is active, then click Copy API key there and paste it again."),
  m("This isn't a Google service account key. Paste the whole contents of the .json key file you downloaded from Google Cloud."),
  m("The private key in this file couldn't be read. Create a new JSON key for the service account and paste the whole file."),
  m("Google accepted the service account {email}. Share your Drive folder with that address."),
  m("Google rejected this service account key ({detail}). Create a new JSON key for the service account and paste the whole file."),
  m("Saved, but not checked yet: add your TikTok research client secret too, then the pair is checked together."),
  m("Saved, but not checked yet: add your TikTok research client key too, then the pair is checked together."),
  m("Not checked yet: add your TikTok research client secret too, then the pair is checked together."),
  m("Not checked yet: add your TikTok research client key too, then the pair is checked together."),
  m("TikTok accepted the client key and secret."),
  m("TikTok rejected this client key and secret. Copy both from your app's credentials on TikTok for Developers; they must belong to the same app."),
  // Checking an app's connections: what components/settings/connection-words.ts doesn't list (the providers' readers in metrics/, the verify route).
  m("Meta rejected the token (expired or revoked). Generate a new system user token and save it in Settings > API keys."),
  m("The system user can't read this ad account. In Business Settings, assign the ad account to the system user and give the token ads_read."),
  m("Meta's rate limit was hit. Try the sync again in a few minutes."),
  m("Meta didn't accept the request: {detail}. Check the ad account id."),
  m("RevenueCat rejected the key. Create a v2 secret key and update REVENUECAT_API_KEY."),
  m("The RevenueCat key can't read charts. Give it charts_metrics:overview:read and charts_metrics:charts:read."),
  m("RevenueCat doesn't know this project. Check the project id in the workspace's connections."),
  m("RevenueCat's rate limit was hit (25 chart requests a minute). Try again in a minute."),
  m("AppStack rejected the key. Copy the app's API key from AppStack's app settings into APPSTACK_API_KEY."),
  m("Choose a connection to check."),
  m("Save the IDs first."),
  m("The check ran but its result couldn't be saved. Try again."),
  // Parts of the key-check messages above: why a provider couldn't be asked, and which one.
  m("it answered {status}"),
  m("its rate limit was hit"),
  m("Meta's Ad Library"),
];

/**
 * Stable codes a function may send with its English `error` (`{ error, code, values }`), each with the
 * template it stands for. Edge functions don't have to send one: the English message is matched anyway.
 */
export const SERVER_CODES: Record<string, string> = {
  key_missing: m("Add {key} in Settings > API keys."),
  key_refused: m("{provider} refused the key: {reason} Check Settings > API keys."),
  rate_limited: m("That's a lot of requests in a short time. Wait a few minutes, then try again."),
  app_limit: m("Your plan allows {n} apps. Delete an app you no longer need to add another."),
  generation_limit: m("Your plan allows {n} generations a month, and this month's are used up."),
  open_jobs_limit: m("You have {n} generations waiting already. Let them finish (or cancel some), then try again."),
  storage_full: m("Storage is full: nothing new can be saved. Free up space in Settings > Storage (or upgrade your Supabase plan), then retry."),
  account_storage_full: m("Your storage is full: nothing new can be saved. Delete rejected or unused creatives, or old saved ad media, in Settings > Storage, then retry."),
  session_expired: m("Your session has expired. Sign in again."),
  ai_timeout: m("OpenAI didn't answer in time. Try again in a moment."),
};

const KNOWN = new Set<string>([...SERVER_MESSAGES, ...KEY_LABELS]);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Values that are numbers in every template ({n} apps, {mb} MB, answered {status}): matched as numbers only. */
const NUMERIC = new Set(["n", "mb", "status"]);
/** What a value may be: a number for the numeric ones, else one line of text (never empty, never a line break). */
const VALUE: Record<string, string> = { number: "(\\d[\\d.,]*)", text: "([^\\n]+?)" };
/** Templates with values, compiled once and anchored: "Your plan allows {n} apps." → /^Your plan allows (\d[\d.,]*) apps\.$/. */
const PATTERNS = SERVER_MESSAGES.filter((s) => /\{\w+\}/.test(s)).map((template) => {
  const names: string[] = [];
  const source = template.split(/(\{\w+\})/).map((part) => {
    const name = part.match(/^\{(\w+)\}$/)?.[1];
    if (!name) return escape(part);
    names.push(name);
    return NUMERIC.has(name) ? VALUE.number : VALUE.text;
  }).join("");
  return { template, names, re: new RegExp(`^${source}$`) };
});

/** One message (or one sentence of it), translated when it is known; null when it isn't. */
function matchOne(text: string, tr: Tr): string | null {
  if (KNOWN.has(text)) return tr.t(text);
  for (const { template, names, re } of PATTERNS) {
    const found = re.exec(text);
    if (!found) continue;
    // A value that is itself a known phrase ("your OpenAI key") or message ("it answered 503") is translated too.
    const vars: Record<string, string> = {};
    names.forEach((name, i) => { const value = found[i + 1]; vars[name] = KNOWN.has(value) ? tr.t(value) : value.length < text.length ? (matchOne(value, tr) ?? value) : value; });
    return tr.t(template, vars);
  }
  return null;
}


/**
 * A backend message in the page's language. Known messages (and known sentences of a longer one) are
 * translated; anything else comes back as it was. English pages get the message unchanged.
 */
export function translateServerMessage(message: string | null | undefined, tr: Tr): string {
  if (!message) return message ?? "";
  if (tr.locale === "en") return message;
  const text = message.trim();
  const whole = matchOne(text, tr);
  if (whole !== null) return whole;
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"“(])/);
  if (sentences.length < 2) return message;
  let changed = false;
  const out = sentences.map((sentence) => {
    const done = matchOne(sentence, tr);
    if (done === null) return sentence;
    changed = true;
    return done;
  });
  // Sentences sit the language's way; an English sentence left as it came keeps a space (lib/i18n/join.ts).
  return changed ? out.reduce((all, sentence, i) => (i === 0 ? sentence : `${all}${gapBetween(tr.locale, all, sentence)}${sentence}`), "") : message;
}

/**
 * The words to show for a backend answer: by its `code` (with `values`) when it has a known one, else its
 * `error` (or `message`) matched as above, else `fallback` (already in the page's language).
 */
export function serverErrorText(data: { error?: unknown; message?: unknown; code?: unknown; values?: unknown } | null | undefined, tr: Tr, fallback = ""): string {
  const code = typeof data?.code === "string" ? SERVER_CODES[data.code] : undefined;
  if (code) {
    const raw = data?.values && typeof data.values === "object" ? (data.values as Record<string, unknown>) : {};
    const vars: Vars = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => [k, typeof v === "string" && KNOWN.has(v) ? tr.t(v) : (v as string | number)]));
    return tr.t(code, vars);
  }
  const text = typeof data?.error === "string" && data.error ? data.error : typeof data?.message === "string" ? data.message : "";
  return text ? translateServerMessage(text, tr) : fallback;
}
