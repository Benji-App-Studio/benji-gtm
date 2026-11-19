// Product insight: reads the links a product was onboarded with and writes an organized profile of it.
//
// `start` (signed in, the product's owner) marks the product `insight_status = running` and works in
// the background: it opens the website and its most useful subpages (about, pricing, features, FAQ…,
// or the sitemap when the home page links to little), the App Store listing (Apple's lookup API, which
// also gives the icon, screenshots, rating and the developer's website) or the Google Play page, and
// any other links; collects colour candidates from the site's CSS; then one OpenAI call reads all of it
// with the owner's own notes and a few images (icon, social preview, screenshots) and answers in a fixed
// shape (core.ts INSIGHT_SCHEMA). The result goes to `products.insight`; progress and errors to
// `insight_message`. The studio's "Replace with AI insight" applies it (studio/src/lib/product-insight.ts).
//
// Only public http(s) links are opened (no private addresses, no credentials), every redirect is
// re-checked, and each response is capped in size and time.
import { createClient } from "@supabase/supabase-js";
import {
  ASSET_KINDS, imageSize, originalImage, SORT_SCHEMA, SORT_SYSTEM,
  appStoreCountry, appStoreId, cleanInsight, parseAppStorePageReviews, parseReviewFeed, reviewsFeedUrl, type AppStoreReview, cssColors, INSIGHT_SCHEMA, INSIGHT_SYSTEM, isPublicUrl, linkKind, linksOf, playPackage, rankSubpages, socialsFromLinks,
  readPage, sitemapLinks, type ColorCandidate, type PageRead,
} from "./core.ts";
import { createAuth, HttpError } from "../_shared/auth.ts";
import { modelOverrides, resolveModels } from "../_shared/ai/models.ts";
import { addKeyMessage, createKeys } from "../_shared/keys.ts";
import { resolveLimits, withinWallClock } from "../_shared/limits.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    return keys.default ?? Object.values(keys)[0];
  } catch {
    throw new Error("No service key in the environment.");
  }
}

const db = createClient(SUPABASE_URL, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });

/** Links read per run, pages read per run (all sites together), subpages per site. */
const MAX_LINKS = 8;
const MAX_PAGES = 22;
const SUBPAGES_PER_SITE = 12;
/** A run that has said nothing for this long is treated as dead, and can be started again. */
const STALE_MS = 8 * 60_000;
const PAGE_BYTES = 1_500_000;
const CSS_BYTES = 600_000;
const USER_AGENT = "Mozilla/5.0 (compatible; ProductPageReader/1.0; reads a product's public pages for its owner)";

class UserError extends Error {}
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

// MARK: HTTP

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/** The signed-in caller's user id; 403 unless this install lets them in. */
async function signedInUser(req: Request): Promise<string> {
  return (await auth.member(req)).id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const route = new URL(req.url).pathname.replace(/\/+$/, "").split("/").pop();
  try {
    if (route === "health") return json({ ok: true, openai: Boolean(await openAiKey()) });
    const user = await signedInUser(req);
    const input = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (route === "start") return json(await start(user, String(input.productId ?? "")));
    if (route === "sort") return json(await sortRoute(user, String(input.productId ?? ""), input.all === true));
    if (route === "images") return json(await imagesRoute(user, String(input.productId ?? "")));
    if (route === "reviews") return json(await reviewsRoute(user, String(input.productId ?? "")));
    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof UserError) return json({ error: error.message }, 400);
    console.error(error);
    return json({ error: `Something went wrong: ${errorText(error)}` }, 500);
  }
});

// MARK: Keys

/** Every key comes from the shared reader (edge function secret first, then Vault). */
const secrets = createKeys(db);
const auth = createAuth(db);

async function openAiKey(): Promise<string | null> {
  return (await secrets.get("OPENAI_API_KEY")) ?? null;
}

/**
 * The model that reads pages and images (they go in one request, so it is the vision model): an
 * environment variable or stored key, else Settings > Models, else the default (_shared/ai/models.ts).
 */
const readerModel = async () => resolveModels((await auth.install())?.settings?.models, await modelOverrides(secrets)).vision;

/** What the Supabase plan allows (_shared/limits.ts); the old numbers on an install with no install row. */
const planLimits = async () => resolveLimits(await auth.install(), (name) => Deno.env.get(name));
/** The longest one OpenAI request waits (a profile with images at medium effort can take minutes). */
const ASK_MS = 240_000;
/** How long an OpenAI request may wait now, so it ends before the plan's time limit: `startedAt` is when this invocation's work began. */
const askBudget = async (startedAt: number) => withinWallClock(await planLimits(), ASK_MS, Date.now() - startedAt);

