// RevenueCat REST API v2, Charts & Metrics (read-only): the overview snapshot plus a handful of
// daily charts. The key is a v2 secret key with charts_metrics:overview:read and
// charts_metrics:charts:read. The Charts domain allows 25 requests a minute, so charts are fetched
// one after another (about nine per sync).

const BASE = "https://api.revenuecat.com/v2";

export class RevenueCatError extends Error {}

/** A day's value of one chart measure, optionally per segment ('' unsegmented, '*' the segment total). */
export interface RcValue { date: string; chart: string; measure: string; segment: string; value: number }
export interface RcPull { overview: Record<string, { value: number; unit: string; period: string; name: string }>; values: RcValue[] }

interface ChartSeries { display_name?: string; is_total?: boolean }
interface ChartData {
  values?: (Record<string, number | boolean | null> | (number | null)[])[];
  measures?: ChartSeries[];
  segments?: ChartSeries[] | null;
}

/** The charts the dashboard reads. `as` is the name stored; selectors pick e.g. proceeds over revenue. */
const CHARTS: { chart: string; as: string; selectors?: Record<string, string>; segment?: string }[] = [
  { chart: "revenue", as: "revenue" },
  // Proceeds (after store fees and taxes) by product duration: the LTV basis and the annual / monthly split.
  { chart: "revenue", as: "proceeds", selectors: { revenue_type: "proceeds" }, segment: "product_duration" },
  { chart: "trials_new", as: "trials_new" },
  { chart: "actives_new", as: "actives_new", segment: "product_duration" },
  { chart: "trial_conversion_rate", as: "trial_conversion_rate" },
  { chart: "refunds", as: "refunds" },
  { chart: "customers_new", as: "customers_new" },
];

function explain(status: number, body: { message?: string; type?: string } | null): RevenueCatError {
  if (status === 401) return new RevenueCatError("RevenueCat rejected the key. Create a v2 secret key and update REVENUECAT_API_KEY.");
  if (status === 403) return new RevenueCatError("The RevenueCat key can't read charts. Give it charts_metrics:overview:read and charts_metrics:charts:read.");
  if (status === 404) return new RevenueCatError("RevenueCat doesn't know this project. Check the project id in the workspace's connections.");
  if (status === 429) return new RevenueCatError("RevenueCat's rate limit was hit (25 chart requests a minute). Try again in a minute.");
  return new RevenueCatError(`RevenueCat answered ${status}: ${body?.message ?? "unknown error"}`);
}

async function get<T>(key: string, path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(45_000) });
    const body = await response.json().catch(() => null);
    // One polite retry on a rate limit, after the time RevenueCat asks for (capped).
    if (response.status === 429 && attempt === 0) {
      const wait = Math.min(Number(response.headers.get("Retry-After")) || 5, 20);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!response.ok) throw explain(response.status, body);
    return body as T;
  }
}

const day = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/** Turns a chart response (v3 objects, or v2 rows of [time, measure...]) into one value per day. */
export function parseChart(name: string, data: ChartData): RcValue[] {
  const measures = data.measures ?? [];
  const segments = data.segments ?? null;
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
    } else if (row.cohort != null) {
      out.push({
        date: day(Number(row.cohort)), chart: name, measure: measureName(Number(row.measure ?? 0)),
        segment: segmentName(row.segment == null ? undefined : Number(row.segment)), value: Number(row.value) || 0,
      });
    }
  }
  return out;
}

export async function pullRevenueCat(key: string, projectId: string, since: string, until: string): Promise<RcPull> {
  const project = encodeURIComponent(projectId.trim());
  const overview = await get<{ metrics?: { id: string; name: string; value: number; unit: string; period: string }[] }>(key, `/projects/${project}/metrics/overview`, { currency: "USD" });
  const values: RcValue[] = [];
  for (const spec of CHARTS) {
    const data = await get<ChartData>(key, `/projects/${project}/charts/${spec.chart}`, {
      start_date: since, end_date: until, resolution: "0", currency: "USD", realtime: "true",
      ...(spec.selectors ? { selectors: JSON.stringify(spec.selectors) } : {}),
      ...(spec.segment ? { segment: spec.segment } : {}),
    });
    values.push(...parseChart(spec.as, data));
  }
  return {
    overview: Object.fromEntries((overview.metrics ?? []).map((m) => [m.id, { value: Number(m.value) || 0, unit: m.unit, period: m.period, name: m.name }])),
    values,
  };
}

/** The connection check: one read of the project's overview metrics. Throws a RevenueCatError otherwise. */
export async function checkRevenueCat(key: string, projectId: string): Promise<string> {
  const overview = await get<{ metrics?: { id: string }[] }>(key, `/projects/${encodeURIComponent(projectId.trim())}/metrics/overview`, { currency: "USD" });
  return `RevenueCat project ${projectId.trim()} is readable (${(overview.metrics ?? []).length} overview metrics).`;
}
