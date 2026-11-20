"use client";
// Retrying a failed or cancelled job spends again: the price first, in the same confirm "Try with the other
// provider" uses (Facts + a "Spend …" button), then the job goes back in the queue. Shared by the Studio's
// job list and the Playground's results.
import { fmtUsd, PROVIDER_NAME, type ImageProvider } from "@/lib/image-provider";
import { translator, type Translator } from "@/lib/i18n/translate";
import { ask, Facts } from "../dialog";

export interface RetryPrice { provider: ImageProvider; credits: number; usd: number; what: string; free?: boolean }

const ENGLISH = translator("en", null).t;

/** The person's yes to spend again. A free job (a post) needs no confirm. Pass the page's `t` (useT) for its language. */
export async function confirmRetry(p: RetryPrice, t: Translator["t"] = ENGLISH): Promise<boolean> {
  if (p.free || (!p.credits && !p.usd)) return true;
  const openai = p.provider === "openai";
  const n = { n: p.credits };
  return ask({
    title: t("Make it again?"),
    body: <Facts rows={[[t("What"), p.what], [t("Made by"), PROVIDER_NAME[p.provider]], openai ? [t("Estimated OpenAI cost"), `≈ ${fmtUsd(p.usd)}`] : [t("Estimated Higgsfield cost"), (p.credits === 1 ? t("{n} credit", n) : t("{n} credits", n))]]}
      note={t("The same prompt and images, on the same provider. A job that failed before it was charged costs the same again.")} />,
    confirm: openai ? t("Spend ≈{usd} at OpenAI", { usd: fmtUsd(p.usd) }) : (p.credits === 1 ? t("Spend ~{n} credit", n) : t("Spend ~{n} credits", n)),
  });
}
