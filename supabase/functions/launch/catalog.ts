// Read-only views of the workspace's ad account for the "Send to Meta" sheet: campaigns and their ad
// sets, the Pages, Instagram accounts, pixels, custom conversions and audiences it can use, Meta's
// targeting search (interests, places, languages), the audience size estimate, and ad previews.
// Nothing here writes. Budgets come back in major units of the account currency (fromMinor).
import { act, type Graph, GraphError } from "./graph.ts";
import { type AccountInfo, account, explain, fromMinor } from "./meta.ts";
import { type BudgetMode, META_OBJECTIVES, type MetaObjective } from "./rules.ts";

export interface Paged<T> { items: T[]; next: string | null }
type Raw = Record<string, unknown>;
type List = { data?: Raw[]; paging?: { cursors?: { after?: string }; next?: string } };

const PAGE_SIZE = 50;
const cursor = (r: List) => (r.paging?.next ? r.paging?.cursors?.after ?? null : null);
const money = (v: unknown, currency: string) => (v != null && v !== "" && Number(v) > 0 ? fromMinor(Number(v), currency) : null);
const text = (v: unknown) => (v == null ? null : String(v));
/** Strips act_ so ids compare. */
export const accountId = (id: unknown) => String(id ?? "").replace(/^act_/, "");

// MARK: Campaigns and ad sets

export interface CampaignRow {
  id: string;
  name: string;
  objective: MetaObjective | string;
  status: string;
  effectiveStatus: string;
  buyingType: string;
  budgetMode: BudgetMode;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  bidStrategy: string | null;
  spendCap: number | null;
  startTime: string | null;
  stopTime: string | null;
  specialAdCategories: string[];
  accountId: string;
}

export const CAMPAIGN_FIELDS = "id,name,objective,status,effective_status,buying_type,daily_budget,lifetime_budget,bid_strategy,spend_cap,start_time,stop_time,special_ad_categories,account_id";

export function campaignRow(r: Raw, currency: string): CampaignRow {
  const daily = money(r.daily_budget, currency);
  const lifetime = money(r.lifetime_budget, currency);
  return {
    id: String(r.id), name: String(r.name ?? ""), objective: String(r.objective ?? ""), status: String(r.status ?? ""),
    effectiveStatus: String(r.effective_status ?? r.status ?? ""), buyingType: String(r.buying_type ?? "AUCTION"),
    // A campaign with its own budget is CBO; without one its ad sets carry the budgets (ABO).
    budgetMode: daily != null || lifetime != null ? "CBO" : "ABO",
    dailyBudget: daily, lifetimeBudget: lifetime, bidStrategy: text(r.bid_strategy), spendCap: money(r.spend_cap, currency),
    startTime: text(r.start_time), stopTime: text(r.stop_time),
    specialAdCategories: Array.isArray(r.special_ad_categories) ? (r.special_ad_categories as string[]).filter((c) => c !== "NONE") : [],
    accountId: accountId(r.account_id),
  };
}

export const isOdax = (o: string): o is MetaObjective => (META_OBJECTIVES as readonly string[]).includes(o);

/** The account's campaigns, newest first, 50 at a time (archived and deleted ones left out). */
export async function listCampaigns(graph: Graph, adAccountId: string, currency: string, after?: string | null): Promise<Paged<CampaignRow>> {
  const r = await graph.get<List>(`${act(adAccountId)}/campaigns`, {
    fields: CAMPAIGN_FIELDS, limit: PAGE_SIZE, after: after || undefined,
    effective_status: ["ACTIVE", "PAUSED", "IN_PROCESS", "WITH_ISSUES", "CAMPAIGN_PAUSED", "PENDING_REVIEW", "DISAPPROVED"],
  });
  return { items: (r.data ?? []).map((c) => campaignRow(c, currency)), next: cursor(r) };
}

export interface AdSetRow {
  id: string;
  name: string;
  campaignId: string;
  status: string;
  effectiveStatus: string;
  optimizationGoal: string;
  billingEvent: string;
  destinationType: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  bidStrategy: string | null;
  bidAmount: number | null;
  startTime: string | null;
  endTime: string | null;
  promotedObject: Record<string, unknown> | null;
  targeting: string;
  ads: number;
  accountId: string;
}

