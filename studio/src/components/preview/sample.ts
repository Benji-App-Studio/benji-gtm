// Sample data for the development preview (/preview), and a stand-in for the API that answers from it
// in the browser. Nothing here is real: no project, no keys, no people.
import { EMPTY_BRAND_SYSTEM } from "@/lib/brand-system";
import { KEY_CATALOG } from "@/lib/install/key-catalog";
import type { InstallMember, InstallState, KeyState } from "@/lib/install/types";
import { applySampleKeys, creativeAnswer, sampleConnections, sampleKeys } from "./sample-creative";

export const APP_A = "11111111-1111-4111-8111-111111111111";
export const APP_B = "22222222-2222-4222-8222-222222222222";

const DEFAULT_MODELS = { text: "text-model-large", vision: "vision-model", transcribe: "speech-to-text", image: "image-model" };
const now = () => new Date().toISOString();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export function installSampleApi(role: string, fail: boolean) {
  const flags = window as unknown as { __sampleApi?: boolean };
  if (flags.__sampleApi) return;
  flags.__sampleApi = true;
  const owned = role !== "legacy";
  // ?keys=all|none sets every key or none (default: a mix, with the AI's key missing); ?apps=0 an install with no app;
  // ?ads=0 an app with no ads; ?bare=1 an app with nothing set up.
  const query = new URLSearchParams(location.search);
  const key = (set: boolean, extra: Partial<KeyState> = {}): KeyState => ({ set, last4: set ? "1a2b" : null, verifiedAt: set ? "2026-11-03T09:00:00Z" : null, status: set ? "ok" : "unverified", message: null, source: set ? "vault" : null, ...extra });
  const keys: Record<string, KeyState> = Object.fromEntries(KEY_CATALOG.map((spec) => [spec.name, key(false)]));
  if (owned) {
    keys.APIFY_TOKEN = key(true);
    keys.HIGGSFIELD_API_KEY = key(true, { status: "failed", message: "the service answered 401: this key was revoked", last4: "9f3c" });
    keys.META_APP_SECRET = key(true, { status: "unverified", verifiedAt: null, last4: "77aa" });
    keys.REVENUECAT_API_KEY = key(true, { source: "env", last4: null, verifiedAt: null });
  } else {
    for (const name of ["OPENAI_API_KEY", "APIFY_TOKEN"]) keys[name] = key(true, { source: "env", last4: null, verifiedAt: null });
  }
  if (query.get("keys") === "all") for (const name of Object.keys(keys)) keys[name] = key(true);
  if (query.get("keys") === "none") for (const name of Object.keys(keys)) keys[name] = key(false);
  const bare = query.get("bare") === "1";
  // A stand-in project address (one that can never resolve) for pages that read it or open a channel to it.
  const globals = window as unknown as { __INSTALL__?: unknown };
  globals.__INSTALL__ ??= { url: "https://preview.invalid", key: "sample", origin: null, imageTransforms: false };
  // The creative and ads pages pick their own key set with ?keys=none|some|all (sample-creative.ts).
  const creative = new URLSearchParams(location.search).has("keys");
  if (creative) applySampleKeys(keys, key, sampleKeys());
  const install: InstallState = {
    role: owned ? (role === "member" ? "member" : "owner") : "legacy", owned, name: owned ? "Northfield Growth" : null,
    aiProvider: "openai", models: { ...DEFAULT_MODELS }, limits: { wallClockSec: 150, uploadLimitMb: 50, storageQuotaGb: 1 }, keys,
  };
  let members: InstallMember[] = [
    { userId: "u1", email: "sam@northfield.example", role: "owner", createdAt: "2026-09-12T10:00:00Z" },
    { userId: "u2", email: "priya@northfield.example", role: "member", createdAt: "2026-10-02T10:00:00Z" },
  ];
  const product = (id: string, name: string, is_primary: boolean, kind: string, description: string, website: string) => ({
    id, name, is_primary, kind, description: bare ? "" : description, website, links: [], stage: "launched", audience: "Weekend hikers", price_tier: "mid", sales_channel: "online", region: "Worldwide",
    socials: {}, answers: {}, known_competitors: bare ? [] : ["Peakfinder", "Summit Snacks"], keywords: ["trail snacks", "hiking food"], category: "food", category_label: "Food & drink",
    platform_scores: { instagram: 3, tiktok: 3, youtube: 2, x: 1, linkedin: 0 }, insight: null, insight_status: null, insight_message: null, insight_at: null, insight_applied_at: null, created_at: "2026-09-12T10:00:00Z",
  });
  let products = query.get("apps") === "0" ? [] : [
    product(APP_A, "Trailmix", true, "food_beverage", "Trail snacks for weekend hikers, sold online and in outdoor shops.", "https://trailmix.example"),
    product(APP_B, "Pocket Garden", false, "mobile_app", "A plant-care app that reminds you when to water.", "https://pocketgarden.example"),
  ];
  const projects = [
    { id: "p1", type: "competitors", name: "Hiking apps, autumn", description: "", status: "review", message: null, demo: false, platforms: ["instagram", "tiktok"], sinceDays: 30, competitors: 6, runs: 1, lastRunAt: now(), posts: 240, createdAt: now() },
    { id: "p2", type: "account", name: "@peakfinder", description: "", status: "analyzing", message: null, demo: false, platforms: ["instagram"], sinceDays: 60, competitors: 1, runs: 1, lastRunAt: now(), posts: 80, createdAt: now() },
    { id: "p3", type: "campaign", name: "Spring creator push", description: "", status: "ready", message: null, demo: false, platforms: ["tiktok"], sinceDays: 30, competitors: 0, runs: 2, lastRunAt: now(), posts: 52, createdAt: now() },
  ];
  const connections: Record<string, Record<string, Record<string, string>>> = { [APP_A]: creative ? sampleConnections(sampleKeys()) : { meta: { adAccountId: "act_1234567890" } }, [APP_B]: {} };
  const workspace = (id: string) => {
    const set = connections[id] ?? {};
    const status = Object.fromEntries(["meta", "revenuecat", "appstack", "storage"].map((k) => [k, Object.keys(set[k] ?? {}).length ? { state: "verified", message: "The ad account answered.", checkedAt: "2026-11-10T08:00:00Z" } : { state: "not_set" }]));
    const name = products.find((p) => p.id === id)?.name ?? "App";
    const brandKit = bare || id === APP_B ? { appName: name, colors: [], screenshotUrls: [] } : { appName: name, colors: ["#2F6B3A", "#F4EFE6"], screenshotUrls: [], tone: "Plain and warm", tagline: "Snacks that go the distance" };
    return { id, name, isPrimary: id === APP_A, connections: set, brandKit, status };
  };

  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
    const path = url.pathname;
    if (url.origin !== location.origin || !path.startsWith("/api/")) return real(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    await new Promise((resolve) => setTimeout(resolve, 350));
    const keyMatch = path.match(/^\/api\/install\/keys\/([^/]+)(\/verify)?$/);
    if (path === "/api/install") return fail ? new Response("<html>Bad gateway</html>", { status: 502 }) : json(install);
    if (path.startsWith("/api/install") && install.role !== "owner") return json({ error: "Only the owner can change this." }, 403);
    if (keyMatch) {
      const name = decodeURIComponent(keyMatch[1]);
      if (method === "DELETE") { keys[name] = key(false); return json({ ok: true }); }
      if (keyMatch[2]) { keys[name] = { ...keys[name], status: "ok", message: null, verifiedAt: now() }; return json({ key: keys[name] }); }
      const value = String(body.value ?? "");
      if (value.includes("bad")) return json({ error: "The service refused this key (401: incorrect API key). Check that you copied all of it." }, 400);
      keys[name] = key(true, { last4: value.slice(-4), verifiedAt: now() });
      return json({ key: keys[name] });
    }
    if (path === "/api/install/runner-secret") {
      keys.CREATIVES_RUNNER_SECRET = key(true, { last4: "9a2b", verifiedAt: now() });
      return json({ secret: "sample-9f3c7a1e5b2d4c6e8a0f1b3d5c7e9a2b", key: keys.CREATIVES_RUNNER_SECRET });
    }
    if (path === "/api/install/settings") {
      if (typeof body.name === "string") install.name = body.name;
      if (body.aiProvider === "openai" || body.aiProvider === "typesafe") install.aiProvider = body.aiProvider;
      if (body.models === null) install.models = { ...DEFAULT_MODELS };
      else if (body.models) install.models = { ...install.models, ...(body.models as typeof DEFAULT_MODELS) };
      return json({ ...install });
    }
    if (path === "/api/install/members" && method === "GET") return json({ members });
    if (path === "/api/install/members") {
      const member: InstallMember = { userId: `u${Date.now()}`, email: String(body.email), role: "member", createdAt: now() };
      members = [...members, member];
      return json({ member, inviteLink: `${location.origin}/auth/confirm?token_hash=sample-not-real&type=invite` });
    }
    if (path.startsWith("/api/install/members/")) { members = members.filter((m) => m.userId !== decodeURIComponent(path.split("/").pop()!)); return json({ ok: true }); }
    if (path === "/api/products") return json(products);
    if (path.startsWith("/api/products/") && method === "DELETE") {
      const id = path.split("/").pop()!;
      if (products.find((p) => p.id === id)?.is_primary) return json({ error: "Your main product can't be deleted; edit it instead." }, 400);
      products = products.filter((p) => p.id !== id);
      return json({ deleted: true });
    }
    if (path === "/api/projects") return json(query.get("analyses") === "0" ? [] : projects);
    const counts = path.match(/^\/api\/workspaces\/([^/]+)\/counts$/);
    if (counts) return json({ counts: { watchlist: bare ? 0 : 2, paidAds: bare || query.get("ads") === "0" ? 0 : sampleAds(APP_A).length, formatCards: 0, creatives: 0, approvedCreatives: 0, metaAds: 0 } });
    if (path.startsWith("/api/studio/")) return json({ creatives: [], batches: [], jobs: [] });
    const research = path.match(/^\/api\/research\/([^/]+)$/);
    if (research && method === "GET") {
      const id = research[1], none = bare || query.get("ads") === "0";
      return json({
        workspace: { id, name: products.find((p) => p.id === id)?.name ?? "App" }, ads: none ? [] : sampleAds(id), adsNext: null, adsTotal: none ? 0 : 5,
        watchlist: bare ? [] : sampleWatch(id), pulls: [], localRuns: [], lastImports: none ? {} : { "1001": now() }, suggestions: [],
        health: { metaApi: Boolean(keys.META_AD_LIBRARY_TOKEN?.set), apify: Boolean(keys.APIFY_TOKEN?.set), jev: true, tiktok: "off", tiktokLibrary: false }, mediaStatus: null, assets: [], avatars: [],
        brand: { appName: "Trailmix", tagline: null, colors: [], iconUrl: null, screenshots: 0, tone: null, forbiddenClaims: [], appStoreUrl: null },
      });
    }
    if (research) return json({ pending: 0, running: false, free: 0, paid: 0, paidAds: 0, usd: 0, notes: ["The preview doesn't collect ads."] });
    const brand = path.match(/^\/api\/products\/([^/]+)\/brand$/);
    if (brand) {
      const name = products.find((p) => p.id === brand[1])?.name ?? "App";
      return json({ name, appName: name, stored: false, hasProfile: false, suggestions: [], draft: { basics: { appName: name, tagline: "", iconUrl: "", appStoreUrl: "", screenshotUrls: [] }, system: EMPTY_BRAND_SYSTEM } });
    }
    if (/^\/api\/products\/[^/]+\/assets$/.test(path)) return json([]);
    const one = path.match(/^\/api\/products\/([^/]+)$/);
    if (one && method === "GET") return json(products.find((p) => p.id === one[1]) ?? { error: "No such app." }, products.some((p) => p.id === one[1]) ? 200 : 404);
    const analysis = path.match(/^\/api\/projects\/([^/]+)(\/log)?$/);
    if (analysis?.[2]) return json({ activity: [] });
    if (analysis && method === "GET") {
      const candidate = (id: string, name: string, selected: boolean) => ({ id, name, handles: { instagram: name.toLowerCase().replace(/\s+/g, "") }, bio: "Trail food for long days out.", followers: 48_000, verified: false, website: null, kind: "direct_competitor", kindConfidence: 0.9, similarity: 3.2, source: "search", foundBy: [], selected });
      return json({
        project: { id: analysis[1], type: "competitors", name: "Hiking apps, autumn", description: "Trail snacks for weekend hikers.", category: "food", answers: {}, keywords: ["trail snacks"], platforms: ["instagram", "tiktok"], sinceDays: 30, limitPerAccount: 20, status: "review", candidates: [candidate("c1", "Peakfinder", true), candidate("c2", "Summit Snacks", true), candidate("c3", "Ridge Bars", false)], createdAt: now(), updatedAt: now() },
        runs: [], estimate: { posts: 80, usd: 1.2, competitors: 2 },
      });
    }
    if (path === "/api/workspaces") return json([]);
    const ws = path.match(/^\/api\/workspaces\/([^/]+)(\/verify)?$/);
    if (ws) {
      if (method === "PATCH") connections[ws[1]] = { ...connections[ws[1]], ...(body.connections as Record<string, Record<string, string>>) };
      if (ws[2]) return json({ result: { ok: true } });
      return json(workspace(ws[1]));
    }
    const mine = creativeAnswer(path, url, method, Object.fromEntries(products.map((p) => [p.id, p.name])));
    if (mine) return mine;
    return json({ error: "The preview has no answer for this request." }, 404);
  };
}

