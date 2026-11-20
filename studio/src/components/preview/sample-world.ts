// The example app's one made-up world (/example, the development preview /preview and the landing page's
// pictures): Trailmix, an iPhone hike planner, its three fictional competitors, the ads it launched from
// the dashboard and what they brought in. Every page draws from the same numbers here, so Home, Research,
// Launch › Ads, Measure, App settings and the Make sheet agree with each other (sample-world.test.ts
// checks the totals across the pages' own computations).
//
// Every day's numbers are a function of the day's offset from today (0 = today, -1 = yesterday), never of
// the date, so a page opened tomorrow shows the same story shifted by a day. Nothing here is real.
import { m } from "@/lib/i18n/translate";

/** Text a page shows as data (a profile value, a store's category): the example passes its translator, the preview leaves English. */
export type Tx = (text: string) => string;
export const english: Tx = (text) => text;

/** The day `offset` days from today, as YYYY-MM-DD (UTC, like Meta's and RevenueCat's daily rows). */
export const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

// MARK: The app

export const WORLD = {
  name: "Trailmix",
  storeName: "Trailmix: Hike Planner",
  developer: "Trailmix Labs",
  storeId: "1000000009",
  appStoreUrl: "https://apps.apple.com/us/app/trailmix-hike-planner/id1000000009",
  website: "https://trailmix.example",
  /** The prefix of every name Launch gives a campaign, ad set or ad. */
  appCode: "TRAIL",
  colors: ["#2F6B3A", "#F4EFE6", "#E07A3F"],
  /** Bundled pictures (studio/public/example). */
  iconPath: "/example/trailmix-icon.svg",
  competitorAdPath: "/example/peakfinder-ad.svg",
  adAccountId: "act_1234567890",
  adAccountName: "Trailmix Ads",
  pageId: "100200300400",
  testing: { campaignId: "cmp_1", adSetId: "set_1", adSetName: "US broad", dailyBudget: 30, campaignName: () => `TRAIL | TEST | campaign | app-promotion | ${day(-40)}`, adSetLaunchName: () => `TRAIL | TEST | adset | us-broad | ${day(-40)}` },
  scaling: { campaignId: "cmp_2", adSetId: "set_2", adSetName: "US winners", dailyBudget: 40, campaignName: () => `TRAIL | SCALE | campaign | app-promotion | ${day(-9)}` },
  /** Launch's target cost per paying customer (Launch settings), below the LTV. */
  targetCac: 27,
  /** Trailmix Pro, with a 7-day free trial on the yearly plan. */
  plans: { yearly: 59.99, monthly: 9.99 },
  /** Each plan's price net of taxes (RevenueCat's new-subscription revenue) and after Apple's 15 % (proceeds). */
  net: { yearly: 54.54, monthly: 9.08 },
  proceeds: { yearly: 46.36, monthly: 7.72 },
  /** RevenueCat's realized LTV per paying customer, 7 and 30 days after the first purchase. */
  ltvDay7: 36.4,
  ltvDay30: 38.6,
} as const;

/** The app's own words, shown in the reader's language (pass them through the example's translator). */
export const WORLD_TEXT = {
  tagline: m("Plan a weekend hike in a minute."),
  description: m("A hike planner for weekend hikers: trails near you, the weather at the top and maps that work offline."),
  audience: m("Weekend hikers, 25 to 45"),
  region: m("United States"),
  category: m("Health & Fitness"),
  chart: m("Top free, Health & Fitness"),
  tone: m("Plain, warm and outdoorsy. Short sentences."),
  differentiator: m("Plans the whole day (trail, weather and drive) in one screen, and works with no signal."),
};

export interface Competitor { name: string; store: string; developer: string; pageId: string | null; fill: string; rating: number; ratings: number; rank: number | null; storeId: string; bio: string }

/** Fictional apps in the same category as Trailmix. */
export const COMPETITORS: Competitor[] = [
  { name: "Peakfinder", store: "Peakfinder: Trail Maps", developer: "Peakfinder Inc.", pageId: "1001", fill: "#3d6b52", rating: 4.7, ratings: 18_400, rank: 12, storeId: "1000000001", bio: "Trail maps for weekend hikers." },
  { name: "Ridgeline", store: "Ridgeline: Hiking GPS", developer: "Ridgeline Apps", pageId: "1002", fill: "#5a5f8a", rating: 4.4, ratings: 6_200, rank: 38, storeId: "1000000002", bio: "Offline GPS for long days out." },
  { name: "Summit Log", store: "Summit Log: Hike Tracker", developer: "Summit Log Co.", pageId: null, fill: "#8a5a3d", rating: 4.1, ratings: 1_150, rank: null, storeId: "1000000003", bio: "A diary for every summit." },
];

// MARK: The ads it launched

