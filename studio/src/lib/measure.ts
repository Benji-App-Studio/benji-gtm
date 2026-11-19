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

export type Source = "meta" | "revenuecat" | "appstack";
/** Who attributes customers to ads (per campaign, ad set, ad...). */
export type Truth = "meta" | "appstack";
/** Whose paying customers the headline CAC counts: an attribution source, or every RevenueCat new payer. */
export type Headline = Truth | "revenuecat";
export type Level = "campaign" | "adset" | "ad" | "creative" | "format" | "hook";
export type Role = "testing" | "scaling";
export const RANGES = [7, 14, 28, 90] as const;

export interface MeasureSettings { cac_source: "auto" | Headline; ltv_basis: "first_purchase" | "manual"; ltv_manual: number | null }
export const DEFAULT_SETTINGS: MeasureSettings = { cac_source: "auto", ltv_basis: "first_purchase", ltv_manual: null };

export interface SyncRow {
  source: Source; status: "ok" | "error" | "not_connected"; message: string | null; currency: string | null; fx_rate: number | null;
  details: { overview?: Record<string, { value: number; unit: string; period: string; name: string }>; account?: { name: string; currency: string }; fxDate?: string | null };
  synced_at: string;
}
export interface CampaignRow { campaign_id: string; name: string; objective: string | null; status: string | null; daily_budget: number | null; lifetime_budget: number | null; role: Role | null }
export interface AdRow { ad_id: string; name: string; status: string | null; campaign_id: string | null; adset_id: string | null; adset_name: string | null; creative_id: string | null; creative_name: string | null; thumbnail_url: string | null; format_id: string | null }
export interface MetaDayRow { ad_id: string; date: string; campaign_id: string | null; adset_id: string | null; spend: number; impressions: number; reach: number; clicks: number; link_clicks: number; installs: number; trials: number; purchases: number; purchase_value: number }
export interface RcRow { date: string; chart: string; measure: string; segment: string; value: number }
export interface AppStackRow { date: string; media_source: string; campaign_id: string; adset_id: string; ad_id: string; campaign_name: string | null; ad_name: string | null; installs: number; trials: number; purchases: number; revenue_usd: number }
export interface Health { meta: boolean; revenuecat: boolean; appstack: boolean; allowList: boolean }

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
}

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
  return { headline, split: headline === "revenuecat" ? (appstack ? "appstack" : "meta") : headline };
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
}

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
export function groups(data: MeasureData, level: Level, metaRows: MetaDayRow[], appstackRows: AppStackRow[], rate: number, truth: Truth): Group[] {
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
    const name = level === "campaign" ? campaign?.name || b.sampleAs?.campaign_name || "Unmatched campaign"
      : level === "adset" ? ad?.adset_name || "Unnamed ad set"
      : level === "ad" ? ad?.name || b.sampleAs?.ad_name || "Ad not in Meta's list"
      : level === "creative" ? (launch ? `${launch.format} · ${launch.hook} · v${String(launch.version).padStart(2, "0")}` : ad?.creative_name || ad?.name || "Unnamed creative")
      : key === "untagged" ? "Untagged" : key;
    const sub = level === "campaign" ? [campaign?.objective?.replace(/^OUTCOME_/, "").toLowerCase(), campaign?.status?.toLowerCase()].filter(Boolean).join(" · ")
      : level === "format" || level === "hook" ? `${b.ads.size} ad${b.ads.size === 1 ? "" : "s"}`
      : level === "creative" && b.ads.size > 1 ? `${b.ads.size} ads · ${launch ? `first run ${launch.date}` : campaign?.name ?? ""}`
      : campaign?.name ?? "";
    const t = totals(b.meta, b.appstack, rate);
    return { key, name, sub, role, level, thumbnail: level === "ad" || level === "creative" ? ad?.thumbnail_url ?? null : null, campaignId, adIds: [...b.ads], totals: t, m: metrics(t, truth) };
  }).sort((a, b) => b.totals.spend - a.totals.spend);
}

// MARK: Verdicts and alerts

export type Verdict = { label: string; tone: "win" | "warn" | "neutral" | "accent" };

/** Where a row stands against the target (CAC below LTV). */
export function verdict(m: Metrics, ltv: number | null, role: Role | null): Verdict {
  if (m.spend <= 0) return { label: "No spend", tone: "neutral" };
  if (ltv == null) return { label: m.purchases ? "Converting" : "No customers yet", tone: "neutral" };
  if (!m.purchases) return m.spend >= ltv ? { label: "No customers", tone: "warn" } : { label: "Learning", tone: "neutral" };
  if (m.cac! <= ltv * 0.7 && role === "testing") return { label: "Winner", tone: "win" };
  if (m.cac! <= ltv) return { label: "On target", tone: "accent" };
  return { label: "Above target", tone: "warn" };
}

export interface Alert { id: string; tone: "warn" | "win" | "accent"; title: string; detail: string; level?: Level; key?: string }

