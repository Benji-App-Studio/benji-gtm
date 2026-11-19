// OpenAI's web search that names competitors (radar discovery). It runs as a background Responses
// request: one POST starts it, later polls read it. Plain TypeScript with its effects passed in, so
// openai_search_test.ts runs it against fakes.
//
// The POST is paid, so it is sent at most once: the state is marked "sending" and saved before it goes
// out. If the POST then times out (the request may be running at OpenAI, but we never learned its id),
// or a worker finds "sending" left behind by one that stopped, the search fails plainly instead of
// being sent again. Reading a request already started (GET) is free and is simply tried again.
import { keyRefusal } from "../../_shared/ai/judge.ts";

export const OPENAI_RESPONSES = "https://api.openai.com/v1/responses";
/** A search not finished after this long is given up on. */
export const SEARCH_GIVE_UP_MS = 10 * 60_000;
export const NOT_RESENT = "OpenAI didn't confirm the search in time. It wasn't sent again, so it isn't paid for twice. The competitors found elsewhere are kept; search again to ask OpenAI once more.";

export interface SearchState { status: "pending" | "sending" | "running" | "done" | "failed"; id?: string; error?: string; startedAt: string }

export interface SearchDeps {
  apiKey: string;
  /** The request body (openAIRequest with background: true). */
  body(): Promise<unknown>;
  /** Saves the state (with "sending" in it) before the POST. False when the job was cancelled: nothing is sent. */
  markSent(): Promise<boolean>;
  /** Keeps what the search found. */
  store(data: unknown): Promise<void>;
  log(message: string): Promise<void>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Network trouble or a timeout (the request may or may not have reached OpenAI). */
const transient = (error: unknown) => error instanceof DOMException || error instanceof TypeError;

/** Takes the search a step further. True when it is settled (done or failed). Throws a refused key (JudgeError "account"). */
export async function pollSearch(ai: SearchState | undefined, deps: SearchDeps): Promise<boolean> {
  if (!ai || ai.status === "done" || ai.status === "failed") return true;
  const doFetch = deps.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${deps.apiKey}`, "Content-Type": "application/json" };
  const fail = async (reason: string) => {
    Object.assign(ai, { status: "failed", error: reason });
    await deps.log(`OpenAI: ${reason}`);
    return true;
  };
  const refusedOrFail = async (status: number, data: Record<string, any>) => {
    const refused = keyRefusal("openai", status, data);
    if (refused) throw refused;
    return fail(String(data?.error?.message ?? `error ${status}`));
  };
  // A POST went out earlier and its answer was lost (the worker stopped): never send it again.
  if (ai.status === "sending") return fail(NOT_RESENT);
  if (ai.status === "pending") {
    ai.status = "sending";
    if (!(await deps.markSent())) return true;
    let response: Response;
    try {
      response = await doFetch(OPENAI_RESPONSES, { method: "POST", headers, body: JSON.stringify(await deps.body()), signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      if (transient(error)) return fail(NOT_RESENT);
      throw error;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return refusedOrFail(response.status, data);
    if (!data?.id) return fail("OpenAI didn't say which request it started.");
    Object.assign(ai, { status: "running", id: data.id });
    if (data.status === "completed") return finish(ai, data, deps);
    return false;
  }
  if ((deps.now?.() ?? Date.now()) - Date.parse(ai.startedAt) > SEARCH_GIVE_UP_MS) return fail("took longer than 10 minutes.");
  let response: Response;
  try {
    response = await doFetch(`${OPENAI_RESPONSES}/${encodeURIComponent(ai.id ?? "")}`, { headers, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    // Reading costs nothing: look again on the next poll.
    if (transient(error)) return false;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return response.status >= 500 ? false : refusedOrFail(response.status, data);
  if (data.status === "queued" || data.status === "in_progress") return false;
  if (data.status !== "completed") return fail(`the search ${data.status}${data.error?.message ? `: ${data.error.message}` : ""}`);
  return finish(ai, data, deps);
}

async function finish(ai: SearchState, data: unknown, deps: SearchDeps): Promise<boolean> {
  await deps.store(data);
  ai.status = "done";
  return true;
}
