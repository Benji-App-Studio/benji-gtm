// Organised delivery of approved creatives: the Studio's "Download approved" zip and the Google Drive
// copy file them the same way, creatives only (no JSON):
//
//   <awareness level or format>/<creative-slug>/<aspect>.<ext>       zip, e.g. L2-problem-aware/ten-products-v01/4x5.png
//   <awareness level or format>/<creative-slug>/<readable name>      Drive, named with Launch's convention (lib/launch/naming.ts):
//                                                                    ACME | static | pain-point | v01 | 2026-10-09 | 4x5.png
//
// The top folder is the batch's awareness level (lib/awareness.ts) when it has one, else the format
// (static, carousel, video, reddit-post, tweet). One creative is one variant of one batch: its sizes
// (4:5, 9:16…) sit together in its folder. Plain TypeScript (API routes and Node tests).
import { awarenessFolder, cleanAwareness } from "./awareness";
import { appCode, SEPARATOR, slug } from "./launch/naming";

export interface ExportItem {
  id: string;
  batchId: string | null;
  jobId: string | null;
  /** The job's variant (a carousel's set), when known. */
  variant: number | null;
  /** A carousel card's number. */
  card?: number | null;
  aspect: string;
  kind: "image" | "video";
  /** What made it: image, ugc_video, ai_video, reddit, tweet. */
  style: string;
  mime: string;
  storagePath: string;
  awarenessLevel: number | null;
  formatSlug: string | null;
  hookType: string | null;
  headline: string | null;
  createdAt: string;
}

export interface ExportFile {
  id: string;
  /** The top folder: "L2-problem-aware" or "static". */
  folder: string;
  /** The creative's folder. */
  creative: string;
  /** Inside the zip: folder/creative/4x5.png. */
  zipPath: string;
  /** Drive: the subfolders under the workspace's folder, and the file's readable name. */
  drive: { folders: string[]; name: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The format folder: static, carousel, video (AI UGC and AI video alike), reddit-post or tweet. */
export function formatFolder(item: Pick<ExportItem, "kind" | "style" | "card">): string {
  if (item.style === "reddit") return "reddit-post";
  if (item.style === "tweet") return "tweet";
  if (item.kind === "video" || item.style === "ugc_video" || item.style === "ai_video") return "video";
  return item.card ? "carousel" : "static";
}

/** "L2-problem-aware", else the format folder. */
export function topFolder(item: Pick<ExportItem, "kind" | "style" | "card" | "awarenessLevel">): string {
  const level = cleanAwareness(item.awarenessLevel);
  return level ? awarenessFolder(level) : formatFolder(item);
}

/** "4:5" → "4x5". */
export const aspectName = (aspect: string) => aspect.replace(/[^0-9.]+/g, "x").replace(/^x+|x+$/g, "") || "size";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

/** The file extension: from the mime type, else the stored file's own. */
export function extensionOf(mime: string, path = ""): string {
  return EXT[mime.toLowerCase()] ?? path.match(/\.([a-z0-9]{2,4})$/i)?.[1]?.toLowerCase() ?? (mime.startsWith("video/") ? "mp4" : "png");
}

/** The format as Launch names it: the format slug when it's a readable one, else the format folder. */
const formatName = (item: ExportItem) => (item.formatSlug && !UUID.test(item.formatSlug) ? slug(item.formatSlug) : formatFolder(item));
const pad = (n: number) => String(Math.max(1, Math.min(99, Math.floor(n)))).padStart(2, "0");

/** The creative's folder name before de-duplication: its headline (or hook, or format) and its variant. */
export function creativeBase(item: ExportItem): string {
  const words = slug(item.headline || item.hookType || formatName(item)).split("-").slice(0, 6).join("-");
  return `${words}-v${pad(item.variant ?? 1)}`;
}

/** One creative = one variant of one batch (its sizes and carousel cards together). */
const groupKey = (item: ExportItem) => (item.batchId ? `${item.batchId}:${item.variant ?? 1}` : `job:${item.jobId ?? item.id}`);

/**
 * Where every file goes, in the zip and in Drive. Creative folders are unique within their top folder
 * (a second "pain-point-v01" becomes "pain-point-v01-2"), and so are file names within a creative folder.
 */
export function exportPlan(items: ExportItem[], o: { appName: string; appCode?: string | null }): ExportFile[] {
  const app = appCode(o.appName, o.appCode);
  const sorted = [...items].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
  const creativeOf = new Map<string, string>();
  const taken = new Map<string, Set<string>>();
  const files = new Map<string, Set<string>>();
  const unique = (set: Set<string>, base: string, ext = "") => {
    let name = `${base}${ext}`;
    for (let n = 2; set.has(name); n++) name = `${base}-${n}${ext}`;
    set.add(name);
    return name;
  };
  return sorted.map((item) => {
    const folder = topFolder(item);
    const key = `${folder}|${groupKey(item)}`;
    let creative = creativeOf.get(key);
    if (!creative) {
      const used = taken.get(folder) ?? new Set<string>();
      taken.set(folder, used);
      creative = unique(used, creativeBase(item));
      creativeOf.set(key, creative);
    }
    const ext = extensionOf(item.mime, item.storagePath);
    const size = aspectName(item.aspect);
    const inFolder = files.get(key) ?? new Set<string>();
    files.set(key, inFolder);
    const file = unique(inFolder, item.card ? `${size}-card-${item.card}` : size, `.${ext}`);
    const date = (item.createdAt || new Date().toISOString()).slice(0, 10);
    const sizePart = file.slice(0, -(ext.length + 1));
    const name = [app, formatName(item), slug(item.hookType), `v${pad(item.variant ?? 1)}`, date, sizePart].join(SEPARATOR) + `.${ext}`;
    return { id: item.id, folder, creative, zipPath: `${folder}/${creative}/${file}`, drive: { folders: [folder, creative], name } };
  });
}

/** The zip's file name: "acme-approved-2026-10-09.zip". */
export const zipName = (appName: string, date = new Date()) => `${slug(appName)}-approved-${date.toISOString().slice(0, 10)}.zip`;
