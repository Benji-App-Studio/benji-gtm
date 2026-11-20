"use client";
// A per-account "closed" flag (lib/ui-state.ts) in the browser: the account's stored state
// (/api/account/ui-state), with localStorage as a copy for the first paint and for an install whose
// database doesn't have the column yet. Closing writes both.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useAccountId } from "./account-id";
import { prime, useCached } from "./client-cache";
import { storageKey } from "./storage-keys";
import type { UiState } from "./ui-state";

export const UI_STATE_URL = "/api/account/ui-state";
const EVENT = "gtm-ui-state";

const subscribe = (notify: () => void) => {
  window.addEventListener("storage", notify);
  window.addEventListener(EVENT, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(EVENT, notify); };
};
const readLocal = (name: string): string | null => {
  try { return localStorage.getItem(name); } catch { return null; }
};

/**
 * Whether `key` is "closed" for this account: null while it can't be told yet (show nothing then, so a
 * closed card never flashes), and `close()` to close it for good.
 */
export function useClosedFlag(key: string): { closed: boolean | null; close: () => void; reopen: () => void } {
  const account = useAccountId();
  const [stored] = useCached<{ state?: UiState }>(UI_STATE_URL);
  const local = storageKey(`ui.${account || "me"}.${key}`);
  const cached = useSyncExternalStore(subscribe, () => (account === undefined ? null : readLocal(local)), () => null);
  const server = stored?.state?.[key];
  // The latest stored state for the callbacks, so they keep one identity (callers run them from effects).
  const latest = useRef(stored);
  useEffect(() => { latest.current = stored; }, [stored]);
  const closed = account === undefined ? null : cached === "closed" || server === "closed" ? true : stored === undefined ? null : false;
  const close = useCallback(() => {
    try { localStorage.setItem(local, "closed"); } catch { /* private window: the account's copy still has it */ }
    window.dispatchEvent(new Event(EVENT));
    const now = latest.current;
    if (now?.state) prime(UI_STATE_URL, { ...now, state: { ...now.state, [key]: "closed" } });
    void fetch(UI_STATE_URL, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value: "closed" }) }).catch(() => null);
  }, [local, key]);
  /** Opens it again (Help > Get started): both copies forget "closed". */
  const reopen = useCallback(() => {
    try { localStorage.removeItem(local); } catch { /* nothing kept */ }
    window.dispatchEvent(new Event(EVENT));
    const now = latest.current;
    if (now?.state && key in now.state) {
      const state = { ...now.state };
      delete state[key];
      prime(UI_STATE_URL, { ...now, state });
    }
    void fetch(UI_STATE_URL, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value: null }) }).catch(() => null);
  }, [local, key]);
  return { closed, close, reopen };
}
