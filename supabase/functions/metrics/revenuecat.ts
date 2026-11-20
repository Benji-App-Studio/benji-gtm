// RevenueCat REST API v2, Charts & Metrics (read-only): the overview snapshot plus a handful of
// daily charts. The key is a v2 secret key with charts_metrics:overview:read and
// charts_metrics:charts:read. The Charts domain allows 25 requests a minute: a sync asks about 19 (the
// overview, then each chart one after another), and paces itself to stay under 22 in any minute.

const BASE = "https://api.revenuecat.com/v2";

export class RevenueCatError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

/** A day's value of one chart measure, optionally per segment ('' unsegmented, '*' the segment total). */
export interface RcValue { date: string; chart: string; measure: string; segment: string; value: number }
export interface RcPull { skipped?: string[]; overview: Record<string, { value: number; unit: string; period: string; name: string }>; values: RcValue[] }

interface ChartSeries { display_name?: string; is_total?: boolean }
interface ChartData {
  values?: (Record<string, number | boolean | null> | (number | null)[])[];
  measures?: ChartSeries[];
  segments?: ChartSeries[] | null;
  /** Cohort charts (realtime): one entry per column; values point at them with `period`. */
  periods?: ChartSeries[] | null;
}

/** A chart the sync reads. `as` is the name stored; selectors pick e.g. proceeds over revenue. */
interface ChartSpec {
  chart: string; as: string; selectors?: Record<string, string>; segment?: string; filters?: { name: string; values: string[] }[];
  /** Best effort: refused, rate-limited or out of time, it is skipped and the sync still succeeds. */
  optional?: true;
  /** A cohort chart, read over COHORT_DAYS so older cohorts keep growing their later periods. */
  cohort?: true;
  /** Asked again without its selectors when RevenueCat refuses them, stored under this name instead. */
  fallbackAs?: string;
}

/** Cohort charts are re-read this far back on every sync (a cohort's Month 3 only exists three months on). */
export const COHORT_DAYS = 180;
/** The conversion windows asked of conversion_to_paying (RevenueCat's conversion_timeframe selector), in days. */
export const PAYING_WINDOWS = [3, 7, 14, 30] as const;

export const CHARTS: ChartSpec[] = [
  { chart: "revenue", as: "revenue" },
  // Proceeds (after store fees and taxes) by product duration: the annual / monthly split of money.
  { chart: "revenue", as: "proceeds", selectors: { revenue_type: "proceeds" }, segment: "product_duration" },
  { chart: "trials_new", as: "trials_new" },
  { chart: "actives_new", as: "actives_new", segment: "product_duration" },
  { chart: "trial_conversion_rate", as: "trial_conversion_rate" },
  { chart: "refunds", as: "refunds" },
  { chart: "customers_new", as: "customers_new" },
  // The operating dashboard. New-subscription revenue (net of taxes) and its transactions by product
  // duration give each plan's price without renewals in it.
  { chart: "revenue", as: "new_sub_revenue", selectors: { revenue_type: "revenue_net_of_taxes" }, filters: [{ name: "transaction_type", values: ["new_subscription"] }], segment: "product_duration", optional: true },
  { chart: "mrr", as: "mrr", optional: true },
  // Churn by product duration, so monthly churn is read from monthly plans only.
  { chart: "churn", as: "churn", segment: "product_duration", optional: true },
  { chart: "refund_rate", as: "refund_rate", optional: true },
  // Realized LTV per paying customer by first-seen day, in proceeds to match the model (gross when refused).
  { chart: "ltv_per_paying_customer", as: "ltv_paying", selectors: { revenue_type: "proceeds" }, fallbackAs: "ltv_paying_gross", optional: true, cohort: true },
  // Share of each day's new customers who first PAID within each window (trials don't count): time to first purchase.
  ...PAYING_WINDOWS.map((days): ChartSpec => ({ chart: "conversion_to_paying", as: `paying_conversion_${days}`, selectors: { conversion_timeframe: `${days}_days` }, optional: true, cohort: true })),
  // A cohort chart in RevenueCat's docs: read over COHORT_DAYS like the other cohort charts.
  { chart: "subscription_retention", as: "subscription_retention", optional: true, cohort: true },
];

