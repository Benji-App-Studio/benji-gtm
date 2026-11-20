// Measure: the shapes the Measure page reads and every number it works out from them. Pure
// functions, so the page can recompute instantly when the team switches the source of truth, and
// each formula sits next to the sentence that explains it on the page.
//
// Sources: Meta spend is the cost side. RevenueCat is the truth for money (trials, new payers,
// revenue) but can't say which ad brought whom; AppStack (the MMP) and Meta each attribute
// customers to ads, AppStack tending to over-count and Meta (on iOS) to under-count. So the page
// shows both as a range, never adds them, and lets the team pick which one CAC counts.
//
// Money: Meta spends in the ad account's currency (which may not be dollars); RevenueCat and
// AppStack report USD. Spend and Meta's purchase value are converted to USD at the rate the last
// sync looked up, so every ratio compares like with like.
import { planMonths, type PlanObservation } from "./unit-economics";
import { m, translator, type Translator } from "./i18n/translate";

/** The words a lib function writes, in English unless the page passes its translator. */
export type Words = Pick<Translator, "t" | "tn" | "intl">;
export const ENGLISH: Words = translator("en", null);

export type Source = "meta" | "revenuecat" | "appstack" | "mixpanel" | "superwall";
/** Every source, in the order the page and the connection cards show them. */
export const SOURCES: Source[] = ["meta", "revenuecat", "superwall", "mixpanel", "appstack"];
/** Who attributes customers to ads (per campaign, ad set, ad...). */
export type Truth = "meta" | "appstack";
/** Whose paying customers the headline CAC counts: an attribution source, or every RevenueCat new payer. */
export type Headline = Truth | "revenuecat" | "mixpanel" | "superwall";
/** Headline sources that count every new payer (organic included), so CAC from them is blended. */
export const BLENDED: Headline[] = ["revenuecat", "mixpanel", "superwall"];
export type Level = "campaign" | "adset" | "ad" | "creative" | "format" | "hook";
export type Role = "testing" | "scaling";
export const RANGES = [7, 14, 28, 90] as const;

export interface MeasureSettings {
  cac_source: "auto" | Headline; ltv_basis: "first_purchase" | "manual"; ltv_manual: number | null;
  /** The projection panel's saved scenario (lib/unit-economics.ts cleanScenario), or null to prefill from the data. */
  scenario?: Record<string, unknown> | null;
}
export const DEFAULT_SETTINGS: MeasureSettings = { cac_source: "auto", ltv_basis: "first_purchase", ltv_manual: null, scenario: null };

export interface SyncRow {
  source: Source; status: "ok" | "error" | "not_connected"; message: string | null; currency: string | null; fx_rate: number | null;
  details: {
    overview?: Record<string, { value: number; unit: string; period: string; name: string }>; account?: { name: string; currency: string }; fxDate?: string | null;
    /** Mixpanel: the event names the last sync read, and those no one did. Superwall: the app it read. */
    events?: Record<string, string>; missing?: string[]; app?: { name: string; platform: string };
  };
  synced_at: string;
}
export interface CampaignRow { campaign_id: string; name: string; objective: string | null; status: string | null; daily_budget: number | null; lifetime_budget: number | null; role: Role | null }
export interface AdRow { ad_id: string; name: string; status: string | null; campaign_id: string | null; adset_id: string | null; adset_name: string | null; creative_id: string | null; creative_name: string | null; thumbnail_url: string | null; format_id: string | null; /** Sent from Launch: the studio creative's picture (lib/server/launched-ads.ts launchedThumbnails). */ launch_thumbnail?: string | null; launched?: boolean }
export interface MetaDayRow { ad_id: string; date: string; campaign_id: string | null; adset_id: string | null; spend: number; impressions: number; reach: number; clicks: number; link_clicks: number; installs: number; trials: number; purchases: number; purchase_value: number }
export interface RcRow { date: string; chart: string; measure: string; segment: string; value: number }
export interface AppStackRow { date: string; media_source: string; campaign_id: string; adset_id: string; ad_id: string; campaign_name: string | null; ad_name: string | null; installs: number; trials: number; purchases: number; revenue_usd: number }
/** Mixpanel: unique users per day per metric (funnel_<step>, active), retention cohorts and time to convert. */
export interface MixpanelRow { date: string; metric: string; segment: string; value: number }
/** Superwall: SDK events per day, paywall and placement; revenue on the day's ('', '') row. */
export interface SuperwallRow { date: string; paywall: string; placement: string; opens: number; conversions: number; trials: number; starts: number; revenue_usd: number; refunds_usd: number }
export interface Health { meta: boolean; revenuecat: boolean; appstack: boolean; mixpanel?: boolean; superwall?: boolean; allowList: boolean }

export interface MeasureData {
  workspace: { id: string; name: string; connected: Record<Source, boolean> };
  range: { days: number; since: string; until: string; prevSince: string };
  settings: MeasureSettings;
  sync: Partial<Record<Source, SyncRow>>;
  health: Health | null;
  campaigns: CampaignRow[];
  ads: AdRow[];
  meta: MetaDayRow[];
  revenuecat: RcRow[];
  appstack: AppStackRow[];
  mixpanel: MixpanelRow[];
  superwall: SuperwallRow[];
}

