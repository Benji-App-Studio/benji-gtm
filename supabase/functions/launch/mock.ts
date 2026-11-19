// A fake Marketing API for tests and for trying Launch without touching a real account
// (LAUNCH_META_MOCK=1). It answers the calls Launch makes with responses shaped like Meta's,
// keeps what was "created" in memory, and records every call.
//
// For the "Send to Meta" sheet it also answers the read edges (campaigns, ad sets, Pages, Instagram
// accounts, pixels, custom conversions, audiences, targeting search, delivery estimate, previews)
// from a few fixtures, seeded into the first ad account it's asked about (`seed: false` skips them).
import { GRAPH_HOST, GRAPH_VERSION, type Fetch } from "./graph.ts";

export interface MockCall { method: string; path: string; params: Record<string, unknown> }

export interface MockOptions {
  /** How many status polls a video stays "processing" before it's ready. */
  videoPolls?: number;
  /** Paths (regex) that answer with a Meta error once, for retry tests. */
  failOnce?: { match: RegExp; code: number; status?: number; message?: string }[];
  account?: { currency?: string; funded?: boolean; name?: string };
  adSet?: { dailyBudget?: number; ads?: number; status?: string };
  /** Seed fixture campaigns and ad sets into the first ad account asked about (default true). */
  seed?: boolean;
}

export const MOCK_INTERESTS = [
  { id: "6003107902433", name: "Travel", path: ["Interests", "Hobbies and activities", "Travel"], audience_size_lower_bound: 1_200_000_000 },
  { id: "6003392552125", name: "Backpacking", path: ["Interests", "Hobbies and activities", "Travel", "Backpacking"], audience_size_lower_bound: 98_000_000 },
  { id: "6003249340651", name: "Digital nomad", path: ["Interests", "Business and industry", "Digital nomad"], audience_size_lower_bound: 21_000_000 },
  { id: "6003020834693", name: "Expatriate", path: ["Interests", "Family and relationships", "Expatriate"], audience_size_lower_bound: 54_000_000 },
  { id: "6003167425934", name: "Travel visa", path: ["Interests", "Travel", "Travel visa"], audience_size_lower_bound: 8_400_000 },
];
const MOCK_PLACES = [
  { key: "US", name: "United States", type: "country", country_code: "US", country_name: "United States" },
  { key: "GB", name: "United Kingdom", type: "country", country_code: "GB", country_name: "United Kingdom" },
  { key: "DE", name: "Germany", type: "country", country_code: "DE", country_name: "Germany" },
  { key: "IN", name: "India", type: "country", country_code: "IN", country_name: "India" },
  { key: "3847", name: "California", type: "region", country_code: "US", country_name: "United States" },
  { key: "2490299", name: "London", type: "city", region: "England", country_code: "GB", country_name: "United Kingdom" },
  { key: "2420379", name: "Berlin", type: "city", region: "Berlin", country_code: "DE", country_name: "Germany" },
];
const MOCK_LOCALES = [{ key: 6, name: "English (US)" }, { key: 24, name: "English (UK)" }, { key: 23, name: "Spanish" }, { key: 5, name: "German" }];

export interface MockMeta { fetch: Fetch; calls: MockCall[]; objects: Map<string, Record<string, unknown>> }