/** The Studio creatives behind the launched ads (and the two still waiting for review). */
export const CREATIVES = [
  { id: "c1", title: "Plan a hike in a minute", tint: "#dfe3ee", format: "green-screen", hook: "pain-point", batch: "b1", approved: true, aspect: "4:5" },
  { id: "c2", title: "Your weekend, sorted", tint: "#e6eadf", format: "static-benefit", hook: "curiosity", batch: "b1", approved: true, aspect: "4:5" },
  { id: "c3", title: "5 trails near you", tint: "#eee6df", format: "listicle", hook: "social-proof", batch: "b1", approved: true, aspect: "4:5" },
  { id: "c4", title: "Free trail maps", tint: "#e9e1ef", format: "ugly-ad", hook: "price", batch: null, approved: true, aspect: "4:5" },
  { id: "c5", title: "Trail in a tap", tint: "#e3ece9", format: "static-benefit", hook: "outcome", batch: "b1", approved: false, aspect: "4:5" },
  { id: "c6", title: "Post-style ad", tint: "#eee6df", format: "tweet", hook: "social-proof", batch: "b1", approved: false, aspect: "1:1" },
] as const;

export interface WorldAd {
  adId: string;
  stage: "TEST" | "SCALE";
  format: string;
  hook: string;
  /** Offset of the day the creative first ran (the date in Launch's name; a promoted copy keeps it). */
  named: number;
  /** First and last day with delivery (offsets); null: never delivered. */
  start: number | null;
  end: number | null;
  dailySpend: number;
  /** Paying customers per dollar (1 ÷ the CAC it settles at), as AppStack attributes them. */
  payRate: number;
  status: "ACTIVE" | "PAUSED" | "DISAPPROVED";
  creative: string;
  /** Offset of the day its Launch draft was made. */
  sent: number;
  promotedFrom?: string;
}

const T = WORLD.testing, S = WORLD.scaling;
export const ADS: WorldAd[] = [
  { adId: "120001", stage: "TEST", format: "green-screen", hook: "pain-point", named: -40, start: -40, end: 0, dailySpend: 14, payRate: 1 / 14, status: "ACTIVE", creative: "c1", sent: -40 },
  { adId: "120002", stage: "TEST", format: "static-benefit", hook: "curiosity", named: -40, start: -40, end: 0, dailySpend: 10, payRate: 1 / 31, status: "ACTIVE", creative: "c2", sent: -40 },
  { adId: "120003", stage: "TEST", format: "listicle", hook: "social-proof", named: -12, start: -12, end: 0, dailySpend: 6, payRate: 1 / 34, status: "ACTIVE", creative: "c3", sent: -12 },
  { adId: "120004", stage: "SCALE", format: "green-screen", hook: "pain-point", named: -40, start: -8, end: 0, dailySpend: 40, payRate: 1 / 18, status: "ACTIVE", creative: "c1", sent: -9, promotedFrom: "120001" },
  { adId: "120005", stage: "TEST", format: "ugly-ad", hook: "price", named: -12, start: null, end: null, dailySpend: 0, payRate: 0, status: "DISAPPROVED", creative: "c4", sent: -12 },
  { adId: "120006", stage: "TEST", format: "before-after", hook: "transformation", named: -60, start: -60, end: -29, dailySpend: 8, payRate: 0, status: "PAUSED", creative: "gone", sent: -60 },
];

export const adName = (ad: Pick<WorldAd, "stage" | "format" | "hook" | "named">) => `TRAIL | ${ad.stage} | ${ad.format} | ${ad.hook} | v01 | ${day(ad.named)}`;
export const adSetOf = (ad: WorldAd) => (ad.stage === "TEST" ? T : S);

/** One ad's day: Meta's delivery and pixel counts, and AppStack's attributed installs, trials and customers. */
export interface AdDay {
  spend: number; impressions: number; reach: number; clicks: number; linkClicks: number;
  meta: { installs: number; trials: number; purchases: number; value: number };
  appstack: { installs: number; trials: number; purchases: number; yearly: number; monthly: number; revenue: number };
}

/** The oldest day any page loads (Measure's 90 days and the 90 before them). */
const OLDEST = -179;
const series = new Map<string, Map<number, AdDay>>();

/**
 * Whole conversions out of fractional rates: each day adds spend × rate to a running total and counts
 * the whole numbers it crossed, so a day's count never depends on which range a page asked for.
 */
