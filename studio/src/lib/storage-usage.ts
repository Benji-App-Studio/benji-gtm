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
//
// Sentences: the functions that build one take the page's `t` (lib/i18n) as their last argument and say
// English without it, so the API routes, the tests and the edge functions' twin read the same words.
import { fill, m, type Vars } from "./i18n/translate";

/** A page's `t`, or English. */
export type Say = (text: string, vars?: Vars) => string;
const english: Say = (text, vars) => fill(text, vars, "en");

export type StorageKind = "competitor_media" | "creatives" | "uploads" | "other";
export const KIND_LABEL: Record<StorageKind, string> = {
  competitor_media: m("Competitors' ad media"),
  creatives: m("Generated creatives"),
  uploads: m("Uploads and brand files"),
  other: m("Other files"),
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
  /** `account`: accounts mode, the caller's own files against their plan's storage (nothing to upgrade on Supabase). */
  scope?: "account" | "install";
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
export function summarise(rows: UsageRow[], o: { quotaBytes: number; uploadLimitBytes: number; apps: { id: string; name: string }[]; now?: Date; scope?: "account" | "install" }): StorageSummary {
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
    ...(o.scope ? { scope: o.scope } : {}),
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
  collect: m("Collecting ads saves their images and videos"),
  save_media: m("Saving media adds files"),
  generate: m("Generating saves the new creatives"),
  upload: m("Uploading adds files"),
};

export interface Guard {
  /** The action can't run: nothing is started and nothing half-saves. */
  block: boolean;
  /** Something to say before it runs (95% and up), or why it can't (100%). */
  message: string | null;
  level: StorageLevel;
}

/** What to say (or refuse) before an action that adds files. Pass the page's `t` to say it in the viewer's language. */
export function guardFor(action: AddAction, summary: Pick<StorageSummary, "usedBytes" | "quotaBytes" | "scope"> | null | undefined, adding = 0, t: Say = english): Guard {
  if (!summary) return { block: false, message: null, level: "ok" };
  const level = storageLevel(summary.usedBytes, summary.quotaBytes);
  const left = Math.max(0, summary.quotaBytes - summary.usedBytes);
  const doing = t(ACTION_TEXT[action]);
  if (level === "full" || (adding > 0 && wouldOverflow(summary.usedBytes, summary.quotaBytes, adding))) {
    // Accounts mode: their own plan's storage, so say what to delete (there is no Supabase plan of theirs to upgrade).
    if (summary.scope === "account") {
      return { block: true, level: "full", message: t("Your storage is full ({used} of {quota}). {action}, so it can't run until you delete something: rejected or unused creatives, or old saved ad media (Settings › Storage).", { used: formatBytes(summary.usedBytes), quota: formatBytes(summary.quotaBytes), action: doing }) };
    }
    return { block: true, level: "full", message: t("Storage is full ({used} of {quota}). {action}, so it can't run until you free up space or upgrade your Supabase plan.", { used: formatBytes(summary.usedBytes), quota: formatBytes(summary.quotaBytes), action: doing }) };
  }
  if (level === "warn") return { block: false, level, message: t("Storage is almost full: {left} left of {quota}. {action}; free up space first so nothing stops halfway.", { left: formatBytes(left), quota: formatBytes(summary.quotaBytes), action: doing }) };
  return { block: false, message: null, level };
}

/** The quiet 80% notice (sidebar card, Settings > Storage). */
export function noticeText(summary: Pick<StorageSummary, "usedBytes" | "quotaBytes">, t: Say = english): string | null {
  const level = storageLevel(summary.usedBytes, summary.quotaBytes);
  if (level === "ok") return null;
  const ratio = summary.quotaBytes > 0 ? summary.usedBytes / summary.quotaBytes : 0;
  if (level === "full") return t("Storage is full. New ads, media, creatives and uploads can't be saved until you free up space.");
  return t("Storage is {percent} full ({used} of {quota}).", { percent: percent(ratio), used: formatBytes(summary.usedBytes), quota: formatBytes(summary.quotaBytes) });
}

/** A file over the plan's per-file limit, refused before it is uploaded. Null when it fits. */
export function fileTooBig(sizeBytes: number, limitBytes: number, t: Say = english): string | null {
  if (!(limitBytes > 0) || !(sizeBytes > limitBytes)) return null;
  const mb = (n: number) => { const v = n / (1024 * 1024); return Number.isInteger(v) ? String(v) : v.toFixed(1); };
  return t("This file is {size} MB; your Supabase plan takes files up to {limit} MB. Make it smaller, or raise the limit on a paid plan.", { size: mb(sizeBytes), limit: mb(limitBytes) });
}

/** When Supabase itself refuses an upload: what happened and what to do, in plain words. */
export function uploadErrorText(error: unknown, limitBytes?: number, t: Say = english): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : (error as { message?: string } | null)?.message ?? "";
  const e = raw.toLowerCase();
  if (/413|payload too large|maximum allowed size|exceeded the maximum|entity too large|file size/.test(e)) {
    return limitBytes
      ? t("The file is bigger than your Supabase plan allows ({limit} MB on this plan). Make it smaller, or raise the limit on a paid plan.", { limit: String(Math.round(limitBytes / (1024 * 1024))) })
      : t("The file is bigger than your Supabase plan allows. Make it smaller, or raise the limit on a paid plan.");
  }
  if (/quota|storage limit|no space|insufficient storage|507|exceed.*(storage|size limit)/.test(e)) return t("Your Supabase storage is full. Free up space in Settings › Storage, or upgrade your Supabase plan, then try again.");
  if (/mime|content type|not allowed|invalid.*type/.test(e)) return t("This kind of file isn't accepted here. Use a PNG, JPEG or WebP image (or an MP4 video where videos are allowed).");
  if (/network|fetch|failed to fetch|timed? ?out|abort|econn|offline/.test(e)) return t("The upload didn't reach Supabase (network trouble). Check your connection and try again.");
  if (/row-level security|unauthori|not allowed|403|401|jwt/.test(e)) return t("Supabase didn't let this account save the file. Sign in again, then try again.");
  return raw ? t("The upload didn't work: {reason}", { reason: raw.slice(0, 160) }) : t("The upload didn't work. Try again.");
}

