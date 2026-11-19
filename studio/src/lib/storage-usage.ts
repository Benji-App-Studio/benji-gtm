// How full storage is, and what that means for the actions that add files. Pure TypeScript with no
// imports, shared by the studio (Settings > Storage, the sidebar card, the warnings before collecting,
// saving, generating or uploading), its API routes and the Node tests. The edge functions keep a twin of
// the levels and messages in supabase/functions/_shared/storage.ts (a Node test keeps them equal).
//
// Where files live (docs/SELF-HOSTING-DESIGN.md "Storage layout"): one folder per app in every bucket,
// so each app can be measured and cleared on its own.
//   creatives   <app>/<YYYY-MM-DD>/<job>/<file>              generated creatives (Studio, Playground, posts)
//   ad-media    <app>/<page>/<hash>.<ext>                     competitors' saved ad images and videos
//               <app>/scan-frames/<ad>/<n>.<ext>               key frames read from their videos
//   workspace   <user>/<app>/assets|brand|fonts|playground/…  uploads and brand files
//   thumbs      <user>/<run>/…                                 analysis thumbnails (not per app)
//   app-assets  style-library/…                                the Style Library images setup copies in

export type StorageKind = "competitor_media" | "creatives" | "uploads" | "other";
export const KIND_LABEL: Record<StorageKind, string> = {
  competitor_media: "Competitors' ad media",
  creatives: "Generated creatives",
  uploads: "Uploads and brand files",
  other: "Other files",
};