function adSeries(ad: WorldAd, index: number): Map<number, AdDay> {
  const cached = series.get(ad.adId);
  if (cached) return cached;
  const out = new Map<number, AdDay>();
  const acc = { installs: 0, trials: 0, pay: 0, mInstalls: 0, mTrials: 0, mPay: 0 };
  let payers = 0, metaPayers = 0;
  if (ad.start != null && ad.end != null) {
    for (let i = Math.max(OLDEST, ad.start); i <= ad.end; i++) {
      const spend = round2(ad.dailySpend * (1 + 0.12 * Math.sin(i / 2.3 + index * 1.7)));
      const step = (key: keyof typeof acc, rate: number) => { const before = Math.floor(acc[key]); acc[key] += spend * rate; return Math.floor(acc[key]) - before; };
      const installs = step("installs", 0.42), trials = step("trials", 0.13), purchases = step("pay", ad.payRate);
      // Meta's pixel sees a little less than the MMP.
      const mInstalls = step("mInstalls", 0.42 * 0.9), mTrials = step("mTrials", 0.13 * 0.9), mPurchases = step("mPay", ad.payRate * 0.85);
      // Three in four customers take the yearly plan.
      let yearly = 0, monthly = 0, metaValue = 0;
      for (let k = 0; k < purchases; k++, payers++) { if (payers % 4 === 3) monthly++; else yearly++; }
      for (let k = 0; k < mPurchases; k++, metaPayers++) metaValue += metaPayers % 4 === 3 ? WORLD.plans.monthly : WORLD.plans.yearly;
      out.set(i, {
        spend, impressions: Math.round(spend * 95), reach: Math.round(spend * 78), clicks: Math.round(spend * 2.2), linkClicks: Math.round(spend * 1.7),
        meta: { installs: mInstalls, trials: mTrials, purchases: mPurchases, value: round2(metaValue) },
        appstack: { installs, trials, purchases, yearly, monthly, revenue: round2(yearly * WORLD.plans.yearly + monthly * WORLD.plans.monthly) },
      });
    }
  }
  series.set(ad.adId, out);
  return out;
}

/** An ad's numbers on one day (null: no delivery that day). */
export const adDay = (ad: WorldAd, offset: number): AdDay | null => adSeries(ad, ADS.indexOf(ad)).get(offset) ?? null;

/** Everything the ads did on one day, summed. */
export function adsOn(offset: number) {
  const sum = { spend: 0, installs: 0, trials: 0, purchases: 0, yearly: 0, monthly: 0, revenue: 0 };
  for (const ad of ADS) {
    const d = adDay(ad, offset);
    if (!d) continue;
    sum.spend += d.spend; sum.installs += d.appstack.installs; sum.trials += d.appstack.trials;
    sum.purchases += d.appstack.purchases; sum.yearly += d.appstack.yearly; sum.monthly += d.appstack.monthly; sum.revenue += d.appstack.revenue;
  }
  return sum;
}

// MARK: The whole app's day (organic included)

/** Customers and trials the ads didn't bring (organic), installs from search and word of mouth. */
const organic = (i: number) => ({ payers: ((i % 3) + 3) % 3 === 0 ? 0 : 1, yearly: ((i % 2) + 2) % 2 === 0, trials: 2, installs: Math.round(14 * (1 + 0.15 * Math.sin(i / 3))) });

/** The day as RevenueCat, Superwall and Mixpanel count it: every new customer, the ads' and the organic ones. */
export function appDay(i: number) {
  const ads = adsOn(i), o = organic(i);
  const yearly = ads.yearly + (o.payers && o.yearly ? 1 : 0);
  const monthly = ads.monthly + (o.payers && !o.yearly ? 1 : 0);
  const installs = ads.installs + o.installs;
  return {
    installs, trials: ads.trials + o.trials, newPaid: yearly + monthly, yearly, monthly,
    /** Monthly renewals of earlier customers. */
    renewals: 6,
    revenue: round2(yearly * WORLD.plans.yearly + (monthly + 6) * WORLD.plans.monthly),
    refund: ((i % 9) + 9) % 9 === 0 ? WORLD.plans.yearly : 0,
    mrr: Math.round(1050 + (i - OLDEST) * 0.4),
  };
}

/** What the app's overview says today (RevenueCat's overview). */
export const OVERVIEW = { activeSubscriptions: 212, activeTrials: 31, mrr: () => appDay(0).mrr };

// MARK: Pictures

/** A creative's stand-in picture: a flat tile in its tint with its title (the same on every page). */
export const creativePicture = (label: string, tint = "#dfe3ee", w = 400, h = 500) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${tint}"/><circle cx="${w / 2}" cy="${h * 0.42}" r="${w * 0.18}" fill="#aab3c8"/><text x="50%" y="${h * 0.78}" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#4a5168">${label}</text></svg>`)}`;

/** A Studio creative's picture, by id (a deleted one keeps the picture Launch saved of it). */
export function creativeImage(id: string): string {
  const c = CREATIVES.find((x) => x.id === id);
  if (!c) return creativePicture("Before and after", "#efe3e3");
  return c.aspect === "1:1" ? creativePicture(c.title, c.tint, 400, 400) : creativePicture(c.title, c.tint);
}

/** A bundled picture's address on this page (the example's pictures are served with the app). */
export const bundled = (path: string) => (typeof location === "undefined" ? path : new URL(path, location.origin).href);