// MARK: Start

interface ProductRow {
  id: string; user_id: string; name: string; kind: string; description: string; website: string | null; links: string[] | null;
  audience: string | null; price_tier: string | null; sales_channel: string | null; region: string | null; answers: Record<string, string> | null;
  known_competitors: string[] | null; brand_kit: Record<string, unknown> | null; insight_status: string | null; insight_started_at: string | null;
}

async function start(user: string, productId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) throw new HttpError(404, "This product doesn't exist.");
  const { data: product } = await db.from("products")
    .select("id, user_id, name, kind, description, website, links, audience, price_tier, sales_channel, region, answers, known_competitors, brand_kit, insight_status, insight_started_at")
    .eq("id", productId).eq("user_id", user).maybeSingle<ProductRow>();
  if (!product) throw new HttpError(404, "This product doesn't exist.");
  const links = linksOf(product, MAX_LINKS);
  if (!links.length) throw new UserError("Add your website, App Store link or another link to your product first, then the AI can read it.");
  if (product.insight_status === "running" && product.insight_started_at && Date.now() - Date.parse(product.insight_started_at) < STALE_MS) {
    return { status: "running", alreadyRunning: true };
  }
  if (!(await openAiKey())) throw new UserError(`The AI reader needs an OpenAI key. ${addKeyMessage("OPENAI_API_KEY")}`);
  await db.from("products").update({ insight_status: "running", insight_message: `Opening ${links.length} link${links.length === 1 ? "" : "s"}…`, insight_started_at: new Date().toISOString() }).eq("id", product.id);
  EdgeRuntime.waitUntil(run(product, links).catch(async (error) => {
    console.error("insight", error);
    await db.from("products").update({ insight_status: "failed", insight_message: error instanceof UserError ? error.message : `Couldn't finish: ${errorText(error)}` }).eq("id", product.id);
  }));
  return { status: "running", links };
}

const progress = (id: string, message: string) => db.from("products").update({ insight_message: message.slice(0, 300), insight_started_at: new Date().toISOString() }).eq("id", id);

// MARK: Fetching

/** GET a public link, following at most 4 redirects (each re-checked), reading at most `maxBytes`. */
async function fetchText(start: string, maxBytes: number, timeoutMs = 12_000, accept = "text/html,application/xhtml+xml"): Promise<{ url: string; text: string; type: string } | null> {
  let url = start;
  const deadline = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop < 5; hop++) {
    if (!isPublicUrl(url)) return null;
    const response = await fetch(url, { redirect: "manual", signal: deadline, headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Language": "en" } }).catch(() => null);
    if (!response) return null;
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      if (!next) return null;
      try { url = new URL(next, url).toString(); } catch { return null; }
      continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); return null; }
    const type = response.headers.get("content-type") ?? "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (size < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
      }
    } catch { /* timed out mid-read: keep what arrived */ }
    await reader.cancel().catch(() => undefined);
    const bytes = new Uint8Array(Math.min(size, maxBytes));
    let offset = 0;
    for (const chunk of chunks) {
      const room = bytes.length - offset;
      if (room <= 0) break;
      bytes.set(chunk.subarray(0, room), offset);
      offset += Math.min(chunk.length, room);
    }
    return { url, text: new TextDecoder().decode(bytes), type };
  }
  return null;
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  return out;
}

// MARK: Sources

interface Source { url: string; kind: "website" | "subpage" | "app_store" | "google_play"; title: string; ok: boolean; note?: string }

interface AppListing {
  url: string; name: string; seller: string; sellerUrl: string | null; genre: string; rating: number | null; ratingCount: number | null;
  price: string; description: string; releaseNotes: string; iconUrl: string | null; screenshots: string[];
}