function explain(status: number, body: { message?: string; type?: string } | null): RevenueCatError {
  if (status === 401) return new RevenueCatError("RevenueCat rejected the key. Create a v2 secret key and update REVENUECAT_API_KEY.", status);
  if (status === 403) return new RevenueCatError("The RevenueCat key can't read charts. Give it charts_metrics:overview:read and charts_metrics:charts:read.", status);
  if (status === 404) return new RevenueCatError("RevenueCat doesn't know this project. Check the project id in the workspace's connections.", status);
  if (status === 429) return new RevenueCatError("RevenueCat's rate limit was hit (25 chart requests a minute). Try again in a minute.", status);
  return new RevenueCatError(`RevenueCat answered ${status}: ${body?.message ?? "unknown error"}`, status);
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

async function get<T>(key: string, path: string, params: Record<string, string>, fetchImpl: Fetch = fetch, retry = true): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(45_000) });
    const body = await response.json().catch(() => null);
    // One polite retry on a rate limit, after the time RevenueCat asks for (capped).
    if (response.status === 429 && attempt === 0 && retry) {
      const wait = Math.min(Number(response.headers.get("Retry-After")) || 5, 20);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!response.ok) throw explain(response.status, body);
    return body as T;
  }
}

const day = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * Turns a chart response (v3 objects, or v2 rows of [time, measure...]) into one value per day. Cohort
 * rows ({ cohort, period, value }) keep the period's name as the measure and its index as the segment.
 */
export function parseChart(name: string, data: ChartData): RcValue[] {
  const measures = data.measures ?? [];
  const segments = data.segments ?? null;
  // Realtime cohort charts describe their columns in `periods`; older ones in `segments`.
  const periods = data.periods ?? segments ?? [];
  const periodName = (i: number) => periods[i]?.display_name || (i === 0 ? "Cohort size" : `Period ${i}`);
  const measureName = (i: number) => measures[i]?.display_name || `measure_${i}`;
  const segmentName = (i: number | undefined) => {
    if (!segments || i == null) return "";
    const s = segments[i];
    return s?.is_total ? "*" : s?.display_name || "Unknown";
  };
  const out: RcValue[] = [];
  for (const row of data.values ?? []) {
    if (Array.isArray(row)) {
      const [time, ...rest] = row;
      if (time == null) continue;
      rest.forEach((v, i) => out.push({ date: day(Number(time)), chart: name, measure: measureName(i), segment: "", value: Number(v) || 0 }));
    } else if (row.cohort != null && row.period != null) {
      const period = Number(row.period);
      // A period the cohort hasn't finished yet would read low (a 30-day window five days in): left out.
      if (!Number.isInteger(period) || period < 0 || row.value == null || row.incomplete === true) continue;
      out.push({ date: day(Number(row.cohort)), chart: name, measure: periodName(period), segment: String(period), value: Number(row.value) || 0 });
    } else if (row.cohort != null) {
      // A period that isn't over (today, or a first day that starts mid-period) would read low: left out.
      if (row.incomplete === true) continue;
      out.push({
        date: day(Number(row.cohort)), chart: name, measure: measureName(Number(row.measure ?? 0)),
        segment: segmentName(row.segment == null ? undefined : Number(row.segment)), value: Number(row.value) || 0,
      });
    }
  }
  return out;
}

export interface PullOptions {
  /** Epoch ms after which optional charts are no longer asked (the edge function's wall clock). */
  deadline?: number;
  fetchImpl?: Fetch;
  /** Waits before each request (default: at most 22 a minute). The tests pass one that never waits. */
  pace?: () => Promise<void>;
}

/**
 * Keeps a sync under RevenueCat's 25 requests a minute (Charts & Metrics): before a request, waits while
 * `max` were already sent in the last `windowMs`. Exported for the tests.
 */
