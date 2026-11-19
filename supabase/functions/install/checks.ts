// Live checks of an API key, run before it is stored (Settings > API keys) and again on "Check".
//
// Each check is the cheapest read its provider offers, at the same address and with the same headers
// as the code that later uses the key (the function named next to each check). Nothing here touches
// the database or the environment: the transport and the "other half of a pair" lookup are passed in,
// so every check runs in tests against a fake provider.
//
// A check answers one of three ways:
//   ok          the provider accepted the key.
//   failed      the provider rejected it (or it isn't the right kind of value). Nothing is stored.
//   unverified  it couldn't be decided: the provider has no cheap check, the other half of a pair is
//               missing, or the provider couldn't be reached. The key is stored and can be checked again.
import { signedAssertion, type ServiceAccount } from "../creatives/core/drive.ts";
import { apiRequestFor, HiggsfieldApiError, higgsfieldApi } from "../creatives/core/hf_api.ts";
import { GRAPH_HOST, GRAPH_VERSION } from "../launch/graph.ts";
import { metaAdLibraryUrl, TIKTOK_LIBRARY, tiktokTokenBody } from "../radar/engine/adlibrary.ts";

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type CheckStatus = "ok" | "failed" | "unverified";

export interface CheckResult {
  status: CheckStatus;
  /** One plain sentence for the Settings page: what was found, or what to do. */
  message: string;
  /** Other key names this result also proves good (the other half of a pair checked together). */
  also?: string[];
}

export interface CheckContext {
  fetch: Fetch;
  /** The value of another key that is already set (environment or Vault), for keys that only work in pairs. */
  other(name: string): Promise<string | undefined>;
}

const TIMEOUT_MS = 15_000;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const ok = (message: string, also?: string[]): CheckResult => ({ status: "ok", message, ...(also?.length ? { also } : {}) });
const failed = (message: string): CheckResult => ({ status: "failed", message });
const unverified = (message: string): CheckResult => ({ status: "unverified", message });
/** The provider couldn't be asked, so the key is kept and can be checked again. */
const unreachable = (provider: string, why: string) => unverified(`${provider} couldn't be reached to check this key (${why}). It's saved; press Check again in a minute.`);

/** Why a request failed, without the address it went to (a fetch error quotes the whole URL). */
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))
  .replace(/https?:\/\/[^\s)]+/g, (url) => { try { return new URL(url).host; } catch { return ""; } })
  .slice(0, 120);
const json = async (response: Response): Promise<Record<string, unknown>> => {
  try { return (await response.json()) as Record<string, unknown>; } catch { return {}; }
};
const oneLine = (value: string) => !/\s/.test(value);
const NOT_ONE_LINE = "A key has no spaces or line breaks. Copy it again and paste only the key.";

/** Mirrors `install_secret_allowed` in the install_core migration: the names a person may set. */
export const KEY_NAMES = [
  "OPENAI_API_KEY", "TYPESAFE_API_KEY", "APIFY_TOKEN",
  "META_AD_LIBRARY_TOKEN", "META_SYSTEM_USER_TOKEN", "META_APP_SECRET",
  "REVENUECAT_API_KEY", "APPSTACK_API_KEY", "HIGGSFIELD_API_KEY",
  "GOOGLE_SERVICE_ACCOUNT_JSON", "CREATIVES_RUNNER_SECRET",
  "TIKTOK_RESEARCH_CLIENT_KEY", "TIKTOK_RESEARCH_CLIENT_SECRET",
] as const;
export const APPSTACK_PER_APP = /^APPSTACK_API_KEY_[A-Za-z0-9_]{1,64}$/;
export const isKeyName = (name: unknown): name is string =>
  typeof name === "string" && ((KEY_NAMES as readonly string[]).includes(name) || APPSTACK_PER_APP.test(name));

/** A runner secret is chosen (or generated) here, not issued by a provider: only its length can be judged. */
export const RUNNER_SECRET_MIN = 24;