async function appStoreListing(url: string): Promise<AppListing | null> {
  const id = appStoreId(url);
  if (!id) return null;
  // The link's store first, then the US one (an app can be live in only some countries).
  let app: Record<string, any> | undefined;
  for (const country of [...new Set([appStoreCountry(url), "us"])]) {
    const response = await fetchText(`https://itunes.apple.com/lookup?id=${id}&country=${country}&entity=software`, 400_000, 12_000, "application/json");
    try { app = response ? JSON.parse(response.text)?.results?.[0] : undefined; } catch { app = undefined; }
    if (app) break;
  }
  if (!app) return null;
  const https = (v: unknown) => (typeof v === "string" && /^https:\/\//.test(v) ? v : null);
  return {
    url: https(app.trackViewUrl)?.split("?")[0] ?? url,
    name: String(app.trackName ?? ""), seller: String(app.sellerName ?? app.artistName ?? ""), sellerUrl: https(app.sellerUrl),
    genre: [app.primaryGenreName, ...(Array.isArray(app.genres) ? app.genres : [])].filter(Boolean).filter((g, i, all) => all.indexOf(g) === i).join(", "),
    rating: Number.isFinite(app.averageUserRating) ? Math.round(app.averageUserRating * 10) / 10 : null,
    ratingCount: Number.isFinite(app.userRatingCount) ? app.userRatingCount : null,
    price: String(app.formattedPrice ?? (app.price === 0 ? "Free" : "")),
    description: String(app.description ?? "").slice(0, 5000), releaseNotes: String(app.releaseNotes ?? "").slice(0, 800),
    iconUrl: https(app.artworkUrl512) ?? https(app.artworkUrl100),
    screenshots: (Array.isArray(app.screenshotUrls) ? app.screenshotUrls : []).map(https).filter((u: string | null): u is string => Boolean(u)).slice(0, 10),
  };
}

/**
 * The app's customer reviews, verbatim: Apple's RSS JSON feed first (the US store, then the link's),
 * else the reviews the App Store web page carries in its embedded data. Empty when neither has any.
 */
async function appStoreReviews(url: string): Promise<{ reviews: AppStoreReview[]; source: "rss" | "page" | null }> {
  const id = appStoreId(url);
  if (!id) return { reviews: [], source: null };
  for (const country of [...new Set(["us", appStoreCountry(url)])]) {
    const feed = await fetchText(reviewsFeedUrl(id, country), 1_500_000, 12_000, "application/json");
    let reviews: AppStoreReview[] = [];
    try { reviews = feed ? parseReviewFeed(JSON.parse(feed.text)) : []; } catch { reviews = []; }
    if (reviews.length) return { reviews, source: "rss" };
  }
  const page = await fetchText(url, 3_000_000, 15_000);
  const reviews = page ? parseAppStorePageReviews(page.text) : [];
  return { reviews, source: reviews.length ? "page" : null };
}

interface Site { pages: PageRead[]; colors: ColorCandidate[]; sources: Source[] }

/** A website: its home page, then its best subpages (or the sitemap's), and the colours in its CSS. */
async function readSite(url: string, budget: { pages: number }): Promise<Site> {
  const sources: Source[] = [];
  const home = budget.pages > 0 ? await fetchText(url, PAGE_BYTES) : null;
  if (!home || !/html|text\/plain|^$/i.test(home.type)) {
    sources.push({ url, kind: "website", title: "", ok: false, note: home ? "not a web page" : "couldn't open it" });
    return { pages: [], colors: [], sources };
  }
  budget.pages--;
  const first = readPage(home.url, home.text);
  sources.push({ url: home.url, kind: "website", title: first.title, ok: true });
  let next = rankSubpages(home.url, first.links, SUBPAGES_PER_SITE);
  if (next.length < 3) {
    const sitemap = await fetchText(new URL("/sitemap.xml", home.url).toString(), 800_000, 8_000, "application/xml,text/xml");
    if (sitemap) next = [...new Set([...next, ...rankSubpages(home.url, sitemapLinks(sitemap.text), SUBPAGES_PER_SITE)])].slice(0, SUBPAGES_PER_SITE);
  }
  next = next.slice(0, Math.max(0, budget.pages));
  budget.pages -= next.length;
  const subpages = await inBatches(next, 4, async (sub) => {
    const page = await fetchText(sub, PAGE_BYTES, 10_000);
    if (!page || !/html/i.test(page.type)) { sources.push({ url: sub, kind: "subpage", title: "", ok: false, note: "couldn't open it" }); return null; }
    const read = readPage(page.url, page.text);
    sources.push({ url: page.url, kind: "subpage", title: read.title, ok: true });
    return read;
  });
  const css = await inBatches(first.stylesheets.slice(0, 3), 3, async (href) => (await fetchText(href, CSS_BYTES, 8_000, "text/css"))?.text ?? "");
  return { pages: [first, ...subpages.filter((p): p is PageRead => Boolean(p))], colors: cssColors(`${first.inlineCss}\n${css.join("\n")}`, first.themeColor), sources };
}

async function googlePlay(url: string): Promise<{ page: PageRead | null; source: Source }> {
  const pkg = playPackage(url);
  const target = pkg ? `https://play.google.com/store/apps/details?id=${pkg}&hl=en&gl=us` : url;
  const response = await fetchText(target, PAGE_BYTES);
  if (!response) return { page: null, source: { url, kind: "google_play", title: "", ok: false, note: "couldn't open it" } };
  const page = readPage(response.url, response.text);
  return { page, source: { url: response.url, kind: "google_play", title: page.title, ok: true } };
}

// MARK: The run

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

interface Crawl { sources: Source[]; pages: PageRead[]; colors: ColorCandidate[]; app: AppListing | null }

/** Reads every link: store listings first (the App Store one can name the developer's site), then the sites and their pages. */
async function crawl(product: Pick<ProductRow, "id">, links: string[]): Promise<Crawl> {
  const sources: Source[] = [];
  const pages: PageRead[] = [];
  let colors: ColorCandidate[] = [];
  let app: AppListing | null = null;
  const budget = { pages: MAX_PAGES };

  // Listings first: the App Store one can name the developer's website.
  const stores = links.filter((l) => linkKind(l) !== "website");
  let sites = links.filter((l) => linkKind(l) === "website");
  for (const link of stores) {
    if (linkKind(link) === "app_store") {
      await progress(product.id, "Reading the App Store listing…");
      const listing = await appStoreListing(link);
      if (listing) {
        sources.push({ url: listing.url, kind: "app_store", title: listing.name, ok: true });
        if (!app) app = listing;
        continue;
      }
      // Not in Apple's lookup (not released yet, or removed): the listing page itself, if it opens.
      const page = await fetchText(link, PAGE_BYTES);
      const read = page && /html/i.test(page.type) ? readPage(page.url, page.text) : null;
      if (read && read.text.length > 200) pages.push(read);
      sources.push({ url: link, kind: "app_store", title: read?.title ?? "", ok: Boolean(read && read.text.length > 200), note: read ? undefined : "not on the App Store yet, or the link is wrong" });
    } else {
      await progress(product.id, "Reading the Google Play listing…");
      const { page, source } = await googlePlay(link);
      sources.push(source);
      if (page) pages.push(page);
    }
  }
  // The developer's website from the App Store listing: read too, unless it's a site already given.
  if (app?.sellerUrl && isPublicUrl(app.sellerUrl) && !sites.some((s) => new URL(s).hostname.replace(/^www\./, "") === new URL(app!.sellerUrl!).hostname.replace(/^www\./, ""))) {
    sites = [...sites, app.sellerUrl];
  }

  for (const site of sites) {
    if (budget.pages <= 0) break;
    await progress(product.id, `Reading ${new URL(site).hostname.replace(/^www\./, "")} and its pages…`);
    const read = await readSite(site, budget);
    sources.push(...read.sources);
    pages.push(...read.pages);
    if (!colors.length) colors = read.colors;
  }

  if (!sources.some((s) => s.ok)) throw new UserError(`Couldn't open any of the links (${links.map((l) => new URL(l).hostname).join(", ")}). Check they're public and try again.`);
  return { sources, pages, colors, app };
}

async function run(product: ProductRow, links: string[]) {
  const startedAt = Date.now();
  const { sources, pages, colors, app } = await crawl(product, links);
  const readCount = sources.filter((s) => s.ok).length;

  // Images the model can look at for the brand: the icon, the site's social preview, two screenshots.
  const images = [
    app?.iconUrl ? { url: app.iconUrl, label: "App icon" } : null,
    pages[0]?.ogImage ? { url: pages[0].ogImage, label: `Social preview image of ${new URL(pages[0].url).hostname}` } : null,
    ...(app?.screenshots ?? []).slice(0, 2).map((url, i) => ({ url, label: `App Store screenshot ${i + 1}` })),
  ].filter((x): x is { url: string; label: string } => Boolean(x) && isPublicUrl(x!.url) && !/\.svg(\?|$)/i.test(x!.url));

  const owner = {
    name: product.name, kind: product.kind, description: product.description, audience: product.audience, price_tier: product.price_tier,
    sales_channel: product.sales_channel, region: product.region, answers: product.answers, known_competitors: product.known_competitors,
    brand_kit: { tagline: product.brand_kit?.tagline, colors: product.brand_kit?.colors, tone: product.brand_kit?.tone },
  };
  const parts: string[] = [`OWNER'S NOTES (typed while onboarding):\n${JSON.stringify(owner, null, 1)}`];
  if (app) {
    parts.push(`APP STORE LISTING (${app.url}):\nName: ${app.name}\nDeveloper: ${app.seller}${app.sellerUrl ? ` (${app.sellerUrl})` : ""}\nCategory: ${app.genre}\nPrice: ${app.price}\nRating: ${app.rating ?? "none"}${app.ratingCount ? ` from ${app.ratingCount} ratings` : ""}\nDescription:\n${clip(app.description, 5000)}${app.releaseNotes ? `\nLatest release notes: ${clip(app.releaseNotes, 600)}` : ""}`);
  }
  let room = 60_000;
  for (const [i, page] of pages.entries()) {
    if (room <= 0) break;
    const body = clip(page.text, Math.min(i === 0 ? 7000 : 4000, room));
    room -= body.length;
    parts.push([
      `PAGE ${page.url}`,
      page.title && `Title: ${page.title}`,
      page.description && `Meta description: ${page.description}`,
      page.headings.length ? `Headings: ${page.headings.slice(0, 20).join(" | ")}` : "",
      page.structured.length ? `Structured data: ${page.structured.slice(0, 2).join(" ")}` : "",
      `Text: ${body}`,
    ].filter(Boolean).join("\n"));
  }
  if (colors.length) parts.push(`COLOUR CANDIDATES from the site's CSS (theme colour and brand-named variables first; count = how often used):\n${colors.map((c) => `${c.hex} ×${c.count}${c.brandVariable ? " (brand-named / theme colour)" : ""}${c.neutral ? " (neutral)" : ""}`).join("\n")}`);
  // Social profiles linked from any page read (headers, footers, structured data), the home page's first.
  const socials = [...new Set(pages.flatMap((p) => p.socials))].slice(0, 30);
  if (socials.length) parts.push(`SOCIAL LINKS ON THE SITE (from the pages' links, footers and structured data, in the order found):\n${socials.join("\n")}`);
  if (images.length) parts.push(`IMAGES ATTACHED, in order: ${images.map((img, i) => `${i + 1}. ${img.label}`).join("; ")}`);

  await progress(product.id, `Read ${readCount} source${readCount === 1 ? "" : "s"}. Writing your product profile…`);
  const model = await readerModel();
  let answer = await ask(model, parts.join("\n\n"), images.map((i) => i.url), INSIGHT_SHAPE, startedAt);
  if (answer === "image_error") answer = await ask(model, parts.join("\n\n").replace(/IMAGES ATTACHED[^\n]*/, ""), [], INSIGHT_SHAPE, startedAt);
  if (answer === "image_error") throw new UserError("OpenAI couldn't read the answer. Try again.");

  // Customer reviews, verbatim (never fails the run): quoted word for word in review-style ads.
  const reviews = app ? await appStoreReviews(app.url).catch(() => ({ reviews: [] as AppStoreReview[], source: null })) : null;
  const cleaned = cleanInsight(answer);
  // Handles the model didn't fill come straight from the links found on the pages.
  cleaned.product.socials = { ...socialsFromLinks(socials), ...cleaned.product.socials };
  const insight = {
    ...cleaned,
    sources: sources.slice(0, 30),
    images,
    socials,
    colorCandidates: colors.slice(0, 10).map((c) => c.hex),
    appStore: app && { url: app.url, name: app.name, seller: app.seller, sellerUrl: app.sellerUrl, genre: app.genre, rating: app.rating, ratingCount: app.ratingCount, price: app.price, iconUrl: app.iconUrl, screenshots: app.screenshots.slice(0, 8),
      reviews: reviews?.reviews ?? [], ...(reviews?.source ? { reviewsSource: reviews.source } : {}), reviewsAt: new Date().toISOString() },
    model,
    generatedAt: new Date().toISOString(),
  };
  const pagesRead = sources.filter((s) => s.ok && (s.kind === "website" || s.kind === "subpage")).length;
  await db.from("products").update({ insight, insight_at: insight.generatedAt }).eq("id", product.id);

  // The product's pictures from the site and the listing, saved and sorted (never fails the run).
  let saved = 0;
  try {
    await progress(product.id, "Saving your product's images from the site and listing…");
    saved = await collectAssets(product, pages, app);
    if (saved) {
      await progress(product.id, `Sorting ${saved} new image${saved === 1 ? "" : "s"}…`);
      await sortAssets(product.id, { name: product.name, summary: insight.summary, category: insight.category }, model);
    }
  } catch (error) {
    console.error("insight assets", error);
  }

  await db.from("products").update({
    insight_status: "done",
    insight_message: `Read ${[pagesRead ? `${pagesRead} page${pagesRead === 1 ? "" : "s"}` : "", app ? "the App Store listing" : "", sources.some((s) => s.ok && s.kind === "google_play") ? "the Google Play listing" : ""].filter(Boolean).join(", ")}${saved ? `; saved ${saved} image${saved === 1 ? "" : "s"}` : ""}.`,
  }).eq("id", product.id);
}

// MARK: Product images

const ASSET_BUCKET = "workspace";
const MAX_COLLECTED = 60;
const ASSET_BYTES = 8_000_000;
const MIN_SIDE = 240;

/** GET an image (public links only, redirects re-checked), at most `maxBytes`. */
async function fetchImage(start: string, maxBytes = ASSET_BYTES): Promise<Uint8Array | null> {
  let url = start;
  const deadline = AbortSignal.timeout(15_000);
  for (let hop = 0; hop < 5; hop++) {
    if (!isPublicUrl(url)) return null;
    const response = await fetch(url, { redirect: "manual", signal: deadline, headers: { "User-Agent": USER_AGENT, Accept: "image/avif,image/webp,image/png,image/jpeg,*/*" } }).catch(() => null);
    if (!response) return null;
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      if (!next) return null;
      try { url = new URL(next, url).toString(); } catch { return null; }
      continue;
    }
    if (!response.ok || !/^image\//i.test(response.headers.get("content-type") ?? "")) { await response.body?.cancel(); return null; }
    if (Number(response.headers.get("content-length") ?? 0) > maxBytes) { await response.body?.cancel(); return null; }
    const bytes = new Uint8Array(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
    return bytes.length && bytes.length <= maxBytes ? bytes : null;
  }
  return null;
}

const sha = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 20);

/**
 * Saves the product's pictures: App Store screenshots, each page's social preview and the pictures on
 * the pages (home first), skipping icons, tiny images and ones already saved. Returns how many were added.
 */
async function collectAssets(product: Pick<ProductRow, "id" | "user_id">, pages: PageRead[], app: AppListing | null): Promise<number> {
  const { data: existing } = await db.from("product_assets").select("source_url").eq("product_id", product.id);
  // Saved images are keyed by their original (page pictures arrive already unwrapped and unsized).
  const known = new Set(((existing ?? []) as { source_url: string | null }[]).map((r) => r.source_url).filter(Boolean));
  const candidates: { url: string; source: "website" | "app_store"; label: string }[] = [];
  const seen = new Set<string>();
  const add = (url: string | null | undefined, source: "website" | "app_store", label = "") => {
    if (!url || seen.has(url) || known.has(url)) return;
    seen.add(url);
    candidates.push({ url, source, label });
  };
  (app?.screenshots ?? []).forEach((u, i) => add(u, "app_store", `App Store screenshot ${i + 1}`));
  pages.forEach((p) => add(p.ogImage ? originalImage(p.ogImage, p.url) : null, "website", p.title));
  // Round-robin across pages, so a product page's pictures aren't crowded out by the home page's;
  // pages that look like product pages (products, shop, skincare, treatments, pricing…) go first.
  const producty = (url: string) => /\b(products?|shop|store|collections?|items?|skincare|treatments?|formulas?|pricing|plans?|catalog|menu)\b/i.test(new URL(url).pathname) ? 0 : 1;
  const queues = [...pages].sort((a, b) => producty(a.url) - producty(b.url)).map((p) => p.images.slice(0, 30));
  for (let round = 0; queues.some((q) => q.length); round++) for (const q of queues) { const img = q.shift(); if (img) add(img.url, "website", img.alt); }

  let saved = 0;
  for (let i = 0; i < candidates.length && saved < MAX_COLLECTED && i < 200; i += 6) {
    const results = await Promise.all(candidates.slice(i, i + 6).map(async (c) => {
      const bytes = await fetchImage(c.url);
      const size = bytes ? imageSize(bytes) : null;
      if (!bytes || !size || Math.min(size.width, size.height) < MIN_SIDE) return 0;
      const ext = size.mime === "image/png" ? "png" : size.mime === "image/webp" ? "webp" : "jpg";
      const path = `${product.user_id}/${product.id}/assets/${c.source}-${await sha(c.url.split("?")[0])}.${ext}`;
      const { error } = await db.storage.from(ASSET_BUCKET).upload(path, bytes, { contentType: size.mime, upsert: true });
      if (error) return 0;
      const url = db.storage.from(ASSET_BUCKET).getPublicUrl(path).data.publicUrl;
      const { error: rowError } = await db.from("product_assets").upsert({
        user_id: product.user_id, product_id: product.id, url, storage_path: path, source: c.source, source_url: c.url,
        label: c.label.slice(0, 120) || null, width: size.width, height: size.height,
      }, { onConflict: "product_id,url", ignoreDuplicates: true });
      return rowError ? 0 : 1;
    }));
    saved += results.reduce((n: number, r) => n + r, 0);
  }
  return saved;
}

/**
 * The AI sorts a product's images (kind, label, group, what each suits in an ad), 20 per call; images
 * it finds useless are hidden only when they were collected, never the user's uploads. `all` re-sorts
 * everything; otherwise only images not sorted yet. A kind the user set (kind_locked) stays.
 */
async function sortAssets(productId: string, about: { name: string; summary?: string; category?: string }, model: string, all = false, startedAt = Date.now()): Promise<number> {
  let query = db.from("product_assets").select("id, url, source, source_url, label, kind, kind_locked").eq("product_id", productId).eq("hidden", false).order("created_at").limit(60);
  if (!all) query = query.is("sorted_at", null);
  const { data } = await query;
  const assets = (data ?? []) as { id: string; url: string; source: string; source_url: string | null; label: string | null; kind: string; kind_locked: boolean }[];
  let sorted = 0;
  for (let i = 0; i < assets.length; i += 20) {
    // Too little of the plan's time left for another batch: the rest stay unsorted for the next sort.
    if (i > 0 && await askBudget(startedAt) < 30_000) break;
    const batch = assets.slice(i, i + 20);
    const text = [
      `PRODUCT: ${about.name}${about.category ? ` (${about.category})` : ""}${about.summary ? `\n${about.summary}` : ""}`,
      "IMAGES, in the order attached:",
      ...batch.map((a, n) => `${n + 1}. id ${a.id} · ${a.source === "upload" ? "uploaded by the owner" : `from ${a.source_url ?? a.source}`}${a.label ? ` · "${a.label}"` : ""}`),
    ].join("\n");
    const answer = await ask(model, text, batch.map((a) => a.url), { system: SORT_SYSTEM, schema: SORT_SCHEMA, name: "product_images", detail: "low" }, startedAt);
    if (answer === "image_error") continue;
    for (const item of (Array.isArray(answer.items) ? answer.items : []) as Record<string, any>[]) {
      const asset = batch.find((a) => a.id === item.id);
      if (!asset) continue;
      const kind = ASSET_KINDS.includes(item.kind) ? item.kind : "other";
      await db.from("product_assets").update({
        ...(asset.kind_locked ? {} : { kind }),
        ...(asset.source === "upload" && asset.label ? {} : { label: String(item.label ?? "").slice(0, 120) || null }),
        description: String(item.description ?? "").slice(0, 300) || null,
        group_name: typeof item.group_name === "string" && item.group_name.trim() ? item.group_name.trim().slice(0, 80) : null,
        good_for: (Array.isArray(item.good_for) ? item.good_for : []).map((t: unknown) => String(t).slice(0, 40)).filter(Boolean).slice(0, 5),
        hidden: item.keep === false && asset.source !== "upload",
        sorted_at: new Date().toISOString(),
      }).eq("id", asset.id);
      sorted++;
    }
  }
  return sorted;
}

/**
 * The `images` route: reads the product's links again only for their pictures (no new profile) and
 * saves and sorts the new ones, in the background; progress shows as an insight run.
 */
async function imagesRoute(user: string, productId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) throw new HttpError(404, "This product doesn't exist.");
  const { data: product } = await db.from("products")
    .select("id, user_id, name, kind, description, website, links, audience, price_tier, sales_channel, region, answers, known_competitors, brand_kit, insight_status, insight_started_at, insight")
    .eq("id", productId).eq("user_id", user).maybeSingle<ProductRow & { insight: { summary?: string; category?: string } | null }>();
  if (!product) throw new HttpError(404, "This product doesn't exist.");
  const links = linksOf(product, MAX_LINKS);
  if (!links.length) throw new UserError("Add your website or App Store link first, then your images can be found.");
  if (product.insight_status === "running" && product.insight_started_at && Date.now() - Date.parse(product.insight_started_at) < STALE_MS) return { status: "running", alreadyRunning: true };
  const before = product.insight_status;
  await db.from("products").update({ insight_status: "running", insight_message: "Finding images on your site…", insight_started_at: new Date().toISOString() }).eq("id", product.id);
  EdgeRuntime.waitUntil((async () => {
    const startedAt = Date.now();
    let message: string;
    try {
      const { pages, app } = await crawl(product, links);
      await progress(product.id, "Saving your product's images…");
      const saved = await collectAssets(product, pages, app);
      if (saved && await openAiKey()) {
        await progress(product.id, `Sorting ${saved} new image${saved === 1 ? "" : "s"}…`);
        await sortAssets(product.id, { name: product.name, summary: product.insight?.summary, category: product.insight?.category }, await readerModel(), false, startedAt);
      }
      message = saved ? `Found ${saved} new image${saved === 1 ? "" : "s"} on your site.` : "No new images found on your site.";
    } catch (error) {
      message = error instanceof UserError ? error.message : `Couldn't finish finding images: ${errorText(error)}`;
    }
    await db.from("products").update({ insight_status: before === "running" ? null : before, insight_message: message }).eq("id", product.id);
  })());
  return { status: "running" };
}