export const BUCKET_KIND: Record<string, StorageKind> = {
  "ad-media": "competitor_media",
  creatives: "creatives",
  workspace: "uploads",
  thumbs: "other",
  "app-assets": "other",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Which app a stored file belongs to (null: not an app's file), and what kind of file it is. Twin of storage_usage() in SQL. */
export function classifyPath(bucket: string, name: string): { app: string | null; kind: StorageKind } {
  const parts = name.split("/");
  const kind = BUCKET_KIND[bucket] ?? "other";
  const at = bucket === "workspace" ? 1 : bucket === "creatives" || bucket === "ad-media" ? 0 : -1;
  const app = at >= 0 && UUID.test(parts[at] ?? "") && parts.length > at + 1 ? parts[at].toLowerCase() : null;
  return { app, kind };
}

/** One row of the storage_usage() RPC: a bucket's files of one app (app null: files of no app). */
export interface UsageRow { bucket: string; app_id: string | null; files: number; bytes: number }

export interface AppUsage { appId: string; name: string; bytes: number; files: number; byKind: Partial<Record<StorageKind, number>> }

export interface StorageSummary {
  usedBytes: number;
  quotaBytes: number;
  /** The plan's largest single file, in bytes. */
  uploadLimitBytes: number;
  level: StorageLevel;
  /** used / quota, 0 to 1 (can pass 1 when the plan was exceeded). */
  ratio: number;
  byKind: Record<StorageKind, number>;
  apps: AppUsage[];
  /** Files of apps that no longer exist (deleted before files were removed with them). */
  orphanBytes: number;
  orphans: { appId: string; bytes: number; files: number }[];
  checkedAt: string;
}

/** 80%: a quiet notice. 95%: a clear warning before anything adds files. 100%: those actions are refused. */
export const THRESHOLDS = { notice: 0.8, warn: 0.95, full: 1 } as const;
export type StorageLevel = "ok" | "notice" | "warn" | "full";

export function storageLevel(usedBytes: number, quotaBytes: number): StorageLevel {
  if (!(quotaBytes > 0)) return "ok";
  const r = usedBytes / quotaBytes;
  return r >= THRESHOLDS.full ? "full" : r >= THRESHOLDS.warn ? "warn" : r >= THRESHOLDS.notice ? "notice" : "ok";
}

/** Whether adding `bytes` more would pass the quota (the files that are there plus the new ones). */
export const wouldOverflow = (usedBytes: number, quotaBytes: number, bytes: number) => quotaBytes > 0 && usedBytes + Math.max(0, bytes) > quotaBytes;

/** The rows from storage_usage() summed by kind and by app, with the plan's numbers. */
export function summarise(rows: UsageRow[], o: { quotaBytes: number; uploadLimitBytes: number; apps: { id: string; name: string }[]; now?: Date }): StorageSummary {
  const byKind: Record<StorageKind, number> = { competitor_media: 0, creatives: 0, uploads: 0, other: 0 };
  const apps = new Map<string, AppUsage>();
  const known = new Map(o.apps.map((a) => [a.id.toLowerCase(), a.name]));
  let used = 0, orphan = 0;
  const orphans = new Map<string, { appId: string; bytes: number; files: number }>();
  for (const row of rows) {
    const bytes = Math.max(0, Number(row.bytes) || 0);
    const files = Math.max(0, Number(row.files) || 0);
    const kind = BUCKET_KIND[row.bucket] ?? "other";
    used += bytes;
    byKind[kind] += bytes;
    const id = row.app_id?.toLowerCase() ?? null;
    if (!id) continue;
    if (!known.has(id)) {
      orphan += bytes;
      const o = orphans.get(id) ?? { appId: id, bytes: 0, files: 0 };
      o.bytes += bytes; o.files += files;
      orphans.set(id, o);
      continue;
    }
    const app = apps.get(id) ?? { appId: id, name: known.get(id)!, bytes: 0, files: 0, byKind: {} };
    app.bytes += bytes;
    app.files += files;
    app.byKind[kind] = (app.byKind[kind] ?? 0) + bytes;
    apps.set(id, app);
  }
  return {
    usedBytes: used, quotaBytes: o.quotaBytes, uploadLimitBytes: o.uploadLimitBytes,
    level: storageLevel(used, o.quotaBytes), ratio: o.quotaBytes > 0 ? used / o.quotaBytes : 0,
    byKind, apps: [...apps.values()].sort((a, b) => b.bytes - a.bytes), orphanBytes: orphan, orphans: [...orphans.values()],
    checkedAt: (o.now ?? new Date()).toISOString(),
  };
}

/** "12 KB", "3.4 MB", "1.2 GB" (decimal, as Supabase counts the plan's storage). */
export function formatBytes(bytes: number): string {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1000) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1000, i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1).replace(/\.0$/, "") : v.toFixed(2).replace(/0$/, "").replace(/\.0$/, "")} ${units[i]}`;
}

/** The plan's per-file limit as Supabase states it, in binary megabytes ("50 MB"). */
export const limitMb = (bytes: number) => { const v = bytes / (1024 * 1024); return `${Number.isInteger(v) ? v : v.toFixed(1)} MB`; };

/** "42%" (whole percent; "99%" until it is really full). */
export const percent = (ratio: number) => `${ratio >= 1 ? Math.round(ratio * 100) : Math.min(99, Math.floor(ratio * 100))}%`;

/** The actions that add files. */
export type AddAction = "collect" | "save_media" | "generate" | "upload";
const ACTION_TEXT: Record<AddAction, string> = {
  collect: "Collecting ads saves their images and videos",
  save_media: "Saving media adds files",
  generate: "Generating saves the new creatives",
  upload: "Uploading adds files",
};

export interface Guard {
  /** The action can't run: nothing is started and nothing half-saves. */
  block: boolean;
  /** Something to say before it runs (95% and up), or why it can't (100%). */
  message: string | null;
  level: StorageLevel;
}

/** What to say (or refuse) before an action that adds files. */
export function guardFor(action: AddAction, summary: Pick<StorageSummary, "usedBytes" | "quotaBytes"> | null | undefined, adding = 0): Guard {
  if (!summary) return { block: false, message: null, level: "ok" };
  const level = storageLevel(summary.usedBytes, summary.quotaBytes);
  const left = Math.max(0, summary.quotaBytes - summary.usedBytes);
  if (level === "full" || (adding > 0 && wouldOverflow(summary.usedBytes, summary.quotaBytes, adding))) {
    return { block: true, level: "full", message: `Storage is full (${formatBytes(summary.usedBytes)} of ${formatBytes(summary.quotaBytes)}). ${ACTION_TEXT[action]}, so it can't run until you free up space or upgrade your Supabase plan.` };
  }
  if (level === "warn") return { block: false, level, message: `Storage is almost full: ${formatBytes(left)} left of ${formatBytes(summary.quotaBytes)}. ${ACTION_TEXT[action]}; free up space first so nothing stops halfway.` };
  return { block: false, message: null, level };
}

/** The quiet 80% notice (sidebar card, Settings > Storage). */
export function noticeText(summary: Pick<StorageSummary, "usedBytes" | "quotaBytes">): string | null {
  const level = storageLevel(summary.usedBytes, summary.quotaBytes);
  if (level === "ok") return null;
  const ratio = summary.quotaBytes > 0 ? summary.usedBytes / summary.quotaBytes : 0;
  if (level === "full") return `Storage is full. New ads, media, creatives and uploads can't be saved until you free up space.`;
  return `Storage is ${percent(ratio)} full (${formatBytes(summary.usedBytes)} of ${formatBytes(summary.quotaBytes)}).`;
}