/** A source's product name (the same in every language). */
export const SOURCE_NAME: Record<Source, string> = { meta: "Meta", revenuecat: "RevenueCat", appstack: "AppStack", mixpanel: "Mixpanel", superwall: "Superwall" };


// MARK: Helpers

const sum = <T,>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
export const isMetaSource = (source: string) => /meta|facebook|instagram|^fb/.test(source.toLowerCase());
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const dayList = (since: string, until: string) => {
  const out: string[] = [];
  for (let d = since; d <= until; d = addDays(d, 1)) out.push(d);
  return out;
};

/** Change from the previous period as a fraction (0.062 = +6.2%), or null when there's no base. */
export const change = (now: number | null, before: number | null) => (now == null || before == null || before === 0 ? null : (now - before) / Math.abs(before));

// MARK: Money

export interface Money { currency: string; rate: number | null; converted: boolean; accountCurrency: string | null; fxDate: string | null }

/** How Meta's money becomes the report currency (USD). Without a rate, spend stays in the account's currency. */
export function money(data: MeasureData): Money {
  const meta = data.sync.meta;
  const account = meta?.currency ?? null;
  if (!account || account === "USD") return { currency: "USD", rate: 1, converted: false, accountCurrency: account, fxDate: null };
  if (meta?.fx_rate) return { currency: "USD", rate: Number(meta.fx_rate), converted: true, accountCurrency: account, fxDate: meta.details?.fxDate ?? null };
  return { currency: account, rate: null, converted: false, accountCurrency: account, fxDate: null };
}

/** The headline source, and the attribution source per-ad numbers use (RevenueCat can't split by ad). */
export function truthFor(data: MeasureData): { headline: Headline; split: Truth } {
  const appstack = data.sync.appstack?.status === "ok";
  const choice = data.settings.cac_source;
  const headline: Headline = choice === "auto" ? (appstack ? "appstack" : "meta") : choice;
  return { headline, split: BLENDED.includes(headline) ? (appstack ? "appstack" : "meta") : (headline as Truth) };
}

/**
 * Spend against every new payer and all revenue RevenueCat saw, organic included. Blended CAC sits
 * below the attributed one (organic customers cost nothing) and is the floor of what ads can cost.
 */
export const blended = (spend: number, rc: RcSummary) => ({ cac: ratio(spend, rc.newPaid), roas: ratio(rc.revenue, spend) });

// MARK: Totals

/** Raw sums for any slice of ads and days. Money is already in the report currency. */
export interface Totals {
  spend: number; impressions: number; reach: number; clicks: number; linkClicks: number;
  meta: { installs: number; trials: number; purchases: number; revenue: number };
  appstack: { installs: number; trials: number; purchases: number; revenue: number };
}

export function totals(metaRows: MetaDayRow[], appstackRows: AppStackRow[], rate: number): Totals {
  return {
    spend: sum(metaRows, (r) => r.spend) * rate,
    impressions: sum(metaRows, (r) => r.impressions),
    reach: sum(metaRows, (r) => r.reach),
    clicks: sum(metaRows, (r) => r.clicks),
    linkClicks: sum(metaRows, (r) => r.link_clicks),
    meta: { installs: sum(metaRows, (r) => r.installs), trials: sum(metaRows, (r) => r.trials), purchases: sum(metaRows, (r) => r.purchases), revenue: sum(metaRows, (r) => r.purchase_value) * rate },
    appstack: { installs: sum(appstackRows, (r) => r.installs), trials: sum(appstackRows, (r) => r.trials), purchases: sum(appstackRows, (r) => r.purchases), revenue: sum(appstackRows, (r) => r.revenue_usd) },
  };
}

/** The ratios for one slice, counting conversions from the chosen source of truth. */
export interface Metrics {
  spend: number; impressions: number; clicks: number; installs: number; trials: number; purchases: number; revenue: number;
  ctr: number | null; cpm: number | null; cpc: number | null; cpi: number | null; costPerTrial: number | null; cac: number | null; roas: number | null;
}

export function metrics(t: Totals, truth: Truth): Metrics {
  const c = t[truth];
  return {
    spend: t.spend, impressions: t.impressions, clicks: t.clicks, installs: c.installs, trials: c.trials, purchases: c.purchases, revenue: c.revenue,
    ctr: ratio(t.clicks, t.impressions), cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null, cpc: ratio(t.spend, t.clicks),
    cpi: ratio(t.spend, c.installs), costPerTrial: ratio(t.spend, c.trials), cac: ratio(t.spend, c.purchases), roas: ratio(c.revenue, t.spend),
  };
}

// MARK: RevenueCat

const REVENUE = (m: string) => /revenue|proceeds/i.test(m) && !/transactions|impressions/i.test(m);
const TOTAL_SEGMENT = (s: string) => s === "" || s === "*";

