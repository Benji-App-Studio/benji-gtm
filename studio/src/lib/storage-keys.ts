// Every name the app keeps something under in the browser (cookies, localStorage, sessionStorage,
// IndexedDB), built from STORAGE_PREFIX so none of them carries a product name.
//
// The same values used to live under an earlier prefix. An install that was already in use keeps its
// theme, its last-opened app and its dismissed tips: each read below looks under the new name first,
// then once under the earlier one, and moves what it finds. Only the new names are ever written.
// Plain TypeScript with no imports from the browser or Next.js (the server, the browser and the Node
// tests share it; tested in scripts/creative-runner/tests/storage-keys.test.ts).
import { STORAGE_PREFIX } from "./brand-config";

/** The prefix these names had before. Read as a fallback, never written. */
export const LEGACY_PREFIX = "radar";

/** A localStorage or sessionStorage key: storageKey("tip.intro") is "<prefix>.tip.intro". */
export const storageKey = (name: string) => `${STORAGE_PREFIX}.${name}`;

/** Light, dark or system: a cookie (the server renders with it) and a localStorage backup. */
export const THEME_KEY = `${STORAGE_PREFIX}-theme`;
/** Cookie: the app last opened, so sign-in and the sidebar come back to it. */
export const WORKSPACE_COOKIE = storageKey("workspace");
/** sessionStorage: Research's Recreate sheet handing a brief to the Studio. */
export const RECREATE_HANDOFF_KEY = storageKey("recreate");
/** sessionStorage: "More like our winners" handing a brief to the Studio. */
export const WINNERS_HANDOFF_KEY = storageKey("winners");
/** IndexedDB database: big lists kept for instant reloads (lib/client-cache.ts). Only a cache, so the earlier one is deleted, not read. */
export const CACHE_DB = `${STORAGE_PREFIX}-cache`;

/** The name a key had under the earlier prefix ("<prefix>.workspace" → "radar.workspace"), or null for a key that never had one. */
export function legacyKey(key: string): string | null {
  return key.startsWith(STORAGE_PREFIX) && /^[.-]/.test(key.slice(STORAGE_PREFIX.length)) ? LEGACY_PREFIX + key.slice(STORAGE_PREFIX.length) : null;
}

// MARK: localStorage and sessionStorage

/**
 * The value kept under `key`. When there is none but the earlier name has one, that value is moved to
 * `key` (so the earlier name is read once) and returned. Throws what the storage throws (a private
 * window, a blocked store): callers already treat that as "nothing kept".
 */
export function readStored(store: Pick<Storage, "getItem" | "setItem" | "removeItem">, key: string): string | null {
  const value = store.getItem(key);
  if (value !== null) return value;
  const old = legacyKey(key);
  if (!old) return null;
  const earlier = store.getItem(old);
  if (earlier === null) return null;
  store.setItem(key, earlier);
  store.removeItem(old);
  return earlier;
}

// MARK: Cookies

const COOKIE_ATTRIBUTES = "path=/; max-age=31536000; samesite=lax";

/** A cookie's value from the request's cookies (`await cookies()` in Next.js), under `key` or else its earlier name. */
export function readCookie(store: { get(name: string): { value: string } | undefined }, key: string): string | undefined {
  const old = legacyKey(key);
  return store.get(key)?.value ?? (old ? store.get(old)?.value : undefined);
}

/** The same from a `document.cookie` string; null when neither name is set. */
export function readCookieString(cookies: string, key: string): string | null {
  const find = (name: string) => cookies.split("; ").find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
  const old = legacyKey(key);
  return find(key) ?? (old ? find(old) : null);
}

/** What to assign to `document.cookie`, in order, to keep `value` for a year under `key` and drop the earlier name. */
export function cookieWrites(key: string, value: string): string[] {
  const old = legacyKey(key);
  return [`${key}=${value}; ${COOKIE_ATTRIBUTES}`, ...(old ? [`${old}=; path=/; max-age=0; samesite=lax`] : [])];
}

/** Browser only: keeps `value` in the cookie `key` for a year and removes the cookie's earlier name. */
export function writeCookie(key: string, value: string) {
  for (const cookie of cookieWrites(key, value)) document.cookie = cookie;
}
