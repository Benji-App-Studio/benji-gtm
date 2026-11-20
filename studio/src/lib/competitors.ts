// One competitor list per product: the rows of `ad_watchlist` that aren't the product's own Pages
// (migration 20261005700000_one_competitor_list.sql). Research's watchlist shows it; the product form's
// "competitors" field, the AI profile's "Replace" and the competitor projects' picks write into it; QA,
// Formats and the Playground read it through `competitorsFor` (lib/server/competitors.ts).
//
// A row with `enabled` on is followed: Research pulls its ads. Rows added from the product form, the AI
// profile or an analysis start paused (on the list, nothing pulled or paid for until someone follows them).
//
// Pure rules only (no database), so the node tests can check them: the name key, merging rows into one
// competitor per name, what saving the product form adds and removes, and what Research suggests.
// The SQL twin of `competitorKey` is public.competitor_key; keep the two in step.

import { m } from "./i18n/translate";

/** Where a list entry came from. `research`: added in Research (or by an ad import). */
export type CompetitorSource = "research" | "product" | "profile" | "analysis";

/** The `ad_watchlist` columns the list reads (`website`, `handles`, `source` arrive with the migration). */
export interface CompetitorRow {
  id: string;
  name: string;
  network?: "meta" | "tiktok";
  page_id?: string | null;
  page_url?: string | null;
  search_terms?: string | null;
  tiktok_advertiser_id?: string | null;
  candidate_id?: string | null;
  enabled?: boolean;
  is_own?: boolean;
  website?: string | null;
  handles?: Record<string, string> | null;
  source?: CompetitorSource | null;
  created_at?: string;
}

export interface Competitor {
  /** The first list row for this name; null for a name only the product row still carries. */
  id: string | null;
  name: string;
  website: string | null;
  /** The Facebook Page id, when one of its rows has it. */
  pageId: string | null;
  tiktokAdvertiserId: string | null;
  /** Social handles by platform (from an analysis), without "@". */
  handles: Record<string, string>;
  source: CompetitorSource;
  /** True when any of its rows is followed (Research pulls its ads). */
  followed: boolean;
}

/** "  @Liquid   Death " → "liquid death": one competitor per key. Twin of public.competitor_key. */
export function competitorKey(name: string): string {
  return name.trim().replace(/^@+/, "").replace(/\s+/g, " ").toLowerCase();
}

const cleanName = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, 120);
const cleanHandles = (raw: unknown): Record<string, string> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>)
    .map(([k, v]) => [k, typeof v === "string" ? v.trim().replace(/^@+/, "") : ""] as const).filter(([, v]) => v));
};

/**
 * The product's competitors from its list rows (oldest first), one per name: own Pages left out, twins
 * (the same brand on Meta and TikTok, or added twice) merged into the first, which gains the twins' Page,
 * advertiser id, website and handles. `legacyNames` (the product row's `known_competitors`) are added
 * after, for names no row has: before the migration that column is the only place typed names live;
 * after it, it mirrors the list and adds nothing.
 */
export function mergeCompetitors(rows: CompetitorRow[], legacyNames: string[] = []): Competitor[] {
  const byKey = new Map<string, Competitor>();
  for (const row of rows) {
    if (row.is_own) continue;
    const key = competitorKey(row.name ?? "");
    if (!key) continue;
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, {
        id: row.id, name: cleanName(row.name), website: row.website?.trim() || null, pageId: row.page_id ?? null,
        tiktokAdvertiserId: row.tiktok_advertiser_id ?? null, handles: cleanHandles(row.handles), source: row.source ?? "research",
        followed: row.enabled !== false,
      });
      continue;
    }
    seen.website ??= row.website?.trim() || null;
    seen.pageId ??= row.page_id ?? null;
    seen.tiktokAdvertiserId ??= row.tiktok_advertiser_id ?? null;
    seen.handles = { ...cleanHandles(row.handles), ...seen.handles };
    seen.followed ||= row.enabled !== false;
  }
  for (const name of legacyNames) {
    const key = typeof name === "string" ? competitorKey(name) : "";
    if (!key || byKey.has(key)) continue;
    byKey.set(key, { id: null, name: cleanName(name), website: null, pageId: null, tiktokAdvertiserId: null, handles: {}, source: "product", followed: false });
  }
  return [...byKey.values()];
}

