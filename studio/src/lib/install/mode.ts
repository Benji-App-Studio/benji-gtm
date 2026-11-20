// Whether this install's database hosts separate accounts (accounts mode: anyone may sign up and each
// account brings its own keys). The install function's unauthenticated `health` route says so
// (`{ ok: true, mode: "accounts" }`); install and legacy databases answer `{ ok: true }`.
//
// No `server-only` and no Next.js imports, so proxy.ts, the server pages and the Node tests share it.
// A failed check reads as "not accounts" (sign-up stays closed): never open sign-up on a guess.

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal; cache?: "no-store" }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const TTL_MS = 60_000;
const FAILED_TTL_MS = 10_000;
let cached: { key: string; until: number; accounts: boolean } | null = null;

/** Reads the mode once: true only when the install function answers `mode: "accounts"`. */
export async function readAccountsMode(fetchImpl: FetchLike, functionsBase: string, publishableKey: string, timeoutMs = 4_000): Promise<boolean | null> {
  try {
    const response = await fetchImpl(`${functionsBase.replace(/\/+$/, "")}/install/health`, {
      headers: { apikey: publishableKey }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store",
    });
    if (!response.ok) return null;
    const body = await response.json() as { mode?: unknown } | null;
    return body?.mode === "accounts";
  } catch {
    return null;
  }
}

/**
 * The same, remembered for a minute per project (a failed check for ten seconds). `override` is a
 * function address to use instead of the project's own (INSTALL_FUNCTION_URL while developing).
 */
export async function accountsMode(config: { supabaseUrl: string; publishableKey: string } | null, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<boolean> {
  if (!config) return false;
  const key = config.supabaseUrl;
  if (cached && cached.key === key && Date.now() < cached.until) return cached.accounts;
  const env = process.env;
  const override = env["INSTALL_FUNCTION_URL"]?.replace(/\/install\/?$/, "");
  const answer = await readAccountsMode(fetchImpl, override || `${config.supabaseUrl}/functions/v1`, config.publishableKey);
  cached = { key, until: Date.now() + (answer === null ? FAILED_TTL_MS : TTL_MS), accounts: answer === true };
  return cached.accounts;
}

/** Forget the remembered answer (tests). */
export function forgetAccountsMode() { cached = null; }
