// Lineage during the Meta sync: which studio creative (and which format) each ad on Meta came
// from. Launch records the ad id on its draft once Meta accepts an ad (launch_drafts.ad_id), so most
// ads match by id. Ads made before that, or whose draft lost its id, match by name: Launch names
// every ad `<APP> | <TEST|SCALE> | <format> | <hook> | vNN | <YYYY-MM-DD>` and keeps the name on the
// draft. Without a draft, the format slot of the name is still the format, but only when the name
// starts with this workspace's app code (another app's ad can share the ad account).
//
// The sync only fills gaps and corrects its own work: `format_synced` remembers the format the sync
// wrote, so a format someone set by hand in Measure (format_id differs from it) is kept, while one the
// sync wrote follows later corrections of the draft. A creative link is never cleared.
// Writes go to meta_ads only, with the service role; nothing here calls Meta.

/** What the sync needs from a Launch draft. */
export interface DraftLink {
  ad_id: string | null;
  ad_name: string;
  creative_ref: string;
  creative: { formatSlug?: string | null; formatCardId?: string | null } | null;
  status?: string | null;
}

/** What meta_ads already holds for an ad. */
export interface Existing { format_id: string | null; creative_ref?: string | null; format_synced?: string | null }

export interface LineageUpdate { ad_id: string; format_id: string | null; creative_ref: string | null; format_synced: string | null }

/** Launch's ad-name convention (studio/src/lib/measure.ts parseLaunchName holds the same rules). */
export function parseLaunchName(name: string | null | undefined) {
  const parts = (name ?? "").split(" | ");
  if (parts.length !== 6) return null;
  const [app, stage, format, hook, version, date] = parts;
  if (!/^[A-Z0-9]{2,6}$/.test(app) || (stage !== "TEST" && stage !== "SCALE") || !/^v\d{2}$/.test(version) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (format === "adset" || format === "campaign") return null;
  return { app, stage, format, hook, version: Number(version.slice(1)), date };
}

/** The workspace's app code, as launch/naming.ts works it out (a Deno test compares the two). */
export function appCode(appName: string, given?: string | null): string {
  const clean = (given ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (clean.length >= 2) return clean;
  const words = appName.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const initials = words.map((w) => w[0]).join("").toUpperCase();
  if (initials.length >= 2) return initials.slice(0, 6);
  const letters = appName.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (letters + "XX").slice(0, 2);
}

/** A studio creative's id, or null for a draft that copied an ad straight from Meta (`meta:<id>`). */
const studioRef = (ref: string | null | undefined) => (ref && !ref.startsWith("meta:") ? ref : null);

/**
 * The format an ad was sent with: the format slot of the name Launch gave it (the sheet's override,
 * e.g. "carousel", lands there), else the creative's format; the same key Measure groups by.
 */
const formatOf = (draft: DraftLink | undefined, name: string, code: string | null) =>
  (draft ? parseLaunchName(draft.ad_name)?.format || draft.creative?.formatSlug || draft.creative?.formatCardId : null)
  || (draft || (code && parseLaunchName(name)?.app === code) ? parseLaunchName(name)?.format : null)
  || null;

/**
 * The format and creative each ad should carry, for the ads whose row would change. Matching: the
 * draft with this ad id; else a draft with this exact name that has no ad id of its own (one name is
 * never shared: Launch numbers versions); else the name alone gives the format, for this app's code.
 * Only ads whose current row was read are touched: a row that wasn't read is never overwritten.
 */
export function lineageUpdates(ads: { ad_id: string; name: string }[], existing: Map<string, Existing>, drafts: DraftLink[], code: string | null): LineageUpdate[] {
  const byAd = new Map<string, DraftLink>();
  const byName = new Map<string, DraftLink | null>();
  for (const d of drafts) {
    if (d.status === "cancelled") continue;
    if (d.ad_id) { byAd.set(d.ad_id, d); continue; }
    // Two id-less drafts with one name can't be told apart: neither is used.
    byName.set(d.ad_name, byName.has(d.ad_name) ? null : d);
  }
  const out: LineageUpdate[] = [];
  for (const ad of ads) {
    const before = existing.get(ad.ad_id);
    if (!before) continue;
    const draft = byAd.get(ad.ad_id) ?? byName.get(ad.name) ?? undefined;
    const computed = formatOf(draft, ad.name, code);
    const handSet = before.format_id != null && before.format_id !== (before.format_synced ?? null);
    const format = handSet ? before.format_id : computed ?? before.format_id;
    const synced = handSet ? before.format_synced ?? null : format;
    const ref = studioRef(draft?.creative_ref) ?? before.creative_ref ?? null;
    if (format === before.format_id && ref === (before.creative_ref ?? null) && synced === (before.format_synced ?? null)) continue;
    out.push({ ad_id: ad.ad_id, format_id: format, creative_ref: ref, format_synced: synced });
  }
  return out;
}

/** Meta's delivery details for an ad, kept as they come (read-only fields of the Ad object). */
export interface Delivery {
  configured: string | null;
  issues: { summary: string; level?: string | null }[];
  created: string | null;
  /** The ad account the ad is in (an older row in an account the workspace no longer uses can't be changed). */
  account: string | null;
}

export function deliveryOf(raw: { configured_status?: string; created_time?: string; account_id?: string; issues_info?: { error_summary?: string; error_message?: string; level?: string }[] }): Delivery {
  return {
    configured: raw.configured_status ?? null,
    issues: (raw.issues_info ?? []).map((i) => ({ summary: String(i.error_summary || i.error_message || "").slice(0, 300), level: i.level ?? null })).filter((i) => i.summary).slice(0, 5),
    created: raw.created_time ?? null,
    account: raw.account_id ? String(raw.account_id).replace(/^act_/, "") : null,
  };
}

// MARK: Saving

// The columns this file adds (migration 20261120300000_launch_tracking.sql). Until a database has
// them, ads are saved without them and the lineage is skipped, so an older database still syncs.
const NEW_COLUMNS = ["delivery", "creative_ref", "format_synced"] as const;
const missingColumn = (message: string | undefined) => Boolean(message && /column|schema cache/i.test(message) && NEW_COLUMNS.some((c) => message.includes(c)));

type Result = { data?: unknown; error: { message: string } | null };
interface Query extends PromiseLike<Result> {
  eq(column: string, value: string): Query;
  in(column: string, values: string[]): Query;
  is(column: string, value: null): Query;
  order(column: string): Query;
  range(from: number, to: number): Query;
}
export interface Db {
  from(table: string): {
    upsert(rows: Record<string, unknown>[], options: { onConflict: string }): PromiseLike<Result>;
    select(columns: string): Query;
  };
}

const CHUNK = 500;
/** Ids per `in` filter: keeps the request line short. */
const IDS = 150;
const PAGE = 1000;

async function upsertAll(db: Db, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from("meta_ads").upsert(rows.slice(i, i + CHUNK), { onConflict: "product_id,ad_id" });
    if (error) return error;
  }
  return null;
}

/** Rows for these ids, a chunk at a time (never one capped read of the whole table). */
async function byIds<T>(ids: string[], read: (chunk: string[]) => Query): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IDS) {
    const { data, error } = await read(ids.slice(i, i + IDS));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

/** Every row, a page at a time in a stable order (PostgREST answers at most 1,000 per request). */
async function paged<T>(read: (from: number, to: number) => Query): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || (data as unknown[]).length < PAGE) return out;
  }
}

