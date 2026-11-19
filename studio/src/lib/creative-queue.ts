// The format library's hand-off to the creative studio (the format cards call this). Each call queues
// one batch: the model picks the kind of creative, and `params` can add variants, aspect ratios and
// model options (see `requestFromJob`). It acts as the signed-in user.
//
//   await queueCreativeJob({ productId, formatCardId: card.id, model: "marketing_studio_video",
//     prompt: card.recreatePrompt, params: { mode: "ugc", duration: 15, variants: 2, aspects: ["9:16", "1:1"] } });
//
// Show the cost first: `estimateCreativeJob(input)` (no network) and ask() the user, then pass the
// credits you showed as `confirmedCredits` so the job is refused if the price moved.
// Server code (route handlers) uses `queueCreativeJobOnServer` from "@/lib/server/creative-batches".
import { planBatch, requestFromJob, type CreativeJobInput, type Plan } from "./creative-plan";

export type { CreativeJobInput } from "./creative-plan";

export interface QueuedCreativeJob { batchId: string; jobIds: string[]; credits: number; rendered: number; warnings: string[] }

/** What a job would make and cost, before queueing it. `appName` only shapes the prompt. */
export function estimateCreativeJob(input: CreativeJobInput, appName = "the app"): Plan {
  return planBatch(requestFromJob(input), { appName, screenshotUrls: ["(any)"], appStoreUrl: "(any)" });
}

export async function queueCreativeJob(input: CreativeJobInput & { confirmedCredits?: number }): Promise<QueuedCreativeJob> {
  if (typeof window === "undefined") {
    throw new Error("queueCreativeJob runs in the browser; on the server use queueCreativeJobOnServer from @/lib/server/creative-batches.");
  }
  const { productId, ...job } = input;
  const response = await fetch(`/api/studio/${encodeURIComponent(productId)}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
  });
  const data = await response.json().catch(() => ({ error: "Couldn't queue the job. Try again." }));
  if (!response.ok) throw new Error(data.error ?? "Couldn't queue the job.");
  return data as QueuedCreativeJob;
}
