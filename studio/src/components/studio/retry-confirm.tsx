"use client";
// Retrying a failed or cancelled job spends again: the price first, in the same confirm "Try with the other
// provider" uses (Facts + a "Spend …" button), then the job goes back in the queue. Shared by the Studio's
// job list and the Playground's results.
import { fmtUsd, PROVIDER_NAME, type ImageProvider } from "@/lib/image-provider";
import { ask, Facts } from "../dialog";

export interface RetryPrice { provider: ImageProvider; credits: number; usd: number; what: string; free?: boolean }

/** The person's yes to spend again. A free job (a post) needs no confirm. */
export async function confirmRetry(p: RetryPrice): Promise<boolean> {
  if (p.free || (!p.credits && !p.usd)) return true;
  const openai = p.provider === "openai";
  return ask({
    title: "Make it again?",
    body: <Facts rows={[["What", p.what], ["Made by", PROVIDER_NAME[p.provider]], openai ? ["Estimated OpenAI cost", `≈ ${fmtUsd(p.usd)}`] : ["Estimated Higgsfield cost", `${p.credits} credit${p.credits === 1 ? "" : "s"}`]]}
      note="The same prompt and images, on the same provider. A job that failed before it was charged costs the same again." />,
    confirm: openai ? `Spend ≈${fmtUsd(p.usd)} at OpenAI` : `Spend ~${p.credits} credit${p.credits === 1 ? "" : "s"}`,
  });
}
