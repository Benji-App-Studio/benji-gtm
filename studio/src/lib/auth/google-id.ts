// Google's own sign-in button (Google Identity Services). Google's window then opens on this site, so it
// names this site ("to continue to benji-gtm.vercel.app") instead of the Supabase project's address, as
// the redirect flow does. Google hands back an ID token; Supabase checks it (signInWithIdToken) and the
// browser goes through /auth/finish, which does what /auth/confirm does after a sign-in.
//
// Needs GOOGLE_CLIENT_ID (the Web client's ID, public by design) on the deployment, this site's origin in
// the client's "Authorized JavaScript origins", and the same ID in Supabase › Google › Client IDs.
// Without GOOGLE_CLIENT_ID, or when Google's script can't load, the button falls back to the redirect flow.
//
// Pure (no React, no Next.js), so the tests can cover it.
import type { Locale } from "@/lib/i18n/locales";
import { sanitizeNext } from "./flows";

export const GSI_SCRIPT = "https://accounts.google.com/gsi/client";

/** Where the browser goes once Supabase accepted Google's token. */
export const GOOGLE_FINISH_PATH = "/auth/finish";

/** The client ID as configured, or null when it is missing or doesn't look like a Google Web client ID. */
export function parseGoogleClientId(value: string | null | undefined): string | null {
  const id = value?.trim();
  return id && /^[\w-]+\.apps\.googleusercontent\.com$/.test(id) ? id : null;
}

/** `/auth/finish?next=…`: `next` only when it is a path inside this app. */
export function googleFinishUrl(next: string | null | undefined): string {
  const safe = sanitizeNext(next);
  return safe ? `${GOOGLE_FINISH_PATH}?next=${encodeURIComponent(safe)}` : GOOGLE_FINISH_PATH;
}

/** The language of Google's button (its `locale` option uses an underscore). */
export const GSI_LOCALE: Record<Locale, string> = { en: "en", "zh-TW": "zh_TW", ja: "ja", ko: "ko" };

/** Google's button colours: dark pages get the filled black button, light pages the outlined one. */
export function gsiTheme(theme: string | null | undefined, prefersDark: boolean): "filled_black" | "outline" {
  if (theme === "dark") return "filled_black";
  if (theme === "system" || !theme) return prefersDark ? "filled_black" : "outline";
  return "outline";
}

/** Google's button accepts widths from 200 to 400 pixels. */
export const gsiWidth = (available: number): number => Math.round(Math.min(400, Math.max(200, available || 320)));

/**
 * A fresh nonce for one sign-in: the raw value goes to Supabase, its SHA-256 (hex) to Google, which puts
 * it in the token. Supabase hashes the raw value and checks they match, so a token can't be replayed.
 */
export async function googleNonce(crypto: Crypto = globalThis.crypto): Promise<{ raw: string; hashed: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return { raw, hashed };
}