// MARK: Sample research data

const picture = (label: string, fill: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="${fill}"/><text x="200" y="255" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#ffffff">${label}</text></svg>`)}`;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function sampleWatch(productId: string) {
  const row = (id: string, name: string, page: string) => ({ id, product_id: productId, name, network: "meta", page_id: page, page_url: null, search_terms: null, tiktok_advertiser_id: null, countries: ["US"], candidate_id: null, enabled: true, created_at: daysAgo(40), source: "research" });
  return [row("w1", "Peakfinder", "1001"), row("w2", "Summit Snacks", "1002")];
}

function sampleAds(productId: string) {
  const ad = (n: number, watch: string, page: string, name: string, days: number, headline: string, body: string, media_type: string, read: boolean, active = true) => ({
    id: `ad${n}`, product_id: productId, watch_id: watch, is_own: false, library: null, network: "meta", source: "meta_local", ad_id: `90${n}`, page_id: page, page_name: name, competitor: name,
    started_at: daysAgo(days), stopped_at: active ? null : daysAgo(2), active, placements: ["facebook", "instagram"], media_type, is_video: media_type === "video", body, headline, description: "", cta: "Shop now", link_url: "example.com",
    media: [{ type: "image", url: picture(name, n % 2 ? "#3d6b52" : "#5a5f8a") }], thumb: picture(name, n % 2 ? "#3d6b52" : "#5a5f8a"), snapshot_url: null, countries: ["US"], variants: n === 1 ? 4 : 1, impressions_rank: n,
    creative: null, creative_key: `k${n}`, metrics: null,
    decoded: read ? { format: "static_benefit", formatConfidence: 0.8, hookType: "bold_claim", roles: [{ text: headline, role: "hook", confidence: 0.9 }, { text: body, role: "benefit", confidence: 0.8 }], mentionsProduct: null, source: "copy" } : null,
    decoded_at: read ? daysAgo(1) : null, sent_to_library_at: null, scan: null, scanned_at: null, creative_changed_at: null, first_seen_at: daysAgo(Math.min(days, 30)), last_seen_at: daysAgo(0),
  });
  return [
    ad(1, "w1", "1001", "Peakfinder", 64, "Fuel that fits a pocket", "Three ingredients. Zero crumbs. Made for the last mile.", "image", true),
    ad(2, "w1", "1001", "Peakfinder", 31, "The bar hikers reorder", "Rated 4.8 by 12,000 hikers. Free shipping on your first box.", "image", true),
    ad(3, "w1", "1001", "Peakfinder", 5, "New: maple pecan", "A limited batch for the autumn trails.", "video", false),
    ad(4, "w2", "1002", "Summit Snacks", 45, "Stop packing sad snacks", "Real fruit, real nuts, nothing you can't pronounce.", "carousel", false),
    ad(5, "w2", "1002", "Summit Snacks", 12, "Your pack called", "It wants better snacks. 20% off the starter box.", "image", false, false),
  ];
}