/**
 * The words a creative must not mention: every competitor's name and handles, one per key. QA (the
 * batch context), Formats (`AppContext.competitorNames`) and the Playground all use this list.
 */
export function competitorNames(list: Competitor[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of list.flatMap((c) => [c.name, ...Object.values(c.handles)])) {
    const key = competitorKey(word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(word.trim());
  }
  return out;
}

/** True for a list row nothing else depends on: not followed, no Page, link or TikTok advertiser, not ours. */
export function isBareRow(row: CompetitorRow): boolean {
  return !row.is_own && row.enabled === false && !row.page_id && !row.page_url && !row.tiktok_advertiser_id;
}

export interface CompetitorPlan {
  /** Names to add (as typed, first spelling wins), each a new paused row. */
  add: string[];
  /** Rows to delete: bare rows whose name is no longer wanted. */
  remove: string[];
}

/**
 * What saving a whole list of names (the product form's field, or undoing "Replace with AI profile")
 * does to the list: names not on it are added; names left out are removed only from bare rows, so a
 * followed competitor or one with a Page stays (remove those in Research). With `removeMissing: false`
 * nothing is removed (the AI profile only adds); with `removeOnly` only rows from that source are.
 */
export function planCompetitorSync(rows: CompetitorRow[], wanted: string[], o: { removeMissing?: boolean; removeOnly?: CompetitorSource } = {}): CompetitorPlan {
  const listed = new Set(rows.filter((r) => !r.is_own).map((r) => competitorKey(r.name ?? "")));
  const want = new Set<string>();
  const add: string[] = [];
  for (const raw of wanted) {
    const name = typeof raw === "string" ? cleanName(raw) : "";
    const key = competitorKey(name);
    if (!key || want.has(key)) continue;
    want.add(key);
    if (!listed.has(key)) add.push(name);
  }
  const remove = o.removeMissing === false ? [] : rows
    .filter((r) => isBareRow(r) && !want.has(competitorKey(r.name ?? "")) && (!o.removeOnly || (r.source ?? "research") === o.removeOnly))
    .map((r) => r.id);
  return { add, remove };
}

/**
 * The row Research's "Add" should fill in instead of adding a twin: a non-own row with the same name on
 * the same network that has no Page or advertiser id yet (a name added from the product form, an analysis
 * or the AI profile). Null when there's none, or the name is already there with its own Page/advertiser.
 */
export function rowToFill(rows: CompetitorRow[], name: string, network: "meta" | "tiktok"): CompetitorRow | null {
  const key = competitorKey(name);
  return rows.find((r) => !r.is_own && competitorKey(r.name ?? "") === key && (r.network ?? "meta") === network
    && (network === "meta" ? !r.page_id && !r.page_url : !r.tiktok_advertiser_id)) ?? null;
}

/** A competitor offered for the list (Research shows these as one-click adds). */
export interface CompetitorSuggestion { id: string; name: string; website: string | null; from: "analysis" | "profile" }

/**
 * Names Research offers that aren't on the list: accounts picked in the product's competitor projects
 * (normally already on it, added when picked) and the AI profile's competitors (suggested only; adding
 * is the user's call). One per name, analysis picks first.
 */
export function competitorSuggestions(rows: CompetitorRow[], candidates: { id: string; name: string; website?: string | null; selected?: boolean }[], profileNames: string[]): CompetitorSuggestion[] {
  // Names on the list, and the product's own Pages (never suggested as competitors).
  const seen = new Set(rows.map((r) => competitorKey(r.name ?? "")));
  const out: CompetitorSuggestion[] = [];
  const offer = (id: string, name: string, website: string | null, from: CompetitorSuggestion["from"]) => {
    const key = competitorKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ id, name: cleanName(name), website, from });
  };
  for (const c of candidates) if (c.selected && typeof c.name === "string") offer(c.id, c.name, c.website ?? null, "analysis");
  for (const name of profileNames) if (typeof name === "string") offer(`profile-${competitorKey(name).replace(/[^a-z0-9]+/g, "-")}`, name, null, "profile");
  return out;
}

export const COMPETITOR_SOURCE_LABEL: Record<CompetitorSource, string> = {
  research: m("added in Research"), product: m("from your product"), profile: m("from the AI profile"), analysis: m("from an analysis"),
};