/** A file over the plan's per-file limit, refused before it is uploaded. Null when it fits. */
export function fileTooBig(sizeBytes: number, limitBytes: number): string | null {
  if (!(limitBytes > 0) || !(sizeBytes > limitBytes)) return null;
  const mb = (n: number) => { const v = n / (1024 * 1024); return Number.isInteger(v) ? String(v) : v.toFixed(1); };
  return `This file is ${mb(sizeBytes)} MB; your Supabase plan takes files up to ${mb(limitBytes)} MB. Make it smaller, or raise the limit on a paid plan.`;
}

/** When Supabase itself refuses an upload: what happened and what to do, in plain words. */
export function uploadErrorText(error: unknown, limitBytes?: number): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : (error as { message?: string } | null)?.message ?? "";
  const e = raw.toLowerCase();
  const limit = limitBytes ? ` (${Math.round(limitBytes / (1024 * 1024))} MB on this plan)` : "";
  if (/413|payload too large|maximum allowed size|exceeded the maximum|entity too large|file size/.test(e)) return `The file is bigger than your Supabase plan allows${limit}. Make it smaller, or raise the limit on a paid plan.`;
  if (/quota|storage limit|no space|insufficient storage|507|exceed.*(storage|size limit)/.test(e)) return "Your Supabase storage is full. Free up space in Settings > Storage, or upgrade your Supabase plan, then try again.";
  if (/mime|content type|not allowed|invalid.*type/.test(e)) return "This kind of file isn't accepted here. Use a PNG, JPEG or WebP image (or an MP4 video where videos are allowed).";
  if (/network|fetch|failed to fetch|timed? ?out|abort|econn|offline/.test(e)) return "The upload didn't reach Supabase (network trouble). Check your connection and try again.";
  if (/row-level security|unauthori|not allowed|403|401|jwt/.test(e)) return "Supabase didn't let this account save the file. Sign in again, then try again.";
  return raw ? `The upload didn't work: ${raw.slice(0, 160)}` : "The upload didn't work. Try again.";
}

// MARK: Cleanup

export type CleanupAction = "rejected_creatives" | "unused_creatives" | "old_media" | "app_media" | "app_files";
export const CLEANUP_LABEL: Record<CleanupAction, string> = {
  rejected_creatives: "Delete rejected creatives",
  unused_creatives: "Delete unused creatives",
  old_media: "Delete old saved media",
  app_media: "Delete an app's competitor media",
  app_files: "Remove a deleted app's files",
};

export interface CleanupRequest { action: CleanupAction; appId?: string | null; days?: number | null }

/** The request made safe: a known action, an app id where one is needed, days from 7 to 3650 (default 90, or 30 for unused creatives). */
export function cleanCleanup(input: unknown): CleanupRequest | string {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const action = v.action as CleanupAction;
  if (!Object.keys(CLEANUP_LABEL).includes(action)) return "Pick what to delete.";
  const appId = typeof v.appId === "string" && UUID.test(v.appId) ? v.appId.toLowerCase() : null;
  if ((action === "app_media" || action === "app_files") && !appId) return "Pick the app.";
  const fallback = action === "unused_creatives" ? 30 : 90;
  const raw = Number(v.days);
  const days = action === "old_media" || action === "unused_creatives" ? Math.min(3650, Math.max(7, Number.isFinite(raw) && raw > 0 ? Math.round(raw) : fallback)) : null;
  return { action, appId, days };
}

export interface CleanupPreview { action: CleanupAction; files: number; bytes: number; items: number; what: string }

/** The confirm's sentence: exactly what goes and how much space it frees. */
export function cleanupSentence(p: CleanupPreview, appName?: string, days?: number | null): string {
  const app = appName ? ` of ${appName}` : "";
  const files = `${p.files.toLocaleString("en-US")} file${p.files === 1 ? "" : "s"}`;
  const frees = `frees ${formatBytes(p.bytes)}`;
  switch (p.action) {
    case "rejected_creatives": return `Deletes ${p.items} rejected creative${p.items === 1 ? "" : "s"}${app} and their ${files}; ${frees}. Approved and pending creatives stay.`;
    case "unused_creatives": return `Deletes ${p.items} creative${p.items === 1 ? "" : "s"}${app} older than ${days ?? 30} days that were never approved or sent to Meta, and their ${files}; ${frees}.`;
    case "old_media": return `Deletes the saved copies of ${files} of competitors' ad media${app} saved more than ${days ?? 90} days ago; ${frees}. The ads themselves stay in Research, with their text and links.`;
    case "app_media": return `Deletes all ${files} of competitors' saved ad media${app}; ${frees}. The ads stay in Research, with their text and links.`;
    case "app_files": return `Deletes all ${files}${app} (creatives, saved ad media, uploads and brand files); ${frees}. This can't be undone.`;
  }
}