/**
 * Takes every secret that went into a check out of the sentence it produced. A provider's own error
 * text is quoted in some answers (Meta, Google), and a provider may echo the token it was sent; that
 * sentence is stored next to the key and shown to every member, so it must never carry a key: not the
 * one being checked, and not the other half of a pair read from Vault.
 */
export function withoutSecrets(text: string, secrets: readonly (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 6) continue;
    for (const form of new Set([secret, encodeURIComponent(secret)])) out = out.split(form).join("[hidden]");
  }
  return out;
}

/** The parts of a value that are secret on their own (a service account file's private key). */
function secretParts(name: string, value: string): string[] {
  if (name !== "GOOGLE_SERVICE_ACCOUNT_JSON") return [value];
  try {
    const key = (JSON.parse(value) as { private_key?: unknown }).private_key;
    return typeof key === "string" ? [value, key] : [value];
  } catch {
    return [value];
  }
}

/** Checks one key. Never throws: a provider that can't be reached answers `unverified`. The message never holds a key. */
export async function checkKey(name: string, raw: string, ctx: CheckContext): Promise<CheckResult> {
  const used: string[] = secretParts(name, raw.trim());
  const other = async (otherName: string) => {
    const value = await ctx.other(otherName);
    if (value) used.push(value);
    return value;
  };
  const result = await decide(name, raw, { fetch: ctx.fetch, other });
  return { ...result, message: withoutSecrets(result.message, used) };
}

async function decide(name: string, raw: string, ctx: CheckContext): Promise<CheckResult> {
  const value = raw.trim();
  if (!value) return failed("The key is empty.");
  if (name === "GOOGLE_SERVICE_ACCOUNT_JSON") return await checkGoogleServiceAccount(value, ctx.fetch);
  if (!oneLine(value)) return failed(NOT_ONE_LINE);
  switch (name) {
    case "OPENAI_API_KEY": return await checkOpenAi(value, ctx.fetch);
    case "APIFY_TOKEN": return await checkApify(value, ctx.fetch);
    case "META_SYSTEM_USER_TOKEN": return await checkMetaToken(value, await ctx.other("META_APP_SECRET"), ctx.fetch);
    case "META_APP_SECRET": return await checkMetaAppSecret(value, await ctx.other("META_SYSTEM_USER_TOKEN"), ctx.fetch);
    case "META_AD_LIBRARY_TOKEN": return await checkMetaAdLibrary(value, ctx.fetch);
    case "REVENUECAT_API_KEY": return await checkRevenueCat(value, ctx.fetch);
    case "HIGGSFIELD_API_KEY": return await checkHiggsfield(value, ctx.fetch);
    case "TIKTOK_RESEARCH_CLIENT_KEY": return await checkTikTok(value, await ctx.other("TIKTOK_RESEARCH_CLIENT_SECRET"), "TIKTOK_RESEARCH_CLIENT_SECRET", ctx.fetch);
    case "TIKTOK_RESEARCH_CLIENT_SECRET": return await checkTikTok(await ctx.other("TIKTOK_RESEARCH_CLIENT_KEY"), value, "TIKTOK_RESEARCH_CLIENT_KEY", ctx.fetch);
    case "TYPESAFE_API_KEY": return unverified("TypeSafe has no quick way to check a key. It's saved and is used the next time an ad is read.");
    case "CREATIVES_RUNNER_SECRET":
      return value.length >= RUNNER_SECRET_MIN
        ? ok("Saved. Give the same secret to the desktop runner.")
        : failed(`Use at least ${RUNNER_SECRET_MIN} characters, or generate one with Rotate.`);
    default:
      if (name === "APPSTACK_API_KEY" || APPSTACK_PER_APP.test(name)) return await checkAppStack(value, ctx.fetch);
      return failed("This isn't a key the app uses.");
  }
}

// MARK: OpenAI (list models; the key is used by research, insight, creatives and radar)

