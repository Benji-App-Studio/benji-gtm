import "server-only";
// The three steps on the server (app/api/onboarding/route.ts relays to `onboardingAction`), for the first
// run after sign-up and for "New app" (a second, third… app; `mode: "new"`). Runs as the signed-in user
// (row-level security applies). Apple's endpoints and the AI read are passed in, so the Node tests
// (onboarding-route.test.ts) can run every action without the network.
//
//   lookup  { link }                    what the link is; for an App Store link, the app's name, icon and category
//   create  { name, link, productId?, mode? }
//                                       saves the app without finishing onboarding. `productId` updates the
//                                       app this run created (profiles.ui_state "onboarding.draft" for the
//                                       first run, "newapp.draft" for New app), never another one. The brand
//                                       is filled from the App Store listing (merged into what's there); the
//                                       AI read starts when the link is new.
//   suggest { productId }               competitors to pick from: apps like it on the App Store (searched by
//                                       the app's own words, lib/app-store.ts rankSimilar), and the AI's
//   finish  { productId, competitors, mode? }
//                                       saves the list, FOLLOWS exactly those competitors (so Research
//                                       collects them), and finishes onboarding. New app leaves the first
//                                       run's state alone (profiles.onboarded_at, "onboarding.draft").
import type { SupabaseClient } from "@supabase/supabase-js";
import { genreChartUrl, lookupUrl, parseChart, parseListing, parseSearch, rankSimilar, searchTerms, searchUrl, shortAppName, type StoreListing } from "@/lib/app-store";
import type { ProductRow } from "@/lib/db";
import { planLimitError } from "@/lib/db-errors";
import type { Translator } from "@/lib/i18n/translate";
import { competitorList, detectLink, flowMode, freshSuggestions, idsToFollow, kindFromLink, linkFields, linkChanged, mergeBrandKit, nameFromLink, nameFromStoreSlug, type DetectedLink, type FlowMode } from "@/lib/onboarding";
import { DRAFT_KEY, NEW_APP_DRAFT_KEY } from "@/lib/ui-state";
import { competitorRows } from "./competitors";
import { saveCompetitorField } from "./products";
import { readUiState, writeUiState } from "./ui-state";

export type Translate = Translator["t"];
export interface OnboardingSession { supabase: SupabaseClient; user: { id: string; email?: string } }
export interface OnboardingDeps {
  /** GET one of Apple's JSON endpoints; null when it doesn't answer. */
  apple: (url: string) => Promise<unknown>;
  /** Starts the AI read of the app's links (the insight function); ok false without the key. */
  startInsight: (session: OnboardingSession, productId: string) => Promise<{ ok: boolean }>;
}

const UUID = /^[0-9a-f-]{36}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function onboardingAction(session: OnboardingSession, body: Record<string, unknown>, t: Translate, deps: OnboardingDeps): Promise<Response> {
  const action = String(body.action ?? "");
  if (action === "lookup") return lookup(body, t, deps);
  if (action === "create") return create(session, body, t, deps);
  if (action === "suggest") return suggest(session, body, deps);
  if (action === "finish") return finish(session, body, t);
  return json({ error: t("Unknown action.") }, 400);
}

/** An App Store link's listing; the US store when the link names none. Null when Apple doesn't answer. */
async function listingOf(link: DetectedLink | null, deps: OnboardingDeps): Promise<StoreListing | null> {
  if (link?.kind !== "app_store" || !link.storeId) return null;
  const country = link.country ?? "us";
  const found = parseListing(await deps.apple(lookupUrl(link.storeId, country)));
  return found ?? (country !== "us" ? parseListing(await deps.apple(lookupUrl(link.storeId, "us"))) : null);
}

async function lookup(body: Record<string, unknown>, t: Translate, deps: OnboardingDeps) {
  const typed = String(body.link ?? "").slice(0, 1000);
  const link = detectLink(typed);
  if (!link) return json({ error: t("That doesn't look like a link. Paste your App Store link or your website's address.") }, 400);
  const listing = await listingOf(link, deps);
  return json({ link, listing, name: listing ? shortAppName(listing.name) : nameFromStoreSlug(typed) || nameFromLink(link) });
}

/** The plan guard's refusal, in the person's language (workstream A's guards write English). */
function limitMessage(kind: string, raw: string, t: Translate): string {
  if (kind === "app_limit") return t("Your plan can't hold another app. Delete one in Settings, or move to a bigger plan.");
  if (kind === "account_suspended") return t("This account is suspended, so it can't add apps.");
  return raw;
}

/** Where each run keeps the app it created: the first run and New app never share one. */
const draftKey = (mode: FlowMode) => (mode === "new" ? NEW_APP_DRAFT_KEY : DRAFT_KEY);

/**
 * The app this run created: the one in profiles.ui_state; before that column exists, the person's own
 * first app for the first run, and their newest app for New app (the one it just made).
 */
async function draftId(session: OnboardingSession, mode: FlowMode): Promise<{ id: string | null; stored: boolean }> {
  const { state, stored } = await readUiState(session);
  if (stored) return { id: state[draftKey(mode)] ?? null, stored };
  const { data } = await session.supabase.from("products").select("id").eq("user_id", session.user.id).order("created_at", { ascending: mode !== "new" }).limit(1);
  return { id: (data as { id: string }[] | null)?.[0]?.id ?? null, stored };
}

