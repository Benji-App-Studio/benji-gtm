// The language saved on a person's profile (profiles.locale, Settings › Language) following them to
// another browser. Pages render from the locale cookie (lib/i18n/server.ts); when a signed-in request
// to the app has no such cookie, the proxy reads the profile once and sets the cookie from it. When the
// profile has none, a session cookie says "already checked", so the profile is read at most once per
// browser session, and never while the locale cookie exists. Plain TypeScript, tested in
// saved-locale.test.ts.
import { STORAGE_PREFIX } from "../brand-config";
import { LOCALE_COOKIE } from "../storage-keys";
import { isLocale, type Locale } from "./locales";

/** Set (for the browser session) once the profile was read and had no language to apply. */
export const LOCALE_CHECKED_COOKIE = `${STORAGE_PREFIX}-locale-checked`;

/** Where the profile's language is worth looking up: the signed-in app and onboarding pages. */
const APP_PATH = /^\/(app|onboarding)(\/|$)/;

/** Whether this request should read profiles.locale: signed in, in the app, and neither cookie set. */
export function needsSavedLocale(input: { signedIn: boolean; path: string; cookies: { has(name: string): boolean } }): boolean {
  return input.signedIn && APP_PATH.test(input.path) && !input.cookies.has(LOCALE_COOKIE) && !input.cookies.has(LOCALE_CHECKED_COOKIE);
}

export interface CookieToSet { name: string; value: string; options: { path: string; sameSite: "lax"; maxAge?: number } }

/**
 * The cookies to set after reading the profile: its language for a year (the same cookie the language
 * menu sets), or, when there is none (or the column isn't there yet), the session-long "checked" marker.
 */
export function savedLocaleCookies(saved: unknown): { locale: Locale | null; cookies: CookieToSet[] } {
  if (isLocale(saved)) return { locale: saved, cookies: [{ name: LOCALE_COOKIE, value: saved, options: { path: "/", sameSite: "lax", maxAge: 31536000 } }] };
  return { locale: null, cookies: [{ name: LOCALE_CHECKED_COOKIE, value: "1", options: { path: "/", sameSite: "lax" } }] };
}

/**
 * The language to write to the account's user metadata (`locale`), which Supabase's sign-in email
 * templates read (release/docs/email-templates), or null when nothing should change. The language saved
 * in Settings (profiles.locale, `saved`) wins; without one, the page's language fills in metadata that has
 * none (a Google sign-up, an account from before). A language already in the metadata is never replaced
 * by the browser's: a sign-in from another browser mustn't undo the person's choice.
 */
export function metadataLocaleUpdate(metadata: unknown, page: Locale, saved?: unknown): Locale | null {
  const current = metadata && typeof metadata === "object" ? (metadata as { locale?: unknown }).locale : undefined;
  if (isLocale(saved)) return current === saved ? null : saved;
  return isLocale(current) ? null : page;
}

/** A language from a request body (PUT /api/account/locale); null when it isn't one the app speaks. */
export function localeFromBody(body: unknown): Locale | null {
  const value = body && typeof body === "object" ? (body as { locale?: unknown }).locale : undefined;
  return isLocale(value) ? value : null;
}
