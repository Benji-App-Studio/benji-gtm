// Market: app-store research on competitors' apps, as routes of the insight function (it already reads
// the App Store for the product's own listing). Every route is `market-<name>`, signed in, for one of the
// caller's products:
//
//   market-search        { productId, query, country? }    App Store link, id, bundle id or words; a Google Play link
//   market-suggest       { productId, country? }           the App Store app of each competitor on the product's list
//   market-track         { productId, store, storeId, country?, competitor? }   adds it and reads it once
//   market-untrack       { productId, appId }
//   market-refresh       { productId, appId }              Lookup + recent reviews + today's snapshot + releases
//   market-charts        { productId, kind, genre?, country?, limit? }   a top chart with each app's rating
//   market-summary       { productId, appId }              OpenAI reads the app's reviews (needs the OpenAI key)
//   market-chart-summary { productId, kind, genre?, country? }   OpenAI reads a top chart (needs the OpenAI key)
//
// Apple's endpoints are free and keyless (market_core.ts says what each gives). Calls are spaced out,
// batched (100 ids per lookup) and retried with a pause on 403/429/503. Google Play has no free
// official API: its reviews come from one Apify actor, only with the install's Apify token.
// The studio reads the tables itself (row-level security); these routes write them with the service role.
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "../_shared/auth.ts";
import { keyRefusal } from "../_shared/ai/judge.ts";
import { modelOverrides, resolveModels } from "../_shared/ai/models.ts";
import { addKeyMessage } from "../_shared/keys.ts";
import { resolveLimits, withinWallClock } from "../_shared/limits.ts";
import {
  bestMatch, CHART_KINDS, CHART_SUMMARY_SCHEMA, CHART_SUMMARY_SYSTEM, chartPrompt, chartUrl, chunks, cleanChartSummary, cleanCountry, cleanGenre,
  cleanSummary, LOOKUP_BATCH, lookupBundleUrl, lookupUrl, mergeReviews, nameKey, parseChart, parseFindInput, parseLookup, parseReviewPage, PLAY_ACTOR, playActorInput,
  playReviews, releasesFrom, REVIEW_COUNTRIES, REVIEW_SUMMARY_SCHEMA, REVIEW_SUMMARY_SYSTEM, reviewPrompt, reviewsPageUrl, searchUrl, snapshotOf, wantNextPage,
  type ChartKind, type MarketReview, type StoreApp, type Store,
} from "./market_core.ts";

export interface MarketDeps {
  db: SupabaseClient;
  keys: { get(name: string): Promise<string | undefined> };
  install: () => Promise<{ settings?: Record<string, unknown> } | null>;
  env?: (name: string) => string | undefined;
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** The least time between two calls to Apple (default 300 ms). */
  paceMs?: number;
}

/** Apps one product may track: a refresh of each stays quick, and Apple's limit is never near. */
export const MAX_TRACKED = 30;
/** Reviews OpenAI reads per summary (the newest). */
const SUMMARY_REVIEWS = 300;
const MIN_REVIEWS_TO_SUMMARIZE = 5;
const USER_AGENT = "Mozilla/5.0 (compatible; MarketResearch/1.0; reads public App Store data)";

const bad = (message: string) => new HttpError(400, message);
const UUID = /^[0-9a-f-]{36}$/i;

interface ProductRow { id: string; user_id: string; name: string; known_competitors: string[] | null }
interface AppRow {
  id: string; user_id: string; product_id: string; store: Store; store_id: string; name: string; country: string; version: string | null; competitor_name: string | null;
}