export function alerts(data: MeasureData, creatives: Group[], campaignsList: Group[], current: Totals, ltv: number | null, fmt: (n: number) => string): Alert[] {
  const out: Alert[] = [];
  for (const s of ["meta", "revenuecat", "appstack"] as const) {
    if (data.sync[s]?.status === "error") out.push({ id: `sync-${s}`, tone: "warn", title: `${s === "meta" ? "Meta" : s === "revenuecat" ? "RevenueCat" : "AppStack"} didn't sync`, detail: data.sync[s]!.message ?? "The last sync failed." });
  }
  if (ltv != null) {
    for (const g of creatives) {
      if (g.m.spend <= 0) continue;
      if (!g.m.purchases && g.m.spend >= ltv) out.push({ id: `nobuy-${g.key}`, tone: "warn", title: `${g.name} spent ${fmt(g.m.spend)} without a customer`, detail: `More than one customer is worth (${fmt(ltv)}). Pause it or change the hook.`, level: "creative", key: g.key });
      else if (g.m.cac != null && g.m.cac > ltv) out.push({ id: `cac-${g.key}`, tone: "warn", title: `${g.name} is above target CAC`, detail: `${fmt(g.m.cac)} per customer against ${fmt(ltv)} LTV`, level: "creative", key: g.key });
      else if (g.role === "testing" && g.m.cac != null && g.m.cac <= ltv * 0.7 && g.m.purchases >= 2) out.push({ id: `win-${g.key}`, tone: "win", title: `${g.name} is ready to scale`, detail: `${fmt(g.m.cac)} CAC on ${Math.round(g.m.purchases)} customers in testing. Move it to the scaling campaign.`, level: "creative", key: g.key });
    }
  }
  const gap = change(current.appstack.installs, current.meta.installs);
  if (data.sync.appstack?.status === "ok" && current.meta.installs >= 10 && gap != null && Math.abs(gap) >= 0.25) {
    out.push({ id: "gap", tone: "accent", title: `AppStack counts ${Math.abs(Math.round(gap * 100))}% ${gap > 0 ? "more" : "fewer"} installs than Meta`, detail: `${Math.round(current.appstack.installs)} against ${Math.round(current.meta.installs)}. The pixel under-counts and the MMP can over-count; the truth sits between.` });
  }
  const untagged = campaignsList.filter((c) => !c.role && c.m.spend > 0);
  // (A role comes from the team's choice or Launch's TEST / SCALE naming.)
  if (untagged.length) out.push({ id: "roles", tone: "accent", title: `${untagged.length} campaign${untagged.length === 1 ? " has" : "s have"} no role`, detail: "Mark each as testing or scaling so winners and budgets group correctly.", level: "campaign" });
  return out.sort((a, b) => (a.tone === "warn" ? 0 : 1) - (b.tone === "warn" ? 0 : 1));
}

// MARK: Explanations

/** How each number is worked out, in words the team can check against the sources. */
export const HOW: Record<string, string> = {
  spend: "Amount spent on Meta in the period, summed from Insights per ad per day. Converted to USD at the day's ECB rate when the ad account bills in another currency.",
  installs: "App installs attributed to the ads: Meta's (app install events, or Lead events when AppStack forwards installs to Meta's dataset) or AppStack's, whichever you count from. The two are shown as a range and never added.",
  cpi: "Cost per install = spend ÷ installs.",
  trials: "Trial starts attributed to the ads (Meta's start_trial events, or AppStack's start_trial / rc_trial_started).",
  costPerTrial: "Cost per trial = spend ÷ trials.",
  purchases: "New paying customers attributed to the ads: Meta's purchase events, or AppStack's first purchases (rc_initial_purchase and rc_trial_converted when RevenueCat feeds AppStack).",
  cac: "Customer acquisition cost = Meta spend ÷ new paying customers attributed to the ads (AppStack or Meta). Trials that haven't converted yet don't count, so CAC runs high in a test's first days.",
  blendedCac: "Blended CAC = Meta spend ÷ every new paid subscription RevenueCat recorded, organic included. It's the floor: real paid CAC is at or above it.",
  roas: "Return on ad spend = revenue ÷ Meta spend. Blended uses all RevenueCat revenue; per ad it's the revenue AppStack (from RevenueCat's events) or Meta attributes. 1.0× means the ads paid for themselves.",
  ltv: "Lifetime value. By default the first purchase: RevenueCat proceeds (after the store's cut and taxes) ÷ new paid subscriptions in the period. Set your own when optimising for a plan, e.g. the annual price after Apple's fee.",
  ltvCac: "LTV ÷ CAC. Above 1 a customer is worth more than they cost; 3 is the usual healthy mark for subscriptions.",
  margin: "LTV − CAC: what each new paying customer leaves after paying for the ads that brought them.",
  payback: "Months to earn back CAC = CAC ÷ (MRR ÷ active subscriptions). Annual plans pay upfront, so they pay back on the first purchase when it covers CAC.",
  ctr: "Click-through rate = clicks (all) ÷ impressions.",
  cpm: "Cost per thousand impressions = spend ÷ impressions × 1,000.",
  cpc: "Cost per click = spend ÷ clicks (all).",
  reach: "Summed from daily reach, so someone reached on two days counts twice. Ads Manager shows the deduplicated figure.",
};
