// Launch's naming convention for everything it creates on an ad platform, so Measure can group
// spend and results by app, stage, format, hook and creative version from the names alone.
//
// KEEP IN SYNC: studio/src/lib/launch/naming.ts is a byte-for-byte copy (a Deno test checks it).
//
//   Ad (and its ad creative, image and video):
//     <APP> | <STAGE> | <format-slug> | <hook-type> | v<NN> | <YYYY-MM-DD>
//     BW | TEST | green-screen-reaction | pain-point | v03 | 2026-10-02
//   Ad set:
//     <APP> | <STAGE> | adset | <audience-slug> | <YYYY-MM-DD>
//     BW | TEST | adset | us-broad | 2026-10-02
//   Campaign:
//     <APP> | <STAGE> | campaign | <objective-slug> | <YYYY-MM-DD>
//     BW | TEST | campaign | app-promotion | 2026-10-02
//
// APP is the workspace's short code (2–6 capitals, e.g. AC for Acme, TRAIL for Trailmix).
// STAGE is TEST (the low-budget testing campaign) or SCALE (the scaling campaign). The version
// counts creatives of the same format and hook in a workspace (v01, v02, …) and the date is the day
// the creative was first launched. A promoted ad keeps its format, hook, version and date and only
// changes TEST to SCALE, so one creative is one key across both stages. Segments never contain " | "
// (slugs are lowercase a–z, 0–9 and hyphens), so names split cleanly on it.

export type Stage = "TEST" | "SCALE";
export type Level = "campaign" | "adset" | "ad";

export const SEPARATOR = " | ";

export interface AdNameParts {
  app: string;
  stage: Stage;
  format: string;
  hook: string;
  version: number;
  date: string;
}

/** lowercase a–z, 0–9 and single hyphens, at most 40 characters; "none" when nothing is left. */
export function slug(value: string | null | undefined): string {
  const s = (value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s || "none";
}

/** The workspace's short code: given, or the initials of the app's name (Pocket Garden → PG). */
export function appCode(appName: string, given?: string | null): string {
  const clean = (given ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (clean.length >= 2) return clean;
  const words = appName.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const initials = words.map((w) => w[0]).join("").toUpperCase();
  if (initials.length >= 2) return initials.slice(0, 6);
  const letters = appName.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // One word (Acme → AC): set the short code in Launch settings to choose another.
  return (letters + "XX").slice(0, 2);
}

/** YYYY-MM-DD in UTC. */
export const day = (date: Date = new Date()) => date.toISOString().slice(0, 10);

const pad = (n: number) => String(Math.max(1, Math.min(99, Math.floor(n)))).padStart(2, "0");

export function adName(p: AdNameParts): string {
  return [p.app, p.stage, slug(p.format), slug(p.hook), `v${pad(p.version)}`, p.date].join(SEPARATOR);
}

export function adSetName(p: { app: string; stage: Stage; audience: string; date: string }): string {
  return [p.app, p.stage, "adset", slug(p.audience), p.date].join(SEPARATOR);
}

export function campaignName(p: { app: string; stage: Stage; objective: string; date: string }): string {
  return [p.app, p.stage, "campaign", slug(p.objective), p.date].join(SEPARATOR);
}

/** Reads an ad name back into its parts, or null when it doesn't follow the convention. */
export function parseAdName(name: string): AdNameParts | null {
  const parts = name.split(SEPARATOR);
  if (parts.length !== 6) return null;
  const [app, stage, format, hook, version, date] = parts;
  if (!/^[A-Z0-9]{2,6}$/.test(app)) return null;
  if (stage !== "TEST" && stage !== "SCALE") return null;
  if (!/^v\d{2}$/.test(version)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (format === "adset" || format === "campaign") return null;
  return { app, stage, format, hook, version: Number(version.slice(1)), date };
}

/** The same creative in the other stage (TEST → SCALE when it's promoted). */
export function withStage(name: string, stage: Stage): string {
  const parts = parseAdName(name);
  return parts ? adName({ ...parts, stage }) : name;
}

/** The next version for a format and hook, given the names already used in the workspace. */
export function nextVersion(existing: string[], app: string, format: string, hook: string): number {
  const f = slug(format);
  const h = slug(hook);
  let max = 0;
  for (const name of existing) {
    const p = parseAdName(name);
    if (p && p.app === app && p.format === f && p.hook === h) max = Math.max(max, p.version);
  }
  return max + 1;
}
