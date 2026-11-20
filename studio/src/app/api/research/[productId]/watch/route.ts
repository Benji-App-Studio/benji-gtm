import type { NextRequest } from "next/server";
import { getTranslator } from "@/lib/i18n/server";
import { cleanGoogle, cleanTikTok } from "@/lib/ad-sources";
import type { WatchRow } from "@/lib/research";
import { rowToFill } from "@/lib/competitors";
import { isResponse, requireUser } from "@/lib/server/auth";
import { competitorRows } from "@/lib/server/competitors";
import { research } from "@/lib/server/research";
import { dbFailure } from "@/lib/server/errors";

/** Removing a big competitor deletes thousands of ads and their stored files. */
export const maxDuration = 150;

const text = (value: unknown, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** A Facebook Page id from what the user pasted: the id itself, or an Ad Library / profile URL that carries one. */
const pageIdFrom = (value: string) => (/^\d{5,30}$/.test(value) ? value : value.match(/(?:view_all_page_id|[?&]id)=(\d{5,30})/)?.[1] ?? null);

/**
 * The Google and TikTok identifiers from what was pasted (lib/ad-sources.ts): the columns to set, or a
 * sentence saying what to fix. Only fields that were sent are set, so a database without migration
 * 20261119140000 still takes everything else; an empty field clears its columns.
 */
function sourceIds(body: Record<string, unknown> | null, t: Parameters<typeof cleanGoogle>[1]): { fields: Partial<WatchRow>; error: string | null } {
  const fields: Partial<WatchRow> = {};
  if (typeof body?.google === "string") {
    const google = cleanGoogle(body.google.slice(0, 500), t);
    if (!google.ok) return { fields, error: google.error };
    // An advertiser id leaves the website as it is (an analysis may have saved it); a website clears the id.
    Object.assign(fields, !google.value ? { google_advertiser_id: null, website: null }
      : google.value.advertiserId ? { google_advertiser_id: google.value.advertiserId } : { google_advertiser_id: null, website: google.value.website });
  }
  if (typeof body?.tiktok === "string") {
    const tiktok = cleanTikTok(body.tiktok.slice(0, 500), t);
    if (!tiktok.ok) return { fields, error: tiktok.error };
    Object.assign(fields, tiktok.value ? { tiktok_advertiser_id: tiktok.value.businessId, tiktok_business_name: tiktok.value.businessName } : { tiktok_advertiser_id: null, tiktok_business_name: null });
  }
  return { fields, error: null };
}

function countriesFrom(value: unknown): string[] {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/[\s,]+/);
  const codes = list.map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
  return [...new Set(codes)].slice(0, 12);
}