function rcTotal(rows: RcRow[], chart: string, measure: (m: string) => boolean) {
  const mine = rows.filter((r) => r.chart === chart && measure(r.measure));
  const hasTotal = mine.some((r) => TOTAL_SEGMENT(r.segment));
  return sum(mine.filter((r) => (hasTotal ? TOTAL_SEGMENT(r.segment) : true)), (r) => r.value);
}

function rcSegments(rows: RcRow[], chart: string, measure: (m: string) => boolean) {
  const out = new Map<string, number>();
  for (const r of rows) if (r.chart === chart && measure(r.measure) && !TOTAL_SEGMENT(r.segment)) out.set(r.segment, (out.get(r.segment) ?? 0) + r.value);
  return [...out.entries()].map(([segment, value]) => ({ segment, value })).sort((a, b) => b.value - a.value);
}

export interface RcSummary {
  connected: boolean;
  trials: number; trialStarts: number; conversions: number; conversionRate: number | null;
  newPaid: number; newCustomers: number; revenue: number; proceeds: number; refunds: number; refundedTransactions: number;
  activeSubscriptions: number | null; activeTrials: number | null; mrr: number | null;
  /** Proceeds and new paid subscriptions by product duration (Yearly, Monthly...). */
  split: { segment: string; proceeds: number; newPaid: number }[];
}

export function revenuecat(data: MeasureData, rows: RcRow[]): RcSummary {
  const overview = data.sync.revenuecat?.details?.overview ?? {};
  const proceedsBy = rcSegments(rows, "proceeds", REVENUE);
  const paidBy = rcSegments(rows, "actives_new", (m) => /total/i.test(m));
  const names = [...new Set([...proceedsBy.map((p) => p.segment), ...paidBy.map((p) => p.segment)])];
  const trialStarts = rcTotal(rows, "trial_conversion_rate", (m) => /trial starts/i.test(m));
  const conversions = rcTotal(rows, "trial_conversion_rate", (m) => /^conversions$/i.test(m));
  return {
    connected: data.sync.revenuecat?.status === "ok",
    trials: rcTotal(rows, "trials_new", () => true),
    trialStarts, conversions, conversionRate: ratio(conversions, trialStarts),
    newPaid: rcTotal(rows, "actives_new", (m) => /total/i.test(m)),
    newCustomers: rcTotal(rows, "customers_new", (m) => !/rate|%/i.test(m)),
    revenue: rcTotal(rows, "revenue", REVENUE),
    proceeds: rcTotal(rows, "proceeds", REVENUE),
    refunds: rcTotal(rows, "refunds", (m) => /revenue|proceeds/i.test(m)),
    refundedTransactions: rcTotal(rows, "refunds", (m) => /transactions/i.test(m)),
    activeSubscriptions: overview.active_subscriptions?.value ?? null,
    activeTrials: overview.active_trials?.value ?? null,
    mrr: overview.mrr?.value ?? null,
    split: names.map((segment) => ({ segment, proceeds: proceedsBy.find((p) => p.segment === segment)?.value ?? 0, newPaid: paidBy.find((p) => p.segment === segment)?.value ?? 0 })),
  };
}

// MARK: Unit economics

export interface Economics {
  ltv: number | null; ltvBasis: "first_purchase" | "manual"; cac: number | null; ltvCac: number | null; marginPerCustomer: number | null;
  /** Months of subscription revenue to earn back CAC (MRR ÷ active subscriptions per month). */
  paybackMonths: number | null; arpuMonth: number | null;
}

export function economics(settings: MeasureSettings, rc: RcSummary, cac: number | null): Economics {
  const ltv = settings.ltv_basis === "manual" ? settings.ltv_manual : ratio(rc.proceeds, rc.newPaid);
  const arpuMonth = rc.mrr != null && rc.activeSubscriptions ? rc.mrr / rc.activeSubscriptions : null;
  return {
    ltv, ltvBasis: settings.ltv_basis, cac,
    ltvCac: ltv != null && cac ? ltv / cac : null,
    marginPerCustomer: ltv != null && cac != null ? ltv - cac : null,
    paybackMonths: cac != null && arpuMonth ? cac / arpuMonth : null,
    arpuMonth,
  };
}

// MARK: Launch's names

/**
 * Launch names what it creates `<APP> | <TEST|SCALE> | <format> | <hook> | vNN | <YYYY-MM-DD>` (ad sets
 * and campaigns put "adset" / "campaign" in the format slot). Same rules as parseAdName in
 * studio/src/lib/launch/naming.ts.
 */