/**
 * Saves the ads Meta returned, then fills each one's format and studio creative from Launch's drafts.
 * Never fails the sync over the lineage: a problem there is logged and the ads are saved regardless.
 */
export async function saveAds(db: Db, owner: { product_id: string; user_id: string }, ads: { ad_id: string; name: string }[], now: string): Promise<{ linked: number; columns: boolean }> {
  const rows: Record<string, unknown>[] = ads.map((a) => ({ ...owner, ...a, updated_at: now }));
  let columns = true;
  let error = await upsertAll(db, rows);
  if (error && missingColumn(error.message)) {
    columns = false;
    error = await upsertAll(db, rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !(NEW_COLUMNS as readonly string[]).includes(key)))));
  }
  if (error) throw new Error(`Saving meta_ads: ${error.message}`);
  if (!columns || !ads.length) return { linked: 0, columns };
  try {
    const ids = ads.map((a) => a.ad_id);
    const [settings, withId, idless, existing] = await Promise.all([
      paged<{ app_code: string | null; meta: { appName?: string } | null }>((a, b) => db.from("launch_settings").select("app_code, meta").eq("product_id", owner.product_id).range(a, b)),
      byIds<DraftLink>(ids, (chunk) => db.from("launch_drafts").select("ad_id, ad_name, creative_ref, creative, status").eq("product_id", owner.product_id).in("ad_id", chunk)),
      paged<DraftLink>((a, b) => db.from("launch_drafts").select("ad_id, ad_name, creative_ref, creative, status").eq("product_id", owner.product_id).is("ad_id", null).order("id").range(a, b)),
      byIds<{ ad_id: string } & Existing>(ids, (chunk) => db.from("meta_ads").select("ad_id, format_id, creative_ref, format_synced").eq("product_id", owner.product_id).in("ad_id", chunk)),
    ]);
    const s = settings[0];
    const code = s ? appCode(s.meta?.appName ?? "App", s.app_code) : null;
    const known = new Map(existing.map((r) => [r.ad_id, r]));
    const updates = lineageUpdates(ads, known, [...withId, ...idless], code);
    const failed = await upsertAll(db, updates.map((u) => ({ ...owner, ...u })));
    if (failed) throw new Error(failed.message);
    return { linked: updates.length, columns };
  } catch (e) {
    console.error(`meta lineage ${owner.product_id}: ${e instanceof Error ? e.message : String(e)}`);
    return { linked: 0, columns };
  }
}