/**
 * The `reviews` route: fetches the App Store reviews again (no new profile, no OpenAI) into the
 * profile's `appStore.reviews`. Needs an App Store link and a profile to keep them in.
 */
async function reviewsRoute(user: string, productId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) throw new HttpError(404, "This product doesn't exist.");
  const { data: product } = await db.from("products").select("id, website, links, brand_kit, insight").eq("id", productId).eq("user_id", user)
    .maybeSingle<Pick<ProductRow, "id" | "website" | "links" | "brand_kit"> & { insight: Record<string, any> | null }>();
  if (!product) throw new HttpError(404, "This product doesn't exist.");
  const link = product.insight?.appStore?.url ?? linksOf(product, MAX_LINKS).find((l) => linkKind(l) === "app_store");
  if (!link || !appStoreId(link)) throw new UserError("Add your App Store link first, then its reviews can be read.");
  if (!product.insight) throw new UserError("Read your links with the AI first (Product page): the reviews are kept with that profile.");
  const { reviews, source } = await appStoreReviews(link);
  const appStore = {
    url: link, name: "", seller: "", sellerUrl: null, genre: "", rating: null, ratingCount: null, price: "", iconUrl: null, screenshots: [],
    ...(product.insight.appStore ?? {}),
    reviews, reviewsAt: new Date().toISOString(), ...(source ? { reviewsSource: source } : {}),
  };
  const { error } = await db.from("products").update({ insight: { ...product.insight, appStore } }).eq("id", product.id);
  if (error) throw new Error(error.message);
  return { reviews: reviews.length, source };
}

