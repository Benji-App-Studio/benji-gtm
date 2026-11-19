import "server-only";
// How full storage is, for API routes: the install function's `storage` answer (storage_usage() rows,
// the apps and the plan's numbers), summed by lib/storage-usage.ts and kept for a minute so the sidebar
// and every page load can ask without measuring the store each time. The checks every route that adds
// files makes before it starts (collect, generate, upload) are here too.
import { fileTooBig, guardFor, summarise, type AddAction, type StorageSummary, type UsageRow } from "@/lib/storage-usage";
import type { Session } from "./auth";
import { callFunction } from "./functions";

const TTL_MS = 60_000;
let cache: { at: number; summary: StorageSummary } | null = null;

interface UsageAnswer { rows: UsageRow[]; apps: { id: string; name: string }[]; quotaBytes: number; uploadLimitBytes: number }

/** The summary, from the cache when it's under a minute old. `{ error }` when it can't be measured (nothing is blocked then). */
export async function storageSummary(session: Session, o: { fresh?: boolean } = {}): Promise<{ summary: StorageSummary } | { error: string; status: number }> {
  if (!o.fresh && cache && Date.now() - cache.at < TTL_MS) return { summary: cache.summary };
  const result = await callFunction<UsageAnswer>("install", session, "storage", {
    timeoutMs: 15_000,
    messages: { unreachable: "Couldn't measure storage just now. Try again in a moment.", notDeployed: "Storage can't be measured yet: update the backend (Settings > Updates)." },
  });
  // A backend from before storage measuring answers 404 "Not found": say what to do instead of that.
  if (result.status === 404) return { error: "Storage can't be measured yet: your backend needs the latest update (Settings > Updates explains how).", status: 503 };
  if (!result.ok || !Array.isArray(result.data.rows)) return { error: result.data.error ?? "Couldn't measure storage just now.", status: result.status || 502 };
  const summary = summarise(result.data.rows, { quotaBytes: Number(result.data.quotaBytes) || 0, uploadLimitBytes: Number(result.data.uploadLimitBytes) || 0, apps: result.data.apps ?? [] });
  cache = { at: Date.now(), summary };
  return { summary };
}

/** Forget the cached numbers (after a cleanup or a big save), so the next read measures again. */
export const forgetStorage = () => { cache = null; };

/**
 * The response to send instead of running an action that adds files: storage full (507), or a file over
 * the plan's per-file limit (413). Null when it may run, and also when storage can't be measured
 * (never fail closed: Supabase still refuses what doesn't fit, and that answer is turned into plain words).
 */
export async function refuseWhenFull(session: Session, action: AddAction, o: { bytes?: number; fileBytes?: number } = {}): Promise<Response | null> {
  const read = await storageSummary(session);
  if ("error" in read) return null;
  const { summary } = read;
  if (o.fileBytes !== undefined) {
    const big = fileTooBig(o.fileBytes, summary.uploadLimitBytes);
    if (big) return Response.json({ error: big, storage: { reason: "file_too_big", limitBytes: summary.uploadLimitBytes } }, { status: 413 });
  }
  const guard = guardFor(action, summary, o.bytes ?? o.fileBytes ?? 0);
  return guard.block ? Response.json({ error: guard.message, storage: { reason: "full", usedBytes: summary.usedBytes, quotaBytes: summary.quotaBytes } }, { status: 507 }) : null;
}
