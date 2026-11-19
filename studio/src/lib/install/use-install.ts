"use client";
// What the browser knows about this install (GET /api/install): the caller's role, which keys are set
// and the settings. Shared through the client cache, so every screen that asks gets the same answer and
// one request. Every caller must cope with `install` being null: the request can fail (signed out, the
// project unreachable, an install that is not set up yet), and then `error` says why.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { refresh as refreshCached, useCached } from "@/lib/client-cache";
import type { InstallRole, InstallState } from "./types";

export const INSTALL_URL = "/api/install";
const UNREACHABLE = "The server didn't answer. Check your connection and try again.";

const isInstall = (value: unknown): value is InstallState =>
  Boolean(value && typeof value === "object" && "role" in value && "keys" in value && typeof (value as InstallState).keys === "object");

export interface UseInstall {
  /** null while loading, and when the request failed. */
  install: InstallState | null;
  loading: boolean;
  /** Why there is no install to show, in plain words. null while loading or once it has loaded. */
  error: string | null;
  /** Asks again (after saving a key or a setting). Never throws. */
  refresh: () => Promise<InstallState | null>;
}

const never = () => () => {};

/**
 * False on the server and while the server's HTML is being hydrated, true from then on (and at once on a
 * page opened by a link inside the app). The client cache is empty on the server, so a page that
 * hydrates after another part of the app has already filled it must still start from "loading", as the
 * server's HTML did; it shows the cached answer straight after.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(never, () => true, () => false);
}

export function useInstall(): UseInstall {
  const [cached] = useCached<InstallState | { error?: string }>(INSTALL_URL);
  const value = useHydrated() ? cached : undefined;
  // The cache only keeps answers that parsed; a request that failed outright is noted here.
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await refreshCached<unknown>(INSTALL_URL);
      setFailed(false);
      return isInstall(next) ? next : null;
    } catch {
      setFailed(true);
      return null;
    }
  }, []);

  // useCached has already started this request; asking again here shares it and tells us if it failed.
  useEffect(() => {
    let live = true;
    refreshCached<unknown>(INSTALL_URL).then(() => { if (live) setFailed(false); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  const install = isInstall(value) ? value : null;
  const refused = value && !install ? ((value as { error?: string }).error || UNREACHABLE) : null;
  const error = install ? null : refused ?? (failed ? UNREACHABLE : null);
  return { install, loading: !install && !error, error, refresh };
}

/** "Owner" or "Member"; nothing for an install from before owners existed, or while it loads. */
export const roleLabel = (role: InstallRole | undefined | null): string | null =>
  role === "owner" ? "Owner" : role === "member" ? "Member" : null;

/** Whether the caller may change install-wide settings (keys, models, members, the name). */
export const canManage = (install: InstallState | null | undefined): boolean => Boolean(install?.owned && install.role === "owner");
