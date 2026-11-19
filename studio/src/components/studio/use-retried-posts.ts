"use client";
// The loop behind useComposedAds and useLogoOverlays: POST once to `urlFor(id)` for every pending
// creative, one at a time; a failure is tried again after RETRY_AFTER_MS, at most RETRIES times. After
// the last try the error is returned per creative (`failed`), for its card, until `retry(id)` starts over.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const RETRIES = 3;
const RETRY_AFTER_MS = 30_000;

const never = () => false;

/** `urlFor` and `settled` should be stable (module-level) functions: they're effect dependencies. */
export function useRetriedPosts(pendingIds: string[], urlFor: (id: string) => string, what: string, onDone?: () => void, settled: (status: number) => boolean = never) {
  const tries = useRef(new Map<string, { count: number; at: number }>());
  const busy = useRef(false);
  // Bumped to look again: after a pass, and when a failed one may be retried.
  const [nonce, setNonce] = useState(0);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const pending = pendingIds.join(",");
  useEffect(() => {
    if (!pending || busy.current) return;
    const ids = pending.split(",");
    const due = ids.filter((id) => {
      const t = tries.current.get(id);
      return !t || (t.count < RETRIES && Date.now() - t.at > RETRY_AFTER_MS);
    });
    if (!due.length) {
      if (!ids.some((id) => (tries.current.get(id)?.count ?? 0) < RETRIES)) return;
      const timer = setTimeout(() => setNonce((n) => n + 1), RETRY_AFTER_MS);
      return () => clearTimeout(timer);
    }
    busy.current = true;
    (async () => {
      let done = 0;
      const errors: Record<string, string> = {};
      for (const id of due) {
        const count = (tries.current.get(id)?.count ?? 0) + 1;
        tries.current.set(id, { count, at: Date.now() });
        const response = await fetch(urlFor(id), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
        if (response?.ok || (response && settled(response.status))) { done++; continue; }
        const data = await response?.json().catch(() => null) as { error?: string } | null;
        console.warn(what, id, data);
        if (count >= RETRIES) errors[id] = `${what}: ${data?.error ?? (response ? `the server answered ${response.status}` : "the server couldn't be reached")}`;
      }
      busy.current = false;
      if (Object.keys(errors).length) setFailed((f) => ({ ...f, ...errors }));
      if (done) onDone?.();
      setNonce((n) => n + 1);
    })();
  }, [pending, urlFor, what, onDone, settled, nonce]);

  const retry = useCallback((id: string) => {
    tries.current.delete(id);
    setFailed((f) => {
      const next = { ...f };
      delete next[id];
      return next;
    });
    setNonce((n) => n + 1);
  }, []);
  // Only creatives still waiting: one that got there another way drops its error.
  const shown = useMemo(() => {
    const waiting = new Set(pending.split(","));
    return Object.fromEntries(Object.entries(failed).filter(([id]) => waiting.has(id)));
  }, [failed, pending]);
  return { failed: shown, retry };
}