export const ADSET_FIELDS = "id,name,campaign_id,account_id,status,effective_status,optimization_goal,billing_event,destination_type,daily_budget,lifetime_budget,bid_strategy,bid_amount,start_time,end_time,promoted_object,targeting,ads.limit(0).summary(true)";

/** "US, GB · 18–65 · all genders · Advantage+ audience · Advantage+ placements · 3 interests" */
export function targetingSummary(t: Raw | null | undefined): string {
  if (!t) return "–";
  const g = (t.geo_locations ?? {}) as { countries?: string[]; regions?: { name?: string }[]; cities?: { name?: string }[] };
  const places = [...(g.countries ?? []), ...(g.regions ?? []).map((r) => r.name ?? "region"), ...(g.cities ?? []).map((c) => c.name ?? "city")];
  const parts = [places.length ? places.slice(0, 4).join(", ") + (places.length > 4 ? ` +${places.length - 4}` : "") : "no places"];
  const range = Array.isArray(t.age_range) ? t.age_range as number[] : [t.age_min ?? 18, t.age_max ?? 65];
  parts.push(`${range[0]}–${range[1]}`);
  const genders = t.genders as number[] | undefined;
  parts.push(genders?.length === 1 ? (genders[0] === 1 ? "men" : "women") : "all genders");
  if ((t.targeting_automation as { advantage_audience?: number } | undefined)?.advantage_audience === 1) parts.push("Advantage+ audience");
  parts.push(t.publisher_platforms ? `placements: ${(t.publisher_platforms as string[]).join(", ")}` : "Advantage+ placements");
  const interests = ((t.flexible_spec as { interests?: unknown[] }[] | undefined) ?? []).reduce((n, f) => n + (f.interests?.length ?? 0), 0);
  if (interests) parts.push(`${interests} interest${interests === 1 ? "" : "s"}`);
  const audiences = (t.custom_audiences as unknown[] | undefined)?.length ?? 0;
  if (audiences) parts.push(`${audiences} custom audience${audiences === 1 ? "" : "s"}`);
  if (t.user_os) parts.push((t.user_os as string[]).join("/"));
  return parts.join(" · ");
}

export function adSetRow(r: Raw, currency: string): AdSetRow {
  return {
    id: String(r.id), name: String(r.name ?? ""), campaignId: String(r.campaign_id ?? ""), status: String(r.status ?? ""),
    effectiveStatus: String(r.effective_status ?? r.status ?? ""), optimizationGoal: String(r.optimization_goal ?? ""),
    billingEvent: String(r.billing_event ?? ""), destinationType: text(r.destination_type),
    dailyBudget: money(r.daily_budget, currency), lifetimeBudget: money(r.lifetime_budget, currency),
    bidStrategy: text(r.bid_strategy), bidAmount: money(r.bid_amount, currency),
    startTime: text(r.start_time), endTime: text(r.end_time),
    promotedObject: (r.promoted_object as Record<string, unknown> | undefined) ?? null,
    targeting: targetingSummary(r.targeting as Raw | undefined),
    ads: (r.ads as { summary?: { total_count?: number } } | undefined)?.summary?.total_count ?? 0,
    accountId: accountId(r.account_id),
  };
}

export async function listAdSets(graph: Graph, campaignId: string, currency: string, after?: string | null): Promise<Paged<AdSetRow>> {
  const r = await graph.get<List>(`${campaignId}/adsets`, { fields: ADSET_FIELDS, limit: PAGE_SIZE, after: after || undefined });
  return { items: (r.data ?? []).map((a) => adSetRow(a, currency)), next: cursor(r) };
}

/** One campaign (with its account, to check it belongs to the workspace). */
export async function campaignInfo(graph: Graph, id: string, currency: string): Promise<CampaignRow> {
  return campaignRow(await graph.get<Raw>(id, { fields: CAMPAIGN_FIELDS }), currency);
}

export async function adSetInfo(graph: Graph, id: string, currency: string): Promise<AdSetRow> {
  return adSetRow(await graph.get<Raw>(id, { fields: ADSET_FIELDS }), currency);
}

// MARK: Connections