async function create(session: OnboardingSession, body: Record<string, unknown>, t: Translate, deps: OnboardingDeps) {
  const name = String(body.name ?? "").trim().slice(0, 120);
  if (!name) return json({ error: t("Give your app a name.") }, 400);
  const typed = String(body.link ?? "").trim();
  const link = typed ? detectLink(typed) : null;
  if (typed && !link) return json({ error: t("That doesn't look like a link. Paste your App Store link or your website's address.") }, 400);
  const { supabase } = session;
  const { website, links } = linkFields(link);
  const mode = flowMode(body.mode);

  // Only the app this run created can be updated; any other id makes a new app.
  const asked = typeof body.productId === "string" && UUID.test(body.productId) ? body.productId : null;
  const draft = asked ? await draftId(session, mode) : { id: null, stored: false };
  const existing = asked && asked === draft.id
    ? (await supabase.from("products").select("*").eq("id", asked).maybeSingle<ProductRow>()).data
    : null;

  const changed = !existing || linkChanged(existing, link);
  const listing = changed ? await listingOf(link, deps) : null;
  const fields: Record<string, unknown> = {
    name, kind: existing && !changed ? existing.kind : kindFromLink(link), website, links,
    brand_kit: mergeBrandKit(existing?.brand_kit, name, listing),
  };
  if (listing?.description && !existing?.description?.trim()) fields.description = listing.description;

  let row: ProductRow | null = null;
  if (existing) {
    const { data, error } = await supabase.from("products").update(fields).eq("id", existing.id).select("*").maybeSingle<ProductRow>();
    if (error) return json({ error: t("Couldn't save your app. Try again.") }, 500);
    row = data;
  }
  if (!row) {
    const { count } = await supabase.from("products").select("id", { count: "exact", head: true });
    const { data, error } = await supabase.from("products").insert({ ...fields, is_primary: !count }).select("*").single<ProductRow>();
    if (error) {
      // Accounts mode: the plan's app cap (or a suspended account), refused by the database's guard.
      const limit = planLimitError(error, t);
      if (limit) return json({ error: limitMessage(limit.kind, limit.message, t), limit: limit.kind }, limit.status);
      return json({ error: t("Couldn't save your app. Try again.") }, 500);
    }
    row = data;
    await writeUiState(session, draftKey(mode), row.id);
  }
  // The AI reads the links in the background when its key is set, and only when they're new.
  let reading = false;
  if (link && changed) reading = (await deps.startInsight(session, row.id).catch(() => ({ ok: false }))).ok;
  return json({ product: row, listing, reading });
}

async function suggest(session: OnboardingSession, body: Record<string, unknown>, deps: OnboardingDeps) {
  const id = typeof body.productId === "string" && UUID.test(body.productId) ? body.productId : null;
  if (!id) return json({ appStore: [], ai: [], reading: false });
  const { data: product } = await session.supabase.from("products").select("id, name, links, website, insight, insight_status").eq("id", id).maybeSingle();
  if (!product) return json({ appStore: [], ai: [], reading: false }, 404);
  const storeLink = [...((product.links as string[] | null) ?? []), product.website ?? ""].map((l) => detectLink(String(l))).find((l) => l?.kind === "app_store") ?? null;
  let appStore: { name: string; full: string; iconUrl: string | null }[] = [];
  const listing = await listingOf(storeLink, deps);
  if (listing) {
    // Apps people find with the app's own words, then its category's chart (lib/app-store.ts explains the method).
    const country = storeLink?.country ?? "us";
    const [chart, ...searches] = await Promise.all([
      listing.genreId ? deps.apple(genreChartUrl(listing.genreId, country)) : Promise.resolve(null),
      ...searchTerms(listing).map((term) => deps.apple(searchUrl(term, country))),
    ]);
    appStore = rankSimilar(listing, searches.map(parseSearch), parseChart(chart), 8).map((a) => ({ name: shortAppName(a.name), full: a.name, iconUrl: a.iconUrl }));
  }
  const insight = product.insight as { competitors?: unknown } | null;
  const ai = freshSuggestions(Array.isArray(insight?.competitors) ? insight.competitors.filter((c): c is string => typeof c === "string") : [], [], String(product.name)).slice(0, 8);
  return json({ appStore, ai, reading: product.insight_status === "running" });
}

async function finish(session: OnboardingSession, body: Record<string, unknown>, t: Translate) {
  const id = typeof body.productId === "string" && UUID.test(body.productId) ? body.productId : null;
  const mode = flowMode(body.mode);
  if (!id) return json({ error: t("Save your app first.") }, 400);
  const competitors = competitorList(Array.isArray(body.competitors) ? body.competitors.map(String) : []);
  const { supabase, user } = session;
  const { data: exists } = await supabase.from("products").select("id").eq("id", id).maybeSingle();
  if (!exists) return json({ error: t("Save your app first.") }, 404);
  let followed = 0;
  if (competitors.length) {
    const rest = await saveCompetitorField(session, id, { known_competitors: competitors });
    // Before the one-list migration the row's column is written directly.
    if (rest.known_competitors) await supabase.from("products").update({ known_competitors: competitors }).eq("id", id);
    // Names typed in a profile start paused elsewhere (lib/server/competitors.ts); these were picked to be
    // followed, so exactly these rows are switched on and Research collects them.
    const rows = await competitorRows(session, id).catch(() => []);
    const ids = idsToFollow(rows, competitors);
    if (ids.length) {
      const { error } = await supabase.from("ad_watchlist").update({ enabled: true }).in("id", ids);
      if (!error) followed = ids.length;
    }
  }
  // The first run ends onboarding; New app only lets go of its own draft (the first run's state stays as it is).
  if (mode === "new") await writeUiState(session, NEW_APP_DRAFT_KEY, null);
  else await supabase.from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("id", user.id).is("onboarded_at", null);
  const { data } = await supabase.from("products").select("*").eq("id", id).maybeSingle<ProductRow>();
  return json({ product: data, competitors, followed });
}