export function parseLaunchName(name: string | null | undefined) {
  const parts = (name ?? "").split(" | ");
  if (parts.length !== 6) return null;
  const [app, stage, format, hook, version, date] = parts;
  if (!/^[A-Z0-9]{2,6}$/.test(app) || (stage !== "TEST" && stage !== "SCALE") || !/^v\d{2}$/.test(version) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (format === "adset" || format === "campaign") return null;
  return { app, stage, format, hook, version: Number(version.slice(1)), date };
}

/** TEST or SCALE in the second slot of any Launch name (campaign, ad set or ad). */
const stageRole = (name: string | null | undefined): Role | null => {
  const stage = (name ?? "").split(" | ")[1];
  return stage === "TEST" ? "testing" : stage === "SCALE" ? "scaling" : null;
};

// MARK: Rows by level

export interface Group {
  key: string; name: string; sub: string; role: Role | null; level: Level; thumbnail: string | null;
  campaignId: string | null; adIds: string[]; totals: Totals; m: Metrics;
  /** Set when Meta gave no name: the English stand-in ("Unnamed creative") `name` was written from. */
  fallbackName: string | null;
}

/** What a row is called when Meta gave it no name (English: show with t()). */
export const FALLBACK_NAME: Record<Level, string> = {
  campaign: m("Unmatched campaign"), adset: m("Unnamed ad set"), ad: m("Ad not in Meta's list"), creative: m("Unnamed creative"),
  format: m("Untagged"), hook: m("Untagged"),
};

/** One creative is one key across testing and scaling: Launch's format, hook, version and date, else Meta's creative. */
const creativeKey = (ad: AdRow) => {
  const p = parseLaunchName(ad.name);
  return p ? `${p.format}|${p.hook}|v${p.version}|${p.date}` : ad.creative_id ?? `ad:${ad.ad_id}`;
};

const keyFor = (level: Level, ad: AdRow | undefined, fallback: { campaign_id: string; adset_id: string; ad_id: string }) => {
  switch (level) {
    case "campaign": return ad?.campaign_id ?? fallback.campaign_id;
    case "adset": return ad?.adset_id ?? fallback.adset_id;
    case "ad": return ad?.ad_id ?? fallback.ad_id;
    case "creative": return ad ? creativeKey(ad) : fallback.ad_id;
    case "format": return ad?.format_id ?? parseLaunchName(ad?.name)?.format ?? "untagged";
    case "hook": return parseLaunchName(ad?.name)?.hook ?? "untagged";
  }
};

/** Meta's rows and AppStack's Meta-attributed rows, summed per campaign, ad set, ad, creative, format or hook. */
export function groups(data: MeasureData, level: Level, metaRows: MetaDayRow[], appstackRows: AppStackRow[], rate: number, truth: Truth, words: Words = ENGLISH): Group[] {
  const { t, tn } = words;
  const ads = new Map(data.ads.map((a) => [a.ad_id, a]));
  const campaigns = new Map(data.campaigns.map((c) => [c.campaign_id, c]));
  // The team's choice for a campaign wins; otherwise Launch's TEST / SCALE in the campaign's or ad's name.
  const roleOf = (campaignId: string | null | undefined, adName?: string | null): Role | null => {
    const c = campaignId ? campaigns.get(campaignId) : undefined;
    return c?.role ?? stageRole(c?.name) ?? stageRole(adName);
  };
  const buckets = new Map<string, { meta: MetaDayRow[]; appstack: AppStackRow[]; ads: Set<string>; sample?: AdRow; sampleAs?: AppStackRow }>();
  const bucket = (key: string) => {
    const b = buckets.get(key) ?? { meta: [], appstack: [], ads: new Set<string>() };
    buckets.set(key, b);
    return b;
  };
  for (const row of metaRows) {
    const ad = ads.get(row.ad_id);
    const b = bucket(keyFor(level, ad, { campaign_id: row.campaign_id ?? "", adset_id: row.adset_id ?? "", ad_id: row.ad_id }) || "unknown");
    b.meta.push(row); b.ads.add(row.ad_id); b.sample ??= ad;
  }
  for (const row of appstackRows) {
    if (!isMetaSource(row.media_source)) continue;
    const ad = ads.get(row.ad_id);
    const b = bucket(keyFor(level, ad, row) || "unknown");
    b.appstack.push(row); b.sample ??= ad; b.sampleAs ??= row;
  }
  return [...buckets.entries()].map(([key, b]) => {
    const ad = b.sample;
    const campaignId = ad?.campaign_id ?? b.sampleAs?.campaign_id ?? b.meta[0]?.campaign_id ?? null;
    const campaign = campaignId ? campaigns.get(campaignId) : undefined;
    const launch = parseLaunchName(ad?.name);
    // An ad set or ad follows its campaign's role; a creative in any scaling campaign is scaling.
    const roles = [...b.ads].map((id) => roleOf(ads.get(id)?.campaign_id, ads.get(id)?.name)).filter(Boolean);
    const role = level === "format" || level === "hook" ? null
      : level === "creative" ? (roles.includes("scaling") ? "scaling" : roles[0] ?? null)
      : roleOf(campaignId, level === "campaign" ? null : ad?.name);
    const real = level === "campaign" ? campaign?.name || b.sampleAs?.campaign_name
      : level === "adset" ? ad?.adset_name
      : level === "ad" ? ad?.name || b.sampleAs?.ad_name
      : level === "creative" ? (launch ? `${launch.format} · ${launch.hook} · v${String(launch.version).padStart(2, "0")}` : ad?.creative_name || ad?.name)
      : key === "untagged" ? undefined : key;
    const fallbackName = real ? null : FALLBACK_NAME[level];
    const name = real || t(FALLBACK_NAME[level]);
    const objective = campaign?.objective ? OBJECTIVE_WORD[campaign.objective] : undefined;
    const status = campaign?.status ? CAMPAIGN_STATUS_WORD[campaign.status] : undefined;
    const sub = level === "campaign" ? [objective ? t(objective) : campaign?.objective?.replace(/^OUTCOME_/, "").toLowerCase(), status ? t(status) : campaign?.status?.toLowerCase()].filter(Boolean).join(" · ")
      : level === "format" || level === "hook" ? tn(b.ads.size, "{n} ad", "{n} ads")
      : level === "creative" && b.ads.size > 1 ? (launch ? tn(b.ads.size, "{n} ad · first run {date}", "{n} ads · first run {date}", { date: launch.date }) : [tn(b.ads.size, "{n} ad", "{n} ads"), campaign?.name].filter(Boolean).join(" · "))
      : campaign?.name ?? "";
    const sum = totals(b.meta, b.appstack, rate);
    return { key, name, sub, role, level, thumbnail: level === "ad" || level === "creative" ? ad?.launch_thumbnail ?? ad?.thumbnail_url ?? null : null, campaignId, adIds: [...b.ads], totals: sum, m: metrics(sum, truth), fallbackName };
  }).sort((a, b) => b.totals.spend - a.totals.spend);
}

/** A campaign's objective and status in words (shown under its name in the table). */
const OBJECTIVE_WORD: Record<string, string> = {
  OUTCOME_AWARENESS: m("Awareness"), OUTCOME_TRAFFIC: m("Traffic"), OUTCOME_ENGAGEMENT: m("Engagement"), OUTCOME_LEADS: m("Leads"),
  OUTCOME_SALES: m("Sales"), OUTCOME_APP_PROMOTION: m("App promotion"),
};
const CAMPAIGN_STATUS_WORD: Record<string, string> = { ACTIVE: m("Active"), PAUSED: m("Paused"), ARCHIVED: m("Archived"), DELETED: m("Deleted") };

// MARK: Verdicts and alerts

export type Verdict = { label: string; tone: "win" | "warn" | "neutral" | "accent" };

/** The verdicts in English (render with t(label)). */
const VERDICT_WORD = {
  noSpend: m("No spend"), converting: m("Converting"), noCustomersYet: m("No customers yet"), noCustomers: m("No customers"),
  learning: m("Learning"), winner: m("Winner"), onTarget: m("On target"), aboveTarget: m("Above target"),
};

/** Where a row stands against the target (CAC below LTV). The label is English: show it with t(label). */
export function verdict(m: Metrics, ltv: number | null, role: Role | null): Verdict {
  if (m.spend <= 0) return { label: VERDICT_WORD.noSpend, tone: "neutral" };
  if (ltv == null) return { label: m.purchases ? VERDICT_WORD.converting : VERDICT_WORD.noCustomersYet, tone: "neutral" };
  if (!m.purchases) return m.spend >= ltv ? { label: VERDICT_WORD.noCustomers, tone: "warn" } : { label: VERDICT_WORD.learning, tone: "neutral" };
  if (m.cac! <= ltv * 0.7 && role === "testing") return { label: VERDICT_WORD.winner, tone: "win" };
  if (m.cac! <= ltv) return { label: VERDICT_WORD.onTarget, tone: "accent" };
  return { label: VERDICT_WORD.aboveTarget, tone: "warn" };
}

export interface Alert { id: string; tone: "warn" | "win" | "accent"; title: string; detail: string; level?: Level; key?: string }

/** What to look at first. Titles and details are English unless the page passes its translator. */
export function alerts(data: MeasureData, creatives: Group[], campaignsList: Group[], current: Totals, ltv: number | null, fmt: (n: number) => string, words: Words = ENGLISH): Alert[] {
  const { t, tn } = words;
  const out: Alert[] = [];
  for (const s of SOURCES) {
    if (data.sync[s]?.status === "error") out.push({ id: `sync-${s}`, tone: "warn", title: t("{source} didn't sync", { source: SOURCE_NAME[s] }), detail: data.sync[s]!.message ?? t("The last sync failed.") });
  }
  if (ltv != null) {
    for (const g of creatives) {
      if (g.m.spend <= 0) continue;
      if (!g.m.purchases && g.m.spend >= ltv) out.push({ id: `nobuy-${g.key}`, tone: "warn", title: t("{name} spent {spend} without a customer", { name: g.name, spend: fmt(g.m.spend) }), detail: t("More than one customer is worth ({ltv}). Pause it or change the hook.", { ltv: fmt(ltv) }), level: "creative", key: g.key });
      else if (g.m.cac != null && g.m.cac > ltv) out.push({ id: `cac-${g.key}`, tone: "warn", title: t("{name} is above target CAC", { name: g.name }), detail: t("{cac} per customer against {ltv} LTV", { cac: fmt(g.m.cac), ltv: fmt(ltv) }), level: "creative", key: g.key });
      else if (g.role === "testing" && g.m.cac != null && g.m.cac <= ltv * 0.7 && g.m.purchases >= 2) out.push({ id: `win-${g.key}`, tone: "win", title: t("{name} is ready to scale", { name: g.name }), detail: tn(Math.round(g.m.purchases), "{cac} CAC on {n} customer in testing. Move it to the scaling campaign.", "{cac} CAC on {n} customers in testing. Move it to the scaling campaign.", { cac: fmt(g.m.cac) }), level: "creative", key: g.key });
    }
  }
  const gap = change(current.appstack.installs, current.meta.installs);
  if (data.sync.appstack?.status === "ok" && current.meta.installs >= 10 && gap != null && Math.abs(gap) >= 0.25) {
    const share = `${Math.abs(Math.round(gap * 100))}%`;
    out.push({ id: "gap", tone: "accent",
      title: gap > 0 ? t("AppStack counts {share} more installs than Meta", { share }) : t("AppStack counts {share} fewer installs than Meta", { share }),
      detail: t("{appstack} against {meta}. The pixel under-counts and the MMP can over-count; the truth sits between.", { appstack: Math.round(current.appstack.installs), meta: Math.round(current.meta.installs) }) });
  }
  const untagged = campaignsList.filter((c) => !c.role && c.m.spend > 0);
  // (A role comes from the team's choice or Launch's TEST / SCALE naming.)
  if (untagged.length) out.push({ id: "roles", tone: "accent", title: tn(untagged.length, "{n} campaign has no role", "{n} campaigns have no role"), detail: t("Mark each as testing or scaling so winners and budgets group correctly."), level: "campaign" });
  return out.sort((a, b) => (a.tone === "warn" ? 0 : 1) - (b.tone === "warn" ? 0 : 1));
}

// MARK: Explanations

/** How each number is worked out, in words the team can check against the sources (English: show with t()). */
export const HOW: Record<string, string> = {
  spend: m("Amount spent on Meta in the period, summed from Insights per ad per day. Converted to USD at the day's ECB rate when the ad account bills in another currency."),
  installs: m("App installs attributed to the ads: Meta's (app install events, or Lead events when AppStack forwards installs to Meta's dataset) or AppStack's, whichever you count from. The two are shown as a range and never added."),
  cpi: m("Cost per install = spend ÷ installs."),
  trials: m("Trial starts attributed to the ads (Meta's start_trial events, or AppStack's start_trial / rc_trial_started)."),
  costPerTrial: m("Cost per trial = spend ÷ trials."),
  purchases: m("New paying customers attributed to the ads: Meta's purchase events, or AppStack's first purchases (rc_initial_purchase and rc_trial_converted when RevenueCat feeds AppStack)."),
  cac: m("Customer acquisition cost = Meta spend ÷ new paying customers attributed to the ads (AppStack or Meta). Trials that haven't converted yet don't count, so CAC runs high in a test's first days."),
  blendedCac: m("Blended CAC = Meta spend ÷ every new paid subscription RevenueCat recorded, organic included. It's the floor: real paid CAC is at or above it."),
  roas: m("Return on ad spend = revenue ÷ Meta spend. Blended uses all RevenueCat revenue; per ad it's the revenue AppStack (from RevenueCat's events) or Meta attributes. 1.0× means the ads paid for themselves."),
  ltv: m("Lifetime value of a paying customer, after the store's cut, taxes and refunds. From your data: RevenueCat's realized cohort LTV when it has one, else the model from your plan prices, renewals and refunds (see Unit economics), else what a first purchase leaves. Or set your own."),
  ltvCac: m("LTV ÷ CAC. Above 1 a customer is worth more than they cost; 3 is the usual healthy mark for subscriptions."),
  margin: m("LTV − CAC: what each new paying customer leaves after paying for the ads that brought them."),
  payback: m("The first month in which a customer's cumulative net cash covers CAC. Cash over time follows the plan mix and renewals, scaled to the LTV shown; month 1 is the first charge, so an annual plan that covers CAC pays back in month 1."),
  ctr: m("Click-through rate = clicks (all) ÷ impressions."),
  cpm: m("Cost per thousand impressions = spend ÷ impressions × 1,000."),
  cpc: m("Cost per click = spend ÷ clicks (all)."),
  reach: m("Summed from daily reach, so someone reached on two days counts twice. Ads Manager shows the deduplicated figure."),
};

// MARK: Daily series (RevenueCat charts, for the operating dashboard's lines and bars)

/** One chart measure summed per day (segment totals when the chart has them), over `days`. */
export function rcDaily(rows: RcRow[], chart: string, measure: (m: string) => boolean, days: string[]): number[] {
  const mine = rows.filter((r) => r.chart === chart && measure(r.measure));
  const hasTotal = mine.some((r) => TOTAL_SEGMENT(r.segment));
  const by = new Map<string, number>();
  for (const r of mine) if (!hasTotal || TOTAL_SEGMENT(r.segment)) by.set(r.date, (by.get(r.date) ?? 0) + r.value);
  return days.map((d) => by.get(d) ?? 0);
}

/** A point-in-time chart (MRR, actives) per day: the day's value, or null when RevenueCat had none. */
export function rcLevel(rows: RcRow[], chart: string, measure: (m: string) => boolean, days: string[]): (number | null)[] {
  const by = new Map<string, number>();
  for (const r of rows) if (r.chart === chart && measure(r.measure) && TOTAL_SEGMENT(r.segment)) by.set(r.date, r.value);
  return days.map((d) => (by.has(d) ? by.get(d)! : null));
}

/**
 * Monthly churn of MONTHLY plans from RevenueCat's churn chart (synced by product duration): churned
 * subscriptions ÷ the average of active ones, scaled to 30 days; else the chart's daily rate (percent)
 * compounded over 30 days. Annual plans churn once a year, so blending them in would understate it.
 * A sync from before the chart was split by duration has only the blend, which is used as it is.
 */
export function rcMonthlyChurn(rows: RcRow[]): number | null {
  const all = rows.filter((r) => r.chart === "churn");
  const segmented = all.some((r) => !TOTAL_SEGMENT(r.segment));
  const mine = segmented ? all.filter((r) => !TOTAL_SEGMENT(r.segment) && planMonths(r.segment) === 1) : all;
  if (!mine.length) return null;
  const days = new Set(mine.map((r) => r.date)).size;
  const churned = sum(mine.filter((r) => /churn/i.test(r.measure) && !/rate|%/i.test(r.measure)), (r) => r.value);
  const actives = mine.filter((r) => /active/i.test(r.measure) && !/churn/i.test(r.measure));
  const avgActive = actives.length ? sum(actives, (r) => r.value) / new Set(actives.map((r) => r.date)).size : 0;
  if (churned > 0 && avgActive > 0 && days > 0) return Math.min(1, (churned / avgActive) * (30 / days));
  const rates = mine.filter((r) => /rate|%/i.test(r.measure)).map((r) => r.value);
  if (!rates.length) return churned === 0 && avgActive > 0 ? 0 : null;
  // RevenueCat states rates in percent (0.5 = 0.5%).
  const fraction = rates.reduce((a, b) => a + b, 0) / rates.length / 100;
  return Math.min(1, 1 - (1 - fraction) ** 30);
}

/**
 * Each product duration's new paid subscriptions (the plan mix) and its new-subscription revenue net
 * of taxes with that revenue's transactions (the price), from RevenueCat. Renewals are in neither.
 */
export function rcPlanObservations(rows: RcRow[]): PlanObservation[] {
  const out = new Map<string, PlanObservation>();
  const at = (segment: string) => {
    const o = out.get(segment) ?? { segment, newPaid: 0, newRevenue: null, newTransactions: null };
    out.set(segment, o);
    return o;
  };
  for (const r of rows) {
    if (TOTAL_SEGMENT(r.segment)) continue;
    if (r.chart === "actives_new" && /total/i.test(r.measure)) at(r.segment).newPaid += r.value;
    if (r.chart === "new_sub_revenue") {
      const o = at(r.segment);
      if (/transaction/i.test(r.measure)) o.newTransactions = (o.newTransactions ?? 0) + r.value;
      else if (/revenue/i.test(r.measure)) o.newRevenue = (o.newRevenue ?? 0) + r.value;
    }
  }
  return [...out.values()];
}

/** Refund rate over the period from RevenueCat's refund_rate chart (refunds ÷ transactions), or refunded ÷ gross revenue. */
export function rcRefundRate(rows: RcRow[], rc: RcSummary): number | null {
  const mine = rows.filter((r) => r.chart === "refund_rate" && TOTAL_SEGMENT(r.segment));
  const refunds = sum(mine.filter((r) => /refund/i.test(r.measure) && !/rate|%/i.test(r.measure)), (r) => r.value);
  const transactions = sum(mine.filter((r) => /transaction/i.test(r.measure)), (r) => r.value);
  if (transactions > 0) return Math.min(1, refunds / transactions);
  const gross = rc.revenue + rc.refunds;
  return gross > 0 ? Math.min(1, rc.refunds / gross) : null;
}

// MARK: Mixpanel

export const MIXPANEL_STEPS = ["install", "signup", "paywall", "trial", "purchase"] as const;
export type MixpanelStep = (typeof MIXPANEL_STEPS)[number];

export interface MixpanelSummary {
  connected: boolean;
  /** Unique users per step, summed over the period's days (a person counted once per day). */
  funnel: { step: MixpanelStep; users: number }[];
  activeByDay: { date: string; users: number }[];
  avgActive: number | null;
  /** Day-N retention of the period's install cohorts: returning ÷ cohort size, for cohorts old enough. */
  retention: { day: number; rate: number; cohorts: number }[];
  /** A saved funnel's mean time from install to purchase, weighted by each day's converters. */
  ttc: { meanSeconds: number; conversions: number } | null;
  events: Record<string, string>;
  missing: string[];
}

export function mixpanel(data: MeasureData, rows: MixpanelRow[]): MixpanelSummary {
  const per = (metric: string) => sum(rows.filter((r) => r.metric === metric), (r) => r.value);
  const active = new Map<string, number>();
  for (const r of rows) if (r.metric === "active") active.set(r.date, (active.get(r.date) ?? 0) + r.value);
  const activeByDay = [...active.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, users]) => ({ date, users }));
  const sizes = new Map(rows.filter((r) => r.metric === "retention_size").map((r) => [r.date, r.value]));
  const retained = new Map<number, { back: number; size: number; cohorts: number }>();
  for (const r of rows) {
    if (r.metric !== "retention") continue;
    const day = Number(r.segment.replace(/^D/, ""));
    const size = sizes.get(r.date) ?? 0;
    if (!Number.isInteger(day) || size <= 0) continue;
    const cell = retained.get(day) ?? { back: 0, size: 0, cohorts: 0 };
    cell.back += r.value; cell.size += size; cell.cohorts += 1;
    retained.set(day, cell);
  }
  const ttcRows = rows.filter((r) => r.metric === "ttc_seconds");
  const conversions = new Map(rows.filter((r) => r.metric === "ttc_conversions").map((r) => [r.date, r.value]));
  let weighted = 0, converted = 0;
  for (const r of ttcRows) { const n = conversions.get(r.date) ?? 0; weighted += r.value * n; converted += n; }
  return {
    connected: data.sync.mixpanel?.status === "ok",
    funnel: MIXPANEL_STEPS.map((step) => ({ step, users: per(`funnel_${step}`) })),
    activeByDay,
    avgActive: activeByDay.length ? sum(activeByDay, (d) => d.users) / activeByDay.length : null,
    retention: [...retained.entries()].sort(([a], [b]) => a - b).map(([day, c]) => ({ day, rate: c.back / c.size, cohorts: c.cohorts })),
    ttc: converted > 0 ? { meanSeconds: weighted / converted, conversions: converted } : null,
    events: data.sync.mixpanel?.details?.events ?? {},
    missing: data.sync.mixpanel?.details?.missing ?? [],
  };
}