export function pacer(max: number, windowMs: number, now: () => number = Date.now, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {
  const sent: number[] = [];
  return async () => {
    for (;;) {
      while (sent.length && now() - sent[0] >= windowMs) sent.shift();
      if (sent.length < max) break;
      await sleep(windowMs - (now() - sent[0]) + 50);
    }
    sent.push(now());
  };
}
const REQUESTS_PER_MINUTE = 22;

const daysBefore = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

export async function pullRevenueCat(key: string, projectId: string, since: string, until: string, options: PullOptions = {}): Promise<RcPull> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pace = options.pace ?? pacer(REQUESTS_PER_MINUTE, 60_000);
  const call = async <T>(path: string, params: Record<string, string>, retry = true) => { await pace(); return await get<T>(key, path, params, fetchImpl, retry); };
  const project = encodeURIComponent(projectId.trim());
  await pace();
  const overview = await get<{ metrics?: { id: string; name: string; value: number; unit: string; period: string }[] }>(key, `/projects/${project}/metrics/overview`, { currency: "USD" }, fetchImpl);
  const values: RcValue[] = [];
  const skipped: string[] = [];
  let limited = false;
  for (const spec of CHARTS) {
    // Optional charts stop once RevenueCat has rate-limited us or the time is nearly up; what's read is kept.
    if (spec.optional && (limited || (options.deadline != null && Date.now() > options.deadline - 8_000))) { skipped.push(spec.as); continue; }
    const params = (selectors: boolean, segment = true) => ({
      start_date: spec.cohort ? (since < daysBefore(until, COHORT_DAYS) ? since : daysBefore(until, COHORT_DAYS)) : since,
      end_date: until, resolution: "0", currency: "USD", realtime: "true",
      ...(selectors && spec.selectors ? { selectors: JSON.stringify(spec.selectors) } : {}),
      ...(segment && spec.segment ? { segment: spec.segment } : {}),
      ...(spec.filters ? { filters: JSON.stringify(spec.filters) } : {}),
    });
    const path = `/projects/${project}/charts/${spec.chart}`;
    let data: ChartData;
    let as = spec.as;
    try {
      // An optional chart isn't retried on a rate limit: it is skipped, and so are the optional ones after it.
      data = await call<ChartData>(path, params(true), !spec.optional);
    } catch (first) {
      let error = first;
      // A segment RevenueCat doesn't offer for this chart (a 400): read the chart unsegmented instead, so
      // its totals still arrive (Measure then has no per-plan split for it) and a required chart doesn't fail the sync.
      if (spec.segment && error instanceof RevenueCatError && error.status === 400) {
        try { values.push(...parseChart(as, await call<ChartData>(path, params(true, false), !spec.optional))); continue; } catch (again) { error = again; }
      }
      if (!spec.optional || !(error instanceof RevenueCatError) || /rejected the key/.test(error.message)) throw error;
      if (/rate limit/.test(error.message)) { limited = true; skipped.push(spec.as); continue; }
      if (!spec.fallbackAs) { skipped.push(spec.as); continue; }
      try {
        data = await call<ChartData>(path, params(false), false);
        as = spec.fallbackAs;
      } catch (again) {
        if (again instanceof RevenueCatError && /rate limit/.test(again.message)) limited = true;
        skipped.push(spec.as);
        continue;
      }
    }
    values.push(...parseChart(as, data));
  }
  return {
    skipped,
    overview: Object.fromEntries((overview.metrics ?? []).map((m) => [m.id, { value: Number(m.value) || 0, unit: m.unit, period: m.period, name: m.name }])),
    values,
  };
}

/** The connection check: one read of the project's overview metrics. Throws a RevenueCatError otherwise. */
export async function checkRevenueCat(key: string, projectId: string): Promise<string> {
  const overview = await get<{ metrics?: { id: string }[] }>(key, `/projects/${encodeURIComponent(projectId.trim())}/metrics/overview`, { currency: "USD" });
  return `RevenueCat project ${projectId.trim()} is readable (${(overview.metrics ?? []).length} overview metrics).`;
}