/** The `sort` route: the owner asks the AI to sort their product's images (new ones, or all). */
async function sortRoute(user: string, productId: string, all: boolean) {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) throw new HttpError(404, "This product doesn't exist.");
  const { data: product } = await db.from("products").select("id, name, insight").eq("id", productId).eq("user_id", user).maybeSingle<{ id: string; name: string; insight: { summary?: string; category?: string } | null }>();
  if (!product) throw new HttpError(404, "This product doesn't exist.");
  if (!(await openAiKey())) throw new UserError(`Sorting needs an OpenAI key. ${addKeyMessage("OPENAI_API_KEY")}`);
  const model = await readerModel();
  const sorted = await sortAssets(product.id, { name: product.name, summary: product.insight?.summary, category: product.insight?.category }, model, all);
  return { sorted };
}

/** One OpenAI call in the strict shape. "image_error" when an attached image couldn't be downloaded. */
interface AskShape { system: string; schema: unknown; name: string; detail?: "low" | "auto" }
const INSIGHT_SHAPE: AskShape = { system: INSIGHT_SYSTEM, schema: INSIGHT_SCHEMA, name: "product_insight" };

async function ask(model: string, text: string, images: string[], shape: AskShape = INSIGHT_SHAPE, startedAt = Date.now()): Promise<Record<string, any> | "image_error"> {
  const key = await openAiKey();
  if (!key) throw new UserError(`The AI reader needs an OpenAI key. ${addKeyMessage("OPENAI_API_KEY")}`);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, reasoning: { effort: "medium" },
      input: [
        { role: "system", content: shape.system },
        { role: "user", content: [{ type: "input_text", text }, ...images.map((url) => ({ type: "input_image", image_url: url, ...(shape.detail ? { detail: shape.detail } : {}) }))] },
      ],
      text: { format: { type: "json_schema", name: shape.name, strict: true, schema: shape.schema } },
    }),
    signal: AbortSignal.timeout(await askBudget(startedAt)),
  }).catch(() => null);
  if (!response) throw new UserError("OpenAI didn't answer in time. Try again in a moment.");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(data?.error?.message ?? `error ${response.status}`);
    if (images.length && /download|image_url|invalid image|unsupported image|image/i.test(message)) return "image_error";
    throw new UserError(`OpenAI: ${message.slice(0, 300)}`);
  }
  const parts = (data?.output ?? []).flatMap((item: any) => item.content ?? []);
  const refusal = parts.find((part: any) => part.type === "refusal")?.refusal;
  if (refusal) throw new UserError(`OpenAI declined: ${String(refusal).slice(0, 200)}`);
  const out = data?.output_text ?? parts.find((part: any) => part.type === "output_text")?.text;
  try { return JSON.parse(out); } catch { throw new UserError("OpenAI's answer wasn't readable. Try again."); }
}