export function mockMeta(options: MockOptions = {}): MockMeta {
  const calls: MockCall[] = [];
  const objects = new Map<string, Record<string, unknown>>();
  const polls = new Map<string, number>();
  const failures = [...(options.failOnce ?? [])];
  let next = 120_000_000_000_000;
  const id = () => String(next++);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  let seeded = options.seed === false;

  /** A few campaigns and ad sets in the first ad account asked about. */
  const seed = (account: string) => {
    if (seeded) return;
    seeded = true;
    const put = (o: string, v: Record<string, unknown>) => objects.set(o, { account_id: account, ...v });
    put("238000000000001", { kind: "campaign", name: "BW | TEST | campaign | app-promotion | 2026-09-28", objective: "OUTCOME_APP_PROMOTION", status: "PAUSED", buying_type: "AUCTION", special_ad_categories: [] });
    put("238000000000011", { kind: "adset", campaign_id: "238000000000001", name: "BW | TEST | adset | us-gb-broad | 2026-09-28", status: "PAUSED", optimization_goal: "APP_INSTALLS", billing_event: "IMPRESSIONS", daily_budget: 250000, bid_strategy: "LOWEST_COST_WITHOUT_CAP", promoted_object: { application_id: "999000111", object_store_url: "https://apps.apple.com/app/id1000000003" }, targeting: { geo_locations: { countries: ["US", "GB"] }, age_min: 18, age_max: 65, targeting_automation: { advantage_audience: 1 }, user_os: ["iOS"] } });
    put("238000000000002", { kind: "campaign", name: "BW | SCALE | campaign | app-promotion | 2026-09-28", objective: "OUTCOME_APP_PROMOTION", status: "ACTIVE", buying_type: "AUCTION", daily_budget: 800000, bid_strategy: "LOWEST_COST_WITHOUT_CAP", special_ad_categories: [] });
    put("238000000000021", { kind: "adset", campaign_id: "238000000000002", name: "BW | SCALE | adset | us-broad | 2026-09-28", status: "ACTIVE", optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS", promoted_object: { application_id: "999000111", object_store_url: "https://apps.apple.com/app/id1000000003", custom_event_type: "START_TRIAL" }, targeting: { geo_locations: { countries: ["US"] }, age_min: 18, age_max: 65, targeting_automation: { advantage_audience: 1 }, user_os: ["iOS"] } });
    put("238000000000003", { kind: "campaign", name: "Website traffic (made in Ads Manager)", objective: "OUTCOME_TRAFFIC", status: "PAUSED", buying_type: "AUCTION", special_ad_categories: [] });
    put("238000000000031", { kind: "adset", campaign_id: "238000000000003", name: "Website visitors · EU", status: "PAUSED", optimization_goal: "LINK_CLICKS", billing_event: "IMPRESSIONS", destination_type: "WEBSITE", daily_budget: 150000, bid_strategy: "LOWEST_COST_WITHOUT_CAP", targeting: { geo_locations: { countries: ["DE", "FR"] }, age_min: 18, age_max: 65 } });
  };

  /** A page of objects, 50 at a time, with Meta's cursor paging. */
  const page = (rows: Record<string, unknown>[], params: Record<string, unknown>) => {
    const limit = Math.max(1, Math.min(100, Number(params.limit ?? 25)));
    const start = params.after ? Number(atob(String(params.after))) : 0;
    const slice = rows.slice(start, start + limit);
    const more = start + limit < rows.length;
    return json({ data: slice, paging: { cursors: { before: btoa(String(start)), after: btoa(String(start + limit)) }, ...(more ? { next: "https://graph.facebook.com/mock-next" } : {}) } });
  };
  const withAds = (o: string, v: Record<string, unknown>) => ({
    id: o, ...v, effective_status: v.status ?? "PAUSED",
    ads: { data: [], summary: { total_count: [...objects.values()].filter((x) => x.kind === "ad" && x.adset_id === o).length } },
  });

  const transport: Fetch = async (input, init) => {
    const url = new URL(input);
    const prefix = `/${GRAPH_VERSION}/`;
    if (url.origin !== GRAPH_HOST || !url.pathname.startsWith(prefix)) return json({ error: { message: "Unknown host", code: 1 } }, 400);
    const path = url.pathname.slice(prefix.length);
    const method = init?.method ?? "GET";
    const params: Record<string, unknown> = {};
    const source = method === "GET" ? url.searchParams : new URLSearchParams(String(init?.body ?? ""));
    for (const [k, v] of source) {
      // Graph takes objects and arrays as JSON; everything else stays a string (ids too).
      if (/^[[{]/.test(v)) { try { params[k] = JSON.parse(v); continue; } catch { /* plain */ } }
      params[k] = v;
    }
    calls.push({ method, path, params });

    const failure = failures.findIndex((f) => f.match.test(path));
    if (failure >= 0) {
      const f = failures.splice(failure, 1)[0];
      return json({ error: { message: f.message ?? "Please reduce the amount of data you're asking for, then retry your request", code: f.code, fbtrace_id: "MOCK" } }, f.status ?? 400);
    }

    const account = path.match(/^act_(\d+)/)?.[1];
    if (account) seed(account);

    if (method === "GET") {
      if (path === "me") return json({ id: "1000000000001", name: "Launch system user (mock)" });
      let r: RegExpMatchArray | null;
      if ((r = path.match(/^act_(\d+)\/campaigns$/))) {
        const rows = [...objects.entries()].filter(([, o]) => o.kind === "campaign" && o.account_id === r![1]).reverse().map(([o, v]) => ({ id: o, ...v, effective_status: v.status ?? "PAUSED" }));
        return page(rows, params);
      }
      if ((r = path.match(/^(\d+)\/adsets$/))) {
        const rows = [...objects.entries()].filter(([, o]) => o.kind === "adset" && o.campaign_id === r![1]).map(([o, v]) => withAds(o, v));
        return page(rows, params);
      }
      if (/^act_\d+\/promote_pages$/.test(path)) return page([{ id: "1000000000000002", name: "Acme", instagram_business_account: { id: "17841400000000001", username: "acme.app" } }], params);
      if (/^act_\d+\/instagram_accounts$/.test(path)) return page([{ id: "17841400000000002", username: "acme.team" }], params);
      if (/^act_\d+\/adspixels$/.test(path)) return page([{ id: "880000000000001", name: "Acme web pixel", last_fired_time: "2026-10-04T09:00:00+0000" }], params);
      if (/^act_\d+\/customconversions$/.test(path)) return page([{ id: "990000000000001", name: "Trial started (web)", custom_event_type: "START_TRIAL", pixel: { id: "880000000000001" } }], params);
      if (/^act_\d+\/customaudiences$/.test(path)) {
        return page([
          { id: "23850000000000001", name: "Website visitors 30d", subtype: "WEBSITE", approximate_count_lower_bound: 12000, approximate_count_upper_bound: 14000 },
          { id: "23850000000000002", name: "Lookalike (US, 1%) of trial starters", subtype: "LOOKALIKE", approximate_count_lower_bound: 2_100_000, approximate_count_upper_bound: 2_500_000, lookalike_spec: { ratio: 0.01, country: "US" } },
        ], params);
      }
      if (/^act_\d+\/delivery_estimate$/.test(path)) return json({ data: [{ estimate_mau_lower_bound: 41_000_000, estimate_mau_upper_bound: 48_200_000, estimate_ready: true }] });
      if (path === "search") {
        const q = String(params.q ?? "").toLowerCase();
        if (params.type === "adinterest") return json({ data: MOCK_INTERESTS.filter((i) => i.name.toLowerCase().includes(q) || i.path.join(" ").toLowerCase().includes(q)) });
        if (params.type === "adgeolocation") return json({ data: MOCK_PLACES.filter((p) => p.name.toLowerCase().includes(q) || p.key.toLowerCase() === q) });
        if (params.type === "adlocale") return json({ data: MOCK_LOCALES.filter((l) => l.name.toLowerCase().includes(q)) });
        if (params.type === "adinterestvalid") {
          const ids = (params.interest_fbid_list as string[] | undefined) ?? [];
          return json({ data: ids.map((i) => ({ id: i, name: MOCK_INTERESTS.find((m) => m.id === i)?.name ?? "", valid: MOCK_INTERESTS.some((m) => m.id === i) })) });
        }
        return json({ error: { message: `Mock doesn't know search type ${params.type}`, code: 100 } }, 400);
      }
      if ((r = path.match(/^(\d+)\/previews$/))) {
        if (!objects.get(r[1])) return json({ error: { message: "Ad not found", code: 100 } }, 400);
        return json({ data: [{ body: `<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=MOCK${r[1]}&amp;t=${params.ad_format}" width="540" height="690" scrolling="yes" style="border: none;"></iframe>` }] });
      }
      if (/^act_\d+$/.test(path)) {
        return json({
          id: path, name: options.account?.name ?? "Mock ad account", currency: options.account?.currency ?? "INR",
          account_status: 1, timezone_name: "Asia/Kolkata", ...(options.account?.funded === false ? {} : { funding_source: "6000000000001" }),
        });
      }
      let obj = objects.get(path);
      // A video uploaded in another isolate (LAUNCH_META_MOCK across worker hand-offs): call it ready.
      if (!obj && /^\d+$/.test(path) && String(params.fields ?? "").startsWith("status")) {
        obj = { kind: "video" };
        objects.set(path, obj);
        polls.set(path, options.videoPolls ?? 2);
      }
      if (!obj) return json({ error: { message: `Unsupported get request. Object with ID '${path}' does not exist`, code: 100, error_subcode: 33 } }, 400);
      if (obj.kind === "video") {
        const n = (polls.get(path) ?? 0) + 1;
        polls.set(path, n);
        const ready = n > (options.videoPolls ?? 2);
        return json({
          id: path,
          status: { video_status: ready ? "ready" : "processing", processing_progress: ready ? 100 : Math.min(95, n * 30) },
          ...(ready ? { thumbnails: { data: [{ uri: `https://scontent.mock/v/${path}.jpg`, is_preferred: true }] } } : {}),
        });
      }
      if (obj.kind === "adset" && obj.optimization_goal) return json(withAds(path, obj));
      if (obj.kind === "campaign") return json({ id: path, ...obj, effective_status: obj.status ?? "PAUSED" });
      if (obj.kind === "adset") {
        const ads = [...objects.values()].filter((o) => o.kind === "ad" && o.adset_id === path).length;
        return json({
          id: path, name: obj.name, status: obj.status ?? options.adSet?.status ?? "PAUSED", effective_status: obj.status ?? "PAUSED",
          daily_budget: String(obj.daily_budget ?? options.adSet?.dailyBudget ?? 50000), campaign_id: obj.campaign_id ?? "1",
          ads: { data: [], summary: { total_count: (options.adSet?.ads ?? 0) + ads } },
        });
      }
      return json({ id: path, ...obj });
    }

    // POST
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^(act_\d+)\/adimages$/))) {
      const hash = crypto.randomUUID().replace(/-/g, "");
      return json({ images: { [String(params.name ?? "image")]: { hash, url: `https://scontent.mock/i/${hash}.jpg` } } });
    }
    if ((m = path.match(/^(act_\d+)\/advideos$/))) {
      const v = id();
      objects.set(v, { kind: "video", name: params.name, file_url: params.file_url });
      return json({ id: v });
    }
    if ((m = path.match(/^(act_\d+)\/(adcreatives|ads|campaigns|adsets)$/))) {
      const o = id();
      const kind = { adcreatives: "creative", ads: "ad", campaigns: "campaign", adsets: "adset" }[m[2]]!;
      objects.set(o, { kind, account_id: m[1].slice(4), ...params });
      return json({ id: o });
    }
    if ((m = path.match(/^(\d+)\/copies$/))) {
      const original = objects.get(m[1]);
      if (!original) return json({ error: { message: "Ad not found", code: 100 } }, 400);
      const copy = id();
      objects.set(copy, { ...original, adset_id: params.adset_id, status: params.status_option, copied_from: m[1] });
      return json({ copied_ad_id: copy, ad_object_ids: [{ ad_object_type: "ad", source_id: m[1], copied_id: copy }] });
    }
    if ((m = path.match(/^(\d+)$/))) {
      const o = objects.get(m[1]);
      if (!o) return json({ error: { message: "Object not found", code: 100 } }, 400);
      Object.assign(o, params);
      return json({ success: true });
    }
    return json({ error: { message: `Mock doesn't know POST ${path}`, code: 100 } }, 400);
  };

  return { fetch: transport, calls, objects };
}
