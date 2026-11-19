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

export function apifyClient(token: string) {
  async function call<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API}${path}`, {
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
    start: async (actor: string, input: unknown): Promise<ApifyRun> =>
      (await call<{ data: ApifyRun }>(`/acts/${actor}/runs`, { method: "POST", body: JSON.stringify(input) })).data,
    get: async (runId: string): Promise<ApifyRun> => (await call<{ data: ApifyRun }>(`/actor-runs/${runId}`)).data,
    items: <T = any>(datasetId: string) => call<T[]>(`/datasets/${datasetId}/items?clean=true&format=json`),
    abort: (runId: string) => call(`/actor-runs/${runId}/abort`, { method: "POST" }).catch(() => undefined),
    /** Starts an actor, waits for it (polling, so long runs don't hit a sync timeout) and returns its items and cost. */
    async run<T = any>(actor: string, input: unknown, onPoll?: () => void): Promise<{ items: T[]; usd: number }> {
      let run = await client.start(actor, input);
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