// MARK: Cleanup

export type CleanupAction = "rejected_creatives" | "unused_creatives" | "old_media" | "app_media" | "app_files";
export const CLEANUP_LABEL: Record<CleanupAction, string> = {
  rejected_creatives: m("Delete rejected creatives"),
  unused_creatives: m("Delete unused creatives"),
  old_media: m("Delete old saved media"),
  app_media: m("Delete an app's competitor media"),
  app_files: m("Remove a deleted app's files"),
};

export interface CleanupRequest { action: CleanupAction; appId?: string | null; days?: number | null }

/** The request made safe: a known action, an app id where one is needed, days from 7 to 3650 (default 90, or 30 for unused creatives). */
export function cleanCleanup(input: unknown, t: Say = english): CleanupRequest | string {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const action = v.action as CleanupAction;
  if (!Object.keys(CLEANUP_LABEL).includes(action)) return t("Pick what to delete.");
  const appId = typeof v.appId === "string" && UUID.test(v.appId) ? v.appId.toLowerCase() : null;
  if ((action === "app_media" || action === "app_files") && !appId) return t("Pick the app.");
  const fallback = action === "unused_creatives" ? 30 : 90;
  const raw = Number(v.days);
  const days = action === "old_media" || action === "unused_creatives" ? Math.min(3650, Math.max(7, Number.isFinite(raw) && raw > 0 ? Math.round(raw) : fallback)) : null;
  return { action, appId, days };
}

export interface CleanupPreview { action: CleanupAction; files: number; bytes: number; items: number; what: string }

/** The confirm's sentence: exactly what goes and how much space it frees. */
export function cleanupSentence(p: CleanupPreview, appName?: string, days?: number | null, t: Say = english): string {
  const v = { app: appName ?? "", items: p.items, files: p.files === 1 ? t("{n} file", { n: p.files }) : t("{n} files", { n: p.files }), size: formatBytes(p.bytes), days: days ?? (p.action === "unused_creatives" ? 30 : 90) };
  const one = p.items === 1;
  switch (p.action) {
    case "rejected_creatives": return appName
      ? (one ? t("Deletes {items} rejected creative of {app} and their {files}; frees {size}. Approved and pending creatives stay.", v) : t("Deletes {items} rejected creatives of {app} and their {files}; frees {size}. Approved and pending creatives stay.", v))
      : (one ? t("Deletes {items} rejected creative and their {files}; frees {size}. Approved and pending creatives stay.", v) : t("Deletes {items} rejected creatives and their {files}; frees {size}. Approved and pending creatives stay.", v));
    case "unused_creatives": return appName
      ? (one ? t("Deletes {items} creative of {app} older than {days} days that were never approved or sent to Meta, and their {files}; frees {size}.", v) : t("Deletes {items} creatives of {app} older than {days} days that were never approved or sent to Meta, and their {files}; frees {size}.", v))
      : (one ? t("Deletes {items} creative older than {days} days that were never approved or sent to Meta, and their {files}; frees {size}.", v) : t("Deletes {items} creatives older than {days} days that were never approved or sent to Meta, and their {files}; frees {size}.", v));
    case "old_media": return appName
      ? t("Deletes the saved copies of {files} of competitors' ad media of {app} saved more than {days} days ago; frees {size}. The ads themselves stay in Research, with their text and links.", v)
      : t("Deletes the saved copies of {files} of competitors' ad media saved more than {days} days ago; frees {size}. The ads themselves stay in Research, with their text and links.", v);
    case "app_media": return appName
      ? t("Deletes all {files} of competitors' saved ad media of {app}; frees {size}. The ads stay in Research, with their text and links.", v)
      : t("Deletes all {files} of competitors' saved ad media; frees {size}. The ads stay in Research, with their text and links.", v);
    case "app_files": return appName
      ? t("Deletes all {files} of {app} (creatives, saved ad media, uploads and brand files); frees {size}. This can't be undone.", v)
      : t("Deletes all {files} (creatives, saved ad media, uploads and brand files); frees {size}. This can't be undone.", v);
  }
}