export function createMarket(deps: MarketDeps) {
  const { db } = deps;
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const env = deps.env ?? ((name: string) => Deno.env.get(name));
  const paceMs = deps.paceMs ?? 300;
  let lastApple = 0;

  // MARK: Apple

  /** GET one of Apple's JSON endpoints: spaced out, retried after a pause when Apple says slow down. Null when it doesn't answer. */
  async function apple(url: string): Promise<unknown | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = lastApple + paceMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastApple = Date.now();
      const response = await doFetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(12_000) }).catch(() => null);
      if (!response) { if (attempt === 0) continue; return null; }
      if (response.status === 403 || response.status === 429 || response.status === 503) {
        await response.body?.cancel();
        if (attempt === 2) throw new HttpError(503, "The App Store is limiting requests right now. Try again in a minute.");
        const after = Number(response.headers.get("retry-after"));
        await sleep(Math.min(8_000, Number.isFinite(after) && after > 0 ? after * 1000 : 1_500 * 2 ** attempt));
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); return null; }
      return await response.json().catch(() => null);
    }
    return null;
  }

  async function lookup(ids: string[], country: string): Promise<StoreApp[]> {
    const out: StoreApp[] = [];
    for (const batch of chunks([...new Set(ids)], LOOKUP_BATCH)) out.push(...parseLookup(await apple(lookupUrl(batch, country))));
    return out;
  }

  /** The app in its store's country, else in the US store. */
  async function lookupOne(id: string, country: string): Promise<StoreApp | null> {
    for (const cc of [...new Set([country, "us"])]) {
      const [app] = await lookup([id], cc);
      if (app) return app;
    }
    return null;
  }

  /** The newest reviews in each country (page 1, then more pages while Apple serves full ones). */
  async function appStoreReviews(id: string, country: string, deadline: number): Promise<MarketReview[]> {
    const lists: MarketReview[][] = [];
    for (const cc of [...new Set([country, ...REVIEW_COUNTRIES])]) {
      for (let page = 1; page <= 10; page++) {
        if (Date.now() > deadline) break;
        const reviews = parseReviewPage(await apple(reviewsPageUrl(id, cc, page)), cc);
        lists.push(reviews);
        if (!wantNextPage(reviews.length, page)) break;
      }
    }
    return mergeReviews(lists);
  }

  // MARK: Rows

  async function product(user: string, productId: unknown): Promise<ProductRow> {
    const id = String(productId ?? "");
    if (!UUID.test(id)) throw new HttpError(404, "This product doesn't exist.");
    const { data } = await db.from("products").select("id, user_id, name, known_competitors").eq("id", id).eq("user_id", user).maybeSingle<ProductRow>();
    if (!data) throw new HttpError(404, "This product doesn't exist.");
    return data;
  }

  async function trackedApp(p: ProductRow, appId: unknown): Promise<AppRow> {
    const id = String(appId ?? "");
    if (!UUID.test(id)) throw new HttpError(404, "That app isn't tracked.");
    const { data, error } = await db.from("market_apps").select("id, user_id, product_id, store, store_id, name, country, version, competitor_name").eq("id", id).eq("product_id", p.id).maybeSingle<AppRow>();
    if (error) throw tableError(error);
    if (!data) throw new HttpError(404, "That app isn't tracked.");
    return data;
  }

  const limits = async () => resolveLimits(await deps.install(), env);

  // MARK: Routes

  async function search(user: string, input: Record<string, unknown>) {
    const p = await product(user, input.productId);
    const country = cleanCountry(input.country) ?? "us";
    const find = parseFindInput(input.query);
    if (!find) throw bad("Type an app's name or paste its App Store link.");
    let results: StoreApp[] = [];
    if (find.kind === "google_play") {
      results = [playApp(find.pkg, null)];
    } else if (find.kind === "app_store") {
      const app = await lookupOne(find.id, find.country ?? country);
      results = app ? [app] : [];
    } else if (find.kind === "bundle") {
      results = parseLookup(await apple(lookupBundleUrl(find.bundleId, country)));
      if (!results.length) results = parseLookup(await apple(searchUrl(find.bundleId, country, 10)));
    } else {
      results = parseLookup(await apple(searchUrl(find.term, country, 15)));
    }
    const tracked = await trackedIds(p.id);
    return {
      country,
      play: find.kind === "google_play" ? { pkg: find.pkg, available: Boolean(await deps.keys.get("APIFY_TOKEN")) } : null,
      results: results.map((app) => ({ ...publicApp(app), trackedId: tracked.get(`${app.store}:${app.storeId}`) ?? null })),
    };
  }

  async function suggest(user: string, input: Record<string, unknown>) {
    const p = await product(user, input.productId);
    const country = cleanCountry(input.country) ?? "us";
    const { data: listed } = await db.from("ad_watchlist").select("name").eq("product_id", p.id).eq("is_own", false);
    const names = [...(listed ?? []).map((r: { name: string }) => r.name), ...(p.known_competitors ?? [])];
    const { data: apps, error } = await db.from("market_apps").select("store, store_id, competitor_name, name").eq("product_id", p.id);
    if (error) throw tableError(error);
    const covered = new Set((apps ?? []).flatMap((a: { competitor_name: string | null; name: string }) => [nameKey(a.competitor_name ?? ""), nameKey(a.name)]).filter(Boolean));
    const tracked = new Set((apps ?? []).map((a: { store: string; store_id: string }) => `${a.store}:${a.store_id}`));
    const seen = new Set<string>();
    const competitors = names.map((n) => String(n ?? "").trim()).filter((n) => {
      const key = nameKey(n);
      if (!key || seen.has(key) || covered.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
    const suggestions: { competitor: string; app: ReturnType<typeof publicApp> }[] = [];
    const missed: string[] = [];
    for (const competitor of competitors) {
      const match = bestMatch(competitor, parseLookup(await apple(searchUrl(competitor, country, 6))));
      if (!match) { missed.push(competitor); continue; }
      // Two names on the list can be one app (the brand and its developer): suggested once.
      if (tracked.has(`app_store:${match.storeId}`) || suggestions.some((s) => s.app.storeId === match.storeId)) continue;
      suggestions.push({ competitor, app: publicApp(match) });
    }
    return { country, competitors: competitors.length, suggestions, missed };
  }

  async function track(user: string, input: Record<string, unknown>) {
    const p = await product(user, input.productId);
    const store: Store = input.store === "google_play" ? "google_play" : "app_store";
    const storeId = String(input.storeId ?? "").trim();
    const country = cleanCountry(input.country) ?? "us";
    const competitor = typeof input.competitor === "string" && input.competitor.trim() ? input.competitor.trim().slice(0, 120) : null;
    if (store === "app_store" ? !/^\d{5,15}$/.test(storeId) : !/^[A-Za-z0-9._]{3,150}$/.test(storeId)) throw bad("That isn't an app from the store.");
    const { data: existing, error } = await db.from("market_apps").select("id, store, store_id").eq("product_id", p.id);
    if (error) throw tableError(error);
    const twin = (existing ?? []).find((a: { store: string; store_id: string }) => a.store === store && a.store_id === storeId) as { id: string } | undefined;
    if (twin) return { appId: twin.id, already: true };
    if ((existing ?? []).length >= MAX_TRACKED) throw bad(`You track ${MAX_TRACKED} apps already. Stop tracking one to add another.`);

    let row: Record<string, unknown>;
    if (store === "app_store") {
      const app = await lookupOne(storeId, country);
      if (!app) throw bad("The App Store doesn't list this app in that country. Check the link, or pick another country.");
      row = appColumns(app);
    } else {
      if (!(await deps.keys.get("APIFY_TOKEN"))) throw bad(`Google Play reviews are read through Apify. ${addKeyMessage("APIFY_TOKEN")}`);
      const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 200) : competitor ?? storeId;
      row = appColumns(playApp(storeId, name));
    }
    const { data: inserted, error: insertError } = await db.from("market_apps")
      .insert({ ...row, user_id: p.user_id, product_id: p.id, country, competitor_name: competitor }).select("id").single<{ id: string }>();
    if (insertError) throw tableError(insertError);
    const refreshed = await refreshRow({ ...(row as Partial<AppRow>), id: inserted.id, user_id: p.user_id, product_id: p.id, store, store_id: storeId, country, competitor_name: competitor } as AppRow)
      .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    return { appId: inserted.id, already: false, refreshed };
  }

  async function untrack(user: string, input: Record<string, unknown>) {
    const p = await product(user, input.productId);
    const app = await trackedApp(p, input.appId);
    const { error } = await db.from("market_apps").delete().eq("id", app.id).eq("product_id", p.id);
    if (error) throw tableError(error);
    return { removed: app.id };
  }

  async function refresh(user: string, input: Record<string, unknown>) {
    const p = await product(user, input.productId);
    return await refreshRow(await trackedApp(p, input.appId));
  }

  /** Reads one tracked app again: its listing, its newest reviews, today's snapshot and the releases they show. */
  async function refreshRow(app: AppRow) {
    const startedAt = Date.now();
    const wall = (await limits()).wallClockSec * 1000;
    const deadline = startedAt + Math.max(20_000, wall / 2);
    const today = now();
    let listing: StoreApp | null = null;
    let reviews: MarketReview[] = [];
    let note = "";

    if (app.store === "app_store") {
      listing = await lookupOne(app.store_id, app.country);
      if (!listing) note = "The App Store no longer lists this app here. Its reviews are kept.";
      reviews = await appStoreReviews(app.store_id, app.country, deadline);
    } else {
      const token = await deps.keys.get("APIFY_TOKEN");
      if (!token) throw bad(`Google Play reviews are read through Apify. ${addKeyMessage("APIFY_TOKEN")}`);
      const seconds = Math.max(30, Math.floor(withinWallClock(await limits(), 120_000, Date.now() - startedAt) / 1000) - 5);
      const response = await doFetch(`https://api.apify.com/v2/acts/${PLAY_ACTOR}/run-sync-get-dataset-items?timeout=${seconds}&maxItems=150`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(playActorInput(app.store_id)),
        signal: AbortSignal.timeout((seconds + 10) * 1000),
      }).catch(() => null);
      if (!response) note = "Apify didn't answer in time. Try Refresh again.";
      else if (response.status === 401 || response.status === 403) { await response.body?.cancel(); throw bad("Apify turned the token down. Check it in Settings > API keys."); }
      else if (response.status === 402) { await response.body?.cancel(); throw bad("Your Apify account is out of credit. Top it up on apify.com, then refresh."); }
      else if (!response.ok) { await response.body?.cancel(); note = `Apify answered ${response.status}. Try Refresh again.`; }
      else reviews = playReviews(await response.json().catch(() => []));
    }

    const stamp = today.toISOString();
    const update: Record<string, unknown> = { refreshed_at: stamp, refresh_message: note || null };
    if (listing) Object.assign(update, appColumns(listing));
    const { error: updateError } = await db.from("market_apps").update(update).eq("id", app.id);
    if (updateError) throw tableError(updateError);

    if (reviews.length) {
      const rows = reviews.map((r) => ({
        user_id: app.user_id, product_id: app.product_id, app_id: app.id, store_review_id: r.storeReviewId, rating: r.rating,
        title: r.title || null, body: r.body, author: r.author || null, version: r.version, reviewed_at: r.reviewedAt, country: r.country || null,
      }));
      for (const part of chunks(rows, 500)) {
        const { error } = await db.from("market_reviews").upsert(part, { onConflict: "app_id,store_review_id", ignoreDuplicates: true });
        if (error) throw tableError(error);
      }
    }

    // Today's snapshot (a second refresh the same day replaces it; a chart's rank set today stays).
    const snap = snapshotOf(listing ?? { rating: null, ratingCount: null, version: app.version }, today);
    if (listing || app.store === "google_play") {
      await db.from("market_snapshots").upsert({
        user_id: app.user_id, product_id: app.product_id, app_id: app.id, day: snap.day, rating: snap.rating, rating_count: snap.ratingCount, version: snap.version ?? listing?.version ?? null,
      }, { onConflict: "app_id,day" });
    }

    // Releases: the store's current version, and older ones dated by the first review written on them
    // (every review kept, not just this refresh's).
    const { data: stored } = await db.from("market_reviews").select("version, reviewed_at").eq("app_id", app.id).not("version", "is", null).limit(5000);
    const { data: known } = await db.from("market_releases").select("version, source").eq("app_id", app.id);
    const fromStore = new Set((known ?? []).filter((r: { source: string }) => r.source === "store").map((r: { version: string }) => r.version));
    const releases = releasesFrom(
      { version: listing?.version ?? null, updatedAt: listing?.updatedAt ?? null, releaseNotes: listing?.releaseNotes ?? null },
      ((stored ?? []) as { version: string; reviewed_at: string | null }[]).map((r) => ({ version: r.version, reviewedAt: r.reviewed_at })),
    ).filter((r) => r.source === "store" || !fromStore.has(r.version));
    if (releases.length) {
      await db.from("market_releases").upsert(releases.map((r) => ({
        user_id: app.user_id, product_id: app.product_id, app_id: app.id, version: r.version, released_at: r.releasedAt, notes: r.notes, source: r.source,
      })), { onConflict: "app_id,version" });
    }
    return { appId: app.id, reviews: reviews.length, listed: Boolean(listing) || app.store === "google_play", message: note || null };
  }

  async function charts(user: string, input: Record<string, unknown>) {
    const p = await product(user, input.productId);
    const chart = await readChart(input);
    // Tracked apps in this chart get their rank (on the app and today's snapshot).
    const { data: apps, error } = await db.from("market_apps").select("id, store_id").eq("product_id", p.id).eq("store", "app_store").in("store_id", chart.rows.map((r) => r.storeId));
    if (error && !isMissingTable(error)) throw tableError(error);
    const tracked = new Map(((apps ?? []) as { id: string; store_id: string }[]).map((a) => [a.store_id, a.id]));
    const label = chartLabel(chart.kind, chart.genreName);
    const today = now();
    for (const row of chart.rows) {
      const id = tracked.get(row.storeId);
      if (!id) continue;
      await db.from("market_apps").update({ chart_rank: row.rank, chart_label: label, chart_at: today.toISOString() }).eq("id", id);
      await db.from("market_snapshots").upsert({ user_id: p.user_id, product_id: p.id, app_id: id, day: today.toISOString().slice(0, 10), rank: row.rank, chart: label }, { onConflict: "app_id,day" });
    }
    return { kind: chart.kind, country: chart.country, genre: chart.genre, label, rows: chart.rows.map((r) => ({ ...r, trackedId: tracked.get(r.storeId) ?? null })) };
  }

  async function readChart(input: Record<string, unknown>) {
    const kind: ChartKind = CHART_KINDS.includes(input.kind as ChartKind) ? input.kind as ChartKind : "grossing";
    const country = cleanCountry(input.country) ?? "us";
    const genre = cleanGenre(input.genre);
    const limit = Number(input.limit) === 50 ? 50 : 100;
    const entries = parseChart(await apple(chartUrl(kind, country, genre, limit)));
    const apps = entries.length ? await lookup(entries.map((e) => e.storeId), country) : [];
    const byId = new Map(apps.map((a) => [a.storeId, a]));
    const rows = entries.map((e) => {
      const app = byId.get(e.storeId);
      return { ...e, rating: app?.rating ?? null, ratingCount: app?.ratingCount ?? null, updatedAt: app?.updatedAt ?? null, priceLabel: e.priceLabel ?? app?.priceLabel ?? null };
    });
    const genreName = genre ? (entries.find((e) => e.categoryId === genre)?.category ?? (typeof input.genreName === "string" ? input.genreName.slice(0, 60) : "this category")) : "All apps";
    return { kind, country, genre, genreName, rows, descriptions: new Map(apps.map((a) => [a.storeId, a.description ?? ""])) };
  }

  async function summary(user: string, input: Record<string, unknown>) {
    const startedAt = Date.now();
    const p = await product(user, input.productId);
    const app = await trackedApp(p, input.appId);
    const { data, error } = await db.from("market_reviews").select("store_review_id, rating, title, body, version, reviewed_at")
      .eq("app_id", app.id).order("reviewed_at", { ascending: false, nullsFirst: false }).limit(SUMMARY_REVIEWS);
    if (error) throw tableError(error);
    const reviews = ((data ?? []) as { store_review_id: string; rating: number; title: string | null; body: string; version: string | null; reviewed_at: string | null }[])
      .map((r) => ({ id: r.store_review_id, rating: r.rating, title: r.title ?? "", body: r.body, version: r.version, reviewedAt: r.reviewed_at }));
    if (reviews.length < MIN_REVIEWS_TO_SUMMARIZE) throw bad(`Only ${reviews.length} review${reviews.length === 1 ? "" : "s"} so far: too few to summarize. Refresh the app first, or try one with more reviews.`);
    const prompt = reviewPrompt({ name: app.name, store: app.store }, reviews);
    const read = reviews.slice(0, prompt.used);
    const { answer, model } = await ask(REVIEW_SUMMARY_SYSTEM, prompt.text, REVIEW_SUMMARY_SCHEMA, "review_summary", startedAt);
    const result = cleanSummary(answer, read);
    const row = { user_id: p.user_id, product_id: p.id, app_id: app.id, kind: "app", scope: app.id, summary: result, review_count: read.length, model, created_at: now().toISOString() };
    const { error: saveError } = await db.from("market_summaries").upsert(row, { onConflict: "product_id,kind,scope" });
    if (saveError) throw tableError(saveError);
    return { summary: result, reviewCount: read.length, model };
  }

  async function chartSummary(user: string, input: Record<string, unknown>) {
    const startedAt = Date.now();
    const p = await product(user, input.productId);
    if (!(await deps.keys.get("OPENAI_API_KEY"))) throw bad(`The AI summary needs an OpenAI key. ${addKeyMessage("OPENAI_API_KEY")}`);
    const chart = await readChart({ ...input, limit: 50 });
    if (!chart.rows.length) throw bad("This chart came back empty. Try another category or country.");
    const text = chartPrompt({ kind: chart.kind, genreName: chart.genreName, country: chart.country }, chart.rows, chart.descriptions);
    const { answer, model } = await ask(CHART_SUMMARY_SYSTEM, text, CHART_SUMMARY_SCHEMA, "chart_summary", startedAt);
    const result = cleanChartSummary(answer, chart.rows.map((r) => r.name));
    const scope = `${chart.kind}:${chart.genre ?? "all"}:${chart.country}`;
    const { error } = await db.from("market_summaries").upsert({
      user_id: p.user_id, product_id: p.id, app_id: null, kind: "category", scope, summary: { ...result, label: chartLabel(chart.kind, chart.genreName), country: chart.country }, review_count: chart.rows.length, model, created_at: now().toISOString(),
    }, { onConflict: "product_id,kind,scope" });
    if (error) throw tableError(error);
    return { scope, summary: result, model };
  }

  // MARK: OpenAI

  async function ask(system: string, text: string, schema: unknown, name: string, startedAt: number): Promise<{ answer: Record<string, any>; model: string }> {
    const key = await deps.keys.get("OPENAI_API_KEY");
    if (!key) throw bad(`The AI summary needs an OpenAI key. ${addKeyMessage("OPENAI_API_KEY")}`);
    const install = await deps.install();
    const model = resolveModels(install?.settings?.models, await modelOverrides(deps.keys)).text;
    const timeout = withinWallClock(resolveLimits(install, env), 180_000, Date.now() - startedAt);
    const response = await doFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, reasoning: { effort: "low" },
        input: [{ role: "system", content: system }, { role: "user", content: [{ type: "input_text", text }] }],
        text: { format: { type: "json_schema", name, strict: true, schema } },
      }),
      signal: AbortSignal.timeout(timeout),
    }).catch(() => null);
    if (!response) throw bad("OpenAI didn't answer in time. Try again in a moment.");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw bad(keyRefusal("openai", response.status, data)?.message ?? `OpenAI: ${String(data?.error?.message ?? `error ${response.status}`).slice(0, 300)}`);
    const parts = (data?.output ?? []).flatMap((item: any) => item.content ?? []);
    const refusal = parts.find((part: any) => part.type === "refusal")?.refusal;
    if (refusal) throw bad(`OpenAI declined: ${String(refusal).slice(0, 200)}`);
    const out = data?.output_text ?? parts.find((part: any) => part.type === "output_text")?.text;
    try { return { answer: JSON.parse(out), model: String(data?.model ?? model) }; } catch { throw bad("OpenAI's answer wasn't readable. Try again."); }
  }

  // MARK: Helpers

  async function trackedIds(productId: string): Promise<Map<string, string>> {
    const { data, error } = await db.from("market_apps").select("id, store, store_id").eq("product_id", productId);
    if (error && !isMissingTable(error)) throw tableError(error);
    return new Map(((data ?? []) as { id: string; store: string; store_id: string }[]).map((a) => [`${a.store}:${a.store_id}`, a.id]));
  }

  const ROUTES: Record<string, (user: string, input: Record<string, unknown>) => Promise<unknown>> = {
    "market-search": search, "market-suggest": suggest, "market-track": track, "market-untrack": untrack, "market-refresh": refresh,
    "market-charts": charts, "market-summary": summary, "market-chart-summary": chartSummary,
  };

  return {
    /** The route's answer, or null when the route isn't a Market one. */
    handle(route: string, user: string, input: Record<string, unknown>): Promise<unknown> | null {
      const fn = ROUTES[route];
      return fn ? fn(user, input) : null;
    },
    routes: Object.keys(ROUTES),
  };
}

