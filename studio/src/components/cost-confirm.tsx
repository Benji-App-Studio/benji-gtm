"use client";
// Asks before a paid step runs, the way Studio confirms a generation (studio/job-list.tsx): what it
// does, the estimated cost and who bills it, then "Spend ≈$0.03 at OpenAI" or Cancel.
import type { ReactNode } from "react";
import { approxUsd, OPENAI_TEXT_PRICING } from "@/lib/ai-cost";
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";
import { ask, Facts } from "./dialog";

export type Payer = "OpenAI" | "Apify";

/** Who bills it and how, in the viewer's language. */
function Billed({ payer }: { payer: Payer }) {
  const { t } = useT();
  return <>{payer === "OpenAI"
    ? t("An estimate at {model} prices: OpenAI bills the tokens actually used, from your OpenAI credit.", { model: OPENAI_TEXT_PRICING.model })
    : t("An estimate: Apify bills what the run uses, from your Apify credit.")}</>;
}

function Said({ text, vars }: { text: string; vars?: Record<string, string> }) {
  return <>{useT().t(text, vars)}</>;
}

/** Resolves true when the person agrees to spend `usd` at `payer`. */
export function confirmSpend(o: { title: string; rows: [string, ReactNode][]; usd: number; payer: Payer; note?: ReactNode }): Promise<boolean> {
  return ask({
    title: o.title,
    body: <Facts rows={[...o.rows, [<Said key="cost" text={m("Estimated {payer} cost")} vars={{ payer: o.payer }} />, <Cost key="usd" usd={o.usd} />]]} note={<><Billed payer={o.payer} />{o.note && <> {o.note}</>}</>} />,
    confirm: <SpendLabel usd={o.usd} payer={o.payer} />,
  });
}

/** The estimate in the page's language ("≈ US$0.02" in Chinese and Korean, like every other amount). */
function Cost({ usd }: { usd: number }) {
  const { t, intl } = useT();
  return <>{approxUsd(usd, intl, t)}</>;
}

function SpendLabel({ usd, payer }: { usd: number; payer: Payer }) {
  const { t, intl } = useT();
  return <>{t("Spend {cost} at {payer}", { cost: approxUsd(usd, intl, t).replace("≈ ", "≈"), payer })}</>;
}
