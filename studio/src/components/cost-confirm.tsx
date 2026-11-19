"use client";
// Asks before a paid step runs, the way Studio confirms a generation (studio/job-list.tsx): what it
// does, the estimated cost and who bills it, then "Spend ≈$0.03 at OpenAI" or Cancel.
import type { ReactNode } from "react";
import { approxUsd, OPENAI_TEXT_PRICING } from "@/lib/ai-cost";
import { ask, Facts } from "./dialog";

export type Payer = "OpenAI" | "Apify";

const BILLED: Record<Payer, string> = {
  OpenAI: `An estimate at ${OPENAI_TEXT_PRICING.model} prices: OpenAI bills the tokens actually used, from your OpenAI credit.`,
  Apify: "An estimate: Apify bills what the run uses, from your Apify credit.",
};

/** Resolves true when the person agrees to spend `usd` at `payer`. */
export function confirmSpend(o: { title: string; rows: [string, ReactNode][]; usd: number; payer: Payer; note?: ReactNode }): Promise<boolean> {
  const cost = approxUsd(o.usd);
  return ask({
    title: o.title,
    body: <Facts rows={[...o.rows, [`Estimated ${o.payer} cost`, cost]]} note={<>{BILLED[o.payer]}{o.note && <> {o.note}</>}</>} />,
    confirm: `Spend ${cost.replace("≈ ", "≈")} at ${o.payer}`,
  });
}