export interface Connections {
  account: AccountInfo;
  pages: { id: string; name: string; instagram?: { id: string; username: string } | null }[];
  instagram: { id: string; username: string; source: "account" | "page" }[];
  pixels: { id: string; name: string; lastFired: string | null }[];
  customConversions: { id: string; name: string; event: string | null; pixelId: string | null }[];
  audiences: { id: string; name: string; subtype: string; size: string | null; lookalike: boolean }[];
  /** Sections Meta wouldn't list, with why (the token may lack a permission); the rest still load. */
  errors: Record<string, string>;
}

async function all(graph: Graph, path: string, params: Record<string, unknown>, max = 200): Promise<Raw[]> {
  const out: Raw[] = [];
  let after: string | null | undefined;
  do {
    const r = await graph.get<List>(path, { ...params, limit: 100, after: after || undefined });
    out.push(...(r.data ?? []));
    after = cursor(r);
  } while (after && out.length < max);
  return out.slice(0, max);
}

const size = (r: Raw) => {
  const lo = Number(r.approximate_count_lower_bound ?? -1);
  const hi = Number(r.approximate_count_upper_bound ?? -1);
  if (lo < 0 && hi < 0) return null;
  return lo === hi || hi < 0 ? `${Math.max(lo, 0).toLocaleString("en")}` : `${lo.toLocaleString("en")}–${hi.toLocaleString("en")}`;
};

/** Everything an ad set or ad can point at in this account. A section that fails doesn't fail the rest. */
export async function connections(graph: Graph, adAccountId: string): Promise<Connections> {
  const a = act(adAccountId);
  const errors: Record<string, string> = {};
  const safe = async <T>(key: string, run: () => Promise<T[]>): Promise<T[]> => {
    try { return await run(); } catch (error) { errors[key] = explain(error); return []; }
  };
  const [info, pages, igAccount, pixels, conversions, audiences] = await Promise.all([
    account(graph, adAccountId),
    safe("pages", async () => (await all(graph, `${a}/promote_pages`, { fields: "id,name,instagram_business_account{id,username}" })).map((p) => {
      const ig = p.instagram_business_account as { id?: string; username?: string } | undefined;
      return { id: String(p.id), name: String(p.name ?? ""), instagram: ig?.id ? { id: String(ig.id), username: String(ig.username ?? "") } : null };
    })),
    safe("instagram", async () => (await all(graph, `${a}/instagram_accounts`, { fields: "id,username" })).map((i) => ({ id: String(i.id), username: String(i.username ?? ""), source: "account" as const }))),
    safe("pixels", async () => (await all(graph, `${a}/adspixels`, { fields: "id,name,last_fired_time" })).map((p) => ({ id: String(p.id), name: String(p.name ?? ""), lastFired: text(p.last_fired_time) }))),
    safe("customConversions", async () => (await all(graph, `${a}/customconversions`, { fields: "id,name,custom_event_type,pixel{id}" })).map((c) => ({
      id: String(c.id), name: String(c.name ?? ""), event: text(c.custom_event_type), pixelId: text((c.pixel as { id?: string } | undefined)?.id),
    }))),
    safe("audiences", async () => (await all(graph, `${a}/customaudiences`, { fields: "id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,lookalike_spec" }, 500)).map((c) => ({
      id: String(c.id), name: String(c.name ?? ""), subtype: String(c.subtype ?? "CUSTOM"), size: size(c), lookalike: c.subtype === "LOOKALIKE" || Boolean(c.lookalike_spec),
    }))),
  ]);
  // Instagram accounts: the ad account's own, plus those connected to its Pages.
  const instagram: Connections["instagram"] = [...igAccount];
  for (const p of pages) if (p.instagram && !instagram.some((i) => i.id === p.instagram!.id)) instagram.push({ ...p.instagram, source: "page" });
  return { account: info, pages, instagram, pixels, customConversions: conversions, audiences, errors };
}

// MARK: Targeting search

export type SearchKind = "interest" | "geo" | "locale";

export interface SearchHit {
  id: string;
  name: string;
  /** Interests: the category path. Places: "Region, Country". */
  detail?: string;
  /** Interests: people Meta can reach (lower bound). */
  size?: number | null;
  /** Places: country, region or city; and its country code. */
  type?: "country" | "region" | "city";
  countryCode?: string;
}

