// How full this install's storage is, and the checks every place that writes files makes first.
// Twin of the levels and messages in studio/src/lib/storage-usage.ts (scripts/creative-runner/tests/
// storage-usage.test.ts keeps them equal). The database part reads `research_storage_used()` (all
// buckets: the plan's quota is shared by all of them); everything else is pure.
import { storageQuotaBytes, type InstallLimits } from "./limits.ts";

/** 80%: a quiet notice. 95%: a warning before anything adds files. 100%: those actions are refused. */
export const THRESHOLDS = { notice: 0.8, warn: 0.95, full: 1 } as const;
export type StorageLevel = "ok" | "notice" | "warn" | "full";

export function storageLevel(usedBytes: number, quotaBytes: number): StorageLevel {
  if (!(quotaBytes > 0)) return "ok";
  const r = usedBytes / quotaBytes;
  return r >= THRESHOLDS.full ? "full" : r >= THRESHOLDS.warn ? "warn" : r >= THRESHOLDS.notice ? "notice" : "ok";
}

/** The note a job or a file gets when storage has no room: the same words wherever it is refused. */
export const STORAGE_FULL_NOTE = "Storage is full: nothing new can be saved. Free up space in Settings > Storage (or upgrade your Supabase plan), then retry.";

const mb = (bytes: number) => { const v = bytes / (1024 * 1024); return Number.isInteger(v) ? String(v) : v.toFixed(1); };

/** A finished result bigger than the plan's upload limit: said once, with the provider's link kept so it can still be fetched. */
export const resultTooBigNote = (bytes: number | null, limitBytes: number, provider = "Higgsfield") =>
  `The finished file is larger than your Supabase plan allows (${bytes ? `${mb(bytes)} MB; ` : ""}up to ${mb(limitBytes)} MB). Download it from ${provider} or upgrade the plan.`;

export interface Room { usedBytes: number; quotaBytes: number; roomBytes: number; level: StorageLevel }

type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

/** Bytes stored across every bucket against the plan's quota. A database that can't say reads as "room" (never fail-closed). */
export async function storageRoom(db: RpcClient, limits: Pick<InstallLimits, "storageQuotaGb">): Promise<Room> {
  const quota = storageQuotaBytes(limits);
  const { data, error } = await db.rpc("research_storage_used");
  const used = error ? 0 : Number(data) || 0;
  return { usedBytes: used, quotaBytes: quota, roomBytes: Math.max(0, quota - used), level: storageLevel(used, quota) };
}

/** Whether `bytes` more fit (and the store isn't full already). */
export const fits = (room: Room, bytes = 0) => room.level !== "full" && room.usedBytes + Math.max(0, bytes) <= room.quotaBytes;

/** Storage's own refusal of an upload, in plain words with what to do. */
export function storageErrorText(message: string, limitBytes?: number): string {
  const e = message.toLowerCase();
  if (/413|payload too large|maximum allowed size|exceeded the maximum|entity too large/.test(e)) return `The file is bigger than your Supabase plan allows${limitBytes ? ` (${mb(limitBytes)} MB)` : ""}. Make it smaller, or raise the limit on a paid plan.`;
  if (/quota|storage limit|no space|insufficient storage|507/.test(e)) return STORAGE_FULL_NOTE;
  if (/network|fetch|timed? ?out|abort|connection/.test(e)) return "The file didn't reach Supabase storage (network trouble). Retry in a moment.";
  return `Storage refused the file: ${message.slice(0, 200)}`;
}