/** Adds a competitor to the product's list (the ad watchlist) and follows it, or fills in the one already there. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/research/[productId]/watch">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { t } = await getTranslator();
  const { productId } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const name = text(body?.name, 120);
  const network = body?.network === "tiktok" ? "tiktok" : "meta";
  const page = text(body?.page, 500);
  const pageId = page ? pageIdFrom(page) : null;
  const pageUrl = page && !pageId && /^https?:\/\/(www\.|m\.)?facebook\.com\//.test(page) ? page : null;
  const ids = sourceIds(body, t);
  const tiktokAdvertiserId = ids.fields.tiktok_advertiser_id ?? (text(body?.tiktokAdvertiserId, 40).replace(/\D/g, "") || null);
  if (!name) return Response.json({ error: body?.own === true ? t("Name the Page.") : t("Name the competitor.") }, { status: 400 });
  if (page && !pageId && !pageUrl) return Response.json({ error: t("That doesn't look like a Facebook Page id or facebook.com link.") }, { status: 400 });
  if (ids.error) return Response.json({ error: ids.error }, { status: 400 });
  // Just a name: its ads are found by searching for it.
  const searchTerms = text(body?.searchTerms, 100) || (!pageId && !pageUrl && !tiktokAdvertiserId ? name.slice(0, 100) : null);
  const countries = countriesFrom(body?.countries);
  // Empty Google and TikTok fields aren't sent on an insert: nothing to clear yet.
  const extra = Object.fromEntries(Object.entries(ids.fields).filter(([, value]) => value != null));
  const fields = {
    page_id: pageId, page_url: pageUrl, search_terms: searchTerms, tiktok_advertiser_id: tiktokAdvertiserId,
    countries: countries.length ? countries : ["US"], ...extra,
  };
  // A competitor already on the list without a Page or advertiser (added from the product, an analysis or
  // the AI profile) gets this one's details and is followed, instead of a second entry with the same name.
  const twin = body?.own === true ? null : rowToFill(await competitorRows(session, productId), name, network);
  if (twin) {
    const { data, error } = await session.supabase.from("ad_watchlist").update({ ...fields, enabled: true, candidate_id: twin.candidate_id ?? (text(body?.candidateId, 120) || null) })
      .eq("id", twin.id).select().single<WatchRow>();
    if (error) return dbFailure("watchlist fill twin", error, t("Couldn't save the competitor. Try again."), 400, {}, t);
    return Response.json(data);
  }
  const { data, error } = await session.supabase.from("ad_watchlist").insert({
    product_id: productId, name, network, ...fields,
    candidate_id: text(body?.candidateId, 120) || null,
    is_own: body?.own === true,
  }).select().single<WatchRow>();
  if (error) return dbFailure("watchlist add", error, t("Couldn't add the competitor. Try again."), 400, {}, t);
  return Response.json(data);
}

/** Turns an entry on or off, or changes its Page link, Google and TikTok identifiers, search terms or countries (its name stays: its ads are filed under it). `?id=` */
export async function PATCH(request: NextRequest) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { t } = await getTranslator();
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const body = await request.json().catch(() => ({}));
  const update: Partial<WatchRow> = {};
  if (typeof body?.enabled === "boolean") update.enabled = body.enabled;
  if (typeof body?.page === "string") {
    const page = text(body.page, 500);
    const pageId = page ? pageIdFrom(page) : null;
    const pageUrl = page && !pageId && /^https?:\/\/(www\.|m\.)?facebook\.com\//.test(page) ? page : null;
    if (page && !pageId && !pageUrl) return Response.json({ error: t("That doesn't look like a Facebook Page id or facebook.com link.") }, { status: 400 });
    update.page_id = pageId;
    update.page_url = pageUrl;
  }
  const ids = sourceIds(body, t);
  if (ids.error) return Response.json({ error: ids.error }, { status: 400 });
  Object.assign(update, ids.fields);
  if (typeof body?.searchTerms === "string") update.search_terms = text(body.searchTerms, 100) || null;
  if (body?.countries !== undefined) {
    const countries = countriesFrom(body.countries);
    if (!countries.length) return Response.json({ error: t("Add at least one country code, like US or GB.") }, { status: 400 });
    update.countries = countries;
  }
  if (!Object.keys(update).length) return Response.json({ error: t("Nothing to change.") }, { status: 400 });
  const { data, error } = await session.supabase.from("ad_watchlist").update(update).eq("id", id).select().maybeSingle<WatchRow>();
  if (error) return dbFailure("watchlist update", error, t("Couldn't save the change. Try again."), 400, {}, t);
  return data ? Response.json(data) : Response.json({ error: t("Not found") }, { status: 404 });
}

/** Removes an entry from the list (its ads stay; the product's `known_competitors` follows by trigger). `?id=` */
/** Takes an entry off the list with every trace of it: its ads, their stored files and its import history. `?id=` */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/research/[productId]/watch">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  const watchId = request.nextUrl.searchParams.get("id") ?? "";
  const { t } = await getTranslator();
  const result = await research<{ deleted: boolean; ads: number; files: number; pulls: number }>(session, "competitor-delete", { productId, watchId }, 140_000, t);
  return Response.json(result.data, { status: result.ok ? 200 : result.status || 502 });
}