export async function checkOpenAi(key: string, fetchImpl: Fetch): Promise<CheckResult> {
  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return unreachable("OpenAI", reason(error));
  }
  if (response.ok) return ok("OpenAI accepted the key.");
  if (response.status === 401) return failed("OpenAI rejected this key. Create a new secret key at platform.openai.com > API keys and paste it here.");
  if (response.status === 403) return failed("OpenAI accepted the key but it may not list models. Use a key with full (not restricted) permissions, or allow Models: read.");
  return unreachable("OpenAI", `it answered ${response.status}`);
}

// MARK: Apify (users/me; radar/engine/apify.ts)

export async function checkApify(token: string, fetchImpl: Fetch): Promise<CheckResult> {
  let response: Response;
  try {
    response = await fetchImpl("https://api.apify.com/v2/users/me", { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return unreachable("Apify", reason(error));
  }
  if (response.ok) {
    const user = (await json(response)).data as { username?: string } | undefined;
    return ok(user?.username ? `Apify accepted the token (account ${user.username}).` : "Apify accepted the token.");
  }
  if (response.status === 401 || response.status === 403) return failed("Apify rejected this token. Copy the personal API token from console.apify.com > Settings > API & Integrations.");
  return unreachable("Apify", `it answered ${response.status}`);
}

// MARK: Meta system user token + app secret (launch/graph.ts, metrics/meta.ts)

/** HMAC-SHA256 of the token keyed by the app secret, hex: what Meta calls appsecret_proof. */
export async function appSecretProof(token: string, appSecret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(token)));
  return [...signature].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface MetaAnswer { reached: boolean; ok: boolean; name?: string; code?: number; subcode?: number; message: string }

/** GET /me with the token in the header (never the URL) and, when there is a secret, its proof. */
async function metaMe(token: string, appSecret: string | undefined, fetchImpl: Fetch): Promise<MetaAnswer> {
  const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/me`);
  url.searchParams.set("fields", "id,name");
  if (appSecret) url.searchParams.set("appsecret_proof", await appSecretProof(token, appSecret));
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return { reached: false, ok: false, message: reason(error) };
  }
  const body = await json(response);
  const error = body.error as { message?: string; code?: number; error_subcode?: number } | undefined;
  if (response.ok && !error) return { reached: true, ok: true, name: typeof body.name === "string" ? body.name : undefined, message: "" };
  if (!error && response.status >= 500) return { reached: false, ok: false, message: `it answered ${response.status}` };
  return { reached: true, ok: false, code: error?.code, subcode: error?.error_subcode, message: error?.message ?? `Meta answered ${response.status}` };
}

const badToken = (a: MetaAnswer) => a.code === 190;
const proofProblem = (a: MetaAnswer) => /appsecret_proof/i.test(a.message);
const TOKEN_REJECTED = "Meta rejected this token (wrong, expired or revoked). Generate a new system user token in Business settings > System users and paste it here.";
const SECRET_MISMATCH = "Meta rejected the app secret for this token. Both must come from the same Meta app: copy the secret from that app's Settings > Basic.";

export async function checkMetaToken(token: string, appSecret: string | undefined, fetchImpl: Fetch): Promise<CheckResult> {
  const answer = await metaMe(token, appSecret, fetchImpl);
  if (!answer.reached) return unreachable("Meta", answer.message);
  if (badToken(answer)) return failed(TOKEN_REJECTED);
  if (!appSecret) {
    // Half a pair: the token alone can't be fully checked, because Meta may want every call signed.
    return unverified(answer.ok
      ? "Meta accepted the token. Add your Meta app secret too, so every call to Meta is signed and the pair can be checked together."
      : "Saved, but not checked yet: add your Meta app secret too (Meta wants calls with this token signed).");
  }
  if (answer.ok) return ok(answer.name ? `Meta accepted the token and app secret (system user ${answer.name}).` : "Meta accepted the token and app secret.", ["META_APP_SECRET"]);
  if (proofProblem(answer)) return failed("Meta rejected this token with the saved app secret. Both must come from the same Meta app: use a token made in that app, or replace the app secret first.");
  return failed(`Meta didn't accept the token: ${answer.message}`);
}

export async function checkMetaAppSecret(appSecret: string, token: string | undefined, fetchImpl: Fetch): Promise<CheckResult> {
  if (!token) return unverified("Saved, but not checked yet: add your Meta system user token too, then the pair is checked together.");
  const answer = await metaMe(token, appSecret, fetchImpl);
  if (!answer.reached) return unreachable("Meta", answer.message);
  if (answer.ok) return ok("Meta accepted the app secret with the saved token.", ["META_SYSTEM_USER_TOKEN"]);
  if (proofProblem(answer)) return failed(SECRET_MISMATCH);
  if (badToken(answer)) return unverified("The saved Meta system user token was rejected by Meta, so the app secret couldn't be checked. Replace the token, then check again.");
  return unverified(`Meta couldn't check the pair: ${answer.message}`);
}

// MARK: Meta Ad Library token (one `ads_archive` row, as research/index.ts pulls them)

export async function checkMetaAdLibrary(token: string, fetchImpl: Fetch): Promise<CheckResult> {
  const url = new URL(metaAdLibraryUrl({ searchTerms: "shoes", countries: ["GB"], limit: 1 }));
  // Only the id is needed to know the token works. The token goes in the header, so it is never in an address.
  url.searchParams.set("fields", "id");
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return unreachable("Meta's Ad Library", reason(error));
  }
  const body = await json(response);
  const error = body.error as { message?: string; code?: number; error_subcode?: number } | undefined;
  if (response.ok && !error) return ok("Meta's Ad Library accepted the token.");
  if (error?.code === 190) return failed("Meta rejected this token (wrong or expired). Generate a new access token for your app at developers.facebook.com and paste it here.");
  if (error?.code === 10 || error?.code === 200 || error?.error_subcode === 2332002) {
    return failed("Meta accepted the token, but it has no Ad Library API access yet. Confirm your identity at facebook.com/ID, accept the terms at facebook.com/ads/library/api, then try again.");
  }
  if (!error && response.status >= 500) return unreachable("Meta's Ad Library", `it answered ${response.status}`);
  if (error?.code === 4 || error?.code === 17 || error?.code === 613) return unreachable("Meta's Ad Library", "its rate limit was hit");
  return failed(`Meta's Ad Library didn't accept the token: ${error?.message ?? `it answered ${response.status}`}`);
}

