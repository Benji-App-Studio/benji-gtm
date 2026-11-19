// How creatives are filed: the awareness level a job carries onto its creatives, and the Drive
// folders and file names the studio asks for (studio/src/lib/export-paths.ts plans them with the
// launch naming convention; this side only checks them before creating anything in Drive).

/** The batch's awareness level (1–5) carried on a job's params, as the creatives row's column; {} when unset. */
export function awarenessColumns(params: Record<string, unknown> | null | undefined): { awareness_level?: number } {
  const n = Number(params?.awareness_level);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? { awareness_level: n } : {};
}

/** Folder levels a path may have below the workspace's Drive folder. */
export const DRIVE_DEPTH = 3;

/** One folder or file name made safe for Drive: no slashes or control characters, trimmed, at most 120 characters. */
export function driveName(value: unknown): string {
  // deno-lint-ignore no-control-regex
  const s = String(value ?? "").replace(/[\u0000-\u001f\u007f/\\]+/g, "-").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return s.slice(0, 120).trim();
}

/** Where one creative goes, as the studio asked: its subfolders (at most DRIVE_DEPTH) and its file name; null when unusable. */
export function cleanDrivePath(input: unknown): { folders: string[]; name: string } | null {
  if (!input || typeof input !== "object") return null;
  const v = input as { folders?: unknown; name?: unknown };
  const folders = (Array.isArray(v.folders) ? v.folders : []).map(driveName).filter(Boolean).slice(0, DRIVE_DEPTH);
  const name = driveName(v.name);
  return name ? { folders, name } : null;
}
