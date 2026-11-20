"use client";
// A small stale-while-revalidate cache for the signed-in app's lists: pages show what they had at
// once when you switch to them, then refresh in the background.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { CACHE_DB, legacyKey } from "./storage-keys";

const store = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Map<string, Set<(value: unknown) => void>>();
/** When each URL's value last arrived (Date.now()), and the HTTP status it came with. */
const fetchedAt = new Map<string, number>();
const statuses = new Map<string, number>();

/** Asks again now (one request per URL at a time: a second caller shares the first's). */
export async function refresh<T>(url: string): Promise<T> {
  if (!inflight.has(url)) {
    inflight.set(url, fetch(url, { cache: "no-store" }).then((r) => {
      statuses.set(url, r.status);
      return r.json();
    }).then((value) => {
      store.set(url, value);
      fetchedAt.set(url, Date.now());
      listeners.get(url)?.forEach((notify) => notify(value));
      return value;
    }).finally(() => inflight.delete(url)));
  }
  return inflight.get(url) as Promise<T>;
}

/** Whether a URL's cached value is younger than `maxAgeMs` (a value set with prime() counts from then). */
export const isFresh = (url: string, maxAgeMs: number) => store.has(url) && Date.now() - (fetchedAt.get(url) ?? 0) < maxAgeMs;

/**
 * Asks again only when the cached value is older than `maxAgeMs` (or missing); otherwise answers with
 * what is cached, without a request. A request already on its way is shared.
 */
export function revalidate<T>(url: string, maxAgeMs: number): Promise<T> {
  if (inflight.has(url) || !isFresh(url, maxAgeMs)) return refresh<T>(url);
  return Promise.resolve(store.get(url) as T);
}

/** The HTTP status of the last answer for a URL (401: signed out), undefined before one arrived. */
export const lastStatus = (url: string) => statuses.get(url);

/** Starts loading a list before its page opens (e.g. when a link is hovered). */
export const preload = (url: string) => { if (!store.has(url)) refresh(url).catch(() => {}); };


/**
 * Lists that every page of an app asks for but that change only when someone edits them (and the screen
 * that edits them refreshes them): fresh for this long by default, so moving between pages doesn't ask
 * again. Everything else is asked for again on every mount.
 */
const DEFAULT_MAX_AGE: Record<string, number> = { "/api/products": 30_000, "/api/install": 60_000 };

export interface CacheOptions {
  /**
   * How long an answer stays fresh: a page that opens within this time shows it without asking again.
   * 0 (the default) asks on every mount, showing the cached value meanwhile.
   */
  maxAgeMs?: number;
}

/**
 * The cached value at once (or undefined the first time), kept fresh. While the server's HTML is being
 * hydrated it is undefined, as it was on the server: parts of a page hydrate at different times, and a
 * value another part fetched meanwhile would otherwise make the two disagree (a hydration error).
 */
export function useCached<T>(url: string, options: CacheOptions = {}): [T | undefined, () => Promise<T>] {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE[url] ?? 0;
  // The store itself is the state: every hook on a URL sees a new answer at once, whoever asked for it.
  // While hydrating, React reads the server's snapshot (undefined), then the cached value.
  const subscribe = useCallback((notify: () => void) => {
    const set = listeners.get(url) ?? new Set();
    const listener = () => notify();
    set.add(listener);
    listeners.set(url, set);
    return () => { set.delete(listener); };
  }, [url]);
  const value = useSyncExternalStore(subscribe, () => store.get(url) as T | undefined, () => undefined);
  useEffect(() => { revalidate<T>(url, maxAgeMs).catch(() => {}); }, [url, maxAgeMs]);
  return [value, useCallback(() => refresh<T>(url), [url])];
}

/** Stores a value a page put together itself (e.g. a list loaded in slices), for the next visit. */
export function prime<T>(url: string, value: T) {
  store.set(url, value);
  fetchedAt.set(url, Date.now());
  listeners.get(url)?.forEach((notify) => notify(value));
}

/** What's cached for a URL right now, without fetching. */
export const peek = <T,>(url: string) => store.get(url) as T | undefined;

/** Warms everything a project page needs (its details, activity and latest report) before it opens. */
export function preloadProject(id: string) {
  const url = `/api/projects/${id}`;
  const details = store.has(url) ? Promise.resolve(store.get(url)) : refresh(url).catch(() => null);
  preload(`${url}/log`);
  details.then((data) => {
    const run = (data as { runs?: { id: string; status: string }[] } | null)?.runs?.find((r) => r.status === "done");
    if (run) preload(`/api/runs/${run.id}`);
  });
}

// MARK: Kept across reloads

/**
 * Big lists (the research ads, ~25 MB) kept in the browser's IndexedDB, so a reload shows the last list at
 * once while the fresh one loads. Values older than `maxAgeMs` are ignored; any IndexedDB failure (private
 * window, quota) just means no instant list.
 */
const DB_NAME = CACHE_DB, STORE = "lists";
let droppedEarlier = false;
function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  // The cache had another name before. It is only a cache, so the earlier one is deleted (once per page load), not read.
  const earlier = legacyKey(DB_NAME);
  if (earlier && !droppedEarlier) { droppedEarlier = true; try { indexedDB.deleteDatabase(earlier); } catch { /* nothing to free */ } }
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function loadPersisted<T>(key: string, maxAgeMs = 3 * 86_400_000): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => {
      const hit = req.result as { at: number; value: T } | undefined;
      resolve(hit && Date.now() - hit.at < maxAgeMs ? hit.value : undefined);
    };
    req.onerror = () => resolve(undefined);
  });
}

export async function savePersisted<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ at: Date.now(), value }, key);
    tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve();
  });
}

/** Forgets every kept list (e.g. on sign-out). */
export async function clearPersisted(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve();
  });
}