// MARK: RevenueCat (list projects; metrics/revenuecat.ts reads the same v2 API)

export async function checkRevenueCat(key: string, fetchImpl: Fetch): Promise<CheckResult> {
  let response: Response;
  try {
    response = await fetchImpl("https://api.revenuecat.com/v2/projects?limit=1", { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return unreachable("RevenueCat", reason(error));
  }
  if (response.ok) return ok("RevenueCat accepted the key.");
  if (response.status === 401) return failed("RevenueCat rejected this key. Create a secret key (v2) under your project's API keys and paste it here.");
  if (response.status === 403) {
    // A real v2 key that may read charts but not list projects: it can only be judged against a project.
    return unverified("RevenueCat knows this key, but it may not list projects. It's saved; check it from a workspace's connections, where it reads that project's numbers.");
  }
  return unreachable("RevenueCat", `it answered ${response.status}`);
}

// MARK: AppStack (one row of the export; metrics/appstack.ts checkAppStack)

export async function checkAppStack(key: string, fetchImpl: Fetch): Promise<CheckResult> {
  const url = new URL("https://api.appstack.tech/api/v1/export");
  url.searchParams.set("timestamp", String(Math.floor(Date.now() / 1000) - 86_400));
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), { headers: { Authorization: key, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return unreachable("AppStack", reason(error));
  }
  if (response.ok) return ok("AppStack accepted the key.");
  if (response.status === 401 || response.status === 403) return failed("AppStack rejected this key. Copy the API key from your app's settings in AppStack and paste it here.");
  return unreachable("AppStack", `it answered ${response.status}`);
}

// MARK: Higgsfield (a free price estimate; creatives/core/hf_api.ts)

export async function checkHiggsfield(key: string, fetchImpl: Fetch): Promise<CheckResult> {
  const request = apiRequestFor("marketing_studio_image", "A red apple on a white table.", { aspect_ratio: "1:1" })!;
  try {
    await higgsfieldApi(key, fetchImpl as typeof fetch).estimate(request);
    return ok("Higgsfield accepted the key.");
  } catch (error) {
    if (error instanceof HiggsfieldApiError) {
      if (error.status === 401 || error.status === 403) return failed("Higgsfield rejected this key. Create an API key in the Higgsfield console and paste the key ID and secret together, as ID:SECRET.");
      return unreachable("Higgsfield", `it answered ${error.status}`);
    }
    return unreachable("Higgsfield", reason(error));
  }
}

// MARK: Google service account (parse, then the token exchange creatives/core/drive.ts does)

const NOT_A_KEY_FILE = "This isn't a Google service account key. Paste the whole contents of the .json key file you downloaded from Google Cloud.";

export async function checkGoogleServiceAccount(raw: string, fetchImpl: Fetch): Promise<CheckResult> {
  let account: ServiceAccount & { type?: string };
  try { account = JSON.parse(raw); } catch { return failed(NOT_A_KEY_FILE); }
  if (!account || typeof account !== "object" || typeof account.client_email !== "string" || typeof account.private_key !== "string") return failed(NOT_A_KEY_FILE);
  if (account.type && account.type !== "service_account") return failed(NOT_A_KEY_FILE);
  // The file names where tokens come from; only Google's own address is ever called.
  if (account.token_uri && account.token_uri !== GOOGLE_TOKEN_URL) return failed(NOT_A_KEY_FILE);
  let assertion: string;
  try {
    assertion = await signedAssertion(account);
  } catch {
    return failed("The private key in this file couldn't be read. Create a new JSON key for the service account and paste the whole file.");
  }
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return unreachable("Google", reason(error));
  }
  const body = await json(response);
  if (response.ok && typeof body.access_token === "string") return ok(`Google accepted the service account ${account.client_email}. Share your Drive folder with that address.`);
  if (response.status >= 500) return unreachable("Google", `it answered ${response.status}`);
  const detail = String(body.error_description ?? body.error ?? `it answered ${response.status}`).slice(0, 160);
  return failed(`Google rejected this service account key (${detail}). Create a new JSON key for the service account and paste the whole file.`);
}

// MARK: TikTok Commercial Content API (the client-credentials exchange research/index.ts does)

/** `otherHalf` is the name of the key that wasn't just entered: the one to ask for when missing, and to mark good with this one. */
export async function checkTikTok(clientKey: string | undefined, clientSecret: string | undefined, otherHalf: string, fetchImpl: Fetch): Promise<CheckResult> {
  if (!clientKey || !clientSecret) {
    const half = otherHalf === "TIKTOK_RESEARCH_CLIENT_SECRET" ? "client secret" : "client key";
    return unverified(`Saved, but not checked yet: add your TikTok research ${half} too, then the pair is checked together.`);
  }
  let response: Response;
  try {
    response = await fetchImpl(TIKTOK_LIBRARY.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tiktokTokenBody(clientKey, clientSecret),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return unreachable("TikTok", reason(error));
  }
  const body = await json(response);
  if (response.ok && typeof body.access_token === "string") return ok("TikTok accepted the client key and secret.", [otherHalf]);
  if (response.status >= 500) return unreachable("TikTok", `it answered ${response.status}`);
  return failed("TikTok rejected this client key and secret. Copy both from your app's credentials on TikTok for Developers; they must belong to the same app.");
}