// MARK: Superwall

export interface PaywallGroup { key: string; opens: number; conversions: number; trials: number; rate: number | null }
export interface SuperwallSummary {
  connected: boolean;
  opens: number; conversions: number; trials: number; starts: number; revenue: number; refunds: number;
  /** Purchases ÷ paywall views. */
  rate: number | null;
  byPaywall: PaywallGroup[]; byPlacement: PaywallGroup[];
  byDay: { date: string; opens: number; conversions: number; revenue: number }[];
}

function groupBy(rows: SuperwallRow[], key: (r: SuperwallRow) => string): PaywallGroup[] {
  const out = new Map<string, PaywallGroup>();
  for (const r of rows) {
    if (!r.opens && !r.conversions && !r.trials) continue;
    const k = key(r);
    const g = out.get(k) ?? { key: k, opens: 0, conversions: 0, trials: 0, rate: null };
    g.opens += r.opens; g.conversions += r.conversions; g.trials += r.trials;
    out.set(k, g);
  }
  return [...out.values()].map((g) => ({ ...g, rate: ratio(g.conversions, g.opens) })).sort((a, b) => b.opens - a.opens || b.conversions - a.conversions);
}

export function superwall(data: MeasureData, rows: SuperwallRow[]): SuperwallSummary {
  const byDay = new Map<string, { date: string; opens: number; conversions: number; revenue: number }>();
  for (const r of rows) {
    const d = byDay.get(r.date) ?? { date: r.date, opens: 0, conversions: 0, revenue: 0 };
    d.opens += r.opens; d.conversions += r.conversions; d.revenue += r.revenue_usd;
    byDay.set(r.date, d);
  }
  const opens = sum(rows, (r) => r.opens), conversions = sum(rows, (r) => r.conversions);
  return {
    connected: data.sync.superwall?.status === "ok",
    opens, conversions, trials: sum(rows, (r) => r.trials), starts: sum(rows, (r) => r.starts),
    revenue: sum(rows, (r) => r.revenue_usd), refunds: sum(rows, (r) => r.refunds_usd),
    rate: ratio(conversions, opens),
    byPaywall: groupBy(rows, (r) => r.paywall), byPlacement: groupBy(rows, (r) => r.placement),
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** New paying customers the chosen headline source counts in a period (blended sources count everyone). */
export function headlineCustomers(headline: Headline, t: Totals, rc: RcSummary, mp: MixpanelSummary, sw: SuperwallSummary): number {
  if (headline === "revenuecat") return rc.newPaid;
  if (headline === "mixpanel") return mp.funnel.find((f) => f.step === "purchase")?.users ?? 0;
  if (headline === "superwall") return sw.conversions;
  return t[headline].purchases;
}
