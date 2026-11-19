"use client";
// How full storage is, in the browser: GET /api/storage, kept for a minute and shared by every component
// that asks (the sidebar card, Settings > Storage, the warnings before collecting, generating or uploading).
// Can't be measured (an older backend, no network): `summary` stays null and nothing is blocked.
import { useCallback, useEffect, useState } from "react";
import type { StorageSummary } from "./storage-usage";

const TTL_MS = 60_000;
let cached: { at: number; summary: StorageSummary | null; error: string | null } | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

async function load(fresh = false) {
  if (!fresh && cached && Date.now() - cached.at < TTL_MS) return;
  if (pending && !fresh) return pending;
  pending = fetch(`/api/storage${fresh ? "?fresh=1" : ""}`, { cache: "no-store" })
    .then(async (r) => {
      const data = await r.json().catch(() => null) as (StorageSummary & { error?: string }) | null;
      cached = { at: Date.now(), summary: r.ok && data && typeof data.usedBytes === "number" ? data : null, error: r.ok ? null : data?.error ?? "Couldn't measure storage just now." };
    })
    .catch(() => { cached = { at: Date.now(), summary: null, error: "Couldn't measure storage just now." }; })
    .finally(() => { pending = null; listeners.forEach((l) => l()); });
  return pending;
}

/** Measure again everywhere (after a cleanup, an upload or a generation). */
export const refreshStorage = () => load(true);

export function useStorage(): { summary: StorageSummary | null; error: string | null; loading: boolean; refresh: () => Promise<void> } {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    void load();
    return () => { listeners.delete(listener); };
  }, []);
  const refresh = useCallback(() => load(true), []);
  return { summary: cached?.summary ?? null, error: cached?.error ?? null, loading: !cached, refresh };
}