/** Meta's targeting search. Interests may only be picked from these results (real ids). */
export async function search(graph: Graph, kind: SearchKind, q: string, limit = 25): Promise<SearchHit[]> {
  const query = q.trim().slice(0, 100);
  if (!query) return [];
  if (kind === "interest") {
    const r = await graph.get<List>("search", { type: "adinterest", q: query, limit });
    return (r.data ?? []).map((i) => ({
      id: String(i.id), name: String(i.name ?? ""), detail: Array.isArray(i.path) ? (i.path as string[]).slice(0, -1).join(" › ") : undefined,
      size: i.audience_size_lower_bound != null ? Number(i.audience_size_lower_bound) : null,
    }));
  }
  if (kind === "geo") {
    const r = await graph.get<List>("search", { type: "adgeolocation", q: query, location_types: ["country", "region", "city"], limit });
    return (r.data ?? []).flatMap((g) => {
      const type = g.type === "country" || g.type === "region" || g.type === "city" ? g.type : null;
      if (!type) return [];
      return [{
        id: String(type === "country" ? g.country_code ?? g.key : g.key), name: String(g.name ?? ""), type, countryCode: text(g.country_code) ?? undefined,
        detail: [type === "city" ? g.region : null, type !== "country" ? g.country_name : null].filter(Boolean).join(", ") || undefined,
      }];
    });
  }
  const r = await graph.get<List>("search", { type: "adlocale", q: query, limit });
  return (r.data ?? []).map((l) => ({ id: String(l.key), name: String(l.name ?? "") }));
}

/** Which of these interest ids Meta still accepts (interests get retired). */
export async function validInterests(graph: Graph, ids: string[]): Promise<{ valid: string[]; invalid: string[] }> {
  if (!ids.length) return { valid: [], invalid: [] };
  const r = await graph.get<List>("search", { type: "adinterestvalid", interest_fbid_list: ids });
  const ok = new Set((r.data ?? []).filter((d) => d.valid !== false).map((d) => String(d.id)));
  return { valid: ids.filter((i) => ok.has(i)), invalid: ids.filter((i) => !ok.has(i)) };
}

/** Meta's monthly audience estimate for a targeting spec (a hint; null when Meta can't say). */
export async function deliveryEstimate(graph: Graph, adAccountId: string, goal: string, targeting: Record<string, unknown>, promoted?: Record<string, unknown>): Promise<{ lower: number; upper: number } | null> {
  try {
    const r = await graph.get<List>(`${act(adAccountId)}/delivery_estimate`, { optimization_goal: goal, targeting_spec: targeting, promoted_object: promoted });
    const d = r.data?.[0];
    if (!d) return null;
    const lower = Number(d.estimate_mau_lower_bound ?? d.estimate_mau ?? -1);
    const upper = Number(d.estimate_mau_upper_bound ?? d.estimate_mau ?? -1);
    return lower >= 0 && upper >= 0 ? { lower, upper } : null;
  } catch (error) {
    if (error instanceof GraphError && !error.transient) return null;
    throw error;
  }
}

// MARK: Previews

export const PREVIEW_FORMATS = ["MOBILE_FEED_STANDARD", "INSTAGRAM_STANDARD", "INSTAGRAM_STORY"] as const;
const PREVIEW_HOSTS = ["www.facebook.com", "business.facebook.com", "m.facebook.com"];

/** The iframe address in a preview body, only when it points at Facebook. */
export function previewSrc(body: string): string | null {
  const m = body.match(/src="([^"]+)"/);
  if (!m) return null;
  const src = m[1].replace(/&amp;/g, "&");
  try {
    const u = new URL(src);
    return u.protocol === "https:" && PREVIEW_HOSTS.includes(u.host) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** How a (paused) ad looks in each placement, as iframe addresses Meta renders. */
export function adPreviews(graph: Graph, adId: string): Promise<{ format: string; src: string | null; error?: string }[]> {
  return Promise.all(PREVIEW_FORMATS.map(async (format) => {
    try {
      const r = await graph.get<List>(`${adId}/previews`, { ad_format: format });
      return { format, src: previewSrc(String(r.data?.[0]?.body ?? "")) };
    } catch (error) {
      return { format, src: null, error: explain(error) };
    }
  }));
}