// MARK: Shapes

/** A Google Play app as far as it is known without Google's API: its package, and the name the person gave. */
function playApp(pkg: string, name: string | null): StoreApp {
  return {
    store: "google_play", storeId: pkg, bundleId: pkg, name: name ?? pkg, developer: "", developerId: null, iconUrl: null,
    url: `https://play.google.com/store/apps/details?id=${pkg}`, category: null, categoryId: null, price: null, currency: null, priceLabel: null,
    hasIap: null, rating: null, ratingCount: null, version: null, releasedAt: null, updatedAt: null, releaseNotes: null, description: null,
  };
}

/** What the page shows for a search result. */
function publicApp(app: StoreApp) {
  const { description: _d, releaseNotes: _n, ...rest } = app;
  return rest;
}

/** The market_apps columns a listing fills. */
function appColumns(app: StoreApp): Record<string, unknown> {
  return {
    store: app.store, store_id: app.storeId, bundle_id: app.bundleId, name: app.name, developer: app.developer || null, developer_id: app.developerId,
    icon_url: app.iconUrl, url: app.url, category: app.category, category_id: app.categoryId, price: app.price, currency: app.currency, price_label: app.priceLabel,
    ...(app.hasIap == null ? {} : { has_iap: app.hasIap }),
    rating: app.rating, rating_count: app.ratingCount, version: app.version, released_at: app.releasedAt, store_updated_at: app.updatedAt,
    release_notes: app.releaseNotes, description: app.description,
  };
}

export const chartLabel = (kind: ChartKind, genreName: string) => `${{ free: "Top free", paid: "Top paid", grossing: "Top grossing" }[kind]} · ${genreName}`;

const isMissingTable = (error: { code?: string; message?: string }) => error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");

/** A database error in plain words: the Market tables missing means the install needs its update. */
function tableError(error: { code?: string; message?: string }): Error {
  if (isMissingTable(error)) return new HttpError(503, "Market isn't set up in this database yet. Run the update (docs/UPDATING.md) to add its tables.");
  return new Error(error.message ?? "The database didn't answer.");
}

