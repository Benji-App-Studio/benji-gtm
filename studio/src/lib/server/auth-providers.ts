import "server-only";
// Which ways to sign in this install's Supabase project offers, read from Auth's public settings with
// the publishable key (public by design). Nothing to switch on by hand: once the owner turns Google on in
// the Supabase dashboard, "Continue with Google" appears within a few minutes.
import { DEFAULT_PROVIDERS, parseAuthProviders, type AuthProviders } from "@/lib/auth/flows";
import { getInstallConfig } from "@/lib/install/config";
import { parseGoogleClientId } from "@/lib/auth/google-id";

/** A good answer is kept for 5 minutes; a failed read is tried again after 30 seconds. */
const FRESH_MS = 5 * 60_000;
const RETRY_MS = 30_000;
const TIMEOUT_MS = 2_500;

const cache = new Map<string, { at: number; ttl: number; value: AuthProviders }>();

export async function authProviders(): Promise<AuthProviders> {
  const config = getInstallConfig();
  if (!config) return DEFAULT_PROVIDERS;
  const key = config.supabaseUrl;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: config.publishableKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`settings ${response.status}`);
    const value = parseAuthProviders(await response.json());
    cache.set(key, { at: Date.now(), ttl: FRESH_MS, value });
    return value;
  } catch {
    // Keep the last good answer through a blip; otherwise email only.
    const value = hit?.value ?? DEFAULT_PROVIDERS;
    cache.set(key, { at: Date.now(), ttl: RETRY_MS, value });
    return value;
  }
}

/**
 * The Google Web client ID for Google's own sign-in button (lib/auth/google-id.ts), from GOOGLE_CLIENT_ID
 * on the deployment; read by name at run time. Null: the button uses Supabase's redirect flow.
 */
export const googleClientId = (): string | null => parseGoogleClientId(process.env["GOOGLE_CLIENT_ID"]);
