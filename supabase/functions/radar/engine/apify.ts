// Apify's REST API. Runs are started and checked separately so a caller can keep many going at once
// (the edge worker) or wait for one (the command-line tools).

const API = "https://api.apify.com/v2";

export interface ApifyRun {
  id: string;
  status: "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "ABORTING" | "ABORTED" | "TIMING-OUT" | "TIMED-OUT";
  defaultDatasetId: string;
  usageTotalUsd?: number;
  statusMessage?: string;
}

/** An Apify failure in plain words. `retryable` means wait and start it again (e.g. memory is full). */
export class ApifyError extends Error {
  constructor(message: string, readonly retryable = false, readonly status = 0) {
    super(message);
  }
}

export const isActive = (status: ApifyRun["status"]) => status === "READY" || status === "RUNNING";

/**
 * What a run may use at most, sent with every start (Apify's run options, docs.apify.com/api/v2/act-runs-post):
 *   timeoutSecs        `timeout`: Apify stops the run after this many seconds, even if nobody asks;
 *   maxTotalChargeUsd  `maxTotalChargeUsd`: the most the run may charge (pay-per-event actors);
 *   maxItems           `maxItems`: the most results charged (pay-per-result actors).
 */
export interface RunLimits { timeoutSecs?: number; maxTotalChargeUsd?: number; maxItems?: number }

/** The run options as Apify's query string ("" when none is set). */
export function runQuery(limits: RunLimits = {}): string {
  const q = new URLSearchParams();
  if (limits.timeoutSecs && limits.timeoutSecs > 0) q.set("timeout", String(Math.ceil(limits.timeoutSecs)));
  if (limits.maxTotalChargeUsd && limits.maxTotalChargeUsd > 0) q.set("maxTotalChargeUsd", limits.maxTotalChargeUsd.toFixed(2));
  if (limits.maxItems && limits.maxItems > 0) q.set("maxItems", String(Math.ceil(limits.maxItems)));
  const text = q.toString();
  return text ? `?${text}` : "";
}

/** The margin above a run's estimate that its charge cap allows: a quarter more, or 25 cents, whichever is more. */
export const CHARGE_MARGIN = { factor: 1.25, extraUsd: 0.25 } as const;

/** The charge cap for a run estimated at `estimateUsd` (CHARGE_MARGIN, rounded up to the cent, at least `floorUsd`). */
export function chargeCap(estimateUsd: number, floorUsd = 0, margin: { factor: number; extraUsd: number } = CHARGE_MARGIN): number {
  const e = Math.max(0, Number(estimateUsd) || 0);
  // Rounded up to the cent; the small offset keeps float noise (0.55 × 100 = 55.000…01) from adding one.
  return Math.max(floorUsd, Math.ceil(Math.max(e * margin.factor, e + margin.extraUsd) * 100 - 1e-6) / 100);
}

export function apifyClient(token: string, fetchImpl: typeof fetch = fetch) {
  async function call<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${API}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
      });
    } catch (error) {
      throw new ApifyError(`Couldn't reach Apify: ${error instanceof Error ? error.message : String(error)}`, true);
    }
    if (!response.ok) {
      const text = await response.text();
      // Say what to do rather than echo Apify's JSON.
      if (/memory limit|concurrent/i.test(text)) throw new ApifyError("Apify is busy with other runs.", true, response.status);
      if (/hard limit|usage limit|not enough|insufficient|exceed.*limit/i.test(text)) throw new ApifyError("Apify's monthly credit is used up. Add credit or upgrade at console.apify.com → Billing, then try again.", false, response.status);
      if (response.status === 401) throw new ApifyError("The Apify token was rejected. Check APIFY_TOKEN.", false, 401);
      if (response.status === 429 || response.status >= 500) throw new ApifyError(`Apify ${response.status}`, true, response.status);
      throw new ApifyError(`Apify ${response.status}: ${text.slice(0, 300)}`, false, response.status);
    }
    return response.json() as Promise<T>;
  }

  const client = {
    /** Starts a run with its limits (RunLimits): a timeout and a charge cap, so a run nobody watches still ends. */
    start: async (actor: string, input: unknown, limits: RunLimits = {}): Promise<ApifyRun> =>
      (await call<{ data: ApifyRun }>(`/acts/${actor}/runs${runQuery(limits)}`, { method: "POST", body: JSON.stringify(input) })).data,
    get: async (runId: string): Promise<ApifyRun> => (await call<{ data: ApifyRun }>(`/actor-runs/${runId}`)).data,
    items: <T = any>(datasetId: string) => call<T[]>(`/datasets/${datasetId}/items?clean=true&format=json`),
    /** Stops a run at Apify (POST /actor-runs/{id}/abort). True when Apify accepted it; never throws. */
    abort: (runId: string): Promise<boolean> => call(`/actor-runs/${encodeURIComponent(runId)}/abort`, { method: "POST" }).then(() => true, () => false),
    /** Starts an actor, waits for it (polling, so long runs don't hit a sync timeout) and returns its items and cost. */
    async run<T = any>(actor: string, input: unknown, onPoll?: () => void, limits: RunLimits = {}): Promise<{ items: T[]; usd: number }> {
      let run = await client.start(actor, input, limits);
      while (isActive(run.status)) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        run = await client.get(run.id);
        onPoll?.();
      }
      if (run.status !== "SUCCEEDED") throw new ApifyError(`Apify run ${run.id} ended ${run.status.toLowerCase()}${run.statusMessage ? `: ${run.statusMessage}` : ""}`);
      return { items: await client.items<T>(run.defaultDatasetId), usd: Number(run.usageTotalUsd ?? 0) };
    },
  };
  return client;
}

export type Apify = ReturnType<typeof apifyClient>;
